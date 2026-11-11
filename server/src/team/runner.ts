import { EventEmitter } from 'node:events'
import type {
  ActivityKind,
  AgentConfig,
  AgentSnapshotEntry,
  CliId,
  GitFile,
  MissionInfo,
  MissionTeamSelection,
  ProviderId,
  SpecializationId,
  TaskInfo,
} from '../../../shared/protocol.ts'
import type { AgentConfigStore } from '../agents/configStore.ts'
import type { AgentRegistry } from '../agents/registry.ts'
import { defaultSpecializations, type SpecializationRegistry } from '../agents/specializations.ts'
import type { CliResult, RunningCli, StartOptions } from '../cli/run.ts'
import type { GitService } from '../git/service.ts'
import { cleanOutput, type HistoryStore, redact } from '../history/store.ts'
import type { ProjectStore } from '../projects/store.ts'
import { OPEN_PHASES, type TaskStore } from '../tasks/store.ts'
import { devPrompt, parseDetailedVerdict, parseVerdict, planPrompt, reviewPrompt } from './prompts.ts'

/** Inicia um CLI oficial sem terminal. Em produção é o startCli; nos testes, um falso. */
export type AgentLauncher = (cli: CliId, args: string[], options: StartOptions) => RunningCli

// Gemini sem terminal roda em modo headless. Com approval-mode default, as
// ferramentas que pediriam confirmação (gravar arquivo, rodar comando) ficam
// bloqueadas: Arquiteto e QA só leem o projeto.
export const GEMINI_ARGS = ['--approval-mode', 'default']
// Codex exec com o sandbox oficial workspace-write: grava só dentro do projeto,
// sem rede. O prompt chega pela entrada padrão ("-").
export const CODEX_ARGS = ['exec', '--sandbox', 'workspace-write', '-']

const TEAM = ['architect', 'dev', 'qa']
const VALID_PROVIDERS = new Set<ProviderId>(['antigravity', 'codex', 'gemini'])
const DEFAULT_STEP_TIMEOUT_MS = 20 * 60_000
const MAX_TEXT = 100_000
const MAX_DIFF = 60_000
const LIMIT_PATTERN = /rate.?limit|quota|usage limit|too many requests|\b429\b|resource.?exhausted/i
// Diferenças desses arquivos não vão para o QA: costumam guardar credenciais.
const SECRET_FILE = /(^|[\\/])\.env(\.|$)|\.(pem|key|p12|pfx)$|(^|[\\/])id_(rsa|ed25519)/i

export interface TeamOptions {
  tasks: TaskStore
  history: HistoryStore
  projects: ProjectStore
  registry: AgentRegistry
  git: GitService
  launch: AgentLauncher
  configs?: AgentConfigStore
  specializations?: SpecializationRegistry
  stepTimeoutMs?: number
}

/** Prepara parâmetros dinâmicos de execução conforme provedor, modelo e esforço configurados. */
export function getStepCliAndArgs(
  role: 'planning' | 'developing' | 'reviewing',
  cfg?: AgentConfig,
): { cli: CliId; args: string[]; model: string; effort: string; passPromptAsArg?: boolean } {
  const provider = (cfg?.provider === 'codex' || cfg?.provider === 'gemini' || cfg?.provider === 'antigravity')
    ? cfg.provider
    : (role === 'developing' ? 'codex' : 'gemini')
  const cli: CliId = provider === 'antigravity' ? 'agy' : provider
  const model = cfg?.model || 'default'
  const effort = cfg?.reasoningEffort || 'default'

  let args: string[] = []
  let passPromptAsArg = false

  if (cli === 'gemini') {
    args = ['--approval-mode', role === 'developing' ? 'auto_edit' : 'default']
    if (model && model !== 'auto' && model !== 'default') {
      args.push('-m', model)
    }
  } else if (cli === 'agy') {
    args = []
    if (role === 'developing') {
      args.push('--mode', 'accept-edits')
    }
    if (model && model !== 'default') {
      args.push('--model', model)
    }
    if (effort && effort !== 'default') {
      args.push('--effort', effort)
    }
    args.push('-p')
    passPromptAsArg = true
  } else {
    const sandbox = role === 'developing' ? 'workspace-write' : 'read-only'
    args = ['exec', '--sandbox', sandbox]
    if (model && model !== 'default') {
      args.push('-m', model)
    }
    if (effort && effort !== 'default') {
      args.push('-c', `model_reasoning_effort=${effort}`)
    }
    args.push('-')
  }

  return { cli, args, model, effort, passPromptAsArg }
}

