import { execFile } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import path from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import type { ChatService } from './chat/service.ts'
import type { ChatStore } from './chat/store.ts'
import { describeDatabaseError } from './db/database.ts'
import { redact } from './security/redact.ts'
import type {
  AgentConfig,
  ChatAction,
  ChatMessage,
  AgentInfo,
  AgentProfileId,
  CliId,
  ClientMessage,
  MemoryFilter,
  MemoryInput,
  MissionEvent,
  CustomAgentInput,
  CustomAgentPatch,
  MissionSpecialistSelection,
  ProviderId,
  ReasoningEffort,
  ServerMessage,
  SpecialistRole,
  TaskInput,
  TaskPriority,
  TaskStatus,
} from '../../shared/protocol.ts'
import type { AgentConfigStore } from './agents/configStore.ts'
import type { AgentRegistry } from './agents/registry.ts'
import { defaultSpecializations } from './agents/specializations.ts'
import type { GitService } from './git/service.ts'
import type { HistoryStore } from './history/store.ts'
import { HUMAN, type MemoryStore } from './memory/store.ts'
import type { EventStore } from './observability/store.ts'
import type { ProjectStore } from './projects/store.ts'
import type { SkillStore } from './skills/store.ts'
import type { TaskStore } from './tasks/store.ts'
import type { PlanStore } from './team/planStore.ts'
import type { TeamRunner } from './team/runner.ts'
import type { TerminalManager } from './terminal/manager.ts'

export interface AppServerOptions {
  registry: AgentRegistry
  terminals: TerminalManager
  projects: ProjectStore
  git: GitService
  tasks: TaskStore
  history: HistoryStore
  team: TeamRunner
  agentConfigs: AgentConfigStore
  memory: MemoryStore
  /** Sem registro de skills, as mensagens de skill são ignoradas. */
  skills?: SkillStore
  /** Sem trilha de eventos, events-list devolve lista vazia. */
  events?: EventStore
  /** Propostas e passos das missões dinâmicas. Sem ele, plan-list devolve listas vazias. */
  plans?: PlanStore
  /** Chat com o Tech Lead. Sem ele, as mensagens de chat respondem com erro. */
  chat?: { store: ChatStore; service: ChatService }
  allowedOrigins: string[]
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1'])

/** Bloqueia DNS rebinding: o cabeçalho Host precisa ser um nome local. */
function hasLocalHost(req: IncomingMessage): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  return LOCAL_HOSTNAMES.has(hostname)
}

const isSize = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 2 && (n as number) <= 500
const isId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0
const isOpId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,80}$/.test(v)
const isAgentId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,80}$/.test(v)
const DECISIONS = new Set(['approve', 'reject', 'adjust'])
const RESUME_ACTIONS = new Set(['continue', 'retry_step', 'replan'])
const isPathList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.length <= 500 && v.every((p) => typeof p === 'string' && p.length <= 1024)

const VALID_PRIORITIES = new Set<TaskPriority>(['low', 'medium', 'high'])
const VALID_STATUSES = new Set<TaskStatus>(['todo', 'doing', 'review', 'done'])
const VALID_PROVIDERS = new Set<ProviderId>(['codex', 'gemini', 'antigravity'])
const VALID_EFFORTS = new Set<ReasoningEffort>(['low', 'medium', 'high', 'extra-high', 'default'])
const VALID_PROFILES = new Set<AgentProfileId>(['economy', 'balanced', 'max_quality'])

const providerToCli = (provider: ProviderId): CliId => (provider === 'antigravity' ? 'agy' : provider)

