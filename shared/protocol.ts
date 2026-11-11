// Contrato entre backend e frontend. Somente tipos: nada aqui vira código em runtime.

export type CliId = 'codex' | 'gemini' | 'agy'

export type ProviderId = 'codex' | 'gemini' | 'antigravity'
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'extra-high' | 'default'

export type SpecializationId = 'tech-lead' | 'developer' | 'qa-tester' | 'tutor'
export type RoleCategory = 'planning' | 'developing' | 'reviewing' | 'teaching'
export type KnowledgeDocKind = 'agent' | 'principios' | 'dossie' | 'referencias'
export type AvatarPreset =
  | 'architect'
  | 'dev'
  | 'qa'
  | 'tutor'
  | 'designer'
  | 'data'
  | 'security'
  | 'docs'
  | 'specialist'

export interface SpecializationInfo {
  id: SpecializationId
  name: string
  codename: string
  roleCategory: RoleCategory
  description: string
  defaultAgentId: string
  knowledgeDir: string | null
  availableDocs: KnowledgeDocKind[]
}

/** Limite máximo de especialistas opcionais além dos 3 obrigatórios (Arquiteto, Dev, QA). */
export const MAX_MISSION_SPECIALISTS = 3

export type SpecialistRole =
  | 'database'
  | 'security'
  | 'ui'
  | 'docs'
  | 'api'
  | 'testing'
  | 'data'
  | 'custom'

export type SpecialistTiming = 'pre-dev' | 'post-dev'

export interface MissionSpecialistSelection {
  agentId: string
  role: SpecialistRole
  timing: SpecialistTiming
  expectedContribution?: string
}

export interface MissionTeamSelection {
  plannerId: string
  devId: string
  qaId: string
  specialists?: MissionSpecialistSelection[]
}

export type SpecialistExecutionState =
  | 'pending'
  | 'waiting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'

export interface SpecialistResult {
  agentId: string
  role: SpecialistRole
  timing: SpecialistTiming
  status: SpecialistExecutionState
  summary: string
  details: string
  error?: string | null
  startedAt?: string
  finishedAt?: string
}

export interface AgentSnapshotEntry {
  agentId: string
  name: string
  role: string
  provider: ProviderId
  model: string
  reasoningEffort?: ReasoningEffort
  specializationId: SpecializationId
  customInstructions?: string
}

export interface AgentConfig {
  agentId: string
  name?: string
  role?: string
  description?: string
  roleCategory?: RoleCategory
  specializationId?: SpecializationId
  provider: ProviderId
  model: string
  reasoningEffort: ReasoningEffort
  customInstructions?: string
  avatarPreset?: AvatarPreset
  active?: boolean
  isBuiltin?: boolean
  createdAt?: string
  updatedAt: string
}

export interface CustomAgentInput {
  id?: string
  name: string
  role: string
  description?: string
  roleCategory: RoleCategory
  specializationId: SpecializationId
  provider: ProviderId
  model?: string
  reasoningEffort?: ReasoningEffort
  customInstructions?: string
  avatarPreset?: AvatarPreset
  active?: boolean
}

export interface CustomAgentPatch {
  name?: string
  role?: string
  description?: string
  roleCategory?: RoleCategory
  specializationId?: SpecializationId
  provider?: ProviderId
  model?: string
  reasoningEffort?: ReasoningEffort
  customInstructions?: string
  avatarPreset?: AvatarPreset
  active?: boolean
}

export type AgentProfileId = 'economy' | 'balanced' | 'max_quality'

/**
 * offline   = CLI não encontrado.
 * idle      = CLI pronto, sem sessão de terminal (disponível).
 * waiting   = sessão aberta, sem saída recente (esperando o usuário).
 * working   = sessão aberta produzindo saída, ou implementando no modo equipe.
 * planning  = modo equipe: escrevendo o plano.
 * approval  = modo equipe: plano pronto, esperando a aprovação do usuário.
 * reviewing = modo equipe: revisando o trabalho do Dev.
 * done      = modo equipe: terminou a sua parte da missão.
 */
export type AgentState =
  | 'offline'
  | 'idle'
  | 'waiting'
  | 'working'
  | 'planning'
  | 'approval'
  | 'reviewing'
  | 'done'
  | 'error'