/** Missão com um CLI trabalhando agora. */
interface Running {
  missionId: number
  proc?: RunningCli
  cancelled: boolean
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Modo equipe: Arquiteto (Gemini) planeja -> usuário aprova -> Dev (Codex)
 * implementa -> QA (Gemini) revisa. Uma missão por vez. Emite 'output'
 * (missionId, texto) com a saída ao vivo do CLI que está trabalhando.
 */
export class TeamRunner extends EventEmitter {
  private readonly tasks: TaskStore
  private readonly history: HistoryStore
  private readonly projects: ProjectStore
  private readonly registry: AgentRegistry
  private readonly git: GitService
  private readonly launch: AgentLauncher
  private readonly configs?: AgentConfigStore
  private readonly specializations: SpecializationRegistry
  private readonly stepTimeoutMs: number
  private running: Running | null = null
  /** true enquanto start/approve consultam o Git (é assíncrono). */
  private preparing = false

  constructor(options: TeamOptions) {
    super()
    this.tasks = options.tasks
    this.history = options.history
    this.projects = options.projects
    this.registry = options.registry
    this.git = options.git
    this.launch = options.launch
    this.configs = options.configs
    this.specializations = options.specializations ?? defaultSpecializations
    this.stepTimeoutMs = options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
  }

  /** Na inicialização: fecha missões que morreram com o app e restaura a espera por aprovação. */
  recover() {
    for (const mission of this.tasks.failInterrupted()) {
      if (this.tasks.get(mission.taskId)) this.tasks.setStatus(mission.taskId, 'todo')
      this.log(mission, 'error', `Missão #${mission.id} interrompida: o app foi fechado durante a execução.`)
    }
    for (const m of this.tasks.openMissions()) {
      if (m.phase === 'awaiting_approval') {
        this.registry.setMissionState(m.plannerId || 'architect', 'approval', 'Plano pronto: aguardando sua aprovação')
      }
    }
  }

  /** Etapa 1: o planejador (padrão: 'architect') planeja. Devolve a missão criada. */
  async start(taskId: number, team?: Partial<MissionTeamSelection>): Promise<MissionInfo> {
    this.assertTeamFree()
    const { task, cwd } = this.context(taskId)
    const { plannerId, devId, qaId, teamSnapshot } = this.validateAndBuildTeam(team)
    this.preparing = true
    try {
      await this.requireCleanRepo(cwd)
    } finally {
      this.preparing = false
    }
    // O mundo pode ter mudado durante a consulta ao Git.
    this.assertTeamFree()
    this.context(taskId)
    this.validateAndBuildTeam(team)

    const mission = this.tasks.createMission(task.id, task.projectId, {
      plannerId,
      devId,
      qaId,
      teamSnapshot,
    })
    this.running = { missionId: mission.id, cancelled: false }
    this.tasks.setStatus(task.id, 'doing')
    this.log(mission, 'mission', `Missão #${mission.id} iniciada: "${task.title}" (${plannerId} → ${devId} → ${qaId})`)
    for (const id of new Set([...TEAM, plannerId, devId, qaId])) this.registry.setMissionState(id, null)
    this.registry.setMissionState(plannerId, 'planning', `Planejando a missão #${mission.id}`)
    void this.runPlanning(mission.id, task, cwd)
    return mission
  }

  /** Etapa 2: o usuário aprovou o plano; o Dev implementa e depois o QA revisa. */
  async approve(missionId: number) {
    const mission = this.requireMission(missionId)
    if (mission.phase !== 'awaiting_approval' || this.running || this.preparing) {
      throw new Error('Esta missão não está aguardando aprovação.')
    }
    const { task, cwd } = this.context(mission.taskId)
    const [plannerId, devId, qaId] = this.missionTeam(mission)
    this.assertAgentsAvailable([plannerId, devId, qaId])
    this.preparing = true
    try {
      await this.requireCleanRepo(cwd)
    } finally {
      this.preparing = false
    }
    if (this.requireMission(missionId).phase !== 'awaiting_approval' || this.running) {
      throw new Error('Esta missão não está mais aguardando aprovação.')
    }

    // Muda a fase antes de qualquer espera: um segundo clique em "Aprovar" não dispara outra execução.
    this.tasks.updateMission(missionId, { phase: 'developing' })
    this.running = { missionId, cancelled: false }
    this.log(mission, 'mission', `Plano da missão #${missionId} aprovado pelo usuário.`)
    this.registry.setMissionState(plannerId, 'done', 'Plano aprovado')
    this.registry.setMissionState(devId, 'working', `Implementando a missão #${missionId}`)
    void this.runDevelopment(missionId, task, mission.plan, cwd)
  }

