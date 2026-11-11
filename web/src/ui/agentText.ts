import type { AgentInfo, AgentState } from '../../../shared/protocol.ts'

const STATE_LABEL: Record<AgentState, string> = {
  offline: 'Indisponível',
  idle: 'Ocioso',
  waiting: 'Aguardando você',
  working: 'Trabalhando',
  error: 'Erro',
}

/** Rótulo e classe de cor do estado, iguais em todos os lugares da interface. */
export function stateOf(agent: AgentInfo) {
  return agent.checking
    ? { label: 'Verificando…', tone: 'checking' }
    : { label: STATE_LABEL[agent.state], tone: agent.state }
}
