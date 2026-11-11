import { EventEmitter } from 'node:events'
import type { ActivityKind, AgentConfig, CliId, GitFile, MissionInfo, TaskInfo } from '../../../shared/protocol.ts'
import type { AgentConfigStore } from '../agents/configStore.ts'
import type { AgentRegistry } from '../agents/registry.ts'
import type { CliResult, RunningCli, StartOptions } from '../cli/run.ts'
import type { GitService } from '../git/service.ts'
import { cleanOutput, type HistoryStore, redact } from '../history/store.ts'
import type { ProjectStore } from '../projects/store.ts'
import { OPEN_PHASES, type TaskStore } from '../tasks/store.ts'
import { devPrompt, parseVerdict, planPrompt, reviewPrompt } from './prompts.ts'

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
  stepTimeoutMs?: number
}

/** Prepara parâmetros dinâmicos de execução conforme provedor, modelo e esforço configurados. */
export function getStepCliAndArgs(
  role: 'planning' | 'developing' | 'reviewing',
  cfg?: AgentConfig,
): { cli: CliId; args: string[]; model: string; effort: string } {
  const provider = (cfg?.provider === 'codex' || cfg?.provider === 'gemini')
    ? cfg.provider
    : (role === 'developing' ? 'codex' : 'gemini')
  const model = cfg?.model || 'default'
  const effort = cfg?.reasoningEffort || 'default'

  let args: string[] = []
  if (provider === 'gemini') {
    args = ['--approval-mode', role === 'developing' ? 'auto_edit' : 'default']
    if (model && model !== 'auto' && model !== 'default') {
      args.push('-m', model)
    }
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

  return { cli: provider, args, model, effort }
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
    this.stepTimeoutMs = options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
  }

  /** Na inicialização: fecha missões que morreram com o app e restaura a espera por aprovação. */
  recover() {
    for (const mission of this.tasks.failInterrupted()) {
      if (this.tasks.get(mission.taskId)) this.tasks.setStatus(mission.taskId, 'todo')
      this.log(mission, 'error', `Missão #${mission.id} interrompida: o app foi fechado durante a execução.`)
    }
    if (this.tasks.openMissions().some((m) => m.phase === 'awaiting_approval')) {
      this.registry.setMissionState('architect', 'approval', 'Plano pronto: aguardando sua aprovação')
    }
  }

  /** Etapa 1: o Arquiteto planeja. Devolve a missão criada. */
  async start(taskId: number): Promise<MissionInfo> {
    this.assertTeamFree()
    const { task, cwd } = this.context(taskId)
    this.assertAgentsAvailable()
    this.preparing = true
    try {
      await this.requireCleanRepo(cwd)
    } finally {
      this.preparing = false
    }
    // O mundo pode ter mudado durante a consulta ao Git.
    this.assertTeamFree()
    this.context(taskId)

    const mission = this.tasks.createMission(task.id, task.projectId)
    this.running = { missionId: mission.id, cancelled: false }
    this.tasks.setStatus(task.id, 'doing')
    this.log(mission, 'mission', `Missão #${mission.id} iniciada: "${task.title}"`)
    for (const id of TEAM) this.registry.setMissionState(id, null)
    this.registry.setMissionState('architect', 'planning', `Planejando a missão #${mission.id}`)
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
    this.assertAgentsAvailable()
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
    this.registry.setMissionState('architect', 'done', 'Plano aprovado')
    this.registry.setMissionState('dev', 'working', `Implementando a missão #${missionId}`)
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
    for (const id of TEAM) this.registry.setMissionState(id, null)
  }

  /** Ao fechar o app: não deixar CLIs órfãos. */
  shutdown() {
    this.running?.proc?.kill()
  }

  private async runPlanning(missionId: number, task: TaskInfo, cwd: string) {
    const stepConfig = getStepCliAndArgs('planning', this.configs?.get('architect'))
    const plan = await this.step(
      missionId,
      'architect',
      stepConfig.cli,
      stepConfig.args,
      cwd,
      planPrompt(task),
      stepConfig.model,
      stepConfig.effort,
    )
    if (plan === null) return
    const mission = this.tasks.updateMission(missionId, { phase: 'awaiting_approval', plan })
    this.running = null
    this.log(mission, 'mission', `Plano da missão #${missionId} pronto. Aguardando aprovação do usuário.`, 'architect')
    this.registry.setMissionState('architect', 'approval', `Plano da missão #${missionId} pronto: aguardando sua aprovação`)
  }

  private async runDevelopment(missionId: number, task: TaskInfo, plan: string, cwd: string) {
    const run = this.running!
    const devConfig = getStepCliAndArgs('developing', this.configs?.get('dev'))
    const report = await this.step(
      missionId,
      'dev',
      devConfig.cli,
      devConfig.args,
      cwd,
      devPrompt(task, plan),
      devConfig.model,
      devConfig.effort,
    )
    if (report === null) return

    let changed: GitFile[]
    try {
      changed = (await this.git.status(cwd)).files
    } catch (error) {
      if (!run.cancelled) this.fail(missionId, 'dev', `Não foi possível ler o Git depois do Dev: ${errorText(error)}`)
      return
    }
    if (run.cancelled) return
    const files = changed.map((f) => f.path)
    const mission = this.tasks.updateMission(missionId, { phase: 'reviewing', devReport: report, files })
    this.log(
      mission,
      'files',
      files.length ? `Arquivos alterados pelo Dev: ${files.join(', ')}` : 'O Dev não alterou nenhum arquivo.',
      'dev',
    )
    this.emit('git-change', {
      agentId: 'dev',
      cwd,
      files,
      summary:
        files.length > 0
          ? `Codex concluiu a implementação — novas alterações detectadas (${files.length} arquivo(s)).`
          : 'Codex concluiu a implementação — nenhuma alteração detectada.',
    })
    this.registry.setMissionState('dev', 'done', 'Implementação entregue ao QA')
    this.registry.setMissionState('qa', 'reviewing', `Revisando a missão #${missionId}`)

    const diff = await this.collectDiff(cwd, changed)
    const qaConfig = getStepCliAndArgs('reviewing', this.configs?.get('qa'))
    const review = await this.step(
      missionId,
      'qa',
      qaConfig.cli,
      qaConfig.args,
      cwd,
      reviewPrompt(task, plan, report, files, diff),
      qaConfig.model,
      qaConfig.effort,
    )
    if (review === null) return

    const verdict = parseVerdict(review)
    const done = this.tasks.updateMission(missionId, { phase: 'done', review, verdict })
    this.running = null
    this.tasks.setStatus(task.id, 'review')
    const label = verdict === 'approved' ? 'aprovado' : verdict === 'changes' ? 'reprovado, pede mudanças' : 'sem veredito claro'
    this.log(done, 'review', `Revisão do QA na missão #${missionId}: ${label}.`, 'qa')
    this.log(done, 'mission', `Missão #${missionId} concluída. Revise as alterações e faça o commit no painel Alterações.`)
    this.registry.setMissionState('qa', 'done', `Revisão: ${label}`)
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
  ) {
    const run = this.running
    if (!run || run.missionId !== missionId || run.cancelled) return null
    const name = this.registry.get(agentId)?.name ?? agentId
    const mission = this.requireMission(missionId)
    const modelInfo = model && model !== 'default' ? `, modelo: ${model}` : ''
    const effortInfo = effort && effort !== 'default' ? `, esforço: ${effort}` : ''
    this.log(mission, 'agent', `${name} (${cli}${modelInfo}${effortInfo}) começou a trabalhar na missão #${missionId}.`, agentId)
    try {
      run.proc = this.launch(cli, args, {
        cwd,
        input: prompt,
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
    for (const id of TEAM) if (id !== agentId) this.registry.setMissionState(id, null)
    this.registry.setMissionState(agentId, 'error', message.split('\n')[0])
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

  private assertAgentsAvailable() {
    for (const id of TEAM) {
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
