export interface DiffLine {
  type: 'ctx' | 'add' | 'del' | 'hunk' | 'meta'
  oldNum: number | null
  newNum: number | null
  text: string
}

export function parseUnifiedDiff(raw: string): {
  lines: DiffLine[]
  added: number
  removed: number
  isBinary: boolean
  isTruncated: boolean
} {
  if (!raw.trim()) {
    return { lines: [], added: 0, removed: 0, isBinary: false, isTruncated: false }
  }
  const isBinary =
    raw.includes('Arquivo binário — visualização textual indisponível') ||
    /^Binary files .* differ$/m.test(raw)
  const isTruncated = raw.includes('… diff cortado por ser muito grande …')
  if (isBinary) {
    return { lines: [], added: 0, removed: 0, isBinary: true, isTruncated: false }
  }

  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let added = 0
  let removed = 0

  for (const rawLine of raw.split(/\r?\n/)) {
    if (rawLine.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine)
      if (match) {
        oldLine = Number(match[1])
        newLine = Number(match[2])
      }
      lines.push({ type: 'hunk', oldNum: null, newNum: null, text: rawLine })
    } else if (
      rawLine.startsWith('diff --git') ||
      rawLine.startsWith('index ') ||
      rawLine.startsWith('--- ') ||
      rawLine.startsWith('+++ ') ||
      rawLine.startsWith('new file mode') ||
      rawLine.startsWith('deleted file mode') ||
      rawLine.startsWith('rename from') ||
      rawLine.startsWith('rename to')
    ) {
      lines.push({ type: 'meta', oldNum: null, newNum: null, text: rawLine })
    } else if (rawLine.startsWith('+')) {
      added += 1
      lines.push({ type: 'add', oldNum: null, newNum: newLine++, text: rawLine.slice(1) })
    } else if (rawLine.startsWith('-')) {
      removed += 1
      lines.push({ type: 'del', oldNum: oldLine++, newNum: null, text: rawLine.slice(1) })
    } else {
      const content = rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine
      lines.push({ type: 'ctx', oldNum: oldLine++, newNum: newLine++, text: content })
    }
  }

  return { lines, added, removed, isBinary: false, isTruncated }
}
