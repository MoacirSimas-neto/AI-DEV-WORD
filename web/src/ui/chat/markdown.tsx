import { Fragment, type ReactNode } from 'react'

// Markdown mínimo e seguro: só elementos React (o texto é sempre escapado pelo React; nada de
// innerHTML). Cobre o que o Tech Lead costuma escrever: parágrafos, títulos, listas, citações,
// blocos de código, `código`, **negrito**, *itálico* e links http(s).

const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i

/** Elementos inline: código, negrito, itálico e links. */
function inline(text: string, keyBase = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`\n]+`)|(\*\*[^*]{1,500}?\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]\n]+\]\([^)\s]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const token = m[0]
    const key = `${keyBase}-${k++}`
    if (m[1]) out.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={key}>{breaks(inline(token.slice(2, -2), key), key)}</strong>)
    else if (m[3]) out.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>)
    else {
      const [, label, url] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!
      out.push(
        SAFE_URL.test(url) ? (
          <a key={key} href={url} target="_blank" rel="noopener noreferrer nofollow">
            {label}
          </a>
        ) : (
          // Esquemas não http(s) (javascript:, data:, file:) ficam como texto.
          <Fragment key={key}>{token}</Fragment>
        ),
      )
    }
    last = m.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'hr' }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'para'; text: string }

const HR_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/
const PREFIXED_HEADING_RE = /^\s*(\[[^\]\n]{1,80}\]:)\s+(#{1,6})\s+(.*)$/

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++])
      i++ // fecha (ou fim do texto: bloco ainda chegando)
      blocks.push({ kind: 'code', lang: fence[1], text: body.join('\n') })
      continue
    }
    if (HR_RE.test(line)) {
      blocks.push({ kind: 'hr' })
      i++
      continue
    }
    const prefixedHeading = PREFIXED_HEADING_RE.exec(line)
    if (prefixedHeading) {
      blocks.push({ kind: 'para', text: prefixedHeading[1] })
      blocks.push({ kind: 'heading', level: prefixedHeading[2].length, text: prefixedHeading[3] })
      i++
      continue
    }
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      i++
      continue
    }
    const listMatch = /^\s*(?:([-*+])|(\d+)[.)])\s+/.exec(line)
    if (listMatch) {
      const ordered = Boolean(listMatch[2])
      const start = ordered ? Number.parseInt(listMatch[2], 10) : 1
      const itemRe = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/
      const items: string[] = []
      while (i < lines.length) {
        if (itemRe.test(lines[i])) {
          items.push(lines[i].replace(itemRe, ''))
          i++
          continue
        }
        // Mantém itens separados por linha em branco na mesma lista.
        if (!lines[i].trim() && i + 1 < lines.length && itemRe.test(lines[i + 1])) {
          i++
          continue
        }
        break
      }
      blocks.push({ kind: 'list', ordered, start, items })
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      blocks.push({ kind: 'quote', text: body.join('\n') })
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    const body: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !HR_RE.test(lines[i]) &&
      !PREFIXED_HEADING_RE.test(lines[i]) &&
      !/^\s*(```|#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/.test(lines[i])
    ) {
      body.push(lines[i++])
    }
    if (body.length === 0) body.push(lines[i++])
    blocks.push({ kind: 'para', text: body.join('\n') })
  }
  return blocks
}

/** Quebras de linha viram <br/> em qualquer nível (inclusive dentro de **negrito**). */
function breaks(nodes: ReactNode[], key: string): ReactNode[] {
  return nodes.flatMap((node, i): ReactNode[] => {
    if (typeof node !== 'string') return [node]
    return node.split('\n').flatMap((part, j): ReactNode[] => (j === 0 ? [part] : [<br key={`${key}-${i}-${j}`} />, part]))
  })
}

const withBreaks = (text: string, key: string) => breaks(inline(text, key), key)

/** Texto do chat renderizado como Markdown seguro. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="chat-md">
      {parseBlocks(text).map((b, i) => {
        const key = `b${i}`
        switch (b.kind) {
          case 'code':
            return (
              <pre key={key} className="chat-md-code" data-lang={b.lang || undefined}>
                <code>{b.text}</code>
              </pre>
            )
          case 'hr':
            return <hr key={key} />
          case 'heading': {
            const Tag = (['h3', 'h4', 'h5', 'h6'] as const)[Math.min(b.level - 1, 3)]
            return <Tag key={key}>{inline(b.text, key)}</Tag>
          }
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul'
            return (
              <Tag key={key} start={b.ordered && b.start !== 1 ? b.start : undefined}>
                {b.items.map((item, j) => (
                  <li key={j}>{inline(item, `${key}-${j}`)}</li>
                ))}
              </Tag>
            )
          }
          case 'quote':
            return <blockquote key={key}>{withBreaks(b.text, key)}</blockquote>
          default:
            return <p key={key}>{withBreaks(b.text, key)}</p>
        }
      })}
    </div>
  )
}
