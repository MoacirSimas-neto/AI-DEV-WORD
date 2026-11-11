import { createServer, type IncomingMessage, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { AgentInfo, ClientMessage, ServerMessage } from '../../shared/protocol.ts'
import type { AgentRegistry } from './agents/registry.ts'
import type { TerminalManager } from './terminal/manager.ts'

export interface AppServerOptions {
  registry: AgentRegistry
  terminals: TerminalManager
  allowedOrigins: string[]
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1'])

/** Bloqueia DNS rebinding: o cabeçalho Host precisa ser um nome local. */
function hasLocalHost(req: IncomingMessage): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  return LOCAL_HOSTNAMES.has(hostname)
}

const isSize = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 2 && (n as number) <= 500

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
  if (typeof agentId !== 'string') return null

  switch (msg.type) {
    case 'check-cli':
    case 'term-close':
      return { type: msg.type, agentId }
    case 'term-open':
    case 'term-resize':
      return isSize(msg.cols) && isSize(msg.rows)
        ? { type: msg.type, agentId, cols: msg.cols, rows: msg.rows }
        : null
    case 'term-input':
      return typeof msg.data === 'string' ? { type: 'term-input', agentId, data: msg.data } : null
    default:
      return null
  }
}

export function createAppServer({ registry, terminals, allowedOrigins }: AppServerOptions): Server {
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

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
  const send = (socket: WebSocket, message: ServerMessage) => socket.send(JSON.stringify(message))
  const broadcast = (message: ServerMessage) => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) send(client, message)
    }
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

  const handle = (socket: WebSocket, message: ClientMessage) => {
    const { agentId } = message
    switch (message.type) {
      case 'check-cli':
        void registry.check(agentId)
        break
      case 'term-open':
        try {
          const replay = terminals.open(agentId, message.cols, message.rows)
          send(socket, { type: 'term-ready', agentId, replay })
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error)
          send(socket, { type: 'term-error', agentId, message: text })
        }
        break
      case 'term-input':
        terminals.write(agentId, message.data)
        break
      case 'term-resize':
        terminals.resize(agentId, message.cols, message.rows)
        break
      case 'term-close':
        terminals.close(agentId)
        break
    }
  }

  wss.on('connection', (socket: WebSocket) => {
    send(socket, { type: 'snapshot', agents: registry.list() })
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
