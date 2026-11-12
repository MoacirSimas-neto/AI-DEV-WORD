// Redação de segredos por padrão. É uma rede de proteção, não uma garantia: um segredo sem
// formato reconhecível (ex.: uma senha qualquer sem rótulo) não é detectado.

export const SECRET_MARK = '[SEGREDO REMOVIDO]'

/** keep = quantos grupos iniciais ficam visíveis (ex.: "senha=" em "senha=xyz"). */
interface Pattern {
  re: RegExp
  keep?: boolean
}

const PATTERNS: Pattern[] = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { re: /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/g },
  { re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { re: /\bnpm_[A-Za-z0-9]{30,}/g },
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { re: /\bya29\.[0-9A-Za-z_-]{20,}/g },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { re: /\bAKIA[0-9A-Z]{16}\b/g },
  { re: /\b((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{12,}/gi, keep: true },
  // O prefixo opcional cobre nomes de variável de ambiente (GOOGLE_API_KEY=, DB_PASSWORD:).
  {
    re: /\b((?:[A-Za-z0-9]+_)*(?:password|passwd|pwd|senha|secret|token|api[_-]?key|client[_-]?secret)["']?\s*[:=]\s*)(["']?)(?!\[SEGREDO REMOVIDO\])[^\s"']{4,}\2/gi,
    keep: true,
  },
  { re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+(?=@)/gi, keep: true },
]

/** Intervalos [início, fim) de texto que parecem segredo. Sobrepostos são unidos. */
export function secretRanges(text: string): [number, number][] {
  const found: [number, number][] = []
  for (const { re, keep } of PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const start = m.index + (keep ? (m[1]?.length ?? 0) : 0)
      const end = m.index + m[0].length
      if (end > start) found.push([start, end])
      if (m[0].length === 0) re.lastIndex++
    }
  }
  found.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of found) {
    const last = merged.at(-1)
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

/** Tira dos textos o que parece credencial, antes de gravar, encaminhar ou mostrar. */
export function redact(text: string): string {
  const ranges = secretRanges(text)
  let out = text
  for (let i = ranges.length - 1; i >= 0; i--) out = out.slice(0, ranges[i][0]) + SECRET_MARK + out.slice(ranges[i][1])
  return out
}

// ---------- saída ao vivo (PTY e CLIs headless) ----------

// CSI, OSC (terminado por BEL ou ST) e escapes de 2 caracteres.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g
// Escape começado e ainda não terminado no fim do pedaço.
const PARTIAL_ANSI = /\x1b(?:\[[0-?]*[ -/]*|\][^\x07\x1b]*)?$/
// Fim de texto que pode ser o começo de um segredo ainda chegando.
const SUSPECT_TAIL =
  /(?:\b(?:sk|rk|pk)[-_]\S*|\bnpm_\S*|\beyJ\S*|\bgh[pousr]_\S*|\bgithub_pat_\S*|\bAIza\S*|\bya29\.\S*|\bxox[abprs]-\S*|\bAKIA\S*|\b(?:Bearer|Basic)\s+\S*|-----BEGIN [A-Z ]*PRIVATE KEY-----(?:(?!-----END [A-Z ]*PRIVATE KEY-----)[\s\S])*|\b(?:[A-Za-z0-9]+_)*(?:password|passwd|pwd|senha|secret|token|api[_-]?key|client[_-]?secret)["']?\s*[:=]\s*\S*|\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]*)$/i
const TOKEN_TAIL = /[A-Za-z0-9_\-.+/=:@'"]+$/
const TOKEN_CHAR = /[A-Za-z0-9_\-.+/=:@'"]/
const CONTEXT_MAX = 256
const MAX_HOLD = 8192

/** Texto visível (sem ANSI) e, para cada caractere visível, a posição dele no texto bruto. */
function visible(raw: string): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  let i = 0
  ANSI.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ANSI.exec(raw))) {
    for (; i < m.index; i++) {
      text += raw[i]
      map.push(i)
    }
    i = m.index + m[0].length
  }
  for (; i < raw.length; i++) {
    text += raw[i]
    map.push(i)
  }
  map.push(raw.length)
  return { text, map }
}

/**
 * Redator de fluxo. A saída bruta continua com o backend (o parser da proposta precisa dela);
 * o que vai para a tela, o WebSocket e o histórico de rolagem passa por aqui.
 * - Segredo partido entre pedaços: o final suspeito é retido até chegar o resto (ou o tempo
 *   acabar), e o que já saiu serve de contexto para redigir a continuação.
 * - ANSI: a detecção roda sobre o texto visível; a cor/cursor fora do segredo é preservada.
 * Limite conhecido: num fluxo lento (pausa maior que a retenção) que parta um segredo antes de
 * ele ficar reconhecível, os primeiros caracteres podem sair antes da detecção.
 */
export class LiveRedactor {
  private pending = ''
  private context = ''
  private suspicious = false

  /** Texto seguro para mostrar agora. */
  push(chunk: string): string {
    const buf = this.pending + chunk
    const cut = this.holdPoint(buf)
    this.pending = buf.slice(cut)
    return this.release(buf.slice(0, cut))
  }

  /** Libera o que estava retido (tempo esgotado ou fim do processo), já redigido. */
  flush(): string {
    const raw = this.pending
    this.pending = ''
    this.suspicious = false
    return this.release(raw)
  }

  /** Quanto esperar antes de liberar o que está retido; null = nada retido. */
  holdMs(): number | null {
    if (!this.pending) return null
    return this.suspicious ? 1500 : 60
  }

  private holdPoint(buf: string): number {
    const partial = PARTIAL_ANSI.exec(buf)
    let cut = partial ? partial.index : buf.length
    const { text, map } = visible(buf.slice(0, cut))
    // O contexto já emitido conta: "sk-pr" + "oj-..." continua suspeito.
    const joined = this.context + text
    const suspect = SUSPECT_TAIL.exec(joined.slice(-MAX_HOLD))
    const token = TOKEN_TAIL.exec(text)
    this.suspicious = false
    let holdFrom = text.length
    if (suspect) {
      const startInJoined = joined.length - Math.min(joined.length, MAX_HOLD) + suspect.index
      holdFrom = Math.max(0, startInJoined - this.context.length)
      this.suspicious = true
    }
    if (token) holdFrom = Math.min(holdFrom, token.index)
    cut = Math.min(cut, map[holdFrom])
    // Nada fica preso para sempre: acima do limite, sai redigido.
    if (buf.length - cut > MAX_HOLD) return buf.length
    return cut
  }

  private release(raw: string): string {
    if (!raw) return ''
    const { text, map } = visible(raw)
    const ctx = this.context
    const ranges = secretRanges(ctx + text)
    let out = raw
    let endedInSecret = false
    for (let i = ranges.length - 1; i >= 0; i--) {
      const s = Math.max(ranges[i][0] - ctx.length, 0)
      const e = ranges[i][1] - ctx.length
      if (e <= 0) continue
      // Termina logo após o último caractere do segredo: o reset de cor que vem depois fica.
      out = out.slice(0, map[s]) + SECRET_MARK + out.slice(map[e - 1] + 1)
      if (e === text.length) endedInSecret = true
    }
    // Contexto = palavra visível em curso no fim do que saiu (para redigir a continuação).
    const tail = TOKEN_TAIL.exec(text)?.[0] ?? ''
    if (endedInSecret) this.context = ''
    else if (tail.length === text.length && text.length > 0 && TOKEN_CHAR.test(text[0])) this.context = (ctx + tail).slice(-CONTEXT_MAX)
    else this.context = tail.slice(-CONTEXT_MAX)
    return out
  }
}

/**
 * Liga o redator a um destino com o temporizador de liberação.
 * write() a cada pedaço bruto; end() no fim do processo.
 */
export function liveRedaction(emit: (safe: string) => void) {
  const redactor = new LiveRedactor()
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    clearTimeout(timer)
    const ms = redactor.holdMs()
    if (ms !== null) {
      timer = setTimeout(() => {
        const out = redactor.flush()
        if (out) emit(out)
      }, ms)
    }
  }
  return {
    write(chunk: string) {
      const out = redactor.push(chunk)
      if (out) emit(out)
      schedule()
    },
    end() {
      clearTimeout(timer)
      const out = redactor.flush()
      if (out) emit(out)
    },
  }
}
