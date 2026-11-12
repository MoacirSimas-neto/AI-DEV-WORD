import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type {
  ActivityKind,
  AgentConfig,
  AgentSnapshotEntry,
  CliId,
  DynamicProposal,
  EvidenceKind,
  GitFile,
  GitStatus,
  MemoryContextRecord,
  MissionAttempt,
  MissionEventState,
  MissionEventType,
  MissionInfo,
  MissionMode,
  MissionSpecialistSelection,
  MissionTeamSelection,
  PlannedStep,
  ProposalDecision,
  ProviderId,
  RecoveryState,
  ResumeAction,
  SkillApplication,
  SpecializationId,
  SpecialistResult,
  TaskInfo,
} from '../../../shared/protocol.ts'
import { MAX_MISSION_SPECIALISTS } from '../../../shared/protocol.ts'
import type { AgentConfigStore } from '../agents/configStore.ts'
import type { AgentRegistry } from '../agents/registry.ts'
import { defaultSpecializations, type SpecializationRegistry } from '../agents/specializations.ts'
import type { CliResult, RunningCli, StartOptions } from '../cli/run.ts'
import type { GitService } from '../git/service.ts'
import { cleanOutput, type HistoryStore, redact } from '../history/store.ts'
import { buildMemoryContext } from '../memory/context.ts'
import type { MemoryStore } from '../memory/store.ts'
import { type EventStore, fingerprint } from '../observability/store.ts'
import type { ProjectStore } from '../projects/store.ts'
import { composeSkills, type SkillStore } from '../skills/store.ts'
import { OPEN_PHASES, type TaskStore } from '../tasks/store.ts'
import {
  assertTransition,
  checkDecision,
  checkLimits,
  DEFAULT_LIMITS,
  eligibleSteps,
  type LimitHit,
  MODE_STEP_ROLE,
  nextAdjustRound,
  nextStep,
  planStatus,
  recoveredPhase,
  rejectedBefore,
  replanLimit,
  resolveLimits,
  retryableSteps,
  stepBlocker,
  usageOf,
  validateProposal,
} from './coordinator.ts'
import type { PlanStore } from './planStore.ts'
import { interpretProposal, MAX_INVALID_PROPOSALS, PROPOSAL_OPEN } from './proposal.ts'
import {
  approvedPlanText,
  asUntrusted,
  delegatedStepPrompt,
  devPrompt,
  parseClarificationRequest,
  parseDetailedVerdict,
  parseStepSignals,
  parseVerdict,
  planPrompt,
  proposalPrompt,
  type ProposalPromptContext,
  type ProposalTrigger,
  type ReworkContext,
  reviewPrompt,
  specialistPostDevPrompt,
  specialistPreDevPrompt,
} from './prompts.ts'

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
/** Rodadas Dev -> QA por missão: impede retrabalho infinito. */
export const MAX_ATTEMPTS = 3
/** Quantas vezes o planejador pode perguntar ao usuário antes de ter de planejar com o que há. */
export const MAX_CLARIFICATION_ROUNDS = 2
// O Windows limita a linha de comando a ~32 mil caracteres (o agy recebe o prompt como argumento).
export const MAX_ARG_PROMPT = 26_000
export const LIMIT_PATTERN = /rate.?limit|quota|usage limit|too many requests|\b429\b|resource.?exhausted/i
// O Antigravity headless não consegue pedir permissão de comando: a tentativa é
// negada e o turno inteiro sai vazio (código 0). O aviso evita a tentativa.
export const AGY_HEADLESS_NOTICE = `

Restrição do ambiente (prevalece sobre qualquer outra instrução, inclusive o plano): nesta execução você NÃO pode executar comandos de terminal; qualquer tentativa é negada e a etapa termina sem resposta. Use apenas leitura de arquivos e análise estática (e edição de arquivos, se esta etapa permitir), e declare como "não executado" tudo o que dependeria de um comando.`
const AGY_COMMAND_DENIED = /auto-denied|headless mode cannot prompt/i
// Diferenças desses arquivos não vão para o QA: costumam guardar credenciais.
const SECRET_FILE = /(^|[\\/])\.env(\.|$)|\.(pem|key|p12|pfx)$|(^|[\\/])id_(rsa|ed25519)/i
// Heurística: a resposta fala de testes executados. Vira evento "declarado", nunca "verificado".
const TEST_MENTION =
  /\b(npm (run )?test|pytest|jest|vitest|cargo test|go test|testes? (foram |fo[ir] )?(executad|rodad|passa)\w*|(rodei|executei) (os |a su[ií]te de )?testes?|tests? pass\w*|\d+ (testes?|tests?) (passa|pass|falh|fail)\w*)/i
const MAX_EVENT_FILES = 40

/** Gatilhos que nascem de uma ação do usuário (início, pedido, ajuste); os demais vêm da execução. */
const USER_TRIGGERS = new Set(['start', 'user_request', 'adjust_requested'])

/** 'step' = um passo aprovado de missão dinâmica. */
type Stage = 'planning' | 'pre-dev' | 'developing' | 'post-dev' | 'reviewing' | 'step'
const STAGE_ROLE = { planning: 'planner', 'pre-dev': 'specialist', developing: 'dev', 'post-dev': 'specialist', reviewing: 'qa', step: 'step' } as const
/** Uma execução delegada: o id liga delegação, contexto entregue, CLI e resultado. */
interface Trace {
  id: string
  stage: Stage
}
type GitRef = Pick<GitStatus, 'branch' | 'lastCommit'>
const gitRef = (status: GitStatus): GitRef => ({ branch: status.branch, lastCommit: status.lastCommit ?? null })

export interface TeamOptions {
  tasks: TaskStore
  history: HistoryStore
  projects: ProjectStore
  registry: AgentRegistry
  git: GitService
  launch: AgentLauncher
  configs?: AgentConfigStore
  specializations?: SpecializationRegistry
  memory?: MemoryStore
  skills?: SkillStore
  /** Sem trilha de eventos, as missões rodam igual e nada é registrado. */
  events?: EventStore
  /** Sem ele só existe o fluxo clássico: missões dinâmicas não podem ser iniciadas. */
  plans?: PlanStore
  stepTimeoutMs?: number
}

/**
 * No Antigravity o esforço já vem no nome do modelo (…-low/-medium/-high) e o CLI
 * recusa um --effort divergente; os valores aceitos são low|medium|high|xhigh|max.
 */
export function agyEffortArgs(model: string, effort: string): string[] {
  if (!effort || effort === 'default' || /-(low|medium|high)$/.test(model)) return []
  return ['--effort', effort === 'extra-high' ? 'xhigh' : effort]
}

/** Prepara parâmetros dinâmicos de execução conforme provedor, modelo e esforço configurados. */
export function getStepCliAndArgs(
  role: 'planning' | 'developing' | 'reviewing' | 'analyzing',
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
    // --skip-trust: a pasta do projeto já foi autorizada pelo usuário e o modo headless não consegue perguntar.
    args = ['--skip-trust', '--approval-mode', role === 'developing' ? 'auto_edit' : 'default']
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
    args.push(...agyEffortArgs(model, effort))
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
  /** Estado do Git conferido (limpo) antes de a etapa começar. */
  git?: GitRef
}

/** Etapa sem permissão de escrita alterou arquivos (detectado pelo backend). */
class UnauthorizedWriteError extends Error {}

