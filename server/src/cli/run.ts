import { type ChildProcess, execFile, spawn } from 'node:child_process'

export interface CliResult {
  code: number
  stdout: string
  stderr: string
}

export interface SpawnPlan {
  file: string
  args: string[]
  verbatim: boolean
}

export interface RunOptions {
  timeoutMs?: number
  cwd?: string
  env?: NodeJS.ProcessEnv
}

// Quando o comando passa por cmd.exe, só aceitamos tokens simples para que
// nada possa ser interpretado como metacaractere do shell.
const SAFE_ARG = /^[\w.-]+$/

/**
 * O Node recusa executar .cmd/.bat diretamente (proteção contra injeção), então
 * no Windows esses shims rodam via `cmd.exe /d /s /c ""caminho" args"`.
 * Executáveis de verdade (.exe, binários no Linux) recebem os argumentos como
 * lista, sem shell, e por isso aceitam qualquer texto com segurança.
 */
export function planSpawn(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comspec: string = process.env.ComSpec ?? 'cmd.exe',
): SpawnPlan {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    for (const arg of args) {
      if (!SAFE_ARG.test(arg)) throw new Error(`Argumento não permitido: ${arg}`)
    }
    if (/["%&|<>^]/.test(executable)) throw new Error('Caminho de executável não permitido')
    const line = [`"${executable}"`, ...args].join(' ')
    return { file: comspec, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true }
  }
  return { file: executable, args, verbatim: false }
}

/** Executa um programa até terminar. Não rejeita por código de saída != 0. */
export function runCli(executable: string, args: string[], options: RunOptions = {}): Promise<CliResult> {
  const plan = planSpawn(executable, args)
  return new Promise((resolve, reject) => {
    execFile(
      plan.file,
      plan.args,
      {
        timeout: options.timeoutMs ?? 20_000,
        cwd: options.cwd,
        env: options.env,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        windowsVerbatimArguments: plan.verbatim,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error.killed ? new Error(`Tempo esgotado executando ${executable}`) : error)
          return
        }
        resolve({ code: error ? (error.code as number) : 0, stdout, stderr })
      },
    )
  })
}

export interface StartOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  /** Texto enviado pela entrada padrão (o prompt do agente). */
  input?: string
  timeoutMs?: number
  /** Cada pedaço de saída (stdout e stderr), assim que chega. */
  onOutput?: (text: string) => void
}

export interface RunningCli {
  done: Promise<CliResult & { timedOut: boolean }>
  /** Encerra o processo e os filhos dele. */
  kill(): void
}

const MAX_CAPTURE = 1_000_000

/**
 * Inicia um CLI sem terminal, entregando o prompt pela entrada padrão: no
 * Windows o shim .cmd não aceita texto livre como argumento (ver planSpawn).
 */
export function startCli(executable: string, args: string[], options: StartOptions): RunningCli {
  const plan = planSpawn(executable, args)
  const child = spawn(plan.file, plan.args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    windowsHide: true,
    windowsVerbatimArguments: plan.verbatim,
  })
  let stdout = ''
  let stderr = ''
  let timedOut = false
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout = (stdout + chunk).slice(-MAX_CAPTURE)
    options.onOutput?.(chunk)
  })
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-MAX_CAPTURE)
    options.onOutput?.(chunk)
  })
  child.stdin.on('error', () => {}) // o processo pode sair antes de ler tudo
  child.stdin.end(options.input ?? '')

  const kill = () => killTree(child)
  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true
        kill()
      }, options.timeoutMs)
    : undefined
  const done = new Promise<CliResult & { timedOut: boolean }>((resolve, reject) => {
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr, timedOut })
    })
  })
  return { done, kill }
}

/** No Windows o CLI roda como neto (cmd.exe -> node): só o taskkill /T derruba a árvore. */
function killTree(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
  } else {
    child.kill('SIGTERM')
  }
}
