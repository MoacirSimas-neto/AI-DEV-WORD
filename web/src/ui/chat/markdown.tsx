import { Fragment, type ReactNode } from 'react'

// Markdown mínimo e seguro: só elementos React (o texto é sempre escapado pelo React; nada de
// innerHTML). Cobre o que o Tech Lead costuma escrever: parágrafos, títulos, listas, citações,
// blocos de código, `código`, **negrito**, *itálico* e links http(s).

const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i

/** Elementos inline: código, negrito, itálico e links. */
function inline(text: string, keyBase = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]\n]+\]\([^)\s]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const token = m[0]
    const key = `${keyBase}-${k++}`
    if (m[1]) out.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={key}>{inline(token.slice(2, -2), key)}</strong>)
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
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'para'; text: string }

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
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      i++
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items: string[] = []
      // A lista segue enquanto o tipo de marcador (com ou sem número) for o mesmo.
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/).test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''))
        i++
      }
      blocks.push({ kind: 'list', ordered, items })
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
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|[-*+]\s|\d+[.)]\s|>)/.test(lines[i])) body.push(lines[i++])
    if (body.length === 0) body.push(lines[i++])
    blocks.push({ kind: 'para', text: body.join('\n') })
  }
  return blocks
}

const withBreaks = (text: string, key: string) =>
  text.split('\n').map((part, i) => (
    <Fragment key={`${key}-${i}`}>
      {i > 0 && <br />}
      {inline(part, `${key}-${i}`)}
    </Fragment>
  ))

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
          case 'heading': {
            const Tag = (['h3', 'h4', 'h5', 'h6'] as const)[b.level - 1]
            return <Tag key={key}>{inline(b.text, key)}</Tag>
          }
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul'
            return (
              <Tag key={key}>
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
