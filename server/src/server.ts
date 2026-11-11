import { createServer, type IncomingMessage, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { AgentInfo, ClientMessage, ServerMessage } from '../../shared/protocol.ts'
import type { AgentRegistry } from './agents/registry.ts'

export interface AppServerOptions {
  registry: AgentRegistry
  allowedOrigins: string[]
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1'])

/** Bloqueia DNS rebinding: o cabeçalho Host precisa ser um nome local. */
function hasLocalHost(req: IncomingMessage): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  return LOCAL_HOSTNAMES.has(hostname)
}

function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) return null
    const msg = data as Record<string, unknown>
    if (msg.type === 'check-cli' && typeof msg.agentId === 'string') {
      return { type: 'check-cli', agentId: msg.agentId }
    }
  } catch {
    // JSON inválido: ignorado
  }
  return null
}

export function createAppServer({ registry, allowedOrigins }: AppServerOptions): Server {
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

  wss.on('connection', (socket: WebSocket) => {
    send(socket, { type: 'snapshot', agents: registry.list() })
    socket.on('message', (raw) => {
      const message = parseClientMessage(raw.toString())
      if (message?.type === 'check-cli') void registry.check(message.agentId)
    })
  })

  const onChange = (agent: AgentInfo) => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) send(client, { type: 'agent', agent })
    }
  }
  registry.on('change', onChange)
  server.on('close', () => {
    registry.off('change', onChange)
    for (const client of wss.clients) client.terminate()
  })

  return server
}
