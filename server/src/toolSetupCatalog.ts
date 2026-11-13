import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import { probeTool, type ToolDiagnostic } from './environmentDiagnostics.ts'

const execFileAsync = promisify(execFile)

export type SupportedToolId = 'git' | 'codex' | 'gemini' | 'claude'

export interface ToolSetupSpec {
  id: SupportedToolId
  name: string
  vendor: string
  originUrl: string
  installMethod: 'winget' | 'npm' | 'manual'
  packageRef: string
  requiresInternet: boolean
  requiresAdmin: boolean
  requiresGlobalNode: boolean
  systemChanges: string
  accountNote: string
  authHint: string
}

export const TOOL_SETUP_CATALOG: Record<SupportedToolId, ToolSetupSpec> = {
  git: {
    id: 'git',
    name: 'Git',
    vendor: 'Git for Windows',
    originUrl: 'https://git-scm.com/downloads/win',
    installMethod: 'winget',
    packageRef: 'Git.Git',
    requiresInternet: true,
    requiresAdmin: false,
    requiresGlobalNode: false,
    systemChanges: 'Instala Git for Windows via winget e adiciona git ao PATH do usuário.',
    accountNote: 'Software gratuito e open-source; não exige conta.',
    authHint: 'Não requer autenticação.',
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    vendor: 'OpenAI',
    originUrl: 'https://developers.openai.com/codex/cli',
    installMethod: 'npm',
    packageRef: '@openai/codex',
    requiresInternet: true,
    requiresAdmin: false,
    requiresGlobalNode: true,
    systemChanges: 'Instala @openai/codex globalmente via npm do usuário.',
    accountNote: 'Requer conta/assinatura OpenAI ou chave de API configurada pelo usuário.',
    authHint: 'Execute `codex` no terminal para concluir o login oficial.',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    vendor: 'Google',
    originUrl: 'https://github.com/google-gemini/gemini-cli',
    installMethod: 'npm',
    packageRef: '@google/gemini-cli',
    requiresInternet: true,
    requiresAdmin: false,
    requiresGlobalNode: true,
    systemChanges: 'Instala @google/gemini-cli globalmente via npm do usuário.',
    accountNote: 'Requer conta Google ou chave Gemini configurada pelo usuário.',
    authHint: 'Execute `gemini` no terminal para concluir o login oficial.',
  },
  claude: {
    id: 'claude',
    name: 'Claude Code CLI',
    vendor: 'Anthropic',
    originUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    installMethod: 'winget',
    packageRef: 'Anthropic.ClaudeCode',
    requiresInternet: true,
    requiresAdmin: false,
    requiresGlobalNode: false,
    systemChanges: 'Instala Claude Code CLI via winget (Anthropic.ClaudeCode).',
    accountNote: 'Requer conta Anthropic compatível configurada pelo usuário.',
    authHint: 'Execute `claude` no terminal para concluir o login oficial.',
  },
}

const CONSENT_TTL_MS = 60_000
const pendingConsents = new Map<string, { toolId: SupportedToolId; expiresAt: number }>()

export function issueSetupConsent(toolId: string): { nonce: string; toolId: SupportedToolId; expiresAt: number } | null {
  if (!Object.prototype.hasOwnProperty.call(TOOL_SETUP_CATALOG, toolId)) return null
  const id = toolId as SupportedToolId
  const nonce = randomBytes(16).toString('hex')
  const expiresAt = Date.now() + CONSENT_TTL_MS
  pendingConsents.set(nonce, { toolId: id, expiresAt })
  return { nonce, toolId: id, expiresAt }
}

const activeInstalls = new Set<SupportedToolId>()

export type InstallOutcomeStatus =
  | 'completed'
  | 'already_installed'
  | 'cancelled'
  | 'failed'
  | 'in_progress'

export interface InstallResult {
  toolId: SupportedToolId
  status: InstallOutcomeStatus
  message: string
  diagnostic?: ToolDiagnostic
}