/** Opções de CLI que dão permissão de escrita (montadas por getStepCliAndArgs, nunca pelo modelo). */
const WRITE_ARGS = new Set(['workspace-write', 'auto_edit', 'accept-edits'])
const errorText = (error: unknown) => redact(error instanceof Error ? error.message : String(error))

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
  /** Missões paradas por escrita sem permissão: não escalam para o Tech Lead. */
  private readonly securityStops = new Set<number>()
  private readonly launch: AgentLauncher
  private readonly configs?: AgentConfigStore
  private readonly memory?: MemoryStore
  private readonly skills?: SkillStore
  private readonly events?: EventStore
  private readonly plans?: PlanStore
  private readonly specializations: SpecializationRegistry
  private readonly stepTimeoutMs: number
  private running: Running | null = null
  /** Última decisão de retomada aplicada por missão: o reenvio do mesmo opId não executa de novo. */
  private readonly resumeOps = new Map<number, string>()
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
    this.memory = options.memory
    this.skills = options.skills
    this.events = options.events
    this.plans = options.plans
    this.specializations = options.specializations ?? defaultSpecializations
    this.stepTimeoutMs = options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
  }

  /** Na inicialização: fecha missões que morreram com o app e restaura a espera por aprovação. */
  recover() {
    for (const mission of this.tasks.failInterrupted()) {
      if (this.tasks.get(mission.taskId)) this.tasks.setStatus(mission.taskId, 'todo')
      this.log(mission, 'error', `Missão #${mission.id} interrompida: o app foi fechado durante a execução.`)
      this.track(mission, 'mission.failed', 'observed', 'Missão interrompida: o app foi fechado durante a execução.', {
        state: 'failed',
        key: 'interrupted',
        data: { reason: 'interrupted' },
      })
    }
    // Missões dinâmicas não falham no reinício: param para decisão humana e nenhum CLI é relançado.
    for (const step of this.plans?.interruptRunning() ?? []) {
      const owner = this.tasks.getMission(step.missionId)
      if (!owner) continue
      this.track(owner, 'step.interrupted', 'observed', `Passo "${step.key}" (${step.mode}) interrompido pelo fechamento do app; não será relançado sozinho.`, {
        agentId: step.agentId,
        trace: step.correlationId ? { id: step.correlationId, stage: 'step' } : undefined,
        state: 'failed',
        key: String(step.id),
        data: { actor: 'backend', stepId: step.id, key: step.key, revision: step.revision, attempt: step.attempt ?? 1, mode: step.mode, mayHaveWrittenFiles: step.mode === 'implement' },
      })
    }
    for (const m of this.tasks.openMissions()) {
      if (m.mode !== 'dynamic' || recoveredPhase(m.phase) === m.phase) continue
      const parked = this.tasks.updateMission(m.id, { phase: 'awaiting_decision', error: 'Interrompida: o app foi fechado durante a execução.' })
      this.log(parked, 'error', `Missão #${m.id} interrompida pelo fechamento do app: aguardando a sua decisão.`)
      this.track(parked, 'mission.blocked', 'observed', 'Missão interrompida: o app foi fechado durante a execução.', {
        state: 'failed',
        key: 'interrupted',
        data: { actor: 'backend', reason: 'interrupted', phase: m.phase },
      })
    }
    for (const m of this.tasks.openMissions()) {
      if (m.phase === 'awaiting_approval') {
        this.registry.setMissionState(m.plannerId || 'architect', 'approval', 'Plano pronto: aguardando sua aprovação')
      }
      if (m.phase === 'awaiting_clarification') {
        this.registry.setMissionState(m.plannerId || 'architect', 'approval', `Missão #${m.id}: aguardando a sua resposta`)
      }
      if (m.phase === 'awaiting_decision') {
        this.registry.setMissionState(m.plannerId || 'architect', 'approval', `Missão #${m.id}: aguardando a sua decisão`)
      }
    }
  }

  /** Etapa 1: o planejador (padrão: 'architect') planeja. Devolve a missão criada. */
  /**
   * `onCreated` (só modo dinâmico): chamado na criação da missão, antes de qualquer evento ou CLI dela.
   * O chat usa para vincular a conversa de origem; um erro nele não impede a missão.
   */
  async start(taskId: number, team?: Partial<MissionTeamSelection>, options?: { mode?: MissionMode; limits?: unknown; onCreated?: (mission: MissionInfo) => void }): Promise<MissionInfo> {
    // O modo é escolhido aqui e nunca muda durante a missão.
    if (options?.mode === 'dynamic') return this.startDynamic(taskId, team, options.limits, options.onCreated)
    this.assertTeamFree()
    const { task, cwd } = this.context(taskId)
    const { plannerId, devId, qaId, specialists, teamSnapshot } = this.validateAndBuildTeam(team)
    this.preparing = true
    let git: GitRef
    try {
      git = gitRef(await this.requireCleanRepo(cwd))
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
      specialists,
      teamSnapshot,
    })
    this.running = { missionId: mission.id, cancelled: false }
    this.tasks.setStatus(task.id, 'doing')
    const teamDesc = specialists.length > 0
      ? `${plannerId} → [${specialists.map(s => `${s.agentId}:${s.role}`).join(', ')}] → ${devId} → ${qaId}`
      : `${plannerId} → ${devId} → ${qaId}`
    this.log(mission, 'mission', `Missão #${mission.id} iniciada: "${task.title}" (${teamDesc})`)
    this.events?.prune(mission.projectId)
    this.track(mission, 'mission.started', 'observed', `Missão #${mission.id} iniciada pelo usuário: "${task.title}"`, {
      state: 'started',
      key: '',
      data: { actor: 'user', plannerId, devId, qaId, specialists: specialists.map((s) => ({ agentId: s.agentId, role: s.role, timing: s.timing })), git: { ...git, clean: true } },
    })
    for (const snap of Object.values(teamSnapshot)) {
      const slot = snap.agentId === plannerId ? 'planner' : snap.agentId === devId ? 'dev' : snap.agentId === qaId ? 'qa' : 'specialist'
      this.track(mission, 'agent.selected', 'observed', `${snap.name} selecionado como ${slot} (${snap.provider} · ${snap.model})`, {
        agentId: snap.agentId,
        key: snap.agentId,
        data: { slot, provider: snap.provider, model: snap.model, reasoningEffort: snap.reasoningEffort, specializationId: snap.specializationId, ref: `missions.teamSnapshot.${snap.agentId}` },
      })
      if (snap.skills) {
        this.track(mission, 'skills.configured', 'observed', `${snap.skills.filter((s) => s.state === 'configured').length} skill(s) configurada(s) para ${snap.name} (versões congeladas)`, {
          agentId: snap.agentId,
          key: snap.agentId,
          data: {
            skills: snap.skills.map((s) => ({ id: s.id, version: s.version, hash: s.hash.slice(0, 16), mode: s.mode, state: s.state, individual: s.individual ?? false })),
            ref: `missions.teamSnapshot.${snap.agentId}.skills`,
          },
        })
      }
    }
    const allParticipantIds = new Set([...TEAM, plannerId, devId, qaId, ...specialists.map(s => s.agentId)])
    for (const id of allParticipantIds) this.registry.setMissionState(id, null)
    this.registry.setMissionState(plannerId, 'planning', `Planejando a missão #${mission.id}`)
    void this.runPlanning(mission.id, task, cwd)
    return mission
  }

  /** Etapa 2: o usuário aprovou o plano; o Dev implementa e depois o QA revisa. */
  async approve(missionId: number) {
    const mission = this.requireMission(missionId)
    // Uma missão dinâmica é decidida por proposta e revisão, nunca por esta aprovação do fluxo clássico.
    if (mission.mode === 'dynamic' || mission.phase !== 'awaiting_approval' || this.running || this.preparing) {
      throw new Error('Esta missão não está aguardando aprovação.')
    }
    const { task, cwd } = this.context(mission.taskId)
    const [plannerId, devId, qaId, specialists] = this.missionTeam(mission)
    this.assertAgentsAvailable([plannerId, devId, qaId, ...specialists.map((s) => s.agentId)])
    this.preparing = true
    let git: GitRef
    try {
      git = gitRef(await this.requireCleanRepo(cwd))
    } finally {
      this.preparing = false
    }
    if (this.requireMission(missionId).phase !== 'awaiting_approval' || this.running) {
      throw new Error('Esta missão não está mais aguardando aprovação.')
    }

    // Muda a fase antes de qualquer espera: um segundo clique em "Aprovar" não dispara outra execução.
    this.tasks.updateMission(missionId, { phase: 'developing' })
    this.running = { missionId, cancelled: false, git }
    this.log(mission, 'mission', `Plano da missão #${missionId} aprovado pelo usuário.`)
    // O hash amarra a aprovação ao texto exato do plano aprovado.
    this.track(mission, 'approval.received', 'observed', `Plano da missão #${missionId} aprovado pelo usuário.`, {
      state: 'completed',
      key: '',
      data: { actor: 'user', ref: 'missions.plan', ...fingerprint(mission.plan) },
    })
    this.registry.setMissionState(plannerId, 'done', 'Plano aprovado')
    this.registry.setMissionState(devId, 'working', `Implementando a missão #${missionId}`)
    void this.runDevelopment(missionId, task, mission.plan, cwd)
  }

  /** O usuário respondeu à pergunta do planejador: o planejamento recomeça com a resposta. */
  async clarify(missionId: number, answer: string) {
    const mission = this.requireMission(missionId)
    if (mission.mode === 'dynamic') return this.clarifyDynamic(mission, answer)
    if (mission.phase !== 'awaiting_clarification' || this.running || this.preparing) {
      throw new Error('Esta missão não está aguardando esclarecimento.')
    }
    const text = redact(answer.trim()).slice(0, 5000)
    if (!text) throw new Error('Escreva a resposta antes de retomar a missão.')
    const { task, cwd } = this.context(mission.taskId)
    const [plannerId] = this.missionTeam(mission)
    this.assertAgentsAvailable([plannerId])

    const clarifications = [...(mission.clarifications ?? [])]
    const last = clarifications.at(-1)
    if (!last || last.answer !== null) throw new Error('Não há pergunta pendente nesta missão.')
    clarifications[clarifications.length - 1] = { ...last, answer: text, answeredAt: new Date().toISOString() }
    const resumed = this.tasks.updateMission(missionId, { phase: 'planning', clarifications })
    this.running = { missionId, cancelled: false }
    this.log(resumed, 'mission', `Usuário respondeu ao esclarecimento da missão #${missionId}: "${text.slice(0, 300)}"`)
    this.track(resumed, 'clarification.received', 'observed', `Usuário respondeu ao esclarecimento da missão #${missionId}.`, {
      state: 'completed',
      key: String(clarifications.length),
      data: { actor: 'user', round: clarifications.length, ref: `missions.clarifications[${clarifications.length - 1}].answer`, ...fingerprint(text) },
    })
    this.registry.setMissionState(plannerId, 'planning', `Planejando a missão #${missionId} com a sua resposta`)
    void this.runPlanning(missionId, task, cwd)
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
    // Proposta pendente e passos não concluídos deixam de valer: uma aprovação atrasada não executa nada.
    if (mission.mode === 'dynamic') this.plans?.closeMission(missionId)
    this.tasks.setStatus(mission.taskId, 'todo')
    this.log(
      mission,
      'mission',
      mission.phase === 'awaiting_clarification'
        ? `Missão #${missionId} cancelada pelo usuário sem responder ao esclarecimento.`
        : mission.phase === 'awaiting_approval'
        ? `Plano da missão #${missionId} rejeitado pelo usuário.`
        : `Missão #${missionId} cancelada pelo usuário.`,
    )
    this.track(mission, 'mission.cancelled', 'observed', `Missão #${missionId} cancelada pelo usuário (fase: ${mission.phase}).`, {
      state: 'cancelled',
      key: '',
      data: { actor: 'user', phase: mission.phase },
    })
    for (const id of new Set([...TEAM, ...this.missionParticipantIds(mission)])) {
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
    const trace = this.delegate(current, 'user', plannerId, 'planning', `Planejar a tarefa "${task.title}"`)
    const memory = this.memoryBlock(current, 'planning', plannerId, task, trace)
    if (memory === null) return
    const asked = current.clarifications ?? []
    const canAsk = asked.length < MAX_CLARIFICATION_ROUNDS
    const answers = asked.filter((c) => c.answer).map((c) => c.answer).join('\n')
    if (answers) this.forward(current, trace, 'user', plannerId, 'clarification-answers', 'missions.clarifications', answers)
    const prompt = planPrompt(
      task,
      {
        agentName: cfg?.name,
        specializationId: cfg?.specializationId ?? 'tech-lead',
        customInstructions: cfg?.customInstructions,
        registry: this.specializations,
        memory,
        skills: this.skillsBlock(missionId, plannerId, trace),
      },
      asked,
      canAsk,
    )
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
      trace,
    )
    if (plan === null) return
    const question = canAsk ? parseClarificationRequest(plan) : ''
    if (question) {
      // Falta informação essencial: a missão espera o usuário em vez de inventar requisitos.
      const waiting = this.tasks.updateMission(missionId, {
        phase: 'awaiting_clarification',
        clarifications: [...asked, { agentId: plannerId, question, answer: null, askedAt: new Date().toISOString(), answeredAt: null }],
      })
      this.running = null
      this.log(waiting, 'mission', `Missão #${missionId} aguardando esclarecimento do usuário: ${question}`, plannerId)
      this.track(waiting, 'clarification.requested', 'observed', `Missão #${missionId} pausada: o planejador pediu esclarecimento ao usuário.`, {
        agentId: plannerId,
        trace,
        key: '',
        data: { round: asked.length + 1, ref: `missions.clarifications[${asked.length}].question`, ...fingerprint(question) },
      })
      this.registry.setMissionState(plannerId, 'approval', `Missão #${missionId}: preciso de uma resposta sua para planejar`)
      return
    }
    const mission = this.tasks.updateMission(missionId, { phase: 'awaiting_approval', plan })
    this.memory?.proposeFromMission(mission)
    this.running = null
    this.log(mission, 'mission', `Plano da missão #${missionId} pronto. Aguardando aprovação do usuário.`, plannerId)
    this.declared(mission, trace, plannerId, 'plan', 'missions.plan', plan)
    this.track(mission, 'approval.requested', 'observed', `Missão #${missionId} pausada: aguardando a aprovação humana do plano.`, {
      agentId: plannerId,
      trace,
      key: '',
      data: { ref: 'missions.plan', ...fingerprint(plan) },
    })
    this.registry.setMissionState(plannerId, 'approval', `Plano da missão #${missionId} pronto: aguardando sua aprovação`)
  }

  private async runDevelopment(missionId: number, task: TaskInfo, plan: string, cwd: string) {
    const run = this.running!
    const current = this.requireMission(missionId)
    const [plannerId, devId, qaId, specialists] = this.missionTeam(current)
    const devCfg = this.resolveMissionAgentConfig(current, devId, 'developer')
    const devConfig = getStepCliAndArgs('developing', devCfg)
    const qaCfg = this.resolveMissionAgentConfig(current, qaId, 'qa-tester')
    const qaConfig = getStepCliAndArgs('reviewing', qaCfg)
    const devLabel = devCfg?.name || devId
    const attempts: MissionAttempt[] = []
    const specialistResults: SpecialistResult[] = current.specialistResults ? [...current.specialistResults] : []
    let rework: ReworkContext | undefined

    // 1. Execução de Especialistas Pré-Desenvolvimento (se houver)
    const preDevSpecialists = specialists.filter((s) => s.timing === 'pre-dev')
    for (const spec of preDevSpecialists) {
      if (run.cancelled) return
      const sCfg = this.resolveMissionAgentConfig(current, spec.agentId, 'developer')
      const sStepConfig = getStepCliAndArgs('analyzing', sCfg)
      const sTrace = this.delegate(current, plannerId, spec.agentId, 'pre-dev', spec.expectedContribution || `Análise prévia de ${spec.role}`)
      const sMemory = this.memoryBlock(current, 'developing', spec.agentId, task, sTrace)
      if (sMemory === null) return
      this.forward(current, sTrace, plannerId, spec.agentId, 'plan', 'missions.plan', plan)

      this.registry.setMissionState(spec.agentId, 'working', `Análise técnica de ${spec.role} para missão #${missionId}`)
      const startedAt = new Date().toISOString()
      const sPrompt = specialistPreDevPrompt(task, plan, {
        role: spec.role,
        expectedContribution: spec.expectedContribution,
        agentName: sCfg?.name,
        specializationId: sCfg?.specializationId,
        customInstructions: sCfg?.customInstructions,
        registry: this.specializations,
        memory: sMemory,
        skills: this.skillsBlock(missionId, spec.agentId, sTrace),
      })

      const analysis = await this.step(
        missionId,
        spec.agentId,
        sStepConfig.cli,
        sStepConfig.args,
        cwd,
        sPrompt,
        sStepConfig.model,
        sStepConfig.effort,
        sStepConfig.passPromptAsArg,
        sTrace,
      )
      const finishedAt = new Date().toISOString()

      if (analysis === null) {
        specialistResults.push({
          agentId: spec.agentId,
          role: spec.role,
          timing: 'pre-dev',
          status: 'failed',
          summary: `Falha na análise técnica de ${spec.role}`,
          details: 'Execução falhou ou terminou sem resposta.',
          error: 'Análise falhou',
          startedAt,
          finishedAt,
        })
        this.tasks.updateMission(missionId, { specialistResults })
        return
      }

      const summaryLine = analysis.split('\n').find((l) => l.trim().length > 0)?.slice(0, 200) || `Análise de ${spec.role} concluída.`
      specialistResults.push({
        agentId: spec.agentId,
        role: spec.role,
        timing: 'pre-dev',
        status: 'completed',
        summary: summaryLine,
        details: analysis,
        startedAt,
        finishedAt,
      })
      this.tasks.updateMission(missionId, { specialistResults })
      this.declared(current, sTrace, spec.agentId, 'specialist-analysis', `missions.specialistResults[${specialistResults.length - 1}].details`, analysis)
      this.registry.setMissionState(spec.agentId, 'done', `Análise de ${spec.role} concluída`)
      this.log(current, 'agent', `Especialista ${sCfg?.name || spec.agentId} (${spec.role}) entregou análise prévia para o Dev.`, spec.agentId)
    }

    // Contexto acumulado de especialistas pré-dev para o Dev
    const preDevContext = asUntrusted(
      specialistResults
        .filter((r) => r.timing === 'pre-dev' && r.status === 'completed')
        .map((r) => `#### Especialista em ${r.role} (${r.agentId}):\n${r.details}`)
        .join('\n\n'),
    )
    let gitBefore: GitRef & { clean: boolean } = { branch: run.git?.branch ?? null, lastCommit: run.git?.lastCommit ?? null, clean: true }
    let previousFiles: string[] = []

    this.registry.setMissionState(devId, 'working', `Implementando a missão #${missionId}`)

    // Rodadas Dev -> QA: o QA devolve ao Dev o que reprovar, até MAX_ATTEMPTS.
    for (let attempt = 1; ; attempt++) {
      const devTrace = this.delegate(
        current,
        attempt === 1 ? plannerId : qaId,
        devId,
        'developing',
        attempt === 1 ? 'Implementar o plano aprovado' : `Corrigir os achados do QA (tentativa ${attempt}/${MAX_ATTEMPTS})`,
      )
      const devMemory = this.memoryBlock(current, 'developing', devId, task, devTrace)
      const qaMemory = devMemory === null ? null : this.memoryBlock(current, 'reviewing', qaId, task)
      if (devMemory === null || qaMemory === null) return
      // Guardado agora: os revisores pós-dev regravam o registro da etapa "reviewing".
      const qaMemoryRecord = this.requireMission(missionId).memoryContext?.reviewing
      this.forward(current, devTrace, plannerId, devId, 'plan', 'missions.plan', plan)
      specialistResults.forEach((r, i) => {
        if (r.timing === 'pre-dev' && r.status === 'completed') {
          this.forward(current, devTrace, r.agentId, devId, 'specialist-analysis', `missions.specialistResults[${i}].details`, r.details)
        }
      })
      if (rework) this.forward(current, devTrace, qaId, devId, 'qa-review', `missions.attempts[${attempt - 2}].review`, rework.review)
      const devPromptText = devPrompt(
        task,
        plan,
        {
          agentName: devCfg?.name,
          specializationId: devCfg?.specializationId ?? 'developer',
          customInstructions: devCfg?.customInstructions,
          registry: this.specializations,
          memory: devMemory,
          skills: this.skillsBlock(missionId, devId, devTrace),
        },
        rework,
        preDevContext || undefined,
      )
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
        devTrace,
      )
      if (report === null) return

      let changed: GitFile[]
      let gitAfter: GitStatus
      try {
        gitAfter = await this.git.status(cwd)
        changed = gitAfter.files
      } catch (error) {
        if (!run.cancelled) this.fail(missionId, devId, `Não foi possível ler o Git depois do Dev: ${errorText(error)}`)
        return
      }
      if (run.cancelled) return
      const files = changed.map((f) => f.path)
      const mission = this.tasks.updateMission(missionId, { phase: 'reviewing', devReport: report, files })
      this.declared(mission, devTrace, devId, 'dev-report', 'missions.devReport', report)
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

      let diff = await this.collectDiff(cwd, changed)
      this.track(
        mission,
        'files.changed',
        'observed',
        files.length ? `${files.length} arquivo(s) com alterações no Git depois da etapa de ${devLabel}.` : `Nenhuma alteração no Git depois da etapa de ${devLabel}.`,
        {
          agentId: devId,
          trace: devTrace,
          key: '',
          data: {
            attempt,
            before: gitBefore,
            after: gitRef(gitAfter),
            headChanged: gitBefore.lastCommit !== (gitAfter.lastCommit ?? null),
            filesTotal: changed.length,
            files: changed.slice(0, MAX_EVENT_FILES).map((f) => ({ path: f.path, code: f.code })),
            listTruncated: gitAfter.truncated || changed.length > MAX_EVENT_FILES,
            newInAttempt: files.filter((f) => !previousFiles.includes(f)).slice(0, MAX_EVENT_FILES),
            ref: 'missions.files',
            diff: { available: diff.length > 0, ...fingerprint(diff), how: 'git-diff, enquanto as alterações não forem commitadas' },
            // O repositório estava limpo antes do Dev; quem mexer nos arquivos durante a janela não é distinguível.
            attribution: 'mission-window',
          },
        },
      )
      this.track(mission, 'tests.executed', 'unavailable', 'O sistema não executou comandos de teste nesta etapa: não há resultado de teste verificado.', {
        agentId: devId,
        trace: devTrace,
        key: '',
        data: { executedBySystem: false },
      })
      gitBefore = { ...gitRef(gitAfter), clean: files.length === 0 }
      previousFiles = files

      // 2. Execução de Especialistas Pós-Desenvolvimento (Revisores especializados)
      const postDevSpecialists = specialists.filter((s) => s.timing === 'post-dev')
      for (const spec of postDevSpecialists) {
        if (run.cancelled) return
        const sCfg = this.resolveMissionAgentConfig(current, spec.agentId, 'qa-tester')
        const sStepConfig = getStepCliAndArgs('reviewing', sCfg)
        const sTrace = this.delegate(current, devId, spec.agentId, 'post-dev', spec.expectedContribution || `Revisão especializada de ${spec.role}`)
        const sMemory = this.memoryBlock(current, 'reviewing', spec.agentId, task, sTrace)
        if (sMemory === null) return
        this.forward(current, sTrace, plannerId, spec.agentId, 'plan', 'missions.plan', plan)
        this.forward(current, sTrace, devId, spec.agentId, 'dev-report', 'missions.devReport', report)
        this.forward(current, sTrace, 'system', spec.agentId, 'git-diff', 'git-diff', diff)

        this.registry.setMissionState(spec.agentId, 'reviewing', `Revisão técnica de ${spec.role} para missão #${missionId}`)
        const startedAt = new Date().toISOString()
        const sPrompt = specialistPostDevPrompt(task, plan, report, files, diff, {
          role: spec.role,
          expectedContribution: spec.expectedContribution,
          agentName: sCfg?.name,
          specializationId: sCfg?.specializationId,
          customInstructions: sCfg?.customInstructions,
          registry: this.specializations,
          memory: sMemory,
          skills: this.skillsBlock(missionId, spec.agentId, sTrace),
        })

        const reviewAnalysis = await this.step(
          missionId,
          spec.agentId,
          sStepConfig.cli,
          sStepConfig.args,
          cwd,
          sPrompt,
          sStepConfig.model,
          sStepConfig.effort,
          sStepConfig.passPromptAsArg,
          sTrace,
        )
        const finishedAt = new Date().toISOString()

        if (reviewAnalysis === null) {
          specialistResults.push({
            agentId: spec.agentId,
            role: spec.role,
            timing: 'post-dev',
            status: 'failed',
            summary: `Falha na revisão técnica de ${spec.role}`,
            details: 'Execução falhou ou terminou sem resposta.',
            error: 'Revisão falhou',
            startedAt,
            finishedAt,
          })
          this.tasks.updateMission(missionId, { specialistResults })
          return
        }

        const summaryLine = reviewAnalysis.split('\n').find((l) => l.trim().length > 0)?.slice(0, 200) || `Revisão de ${spec.role} concluída.`
        specialistResults.push({
          agentId: spec.agentId,
          role: spec.role,
          timing: 'post-dev',
          status: 'completed',
          summary: summaryLine,
          details: reviewAnalysis,
          startedAt,
          finishedAt,
        })
        this.tasks.updateMission(missionId, { specialistResults })
        this.declared(current, sTrace, spec.agentId, 'specialist-review', `missions.specialistResults[${specialistResults.length - 1}].details`, reviewAnalysis)
        this.registry.setMissionState(spec.agentId, 'done', `Revisão de ${spec.role} concluída`)
        this.log(current, 'agent', `Especialista ${sCfg?.name || spec.agentId} (${spec.role}) entregou revisão especializada para o QA.`, spec.agentId)
      }

      // Contexto acumulado de pareceres pós-dev para o QA
      const postDevContext = asUntrusted(
        specialistResults
          .filter((r) => r.timing === 'post-dev' && r.status === 'completed')
          .map((r) => `#### Parecer do Revisor Especializado em ${r.role} (${r.agentId}):\n${r.details}`)
          .join('\n\n'),
      )
      const qaTrace = this.delegate(current, devId, qaId, 'reviewing', `Revisar a implementação (tentativa ${attempt}/${MAX_ATTEMPTS})`)
      this.trackMemory(current, qaTrace, qaId, qaMemoryRecord)

      this.registry.setMissionState(qaId, 'reviewing', `Revisando a missão #${missionId} (tentativa ${attempt}/${MAX_ATTEMPTS})`)

      const qaOpts = {
        agentName: qaCfg?.name,
        specializationId: qaCfg?.specializationId ?? ('qa-tester' as const),
        customInstructions: qaCfg?.customInstructions,
        registry: this.specializations,
        memory: qaMemory,
        skills: this.skillsBlock(missionId, qaId, qaTrace),
      }
      // shortcut: na linha de comando o parecer anterior vai só com o começo (onde ficam os achados); sem limite quando o agy aceitar prompt por stdin.
      const qaRework = rework && qaConfig.passPromptAsArg ? { ...rework, review: rework.review.slice(0, 8000) } : rework
      if (qaConfig.passPromptAsArg) {
        // O prompt vai na linha de comando: o diff cede espaço (o QA ainda lê os arquivos).
        const room = MAX_ARG_PROMPT - reviewPrompt(task, plan, report, files, '', qaOpts, qaRework, postDevContext || undefined).length
        if (diff.length > room) diff = `${diff.slice(0, Math.max(0, room))}
… diferenças cortadas: leia os arquivos …`
      }
      this.forward(current, qaTrace, plannerId, qaId, 'plan', 'missions.plan', plan)
      this.forward(current, qaTrace, devId, qaId, 'dev-report', 'missions.devReport', report)
      this.forward(current, qaTrace, 'system', qaId, 'git-diff', 'git-diff', diff)
      specialistResults.forEach((r, i) => {
        if (r.timing === 'post-dev' && r.status === 'completed') {
          this.forward(current, qaTrace, r.agentId, qaId, 'specialist-review', `missions.specialistResults[${i}].details`, r.details)
        }
      })
      if (qaRework) this.forward(current, qaTrace, qaId, qaId, 'qa-review', `missions.attempts[${attempt - 2}].review`, qaRework.review)
      const review = await this.step(
        missionId,
        qaId,
        qaConfig.cli,
        qaConfig.args,
        cwd,
        reviewPrompt(task, plan, report, files, diff, qaOpts, qaRework, postDevContext || undefined),
        qaConfig.model,
        qaConfig.effort,
        qaConfig.passPromptAsArg,
        qaTrace,
      )
      if (review === null) return

      const verdictDetail = parseDetailedVerdict(review)
      const verdict = parseVerdict(review)
      attempts.push({ attempt, devReport: report, files, review, verdictDetail })
      const reviewed = this.tasks.updateMission(missionId, { review, verdict, verdictDetail, attempts })
      this.memory?.proposeFromMission(reviewed)
      const label = verdictDetail ?? 'sem veredito claro'
      this.log(reviewed, 'review', `Revisão do QA na missão #${missionId} (tentativa ${attempt}/${MAX_ATTEMPTS}): ${label}.`, qaId)
      this.declared(reviewed, qaTrace, qaId, 'qa-review', 'missions.review', review)
      this.track(reviewed, 'verdict.declared', 'declared', `Veredito declarado pelo QA (tentativa ${attempt}/${MAX_ATTEMPTS}): ${label}.`, {
        agentId: qaId,
        trace: qaTrace,
        key: '',
        data: { attempt, verdict, verdictDetail, ref: 'missions.review' },
      })

      if (verdict === 'approved') {
        const done = this.tasks.updateMission(missionId, { phase: 'done' })
        this.running = null
        this.tasks.setStatus(task.id, 'review')
        this.log(done, 'mission', `Missão #${missionId} concluída. Revise as alterações e faça o commit no painel Alterações.`)
        this.track(done, 'mission.completed', 'observed', `Missão #${missionId} encerrada como concluída com base no veredito declarado pelo QA.`, {
          state: 'completed',
          key: '',
          data: { basedOn: 'verdict.declared', verdictDetail, attempts: attempt },
        })
        this.registry.setMissionState(qaId, 'done', `Revisão: ${label}`)
        return
      }
      // Só REPROVADO é defeito que o Dev consegue corrigir; o resto precisa do usuário.
      if (verdictDetail !== 'REPROVADO') {
        this.fail(missionId, qaId, `O QA não aprovou a implementação (${label}) e o caso não é de retrabalho do Dev. Leia o parecer do QA na missão e decida como seguir.`)
        return
      }
      if (attempt >= MAX_ATTEMPTS) {
        this.fail(missionId, qaId, `O QA reprovou a implementação nas ${MAX_ATTEMPTS} tentativas. A missão não foi concluída: leia o último parecer do QA e ajuste a tarefa, o plano ou o código.`)
        return
      }

      rework = { attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS, review }
      const back = this.tasks.updateMission(missionId, { phase: 'developing' })
      this.log(back, 'mission', `QA reprovou: missão #${missionId} devolvida a ${devLabel} com o parecer (tentativa ${attempt + 1}/${MAX_ATTEMPTS}).`, qaId)
      this.registry.setMissionState(qaId, 'done', 'Reprovado: devolvido ao Dev')
      this.registry.setMissionState(devId, 'working', `Corrigindo a missão #${missionId} (tentativa ${attempt + 1}/${MAX_ATTEMPTS})`)
    }
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
    trace?: Trace,
  ) {
    const run = this.running
    if (!run || run.missionId !== missionId || run.cancelled) return null
    const mission = this.requireMission(missionId)
    const snapName = mission.teamSnapshot?.[agentId]?.name
    const name = snapName ?? this.registry.get(agentId)?.name ?? agentId
    const modelInfo = model && model !== 'default' ? `, modelo: ${model}` : ''
    const effortInfo = effort && effort !== 'default' ? `, esforço: ${effort}` : ''
    this.log(mission, 'agent', `${name} (${cli}${modelInfo}${effortInfo}) começou a trabalhar na missão #${missionId}.`, agentId)
    const stage = trace?.stage ?? 'developing'
    const role = STAGE_ROLE[stage]
    const stepEvent = (type: MissionEventType, state: MissionEventState, summary: string, data: Record<string, unknown> = {}) =>
      this.track(mission, type, 'observed', summary, { agentId, trace, key: '', state, data: { stage, ...data } })
    stepEvent(`${role}.started`, 'started', `${name} iniciou a etapa ${stage} da missão #${missionId}.`)
    const startedAt = Date.now()
    let launched = false
    let exited = false
    let launchFailure = `${name}: não foi possível iniciar o ${cli}.`
    // Permissão de escrita vem só do papel (args montados pelo backend). Sem ela, o backend confere
    // depois se algum arquivo mudou: a garantia não depende de o CLI obedecer ao prompt.
    const writes = args.some((a) => WRITE_ARGS.has(a))
    const before = writes ? null : await this.fileSnapshot(cwd)
    try {
      const fullPrompt = cli === 'agy' ? prompt + AGY_HEADLESS_NOTICE : prompt
      if (passPromptAsArg && fullPrompt.length > 30_000) {
        launchFailure = `${name}: o prompt desta etapa (${fullPrompt.length} caracteres) não cabe na linha de comando do ${cli}. Use outro provedor ou reduza a tarefa/plano.`
        throw new Error(launchFailure)
      }
      const stepArgs = passPromptAsArg ? [...args, fullPrompt] : args
      const stepInput = passPromptAsArg ? undefined : fullPrompt
      run.proc = this.launch(cli, stepArgs, {
        cwd,
        label: `missão #${missionId} · ${agentId} · ${cli}`,
        input: stepInput,
        timeoutMs: this.stepTimeoutMs,
      })
      launched = true
      // Nunca o prompt: só tamanho e hash. `args` são as opções do CLI, sem o texto do prompt.
      stepEvent('cli.started', 'started', `CLI ${cli} iniciado para ${name}.`, {
        cli,
        model,
        effort,
        args,
        promptVia: run.proc.promptVia ?? (passPromptAsArg ? 'argument' : 'stdin'),
        guarded: run.proc.guarded ?? false,
        prompt: fingerprint(fullPrompt),
        timeoutMs: this.stepTimeoutMs,
      })
      const result = await run.proc.done
      run.proc = undefined
      exited = true
      if (before && !run.cancelled) {
        const touched = await this.changedSince(cwd, before)
        if (touched.length) {
          this.track(mission, 'files.changed', 'observed', `${touched.length} arquivo(s) mudaram durante uma etapa sem permissão de escrita (${name}).`, {
            agentId,
            trace,
            key: '',
            state: 'failed',
            data: { stage, unauthorized: true, filesTotal: touched.length, files: touched.slice(0, MAX_EVENT_FILES), attribution: 'step-window' },
          })
          throw new UnauthorizedWriteError(
            `${name}: a etapa não tinha permissão de escrita, mas ${touched.length} arquivo(s) mudaram enquanto ela rodava (${listPaths(touched)}). ` +
              'Nada foi desfeito. Pode ter sido o CLI ou outro programa: confira as alterações antes de continuar.',
          )
        }
      }
      const ok = result.code === 0 && !result.timedOut
      stepEvent(
        'cli.finished',
        run.cancelled ? 'cancelled' : ok ? 'completed' : 'failed',
        run.cancelled ? `CLI ${cli} encerrado pelo cancelamento da missão.` : result.timedOut ? `CLI ${cli} encerrado por tempo esgotado.` : `CLI ${cli} terminou com código ${result.code}.`,
        { cli, exitCode: result.code, timedOut: result.timedOut, durationMs: Date.now() - startedAt, stdoutChars: result.stdout.length, stderrChars: result.stderr.length },
      )
      if (run.cancelled) {
        stepEvent(`${role}.finished`, 'cancelled', `${name}: etapa interrompida pelo cancelamento da missão.`)
        return null
      }
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
      if (!text && cli === 'agy' && AGY_COMMAND_DENIED.test(result.stderr)) {
        throw new Error(
          `${name}: o Antigravity CLI negou uma ferramenta de comando no modo headless e encerrou a etapa sem resposta. Tente de novo ou use outro provedor para este agente.`,
        )
      }
      if (!text) throw new Error(`${name}: o ${cli} terminou sem resposta.`)
      this.emit('output', missionId, text)
      this.log(mission, 'agent', `${name} (${cli}) terminou a sua etapa da missão #${missionId}.`, agentId)
      stepEvent(`${role}.finished`, 'completed', `${name} concluiu a etapa ${stage} da missão #${missionId}.`, { durationMs: Date.now() - startedAt })
      return text
    } catch (error) {
      run.proc = undefined
      const reason = exited ? errorText(error) : launched ? `${name}: não foi possível concluir a execução do ${cli}.` : launchFailure
      if (!exited) {
        stepEvent('cli.finished', run.cancelled ? 'cancelled' : 'failed', launched ? `CLI ${cli} falhou durante a execução.` : `CLI ${cli} não chegou a iniciar.`, { cli, launched, error: reason })
      }
      stepEvent(`${role}.finished`, run.cancelled ? 'cancelled' : 'failed', run.cancelled ? `${name}: etapa interrompida pelo cancelamento da missão.` : reason)
      if (!run.cancelled) {
        // Sinal de segurança: para para o usuário, sem consultar outro agente nem seguir o plano.
        if (error instanceof UnauthorizedWriteError && mission.mode === 'dynamic') {
          this.securityStops.add(missionId)
          this.block(missionId, reason, 'unauthorized_write', agentId, trace)
        } else this.fail(missionId, agentId, reason, trace)
      }
      return null
    }
  }

  /** Impressão dos arquivos com alterações no Git agora (null = sem Git: não há como conferir). */
  private async fileSnapshot(cwd: string): Promise<Record<string, string> | null> {
    try {
      const status = await this.git.status(cwd)
      return contentHashes(cwd, status.files.map((f) => f.path))
    } catch {
      return null
    }
  }

  /** Arquivos que entraram, saíram ou mudaram de conteúdo desde a impressão. */
  private async changedSince(cwd: string, before: Record<string, string>): Promise<string[]> {
    const after = await this.fileSnapshot(cwd)
    if (!after) return []
    const paths = new Set([...Object.keys(before), ...Object.keys(after)])
    return [...paths].filter((p) => before[p] !== after[p]).sort()
  }

  private fail(missionId: number, agentId: string, message: string, trace?: Trace) {
    // No modo dinâmico uma falha não encerra a missão: ela para e espera o usuário.
    if (this.requireMission(missionId).mode === 'dynamic') return this.block(missionId, message, 'failure', agentId, trace)
    const phase = this.requireMission(missionId).phase
    const mission = this.tasks.updateMission(missionId, { phase: 'failed', error: redact(message) })
    this.track(mission, 'mission.failed', 'observed', message.split('\n')[0], { agentId, trace, state: 'failed', data: { phase, ref: 'missions.error' } })
    this.running = null
    if (this.tasks.get(mission.taskId)) this.tasks.setStatus(mission.taskId, 'todo')
    this.log(mission, 'error', message, agentId)
    for (const id of new Set([...TEAM, ...this.missionParticipantIds(mission)])) {
      if (id !== agentId) this.registry.setMissionState(id, null)
    }
    this.registry.setMissionState(agentId, 'error', message.split('\n')[0])
  }

  /**
   * Memória aprovada que este agente recebe nesta etapa. Grava na missão o que foi
   * escolhido e descartado (auditoria). null = a missão falhou porque o contexto
   * obrigatório não coube.
   */
  private memoryBlock(mission: MissionInfo, stage: 'planning' | 'developing' | 'reviewing', agentId: string, task: TaskInfo, trace?: Trace, key: string = stage): string | null {
    if (!this.memory) return ''
    try {
      const { block, record } = buildMemoryContext({
        entries: this.memory.currentFor(mission.projectId, agentId),
        task,
        stage,
        pastMissions: this.tasks.finishedMissionsOfTask(task.id),
      })
      const all = this.requireMission(mission.id).memoryContext ?? {}
      this.tasks.updateMission(mission.id, { memoryContext: { ...all, [key]: { agentId, ...record } } })
      if (trace) this.trackMemory(mission, trace, agentId, record)
      return block
    } catch (error) {
      this.fail(mission.id, agentId, errorText(error), trace)
      return null
    }
  }

  /**
   * Skills que este agente recebe nesta execução, nas versões congeladas no início da
   * missão. Grava na missão o estado de cada uma (auditoria). Missões sem snapshot
   * de skills (anteriores à Etapa 8) seguem sem skills.
   */
  private skillsBlock(missionId: number, agentId: string, trace: Trace): string {
    const stage = trace.stage
    const mission = this.requireMission(missionId)
    const refs = mission.teamSnapshot?.[agentId]?.skills ?? []
    if (!this.skills || refs.length === 0) return ''
    const { block, result } = composeSkills(refs, (hash) => this.skills!.content(hash))
    const at = new Date().toISOString()
    const applications: SkillApplication[] = result.map((ref) => ({ ...ref, agentId, stage, at }))
    this.tasks.updateMission(missionId, { skillApplications: [...(mission.skillApplications ?? []), ...applications] })
    const first = (mission.skillApplications ?? []).length
    applications.forEach((a, i) => {
      const data = {
        skillId: a.id,
        version: a.version,
        hash: a.hash.slice(0, 16),
        mode: a.mode,
        individual: a.individual ?? false,
        stage,
        snapshotRef: `missions.teamSnapshot.${agentId}.skills`,
        ref: `missions.skillApplications[${first + i}]`,
      }
      if (a.state === 'failed' || a.state === 'incompatible') {
        this.log(mission, 'error', `Skill "${a.name}" não aplicada a ${agentId} (${stage}): ${a.reason}`, agentId)
        this.track(mission, 'skill.failed', 'observed', `Skill "${a.name}" não aplicada a ${agentId} (${stage}): ${a.reason}`, {
          agentId,
          trace,
          key: a.id,
          state: 'failed',
          data: { ...data, applyState: a.state, reason: a.reason },
        })
      } else if (a.state === 'applied') {
        // Prova só a entrega do texto ao CLI: não é instalação nativa nem garantia de uso pelo modelo.
        this.track(mission, 'skill.included', 'context', `Skill "${a.name}" (${a.version}) incluída no prompt de ${agentId} (${stage}).`, {
          agentId,
          trace,
          key: a.id,
          data: { ...data, nativeInstall: false, usedByModel: 'unverified' },
        })
      }
    })
    return block
  }

  // ---------- modo dinâmico ----------
  // Caminho separado do fluxo clássico. O Tech Lead só propõe; o que roda é o que o usuário aprovou
  // pela interface (decideProposal), um passo por vez, com as permissões que o backend define.

  private async startDynamic(taskId: number, team: Partial<MissionTeamSelection> | undefined, limitsInput: unknown, onCreated?: (mission: MissionInfo) => void): Promise<MissionInfo> {
    this.requirePlans()
    this.assertTeamFree()
    const { task, cwd } = this.context(taskId)
    const techLeadId = (team?.plannerId ?? 'architect').trim() || 'architect'
    const limits = resolveLimits(limitsInput ?? {})
    const lead = () => this.snapshotAgent({ agentId: techLeadId, expectedCategory: 'planning', defaultSpec: 'tech-lead', stageLabel: 'coordenação' })
    lead()
    this.preparing = true
    let git: GitRef
    try {
      git = gitRef(await this.requireCleanRepo(cwd))
    } finally {
      this.preparing = false
    }
    // O mundo pode ter mudado durante a consulta ao Git.
    this.assertTeamFree()
    this.context(taskId)
    const snapshot = lead()

    const mission = this.tasks.createMission(task.id, task.projectId, { mode: 'dynamic', limits, plannerId: techLeadId, teamSnapshot: { [techLeadId]: snapshot } })
    this.running = { missionId: mission.id, cancelled: false }
    try {
      onCreated?.(mission)
    } catch (error) {
      this.log(mission, 'error', `Missão #${mission.id}: falha ao registrar a origem (${errorText(error)}).`)
    }
    this.tasks.setStatus(task.id, 'doing')
    this.log(mission, 'mission', `Missão dinâmica #${mission.id} iniciada: "${task.title}" (Tech Lead: ${snapshot.name})`)
    this.events?.prune(mission.projectId)
    this.track(mission, 'mission.started', 'observed', `Missão dinâmica #${mission.id} iniciada pelo usuário: "${task.title}"`, {
      state: 'started',
      key: '',
      data: { actor: 'user', mode: 'dynamic', techLeadId, limits, git: { ...git, clean: true } },
    })
    this.trackJoin(mission, snapshot, 0, 'Tech Lead escolhido pelo usuário ao iniciar a missão.')
    for (const id of new Set([...TEAM, techLeadId])) this.registry.setMissionState(id, null)
    this.registry.setMissionState(techLeadId, 'planning', `Analisando a missão #${mission.id}`)
    void this.runTechLeadTurn(mission.id, { kind: 'start' })
    return mission
  }

  /**
   * Decisão humana sobre uma proposta. Só a interface chama isto: nenhum texto de CLI ou de agente chega aqui.
   * `applied: false` = a mesma decisão já tinha sido registrada (reenvio): nada é executado de novo.
   */
  decideProposal(input: { missionId: number; proposalId: number; revision: number; decision: ProposalDecision; feedback?: string; opId?: string }): {
    proposal: DynamicProposal
    applied: boolean
  } {
    const plans = this.requirePlans()
    const mission = this.requireMission(input.missionId)
    if (mission.mode !== 'dynamic') throw new Error('Esta missão usa o fluxo clássico: ela não tem propostas para decidir.')
    const proposal = plans.getProposal(input.proposalId)
    if (!proposal || proposal.missionId !== mission.id) throw new Error('Proposta não encontrada nesta missão.')
    // Reenvio do mesmo clique (reconexão, duplo clique): responde sem executar nada de novo.
    if (checkDecision(proposal, input.revision, input.decision) === 'duplicate') return { proposal, applied: false }
    if (this.running || this.preparing) throw new Error('Há uma execução em andamento nesta missão: aguarde para decidir.')

    // Aprovar exige que a proposta ainda valha agora: agentes ativos, CLIs disponíveis, equipe e limites.
    const joiners: AgentSnapshotEntry[] = []
    if (input.decision === 'approve' && checkDecision(proposal, input.revision, 'approve') === 'apply') {
      const ctx = this.planContext(mission)
      const problems = validateProposal(proposal, { ...ctx, trigger: proposal.trigger, proposals: ctx.proposals.filter((p) => p.id !== proposal.id) })
      if (problems.length) throw new Error(`Esta proposta não pode mais ser aprovada: ${problems.join(' ')}`)
      for (const change of proposal.teamChanges) {
        if (change.action === 'convene') joiners.push(this.snapshotAgent({ agentId: change.agentId, defaultSpec: 'developer', stageLabel: 'equipe da missão' }))
      }
    }
    const feedback = redact((input.feedback ?? '').trim()).slice(0, 5000)
    const result = plans.decide(input.proposalId, input.revision, input.decision, {
      feedback,
      // Na mesma transação da decisão: quem entra ganha o snapshot do momento da entrada; os demais não mudam.
      apply: () => {
        const teamSnapshot = { ...mission.teamSnapshot, ...Object.fromEntries(joiners.map((s) => [s.agentId, s])) }
        this.tasks.updateMission(mission.id, { teamSnapshot, error: null })
      },
    })
    if (!result.applied) return result

    const decided = result.proposal
    const after = this.requireMission(mission.id)
    const techLeadId = mission.plannerId || 'architect'
    const label = { approve: 'aprovou a', reject: 'rejeitou a', adjust: 'pediu ajustes na' }[input.decision]
    this.log(after, 'mission', `Usuário ${label} proposta (revisão ${decided.revision}) da missão #${mission.id}.`)
    this.track(after, 'approval.received', 'observed', `Decisão humana sobre a proposta da revisão ${decided.revision}: ${decided.status}.`, {
      state: 'completed',
      key: `proposal:${decided.id}`,
      data: {
        actor: 'user',
        decision: input.decision,
        proposalId: decided.id,
        revision: decided.revision,
        kind: decided.kind,
        opId: input.opId ?? null,
        hasFeedback: Boolean(feedback),
        ref: `mission_proposals[${decided.id}]`,
        ...fingerprint(JSON.stringify([decided.teamChanges, decided.steps])),
      },
    })

    if (input.decision === 'approve') {
      for (const change of decided.teamChanges) {
        const snap = joiners.find((s) => s.agentId === change.agentId)
        if (snap) this.trackJoin(after, snap, decided.revision, change.reason)
        else {
          // Sai da missão; cadastro, histórico e snapshot antigo ficam como estão.
          this.track(after, 'team.released', 'observed', `${change.agentId} deixou a equipe da missão #${mission.id}.`, {
            agentId: change.agentId,
            key: `${decided.revision}:${change.agentId}`,
            state: 'completed',
            data: { actor: 'backend', revision: decided.revision, proposalId: decided.id, reason: change.reason.slice(0, 300) },
          })
        }
        this.registry.setMissionState(change.agentId, null)
      }
      if (decided.steps.length) {
        this.track(after, 'plan.revised', 'observed', `Plano da missão #${mission.id} na revisão ${decided.revision}: ${decided.steps.length} passo(s) aprovado(s).`, {
          state: 'completed',
          key: String(decided.revision),
          data: { actor: 'backend', revision: decided.revision, proposalId: decided.id, steps: decided.steps.map((s) => ({ key: s.key, agentId: s.agentId, mode: s.mode, dependsOn: s.dependsOn })) },
        })
      }
    }

    if (after.phase === 'done') this.completeDynamic(after, 'approved-closure-proposal')
    else if (after.phase === 'executing') void this.runSteps(mission.id)
    else if (after.phase === 'planning') {
      // Ajuste pedido pelo usuário: um novo turno do Tech Lead, se ainda houver rodadas.
      const round = nextAdjustRound(plans.listProposals({ projectId: mission.projectId, missionId: mission.id }))
      const max = (mission.limits ?? DEFAULT_LIMITS).maxAdjustRounds
      if (round > max) {
        this.block(mission.id, `Limite de pedidos de ajuste atingido (${max}). Cancele a missão ou encerre.`, 'limit_reached')
      } else {
        this.running = { missionId: mission.id, cancelled: false }
        this.registry.setMissionState(techLeadId, 'planning', `Refazendo a proposta da missão #${mission.id}`)
        void this.runTechLeadTurn(mission.id, { kind: 'adjust_requested', detail: feedback || 'O usuário pediu ajustes sem detalhar.' }, 0, decided.trigger || 'adjust_requested')
      }
    } else {
      this.block(mission.id, 'Proposta rejeitada e não há passo aprovado para executar: a missão aguarda a sua decisão.', 'proposal_rejected')
    }
    return result
  }

  /** Para a interface: em quais revisões o usuário já rejeitou cada mudança de equipe desta proposta. */
  previouslyRejected(proposal: DynamicProposal): NonNullable<DynamicProposal['previouslyRejected']> {
    const all = this.plans?.listProposals({ projectId: proposal.projectId, missionId: proposal.missionId }) ?? []
    const earlier = all.filter((p) => p.revision < proposal.revision)
    return proposal.teamChanges
      .map((c) => ({ agentId: c.agentId, action: c.action, revisions: rejectedBefore(c, earlier).map((p) => p.revision) }))
      .filter((r) => r.revisions.length > 0)
  }

  /** O usuário confirma o encerramento de uma missão dinâmica parada. Nada encerra uma missão dinâmica sem isto ou sem uma proposta de encerramento aprovada. */
  closeMission(missionId: number) {
    const mission = this.requireMission(missionId)
    if (mission.mode !== 'dynamic') throw new Error('Esta missão usa o fluxo clássico.')
    if (mission.phase !== 'awaiting_decision' || this.running || this.preparing) throw new Error('Esta missão não está aguardando a sua decisão.')
    this.completeDynamic(this.tasks.updateMission(missionId, { phase: 'done', error: null }), 'human-confirmation')
  }

  private completeDynamic(mission: MissionInfo, basedOn: string) {
    this.requirePlans().closeMission(mission.id)
    this.running = null
    if (this.tasks.get(mission.taskId)) this.tasks.setStatus(mission.taskId, 'review')
    this.log(mission, 'mission', `Missão dinâmica #${mission.id} encerrada com a confirmação do usuário. Revise as alterações e faça o commit no painel Alterações.`)
    this.track(mission, 'mission.completed', 'observed', `Missão #${mission.id} encerrada com confirmação humana.`, {
      state: 'completed',
      key: '',
      data: { actor: 'user', basedOn, verdictDetail: mission.verdictDetail ?? null },
    })
    for (const id of new Set([...TEAM, ...this.missionParticipantIds(mission)])) this.registry.setMissionState(id, null)
  }

  /** Um turno do Tech Lead: ele propõe, o backend confere e a proposta válida fica pendente para o usuário. */
  private async runTechLeadTurn(missionId: number, trigger: ProposalTrigger, invalid = 0, cause: string = trigger.kind): Promise<void> {
    const run = this.running
    if (!run || run.missionId !== missionId) return
    const plans = this.requirePlans()
    try {
      const mission = this.requireMission(missionId)
      const { task, cwd } = this.context(mission.taskId)
      const ctx = this.planContext(mission)
      const techLeadId = ctx.techLeadId
      // Cada consulta conta, inclusive as respostas recusadas: o Tech Lead não ganha turnos extras errando.
      const turns = Math.max(mission.leadTurns ?? 0, ctx.proposals.length)
      if (turns >= ctx.limits.maxTechLeadTurns) {
        this.limitReached(mission, { limit: 'maxTechLeadTurns', value: turns, max: ctx.limits.maxTechLeadTurns }, 'turno do Tech Lead')
        return this.block(missionId, `Limite de propostas do Tech Lead atingido (${ctx.limits.maxTechLeadTurns}).`, 'limit_reached')
      }
      this.tasks.updateMission(missionId, { leadTurns: turns + 1 })
      const canAsk = (mission.clarifications ?? []).length < MAX_CLARIFICATION_ROUNDS
      const cfg = this.resolveMissionAgentConfig(mission, techLeadId, 'tech-lead')
      const cli = getStepCliAndArgs('planning', cfg)
      // Quem pediu o turno: o usuário só quando foi ação dele; gatilhos de execução vêm do sistema.
      const requester = USER_TRIGGERS.has(trigger.kind) ? 'user' : 'system'
      const trace = this.delegate(mission, requester, techLeadId, 'planning', `Propor o plano e a equipe (${trigger.kind})`, { trigger: trigger.kind })
      const memory = this.memoryBlock(mission, 'planning', techLeadId, task, trace)
      if (memory === null) return
      const prompt = proposalPrompt(
        task,
        { ...ctx, leadTurns: turns + 1 },
        trigger,
        {
          agentName: cfg?.name,
          specializationId: cfg?.specializationId ?? 'tech-lead',
          customInstructions: cfg?.customInstructions,
          registry: this.specializations,
          memory,
          skills: this.skillsBlock(missionId, techLeadId, trace),
        },
        { canAsk },
      )
      const text = await this.step(missionId, techLeadId, cli.cli, cli.args, cwd, prompt, cli.model, cli.effort, cli.passPromptAsArg, trace)
      if (text === null) return

      const answered = this.tasks.updateMission(missionId, { plan: text })
      // Sem proposta e com pergunta marcada: falta informação essencial, a missão espera o usuário.
      const question = canAsk && !text.includes(PROPOSAL_OPEN) ? parseClarificationRequest(text) : ''
      if (question) {
        const asked = answered.clarifications ?? []
        assertTransition(answered.phase, 'awaiting_clarification')
        const waiting = this.tasks.updateMission(missionId, {
          phase: 'awaiting_clarification',
          clarifications: [...asked, { agentId: techLeadId, question, answer: null, askedAt: new Date().toISOString(), answeredAt: null }],
        })
        this.running = null
        this.log(waiting, 'mission', `Missão #${missionId} aguardando esclarecimento do usuário: ${question}`, techLeadId)
        this.track(waiting, 'clarification.requested', 'observed', `Missão #${missionId} pausada: o Tech Lead pediu esclarecimento ao usuário.`, {
          agentId: techLeadId,
          trace,
          key: '',
          data: { round: asked.length + 1, trigger: cause, ref: `missions.clarifications[${asked.length}].question`, ...fingerprint(question) },
        })
        this.registry.setMissionState(techLeadId, 'approval', `Missão #${missionId}: preciso de uma resposta sua`)
        return
      }
      // O que o modelo propôs. Ainda não é decisão nem execução.
      this.track(answered, 'proposal.declared', 'declared', `${techLeadId} respondeu com uma proposta (${text.length} caracteres); ainda não conferida nem aprovada.`, {
        agentId: techLeadId,
        trace,
        key: '',
        state: 'completed',
        data: { actor: 'model', ref: 'missions.plan', ...fingerprint(text) },
      })
      const reading = interpretProposal(text, { ...this.planContext(answered), trigger: cause })
      if (!reading.ok) {
        this.log(answered, 'error', `Proposta do Tech Lead recusada pelo backend (${reading.code}): ${reading.problems[0]}`, techLeadId)
        this.track(answered, 'proposal.invalid', 'observed', `Proposta recusada pelo backend (${reading.code}): nada dela foi aproveitado.`, {
          agentId: techLeadId,
          trace,
          key: '',
          state: 'failed',
          data: { actor: 'backend', code: reading.code, problems: reading.problems, attempt: invalid + 1 },
        })
        if (invalid < MAX_INVALID_PROPOSALS) return this.runTechLeadTurn(missionId, { kind: 'invalid_proposal', detail: reading.problems.join('\n') }, invalid + 1, cause)
        return this.block(missionId, `O Tech Lead não entregou uma proposta válida (${reading.code}): ${reading.problems.join(' ')}`, 'invalid_proposal', techLeadId, trace)
      }

      const previous = plans.listProposals({ projectId: mission.projectId, missionId })
      const proposal = plans.propose(missionId, techLeadId, reading.input, cause)
      this.running = null
      const pending = this.requireMission(missionId)
      if (proposal.kind === 'closure') {
        // Recomendação do modelo; a missão só termina se o usuário aprovar.
        this.track(pending, 'closure.recommended', 'declared', `${techLeadId} recomendou encerrar a missão #${missionId} (revisão ${proposal.revision}).`, {
          agentId: techLeadId,
          trace,
          key: `proposal:${proposal.id}`,
          data: { actor: 'model', proposalId: proposal.id, revision: proposal.revision, trigger: cause, completionCriteria: proposal.completionCriteria },
        })
      }
      this.log(pending, 'mission', `Proposta da missão #${missionId} (revisão ${proposal.revision}) pronta. Aguardando a sua decisão.`, techLeadId)
      this.track(pending, 'approval.requested', 'observed', `Missão #${missionId} pausada: proposta da revisão ${proposal.revision} aguarda decisão humana.`, {
        agentId: techLeadId,
        trace,
        key: `proposal:${proposal.id}`,
        data: {
          proposalId: proposal.id,
          revision: proposal.revision,
          kind: proposal.kind,
          trigger: cause,
          teamChanges: proposal.teamChanges.map((c) => ({ action: c.action, agentId: c.agentId })),
          steps: proposal.steps.length,
          // Mudanças de equipe que o usuário já rejeitou antes: a interface precisa mostrar isso.
          previouslyRejected: proposal.teamChanges.filter((c) => rejectedBefore(c, previous).length > 0).map((c) => c.agentId),
          ref: `mission_proposals[${proposal.id}]`,
          ...fingerprint(JSON.stringify([proposal.teamChanges, proposal.steps])),
        },
      })
      this.registry.setMissionState(techLeadId, 'approval', `Proposta da missão #${missionId} pronta: aguardando a sua decisão`)
    } catch (error) {
      if (!run.cancelled) this.block(missionId, errorText(error), 'error')
    }
  }

  /** Executa os passos aprovados, um por vez, enquanto houver um elegível. Qualquer impedimento pausa a missão. */
  private async runSteps(missionId: number): Promise<void> {
    const plans = this.requirePlans()
    const run: Running = { missionId, cancelled: false }
    this.running = run
    try {
      for (;;) {
        const mission = this.requireMission(missionId)
        const ctx = this.planContext(mission)
        const status = planStatus(ctx.steps)
        // A fila terminou: o Tech Lead recomenda o encerramento ou o que falta (com aprovação humana).
        if (status === 'empty') return this.escalate(missionId, { kind: 'queue_empty' }, { evidence: 'observed', source: 'backend' })
        if (status !== 'ready') {
          const broken = ctx.steps.findLast((s) => s.status === 'failed' || s.status === 'interrupted')
          return this.escalate(missionId, { kind: 'dependency_failed', step: broken }, { evidence: 'observed', source: 'backend' })
        }
        const next = nextStep(ctx.steps)!
        const blocker = stepBlocker(next, ctx)
        if (blocker) {
          if (blocker.reason === 'agent_unavailable') {
            return this.escalate(missionId, { kind: 'cli_unavailable', step: next }, { evidence: 'observed', source: 'backend' }, next.agentId)
          }
          if (blocker.reason === 'limit_reached') {
            const hit = checkLimits(ctx.limits, usageOf([...ctx.steps.filter((s) => s.startedAt !== null), next], ctx.proposals, ctx.techLeadId))[0]
            if (hit) this.limitReached(mission, hit, `antes do passo "${next.key}"`)
          }
          return this.block(missionId, `Passo "${next.key}": ${blocker.message}`, blocker.reason, next.agentId)
        }
        const { task, cwd } = this.context(mission.taskId)
        // Antes de qualquer escrita, só podem existir alterações que a própria missão registrou.
        // Nada é desfeito: o usuário decide (commit, desfazer, ou retomar aceitando as alterações).
        if (next.mode === 'implement') {
          const status = await this.git.status(cwd)
          if (run.cancelled) return
          const current = this.requireMission(missionId)
          const known = new Set(current.files)
          const unknown = status.files.map((f) => f.path).filter((path) => !known.has(path))
          if (unknown.length > 0) {
            return this.block(
              missionId,
              `O projeto tem alterações que a missão não registrou (${listPaths(unknown)}). Nada foi descartado: faça o commit, desfaça-as ou retome aceitando essas alterações.`,
              'dirty_repo',
              next.agentId,
            )
          }
          // O caminho já registrado não basta: um arquivo da missão editado por fora seria sobrescrito pela próxima escrita.
          const drifted = driftedFiles(cwd, current)
          if (drifted.length > 0) {
            return this.block(
              missionId,
              `O conteúdo mudou fora da missão (${listPaths(drifted)}) depois que ela registrou esses arquivos. Nada foi descartado: confira a edição e retome aceitando essas alterações, ou desfaça-as.`,
              'dirty_repo',
              next.agentId,
            )
          }
        }
        if (!(await this.runStep(run, mission, next, ctx, task, cwd, plans))) return
      }
    } catch (error) {
      if (!run.cancelled) this.block(missionId, errorText(error), 'error')
    }
  }

  /** Um passo aprovado, do início ao resultado. Devolve false quando a missão parou (falha, cancelamento ou veredito). */
  private async runStep(run: Running, mission: MissionInfo, step: PlannedStep, ctx: ProposalPromptContext, task: TaskInfo, cwd: string, plans: PlanStore): Promise<boolean> {
    const agentId = step.agentId
    const reviewing = step.mode === 'review' || step.mode === 'verify'
    const cfg = this.resolveMissionAgentConfig(mission, agentId, reviewing ? 'qa-tester' : 'developer')
    // O modo vira permissão aqui, pelo backend: só `implement` recebe sandbox de escrita.
    const cli = getStepCliAndArgs(MODE_STEP_ROLE[step.mode], cfg)
    const name = cfg?.name || agentId
    const trace = this.delegate(mission, ctx.techLeadId, agentId, 'step', step.objective, { stepId: step.id, key: step.key, revision: step.revision, mode: step.mode, proposalId: step.proposalId })
    // A partir daqui qualquer parada (block) marca este passo como falho.
    plans.startStep(step.id, trace.id)

    const memory = this.memoryBlock(mission, reviewing ? 'reviewing' : 'developing', agentId, task, trace, `step:${step.id}`)
    if (memory === null) return false

    // Só o que o passo declarou em `inputs` entra no prompt.
    const results: string[] = []
    let plan = ''
    let diff = ''
    for (const ref of step.inputs) {
      if (ref.kind === 'plan') {
        plan = approvedPlanText(ctx.proposals, ctx.steps)
        this.forward(mission, trace, ctx.techLeadId, agentId, 'plan', `mission_proposals[revisão ${step.revision}]`, plan)
      } else if (ref.kind === 'git-diff') {
        diff = await this.collectDiff(cwd, (await this.git.status(cwd)).files)
        if (run.cancelled) return false
        this.forward(mission, trace, 'system', agentId, 'git-diff', 'git-diff', diff)
      } else {
        const source = ctx.steps.find((s) => s.key === ref.key && s.revision === (ref.revision ?? step.revision) && s.status === 'completed')
        if (source?.status !== 'completed') {
          this.block(mission.id, `Passo "${step.key}": o resultado de "${ref.key}" não está disponível.`, 'dependency_failed', agentId, trace)
          return false
        }
        this.forward(mission, trace, source.agentId, agentId, `step-${source.id}-result`, `mission_steps[${source.id}].result`, source.result)
        results.push(`#### Resultado de ${source.agentId} no passo r${source.revision}/${source.key} (${source.mode}):\n${source.result}`)
      }
    }
    const prompt = delegatedStepPrompt(
      task,
      step,
      { plan, results: asUntrusted(results.join('\n\n')), diff },
      {
        agentName: cfg?.name,
        specializationId: cfg?.specializationId,
        customInstructions: cfg?.customInstructions,
        registry: this.specializations,
        memory,
        skills: this.skillsBlock(mission.id, agentId, trace),
      },
      cli.passPromptAsArg ? MAX_ARG_PROMPT : MAX_TEXT,
    )
    this.registry.setMissionState(agentId, reviewing ? 'reviewing' : 'working', `Passo "${step.key}" da missão #${mission.id}`)
    const text = await this.step(mission.id, agentId, cli.cli, cli.args, cwd, prompt, cli.model, cli.effort, cli.passPromptAsArg, trace)
    if (text === null) {
      if (run.cancelled || !OPEN_PHASES.includes(this.requireMission(mission.id).phase)) return false
      if (this.securityStops.delete(mission.id)) {
        if (plans.getStep(step.id)?.status === 'running') plans.finishStep(step.id, 'failed', { error: this.requireMission(mission.id).error ?? 'Escrita sem permissão.' })
        return false
      }
      if (plans.getStep(step.id)?.status === 'running') plans.finishStep(step.id, 'failed', { error: 'O passo terminou sem resposta.' })
      // A falha foi observada pelo backend; o passo não é repetido sozinho: o Tech Lead propõe e o usuário decide.
      const failed = plans.getStep(step.id)!
      const unavailable = LIMIT_PATTERN.test(failed.error ?? '') || /limite de uso|indispon[ií]vel|não encontrado no PATH/i.test(failed.error ?? '')
      this.escalate(mission.id, { kind: unavailable ? 'cli_unavailable' : 'step_failed', step: failed }, { evidence: 'observed', source: 'backend' }, agentId, trace)
      return false
    }

    if (step.mode === 'implement') {
      const gitAfter = await this.git.status(cwd)
      if (run.cancelled) return false
      const files = gitAfter.files.map((f) => f.path)
      // O conteúdo de agora vira a referência: uma edição de fora antes da próxima escrita é detectada.
      const changed = this.tasks.updateMission(mission.id, { devReport: text, files, fileHashes: contentHashes(cwd, files) })
      this.log(changed, 'files', files.length ? `Arquivos alterados por ${name}: ${files.join(', ')}` : `${name} não alterou nenhum arquivo.`, agentId)
      this.emit('git-change', { agentId, cwd, files, summary: `${name} concluiu o passo "${step.key}" — ${files.length} arquivo(s) com alterações.` })
      this.track(changed, 'files.changed', 'observed', `${files.length} arquivo(s) com alterações no Git depois do passo "${step.key}".`, {
        agentId,
        trace,
        key: '',
        data: {
          stepId: step.id,
          after: gitRef(gitAfter),
          filesTotal: files.length,
          files: gitAfter.files.slice(0, MAX_EVENT_FILES).map((f) => ({ path: f.path, code: f.code })),
          listTruncated: gitAfter.truncated || files.length > MAX_EVENT_FILES,
          ref: 'missions.files',
          attribution: 'mission-window',
        },
      })
      this.track(changed, 'tests.executed', 'unavailable', 'O sistema não executou comandos de teste neste passo: não há resultado de teste verificado.', {
        agentId,
        trace,
        key: '',
        data: { executedBySystem: false },
      })
    }
    plans.finishStep(step.id, 'completed', { result: text })
    // O texto do agente é resultado declarado: nada nele aprova, convoca ou muda regras.
    this.declared(mission, trace, agentId, `step-${step.id}-result`, `mission_steps[${step.id}].result`, text)
    this.registry.setMissionState(agentId, 'done', `Passo "${step.key}" entregue`)
    this.log(mission, 'agent', `${name} entregou o passo "${step.key}" (${step.mode}) da missão #${mission.id}.`, agentId)

    if (step.mode === 'verify') {
      const verdictDetail = parseDetailedVerdict(text)
      const verdict = parseVerdict(text)
      const reviewed = this.tasks.updateMission(mission.id, { review: text, verdict, verdictDetail })
      this.memory?.proposeFromMission(reviewed)
      const label = verdictDetail ?? 'sem veredito claro'
      this.track(reviewed, 'verdict.declared', 'declared', `Veredito declarado por ${agentId} no passo "${step.key}": ${label}.`, {
        agentId,
        trace,
        key: '',
        data: { stepId: step.id, verdict, verdictDetail, ref: `mission_steps[${step.id}].result` },
      })
      if (verdict !== 'approved') {
        // O veredito é declarado pelo agente: o retrabalho é proposto pelo Tech Lead e aprovado pelo usuário.
        this.escalate(mission.id, { kind: 'verdict_rejected', step: plans.getStep(step.id)! }, { evidence: 'declared', source: 'agent' }, agentId, trace)
        return false
      }
      return true
    }
    // Só a linha marcada (BLOQUEIO:/RISCO:) conta como pedido de replanejamento.
    const signal = parseStepSignals(text)
    const kind = signal.blocked ? 'step_blocked' : signal.risk ? 'risk_flagged' : null
    if (kind) {
      this.escalate(mission.id, { kind, step: plans.getStep(step.id)! }, { evidence: 'declared', source: 'agent' }, agentId, trace)
      return false
    }
    return true
  }

  /**
   * Missão dinâmica parada até uma decisão humana: falha, limite, veredito, fila vazia ou rejeição.
   * Nada é repetido nem relançado por conta própria.
   */
  private block(missionId: number, message: string, reason: string, agentId: string | null = null, trace?: Trace) {
    const before = this.requireMission(missionId)
    this.running = null
    if (!OPEN_PHASES.includes(before.phase)) return
    if (before.phase !== 'awaiting_decision') assertTransition(before.phase, 'awaiting_decision')
    const mission = this.tasks.updateMission(missionId, { phase: 'awaiting_decision', error: redact(message) })
    // Um passo que estava rodando quando a missão parou não fica pendurado como "em execução".
    for (const step of this.plans?.listSteps({ projectId: mission.projectId, missionId }) ?? []) {
      if (step.status === 'running') this.plans!.finishStep(step.id, 'failed', { error: message })
    }
    this.track(mission, 'mission.blocked', 'observed', message.split('\n')[0], {
      agentId: agentId ?? undefined,
      trace,
      state: reason === 'queue_empty' ? 'info' : 'failed',
      data: { actor: 'backend', reason, phase: before.phase, ref: 'missions.error' },
    })
    this.log(mission, reason === 'queue_empty' ? 'mission' : 'error', `Missão #${missionId} aguardando a sua decisão: ${message}`, agentId)
    const techLeadId = mission.plannerId || 'architect'
    for (const id of new Set([...TEAM, ...this.missionParticipantIds(mission)])) this.registry.setMissionState(id, null)
    this.registry.setMissionState(techLeadId, 'approval', `Missão #${missionId}: aguardando a sua decisão`)
  }

  /**
   * Um gatilho pede um novo turno do Tech Lead. O backend confere os limites antes: sem turno disponível,
   * a missão para com o limite registrado. O que o Tech Lead propuser ainda precisa de aprovação humana.
   */
  private escalate(
    missionId: number,
    trigger: ProposalTrigger,
    origin: { evidence: EvidenceKind; source: 'backend' | 'agent' | 'user' },
    agentId?: string,
    trace?: Trace,
  ) {
    this.running = null
    const mission = this.requireMission(missionId)
    if (!OPEN_PHASES.includes(mission.phase)) return
    const ctx = this.planContext(mission)
    const hit = replanLimit({ ...ctx, leadTurns: mission.leadTurns }, trigger.kind)
    const where = trigger.step ? ` (passo r${trigger.step.revision}/${trigger.step.key})` : ''
    if (hit) {
      this.limitReached(mission, hit, `ao pedir um novo turno do Tech Lead por ${trigger.kind}`)
      return this.block(
        missionId,
        `Limite da missão atingido (${hit.limit}: ${hit.value}/${hit.max}) depois de ${trigger.kind}${where}. O Tech Lead não será consultado de novo sem a sua decisão.`,
        'limit_reached',
        agentId ?? null,
        trace,
      )
    }
    if (mission.phase !== 'planning') {
      assertTransition(mission.phase, 'planning')
      this.tasks.updateMission(missionId, { phase: 'planning' })
    }
    const planning = this.requireMission(missionId)
    this.track(planning, 'replan.triggered', origin.evidence, `Novo turno do Tech Lead pedido por ${trigger.kind}${where}.`, {
      agentId,
      trace,
      state: 'started',
      key: trigger.step ? `${trigger.kind}:${trigger.step.id}` : undefined,
      data: {
        actor: origin.source,
        trigger: trigger.kind,
        stepId: trigger.step?.id ?? null,
        stepKey: trigger.step?.key ?? null,
        revision: trigger.step?.revision ?? null,
        attempt: trigger.step?.attempt ?? null,
        sourceCorrelationId: trigger.step?.correlationId ?? null,
        ...(trigger.detail ? { detail: fingerprint(trigger.detail) } : {}),
      },
    })
    this.log(planning, 'mission', `Missão #${missionId}: o Tech Lead será consultado de novo (${trigger.kind}${where}).`)
    this.running = { missionId, cancelled: false }
    for (const id of new Set([...TEAM, ...this.missionParticipantIds(planning)])) this.registry.setMissionState(id, null)
    this.registry.setMissionState(ctx.techLeadId, 'planning', `Replanejando a missão #${missionId}`)
    void this.runTechLeadTurn(missionId, trigger)
  }

  private limitReached(mission: MissionInfo, hit: LimitHit, context: string) {
    this.track(mission, 'limit.reached', 'observed', `Limite ${hit.limit} atingido (${hit.value}/${hit.max}) ${context}.`, {
      state: 'failed',
      data: { actor: 'backend', limit: hit.limit, value: hit.value, max: hit.max, context },
    })
  }

  /** Missão dinâmica: a resposta do usuário volta ao Tech Lead como um novo turno. */
  private clarifyDynamic(mission: MissionInfo, answer: string) {
    const clarifications = [...(mission.clarifications ?? [])]
    const last = clarifications.at(-1)
    if (!this.plans || mission.phase !== 'awaiting_clarification' || this.running || this.preparing || !last || last.answer !== null) {
      throw new Error('Esta missão não está aguardando esclarecimento.')
    }
    const text = redact(answer.trim()).slice(0, 5000)
    if (!text) throw new Error('Escreva a resposta antes de retomar a missão.')
    clarifications[clarifications.length - 1] = { ...last, answer: text, answeredAt: new Date().toISOString() }
    const resumed = this.tasks.updateMission(mission.id, { phase: 'planning', clarifications })
    this.track(resumed, 'clarification.received', 'observed', `Usuário respondeu ao esclarecimento da missão #${mission.id}.`, {
      state: 'completed',
      key: String(clarifications.length),
      data: { actor: 'user', round: clarifications.length, ref: `missions.clarifications[${clarifications.length - 1}].answer`, ...fingerprint(text) },
    })
    this.running = { missionId: mission.id, cancelled: false }
    this.registry.setMissionState(mission.plannerId || 'architect', 'planning', `Planejando a missão #${mission.id} com a sua resposta`)
    void this.runTechLeadTurn(mission.id, { kind: 'user_request', detail: `Resposta ao seu pedido de esclarecimento.\nPergunta: ${last.question}\nResposta: ${text}` })
  }

  /** Fotografia para decidir como seguir: passos parados, alterações no Git e ações possíveis. Não executa nada. */
  async recoveryState(projectId: number, missionId: number): Promise<RecoveryState> {
    const mission = this.requireMission(missionId)
    if (mission.projectId !== projectId) throw new Error('Missão não encontrada neste projeto.')
    if (mission.mode !== 'dynamic') throw new Error('Esta missão usa o fluxo clássico.')
    const ctx = this.planContext(mission)
    const status = planStatus(ctx.steps)
    const files: RecoveryState['files'] = { available: false, known: [], unknown: [] }
    try {
      const cwd = this.context(mission.taskId).cwd
      const git = await this.git.status(cwd)
      // Arquivo da missão com conteúdo editado por fora volta a ser uma alteração a decidir.
      const drifted = new Set(driftedFiles(cwd, mission))
      const known = new Set(mission.files.filter((p) => !drifted.has(p)))
      files.available = true
      for (const f of git.files) (known.has(f.path) ? files.known : files.unknown).push(f.path)
      for (const p of drifted) if (!files.unknown.includes(p)) files.unknown.push(p)
    } catch {
      // Sem Git legível o estado ainda é útil; a retomada volta a conferir antes de escrever.
    }
    const retryable = retryableSteps(ctx.steps)
    const waiting = mission.phase === 'awaiting_decision' && !this.running && !this.preparing
    const actions: RecoveryState['actions'] = !waiting
      ? OPEN_PHASES.includes(mission.phase) ? ['cancel'] : []
      : [
          ...(status === 'ready' || status === 'blocked' ? (['continue'] as const) : []),
          ...(retryable.length ? (['retry_step'] as const) : []),
          ...(replanLimit({ ...ctx, leadTurns: mission.leadTurns }, 'user_request') ? [] : (['replan'] as const)),
          'close',
          'cancel',
        ]
    const blocked = this.events?.list({ projectId, missionId }).findLast((e) => e.type === 'mission.blocked')
    return {
      projectId,
      missionId,
      phase: mission.phase,
      reason: typeof blocked?.data.reason === 'string' ? blocked.data.reason : null,
      error: mission.error,
      retryable,
      eligible: eligibleSteps(ctx.steps).map((s) => s.key),
      files,
      actions,
    }
  }

  /**
   * Decisão humana sobre uma missão dinâmica parada. Só a interface chama isto. O reenvio do mesmo opId
   * não executa de novo; nenhuma ação contorna as validações de passo, equipe, permissão e limites.
   */
  async resumeMission(input: { missionId: number; action: ResumeAction; stepId?: number; detail?: string; acceptChanges?: boolean; acceptFiles?: string[]; opId: string }): Promise<{ applied: boolean; message: string }> {
    const plans = this.requirePlans()
    const mission = this.requireMission(input.missionId)
    if (mission.mode !== 'dynamic') throw new Error('Esta missão usa o fluxo clássico.')
    if (this.resumeOps.get(mission.id) === input.opId) return { applied: false, message: 'Esta decisão já estava registrada: nada foi executado de novo.' }
    const waiting = () => {
      const current = this.requireMission(mission.id)
      if (current.phase !== 'awaiting_decision' || this.running || this.preparing) throw new Error('Esta missão não está aguardando a sua decisão.')
      return current
    }
    waiting()
    const target = input.stepId ? plans.getStep(input.stepId) : null
    if (input.action === 'retry_step' && (!target || target.missionId !== mission.id)) throw new Error('Passo não encontrado nesta missão.')

    let accepted: string[] = []
    const cwd = this.context(mission.taskId).cwd
    if (input.acceptChanges) {
      this.preparing = true
      try {
        const status = await this.git.status(cwd)
        const drifted = driftedFiles(cwd, mission)
        accepted = [...new Set([...status.files.map((f) => f.path).filter((path) => !mission.files.includes(path)), ...drifted])]
      } finally {
        this.preparing = false
      }
      // O aceite vale só para o que o usuário viu: algo que mudou depois da confirmação não entra calado.
      const shown = new Set(input.acceptFiles ?? [])
      const unseen = accepted.filter((p) => !shown.has(p))
      if (unseen.length) {
        throw new Error(`Há alterações que você não viu ao confirmar (${listPaths(unseen)}). Confira a lista atualizada e confirme de novo.`)
      }
    }
    // O mundo pode ter mudado durante a consulta ao Git.
    const current = waiting()
    const ctx = this.planContext(current)
    const resumed = (extra: Record<string, unknown> = {}) => {
      this.resumeOps.set(mission.id, input.opId)
      // O conteúdo aceito pelo usuário vira a nova referência dos arquivos aceitos.
      if (accepted.length) {
        this.tasks.updateMission(mission.id, {
          files: [...new Set([...current.files, ...accepted])],
          fileHashes: { ...current.fileHashes, ...contentHashes(cwd, accepted) },
        })
      }
      this.track(this.requireMission(mission.id), 'mission.resumed', 'observed', `Usuário decidiu seguir a missão #${mission.id}: ${input.action}.`, {
        state: 'info',
        data: { actor: 'user', action: input.action, opId: input.opId, acceptedFiles: accepted.slice(0, MAX_EVENT_FILES), acceptedTotal: accepted.length, ...extra },
      })
    }

    if (input.action === 'replan') {
      const interrupted = retryableSteps(ctx.steps).findLast((s) => s.status === 'interrupted')
      const overLimit = checkLimits(ctx.limits, usageOf(ctx.steps.filter((s) => s.startedAt !== null), ctx.proposals, ctx.techLeadId)).length > 0
      const kind = interrupted ? 'interrupted_execution' : overLimit ? 'limit_reached' : 'user_request'
      const detail = input.detail?.trim() ? redact(input.detail.trim()).slice(0, 2000) : kind === 'user_request' ? 'O usuário pediu um replanejamento.' : undefined
      resumed({ trigger: kind })
      this.escalate(mission.id, { kind, step: interrupted, detail }, { evidence: 'observed', source: 'user' })
      return { applied: true, message: 'O Tech Lead foi consultado: a nova proposta vai aguardar a sua decisão.' }
    }

    if (input.action === 'retry_step') {
      const { step, applied } = plans.retryStep(target!.id)
      if (!applied && step.status === 'completed') return { applied: false, message: 'Este passo já foi concluído em outra tentativa.' }
    }
    const steps = plans.listSteps({ projectId: mission.projectId, missionId: mission.id })
    const status = planStatus(steps)
    if (status === 'empty') throw new Error('Não há passo aprovado para continuar: peça um replanejamento, encerre ou cancele a missão.')
    resumed({ stepId: input.stepId ?? null })
    if (status === 'blocked') {
      this.escalate(mission.id, { kind: 'dependency_failed', step: steps.findLast((s) => s.status === 'failed' || s.status === 'interrupted') }, { evidence: 'observed', source: 'backend' })
      return { applied: true, message: 'Os passos restantes dependem de um passo que não terminou: o Tech Lead foi consultado.' }
    }
    assertTransition(current.phase, 'executing')
    this.tasks.updateMission(mission.id, { phase: 'executing', error: null })
    void this.runSteps(mission.id)
    return { applied: true, message: 'Execução retomada com os passos aprovados.' }
  }

  /** O que o coordenador precisa saber agora: cadastro (só quem pode executar conta como ativo), plano e limites. */
  private planContext(mission: MissionInfo): ProposalPromptContext {
    const query = { projectId: mission.projectId, missionId: mission.id }
    const known = this.configs
      ? this.configs.list({ includeInactive: true })
      : this.registry.list().map((a) => ({ agentId: a.id, name: a.name, role: a.role, roleCategory: a.roleCategory, active: true }))
    const ready = (id: string) => {
      const agent = this.registry.get(id)
      return Boolean(agent) && agent!.state !== 'offline' && agent!.auth !== 'missing'
    }
    const plans = this.requirePlans()
    return {
      techLeadId: mission.plannerId || 'architect',
      agents: known.map((a) => ({ agentId: a.agentId, name: a.name, role: a.role, roleCategory: a.roleCategory, active: a.active !== false && ready(a.agentId) })),
      steps: plans.listSteps(query),
      proposals: plans.listProposals(query),
      limits: mission.limits ?? DEFAULT_LIMITS,
    }
  }

  private trackJoin(mission: MissionInfo, snap: AgentSnapshotEntry, revision: number, reason: string) {
    this.track(mission, 'team.joined', 'observed', `${snap.name} entrou na equipe da missão #${mission.id} (${snap.provider} · ${snap.model}).`, {
      agentId: snap.agentId,
      key: `${revision}:${snap.agentId}`,
      state: 'completed',
      data: {
        actor: 'backend',
        revision,
        reason: reason.slice(0, 300),
        provider: snap.provider,
        model: snap.model,
        reasoningEffort: snap.reasoningEffort,
        specializationId: snap.specializationId,
        // Skills congeladas no momento da entrada.
        skills: (snap.skills ?? []).map((s) => ({ id: s.id, version: s.version, hash: s.hash.slice(0, 16), mode: s.mode, state: s.state })),
        ref: `missions.teamSnapshot.${snap.agentId}`,
      },
    })
  }

  private requirePlans(): PlanStore {
    if (!this.plans) throw new Error('O modo dinâmico não está disponível neste servidor.')
    return this.plans
  }

  // ---------- trilha de eventos ----------

  private track(
    mission: Pick<MissionInfo, 'id' | 'projectId' | 'taskId'>,
    type: MissionEventType,
    evidence: EvidenceKind,
    summary: string,
    extra: { agentId?: string; trace?: Trace; state?: MissionEventState; data?: Record<string, unknown>; key?: string } = {},
  ) {
    const scope = extra.trace ? `${extra.trace.id}:${type}` : type
    this.events?.record({
      projectId: mission.projectId,
      missionId: mission.id,
      taskId: mission.taskId,
      type,
      evidence,
      summary,
      agentId: extra.agentId,
      state: extra.state,
      data: extra.data,
      correlationId: extra.trace?.id,
      // `key` marca um fato único no seu escopo: registrar de novo não duplica.
      dedupeKey: extra.key === undefined ? undefined : `${scope}:${extra.key}`,
    })
  }

  /** Quem pediu, quem recebeu e com qual objetivo. Abre a execução que os demais eventos referenciam. */
  private delegate(mission: MissionInfo, from: string, to: string, stage: Stage, objective: string, extra: Record<string, unknown> = {}): Trace {
    const trace: Trace = { id: randomUUID(), stage }
    this.track(mission, 'task.delegated', 'observed', `${from} → ${to} (${stage}): ${objective}`.slice(0, 300), {
      agentId: to,
      trace,
      key: '',
      // O encadeamento é fixo e feito pelo orquestrador: `from` é a origem do pedido, não um CLI chamando outro.
      data: { ...extra, from, to, stage, objective: objective.slice(0, 300), orchestrated: true },
    })
    return trace
  }

  /** Um resultado de `from` entrou no prompt de `to`. Prova a entrega, não que foi seguido. */
  private forward(mission: MissionInfo, trace: Trace, from: string, to: string, artifact: string, ref: string, text: string) {
    if (!this.events) return
    const source = this.events
      .list({ projectId: mission.projectId, missionId: mission.id })
      .findLast((e) => e.evidence === 'declared' && e.agentId === from && e.data.artifact === artifact)
    this.track(mission, 'result.forwarded', 'context', `${artifact} de ${from} incluído no contexto de ${to}.`, {
      agentId: to,
      trace,
      key: `${artifact}:${from}:${ref}`,
      data: { from, to, artifact, ref, ...fingerprint(text), sourceCorrelationId: source?.correlationId ?? null, followed: 'unverified' },
    })
  }

  /** A resposta de um agente: fica na missão (ref); o evento guarda só tamanho e hash. */
  private declared(mission: MissionInfo, trace: Trace, agentId: string, artifact: string, ref: string, text: string) {
    this.track(mission, artifact === 'plan' ? 'plan.produced' : 'result.declared', 'declared', `${agentId} entregou ${artifact} (${text.length} caracteres); conteúdo não verificado de forma independente.`, {
      agentId,
      trace,
      key: '',
      state: 'completed',
      data: { artifact, ref, ...fingerprint(text) },
    })
    if (artifact !== 'plan' && TEST_MENTION.test(text)) {
      this.track(mission, 'tests.declared', 'declared', `${agentId} menciona execução de testes na resposta; o sistema não executou nem verificou esses testes.`, {
        agentId,
        trace,
        key: '',
        data: { ref, executedBySystem: false },
      })
    }
  }

  private trackMemory(mission: MissionInfo, trace: Trace, agentId: string, record?: MemoryContextRecord) {
    if (!record) return
    this.track(mission, 'memory.included', 'context', `${record.selected.length} memória(s) incluída(s) no contexto de ${agentId} (${trace.stage}).`, {
      agentId,
      trace,
      key: '',
      data: { chars: record.chars, selected: record.selected.slice(0, 40), dropped: record.dropped.length, ref: 'missions.memoryContext' },
    })
  }

  private missionTeam(mission: Pick<MissionInfo, 'plannerId' | 'devId' | 'qaId' | 'specialists'>): [string, string, string, MissionSpecialistSelection[]] {
    return [mission.plannerId || 'architect', mission.devId || 'dev', mission.qaId || 'qa', mission.specialists ?? []]
  }

  private missionParticipantIds(mission: Pick<MissionInfo, 'plannerId' | 'devId' | 'qaId' | 'specialists' | 'teamSnapshot'>): string[] {
    const [p, d, q, specs] = this.missionTeam(mission)
    // O snapshot traz também quem entrou durante uma missão dinâmica.
    return [p, d, q, ...specs.map((s) => s.agentId), ...Object.keys(mission.teamSnapshot ?? {})]
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
    specialists: MissionSpecialistSelection[]
    teamSnapshot: Record<string, AgentSnapshotEntry>
  } {
    const plannerId = (team?.plannerId ?? 'architect').trim() || 'architect'
    const devId = (team?.devId ?? 'dev').trim() || 'dev'
    const qaId = (team?.qaId ?? 'qa').trim() || 'qa'
    const rawSpecialists = team?.specialists ?? []

    if (rawSpecialists.length > MAX_MISSION_SPECIALISTS) {
      throw new Error(`Máximo de ${MAX_MISSION_SPECIALISTS} especialistas permitidos por missão.`)
    }

    const specialists: MissionSpecialistSelection[] = []
    const seenSpecialistAgents = new Set<string>()

    for (const spec of rawSpecialists) {
      const sId = spec.agentId.trim()
      if (!sId) continue
      if (sId === plannerId || sId === devId || sId === qaId) {
        throw new Error(`O agente "${sId}" já possui função principal na missão e não pode ser especialista adicional.`)
      }
      if (seenSpecialistAgents.has(sId)) {
        throw new Error(`O agente especialista "${sId}" não pode ser adicionado em duplicidade.`)
      }
      seenSpecialistAgents.add(sId)
      specialists.push({
        agentId: sId,
        role: spec.role || 'custom',
        timing: spec.timing === 'post-dev' ? 'post-dev' : 'pre-dev',
        expectedContribution: spec.expectedContribution ? redact(spec.expectedContribution.trim()) : undefined,
      })
    }

    const slots: {
      agentId: string
      expectedCategory?: 'planning' | 'developing' | 'reviewing' | 'teaching'
      defaultSpec: SpecializationId
      stageLabel: string
    }[] = [
      { agentId: plannerId, expectedCategory: 'planning', defaultSpec: 'tech-lead', stageLabel: 'planejamento' },
      { agentId: devId, expectedCategory: 'developing', defaultSpec: 'developer', stageLabel: 'desenvolvimento' },
      { agentId: qaId, expectedCategory: 'reviewing', defaultSpec: 'qa-tester', stageLabel: 'revisão QA' },
    ]

    for (const spec of specialists) {
      slots.push({
        agentId: spec.agentId,
        defaultSpec: spec.timing === 'post-dev' ? 'qa-tester' : 'developer',
        stageLabel: `especialista em ${spec.role}`,
      })
    }

    const teamSnapshot: Record<string, AgentSnapshotEntry> = {}

    for (const slot of slots) teamSnapshot[slot.agentId] = this.snapshotAgent(slot)

    return { plannerId, devId, qaId, specialists, teamSnapshot }
  }

  /**
   * Confere um agente (cadastro, categoria, provedor, CLI disponível) e devolve o snapshot dele agora,
   * com as skills resolvidas neste momento. Lança com a mensagem para o usuário se ele não puder participar.
   */
  private snapshotAgent(slot: { agentId: string; expectedCategory?: 'planning' | 'developing' | 'reviewing' | 'teaching'; defaultSpec: SpecializationId; stageLabel: string }): AgentSnapshotEntry {
    const cfg = this.configs?.find(slot.agentId)
    if (this.configs) {
      if (!cfg) {
        throw new Error(`Agente "${slot.agentId}" não encontrado no cadastro.`)
      }
      if (cfg.active === false) {
        throw new Error(`O agente "${cfg.name || slot.agentId}" está inativo e não pode participar de missões.`)
      }
      if (slot.expectedCategory && cfg.roleCategory && cfg.roleCategory !== slot.expectedCategory) {
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
    if (regAgent.auth === 'missing') {
      throw new Error(`${regAgent.name}: o CLI "${regAgent.cli}" está instalado mas não consegue executar (sem login ou conta sem acesso).`)
    }

    const fallbackProvider: ProviderId =
      regAgent.cli === 'agy' ? 'antigravity' : regAgent.cli === 'codex' ? 'codex' : 'gemini'

    return {
      agentId: slot.agentId,
      name: cfg?.name || regAgent.name || slot.agentId,
      role: cfg?.role || regAgent.role || '',
      provider: cfg?.provider ?? fallbackProvider,
      model: cfg?.model || 'default',
      reasoningEffort: cfg?.reasoningEffort ?? 'default',
      specializationId: cfg?.specializationId ?? slot.defaultSpec,
      customInstructions: cfg?.customInstructions ? redact(cfg.customInstructions) : '',
      ...(this.skills ? { skills: this.skills.resolveFor(slot.agentId) } : {}),
    }
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
    // O diff vai para outro agente: valores com cara de segredo não precisam ir junto.
    const safe = redact(out)
    return safe.length > MAX_DIFF ? `${safe.slice(0, MAX_DIFF)}\n… diferenças cortadas …` : safe
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
    return status
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
  if (LIMIT_PATTERN.test(`${result.stderr}\n${result.stdout}`)) {
    return `${name}: o ${cli} atingiu um limite de uso (cota ou excesso de requisições). Tente de novo mais tarde.`
  }
  return `${name}: o ${cli} terminou com código ${result.code}.`
}

const listPaths = (paths: string[]) => `${paths.slice(0, 10).join(', ')}${paths.length > 10 ? ` e mais ${paths.length - 10}` : ''}`

/** Impressão do conteúdo atual de cada arquivo do projeto. Arquivo removido ou ilegível recebe a marca 'missing'. */
export function contentHashes(cwd: string, paths: string[]): Record<string, string> {
  const root = path.resolve(cwd)
  const hashes: Record<string, string> = {}
  for (const p of paths) {
    const full = path.resolve(root, p)
    if (!full.startsWith(root + path.sep)) continue
    try {
      hashes[p] = createHash('sha256').update(readFileSync(full)).digest('hex')
    } catch {
      hashes[p] = 'missing'
    }
  }
  return hashes
}

/**
 * Arquivos que a missão registrou e cujo conteúdo mudou desde então. Arquivo registrado sem impressão
 * (missão gravada antes da proteção SHA-256) não pode ser conferido: entra na lista e só é
 * sobrescrito depois da confirmação do usuário, que grava a impressão atual.
 */
function driftedFiles(cwd: string, mission: Pick<MissionInfo, 'fileHashes' | 'files'>): string[] {
  const recorded = mission.fileHashes ?? {}
  const now = contentHashes(cwd, Object.keys(recorded))
  const changed = Object.keys(recorded).filter((p) => now[p] !== undefined && now[p] !== recorded[p])
  const unverifiable = (mission.files ?? []).filter((p) => !(p in recorded))
  return [...new Set([...changed, ...unverifiable])]
}
