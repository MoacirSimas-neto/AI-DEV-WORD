import { useRef, useState, type FormEvent } from 'react'
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
  const [formOpen, setFormOpen] = useState(false)
  const [content, setContent] = useState('')
  const [filename, setFilename] = useState('')
  const [error, setError] = useState('')
  const importRequest = useRef(0)
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const id = String(data.get('id')).trim().toLowerCase()
    if (skills.some((skill) => skill.id === id)) {
      setError('Já existe uma skill com esse ID.')
      return
    }
    setError('')
    send({ type: 'skill-save', createOnly: true, skill: {
      id,
      name: String(data.get('name')).trim(),
      description: String(data.get('description')).trim(),
      origin: filename ? `Arquivo local: ${filename}` : 'local',
      content,
      enabled: false,
    } })
  }
  return (
    <section className="skills-panel-section" aria-label="Biblioteca de skills">
      <div className="skills-panel-header">
        <span className="agent-profiles-title">Biblioteca de skills</span>
        <button
          type="button"
          className="btn-primary-glow"
          onClick={() => setFormOpen((open) => !open)}
        >
          {formOpen ? 'Fechar formulário' : '+ Adicionar Skill'}
        </button>
      </div>
      {formOpen && (
        <form className="agent-creator-panel" onSubmit={save}>
          <div className="agent-creator-row">
            <div className="agent-config-field">
              <label className="skill-form-label">ID <input name="id" required pattern="[a-z0-9][a-z0-9_\\-]{1,39}" placeholder="ex: minha-skill" /></label>
            </div>
            <div className="agent-config-field">
              <label className="skill-form-label">Nome <input name="name" required maxLength={80} placeholder="ex: Revisão de Código" /></label>
            </div>
            <div className="agent-config-field">
              <label className="skill-form-label">Descrição <input name="description" maxLength={300} placeholder="Resumo curto do propósito" /></label>
            </div>
          </div>
          <div className="agent-config-field">
            <label className="skill-form-label">Importar Markdown <input type="file" accept=".md,.txt" onChange={async (e) => {
              const request = ++importRequest.current
              const file = e.currentTarget.files?.[0]
              if (!file) return
              if (!/\.(md|txt)$/i.test(file.name) || file.size > 24_000) {
                setError('Selecione um arquivo .md ou .txt de até 24 KB.')
                return
              }
              try {
                const body = await file.text()
                if (request !== importRequest.current) return
                if (!body.trim() || body.length > 6000 || body.includes('\0')) {
                  setError('O arquivo deve conter texto de até 6.000 caracteres.')
                  return
                }
                setContent(body)
                setFilename(file.name)
                setError('')
              } catch {
                if (request === importRequest.current) setError('Não foi possível ler o arquivo.')
              }
            }} /></label>
          </div>
          <div className="agent-config-field">
            <label className="skill-form-label">Instruções <textarea required maxLength={6000} rows={5} placeholder="Cole ou importe as instruções da skill..." value={content} onChange={(e) => {
              ++importRequest.current
              setContent(e.target.value)
            }} /></label>
          </div>
          <p className="skills-helper-text">As skills são salvas desativadas. Importar um arquivo só lê o texto.</p>
          {error && <p role="alert" className="git-notice-banner">{error}</p>}
          <div className="agent-creator-actions">
            <button type="submit" className="btn-primary-glow" disabled={!online}>Salvar skill</button>
            <button type="button" className="btn-quiet" onClick={() => setFormOpen(false)}>Cancelar</button>
          </div>
        </form>
      )}
      <div className="skill-library-list">
        {skills.map((skill) => (
          <details key={skill.id} className="skill-library-item">
            <summary className="skill-library-summary" title={`${skill.description}\nOrigem: ${skill.origin}\nVersão ${skill.version} · sha256 ${skill.hash.slice(0, 12)}`}>
              <label className="skill-library-name" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  disabled={!online}
                  onChange={(e) => send({ type: 'skill-set-enabled', id: skill.id, enabled: e.target.checked })}
                />{' '}
                <span>{skill.name}</span>
              </label>
              <small className="skill-library-meta">
                v{skill.version} · {skill.mode === 'context' ? 'no prompt das missões' : 'nativo (não aplicado)'}
              </small>
            </summary>
            <div className="skill-library-body">
          <p>{skill.description}</p>
          <p>Origem: {skill.origin}</p>
          <p>{skill.mode === 'native' ? 'Incompatível: modo nativo não suportado.' : 'Permissões do app: nenhuma. Dependências: não instaladas pelo app.'}</p>
          <details>
            <summary>Ver instruções e requisitos declarados</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{skill.content}</pre>
          </details>
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
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}
