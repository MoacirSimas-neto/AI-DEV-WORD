import { type FormEvent, useEffect, useState } from 'react'
import type { Workspace } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'

interface Props {
  workspace: Workspace
  online: boolean
  send: Send
  subscribe: Subscribe
}

/** Escolha da pasta em que os agentes trabalham. Só pastas listadas aqui chegam aos CLIs. */
export function ProjectBar({ workspace, online, send, subscribe }: Props) {
  const { projects, activeProjectId } = workspace
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'notice') setError(message.message)
        if (message.type === 'workspace') {
          setError(null)
          setPath('')
        }
      }),
    [subscribe],
  )

  const add = (event: FormEvent) => {
    event.preventDefault()
    if (path.trim()) send({ type: 'project-add', path })
  }

  return (
    <section className="projects">
      <div className="projects-row">
        <label htmlFor="project-select">Projeto</label>
        {projects.length === 0 ? (
          <span className="projects-empty">Nenhum ainda. Adicione a pasta em que os agentes vão trabalhar.</span>
        ) : (
          <>
            <select
              id="project-select"
              value={activeProjectId ?? ''}
              disabled={!online}
              onChange={(e) => send({ type: 'project-select', projectId: Number(e.target.value) })}
            >
              {activeProjectId === null && <option value="">Escolha…</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id} title={p.path}>
                  {p.name} — {p.path}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!online || activeProjectId === null}
              title="Tira da lista; não apaga nada do disco"
              onClick={() => activeProjectId !== null && send({ type: 'project-remove', projectId: activeProjectId })}
            >
              Remover da lista
            </button>
          </>
        )}

        <form className="projects-add" onSubmit={add}>
          <input
            aria-label="Caminho completo da pasta do projeto"
            placeholder="Caminho completo da pasta, ex.: C:\projetos\meu-app"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            spellCheck={false}
          />
          <button type="submit" disabled={!online || !path.trim()}>
            Adicionar pasta
          </button>
        </form>
      </div>
      {error && <p className="projects-error">{error}</p>}
    </section>
  )
}
