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
    <section className="agent-profiles-bar" aria-label="Biblioteca de skills">
      <span className="agent-profiles-title">Biblioteca de skills</span>
      <details>
        <summary>Criar ou importar skill</summary>
        <form onSubmit={save}>
          <label>ID <input name="id" required pattern="[a-z0-9][a-z0-9_\\-]{1,39}" /></label>
          <label>Nome <input name="name" required maxLength={80} /></label>
          <label>Descrição <input name="description" maxLength={300} /></label>
          <label>Importar Markdown <input type="file" accept=".md,.txt" onChange={async (e) => {
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
          <label>Instruções <textarea required maxLength={6000} value={content} onChange={(e) => {
            ++importRequest.current
            setContent(e.target.value)
          }} /></label>
          <p>As skills são salvas desativadas. Importar um arquivo só lê o texto.</p>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={!online}>Salvar skill</button>
        </form>
      </details>
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
        </details>
      ))}
    </section>
  )
}
