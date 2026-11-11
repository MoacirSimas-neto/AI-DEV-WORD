import { type FormEvent, useEffect, useState } from 'react'
import type { Workspace } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'

interface Props {
  workspace: Workspace
  online: boolean
  /** Arquivos alterados no projeto ativo; null se ele não for um repositório Git. */
  changes: number | null
  taskCount: number
  gitOpen: boolean
  onToggleGit: () => void
  onOpenTasks: () => void
  onOpenHistory: () => void
  onOpenAgentCenter: () => void
  send: Send
  subscribe: Subscribe
}

/** Escolha da pasta em que os agentes trabalham. Só pastas listadas aqui chegam aos CLIs. */
export function ProjectBar({
  workspace,
  online,
  changes,
  taskCount,
  gitOpen,
  onToggleGit,
  onOpenTasks,
  onOpenHistory,
  onOpenAgentCenter,
  send,
  subscribe,
}: Props) {
  const { projects, activeProjectId } = workspace
  const active = projects.find((p) => p.id === activeProjectId)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [validation, setValidation] = useState<{ isRepo: boolean; branch: string | null } | null>(null)
  const [validating, setValidating] = useState(false)
  const [browsing, setBrowsing] = useState(false)

  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'notice') {
          setError(message.message)
          setValidating(false)
          setBrowsing(false)
        }
        if (message.type === 'workspace') {
          setError(null)
          setPath('')
          setValidation(null)
        }
        if (message.type === 'dialog-folder-selected') {
          setBrowsing(false)
          if (message.path) {
            setPath(message.path)
            setValidating(true)
            send({ type: 'project-validate', path: message.path })
          }
        }
        if (message.type === 'project-validate-result') {
          setValidating(false)
          if (message.valid) {
            setValidation({ isRepo: message.isRepo, branch: message.branch })
            setError(null)
          } else {
            setValidation(null)
            setError(message.error ?? 'Pasta inválida.')
          }
        }
      }),
    [subscribe, send],
  )

  const handleBrowse = () => {
    setBrowsing(true)
    setError(null)
    send({ type: 'dialog-open-folder' })
  }

  const handleValidate = () => {
    if (!path.trim()) return
    setValidating(true)
    setError(null)
    send({ type: 'project-validate', path: path.trim() })
  }

  const add = (event: FormEvent) => {
    event.preventDefault()
    if (path.trim()) send({ type: 'project-add', path: path.trim() })
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
              onChange={(e) => {
                const val = e.target.value
                if (val) send({ type: 'project-select', projectId: Number(val) })
              }}
            >
              {activeProjectId === null && <option value="">Escolha…</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {active && <span className="projects-path" title={active.path}>{active.path}</span>}
            <button
              type="button"
              className="btn-quiet"
              disabled={!online || activeProjectId === null}
              title="Tira da lista; não apaga nada do disco"
              onClick={() => activeProjectId !== null && send({ type: 'project-remove', projectId: activeProjectId })}
            >
              Remover da lista
            </button>
            <button
              type="button"
              className={gitOpen ? 'btn-active' : ''}
              disabled={!active}
              onClick={onToggleGit}
              title="Exibir ou ocultar a barra lateral Git permanente"
            >
              {changes ? `Git (${changes})` : 'Git'}
            </button>
            <button type="button" disabled={!active} onClick={onOpenTasks}>
              {taskCount ? `Tarefas (${taskCount})` : 'Tarefas'}
            </button>
            <button type="button" onClick={onOpenHistory}>
              Histórico
            </button>
            <button type="button" className="btn-agent-center" onClick={onOpenAgentCenter} title="Configurar provedor, modelo e esforço dos agentes">
              ⚙ Central de Agentes
            </button>
          </>
        )}

        <form className="projects-add" onSubmit={add}>
          <input
            aria-label="Caminho completo da pasta do projeto"
            placeholder="Caminho completo da pasta, ex.: C:\AI DEV WORD"
            value={path}
            onChange={(e) => {
              setPath(e.target.value)
              setValidation(null)
              setError(null)
            }}
            spellCheck={false}
          />
          <button
            type="button"
            className="btn-quiet"
            disabled={!online || browsing}
            title="Abrir seletor de pastas nativo"
            onClick={handleBrowse}
          >
            {browsing ? 'Abrindo…' : 'Procurar…'}
          </button>
          {path.trim() && !validation && (
            <button
              type="button"
              className="btn-quiet"
              disabled={!online || validating}
              title="Verificar se o diretório existe e se possui Git"
              onClick={handleValidate}
            >
              {validating ? 'Verificando…' : 'Validar'}
            </button>
          )}
          <button type="submit" disabled={!online || !path.trim()}>
            Adicionar pasta
          </button>
        </form>
      </div>

      {validation && (
        <div className="projects-validation-info" role="status">
          <span className="validation-badge validation-ok">✓ Pasta válida</span>
          <span className="validation-meta">
            {validation.isRepo
              ? `Repositório Git ativo (${validation.branch ?? 'HEAD destacado'})`
              : 'Pasta comum (sem Git — painel Git indicará isso)'}
          </span>
        </div>
      )}

      {error && <p className="projects-error">{error}</p>}
    </section>
  )
}
