// Contrato entre backend e frontend. Somente tipos: nada aqui vira código em runtime.

export type CliId = 'codex' | 'gemini'

/** offline = CLI não encontrado; working = há um processo real em execução. */
export type AgentState = 'offline' | 'idle' | 'working' | 'error'

/** O backend só informa SE há login; nunca lê nem repassa tokens. */
export type AuthState = 'ok' | 'missing' | 'unknown'

export interface AgentInfo {
  id: string
  name: string
  role: string
  cli: CliId
  state: AgentState
  cliVersion: string | null
  auth: AuthState
  message: string
  checkedAt: string | null
}

export type ServerMessage =
  | { type: 'snapshot'; agents: AgentInfo[] }
  | { type: 'agent'; agent: AgentInfo }

export type ClientMessage = { type: 'check-cli'; agentId: string }
