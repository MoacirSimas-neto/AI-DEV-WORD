import { useEffect, useState } from 'react'
import type { GitFile, GitStatus, PushPreview } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'

const KIND: Record<string, string> = {
  M: 'modificado',
  A: 'novo',
  '?': 'novo',
  D: 'apagado',
  R: 'renomeado',
  C: 'copiado',
  U: 'conflito',
  T: 'tipo mudou',
}

interface Selection {
  path: string
  staged: boolean
}

interface Props {
  status: GitStatus | null
  send: Send
  subscribe: Subscribe
  onClose: () => void
}

/** Alterações do projeto ativo: ver diff, preparar, fazer commit e enviar (com confirmação). */
export function GitPanel({ status, send, subscribe, onClose }: Props) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [diff, setDiff] = useState<(Selection & { text: string }) | null>(null)
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<PushPreview | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(
    () =>
      subscribe((incoming) => {
        if (incoming.type === 'git-diff') setDiff(incoming)
        if (incoming.type === 'git-push-preview') setPreview(incoming.preview)
        if (incoming.type === 'git-result') {
          setResult(incoming)
          if (incoming.ok && incoming.message.startsWith('Commit')) setMessage('')
        }
      }),
    [subscribe],
  )

  // Pede o diff do arquivo escolhido e o renova quando o estado muda (o agente pode ter editado).
  useEffect(() => {
    if (selection) send({ type: 'git-diff', path: selection.path, staged: selection.staged })
  }, [selection, status, send])

  const files = status?.files ?? []
  const staged = files.filter((f) => f.staged)
  const unstaged = files.filter((f) => f.unstaged)
  const shownDiff =
    selection &&
    diff?.path === selection.path &&
    diff.staged === selection.staged &&
    (selection.staged ? staged : unstaged).some((f) => f.path === selection.path)
      ? diff.text
      : null
  const canPush = !!status?.branch && (status.ahead > 0 || !status.upstream)

  const act = (action: () => void) => {
    setResult(null)
    setPreview(null)
    action()
  }

  const fileList = (list: GitFile[], isStaged: boolean) =>
    list.map((file) => {
      const active = selection?.path === file.path && selection.staged === isStaged
      return (
        <li key={file.path} className={active ? 'git-file git-file-active' : 'git-file'}>
          <button
            type="button"
            className="git-file-name"
            aria-pressed={active}
            onClick={() => setSelection({ path: file.path, staged: isStaged })}
          >
            <span className="git-kind">{KIND[file.code[isStaged ? 0 : 1]] ?? file.code.trim()}</span>
            {file.path}
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
    <aside className="window">
      <header className="window-head">
        <div className="window-id">
          <h2>Alterações</h2>
          <p>{status?.isRepo ? branchLine(status) : 'Git do projeto ativo'}</p>
        </div>
        <button type="button" className="btn-quiet window-close" aria-label="Fechar painel" onClick={onClose}>
          ×
        </button>
      </header>

      {!status && <p className="window-message">Escolha um projeto para ver as alterações dele.</p>}
      {status && !status.isRepo && (
        <p className="window-message">
          Esta pasta ainda não é um repositório Git. Rode <code>git init</code> nela para acompanhar as alterações por aqui.
        </p>
      )}

      {status?.isRepo && (
        <>
          <section>
            <div className="git-heading">
              <h3>Preparado para o commit</h3>
              <span>{staged.length}</span>
            </div>
            {staged.length === 0 ? (
              <p className="git-empty">Nada preparado. Use "Preparar" nos arquivos abaixo.</p>
            ) : (
              <ul className="git-files">{fileList(staged, true)}</ul>
            )}
          </section>

          <section>
            <div className="git-heading">
              <h3>Alterado, ainda não preparado</h3>
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
              <p className="git-empty">Nenhuma alteração pendente.</p>
            ) : (
              <ul className="git-files">{fileList(unstaged, false)}</ul>
            )}
            {status.truncated && <p className="git-empty">Há mais arquivos do que cabe na lista.</p>}
          </section>

          {shownDiff !== null && <DiffView text={shownDiff} />}

          <section className="git-commit">
            <textarea
              aria-label="Mensagem do commit"
              placeholder="Mensagem do commit"
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button
              type="button"
              disabled={staged.length === 0 || !message.trim()}
              onClick={() => act(() => send({ type: 'git-commit', message }))}
            >
              Fazer commit
            </button>
          </section>

          <section className="git-push">
            <p>{pushLine(status)}</p>
            <button type="button" className="btn-quiet" disabled={!canPush} onClick={() => act(() => send({ type: 'git-push-preview' }))}>
              Enviar para o remoto…
            </button>
          </section>

          {preview && (
            <section className="git-confirm" role="alertdialog" aria-label="Confirmar push">
              <p>
                <strong>
                  Enviar {preview.commits.length} {preview.commits.length === 1 ? 'commit' : 'commits'} de{' '}
                  {preview.branch} para {preview.target}?
                </strong>
              </p>
              <ul>
                {preview.commits.map((commit) => (
                  <li key={commit}>{commit}</li>
                ))}
              </ul>
              {preview.setsUpstream && <p>Esta branch ainda não existe no remoto; ela será criada lá.</p>}
              <div className="git-confirm-actions">
                <button
                  type="button"
                  onClick={() => {
                    send({ type: 'git-push', token: preview.token })
                    setPreview(null)
                  }}
                >
                  Confirmar envio
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

function branchLine(status: GitStatus) {
  if (!status.branch) return 'Sem branch ativa'
  return status.upstream ? `Branch ${status.branch}, acompanha ${status.upstream}` : `Branch ${status.branch}, sem remoto ligado`
}

function pushLine(status: GitStatus) {
  if (!status.branch) return 'Sem branch ativa: não há o que enviar.'
  if (!status.upstream) return 'Esta branch ainda não foi enviada para um remoto.'
  const parts = []
  if (status.ahead) parts.push(`${status.ahead} à frente`)
  if (status.behind) parts.push(`${status.behind} atrás`)
  return parts.length ? `${parts.join(' e ')} de ${status.upstream}.` : `Em dia com ${status.upstream}.`
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