export async function openNativeFolderDialog(): Promise<string | null> {
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const psScript = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Selecione a pasta do projeto'; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }`
      execFile('powershell', ['-NoProfile', '-STA', '-Command', psScript], { timeout: 60000 }, (err, stdout) => {
        if (err || !stdout.trim()) resolve(null)
        else resolve(stdout.trim())
      })
    })
  }
  return new Promise((resolve) => {
    execFile('zenity', ['--file-selection', '--directory'], { timeout: 60000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        execFile('kdialog', ['--getexistingdirectory'], { timeout: 60000 }, (kErr, kStdout) => {
          if (kErr || !kStdout.trim()) resolve(null)
          else resolve(kStdout.trim())
        })
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

function parseTaskInput(data: unknown): TaskInput | null {
  if (typeof data !== 'object' || data === null) return null
  const t = data as Record<string, unknown>
  if (typeof t.title !== 'string' || t.title.length === 0 || t.title.length > 200) return null
  if (typeof t.description !== 'string' || t.description.length > 5000) return null
  if (!VALID_PRIORITIES.has(t.priority as TaskPriority)) return null
  if (!VALID_STATUSES.has(t.status as TaskStatus)) return null
  if (t.agentId !== null && typeof t.agentId !== 'string') return null
  return {
    title: t.title,
    description: t.description,
    priority: t.priority as TaskPriority,
    status: t.status as TaskStatus,
    agentId: t.agentId,
  }
}

/** Valida o formato de tudo que chega do navegador antes de usar. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const msg = data as Record<string, unknown>
  const { agentId } = msg

  switch (msg.type) {
    case 'chat-list':
      return isId(msg.projectId) ? { type: 'chat-list', projectId: msg.projectId } : null
    case 'chat-create':
      return isId(msg.projectId) && isAgentId(msg.agentId) && isOpId(msg.opId) ? { type: 'chat-create', projectId: msg.projectId, agentId: msg.agentId, opId: msg.opId } : null
    case 'chat-rename':
      return isId(msg.projectId) && isId(msg.conversationId) && isOpId(msg.opId) && typeof msg.title === 'string' && msg.title.length <= 500
        ? { type: 'chat-rename', projectId: msg.projectId, conversationId: msg.conversationId, title: msg.title, opId: msg.opId }
        : null
    case 'chat-delete':
    case 'chat-cancel':
      return isId(msg.projectId) && isId(msg.conversationId) && isOpId(msg.opId) ? { type: msg.type, projectId: msg.projectId, conversationId: msg.conversationId, opId: msg.opId } : null
    case 'chat-open':
      if (!isId(msg.projectId) || !isId(msg.conversationId) || (msg.beforeId !== undefined && !isId(msg.beforeId))) return null
      return { type: 'chat-open', projectId: msg.projectId, conversationId: msg.conversationId, ...(msg.beforeId !== undefined ? { beforeId: msg.beforeId as number } : {}) }
    case 'chat-send':
      // O limite de conteúdo é do serviço (devolve erro legível); aqui só o formato e um teto.
      return isId(msg.projectId) && isId(msg.conversationId) && isOpId(msg.opId) && typeof msg.content === 'string' && msg.content.length <= 65_536
        ? { type: 'chat-send', projectId: msg.projectId, conversationId: msg.conversationId, content: msg.content, opId: msg.opId }
        : null
    case 'check-cli':
    case 'term-close':
      return typeof agentId === 'string' ? { type: msg.type, agentId } : null
    case 'term-open':
    case 'term-resize':
      return typeof agentId === 'string' && isSize(msg.cols) && isSize(msg.rows)
        ? { type: msg.type, agentId, cols: msg.cols, rows: msg.rows }
        : null
    case 'term-input':
      return typeof agentId === 'string' && typeof msg.data === 'string'
        ? { type: 'term-input', agentId, data: msg.data }
        : null
    case 'project-add':
      return typeof msg.path === 'string' && msg.path.length <= 1024
        ? { type: 'project-add', path: msg.path }
        : null
    case 'dialog-open-folder':
      return { type: 'dialog-open-folder' }
    case 'project-validate':
      return typeof msg.path === 'string' && msg.path.length <= 1024
        ? { type: 'project-validate', path: msg.path }
        : null
    case 'project-select':
    case 'project-remove':
      return isId(msg.projectId) ? { type: msg.type, projectId: msg.projectId } : null
    case 'git-status':
    case 'git-push-preview':
      return { type: msg.type }
    case 'git-diff':
      return typeof msg.path === 'string' && typeof msg.staged === 'boolean'
        ? { type: 'git-diff', path: msg.path, staged: msg.staged }
        : null
    case 'git-stage':
    case 'git-unstage':
      return isPathList(msg.paths) ? { type: msg.type, paths: msg.paths } : null
    case 'git-commit':
      return typeof msg.message === 'string' && msg.message.length <= 5000
        ? { type: 'git-commit', message: msg.message }
        : null
    case 'git-push':
      return typeof msg.token === 'string' ? { type: 'git-push', token: msg.token } : null
    case 'task-create': {
      const task = parseTaskInput(msg.task)
      return isId(msg.projectId) && task ? { type: 'task-create', projectId: msg.projectId, task } : null
    }
    case 'task-update': {
      const task = parseTaskInput(msg.task)
      return isId(msg.taskId) && task ? { type: 'task-update', taskId: msg.taskId, task } : null
    }
    case 'task-delete':
      return isId(msg.taskId) ? { type: 'task-delete', taskId: msg.taskId } : null
    case 'mission-start': {
      if (!isId(msg.taskId)) return null
      if (msg.mode !== undefined && msg.mode !== 'pipeline' && msg.mode !== 'dynamic') return null
      // Os limites são conferidos de verdade pelo backend (resolveLimits); aqui só o formato.
      if (msg.limits !== undefined && (typeof msg.limits !== 'object' || msg.limits === null || Array.isArray(msg.limits))) return null
      const modeFields = {
        ...(msg.mode !== undefined ? { mode: msg.mode as 'pipeline' | 'dynamic' } : {}),
        ...(msg.limits !== undefined ? { limits: msg.limits as Record<string, number> } : {}),
      }
      if (msg.team !== undefined) {
        if (typeof msg.team !== 'object' || msg.team === null) return null
        const tm = msg.team as Record<string, unknown>
        if (tm.plannerId !== undefined && typeof tm.plannerId !== 'string') return null
        if (tm.devId !== undefined && typeof tm.devId !== 'string') return null
        if (tm.qaId !== undefined && typeof tm.qaId !== 'string') return null

        let specialists: MissionSpecialistSelection[] | undefined
        if (Array.isArray(tm.specialists)) {
          specialists = []
          for (const s of tm.specialists) {
            if (typeof s !== 'object' || s === null) return null
            const spec = s as Record<string, unknown>
            if (typeof spec.agentId !== 'string' || !spec.agentId.trim()) return null
            if (typeof spec.role !== 'string') return null
            if (spec.timing !== 'pre-dev' && spec.timing !== 'post-dev') return null
            specialists.push({
              agentId: spec.agentId.trim(),
              role: spec.role as SpecialistRole,
              timing: spec.timing,
              expectedContribution: typeof spec.expectedContribution === 'string' ? spec.expectedContribution.slice(0, 500) : undefined,
            })
          }
        }

        return {
          type: 'mission-start',
          taskId: msg.taskId,
          team: {
            ...(tm.plannerId ? { plannerId: tm.plannerId } : {}),
            ...(tm.devId ? { devId: tm.devId } : {}),
            ...(tm.qaId ? { qaId: tm.qaId } : {}),
            ...(specialists ? { specialists } : {}),
          },
          ...modeFields,
        }
      }
      return { type: 'mission-start', taskId: msg.taskId, ...modeFields }
    }
    case 'proposal-decide':
      // A decisão só chega por aqui, vinda da interface: texto de CLI ou de agente nunca vira mensagem do cliente.
      if (!isId(msg.missionId) || !isId(msg.proposalId) || !Number.isInteger(msg.revision) || (msg.revision as number) < 1) return null
      if (!DECISIONS.has(msg.decision as string) || !isOpId(msg.opId)) return null
      if (msg.feedback !== undefined && (typeof msg.feedback !== 'string' || msg.feedback.length > 5000)) return null
      return {
        type: 'proposal-decide',
        missionId: msg.missionId,
        proposalId: msg.proposalId,
        revision: msg.revision as number,
        decision: msg.decision as 'approve' | 'reject' | 'adjust',
        opId: msg.opId,
        ...(typeof msg.feedback === 'string' ? { feedback: msg.feedback } : {}),
      }
    case 'mission-close':
      return isId(msg.missionId) ? { type: 'mission-close', missionId: msg.missionId } : null
    case 'mission-recovery':
      return isId(msg.projectId) && isId(msg.missionId) ? { type: 'mission-recovery', projectId: msg.projectId, missionId: msg.missionId } : null
    case 'mission-resume':
      if (!isId(msg.missionId) || !isOpId(msg.opId) || !RESUME_ACTIONS.has(msg.action as string)) return null
      if (msg.stepId !== undefined && !isId(msg.stepId)) return null
      if (msg.action === 'retry_step' && msg.stepId === undefined) return null
      if (msg.detail !== undefined && (typeof msg.detail !== 'string' || msg.detail.length > 2000)) return null
      if (msg.acceptChanges !== undefined && typeof msg.acceptChanges !== 'boolean') return null
      if (msg.acceptFiles !== undefined && !(Array.isArray(msg.acceptFiles) && msg.acceptFiles.length <= 1000 && msg.acceptFiles.every((f) => typeof f === 'string' && f.length > 0 && f.length <= 1000))) return null
      if (msg.acceptChanges === true && msg.acceptFiles === undefined) return null
      return {
        type: 'mission-resume',
        missionId: msg.missionId,
        action: msg.action as 'continue' | 'retry_step' | 'replan',
        opId: msg.opId,
        ...(msg.stepId !== undefined ? { stepId: msg.stepId } : {}),
        ...(typeof msg.detail === 'string' ? { detail: msg.detail } : {}),
        ...(msg.acceptChanges !== undefined ? { acceptChanges: msg.acceptChanges } : {}),
        ...(msg.acceptFiles !== undefined ? { acceptFiles: msg.acceptFiles as string[] } : {}),
      }
    case 'plan-list':
      return isId(msg.projectId) && isId(msg.missionId) ? { type: 'plan-list', projectId: msg.projectId, missionId: msg.missionId } : null
    case 'mission-approve':
    case 'mission-cancel':
      return isId(msg.missionId) ? { type: msg.type, missionId: msg.missionId } : null
    case 'mission-clarify':
      return isId(msg.missionId) && typeof msg.answer === 'string' && msg.answer.length <= 5000
        ? { type: 'mission-clarify', missionId: msg.missionId, answer: msg.answer }
        : null
    case 'memory-list': {
      if (!isId(msg.projectId)) return null
      const filter: Record<string, string> = {}
      if (typeof msg.filter === 'object' && msg.filter !== null) {
        // Só textos curtos passam; o MemoryStore valida os valores.
        for (const key of ['scope', 'agentId', 'category', 'status', 'from', 'to', 'q']) {
          const value = (msg.filter as Record<string, unknown>)[key]
          if (typeof value === 'string' && value.length <= 200) filter[key] = value
        }
      }
      return { type: 'memory-list', projectId: msg.projectId, filter: filter as MemoryFilter }
    }
    case 'memory-create': {
      const e = msg.entry as Record<string, unknown> | null
      if (!isId(msg.projectId) || typeof e !== 'object' || e === null) return null
      if (typeof e.scope !== 'string' || typeof e.category !== 'string' || typeof e.content !== 'string') return null
      if (e.content.length > 5000 || (e.agentId !== null && typeof e.agentId !== 'string')) return null
      return { type: 'memory-create', projectId: msg.projectId, entry: e as unknown as MemoryInput }
    }
    case 'memory-approve':
    case 'memory-reject':
    case 'memory-versions':
      return isId(msg.id) ? { type: msg.type, id: msg.id } : null
    case 'memory-supersede':
      return isId(msg.id) && typeof msg.content === 'string' && msg.content.length <= 5000
        ? { type: 'memory-supersede', id: msg.id, content: msg.content }
        : null
    case 'agent-config-set': {
      if (typeof msg.config !== 'object' || msg.config === null) return null
      const c = msg.config as Record<string, unknown>
      if (typeof c.agentId !== 'string' || !VALID_PROVIDERS.has(c.provider as ProviderId)) return null
      if (typeof c.model !== 'string' || c.model.length > 100) return null
      if (!VALID_EFFORTS.has(c.reasoningEffort as ReasoningEffort)) return null
      return {
        type: 'agent-config-set',
        config: {
          agentId: c.agentId,
          provider: c.provider as ProviderId,
          model: c.model,
          reasoningEffort: c.reasoningEffort as ReasoningEffort,
        },
      }
    }
    case 'agent-config-profile':
      return VALID_PROFILES.has(msg.profile as AgentProfileId)
        ? { type: 'agent-config-profile', profile: msg.profile as AgentProfileId }
        : null
    case 'agent-config-reset':
      return { type: 'agent-config-reset' }
    case 'agent-create': {
      if (typeof msg.agent !== 'object' || msg.agent === null) return null
      const a = msg.agent as Record<string, unknown>
      if (
        typeof a.name !== 'string' ||
        typeof a.role !== 'string' ||
        typeof a.roleCategory !== 'string' ||
        typeof a.specializationId !== 'string' ||
        typeof a.provider !== 'string'
      ) {
        return null
      }
      return { type: 'agent-create', agent: a as unknown as CustomAgentInput }
    }
    case 'agent-update':
      return typeof msg.agentId === 'string' && typeof msg.patch === 'object' && msg.patch !== null
        ? { type: 'agent-update', agentId: msg.agentId, patch: msg.patch as CustomAgentPatch }
        : null
    case 'agent-set-active':
      return typeof msg.agentId === 'string' && typeof msg.active === 'boolean'
        ? { type: 'agent-set-active', agentId: msg.agentId, active: msg.active }
        : null
    case 'agents-list':
      return { type: 'agents-list' }
    case 'specializations-list':
      return { type: 'specializations-list' }
    case 'skills-list':
      return { type: 'skills-list' }
    case 'skill-save': {
      if (typeof msg.skill !== 'object' || msg.skill === null) return null
      const s = msg.skill as Record<string, unknown>
      const optional = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max)
      if (typeof s.id !== 'string' || s.id.length > 40) return null
      if (typeof s.name !== 'string' || s.name.length > 200) return null
      if (typeof s.content !== 'string' || s.content.length > 20_000) return null
      if (!optional(s.description, 1000) || !optional(s.origin, 1000) || !optional(s.version, 100)) return null
      if (s.mode !== undefined && s.mode !== 'context' && s.mode !== 'native') return null
      if (s.enabled !== undefined && typeof s.enabled !== 'boolean') return null
      return {
        type: 'skill-save',
        skill: {
          id: s.id,
          name: s.name,
          content: s.content,
          description: s.description as string | undefined,
          origin: s.origin as string | undefined,
          version: s.version as string | undefined,
          mode: s.mode,
          enabled: s.enabled,
        },
      }
    }
    case 'skill-set-enabled':
      return typeof msg.id === 'string' && typeof msg.enabled === 'boolean'
        ? { type: 'skill-set-enabled', id: msg.id, enabled: msg.enabled }
        : null
    case 'skill-set-agent':
      return typeof msg.agentId === 'string' &&
        typeof msg.skillId === 'string' &&
        (msg.state === 'inherit' || msg.state === 'on' || msg.state === 'off')
        ? { type: 'skill-set-agent', agentId: msg.agentId, skillId: msg.skillId, state: msg.state }
        : null
    case 'events-list':
      if (!isId(msg.projectId)) return null
      if (msg.missionId !== undefined && !isId(msg.missionId)) return null
      if (msg.afterId !== undefined && !isId(msg.afterId)) return null
      return {
        type: 'events-list',
        projectId: msg.projectId,
        ...(msg.missionId !== undefined ? { missionId: msg.missionId } : {}),
        ...(msg.afterId !== undefined ? { afterId: msg.afterId } : {}),
      }
    default:
      return null
  }
}

type ChatClientMessage = Extract<ClientMessage, { type: 'chat-list' | 'chat-create' | 'chat-rename' | 'chat-delete' | 'chat-open' | 'chat-send' | 'chat-cancel' }>
const isChatMessage = (m: ClientMessage): m is ChatClientMessage => m.type.startsWith('chat-')
const CHAT_ACTIONS: Record<string, ChatAction> = { 'chat-create': 'create', 'chat-send': 'send', 'chat-rename': 'rename', 'chat-delete': 'delete', 'chat-cancel': 'cancel' }
const actionOf = (type: string): ChatAction => CHAT_ACTIONS[type] ?? 'send'
const safeJson = (text: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}
const errorText = (error: unknown) => describeDatabaseError(error) ?? redact(error instanceof Error ? error.message : String(error))

export function createAppServer({
  registry,
  terminals,
  projects,
  git,
  tasks,
  history,
  team,
  agentConfigs,
  memory,
  skills,
  events,
  plans,
  chat,
  allowedOrigins,
}: AppServerOptions): Server {
  for (const cfg of agentConfigs.list()) {
    if (!cfg.isBuiltin) {
      registry.registerAgent({
        id: cfg.agentId,
        name: cfg.name || cfg.agentId,
        role: cfg.role || 'Agente personalizado',
        cli: providerToCli(cfg.provider),
        roleCategory: cfg.roleCategory,
        specializationId: cfg.specializationId,
        avatarPreset: cfg.avatarPreset,
        isBuiltin: false,
      })
    }
  }
  const server = createServer((req, res) => {
    const origin = req.headers.origin
    if (!hasLocalHost(req) || (origin && !allowedOrigins.includes(origin))) {
      res.writeHead(403).end()
      return
    }
    if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      return
    }
    res.writeHead(404).end()
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }
  const broadcast = (message: ServerMessage) => {
    for (const client of wss.clients) send(client, message)
  }

  // Sites externos conseguem abrir WebSocket para localhost; por isso a origem
  // é obrigatória e precisa estar na lista.
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin
    const allowed =
      req.url === '/ws' && hasLocalHost(req) && !!origin && allowedOrigins.includes(origin)
    if (!allowed) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
  })

  /** Ações de projeto: aplica, avisa todos; se falhar, avisa só quem pediu. */
  const changeWorkspace = (socket: WebSocket, action: () => void) => {
    try {
      action()
      broadcast({ type: 'workspace', workspace: projects.workspace() })
    } catch (error) {
      send(socket, { type: 'notice', message: errorText(error) })
    }
  }

  /** Ações Git rodam sempre na pasta do projeto ativo; falhas voltam só para quem pediu. */
  const inProject = (socket: WebSocket, action: (cwd: string) => Promise<void>) => {
    const cwd = projects.active()?.path
    if (!cwd) {
      send(socket, { type: 'git-status', status: null })
      return
    }
    action(cwd).catch((error) => send(socket, { type: 'git-result', ok: false, message: errorText(error) }))
  }
  const planMessage = (projectId: number, missionId: number): ServerMessage => ({
    type: 'mission-plan',
    projectId,
    missionId,
    proposals: (plans?.listProposals({ projectId, missionId }) ?? []).map((p) => ({ ...p, previouslyRejected: team.previouslyRejected(p) })),
    steps: plans?.listSteps({ projectId, missionId }) ?? [],
  })
  const broadcastGitStatus = async (cwd: string) => broadcast({ type: 'git-status', status: await git.status(cwd) })

  const chatResult = (socket: WebSocket, action: ChatAction, opId: string | null, ok: boolean, text: string, conversationId: number | null = null) =>
    send(socket, { type: 'chat-result', action, opId, ok, message: text, conversationId })
  const conversationsMessage = (projectId: number): ServerMessage => ({ type: 'chat-conversations', projectId, conversations: chat?.store.listConversations(projectId) ?? [] })

  const handleChat = (socket: WebSocket, message: ChatClientMessage) => {
    if (!chat) {
      chatResult(socket, actionOf(message.type), 'opId' in message ? message.opId : null, false, 'Chat indisponível neste backend.')
      return
    }
    const { store, service } = chat
    try {
      if (!projects.get(message.projectId)) throw new Error('Projeto desconhecido.')
      switch (message.type) {
        case 'chat-list':
          send(socket, conversationsMessage(message.projectId))
          return
        case 'chat-open': {
          const page = store.listMessages(message.projectId, message.conversationId, { beforeId: message.beforeId })
          send(socket, { type: 'chat-messages', projectId: message.projectId, conversationId: message.conversationId, ...page, beforeId: message.beforeId ?? null })
          return
        }
        case 'chat-create': {
          if (!service.isChatAgent(message.agentId)) throw new Error('Escolha um planejador ativo para conversar.')
          const conv = store.createConversation(message.projectId, message.agentId)
          chatResult(socket, 'create', message.opId, true, 'Conversa criada.', conv.id)
          return
        }
        case 'chat-rename': {
          const conv = store.rename(message.projectId, message.conversationId, message.title)
          chatResult(socket, 'rename', message.opId, true, 'Conversa renomeada.', conv.id)
          return
        }
        case 'chat-delete': {
          const busy = service.busyWith()
          if (busy && busy.projectId === message.projectId && busy.conversationId === message.conversationId) throw new Error('Interrompa a resposta em andamento antes de excluir a conversa.')
          store.delete(message.projectId, message.conversationId)
          broadcast({ type: 'chat-deleted', projectId: message.projectId, conversationId: message.conversationId })
          chatResult(socket, 'delete', message.opId, true, 'Conversa excluída.', message.conversationId)
          return
        }
        case 'chat-cancel': {
          store.requireConversation(message.projectId, message.conversationId)
          const stopped = service.cancel(message.projectId, message.conversationId)
          chatResult(socket, 'cancel', message.opId, true, stopped ? 'Resposta interrompida.' : 'Não havia resposta em andamento.', message.conversationId)
          return
        }
        case 'chat-send':
          service
            .send(message)
            .then(({ applied }) => chatResult(socket, 'send', message.opId, true, applied ? 'Mensagem enviada.' : 'Esta mensagem já tinha sido enviada: nada foi repetido.', message.conversationId))
            .catch((error) => chatResult(socket, 'send', message.opId, false, errorText(error), message.conversationId))
          return
      }
    } catch (error) {
      chatResult(socket, actionOf(message.type), 'opId' in message ? message.opId : null, false, errorText(error), 'conversationId' in message ? message.conversationId : null)
    }
  }

  const handle = (socket: WebSocket, message: ClientMessage) => {
    if (isChatMessage(message)) return handleChat(socket, message)
    switch (message.type) {
      case 'check-cli':
        void registry.check(message.agentId)
        break
      case 'term-open':
        try {
          const replay = terminals.open(message.agentId, message.cols, message.rows)
          send(socket, { type: 'term-ready', agentId: message.agentId, replay })
        } catch (error) {
          send(socket, { type: 'term-error', agentId: message.agentId, message: errorText(error) })
        }
        break
      case 'term-input':
        terminals.write(message.agentId, message.data)
        break
      case 'term-resize':
        terminals.resize(message.agentId, message.cols, message.rows)
        break
      case 'term-close':
        terminals.close(message.agentId)
        break
      case 'project-add':
        changeWorkspace(socket, () => projects.add(message.path))
        break
      case 'dialog-open-folder':
        openNativeFolderDialog().then((selectedPath) => {
          send(socket, { type: 'dialog-folder-selected', path: selectedPath })
        })
        break
      case 'project-validate': {
        const raw = message.path.trim().replace(/^"(.*)"$/, '$1')
        if (!path.isAbsolute(raw)) {
          send(socket, {
            type: 'project-validate-result',
            path: raw,
            valid: false,
            exists: false,
            isDirectory: false,
            isRepo: false,
            branch: null,
            error: 'Informe um caminho completo da pasta.',
          })
          break
        }
        try {
          const resolved = realpathSync.native(raw)
          const stat = statSync(resolved)
          if (!stat.isDirectory()) {
            send(socket, {
              type: 'project-validate-result',
              path: resolved,
              valid: false,
              exists: true,
              isDirectory: false,
              isRepo: false,
              branch: null,
              error: 'O caminho não é uma pasta.',
            })
            break
          }
          git.status(resolved)
            .then((gitStat) => {
              send(socket, {
                type: 'project-validate-result',
                path: resolved,
                valid: true,
                exists: true,
                isDirectory: true,
                isRepo: !!gitStat.isRepo,
                branch: gitStat.branch,
              })
            })
            .catch(() => {
              send(socket, {
                type: 'project-validate-result',
                path: resolved,
                valid: true,
                exists: true,
                isDirectory: true,
                isRepo: false,
                branch: null,
              })
            })
        } catch {
          send(socket, {
            type: 'project-validate-result',
            path: raw,
            valid: false,
            exists: false,
            isDirectory: false,
            isRepo: false,
            branch: null,
            error: 'Pasta não encontrada no disco.',
          })
        }
        break
      }
      case 'project-select':
        changeWorkspace(socket, () => projects.select(message.projectId))
        break
      case 'project-remove':
        changeWorkspace(socket, () => projects.remove(message.projectId))
        break
      case 'git-status':
        inProject(socket, async (cwd) => send(socket, { type: 'git-status', status: await git.status(cwd) }))
        break
      case 'git-diff':
        inProject(socket, async (cwd) => {
          const text = await git.diff(cwd, message.path, message.staged)
          send(socket, { type: 'git-diff', path: message.path, staged: message.staged, text })
        })
        break
      case 'git-stage':
        inProject(socket, async (cwd) => {
          await git.stage(cwd, message.paths)
          await broadcastGitStatus(cwd)
        })
        break
      case 'git-unstage':
        inProject(socket, async (cwd) => {
          await git.unstage(cwd, message.paths)
          await broadcastGitStatus(cwd)
        })
        break
      case 'git-commit':
        inProject(socket, async (cwd) => {
          const summary = await git.commit(cwd, message.message)
          send(socket, { type: 'git-result', ok: true, message: `Commit criado: ${summary}` })
          const activeProj = projects.active()
          history.add({
            kind: 'commit',
            message: `Commit criado: ${summary}`,
            projectId: activeProj?.id ?? null,
          })
          await broadcastGitStatus(cwd)
        })
        break
      case 'git-push-preview':
        inProject(socket, async (cwd) => send(socket, { type: 'git-push-preview', preview: await git.previewPush(cwd) }))
        break
      case 'git-push':
        inProject(socket, async (cwd) => {
          const output = await git.push(cwd, message.token)
          send(socket, { type: 'git-result', ok: true, message: `Push concluído. ${output}` })
          const activeProj = projects.active()
          history.add({
            kind: 'push',
            message: `Push realizado: ${output}`,
            projectId: activeProj?.id ?? null,
          })
          await broadcastGitStatus(cwd)
        })
        break
      case 'task-create':
        try {
          if (!projects.get(message.projectId)) throw new Error('Projeto desconhecido: escolha um projeto antes de criar a tarefa.')
          tasks.create(message.projectId, message.task)
        } catch (error) {
          send(socket, { type: 'notice', message: errorText(error) })
        }
        break
      case 'task-update':
        try {
          tasks.update(message.taskId, message.task)
        } catch (error) {
          send(socket, { type: 'notice', message: errorText(error) })
        }
        break
      case 'task-delete':
        try {
          tasks.delete(message.taskId)
        } catch (error) {
          send(socket, { type: 'notice', message: errorText(error) })
        }
        break
      case 'mission-start':
        team.start(message.taskId, message.team, { mode: message.mode, limits: message.limits }).catch((error) => {
          send(socket, { type: 'notice', message: errorText(error) })
        })
        break
      case 'mission-approve':
        team.approve(message.missionId).catch((error) => {
          send(socket, { type: 'notice', message: errorText(error) })
        })
        break
      case 'mission-clarify':
        team.clarify(message.missionId, message.answer).catch((error) => {
          send(socket, { type: 'notice', message: errorText(error) })
        })
        break
      case 'proposal-decide':
        try {
          const { proposal, applied } = team.decideProposal(message)
          send(socket, {
            type: 'proposal-result',
            opId: message.opId,
            missionId: message.missionId,
            proposalId: message.proposalId,
            ok: true,
            applied,
            status: proposal.status,
            message: applied ? 'Decisão registrada.' : 'Esta decisão já estava registrada: nada foi executado de novo.',
          })
        } catch (error) {
          send(socket, {
            type: 'proposal-result',
            opId: message.opId,
            missionId: message.missionId,
            proposalId: message.proposalId,
            ok: false,
            applied: false,
            status: plans?.getProposal(message.proposalId)?.status ?? null,
            message: errorText(error),
          })
        }
        break
      case 'mission-close':
        try {
          team.closeMission(message.missionId)
        } catch (error) {
          send(socket, { type: 'notice', message: errorText(error) })
        }
        break
      case 'mission-recovery':
        // A consulta confere o projeto: uma missão de outro projeto não é exposta.
        team
          .recoveryState(message.projectId, message.missionId)
          .then((state) => send(socket, { type: 'mission-recovery', state }))
          .catch((error) => send(socket, { type: 'notice', message: errorText(error) }))
        break
      case 'mission-resume':
        team
          .resumeMission(message)
          .then(({ applied, message: text }) => send(socket, { type: 'mission-resume-result', opId: message.opId, missionId: message.missionId, ok: true, applied, message: text }))
          .catch((error) => send(socket, { type: 'mission-resume-result', opId: message.opId, missionId: message.missionId, ok: false, applied: false, message: errorText(error) }))
        break
      case 'plan-list':
        // Sempre por projeto e missão: nada de outro projeto entra na resposta.
        send(socket, planMessage(message.projectId, message.missionId))
        break
      case 'mission-cancel':
        try {
          team.cancel(message.missionId)
        } catch (error) {
          send(socket, { type: 'notice', message: errorText(error) })
        }
        break
      case 'agent-config-set':
        try {
          agentConfigs.set(message.config.agentId, message.config)
          registry.setCli(message.config.agentId, providerToCli(message.config.provider))
          history.add({
            kind: 'agent',
            message: `Configuração atualizada (${message.config.agentId}): ${message.config.provider} · ${message.config.model} · esforço ${message.config.reasoningEffort}`,
            agentId: message.config.agentId,
          })
        } catch (error) {
          send(socket, { type: 'notice', message: errorText(error) })
        }
        break
      case 'agent-config-profile':
        try {
          agentConfigs.applyProfile(message.profile)
          for (const cfg of agentConfigs.list()) {
            registry.setCli(cfg.agentId, providerToCli(cfg.provider))
          }
          history.add({
            kind: 'agent',
            message: `Perfil de agentes aplicado: ${message.profile}`,
          })
        } catch (error) {
          send(socket, { type: 'notice', message: errorText(error) })
        }
        break
      case 'agent-config-reset':
        try {
          agentConfigs.resetDefaults()
          for (const cfg of agentConfigs.list()) {
            registry.setCli(cfg.agentId, providerToCli(cfg.provider))
          }
          history.add({
            kind: 'agent',
            message: 'Configurações dos agentes restauradas para o padrão.',
          })
        } catch (error) {
          send(socket, { type: 'notice', message: errorText(error) })
        }
        break
      case 'agent-create':
        try {
          const created = agentConfigs.createAgent(message.agent)
          if (created.active !== false) {
            void registry.check(created.agentId)
          }
          history.add({
            kind: 'agent',
            message: `Agente personalizado criado: ${created.name} (${created.agentId}) · ${created.provider}/${created.model}`,
            agentId: created.agentId,
          })
        } catch (error) {
          send(socket, { type: 'notice', message: errorText(error) })
        }
        break
      case 'agent-update':
        try {
          const before = agentConfigs.find(message.agentId)
          const updated = agentConfigs.updateAgent(message.agentId, message.patch)
          if (before && before.provider !== updated.provider && updated.active !== false) {
            registry.setCli(updated.agentId, providerToCli(updated.provider))
          }
          history.add({
            kind: 'agent',
            message: `Agente atualizado: ${updated.name} (${updated.agentId}) · ${updated.provider}/${updated.model}`,
            agentId: updated.agentId,
          })
        } catch (error) {
          send(socket, { type: 'notice', message: errorText(error) })
        }
        break
      case 'agent-set-active':
        try {
          const updated = agentConfigs.setAgentActive(message.agentId, message.active)
          if (!updated.active) {
            terminals.close(message.agentId)
            registry.setRuntimeState(message.agentId, 'idle', 'Sessão encerrada.')
            registry.unregisterAgent(message.agentId)
          } else {
            void registry.check(updated.agentId)
          }
          history.add({
            kind: 'agent',
            message: `Agente ${updated.name} (${updated.agentId}) ${updated.active ? 'ativado' : 'desativado'}.`,
            agentId: updated.agentId,
          })
        } catch (error) {
          send(socket, { type: 'notice', message: errorText(error) })
        }
        break
      case 'memory-list':
        send(socket, { type: 'memory-entries', projectId: message.projectId, entries: memory.list(message.projectId, message.filter) })
        break
      case 'memory-versions':
        try {
          send(socket, { type: 'memory-versions', id: message.id, versions: memory.versions(message.id) })
        } catch (error) {
          send(socket, { type: 'notice', message: errorText(error) })
        }
        break
      case 'memory-create':
      case 'memory-approve':
      case 'memory-reject':
      case 'memory-supersede':
        // Estas mensagens só vêm da interface: são a ação humana que torna uma memória válida.
        try {
          if (message.type === 'memory-create') memory.createApproved({ projectId: message.projectId, ...message.entry })
          else if (message.type === 'memory-approve') memory.approve(message.id, HUMAN)
          else if (message.type === 'memory-reject') memory.reject(message.id, HUMAN)
          else memory.supersede(message.id, message.content, HUMAN)
        } catch (error) {
          send(socket, { type: 'notice', message: errorText(error) })
        }
        break
      case 'agents-list':
        send(socket, {
          type: 'agent-configs',
          configs: agentConfigs.list(),
          allConfigs: agentConfigs.list({ includeInactive: true }),
        })
        break
      case 'specializations-list':
        send(socket, {
          type: 'specializations',
          specializations: defaultSpecializations.list(),
        })
        break
      case 'events-list':
        // A consulta é sempre por projeto: eventos de outro projeto nunca entram na resposta.
        send(socket, {
          type: 'mission-events',
          projectId: message.projectId,
          missionId: message.missionId ?? null,
          events: events?.list({ projectId: message.projectId, missionId: message.missionId, afterId: message.afterId }) ?? [],
        })
        break
      case 'skills-list':
        if (skills) send(socket, { type: 'skills', skills: skills.list(), overrides: skills.overrides() })
        break
      case 'skill-save':
      case 'skill-set-enabled':
      case 'skill-set-agent':
        // Só a interface muda skills: agentes não têm como registrar nem ativar instruções.
        if (!skills) break
        try {
          if (message.type === 'skill-save') {
            const saved = skills.save(message.skill)
            history.add({ kind: 'agent', message: `Skill salva: ${saved.name} (${saved.id}) · versão ${saved.version} · ${saved.hash.slice(0, 12)}` })
          } else if (message.type === 'skill-set-enabled') {
            const saved = skills.setEnabled(message.id, message.enabled)
            history.add({ kind: 'agent', message: `Skill ${saved.name} ${saved.enabled ? 'ativada' : 'desativada'} para todos os agentes.` })
          } else {
            if (!agentConfigs.find(message.agentId)) throw new Error(`Agente não encontrado: "${message.agentId}".`)
            skills.setAgent(message.agentId, message.skillId, message.state)
            const label = { inherit: 'herda a configuração global', on: 'ativada', off: 'desativada' }[message.state]
            history.add({ kind: 'agent', message: `Skill ${message.skillId} em ${message.agentId}: ${label}.`, agentId: message.agentId })
          }
        } catch (error) {
          send(socket, { type: 'notice', message: errorText(error) })
        }
        break
    }
  }

  wss.on('connection', (socket: WebSocket) => {
    send(socket, {
      type: 'snapshot',
      agents: registry.list(),
      workspace: projects.workspace(),
      tasks: tasks.list(),
      missions: tasks.listMissions(),
      history: history.list(),
      configs: agentConfigs.list(),
      allConfigs: agentConfigs.list({ includeInactive: true }),
      specializations: defaultSpecializations.list(),
      skills: skills?.list() ?? [],
      skillOverrides: skills?.overrides() ?? [],
    })
    socket.on('message', (raw) => {
      const text = raw.toString()
      const message = parseClientMessage(text)
      if (message) return handle(socket, message)
      // Mensagem de chat fora do formato: responde com erro em vez de silêncio (a tela não fica esperando).
      const loose = safeJson(text)
      if (typeof loose?.type === 'string' && loose.type.startsWith('chat-')) {
        chatResult(socket, actionOf(loose.type), isOpId(loose.opId) ? loose.opId : null, false, 'Mensagem de chat inválida (formato ou tamanho).')
      }
    })
  })

  const onAgent = (agent: AgentInfo) => broadcast({ type: 'agent', agent })
  const onAgentList = (agents: AgentInfo[]) => broadcast({ type: 'agents', agents })
  const onData = (agentId: string, data: string) => broadcast({ type: 'term-data', agentId, data })
  const onExit = (agentId: string, code: number) => broadcast({ type: 'term-exit', agentId, code })
  const onTasks = () => broadcast({ type: 'tasks', tasks: tasks.list() })
  const onMissions = () => broadcast({ type: 'missions', missions: tasks.listMissions() })
  const onHistory = () => broadcast({ type: 'history', entries: history.list() })
  const onConfigs = (configs: AgentConfig[]) => {
    registry.syncFromConfigs(configs)
    broadcast({
      type: 'agent-configs',
      configs,
      allConfigs: agentConfigs.list({ includeInactive: true }),
    })
  }
  const onSkills = () => skills && broadcast({ type: 'skills', skills: skills.list(), overrides: skills.overrides() })
  const onEvent = (event: MissionEvent) => broadcast({ type: 'mission-event', event })
  const onPlan = (missionId: number) => {
    const mission = tasks.getMission(missionId)
    if (mission) broadcast(planMessage(mission.projectId, missionId))
  }
  const onMemory = (projectId: number) => broadcast({ type: 'memory-changed', projectId })
  const onMissionOutput = (missionId: number, data: string) => broadcast({ type: 'mission-output', missionId, data })
  const onGitChange = async (event: { agentId?: string; cwd: string; files: string[]; summary: string }) => {
    broadcast({ type: 'git-activity', summary: event.summary, files: event.files, agentId: event.agentId })
    try {
      broadcast({ type: 'git-status', status: await git.status(event.cwd) })
    } catch {}
  }

  registry.on('change', onAgent)
  registry.on('list', onAgentList)
  terminals.on('data', onData)
  terminals.on('exit', onExit)
  tasks.on('tasks', onTasks)
  tasks.on('missions', onMissions)
  history.on('added', onHistory)
  agentConfigs.on('change', onConfigs)
  memory.on('change', onMemory)
  skills?.on('change', onSkills)
  events?.on('added', onEvent)
  plans?.on('change', onPlan)
  team.on('output', onMissionOutput)
  team.on('git-change', onGitChange)
  const onChatMessage = (message: ChatMessage) => broadcast({ type: 'chat-message', message })
  const onChatDelta = (delta: { projectId: number; conversationId: number; messageId: number; text: string }) => broadcast({ type: 'chat-delta', ...delta })
  const onChatConversations = (projectId: number) => broadcast(conversationsMessage(projectId))
  chat?.service.on('message', onChatMessage)
  chat?.service.on('delta', onChatDelta)
  chat?.store.on('conversations', onChatConversations)

  server.on('close', () => {
    registry.off('change', onAgent)
    registry.off('list', onAgentList)
    terminals.off('data', onData)
    terminals.off('exit', onExit)
    tasks.off('tasks', onTasks)
    tasks.off('missions', onMissions)
    history.off('added', onHistory)
    agentConfigs.off('change', onConfigs)
    memory.off('change', onMemory)
    skills?.off('change', onSkills)
    events?.off('added', onEvent)
    plans?.off('change', onPlan)
    team.off('output', onMissionOutput)
    team.off('git-change', onGitChange)
    chat?.service.off('message', onChatMessage)
    chat?.service.off('delta', onChatDelta)
    chat?.store.off('conversations', onChatConversations)
    for (const client of wss.clients) client.terminate()
  })

  return server
}
