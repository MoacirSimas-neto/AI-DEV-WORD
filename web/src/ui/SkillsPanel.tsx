import type { AgentConfig, SkillAgentOverride, SkillInfo } from '../../../shared/protocol.ts'
import type { Send } from '../net/useServer.ts'

interface Props {
  skills: SkillInfo[]
  overrides: SkillAgentOverride[]
  agents: AgentConfig[]
  online: boolean
  send: Send
}

/** Skills globais: liga para todos os agentes e ajusta agente por agente. */
export function SkillsPanel({ skills, overrides, agents, online, send }: Props) {
  if (skills.length === 0) return null
  return (
    <section className="agent-profiles-bar" aria-label="Skills globais">
      <span className="agent-profiles-title">Skills globais:</span>
      {skills.map((skill) => (
        <details key={skill.id}>
          <summary title={`${skill.description}\nOrigem: ${skill.origin}\nVersão ${skill.version} · sha256 ${skill.hash.slice(0, 12)}`}>
            <label onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={skill.enabled}
                disabled={!online}
                onChange={(e) => send({ type: 'skill-set-enabled', id: skill.id, enabled: e.target.checked })}
              />{' '}
              {skill.name}
            </label>{' '}
            <small>
              v{skill.version} · {skill.mode === 'context' ? 'no prompt das missões' : 'nativo (não aplicado)'}
            </small>
          </summary>
          {agents.map((agent) => (
            <label key={agent.agentId} style={{ display: 'block' }}>
              {agent.name || agent.agentId}:{' '}
              <select
                disabled={!online}
                value={overrides.find((o) => o.agentId === agent.agentId && o.skillId === skill.id)?.state ?? 'inherit'}
                onChange={(e) =>
                  send({
                    type: 'skill-set-agent',
                    agentId: agent.agentId,
                    skillId: skill.id,
                    state: e.target.value as 'inherit' | 'on' | 'off',
                  })
                }
              >
                <option value="inherit">Herdar ({skill.enabled ? 'ativada' : 'desativada'})</option>
                <option value="on">Ativar</option>
                <option value="off">Desativar</option>
              </select>
            </label>
          ))}
        </details>
      ))}
    </section>
  )
}
