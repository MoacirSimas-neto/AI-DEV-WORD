// Contrato entre backend e frontend. Somente tipos: nada aqui vira código em runtime.

export type CliId = 'codex' | 'gemini'

/**
 * offline = CLI não encontrado.
 * idle    = CLI pronto, sem sessão de terminal.
 * waiting = sessão aberta, sem saída recente (esperando o usuário).
 * working = sessão aberta e o processo está produzindo saída.
 */
export type AgentState = 'offline' | 'idle' | 'waiting' | 'working' | 'error'

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

export type ServerMessage =
  | { type: 'snapshot'; agents: AgentInfo[]; workspace: Workspace }
  | { type: 'agent'; agent: AgentInfo }
  | { type: 'workspace'; workspace: Workspace }
  /** Erro de uma ação pedida por este cliente (ex.: pasta inválida). */
  | { type: 'notice'; message: string }
  /** Resposta a term-open: `replay` é a saída acumulada da sessão até agora. */
  | { type: 'term-ready'; agentId: string; replay: string }
  | { type: 'term-data'; agentId: string; data: string }
  | { type: 'term-exit'; agentId: string; code: number }
  | { type: 'term-error'; agentId: string; message: string }

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
