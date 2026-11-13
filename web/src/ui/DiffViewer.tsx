import { useMemo, useState } from 'react'
import { parseUnifiedDiff, type DiffLine } from './diffParser.ts'

interface SidePair {
  left: DiffLine | null
  right: DiffLine | null
}

function toSideBySide(lines: DiffLine[]): SidePair[] {
  const pairs: SidePair[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.type === 'hunk' || line.type === 'meta' || line.type === 'ctx') {
      pairs.push({ left: line, right: line })
      i += 1
      continue
    }
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (i < lines.length && lines[i].type === 'del') {
      dels.push(lines[i])
      i += 1
    }
    while (i < lines.length && lines[i].type === 'add') {
      adds.push(lines[i])
      i += 1
    }
    const max = Math.max(dels.length, adds.length)
    for (let k = 0; k < max; k++) {
      pairs.push({ left: dels[k] ?? null, right: adds[k] ?? null })
    }
  }
  return pairs
}

interface Props {
  title: string
  badge?: string
  rawDiff: string
}

export function DiffViewer({ title, badge, rawDiff }: Props) {
  const [mode, setMode] = useState<'split' | 'unified'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 900 ? 'unified' : 'split',
  )
  const parsed = useMemo(() => parseUnifiedDiff(rawDiff), [rawDiff])
  const pairs = useMemo(() => (mode === 'split' ? toSideBySide(parsed.lines) : []), [mode, parsed.lines])

  return (
    <div className="git-diff-viewer">
      <div className="git-diff-header">
        <div className="git-diff-title-row">
          <span className="git-diff-path" title={title}>
            {title}
          </span>
          {badge && <span className="git-diff-badge">{badge}</span>}
          {!parsed.isBinary && (parsed.added > 0 || parsed.removed > 0) && (
            <span className="git-diff-stats">
              <span className="git-stat-add">+{parsed.added}</span>
              <span className="git-stat-del">-{parsed.removed}</span>
            </span>
          )}
        </div>
        {!parsed.isBinary && parsed.lines.length > 0 && (
          <div className="git-diff-mode-toggle" role="group" aria-label="Modo de visualização do diff">
            <button
              type="button"
              className={`btn btn-sm ${mode === 'split' ? 'is-active' : ''}`}
              onClick={() => setMode('split')}
            >
              Lado a lado
            </button>
            <button
              type="button"
              className={`btn btn-sm ${mode === 'unified' ? 'is-active' : ''}`}
              onClick={() => setMode('unified')}
            >
              Unificado
            </button>
          </div>
        )}
      </div>

      {parsed.isTruncated && (
        <div className="git-diff-notice" role="status">
          Diff grande: exibindo apenas o início para manter o desempenho.
        </div>
      )}

      {parsed.isBinary ? (
        <div className="git-diff-empty">Arquivo binário — visualização textual indisponível.</div>
      ) : parsed.lines.length === 0 ? (
        <div className="git-diff-empty">Sem diferenças textuais para exibir.</div>
      ) : mode === 'unified' ? (
        <div className="git-diff-scroll">
          <table className="git-diff-table" aria-label="Diferenças unificadas">
            <tbody>
              {parsed.lines.map((line, idx) => (
                <tr key={idx} className={`diff-row diff-${line.type}`}>
                  <td className="diff-ln">{line.oldNum ?? ''}</td>
                  <td className="diff-ln">{line.newNum ?? ''}</td>
                  <td className="diff-sign">
                    {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ''}
                  </td>
                  <td className="diff-code">{line.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="git-diff-scroll">
          <table className="git-diff-table git-diff-split" aria-label="Diferenças lado a lado">
            <tbody>
              {pairs.map((pair, idx) => (
                <tr key={idx} className="diff-split-row">
                  <td className={`diff-ln diff-${pair.left?.type ?? 'empty'}`}>{pair.left?.oldNum ?? ''}</td>
                  <td className={`diff-code diff-${pair.left?.type ?? 'empty'}`}>
                    {pair.left?.type === 'del' ? `- ${pair.left.text}` : pair.left?.text ?? ''}
                  </td>
                  <td className={`diff-ln diff-${pair.right?.type ?? 'empty'}`}>{pair.right?.newNum ?? ''}</td>
                  <td className={`diff-code diff-${pair.right?.type ?? 'empty'}`}>
                    {pair.right?.type === 'add' ? `+ ${pair.right.text}` : pair.right?.text ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