  /** Rejeita o plano ou interrompe a missão, encerrando o CLI que estiver rodando. */
  cancel(missionId: number) {
    const mission = this.requireMission(missionId)
    if (!OPEN_PHASES.includes(mission.phase)) throw new Error('Esta missão já terminou.')
    if (this.running?.missionId === missionId) {
      this.running.cancelled = true
      this.running.proc?.kill()
      this.running = null
    }
    this.tasks.updateMission(missionId, { phase: 'cancelled' })
    this.tasks.setStatus(mission.taskId, 'todo')
    this.log(
      mission,
      'mission',
      mission.phase === 'awaiting_approval'
        ? `Plano da missão #${missionId} rejeitado pelo usuário.`
        : `Missão #${missionId} cancelada pelo usuário.`,
    )
    for (const id of new Set([...TEAM, ...this.missionTeam(mission)])) {
      this.registry.setMissionState(id, null)
    }
  }

  /** Ao fechar o app: não deixar CLIs órfãos. */
  shutdown() {
    this.running?.proc?.kill()
  }

  private async runPlanning(missionId: number, task: TaskInfo, cwd: string) {
    const current = this.requireMission(missionId)
    const [plannerId] = this.missionTeam(current)
    const cfg = this.resolveMissionAgentConfig(current, plannerId, 'tech-lead')
    const stepConfig = getStepCliAndArgs('planning', cfg)
    const prompt = planPrompt(task, {
      agentName: cfg?.name,
      specializationId: cfg?.specializationId ?? 'tech-lead',
      customInstructions: cfg?.customInstructions,
      registry: this.specializations,
    })
    const plan = await this.step(
      missionId,
      plannerId,
      stepConfig.cli,
      stepConfig.args,
      cwd,
      prompt,
      stepConfig.model,
      stepConfig.effort,
      stepConfig.passPromptAsArg,
    )
    if (plan === null) return
    const mission = this.tasks.updateMission(missionId, { phase: 'awaiting_approval', plan })
    this.running = null
    this.log(mission, 'mission', `Plano da missão #${missionId} pronto. Aguardando aprovação do usuário.`, plannerId)
    this.registry.setMissionState(plannerId, 'approval', `Plano da missão #${missionId} pronto: aguardando sua aprovação`)
  }

