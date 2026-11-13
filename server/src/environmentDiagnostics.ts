import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type DiagnosticStatus =
  | 'ready'
  | 'not_installed'
  | 'needs_config'
  | 'needs_auth'
  | 'incompatible'
  | 'unavailable'
  | 'error'

export interface ToolDiagnostic {
  id: 'git' | 'codex' | 'gemini' | 'claude'
  name: string
  purpose: string
  relevance: 'essential' | 'optional'
  status: DiagnosticStatus
  executablePath: string | null
  version: string | null
  authNote: string
  error?: string
}

export interface EnvironmentDiagnosticsResult {
  platform: NodeJS.Platform
  checkedAt: string
  tools: ToolDiagnostic[]
}

interface ToolSpec {
  id: ToolDiagnostic['id']
  name: string
  command: string
  purpose: string
  relevance: 'essential' | 'optional'
  requiresAuth: boolean
}

const TOOL_SPECS: ToolSpec[] = [
  {
    id: 'git',
    name: 'Git',
    command: 'git',
    purpose: 'Controle de versão, diffs e commits assistidos',
    relevance: 'essential',
    requiresAuth: false,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    purpose: 'Agente de implementação e edição de código',
    relevance: 'optional',
    requiresAuth: true,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    purpose: 'Agente de arquitetura, planejamento e revisão',
    relevance: 'optional',
    requiresAuth: true,
  },
  {
    id: 'claude',
    name: 'Claude Code CLI',
    command: 'claude',
    purpose: 'Agente alternativo de raciocínio e refatoração',
    relevance: 'optional',
    requiresAuth: true,
  },
]

const DEFAULT_TIMEOUT_MS = 2500

async function findExecutable(
  command: string,
  simulatedDir: string | undefined,
  timeoutMs: number
): Promise<string | null> {
  if (simulatedDir) {
    const candidates =
      process.platform === 'win32'
        ? [`${command}.cmd`, `${command}.exe`, command]
        : [command]
    for (const candidate of candidates) {
      const full = path.join(simulatedDir, candidate)
      if (existsSync(full)) return full
    }
    return null
  }

  const locator = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await execFileAsync(locator, [command], {
      timeout: timeoutMs,
      windowsHide: true,
    })
    const first = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    if (!first) return null
    accessSync(first, constants.F_OK)
    return first
  } catch {
    return null
  }
}

export async function probeTool(
  spec: ToolSpec,
  options: { timeoutMs?: number; simulatedDir?: string } = {}
): Promise<ToolDiagnostic> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const simulatedDir =
    options.simulatedDir ??
    (process.env.AIDW_CLI_MODE === 'simulated' ? process.env.AIDW_SIMULATED_CLI_DIR : undefined)

  const executablePath = await findExecutable(spec.command, simulatedDir, timeoutMs)
  if (!executablePath) {
    return {
      id: spec.id,
      name: spec.name,
      purpose: spec.purpose,
      relevance: spec.relevance,
      status: 'not_installed',
      executablePath: null,
      version: null,
      authNote: spec.requiresAuth ? 'Instale a CLI para configurar depois.' : 'Opcional para recursos Git.',
    }
  }

  try {
    const isWinBatch =
      process.platform === 'win32' && /\.(cmd|bat)$/i.test(executablePath)
    const cmd = isWinBatch ? process.env.ComSpec || 'cmd.exe' : executablePath
    const args = isWinBatch ? ['/d', '/c', executablePath, '--version'] : ['--version']
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      windowsHide: true,
    })
    const rawVersion = (stdout || stderr || '').trim().split(/\r?\n/)[0]?.trim() || null
    return {
      id: spec.id,
      name: spec.name,
      purpose: spec.purpose,
      relevance: spec.relevance,
      status: spec.requiresAuth ? 'needs_auth' : 'ready',
      executablePath,
      version: rawVersion,
      authNote: spec.requiresAuth
        ? 'Executável encontrado; login não verificado automaticamente.'
        : 'Pronto para uso.',
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isTimeout = /timed out|ETIMEDOUT/i.test(message)
    return {
      id: spec.id,
      name: spec.name,
      purpose: spec.purpose,
      relevance: spec.relevance,
      status: isTimeout ? 'unavailable' : 'error',
      executablePath,
      version: null,
      authNote: isTimeout ? 'Tempo limite ao verificar versão.' : 'Falha ao consultar versão.',
      error: message,
    }
  }
}

export async function runEnvironmentDiagnostics(
  options: { timeoutMs?: number; simulatedDir?: string } = {}
): Promise<EnvironmentDiagnosticsResult> {
  const tools = await Promise.all(TOOL_SPECS.map((spec) => probeTool(spec, options)))
  return {
    platform: process.platform,
    checkedAt: new Date().toISOString(),
    tools,
  }
}
