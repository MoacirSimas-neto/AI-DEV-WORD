import type { AgentInfo } from '../../../shared/protocol.ts'
import { AgentPortrait } from './AgentPortrait.tsx'
import { stateOf } from './agentText.ts'

interface Props {
  agents: AgentInfo[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/** A equipe em cartões: mostra o estado de todos de relance e abre a janela de cada um. */
export function TeamRoster({ agents, selectedId, onSelect }: Props) {
  return (
    <nav className="roster" aria-label="Equipe">
      {agents.map((agent) => {
        const state = stateOf(agent)
        return (
          <button
            key={agent.id}
            type="button"
            className="roster-card"
            aria-pressed={agent.id === selectedId}
            onClick={() => onSelect(agent.id)}
          >
            <AgentPortrait
              agentId={agent.id}
              preset={agent.avatarPreset}
              roleOrName={`${agent.name} ${agent.role}`}
              dimmed={agent.state === 'offline'}
            />
            <span className="roster-text">
              <strong>{agent.name}</strong>
              <span className="roster-role">{agent.role}</span>
              <span className={`lamp lamp-${state.tone}`}>{state.label}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
