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
  hasProject: boolean
  send: Send
  subscribe: Subscribe
  onClose: () => void
}

/** Janela individual do agente: quem ele é, em que estado está e o seu terminal. */
export function AgentWindow({ agent, online, hasProject, send, subscribe, onClose }: Props) {
  const sessionActive = agent.state === 'working' || agent.state === 'waiting'
  const cliReady = agent.state === 'idle'

  return (
    <aside className="window">
      <header className="window-head">
        <h2>{agent.name}</h2>
        <span className={`badge badge-${agent.checking ? 'checking' : agent.state}`}>
          {agent.checking ? 'Verificando…' : STATE_LABEL[agent.state]}
        </span>
        <button type="button" className="window-close" aria-label="Fechar janela" onClick={onClose}>
          ×
        </button>
      </header>

      <p className="window-meta">
        {agent.role} · <code>{agent.cliVersion ? `${agent.cli} ${agent.cliVersion.replace(/^\D*/, '')}` : agent.cli}</code>{' '}
        · {AUTH_LABEL[agent.auth]}
      </p>

      <div className="window-status">
        <p>{cliReady && !hasProject ? 'Escolha um projeto acima para iniciar a sessão.' : agent.message}</p>
        <button
          type="button"
          disabled={sessionActive || agent.checking || !online}
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
        canStart={online && cliReady && hasProject}
        online={online}
        send={send}
        subscribe={subscribe}
      />
    </aside>
  )
}
