import { useEffect, useRef, useState } from 'react'
import type { GitFile, GitStatus, PushPreview } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'

const KIND: Record<string, { label: string; tone: string }> = {
  M: { label: 'modificado', tone: 'modified' },
  A: { label: 'novo', tone: 'added' },
  '?': { label: 'não rastreado', tone: 'added' },
  D: { label: 'removido', tone: 'deleted' },
  R: { label: 'renomeado', tone: 'modified' },
  C: { label: 'copiado', tone: 'added' },
  U: { label: 'conflito', tone: 'conflict' },
  T: { label: 'tipo mudou', tone: 'modified' },
}

interface Selection {
  path: string
  staged: boolean
}

interface Props {
  status: GitStatus | null
  projectName?: string
  projectPath?: string
  send: Send
  subscribe: Subscribe
  onToggleCollapse?: () => void
  collapsed?: boolean
}

/** Painel Git permanente com distinção explícita entre Git local e repositório remoto. */
export function GitPanel({
  status,
  projectName,
  projectPath,
  send,
  subscribe,
  onToggleCollapse,
  collapsed = false,
}: Props) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [diff, setDiff] = useState<(Selection & { text: string }) | null>(null)
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<PushPreview | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newlyChanged, setNewlyChanged] = useState<Set<string>>(new Set())
  const [showFullRemoteUrl, setShowFullRemoteUrl] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)

  const prevFilesRef = useRef<string[]>([])
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return subscribe((incoming) => {
      if (incoming.type === 'git-diff') setDiff(incoming)
      if (incoming.type === 'git-push-preview') setPreview(incoming.preview)
      if (incoming.type === 'git-result') {
        setResult(incoming)
        if (incoming.ok && incoming.message.startsWith('Commit')) setMessage('')
      }
      if (incoming.type === 'git-activity') {
        setNotice(incoming.summary)
        if (incoming.files.length > 0) {
          setNewlyChanged((prev) => new Set([...prev, ...incoming.files]))
          setTimeout(() => {
            setNewlyChanged((prev) => {
              const next = new Set(prev)
              for (const f of incoming.files) next.delete(f)
              return next
            })
          }, 6000)
        }
        clearTimeout(noticeTimerRef.current)
        noticeTimerRef.current = setTimeout(() => setNotice(null), 7000)
      }
    })
  }, [subscribe])

  // Identifica novos arquivos quando o status é atualizado
  useEffect(() => {
    if (!status?.files) return
    const currentPaths = status.files.map((f) => f.path)
    const prev = prevFilesRef.current
    if (prev.length > 0) {
      const added = currentPaths.filter((p) => !prev.includes(p))
      if (added.length > 0) {
        setNewlyChanged((s) => new Set([...s, ...added]))
        if (!notice) {
          setNotice('Novas alterações detectadas.')
          clearTimeout(noticeTimerRef.current)
          noticeTimerRef.current = setTimeout(() => setNotice(null), 6000)
        }
        setTimeout(() => {
          setNewlyChanged((s) => {
            const next = new Set(s)
            for (const f of added) next.delete(f)
            return next
          })
        }, 6000)
      }
    }
    prevFilesRef.current = currentPaths
  }, [status, notice])

  // Pede o diff do arquivo escolhido e o renova quando o estado muda
  useEffect(() => {
    if (selection) send({ type: 'git-diff', path: selection.path, staged: selection.staged })
  }, [selection, status, send])

  const files = status?.files ?? []
  const staged = files.filter((f) => f.staged)
  const unstaged = files.filter((f) => f.unstaged)

  // Contadores por categoria
  const countAdded = files.filter((f) => f.code.includes('A') || f.code.includes('?')).length
  const countModified = files.filter((f) => f.code.includes('M') || f.code.includes('R') || f.code.includes('T')).length
  const countDeleted = files.filter((f) => f.code.includes('D')).length
  const countConflict = files.filter((f) => f.code.includes('U')).length

  const shownDiff =
    selection &&
    diff?.path === selection.path &&
    diff.staged === selection.staged &&
    (selection.staged ? staged : unstaged).some((f) => f.path === selection.path)
      ? diff.text
      : null

  const remoteState = status?.remoteState ?? (status?.upstream ? 'configured' : 'none')
  const canPush =
    !!status?.branch &&
    remoteState !== 'none' &&
    (status.ahead > 0 || !status.upstream)

  const act = (action: () => void) => {
    setResult(null)
    setPreview(null)
    action()
  }

  const copyRemoteUrl = () => {
    if (!status?.remoteUrl) return
    void navigator.clipboard?.writeText(status.remoteUrl)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  if (collapsed) {
    return (
      <aside className="git-sidebar-collapsed" title="Clique para expandir o painel Git Control">
        <button type="button" className="btn-expand-git" onClick={onToggleCollapse}>
          <span className="expand-icon">«</span>
          <span className="expand-text">Git ({files.length})</span>
        </button>
      </aside>
    )
  }

  const fileList = (list: GitFile[], isStaged: boolean) =>
    list.map((file) => {
      const active = selection?.path === file.path && selection.staged === isStaged
      const kindInfo = KIND[file.code[isStaged ? 0 : 1]] ?? { label: file.code.trim(), tone: 'modified' }
      const isNew = newlyChanged.has(file.path)

      return (
        <li
          key={`${file.path}-${isStaged ? 's' : 'u'}`}
          className={`git-file ${active ? 'git-file-active' : ''} ${isNew ? 'git-file-new' : ''}`}
        >
          <button
            type="button"
            className="git-file-name"
            aria-pressed={active}
            onClick={() => setSelection({ path: file.path, staged: isStaged })}
          >
            <span className={`git-kind git-tone-${kindInfo.tone}`}>{kindInfo.label}</span>
            <span className="git-path-text">{file.path}</span>
            {isNew && <span className="git-badge-new">Novo</span>}
          </button>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => act(() => send({ type: isStaged ? 'git-unstage' : 'git-stage', paths: [file.path] }))}
          >
            {isStaged ? 'Tirar' : 'Preparar'}
          </button>
        </li>
      )
    })

  return (
    <aside className="window git-sidebar-panel">
      <header className="window-head git-panel-head">
        <div className="window-id">
          <h2>Git Control</h2>
          <p className="git-repo-title">
            {projectName ? `${projectName} · ${branchLine(status)}` : 'Nenhum projeto selecionado'}
          </p>
        </div>
        <div className="git-head-actions">
          {status?.isRepo && (
            <button
              type="button"
              className="btn-quiet git-refresh-btn"
              title="Atualizar status Git local"
              onClick={() => act(() => send({ type: 'git-status' }))}
            >
              ↻
            </button>
          )}
          {onToggleCollapse && (
            <button
              type="button"
              className="btn-quiet git-collapse-btn"
              title="Recolher painel Git"
              aria-label="Recolher painel"
              onClick={onToggleCollapse}
            >
              »
            </button>
          )}
        </div>
      </header>

      {/* Notificação discreta de autoria ou novas alterações */}
      {notice && (
        <div className="git-notice-banner" role="status">
          <span>{notice}</span>
          <button type="button" className="btn-quiet notice-dismiss" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {!status && <p className="window-message">Escolha um projeto para inspecionar o controle de versão.</p>}

      {status && !status.isRepo && (
        <div className="git-non-repo-card">
          <strong>Pasta sem repositório Git local</strong>
          <p>
            Esta pasta (<code>{projectPath}</code>) não possui um repositório Git inicializado. Rode{' '}
            <code>git init</code> caso deseje versionar arquivos aqui.
          </p>
        </div>
      )}

      {status?.isRepo && (
        <>
          {/* BLOCO 1: Estado do Repositório Local */}
          <section className="git-scope-card git-local-card">
            <div className="git-scope-header">
              <span className="git-scope-tag git-scope-local">GIT LOCAL</span>
              <span className="git-branch-pill">⎇ {status.branch ?? 'HEAD destacado'}</span>
            </div>
            {projectPath && (
              <div className="git-metric-item" title={projectPath}>
                📁 {projectPath}
              </div>
            )}
            {status.lastCommit && (
              <div className="git-last-commit" title={status.lastCommit}>
                Último commit: <code>{status.lastCommit}</code>
              </div>
            )}
            <div className="git-metric-badges">
              <span className="git-badge-summary">{files.length} alterado(s)</span>
              <span className="git-badge-summary">{staged.length} staged</span>
              {countAdded > 0 && <span className="git-badge-cat cat-added">+{countAdded} novo(s)</span>}
              {countModified > 0 && <span className="git-badge-cat cat-mod">~{countModified} mod</span>}
              {countDeleted > 0 && <span className="git-badge-cat cat-del">-{countDeleted} rem</span>}
              {countConflict > 0 && <span className="git-badge-cat cat-conf">!{countConflict} conflito</span>}
            </div>
          </section>

          {/* BLOCO 2: Estado do Repositório Remoto */}
          <section className="git-scope-card git-remote-card">
            <div className="git-scope-header">
              <span className="git-scope-tag git-scope-remote">REMOTO</span>
              <span className={`git-remote-badge remote-${remoteState}`}>
                {remoteState === 'configured' && `Configurado (${status.remoteName ?? 'origin'})`}
                {remoteState === 'none' && 'Sem remote'}
                {remoteState === 'unknown' && 'Estado remoto desconhecido'}
              </span>
            </div>

            {remoteState === 'configured' && (
              <div className="git-remote-details">
                {status.remoteUrl && (
                  <div className="git-remote-url-row">
                    <span
                      className={`git-remote-url ${showFullRemoteUrl ? 'expanded' : ''}`}
                      title={status.remoteUrl}
                    >
                      {status.remoteUrl}
                    </span>
                    <button
                      type="button"
                      className="btn-quiet btn-xs"
                      onClick={() => setShowFullRemoteUrl((v) => !v)}
                    >
                      {showFullRemoteUrl ? 'Ocultar' : 'Ver'}
                    </button>
                    <button type="button" className="btn-quiet btn-xs" onClick={copyRemoteUrl}>
                      {copiedUrl ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                )}
                <div className="git-sync-row">
                  <span>
                    Upstream: <strong>{status.upstream ?? 'não vinculado na branch'}</strong>
                  </span>
                  <div className="git-sync-pills">
                    <span className="git-badge-sync" title="Commits locais ainda não enviados ao remoto">
                      ▲ {status.ahead} à frente
                    </span>
                    <span className="git-badge-sync" title="Commits no tracking remoto ainda não mesclados">
                      ▼ {status.behind} atrás
                    </span>
                  </div>
                </div>
                <p className="git-remote-footnote">
                  Contadores baseados na última referência remota conhecida localmente (sem fetch automático).
                </p>
              </div>
            )}

            {remoteState === 'none' && (
              <p className="git-remote-footnote">
                Repositório apenas local. Nenhum servidor remoto (ex.: GitHub/GitLab) configurado em{' '}
                <code>git remote</code>.
              </p>
            )}

            {remoteState === 'unknown' && (
              <p className="git-remote-footnote">
                Não foi possível consultar os repositórios remotos configurados.
              </p>
            )}
          </section>

          {/* Arquivos Staged */}
          <section>
            <div className="git-heading">
              <h3>Preparado para commit (Staged)</h3>
              <span>{staged.length}</span>
            </div>
            {staged.length === 0 ? (
              <p className="git-empty">Nada preparado. Use "Preparar" nos arquivos abaixo.</p>
            ) : (
              <ul className="git-files">{fileList(staged, true)}</ul>
            )}
          </section>

          {/* Arquivos Unstaged */}
          <section>
            <div className="git-heading">
              <h3>Alterado no disco (Unstaged)</h3>
              <span>{unstaged.length}</span>
              {unstaged.length > 1 && (
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => act(() => send({ type: 'git-stage', paths: unstaged.map((f) => f.path) }))}
                >
                  Preparar tudo
                </button>
              )}
            </div>
            {unstaged.length === 0 ? (
              <p className="git-empty">Nenhuma alteração pendente fora do stage.</p>
            ) : (
              <ul className="git-files">{fileList(unstaged, false)}</ul>
            )}
            {status.truncated && <p className="git-empty">Há mais arquivos do que cabe na lista.</p>}
          </section>

          {/* Visualização de diff do arquivo selecionado */}
          {shownDiff !== null && (
            <section className="git-diff-container">
              <div className="git-diff-head">
                <span className="git-diff-path">{selection?.path}</span>
                <button type="button" className="btn-quiet" onClick={() => setSelection(null)}>
                  Fechar Diff
                </button>
              </div>
              <DiffView text={shownDiff} />
            </section>
          )}

          {/* AÇÃO 1: Commit Local */}
          <section className="git-action-block">
            <div className="git-action-label">
              <strong>1. Commit Local</strong>
              <span>Grava alterações apenas no repositório Git desta máquina</span>
            </div>
            <div className="git-commit">
              <textarea
                aria-label="Mensagem do commit"
                placeholder="Mensagem descritiva do commit local..."
                rows={2}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <button
                type="button"
                disabled={staged.length === 0 || !message.trim()}
                onClick={() => act(() => send({ type: 'git-commit', message }))}
              >
                Commit Local
              </button>
            </div>
          </section>

          {/* AÇÃO 2: Push Remoto */}
          <section className="git-action-block">
            <div className="git-action-label">
              <strong>2. Push Remoto</strong>
              <span>Envia commits locais confirmados para o servidor remoto</span>
            </div>
            <div className="git-push">
              <p>{pushLine(status, remoteState)}</p>
              <button
                type="button"
                className="btn-quiet"
                disabled={!canPush}
                onClick={() => act(() => send({ type: 'git-push-preview' }))}
              >
                Push Remoto…
              </button>
            </div>
          </section>

          {preview && (
            <section className="git-confirm" role="alertdialog" aria-label="Confirmar push remoto">
              <p>
                <strong>
                  Enviar {preview.commits.length} {preview.commits.length === 1 ? 'commit local' : 'commits locais'} de{' '}
                  {preview.branch} para o remoto {preview.target}?
                </strong>
              </p>
              <ul>
                {preview.commits.map((commit) => (
                  <li key={commit}>{commit}</li>
                ))}
              </ul>
              {preview.setsUpstream && <p>Esta branch será publicada no repositório remoto.</p>}
              <div className="git-confirm-actions">
                <button
                  type="button"
                  onClick={() => {
                    send({ type: 'git-push', token: preview.token })
                    setPreview(null)
                  }}
                >
                  Confirmar envio remoto
                </button>
                <button type="button" className="btn-quiet" onClick={() => setPreview(null)}>
                  Cancelar
                </button>
              </div>
            </section>
          )}
        </>
      )}

      {result && <p className={result.ok ? 'git-result git-result-ok' : 'git-result git-result-bad'}>{result.message}</p>}
    </aside>
  )
}

function branchLine(status: GitStatus | null) {
  if (!status || !status.isRepo) return 'Não é repositório Git'
  if (!status.branch) return 'Sem branch ativa'
  return status.upstream ? `${status.branch} → ${status.upstream}` : status.branch
}

function pushLine(status: GitStatus, remoteState: string) {
  if (remoteState === 'none') return 'Push indisponível: nenhum remote configurado.'
  if (!status.branch) return 'Sem branch ativa para envio.'
  if (!status.upstream) return `Publicar branch ${status.branch} em ${status.remoteName ?? 'origin'}.`
  const parts = []
  if (status.ahead) parts.push(`${status.ahead} commit(s) local(is) para enviar`)
  if (status.behind) parts.push(`${status.behind} atrás do remoto`)
  return parts.length ? `${parts.join(' · ')} (${status.upstream}).` : `Sincronizado com ${status.upstream}.`
}

function DiffView({ text }: { text: string }) {
  if (!text.trim()) return <pre className="diff">Sem diferenças de texto para mostrar.</pre>
  return (
    <pre className="diff">
      {text.split('\n').map((line, index) => (
        <span key={index} className={lineClass(line)}>
          {line}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

function lineClass(line: string) {
  if (line.startsWith('@@')) return 'diff-hunk'
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
    return 'diff-meta'
  }
  if (line.startsWith('+')) return 'diff-add'
  if (line.startsWith('-')) return 'diff-del'
  return undefined
}