/** O backend só informa SE há login; nunca lê nem repassa tokens. */
export type AuthState = 'ok' | 'missing' | 'unknown'

export interface AgentInfo {
  id: string
  name: string
  role: string
  cli: CliId
  roleCategory?: RoleCategory
  specializationId?: SpecializationId
  avatarPreset?: AvatarPreset
  isBuiltin?: boolean
  state: AgentState
  /** true enquanto o backend consulta versão/login do CLI. */
  checking: boolean
  /** Há uma sessão de terminal aberta para este agente. */
  session: boolean
  cliVersion: string | null
  auth: AuthState
  message: string
  checkedAt: string | null
}

/** Pasta que o usuário autorizou os agentes a usar. */
export interface ProjectInfo {
  id: number
  name: string
  path: string
}

export interface Workspace {
  projects: ProjectInfo[]
  /** Projeto onde as próximas sessões de terminal serão abertas. */
  activeProjectId: number | null
}

/** Um arquivo alterado. Pode estar preparado e ter mudanças não preparadas ao mesmo tempo. */
export interface GitFile {
  path: string
  /** Código XY do `git status` (ex.: 'M ', '??'). */
  code: string
  staged: boolean
  unstaged: boolean
}

export type GitRemoteState = 'configured' | 'none' | 'unknown'

export interface GitStatus {
  isRepo: boolean
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFile[]
  /** true se a lista foi cortada por ter arquivos demais. */
  truncated: boolean
  /** Estado do repositório remoto associado ao projeto local. */
  remoteState?: GitRemoteState
  remoteName?: string | null
  remoteUrl?: string | null
  lastCommit?: string | null
}

/** O que um push faria. `token` autoriza exatamente esse push, uma única vez. */
export interface PushPreview {
  token: string
  branch: string
  target: string
  setsUpstream: boolean
  commits: string[]
}

export type TaskStatus = 'todo' | 'doing' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

/** Campos que o usuário edita numa tarefa. */
export interface TaskInput {
  title: string
  description: string
  priority: TaskPriority
  status: TaskStatus
  /** Agente responsável, ou null. */
  agentId: string | null
}

export interface TaskInfo extends TaskInput {
  id: number
  projectId: number
  createdAt: string
  updatedAt: string
}

/**
 * Modo equipe: planning -> awaiting_approval -> developing -> reviewing -> done.
 * QA reprovou: volta a developing (retrabalho) até o limite de tentativas; sem aprovação termina em failed.
 * failed e cancelled também encerram a missão.
 */
export type MissionPhase =
  | 'planning'
  | 'awaiting_approval'
  /** O planejador precisa de uma resposta do usuário antes de planejar. */
  | 'awaiting_clarification'
  | 'developing'
  | 'reviewing'
  | 'done'
  | 'failed'
  | 'cancelled'

/** Uma rodada Dev -> QA da missão. A lista preserva o histórico do retrabalho. */
export interface MissionAttempt {
  attempt: number
  devReport: string
  files: string[]
  review: string
  verdictDetail: string | null
}

/** Uma pergunta do planejador ao usuário e a resposta dada (null enquanto espera). */
export interface MissionClarification {
  agentId: string
  question: string
  answer: string | null
  askedAt: string
  answeredAt: string | null
}

/** O que foi lembrado a um agente numa etapa: ids e motivos, sem copiar o conteúdo. */
export interface MemoryContextRecord {
  agentId?: string
  chars: number
  selected: { id: number | null; category: MemoryCategory; reason: string }[]
  dropped: { id: number | null; category: MemoryCategory; reason: string }[]
}

