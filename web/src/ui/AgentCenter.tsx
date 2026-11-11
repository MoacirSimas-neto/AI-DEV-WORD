import { useState } from 'react'
import type {
  AgentConfig,
  AgentInfo,
  AgentProfileId,
  ProviderId,
  ReasoningEffort,
} from '../../../shared/protocol.ts'
import type { Send } from '../net/useServer.ts'

interface Props {
  agents: AgentInfo[]
  configs: AgentConfig[]
  online: boolean
  send: Send
  onClose: () => void
}

const EFFORT_OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: 'default', label: 'Padrão do modelo' },
  { value: 'low', label: 'Baixo' },
  { value: 'medium', label: 'Médio' },
  { value: 'high', label: 'Alto' },
  { value: 'extra-high', label: 'Extra alto' },
]

const GEMINI_MODELS = [
  { id: 'auto', label: 'Auto (gerenciado pelo CLI)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
]

const CODEX_MODELS = [
  { id: 'default', label: 'Padrão do CLI (~/.codex/config.toml)' },
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'o3', label: 'o3' },
  { id: 'o3-mini', label: 'o3-mini' },
  { id: 'o1', label: 'o1' },
]

export function AgentCenter({ agents, configs, online, send, onClose }: Props) {
  const [profilePreview, setProfilePreview] = useState<AgentProfileId | null>(null)
  const [savingNotice, setSavingNotice] = useState<string | null>(null)

  const handleConfigChange = (
    agentId: string,
    patch: { provider: ProviderId; model: string; reasoningEffort: ReasoningEffort },
  ) => {
    send({
      type: 'agent-config-set',
      config: {
        agentId,
        provider: patch.provider,
        model: patch.model,
        reasoningEffort: patch.reasoningEffort,
      },
    })
    setSavingNotice(`Configuração salva para ${agentId}. Será aplicada na próxima execução.`)
    setTimeout(() => setSavingNotice(null), 3500)
  }

  const applyProfile = (profile: AgentProfileId) => {
    send({ type: 'agent-config-profile', profile })
    setProfilePreview(null)
    setSavingNotice(`Perfil ${profile} aplicado com sucesso.`)
    setTimeout(() => setSavingNotice(null), 3500)
  }

  const resetDefaults = () => {
    send({ type: 'agent-config-reset' })
    setSavingNotice('Configurações restauradas para o padrão oficial.')
    setTimeout(() => setSavingNotice(null), 3500)
  }

  return (
    <aside className="window agent-center-window">
      <header className="window-head">
        <div className="window-id">
          <h2>Central de Agentes</h2>
          <p>Configure provedor, modelo e esforço de raciocínio para cada personagem</p>
        </div>
        <button type="button" className="btn-quiet window-close" aria-label="Fechar Central" onClick={onClose}>
          ×
        </button>
      </header>

      {savingNotice && <p className="git-result git-result-ok">{savingNotice}</p>}

      {/* Perfis rápidos */}
      <section className="agent-profiles-bar">
        <span className="agent-profiles-title">Perfis rápidos:</span>
        <button
          type="button"
          className="btn-quiet"
          disabled={!online}
          onClick={() => applyProfile('economy')}
          title="Modelos rápidos e econômicos (Flash / Flash-Lite / Low effort)"
        >
          Economia
        </button>
        <button
          type="button"
          className="btn-quiet"
          disabled={!online}
          onClick={() => applyProfile('balanced')}
          title="Equilíbrio entre velocidade e precisão (Auto / Medium effort)"
        >
          Equilibrado
        </button>
        <button
          type="button"
          className="btn-quiet"
          disabled={!online}
          onClick={() => applyProfile('max_quality')}
          title="Máxima capacidade analítica (Gemini Pro / High effort)"
        >
          Máxima qualidade
        </button>
        <button
          type="button"
          className="btn-quiet"
          disabled={!online}
          onClick={resetDefaults}
          title="Restaurar parâmetros padrão de fábrica"
        >
          Restaurar padrões
        </button>
      </section>

      {profilePreview && (
        <div className="agent-profile-preview">
          <p>Aplicar perfil alterará os modelos de todos os 4 agentes. Deseja continuar?</p>
          <div className="git-confirm-actions">
            <button type="button" onClick={() => applyProfile(profilePreview)}>
              Confirmar
            </button>
            <button type="button" className="btn-quiet" onClick={() => setProfilePreview(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Grid de Cards dos 4 Agentes */}
      <div className="agent-cards-grid">
        {agents.map((agent) => {
          const cfg = configs.find((c) => c.agentId === agent.id) ?? {
            agentId: agent.id,
            provider: (agent.cli === 'codex' ? 'codex' : 'gemini') as ProviderId,
            model: 'default',
            reasoningEffort: 'default' as ReasoningEffort,
            updatedAt: '',
          }

          const isGemini = cfg.provider === 'gemini'
          const isCodex = cfg.provider === 'codex'

          return (
            <div key={agent.id} className="agent-config-card">
              <div className="agent-card-header">
                <strong>{agent.name}</strong>
                <span className="agent-card-role">{agent.role}</span>
                <span className={`lamp lamp-${agent.checking ? 'checking' : agent.state}`}>
                  {agent.checking ? 'Verificando…' : agent.state}
                </span>
              </div>

              <div className="agent-config-field">
                <label htmlFor={`provider-${agent.id}`}>Provedor:</label>
                <select
                  id={`provider-${agent.id}`}
                  value={cfg.provider}
                  disabled={!online}
                  onChange={(e) =>
                    handleConfigChange(agent.id, {
                      provider: e.target.value as ProviderId,
                      model: e.target.value === 'gemini' ? 'auto' : 'default',
                      reasoningEffort: 'default',
                    })
                  }
                >
                  <option value="gemini">Gemini CLI</option>
                  <option value="codex">Codex CLI</option>
                  <option value="antigravity" disabled>
                    Antigravity (futuro)
                  </option>
                </select>
              </div>

              <div className="agent-config-field">
                <label htmlFor={`model-${agent.id}`}>Modelo:</label>
                {isGemini && (
                  <select
                    id={`model-${agent.id}`}
                    value={cfg.model}
                    disabled={!online}
                    onChange={(e) =>
                      handleConfigChange(agent.id, {
                        ...cfg,
                        model: e.target.value,
                      })
                    }
                  >
                    {GEMINI_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                    {!GEMINI_MODELS.some((m) => m.id === cfg.model) && (
                      <option value={cfg.model}>{cfg.model} (personalizado)</option>
                    )}
                  </select>
                )}

                {isCodex && (
                  <select
                    id={`model-${agent.id}`}
                    value={cfg.model}
                    disabled={!online}
                    onChange={(e) =>
                      handleConfigChange(agent.id, {
                        ...cfg,
                        model: e.target.value,
                      })
                    }
                  >
                    {CODEX_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                    {!CODEX_MODELS.some((m) => m.id === cfg.model) && (
                      <option value={cfg.model}>{cfg.model} (personalizado)</option>
                    )}
                  </select>
                )}

                {!isGemini && !isCodex && (
                  <input
                    id={`model-${agent.id}`}
                    value={cfg.model}
                    disabled={!online}
                    onChange={(e) =>
                      handleConfigChange(agent.id, {
                        ...cfg,
                        model: e.target.value,
                      })
                    }
                  />
                )}
              </div>

              <div className="agent-config-field">
                <label htmlFor={`effort-${agent.id}`}>Esforço de raciocínio:</label>
                {isCodex ? (
                  <select
                    id={`effort-${agent.id}`}
                    value={cfg.reasoningEffort}
                    disabled={!online}
                    onChange={(e) =>
                      handleConfigChange(agent.id, {
                        ...cfg,
                        reasoningEffort: e.target.value as ReasoningEffort,
                      })
                    }
                  >
                    {EFFORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="agent-effort-auto">Esforço gerenciado automaticamente pelo modelo.</span>
                )}
              </div>

              <div className="agent-card-footer">
                <span className="agent-cli-version">
                  {agent.cliVersion ? `${agent.cli}: ${agent.cliVersion}` : `${agent.cli}: não verificado`}
                </span>
                <button
                  type="button"
                  className="btn-quiet"
                  disabled={agent.checking || !online}
                  onClick={() => send({ type: 'check-cli', agentId: agent.id })}
                >
                  Checar CLI
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