  private async runDevelopment(missionId: number, task: TaskInfo, plan: string, cwd: string) {
    const run = this.running!
    const current = this.requireMission(missionId)
    const [, devId, qaId] = this.missionTeam(current)
    const devCfg = this.resolveMissionAgentConfig(current, devId, 'developer')
    const devConfig = getStepCliAndArgs('developing', devCfg)
    const devPromptText = devPrompt(task, plan, {
      agentName: devCfg?.name,
      specializationId: devCfg?.specializationId ?? 'developer',
      customInstructions: devCfg?.customInstructions,
      registry: this.specializations,
    })
    const report = await this.step(
      missionId,
      devId,
      devConfig.cli,
      devConfig.args,
      cwd,
      devPromptText,
      devConfig.model,
      devConfig.effort,
      devConfig.passPromptAsArg,
    )
    if (report === null) return

    let changed: GitFile[]
    try {
      changed = (await this.git.status(cwd)).files
    } catch (error) {
      if (!run.cancelled) this.fail(missionId, devId, `Não foi possível ler o Git depois do Dev: ${errorText(error)}`)
      return
    }
    if (run.cancelled) return
    const files = changed.map((f) => f.path)
    const mission = this.tasks.updateMission(missionId, { phase: 'reviewing', devReport: report, files })
    const devLabel = devCfg?.name || devId
    this.log(
      mission,
      'files',
      files.length ? `Arquivos alterados por ${devLabel}: ${files.join(', ')}` : `O ${devLabel} não alterou nenhum arquivo.`,
      devId,
    )
    const cliActor = devConfig.cli === 'codex' ? 'Codex' : devLabel
    this.emit('git-change', {
      agentId: devId,
      cwd,
      files,
      summary:
        files.length > 0
          ? `${cliActor} concluiu a implementação — novas alterações detectadas (${files.length} arquivo(s)).`
          : `${cliActor} concluiu a implementação — nenhuma alteração detectada.`,
    })
    this.registry.setMissionState(devId, 'done', 'Implementação entregue ao QA')
    this.registry.setMissionState(qaId, 'reviewing', `Revisando a missão #${missionId}`)

    const diff = await this.collectDiff(cwd, changed)
    const qaCfg = this.resolveMissionAgentConfig(current, qaId, 'qa-tester')
    const qaConfig = getStepCliAndArgs('reviewing', qaCfg)
    const qaPromptText = reviewPrompt(task, plan, report, files, diff, {
      agentName: qaCfg?.name,
      specializationId: qaCfg?.specializationId ?? 'qa-tester',
      customInstructions: qaCfg?.customInstructions,
      registry: this.specializations,
    })
    const review = await this.step(
      missionId,
      qaId,
      qaConfig.cli,
      qaConfig.args,
      cwd,
      qaPromptText,
      qaConfig.model,
      qaConfig.effort,
      qaConfig.passPromptAsArg,
    )
    if (review === null) return

    const verdictDetail = parseDetailedVerdict(review)
    const verdict = parseVerdict(review)
    const done = this.tasks.updateMission(missionId, { phase: 'done', review, verdict, verdictDetail })
    this.running = null
    this.tasks.setStatus(task.id, 'review')
    const detailSuffix = verdictDetail ? ` (${verdictDetail})` : ''
    const label =
      verdict === 'approved'
        ? `aprovado${detailSuffix}`
        : verdict === 'changes'
          ? `reprovado, pede mudanças${detailSuffix}`
          : 'sem veredito claro'
    this.log(done, 'review', `Revisão do QA na missão #${missionId}: ${label}.`, qaId)
    this.log(done, 'mission', `Missão #${missionId} concluída. Revise as alterações e faça o commit no painel Alterações.`)
    this.registry.setMissionState(qaId, 'done', `Revisão: ${verdictDetail ?? label}`)
  }

  /** Roda um CLI com o prompt e devolve a resposta, ou null se falhou ou foi cancelado. */
  private async step(
    missionId: number,
    agentId: string,
    cli: CliId,
    args: string[],
    cwd: string,
    prompt: string,
    model = 'default',
    effort = 'default',
    passPromptAsArg = false,
  ) {
    const run = this.running
    if (!run || run.missionId !== missionId || run.cancelled) return null
    const mission = this.requireMission(missionId)
    const snapName = mission.teamSnapshot?.[agentId]?.name
    const name = snapName ?? this.registry.get(agentId)?.name ?? agentId
    const modelInfo = model && model !== 'default' ? `, modelo: ${model}` : ''
    const effortInfo = effort && effort !== 'default' ? `, esforço: ${effort}` : ''
    this.log(mission, 'agent', `${name} (${cli}${modelInfo}${effortInfo}) começou a trabalhar na missão #${missionId}.`, agentId)
    try {
      const stepArgs = passPromptAsArg ? [...args, prompt] : args
      const stepInput = passPromptAsArg ? undefined : prompt
      run.proc = this.launch(cli, stepArgs, {
        cwd,
        input: stepInput,
        timeoutMs: this.stepTimeoutMs,
        onOutput: (text) => {
          const clean = cleanOutput(text)
          if (clean) this.emit('output', missionId, clean)
        },
      })
      const result = await run.proc.done
      run.proc = undefined
      if (run.cancelled) return null
      if (result.timedOut) {
        throw new Error(`${name}: tempo esgotado (${Math.round(this.stepTimeoutMs / 60_000)} min). O processo foi encerrado.`)
      }
      if (result.code !== 0) throw new Error(failureText(name, cli, result))

      // Verificação de permissões e operações bloqueadas para Antigravity headless
      if (cli === 'agy') {
        const fullOutput = `${result.stdout}\n${result.stderr}`
        if (/permission denied|operation blocked|denied by policy|user approval required/i.test(fullOutput)) {
          this.log(mission, 'error', `Aviso (${name}): Operações foram bloqueadas por restrições de permissão do Antigravity CLI.`, agentId)
        }
      }

      const text = cleanOutput(result.stdout).trim().slice(0, MAX_TEXT)
      if (!text) throw new Error(`${name}: o ${cli} terminou sem resposta.`)
      this.log(mission, 'agent', `${name} (${cli}) terminou a sua etapa da missão #${missionId}.`, agentId)
      return text
    } catch (error) {
      if (!run.cancelled) this.fail(missionId, agentId, errorText(error))
      return null
    }
  }

