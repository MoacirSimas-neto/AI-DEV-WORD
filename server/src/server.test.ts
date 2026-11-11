import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { WebSocket } from 'ws'
import type { ServerMessage } from '../../shared/protocol.ts'
import { AgentRegistry, DEFAULT_AGENTS } from './agents/registry.ts'
import { createAppServer } from './server.ts'

const ORIGIN = 'http://localhost:5173'
const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({
  found: true,
  version: 'fake 1.0',
  auth: 'ok',
}))
const server = createAppServer({ registry, allowedOrigins: [ORIGIN] })
let port = 0

before(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  port = (server.address() as AddressInfo).port
})
after(() => server.close())

function nextMessage(socket: WebSocket): Promise<ServerMessage> {
  return once(socket, 'message').then(([raw]) => JSON.parse(String(raw)) as ServerMessage)
}

test('health responde em loopback', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`)
  assert.deepEqual(await res.json(), { ok: true })
})

test('HTTP com origem de outro site é recusado', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
    headers: { origin: 'https://site-malicioso.example' },
  })
  assert.equal(res.status, 403)
})

test('WebSocket de origem não autorizada é recusado', async () => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'https://site-malicioso.example' })
  const [error] = await once(socket, 'error')
  assert.match(String(error), /403/)
})

test('cliente recebe snapshot e depois os eventos de uma verificação', async () => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ORIGIN })
  const snapshot = await nextMessage(socket)
  assert.equal(snapshot.type, 'snapshot')
  assert.equal(snapshot.type === 'snapshot' && snapshot.agents[0].id, 'dev')

  const received: ServerMessage[] = []
  const done = new Promise<void>((resolve) => {
    socket.on('message', (raw) => {
      received.push(JSON.parse(String(raw)) as ServerMessage)
      if (received.length === 2) resolve()
    })
  })
  socket.send(JSON.stringify({ type: 'check-cli', agentId: 'dev' }))
  await done
  socket.close()

  const states = received.map((m) => (m.type === 'agent' ? m.agent.state : m.type))
  assert.deepEqual(states, ['working', 'idle'])
})
