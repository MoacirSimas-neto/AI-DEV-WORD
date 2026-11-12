import { closeSync, openSync, readSync, statSync } from 'node:fs'
import path from 'node:path'
import type { CliId } from '../../../shared/protocol.ts'

/** Marcador obrigatório dentro de todo executável simulado (ex.: numa linha REM do .cmd). */
export const SIMULATED_MARKER = 'AIDW-SIMULATED-CLI'
const COMMANDS: Record<CliId, string> = { codex: 'codex', gemini: 'gemini', agy: 'agy' }
const EXTENSIONS = process.platform === 'win32' ? ['.cmd', '.bat', '.exe'] : ['']

export type CliMode = { kind: 'real' } | { kind: 'simulated'; dir: string }

/**
 * AIDW_CLI_MODE=simulated + AIDW_SIMULATED_CLI_DIR: só executáveis marcados daquela pasta.
 * Nunca recorre ao PATH: um CLI simulado ausente fica ausente (e a inicialização falha).
 */
export function cliMode(env: NodeJS.ProcessEnv = process.env): CliMode {
  if (env.AIDW_CLI_MODE !== 'simulated') {
    if (env.AIDW_CLI_MODE && env.AIDW_CLI_MODE !== 'real') throw new Error(`AIDW_CLI_MODE inválido: ${env.AIDW_CLI_MODE} (use "real" ou "simulated").`)
    return { kind: 'real' }
  }
  const dir = env.AIDW_SIMULATED_CLI_DIR ?? ''
  if (!dir || !path.isAbsolute(dir)) throw new Error('AIDW_CLI_MODE=simulated exige AIDW_SIMULATED_CLI_DIR com o caminho absoluto dos CLIs simulados.')
  return { kind: 'simulated', dir }
}

function hasMarker(file: string): boolean {
  let fd: number | undefined
  try {
    if (!statSync(file).isFile()) return false
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(4096)
    const n = readSync(fd, buf, 0, buf.length, 0)
    return buf.subarray(0, n).toString('latin1').includes(SIMULATED_MARKER)
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** Executável simulado e marcado para o CLI, ou null. */
export function findSimulatedCli(cli: CliId, dir: string): string | null {
  for (const ext of EXTENSIONS) {
    const candidate = path.join(dir, COMMANDS[cli] + ext)
    if (hasMarker(candidate)) return candidate
  }
  return null
}

/** Na inicialização em modo simulado: todos os CLIs precisam existir e estar marcados. */
export function requireSimulatedClis(dir: string): Record<CliId, string> {
  const found = {} as Record<CliId, string>
  const missing: string[] = []
  for (const cli of Object.keys(COMMANDS) as CliId[]) {
    const file = findSimulatedCli(cli, dir)
    if (file) found[cli] = file
    else missing.push(cli)
  }
  if (missing.length) {
    throw new Error(
      `Modo simulado: CLI simulado ausente ou sem o marcador ${SIMULATED_MARKER} em ${dir}: ${missing.join(', ')}. ` +
        'Nenhum CLI real foi usado no lugar.',
    )
  }
  return found
}
