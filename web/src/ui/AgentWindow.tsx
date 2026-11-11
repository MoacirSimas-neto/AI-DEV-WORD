import type { AgentInfo, AgentState, AuthState } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'
import { TerminalView } from './TerminalView.tsx'

const STATE_LABEL: Record<AgentState, string> = {
  offline: 'Indisponível',
  idle: 'Ocioso',
  waiting: 'Aguardando você',
  working: 'Trabalhando',
  error: 'Erro',
}

const AUTH_LABEL: Record<AuthState, string> = {
  ok: 'conta conectada',
  missing: 'sem login',
  unknown: 'login não verificado',
}

interface Props {
  agent: AgentInfo
  online: boolean
  send: Send
  subscribe: Subscribe
  onClose: () => void
}

/** Janela individual do agente: quem ele é, em que estado está e o seu terminal. */
export function AgentWindow({ agent, online, send, subscribe, onClose }: Props) {
  const sessionActive = agent.state === 'working' || agent.state === 'waiting'

  return (
    <aside className="window">
      <header className="window-head">
        <h2>{agent.name}</h2>
        <span className={`badge badge-${agent.state}`}>{STATE_LABEL[agent.state]}</span>
        <button type="button" className="window-close" aria-label="Fechar janela" onClick={onClose}>
          ×
        </button>
      </header>

      <p className="window-meta">
        {agent.role} · <code>{agent.cliVersion ?? agent.cli}</code> · {AUTH_LABEL[agent.auth]}
      </p>

      <div className="window-status">
        <p>{agent.message}</p>
        <button
          type="button"
          disabled={sessionActive || !online}
          onClick={() => send({ type: 'check-cli', agentId: agent.id })}
        >
          Verificar CLI
        </button>
      </div>

      <TerminalView
        key={agent.id}
        agentId={agent.id}
        cliName={agent.cli}
        sessionActive={sessionActive}
        canStart={online && agent.state === 'idle'}
        online={online}
        send={send}
        subscribe={subscribe}
      />
    </aside>
  )
}
