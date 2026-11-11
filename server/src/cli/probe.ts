import type { AuthState, CliId } from '../../../shared/protocol.ts'
import { resolveCommand } from './resolve.ts'
import { runCli } from './run.ts'

export interface ProbeResult {
  found: boolean
  version: string | null
  auth: AuthState
}

export type CliProbe = (cli: CliId) => Promise<ProbeResult>

interface CliSpec {
  command: string
  versionArgs: string[]
  /** Comando oficial que sai com 0 quando há login. Ausente = não dá para saber. */
  authArgs?: string[]
}

const CATALOG: Record<CliId, CliSpec> = {
  codex: { command: 'codex', versionArgs: ['--version'], authArgs: ['login', 'status'] },
  gemini: { command: 'gemini', versionArgs: ['--version'] },
}

/** Consulta o CLI real instalado: existe? qual versão? está logado? */
export const probeCli: CliProbe = async (cli) => {
  const spec = CATALOG[cli]
  const executable = resolveCommand(spec.command)
  if (!executable) return { found: false, version: null, auth: 'unknown' }

  const version = await runCli(executable, spec.versionArgs)
  const firstLine = version.stdout.trim().split(/\r?\n/)[0] || null

  let auth: AuthState = 'unknown'
  if (spec.authArgs) {
    // Só o código de saída é usado; a saída (que pode citar a conta) é descartada.
    const status = await runCli(executable, spec.authArgs)
    auth = status.code === 0 ? 'ok' : 'missing'
  }
  return { found: true, version: firstLine, auth }
}
