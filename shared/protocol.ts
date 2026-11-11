// Contrato entre backend e frontend. Somente tipos: nada aqui vira código em runtime.

export type CliId = 'codex' | 'gemini'

export type ProviderId = 'codex' | 'gemini' | 'antigravity'
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'extra-high' | 'default'

export interface AgentConfig {
  agentId: string
  provider: ProviderId
  model: string
  reasoningEffort: ReasoningEffort
  updatedAt: string
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

export interface GitStatus {
  isRepo: boolean
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFile[]
  /** true se a lista foi cortada por ter arquivos demais. */
  truncated: boolean
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
 * failed e cancelled também encerram a missão.
 */
export type MissionPhase =
  | 'planning'
  | 'awaiting_approval'
  | 'developing'
  | 'reviewing'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface MissionInfo {
  id: number
  taskId: number
  projectId: number
  phase: MissionPhase
  /** Plano do Arquiteto (Gemini). */
  plan: string
  /** Resposta final do Dev (Codex). */
  devReport: string
  /** Revisão do QA (Gemini). */
  review: string
  /** Veredito do QA; null se ele não deu um. */
  verdict: 'approved' | 'changes' | null
  /** Arquivos com alterações depois que o Dev terminou. */
  files: string[]
  error: string | null
  createdAt: string
  updatedAt: string
}

export type ActivityKind = 'task' | 'status' | 'mission' | 'agent' | 'review' | 'files' | 'commit' | 'push' | 'error'

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
    }
  | { type: 'agent'; agent: AgentInfo }
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
  | { type: 'agent-configs'; configs: AgentConfig[] }
  /** Saída ao vivo do CLI que está trabalhando na missão. */
  | { type: 'mission-output'; missionId: number; data: string }

export type ClientMessage =
  | { type: 'check-cli'; agentId: string }
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
  /** Modo equipe: o Arquiteto começa a planejar a tarefa. */
  | { type: 'mission-start'; taskId: number }
  /** Aprova o plano e libera o Dev. */
  | { type: 'mission-approve'; missionId: number }
  /** Rejeita o plano ou interrompe a missão. */
  | { type: 'mission-cancel'; missionId: number }
  /** Central de Agentes: configuração individual, perfis e restauração */
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
