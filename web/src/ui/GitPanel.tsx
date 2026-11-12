import { useEffect, useRef, useState } from 'react'
import type { GitFile, GitStatus, PushPreview } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'
import { DiffViewer } from './DiffViewer.tsx'

const KIND: Record<string, { label: string; badge: string; tone: string }> = {
  M: { label: 'modificado', badge: 'M', tone: 'modified' },
  A: { label: 'novo', badge: 'A', tone: 'added' },
  '?': { label: 'não rastreado', badge: 'U', tone: 'added' },
  D: { label: 'removido', badge: 'D', tone: 'deleted' },
  R: { label: 'renomeado', badge: 'R', tone: 'modified' },
  C: { label: 'copiado', badge: 'C', tone: 'added' },
  U: { label: 'conflito', badge: '!', tone: 'conflict' },
  T: { label: 'tipo mudou', badge: 'T', tone: 'modified' },
}

interface Selection {
  path: string
  staged: boolean
}

interface CommitEntry {
  hash: string
  shortHash: string
  subject: string
  author: string
  date: string
}

interface BranchEntry {
  name: string
  current: boolean
  upstream?: string
}

interface CommitDetail {
  hash: string
  shortHash: string
  subject: string
  author: string
  date: string
  files: string[]
  diff: string
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

function fileStatusMeta(code: string) {
  const ch = code.trim()[0] || 'M'
  return KIND[ch] ?? { label: 'alterado', badge: ch, tone: 'modified' }
}

/** Painel Git inspirado no Source Control do VS Code, preservando aprovação explícita. */
export function GitPanel({
  status,
  projectName,
  send,
  subscribe,
}: Props) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [diff, setDiff] = useState<(Selection & { text: string }) | null>(null)
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [preview, setPreview] = useState<PushPreview | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [activityByFile, setActivityByFile] = useState<Record<string, { summary: string; agentId?: string }>>({})
  const [menuOpen, setMenuOpen] = useState(false)
  const [sideTab, setSideTab] = useState<'changes' | 'history'>('changes')
  const [mobilePane, setMobilePane] = useState<'files' | 'diff'>('files')
  const [commits, setCommits] = useState<CommitEntry[]>([])
  const [branches, setBranches] = useState<BranchEntry[]>([])
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null)

  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return subscribe((incoming) => {
      if (incoming.type === 'git-diff') {
        setCommitDetail(null)
        setDiff(incoming)
      }
      if (incoming.type === 'git-log') setCommits(incoming.entries)
      if (incoming.type === 'git-branches') setBranches(incoming.branches)
      if (incoming.type === 'git-commit-detail') {
        setSelection(null)
        setDiff(null)
        setCommitDetail(incoming.detail)
      }
      if (incoming.type === 'git-push-preview') setPreview(incoming.preview)
      if (incoming.type === 'git-result') {
        setCommitting(false)
        setResult(incoming)
        if (incoming.ok && incoming.message.startsWith('Commit')) {
          setMessage('')
          send({ type: 'git-log', limit: 30 })
        }
      }
      if (incoming.type === 'git-activity') {
        setNotice(incoming.summary)
        if (incoming.files.length > 0) {
          setActivityByFile((prev) => {
            const next = { ...prev }
            for (const f of incoming.files) next[f] = { summary: incoming.summary, agentId: incoming.agentId }
            return next
          })
        }
        clearTimeout(noticeTimerRef.current)
        noticeTimerRef.current = setTimeout(() => setNotice(null), 7000)
      }
    })
  }, [subscribe, send])

  useEffect(() => {
    if (selection) send({ type: 'git-diff', path: selection.path, staged: selection.staged })
  }, [selection, status, send])

  useEffect(() => {
    if (sideTab === 'history' && status?.isRepo) {
      send({ type: 'git-log', limit: 30 })
      send({ type: 'git-branches' })
    }
  }, [sideTab, status?.isRepo, send])

  const files = status?.files ?? []
  const staged = files.filter((f) => f.staged)
  const unstaged = files.filter((f) => f.unstaged)

  const selectFile = (file: GitFile, isStaged: boolean) => {
    setCommitDetail(null)
    setSelection({ path: file.path, staged: isStaged })
    setMobilePane('diff')
  }

  const handleCommit = () => {
    const trimmed = message.trim()
    if (!trimmed || staged.length === 0 || committing) return
    setCommitting(true)
    setResult(null)
    send({ type: 'git-commit', message: trimmed })
  }

  const handleRefresh = () => {
    send({ type: 'git-status' })
    if (sideTab === 'history') {
      send({ type: 'git-log', limit: 30 })
      send({ type: 'git-branches' })
    }
  }

  if (!status) {
    return (
      <section className="git-workbench git-empty-state" aria-label="Controle de versão">
        <p className="muted">Carregando estado Git do projeto...</p>
      </section>
    )
  }

  if (!status.isRepo) {
    return (
      <section className="git-workbench git-empty-state" aria-label="Controle de versão">
        <h3>Repositório Git não inicializado</h3>
        <p className="muted">
          A pasta <code>{projectName || 'atual'}</code> ainda não é um repositório Git.
        </p>
      </section>
    )
  }

  return (
    <section className="git-workbench" aria-label="Controle de versão">
      <header className="git-workbench-header">
        <div className="git-workbench-title">
          <strong>{projectName || 'Projeto'}</strong>
          <span className="git-branch-pill" title="Branch atual">
            🌿 {status.branch || 'HEAD destacado'}
          </span>
          <span className="git-pending-pill">
            {files.length === 0 ? 'Limpo' : `${files.length} pendente(s)`}
          </span>
        </div>

        <div className="git-workbench-actions">
          <div className="git-mobile-pane-toggle" role="tablist" aria-label="Alternar visualização">
            <button
              type="button"
              role="tab"
              aria-selected={mobilePane === 'files'}
              className={`btn btn-sm ${mobilePane === 'files' ? 'is-active' : ''}`}
              onClick={() => setMobilePane('files')}
            >
              Arquivos ({files.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobilePane === 'diff'}
              className={`btn btn-sm ${mobilePane === 'diff' ? 'is-active' : ''}`}
              onClick={() => setMobilePane('diff')}
            >
              Diff
            </button>
          </div>

          <button type="button" className="btn btn-sm" onClick={handleRefresh} title="Atualizar status">
            ↻ Atualizar
          </button>

          <div className="git-menu-wrap">
            <button
              type="button"
              className="btn btn-sm"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              ⋯ Mais
            </button>
            {menuOpen && (
              <div className="git-overflow-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={unstaged.length === 0}
                  onClick={() => {
                    send({ type: 'git-stage', paths: unstaged.map((f) => f.path) })
                    setMenuOpen(false)
                  }}
                >
                  + Stage All ({unstaged.length})
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={staged.length === 0}
                  onClick={() => {
                    send({ type: 'git-unstage', paths: staged.map((f) => f.path) })
                    setMenuOpen(false)
                  }}
                >
                  − Unstage All ({staged.length})
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    send({ type: 'git-push-preview' })
                    setMenuOpen(false)
                  }}
                >
                  ↑ Preparar Push...
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {notice && (
        <div className="git-banner git-banner-info" role="status">
          {notice}
        </div>
      )}

      {result && (
        <div className={`git-banner ${result.ok ? 'git-banner-ok' : 'git-banner-err'}`} role="status">
          <span>{result.message}</span>
          <button type="button" className="btn-link" onClick={() => setResult(null)}>
            fechar
          </button>
        </div>
      )}

      {preview && (
        <div className="git-push-confirm" role="dialog" aria-label="Confirmar push">
          <div>
            <strong>Push para {preview.target}</strong> ({preview.commits.length} commit(s))
          </div>
          <div className="git-push-confirm-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                send({ type: 'git-push', token: preview.token })
                setPreview(null)
              }}
            >
              Confirmar Push
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setPreview(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="git-workbench-body">
        <aside className={`git-sidebar ${mobilePane === 'files' ? 'is-mobile-visible' : 'is-mobile-hidden'}`}>
          <div className="git-side-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'changes'}
              className={`git-side-tab ${sideTab === 'changes' ? 'is-active' : ''}`}
              onClick={() => setSideTab('changes')}
            >
              Alterações
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'history'}
              className={`git-side-tab ${sideTab === 'history' ? 'is-active' : ''}`}
              onClick={() => setSideTab('history')}
            >
              Histórico & Branches
            </button>
          </div>

          {sideTab === 'changes' ? (
            <>
              <div className="git-commit-box">
                <textarea
                  className="git-commit-input"
                  rows={2}
                  placeholder="Mensagem do commit..."
                  aria-label="Mensagem do commit"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary git-commit-btn"
                  disabled={staged.length === 0 || !message.trim() || committing}
                  onClick={handleCommit}
                >
                  {committing ? 'Criando commit...' : `Commit (${staged.length} staged)`}
                </button>
              </div>

              <div className="git-file-groups">
                <div className="git-group">
                  <div className="git-group-header">
                    <span>Staged Changes ({staged.length})</span>
                    {staged.length > 0 && (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => send({ type: 'git-unstage', paths: staged.map((f) => f.path) })}
                        title="Remover todos do stage"
                      >
                        − Unstage All
                      </button>
                    )}
                  </div>
                  {staged.length === 0 ? (
                    <p className="git-group-empty">Nenhum arquivo preparado.</p>
                  ) : (
                    <ul className="git-file-list">
                      {staged.map((f) => {
                        const meta = fileStatusMeta(f.code)
                        const active = selection?.path === f.path && selection.staged
                        return (
                          <li key={`s:${f.path}`} className={`git-file-item ${active ? 'is-selected' : ''}`}>
                            <button type="button" className="git-file-select" onClick={() => selectFile(f, true)}>
                              <span className={`git-status-badge tone-${meta.tone}`} title={meta.label}>
                                {meta.badge}
                              </span>
                              <span className="git-file-name" title={f.path}>
                                {f.path}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="git-file-action"
                              title="Remover do stage"
                              aria-label={`Remover ${f.path} do stage`}
                              onClick={() => send({ type: 'git-unstage', paths: [f.path] })}
                            >
                              −
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>

                <div className="git-group">
                  <div className="git-group-header">
                    <span>Changes ({unstaged.length})</span>
                    {unstaged.length > 0 && (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => send({ type: 'git-stage', paths: unstaged.map((f) => f.path) })}
                        title="Adicionar todos ao stage"
                      >
                        + Stage All
                      </button>
                    )}
                  </div>
                  {unstaged.length === 0 ? (
                    <p className="git-group-empty">Nenhuma alteração pendente.</p>
                  ) : (
                    <ul className="git-file-list">
                      {unstaged.map((f) => {
                        const meta = fileStatusMeta(f.code)
                        const active = selection?.path === f.path && !selection.staged
                        const activity = activityByFile[f.path]
                        return (
                          <li key={`u:${f.path}`} className={`git-file-item ${active ? 'is-selected' : ''}`}>
                            <button type="button" className="git-file-select" onClick={() => selectFile(f, false)}>
                              <span className={`git-status-badge tone-${meta.tone}`} title={meta.label}>
                                {meta.badge}
                              </span>
                              <span className="git-file-name" title={f.path}>
                                {f.path}
                              </span>
                              {activity && (
                                <span className="git-activity-pill" title={activity.summary}>
                                  {activity.agentId || 'missão'}
                                </span>
                              )}
                            </button>
                            <button
                              type="button"
                              className="git-file-action"
                              title="Adicionar ao stage"
                              aria-label={`Adicionar ${f.path} ao stage`}
                              onClick={() => send({ type: 'git-stage', paths: [f.path] })}
                            >
                              +
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="git-history-pane">
              <div className="git-group">
                <div className="git-group-header">
                  <span>Branches ({branches.length})</span>
                </div>
                {branches.length === 0 ? (
                  <p className="git-group-empty">Nenhuma branch encontrada.</p>
                ) : (
                  <ul className="git-branch-list">
                    {branches.map((b) => (
                      <li key={b.name} className={`git-branch-item ${b.current ? 'is-current' : ''}`}>
                        <span>{b.current ? '● ' : '○ '}{b.name}</span>
                        {b.upstream && <span className="muted">{b.upstream}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="git-group">
                <div className="git-group-header">
                  <span>Commits recentes ({commits.length})</span>
                </div>
                {commits.length === 0 ? (
                  <p className="git-group-empty">Sem histórico de commits nesta branch.</p>
                ) : (
                  <ul className="git-commit-list">
                    {commits.map((c) => (
                      <li key={c.hash}>
                        <button
                          type="button"
                          className={`git-commit-item ${commitDetail?.hash === c.hash ? 'is-selected' : ''}`}
                          onClick={() => {
                            send({ type: 'git-commit-detail', hash: c.hash })
                            setMobilePane('diff')
                          }}
                        >
                          <div className="git-commit-subject">{c.subject}</div>
                          <div className="git-commit-meta">
                            <code>{c.shortHash}</code> · {c.author}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </aside>

        <main className={`git-main ${mobilePane === 'diff' ? 'is-mobile-visible' : 'is-mobile-hidden'}`}>
          {commitDetail ? (
            <DiffViewer
              title={`${commitDetail.shortHash} — ${commitDetail.subject}`}
              badge={`${commitDetail.files.length} arquivo(s)`}
              rawDiff={commitDetail.diff}
            />
          ) : selection && diff && diff.path === selection.path && diff.staged === selection.staged ? (
            <DiffViewer
              title={selection.path}
              badge={selection.staged ? 'Staged' : 'Unstaged'}
              rawDiff={diff.text}
            />
          ) : (
            <div className="git-main-empty">
              <h3>Visualizador de Diferenças</h3>
              <p className="muted">
                Selecione um arquivo em <strong>Changes</strong> ou <strong>Staged Changes</strong>, ou clique em um commit no <strong>Histórico</strong>.
              </p>
            </div>
          )}
        </main>
      </div>
    </section>
  )
}