export interface MissionInfo {
  id: number
  taskId: number
  projectId: number
  phase: MissionPhase
  /** Agente responsável pelo planejamento (padrão: 'architect'). */
  plannerId?: string
  /** Agente responsável pela implementação (padrão: 'dev'). */
  devId?: string
  /** Agente responsável pela revisão QA (padrão: 'qa'). */
  qaId?: string
  /** Plano do Arquiteto (Gemini). */
  plan: string
  /** Resposta final do Dev (Codex). */
  devReport: string
  /** Revisão do QA (Gemini). */
  review: string
  /** Veredito do QA; null se ele não deu um. */
  verdict: 'approved' | 'changes' | null
  /** Classificação detalhada do QA (ex.: 'APROVADO COM RESSALVAS'). */
  verdictDetail?: string | null
  /** Especialistas opcionais selecionados para a missão (máximo 3). */
  specialists?: MissionSpecialistSelection[]
  /** Resultados e análises dos especialistas (pré-dev e pós-dev). */
  specialistResults?: SpecialistResult[]
  /** Rodadas Dev -> QA já encerradas, da mais antiga para a mais recente. */
  attempts?: MissionAttempt[]
  /** Perguntas do planejador e respostas do usuário, em ordem. */
  clarifications?: MissionClarification[]
  /** Memórias entregues a cada etapa (planning, developing, reviewing) na última execução dela. */
  memoryContext?: Record<string, MemoryContextRecord>
  /** Snapshot sem credenciais dos agentes participantes no momento da missão. */
  teamSnapshot?: Record<string, AgentSnapshotEntry>
  /** Arquivos com alterações depois que o Dev terminou. */
  files: string[]
  error: string | null
  createdAt: string
  updatedAt: string
}

export type ActivityKind = 'task' | 'status' | 'mission' | 'agent' | 'review' | 'files' | 'commit' | 'push' | 'error' | 'memory'

/** agent = só o agente dono recebe; team = toda a equipe do projeto recebe. */
export type MemoryScope = 'agent' | 'team'
export type MemoryCategory = 'decision' | 'requirement' | 'architecture' | 'problem' | 'solution' | 'qa_result' | 'learning'
/** Só 'approved' entra nos prompts. 'superseded' = trocada por uma versão mais nova. */
export type MemoryStatus = 'proposed' | 'approved' | 'rejected' | 'superseded'

/** Um fato lembrado de um projeto. Nunca é editado nem apagado: substituir cria outro registro. */
export interface MemoryEntry {
  id: number
  projectId: number
  scope: MemoryScope
  /** Dono (escopo agent) ou agente que originou o registro (escopo team). */
  agentId: string | null
  category: MemoryCategory
  content: string
  status: MemoryStatus
  sourceMissionId: number | null
  /** 'user' ou o id do agente que propôs. */
  author: string
  approvedBy: string | null
  /** Versão anterior que este registro substituiu. */
  supersedesId: number | null
  createdAt: string
  updatedAt: string
}

export interface MemoryFilter {
  scope?: MemoryScope
  agentId?: string
  category?: MemoryCategory
  status?: MemoryStatus
  /** Datas AAAA-MM-DD (inclusive). */
  from?: string
  to?: string
  /** Busca textual simples no conteúdo. */
  q?: string
}

export interface MemoryInput {
  scope: MemoryScope
  agentId: string | null
  category: MemoryCategory
  content: string
}

/** Uma linha do histórico. O texto passa por remoção de segredos antes de ser gravado. */
export interface ActivityEntry {
  id: number
  at: string
  kind: ActivityKind
  message: string
  projectId: number | null
  taskId: number | null
  missionId: number | null
  agentId: string | null
}

