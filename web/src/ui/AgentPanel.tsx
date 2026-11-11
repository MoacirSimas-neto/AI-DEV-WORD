import type { AgentInfo, AgentState, AuthState } from '../../../shared/protocol.ts'

const STATE_LABEL: Record<AgentState, string> = {
  offline: 'Indisponível',
  idle: 'Ocioso',
  working: 'Trabalhando',
  error: 'Erro',
}

const AUTH_LABEL: Record<AuthState, string> = {
  ok: 'Conta conectada',
  missing: 'Sem login',
  unknown: 'Não verificado',
}

interface Props {
  agent: AgentInfo | null
  onCheck: (agentId: string) => void
}

export function AgentPanel({ agent, onCheck }: Props) {
  if (!agent) {
    return (
      <aside className="panel panel-empty">
        <p>Clique em um personagem para ver o agente por trás dele.</p>
      </aside>
    )
  }

  return (
    <aside className="panel">
      <header className="panel-head">
        <h2>{agent.name}</h2>
        <span className={`badge badge-${agent.state}`}>{STATE_LABEL[agent.state]}</span>
      </header>
      <p className="panel-role">
        {agent.role} · roda no <code>{agent.cli}</code>
      </p>

      <dl className="facts">
        <dt>Versão do CLI</dt>
        <dd>{agent.cliVersion ?? '—'}</dd>
        <dt>Autenticação</dt>
        <dd>{AUTH_LABEL[agent.auth]}</dd>
        <dt>Última verificação</dt>
        <dd>{agent.checkedAt ? new Date(agent.checkedAt).toLocaleTimeString('pt-BR') : '—'}</dd>
      </dl>

      <p className="panel-message">{agent.message}</p>

      <button type="button" disabled={agent.state === 'working'} onClick={() => onCheck(agent.id)}>
        {agent.state === 'working' ? 'Verificando…' : 'Verificar CLI agora'}
      </button>

      <p className="panel-note">O terminal real deste agente chega na próxima etapa.</p>
    </aside>
  )
}
