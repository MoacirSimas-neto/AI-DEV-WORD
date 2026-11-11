import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { GitFile, GitRemoteState, GitStatus, PushPreview } from '../../../shared/protocol.ts'
import { resolveCommand } from '../cli/resolve.ts'
import { runCli } from '../cli/run.ts'

const MAX_FILES = 400
const MAX_DIFF_CHARS = 200_000
const PUSH_TOKEN_TTL_MS = 2 * 60_000

const NOT_A_REPO: GitStatus = {
  isRepo: false,
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  files: [],
  truncated: false,
  remoteState: 'none',
  remoteName: null,
  remoteUrl: null,
  lastCommit: null,
}

/** Remove credenciais embutidas em URLs HTTP/HTTPS de remote Git. */
export function sanitizeRemoteUrl(url: string): string {
  return url.replace(/\/\/([^/@:]+)(?::[^/@]+)?@/, '//')
}

/** Interpreta a saída de `git remote -v` para classificar o estado remoto. */
export function parseRemotes(res: { code: number; stdout: string }): {
  remoteState: GitRemoteState
  remoteName: string | null
  remoteUrl: string | null
} {
  if (res.code !== 0) {
    return { remoteState: 'unknown', remoteName: null, remoteUrl: null }
  }
  const lines = res.stdout.split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) {
    return { remoteState: 'none', remoteName: null, remoteUrl: null }
  }
  const parsed = lines
    .map((line) => {
      const match = /^(\S+)\s+(\S+)/.exec(line)
      return match ? { name: match[1], url: sanitizeRemoteUrl(match[2]) } : null
    })
    .filter((r): r is { name: string; url: string } => r !== null)
  if (parsed.length === 0) {
    return { remoteState: 'none', remoteName: null, remoteUrl: null }
  }
  const preferred = parsed.find((r) => r.name === 'origin') ?? parsed[0]
  return {
    remoteState: 'configured',
    remoteName: preferred.name,
    remoteUrl: preferred.url,
  }
}

/** Interpreta a saída de `git status --porcelain=v1 -z --branch`. */
export function parseStatus(output: string): GitStatus {
  const entries = output.split('\0')
  const status: GitStatus = { ...NOT_A_REPO, isRepo: true, files: [] }

  const header = entries[0]?.startsWith('## ') ? entries.shift()!.slice(3) : ''
  const match = /^(?:No commits yet on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(header)
  if (match) {
    status.branch = match[1].startsWith('HEAD (') ? null : match[1]
    status.upstream = match[2] ?? null
    status.ahead = Number(/ahead (\d+)/.exec(match[3] ?? '')?.[1] ?? 0)
    status.behind = Number(/behind (\d+)/.exec(match[3] ?? '')?.[1] ?? 0)
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry.length < 4) continue
    const [x, y] = entry
    // Renomeações e cópias trazem o caminho antigo como entrada seguinte.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++
    if (x === '!') continue
    const file: GitFile = {
      path: entry.slice(3),
      code: x + y,
      staged: x !== ' ' && x !== '?',
      unstaged: y !== ' ',
    }
    if (status.files.length < MAX_FILES) status.files.push(file)
    else status.truncated = true
  }
  return status
}

interface PushApproval {
  cwd: string
  head: string
  args: string[]
  expires: number
}

/**
 * Operações Git sobre a pasta de um projeto, usando o `git` do sistema.
 * De propósito só existem operações não destrutivas: nada aqui descarta
 * alterações, reescreve histórico ou força um push.
 */
export class GitService {
  private readonly approvals = new Map<string, PushApproval>()
  private readonly executable: string | null

  constructor(executable: string | null = resolveCommand('git')) {
    this.executable = executable
  }

  async status(cwd: string): Promise<GitStatus> {
    const inside = await this.run(cwd, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true })
    if (inside.code !== 0) return NOT_A_REPO
    const [result, remoteRes, logRes] = await Promise.all([
      this.run(cwd, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all']),
      this.run(cwd, ['remote', '-v'], { allowFailure: true }),
      this.run(cwd, ['log', '-1', '--format=%h %s'], { allowFailure: true }),
    ])
    const parsed = parseStatus(result.stdout)
    const remoteInfo = parseRemotes(remoteRes)
    return {
      ...parsed,
      ...remoteInfo,
      lastCommit: logRes.code === 0 ? logRes.stdout.trim() || null : null,
    }
  }

