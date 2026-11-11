import { createServer, type IncomingMessage, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { AgentInfo, ClientMessage, ServerMessage } from '../../shared/protocol.ts'
import type { AgentRegistry } from './agents/registry.ts'
import type { ProjectStore } from './projects/store.ts'
import type { TerminalManager } from './terminal/manager.ts'

export interface AppServerOptions {
  registry: AgentRegistry
  terminals: TerminalManager
  projects: ProjectStore
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
    case 'project-select':
    case 'project-remove':
      return isId(msg.projectId) ? { type: msg.type, projectId: msg.projectId } : null
    default:
      return null
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createAppServer({ registry, terminals, projects, allowedOrigins }: AppServerOptions): Server {
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

  const handle = (socket: WebSocket, message: ClientMessage) => {
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
      case 'project-select':
        changeWorkspace(socket, () => projects.select(message.projectId))
        break
      case 'project-remove':
        changeWorkspace(socket, () => projects.remove(message.projectId))
        break
    }
  }

  wss.on('connection', (socket: WebSocket) => {
    send(socket, { type: 'snapshot', agents: registry.list(), workspace: projects.workspace() })
    socket.on('message', (raw) => {
      const message = parseClientMessage(raw.toString())
      if (message) handle(socket, message)
    })
  })

  const onAgent = (agent: AgentInfo) => broadcast({ type: 'agent', agent })
  const onData = (agentId: string, data: string) => broadcast({ type: 'term-data', agentId, data })
  const onExit = (agentId: string, code: number) => broadcast({ type: 'term-exit', agentId, code })
  registry.on('change', onAgent)
  terminals.on('data', onData)
  terminals.on('exit', onExit)
  server.on('close', () => {
    registry.off('change', onAgent)
    terminals.off('data', onData)
    terminals.off('exit', onExit)
    for (const client of wss.clients) client.terminate()
  })

  return server
}