  private fail(missionId: number, agentId: string, message: string) {
    const mission = this.tasks.updateMission(missionId, { phase: 'failed', error: redact(message) })
    this.running = null
    if (this.tasks.get(mission.taskId)) this.tasks.setStatus(mission.taskId, 'todo')
    this.log(mission, 'error', message, agentId)
    for (const id of new Set([...TEAM, ...this.missionTeam(mission)])) {
      if (id !== agentId) this.registry.setMissionState(id, null)
    }
    this.registry.setMissionState(agentId, 'error', message.split('\n')[0])
  }

  private missionTeam(mission: Pick<MissionInfo, 'plannerId' | 'devId' | 'qaId'>): [string, string, string] {
    return [mission.plannerId || 'architect', mission.devId || 'dev', mission.qaId || 'qa']
  }

  private resolveMissionAgentConfig(
    mission: MissionInfo,
    agentId: string,
    defaultSpec: SpecializationId,
  ): AgentConfig | undefined {
    const snap = mission.teamSnapshot?.[agentId]
    if (snap && snap.provider) {
      return {
        agentId: snap.agentId,
        name: snap.name,
        role: snap.role,
        provider: snap.provider,
        model: snap.model || 'default',
        reasoningEffort: snap.reasoningEffort ?? 'default',
        specializationId: snap.specializationId ?? defaultSpec,
        customInstructions: snap.customInstructions ?? '',
        updatedAt: mission.createdAt,
      }
    }
    return this.configs?.get(agentId)
  }

  private validateAndBuildTeam(team?: Partial<MissionTeamSelection>): {
    plannerId: string
    devId: string
    qaId: string
    teamSnapshot: Record<string, AgentSnapshotEntry>
  } {
    const plannerId = (team?.plannerId ?? 'architect').trim() || 'architect'
    const devId = (team?.devId ?? 'dev').trim() || 'dev'
    const qaId = (team?.qaId ?? 'qa').trim() || 'qa'

    const slots: {
      agentId: string
      expectedCategory: 'planning' | 'developing' | 'reviewing'
      defaultSpec: SpecializationId
      stageLabel: string
    }[] = [
      { agentId: plannerId, expectedCategory: 'planning', defaultSpec: 'tech-lead', stageLabel: 'planejamento' },
      { agentId: devId, expectedCategory: 'developing', defaultSpec: 'developer', stageLabel: 'desenvolvimento' },
      { agentId: qaId, expectedCategory: 'reviewing', defaultSpec: 'qa-tester', stageLabel: 'revisão QA' },
    ]

    const teamSnapshot: Record<string, AgentSnapshotEntry> = {}

    for (const slot of slots) {
      const cfg = this.configs?.find(slot.agentId)
      if (this.configs) {
        if (!cfg) {
          throw new Error(`Agente "${slot.agentId}" não encontrado no cadastro.`)
        }
        if (cfg.active === false) {
          throw new Error(`O agente "${cfg.name || slot.agentId}" está inativo e não pode participar de missões.`)
        }
        if (cfg.roleCategory && cfg.roleCategory !== slot.expectedCategory) {
          throw new Error(
            `O agente "${cfg.name || slot.agentId}" possui categoria "${cfg.roleCategory}", incompatível com a etapa de ${slot.stageLabel} (requer "${slot.expectedCategory}").`,
          )
        }
        if (!VALID_PROVIDERS.has(cfg.provider)) {
          throw new Error(`O agente "${cfg.name || slot.agentId}" possui provedor CLI inválido ("${String(cfg.provider)}").`)
        }
        if (!cfg.model || typeof cfg.model !== 'string' || !cfg.model.trim()) {
          throw new Error(`O agente "${cfg.name || slot.agentId}" não possui um modelo válido configurado.`)
        }
      }

      const regAgent = this.registry.get(slot.agentId)
      if (!regAgent || regAgent.state === 'offline') {
        throw new Error(`${regAgent?.name ?? cfg?.name ?? slot.agentId}: CLI indisponível. Use "Verificar CLI" na janela do agente.`)
      }

      const fallbackProvider: ProviderId =
        regAgent.cli === 'agy' ? 'antigravity' : regAgent.cli === 'codex' ? 'codex' : 'gemini'

      teamSnapshot[slot.agentId] = {
        agentId: slot.agentId,
        name: cfg?.name || regAgent.name || slot.agentId,
        role: cfg?.role || regAgent.role || '',
        provider: cfg?.provider ?? fallbackProvider,
        model: cfg?.model || 'default',
        reasoningEffort: cfg?.reasoningEffort ?? 'default',
        specializationId: cfg?.specializationId ?? slot.defaultSpec,
        customInstructions: cfg?.customInstructions ? redact(cfg.customInstructions) : '',
      }
    }

    return { plannerId, devId, qaId, teamSnapshot }
  }

