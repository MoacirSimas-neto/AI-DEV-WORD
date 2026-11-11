import { execFile } from 'node:child_process'

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