  async diff(cwd: string, file: string, staged: boolean): Promise<string> {
    assertInside(cwd, file)
    let args: string[]
    if (staged) {
      args = ['diff', '--cached', '--', file]
    } else {
      const tracked = await this.run(cwd, ['ls-files', '--error-unmatch', '--', file], { allowFailure: true })
      // Arquivo novo ainda não rastreado: compara com "nada" para mostrar o conteúdo.
      args = tracked.code === 0 ? ['diff', '--', file] : ['diff', '--no-index', '--', '/dev/null', file]
    }
    const { stdout } = await this.run(cwd, ['-c', 'core.quotepath=off', ...args], { allowFailure: true })
    return stdout.length > MAX_DIFF_CHARS
      ? `${stdout.slice(0, MAX_DIFF_CHARS)}\n… diff cortado por ser muito grande …\n`
      : stdout
  }

  async stage(cwd: string, files: string[]) {
    for (const file of files) assertInside(cwd, file)
    await this.run(cwd, ['add', '--', ...files])
  }

  async unstage(cwd: string, files: string[]) {
    for (const file of files) assertInside(cwd, file)
    const hasCommits = (await this.run(cwd, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true })).code === 0
    // Antes do primeiro commit não existe HEAD para o `restore` comparar.
    await this.run(cwd, hasCommits ? ['restore', '--staged', '--', ...files] : ['rm', '--cached', '-q', '--', ...files])
  }

  /** Cria um commit com o que está preparado e devolve o resumo dele. */
  async commit(cwd: string, message: string): Promise<string> {
    const text = message.trim()
    if (!text) throw new Error('Escreva a mensagem do commit.')
    await this.run(cwd, ['commit', '-m', text])
    return (await this.run(cwd, ['log', '-1', '--format=%h %s'])).stdout.trim()
  }

  /** Descreve o que um push faria e emite o token que autoriza exatamente isso. */
  async previewPush(cwd: string): Promise<PushPreview> {
    const status = await this.status(cwd)
    if (!status.isRepo) throw new Error('Esta pasta não é um repositório Git.')
    if (!status.branch) throw new Error('Não há branch ativa (HEAD destacado).')
    const head = await this.run(cwd, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true })
    if (head.code !== 0) throw new Error('Ainda não há commits para enviar.')

    let args = ['push']
    let target = status.upstream
    let range = `${status.upstream}..HEAD`
    if (!target) {
      const remotes = (await this.run(cwd, ['remote'])).stdout.split(/\r?\n/).filter(Boolean)
      if (remotes.length === 0) throw new Error('Nenhum repositório remoto configurado neste projeto.')
      const remote = remotes.includes('origin') ? 'origin' : remotes[0]
      args = ['push', '--set-upstream', remote, status.branch]
      target = `${remote}/${status.branch}`
      range = 'HEAD'
    }
    const log = await this.run(cwd, ['log', '--format=%h %s', '-n', '50', range])
    const commits = log.stdout.split(/\r?\n/).filter(Boolean)
    if (commits.length === 0) throw new Error('Nada para enviar: o remoto já tem todos os commits.')

    const token = randomUUID()
    this.approvals.set(token, { cwd, head: head.stdout.trim(), args, expires: Date.now() + PUSH_TOKEN_TTL_MS })
    return { token, branch: status.branch, target, setsUpstream: !status.upstream, commits }
  }

  /** Só executa com um token de previewPush ainda válido e se nada mudou desde a prévia. */
  async push(cwd: string, token: string): Promise<string> {
    const approval = this.approvals.get(token)
    this.approvals.delete(token)
    const head = await this.run(cwd, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true })
    if (!approval || approval.cwd !== cwd || approval.expires < Date.now() || approval.head !== head.stdout.trim()) {
      throw new Error('A confirmação expirou ou o repositório mudou. Confira o push de novo.')
    }
    const result = await this.run(cwd, approval.args, { timeoutMs: 120_000 })
    const lines = (result.stderr || result.stdout).trim().split(/\r?\n/)
    return lines[lines.length - 1] || 'Push concluído.'
  }

  private async run(cwd: string, args: string[], options: { allowFailure?: boolean; timeoutMs?: number } = {}) {
    if (!this.executable) throw new Error('O Git não foi encontrado no PATH.')
    const result = await runCli(this.executable, args, {
      cwd,
      timeoutMs: options.timeoutMs,
      // Sem terminal para digitar senha: é melhor falhar do que ficar esperando.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    })
    if (result.code !== 0 && !options.allowFailure) {
      throw new Error((result.stderr || result.stdout).trim() || `git ${args[0]} falhou (código ${result.code}).`)
    }
    return result
  }
}

/** Os caminhos vêm do navegador: precisam ser relativos e ficar dentro do projeto. */
function assertInside(cwd: string, file: string) {
  const resolved = path.resolve(cwd, file)
  if (path.isAbsolute(file) || !resolved.startsWith(path.resolve(cwd) + path.sep)) {
    throw new Error(`Caminho fora do projeto: ${file}`)
  }
}