export type ServerMessage =
  | {
      type: 'snapshot'
      agents: AgentInfo[]
      workspace: Workspace
      tasks: TaskInfo[]
      missions: MissionInfo[]
      history: ActivityEntry[]
      configs: AgentConfig[]
      allConfigs?: AgentConfig[]
      specializations?: SpecializationInfo[]
    }
  | { type: 'agent'; agent: AgentInfo }
  | { type: 'agents'; agents: AgentInfo[] }
  | { type: 'workspace'; workspace: Workspace }
  /** Erro de uma ação pedida por este cliente (ex.: pasta inválida). */
  | { type: 'notice'; message: string }
  /** Resposta a term-open: `replay` é a saída acumulada da sessão até agora. */
  | { type: 'term-ready'; agentId: string; replay: string }
  | { type: 'term-data'; agentId: string; data: string }
  | { type: 'term-exit'; agentId: string; code: number }
  | { type: 'term-error'; agentId: string; message: string }
  /** Estado Git do projeto ativo; null quando não há projeto. */
  | { type: 'git-status'; status: GitStatus | null }
  | { type: 'git-diff'; path: string; staged: boolean; text: string }
  | { type: 'git-push-preview'; preview: PushPreview }
  | { type: 'git-result'; ok: boolean; message: string }
  /** Notificação de atividade/alterações detectadas no Git */
  | { type: 'git-activity'; summary: string; files: string[]; agentId?: string }
  /** Listas completas, reenviadas a cada mudança (são pequenas). */
  | { type: 'tasks'; tasks: TaskInfo[] }
  | { type: 'missions'; missions: MissionInfo[] }
  | { type: 'history'; entries: ActivityEntry[] }
  | { type: 'agent-configs'; configs: AgentConfig[]; allConfigs?: AgentConfig[] }
  | { type: 'specializations'; specializations: SpecializationInfo[] }
  /** Saída ao vivo do CLI que está trabalhando na missão. */
  | { type: 'mission-output'; missionId: number; data: string }
  | {
      type: 'project-validate-result'
      path: string
      valid: boolean
      exists: boolean
      isDirectory: boolean
      isRepo: boolean
      branch: string | null
      error?: string
    }
  | { type: 'dialog-folder-selected'; path: string | null }
  /** Resposta a memory-list. */
  | { type: 'memory-entries'; projectId: number; entries: MemoryEntry[] }
  /** Resposta a memory-versions: da versão mais antiga para a atual. */
  | { type: 'memory-versions'; id: number; versions: MemoryEntry[] }
  /** A memória de um projeto mudou: quem estiver exibindo deve pedir a lista de novo. */
  | { type: 'memory-changed'; projectId: number }

export type ClientMessage =
  | { type: 'check-cli'; agentId: string }
  | { type: 'dialog-open-folder' }
  | { type: 'project-validate'; path: string }
  /** Inicia a sessão do agente ou se reconecta a uma já existente. */
  | { type: 'term-open'; agentId: string; cols: number; rows: number }
  | { type: 'term-input'; agentId: string; data: string }
  | { type: 'term-resize'; agentId: string; cols: number; rows: number }
  | { type: 'term-close'; agentId: string }
  | { type: 'project-add'; path: string }
  | { type: 'project-select'; projectId: number }
  | { type: 'project-remove'; projectId: number }
  | { type: 'git-status' }
  | { type: 'git-diff'; path: string; staged: boolean }
  | { type: 'git-stage'; paths: string[] }
  | { type: 'git-unstage'; paths: string[] }
  | { type: 'git-commit'; message: string }
  /** Pede a prévia; o push em si exige o token devolvido por ela. */
  | { type: 'git-push-preview' }
  | { type: 'git-push'; token: string }
  | { type: 'task-create'; projectId: number; task: TaskInput }
  | { type: 'task-update'; taskId: number; task: TaskInput }
  | { type: 'task-delete'; taskId: number }
  /** Modo equipe: o planejador começa a planejar a tarefa (com equipe padrão ou personalizada). */
  | { type: 'mission-start'; taskId: number; team?: Partial<MissionTeamSelection> }
  /** Aprova o plano e libera o Dev. */
  | { type: 'mission-approve'; missionId: number }
  /** Rejeita o plano ou interrompe a missão. */
  | { type: 'mission-cancel'; missionId: number }
  /** Responde à pergunta do planejador e retoma o planejamento. */
  | { type: 'mission-clarify'; missionId: number; answer: string }
  /** Memória: toda aprovação, rejeição e substituição é uma ação humana vinda daqui. */
  | { type: 'memory-list'; projectId: number; filter?: MemoryFilter }
  | { type: 'memory-create'; projectId: number; entry: MemoryInput }
  | { type: 'memory-approve'; id: number }
  | { type: 'memory-reject'; id: number }
  | { type: 'memory-supersede'; id: number; content: string }
  | { type: 'memory-versions'; id: number }
  /** Central de Agentes: configuração individual, perfis, restauração e agentes personalizados */
  | {
      type: 'agent-config-set'
      config: {
        agentId: string
        provider: ProviderId
        model: string
        reasoningEffort: ReasoningEffort
      }
    }
  | { type: 'agent-config-profile'; profile: AgentProfileId }
  | { type: 'agent-config-reset' }
  | { type: 'agent-create'; agent: CustomAgentInput }
  | { type: 'agent-update'; agentId: string; patch: CustomAgentPatch }
  | { type: 'agent-set-active'; agentId: string; active: boolean }
  | { type: 'agents-list' }
  | { type: 'specializations-list' }