export type CommandRunner = (
  cmd: string,
  args: string[],
  timeoutMs: number
) => Promise<{ stdout: string; stderr: string }>

const defaultRunner: CommandRunner = async (cmd, args, timeoutMs) => {
  return execFileAsync(cmd, args, { timeout: timeoutMs, windowsHide: true })
}

export async function executeGuidedInstall(
  toolId: string,
  options: {
    consentNonce?: string
    runner?: CommandRunner
    simulatedDir?: string
    timeoutMs?: number
  }
): Promise<{ httpStatus: number; result: InstallResult }> {
  if (!Object.prototype.hasOwnProperty.call(TOOL_SETUP_CATALOG, toolId)) {
    return {
      httpStatus: 400,
      result: {
        toolId: 'git',
        status: 'failed',
        message: 'Ferramenta não permitida no catálogo oficial.',
      },
    }
  }

  const id = toolId as SupportedToolId
  const spec = TOOL_SETUP_CATALOG[id]

  const consent = options.consentNonce ? pendingConsents.get(options.consentNonce) : undefined
  if (!consent || consent.toolId !== id || Date.now() > consent.expiresAt) {
    if (options.consentNonce) pendingConsents.delete(options.consentNonce)
    return {
      httpStatus: 403,
      result: {
        toolId: id,
        status: 'cancelled',
        message: 'Autorização de uso único ausente, expirada ou inválida para esta ferramenta.',
      },
    }
  }
  pendingConsents.delete(options.consentNonce!)

  if (activeInstalls.has(id)) {
    return {
      httpStatus: 409,
      result: {
        toolId: id,
        status: 'in_progress',
        message: `Instalação de ${spec.name} já está em andamento.`,
      },
    }
  }

  const existing = await probeTool(
    {
      id,
      name: spec.name,
      command: id,
      purpose: spec.systemChanges,
      relevance: id === 'git' ? 'essential' : 'optional',
      requiresAuth: id !== 'git',
    },
    { simulatedDir: options.simulatedDir }
  )

  if (existing.executablePath) {
    return {
      httpStatus: 200,
      result: {
        toolId: id,
        status: 'already_installed',
        message: `${spec.name} já está instalado; nenhuma sobrescrita automática foi feita.`,
        diagnostic: existing,
      },
    }
  }

  activeInstalls.add(id)
  try {
    const runner = options.runner ?? defaultRunner
    const timeoutMs = options.timeoutMs ?? 120_000

    if (spec.installMethod === 'winget') {
      await runner(
        'winget',
        [
          'install',
          '--id',
          spec.packageRef,
          '-e',
          '--source',
          'winget',
          '--accept-package-agreements',
          '--accept-source-agreements',
        ],
        timeoutMs
      )
    } else if (spec.installMethod === 'npm') {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      const cmd = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : npmCmd
      const args =
        process.platform === 'win32'
          ? ['/d', '/c', npmCmd, 'install', '-g', spec.packageRef]
          : ['install', '-g', spec.packageRef]
      await runner(cmd, args, timeoutMs)
    }

    const after = await probeTool(
      {
        id,
        name: spec.name,
        command: id,
        purpose: spec.systemChanges,
        relevance: id === 'git' ? 'essential' : 'optional',
        requiresAuth: id !== 'git',
      },
      { simulatedDir: options.simulatedDir }
    )

    if (!after.executablePath) {
      return {
        httpStatus: 200,
        result: {
          toolId: id,
          status: 'failed',
          message: `O instalador terminou, mas ${spec.name} não foi encontrado no PATH.`,
          diagnostic: after,
        },
      }
    }

    return {
      httpStatus: 200,
      result: {
        toolId: id,
        status: 'completed',
        message: `${spec.name} instalado e verificado.`,
        diagnostic: after,
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      httpStatus: 200,
      result: {
        toolId: id,
        status: 'failed',
        message: `Falha ao instalar ${spec.name}: ${msg}`,
      },
    }
  } finally {
    activeInstalls.delete(id)
  }
}
