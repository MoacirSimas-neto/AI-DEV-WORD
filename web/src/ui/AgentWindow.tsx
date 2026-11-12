import type { AgentConfig, AgentInfo, AuthState } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'
import { AgentPortrait } from './AgentPortrait.tsx'
import { stateOf } from './agentText.ts'
import { TerminalView } from './TerminalView.tsx'

const AUTH_LABEL: Record<AuthState, string> = {
  ok: 'Conta conectada',
  missing: 'Sem login',
  unknown: 'Login não verificado',
}

interface Props {
  agent: AgentInfo
  config?: AgentConfig
  online: boolean
  hasProject: boolean
  send: Send
  subscribe: Subscribe
  onClose: () => void
  onOpenObservability?: (agentId: string) => void
}

/** Janela individual do agente: quem ele é, modelo configurado, estado e terminal. */
export function AgentWindow({
  agent,
  config,
  online,
  hasProject,
  send,
  subscribe,
  onClose,
  onOpenObservability,
}: Props) {
  const sessionActive = agent.session
  const cliReady = agent.state !== 'offline'
  const state = stateOf(agent)
  const version = agent.cliVersion?.replace(/^\D*/, '')

  return (
    <aside className="window">
      <header className="window-head">
        <AgentPortrait
          agentId={agent.id}
          preset={config?.avatarPreset ?? agent.avatarPreset}
          roleOrName={`${agent.name} ${agent.role} ${config?.specializationId ?? agent.specializationId ?? ''}`}
          dimmed={agent.state === 'offline'}
        />
        <div className="window-id">
          <h2>{agent.name}</h2>
          <p>
            {agent.role}
            {(config?.specializationId ?? agent.specializationId)
              ? ` · Especialização: ${config?.specializationId ?? agent.specializationId}`
              : ''}
          </p>
        </div>
        <button type="button" className="btn-quiet window-close" aria-label="Fechar janela" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="window-facts">
        <span className={`lamp lamp-${state.tone}`}>{state.label}</span>
        <span className="tag">{version ? `${agent.cli} ${version}` : agent.cli}</span>
        {config && (
          <span className="tag tag-model" title="Provedor e modelo configurados na Central de Agentes">
            Config: {config.provider} · {config.model}
            {config.reasoningEffort !== 'default' ? ` (${config.reasoningEffort})` : ''}
          </span>
        )}
        <span className={`tag tag-auth-${agent.auth}`}>{AUTH_LABEL[agent.auth]}</span>
        <button
          type="button"
          className="btn-quiet"
          disabled={sessionActive || agent.checking || !online}
          onClick={() => send({ type: 'check-cli', agentId: agent.id })}
        >
          Verificar CLI
        </button>
        {onOpenObservability && (
          <button
            type="button"
            className="btn-quiet"
            onClick={() => onOpenObservability(agent.id)}
            title="Ver atividade e evidências deste agente na Central de Observabilidade"
          >
            🔍 Atividade detalhada
          </button>
        )}
      </div>

      <p className="window-message">
        {cliReady && !hasProject ? 'Escolha um projeto acima para iniciar a sessão.' : agent.message}
      </p>

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
