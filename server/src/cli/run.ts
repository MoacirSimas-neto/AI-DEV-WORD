import { type ChildProcess, execFile, spawn } from 'node:child_process'
import path from 'node:path'
import { getSupervisor } from './supervisor.ts'

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
const SAFE_ARG = /^[\w.=-]+$/

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
  /** Identifica o processo no supervisor (ex.: "missão #3 · dev"). */
  label?: string
}

export interface RunningCli {
  done: Promise<CliResult & { timedOut: boolean }>
  /** true = roda sob o guardião do supervisor (encerrado junto com o backend). */
  guarded?: boolean
  /** Encerra o processo e os filhos dele. */
  kill(): void
}

const MAX_CAPTURE = 1_000_000

/**
 * Inicia um CLI sem terminal, entregando o prompt pela entrada padrão: no
 * Windows o shim .cmd não aceita texto livre como argumento (ver planSpawn).
 */
export function startCli(executable: string, args: string[], options: StartOptions): RunningCli {
  const launch = guardedLaunch(planSpawn(executable, args), options.env ?? process.env, options.label ?? path.basename(executable))
  const child = spawn(launch.file, launch.args, {
    cwd: options.cwd,
    env: launch.env,
    windowsHide: true,
    windowsVerbatimArguments: launch.verbatim,
    // O guardião precisa sobreviver à queda do backend para encerrar o CLI:
    // - Windows: sem detached, o libuv põe o filho num Job Object que morre com o backend; o
    //   guardião morreria junto e o neto (cmd.exe -> node) escaparia do job (silent breakaway).
    // - Linux: detached faz o guardião liderar o próprio grupo; encerrar o grupo leva o CLI junto.
    detached: launch.guarded,
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

  const kill = () => killTree(child, launch.guarded)
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
  return { done, kill, guarded: launch.guarded }
}

/** Com supervisor instalado, o CLI roda sob o guardião; sem ele (testes unitários), direto. */
export function guardedLaunch(plan: SpawnPlan, env: NodeJS.ProcessEnv, label: string) {
  const supervisor = getSupervisor()
  if (!supervisor) return { ...plan, env, guarded: false }
  const reg = supervisor.register({ file: plan.file, args: plan.args, verbatim: plan.verbatim }, label)
  return { file: reg.command, args: reg.args, verbatim: false, env: { ...env, ...reg.env }, guarded: true }
}

/** No Windows o CLI roda como neto (cmd.exe -> node): só o taskkill /T derruba a árvore. */
function killTree(child: ChildProcess, groupLeader = false) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
  killTreeByPid(child.pid, groupLeader)
}

/** Encerra o processo e os descendentes dele (só a árvore que este backend iniciou). */
export function killTreeByPid(pid: number, groupLeader = false) {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  } else {
    try {
      process.kill(groupLeader ? -pid : pid, 'SIGTERM')
    } catch {}
  }
}