  /** Diferenças entregues ao QA. Nunca falha: sem diff, o QA ainda lê os arquivos. */
  private async collectDiff(cwd: string, files: GitFile[]) {
    let out = ''
    try {
      for (const file of files) {
        if (out.length >= MAX_DIFF) break
        if (SECRET_FILE.test(file.path)) {
          out += `\n(diferenças de ${file.path} omitidas: o arquivo pode conter segredos)\n`
          continue
        }
        if (file.staged) out += await this.git.diff(cwd, file.path, true)
        if (file.unstaged) out += await this.git.diff(cwd, file.path, false)
      }
    } catch (error) {
      out += `\n(não foi possível ler todas as diferenças: ${errorText(error)})\n`
    }
    return out.length > MAX_DIFF ? `${out.slice(0, MAX_DIFF)}\n… diferenças cortadas …` : out
  }

  /**
   * Repositório Git sem alterações pendentes: assim o relatório mostra só o
   * que o Dev mudou, e o usuário consegue desfazer tudo pelo Git.
   */
  private async requireCleanRepo(cwd: string) {
    const status = await this.git.status(cwd)
    if (!status.isRepo) {
      throw new Error('O modo equipe precisa que o projeto seja um repositório Git. Rode "git init" e faça um primeiro commit.')
    }
    if (status.files.length > 0) {
      throw new Error(
        'O projeto tem alterações sem commit. Faça o commit delas no painel Alterações antes, para o relatório mostrar só o que o Dev mudou.',
      )
    }
  }

  private assertTeamFree() {
    if (this.running || this.preparing || this.tasks.openMissions().length > 0) {
      throw new Error('A equipe já está em uma missão. Conclua ou cancele a atual antes de começar outra.')
    }
  }

  private assertAgentsAvailable(agentIds: string[] = TEAM) {
    for (const id of new Set(agentIds)) {
      const agent = this.registry.get(id)
      if (!agent || agent.state === 'offline') {
        throw new Error(`${agent?.name ?? id}: CLI indisponível. Use "Verificar CLI" na janela do agente.`)
      }
    }
  }

  /** A tarefa e a pasta autorizada do projeto dela. */
  private context(taskId: number) {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error('Tarefa não encontrada.')
    const project = this.projects.get(task.projectId)
    if (!project) throw new Error('O projeto desta tarefa não está mais na lista de projetos autorizados.')
    return { task, cwd: project.path }
  }

  private requireMission(missionId: number) {
    const mission = this.tasks.getMission(missionId)
    if (!mission) throw new Error('Missão não encontrada.')
    return mission
  }

  private log(mission: MissionInfo, kind: ActivityKind, message: string, agentId: string | null = null) {
    this.history.add({ kind, message, projectId: mission.projectId, taskId: mission.taskId, missionId: mission.id, agentId })
  }
}

function failureText(name: string, cli: CliId, result: CliResult) {
  const output = cleanOutput(`${result.stderr}\n${result.stdout}`).trim()
  const tail = output.slice(-800)
  if (LIMIT_PATTERN.test(output)) {
    return `${name}: o ${cli} atingiu um limite de uso (cota ou excesso de requisições). Tente de novo mais tarde.\n${tail}`
  }
  return `${name}: o ${cli} terminou com código ${result.code}.\n${tail}`
}
