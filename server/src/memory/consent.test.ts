import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '../../../shared/protocol.ts'
import { AgentConfigStore } from '../agents/configStore.ts'
import { AgentRegistry, DEFAULT_AGENTS } from '../agents/registry.ts'
import { GitService } from '../git/service.ts'
import { HistoryStore } from '../history/store.ts'
import { EventStore } from '../observability/store.ts'
import { ProjectStore } from '../projects/store.ts'
import { createAppServer } from '../server.ts'
import { TaskStore } from '../tasks/store.ts'
import { TeamRunner } from '../team/runner.ts'
import { TerminalManager } from '../terminal/manager.ts'
import { MemoryConsentGate } from './consent.ts'
import { HUMAN, MemoryStore } from './store.ts'

function openStores(file: string, dir: string) {
  const projects = new ProjectStore(file)
  if (!projects.active()) projects.add(dir)
  const history = new HistoryStore(projects.db)
  const memory = new MemoryStore(projects.db, history)
  return { projects, history, memory, projectId: projects.active()!.id }
}

test('MemoryConsentGate: propostas pendentes, bloqueio sem consentimento, uso único, expiração e vínculo', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidw-mem-consent-'))
  const file = path.join(dir, 'data.sqlite')
  try {
    const { projects, memory, projectId } = openStores(file, dir)
    const gate = new MemoryConsentGate()

    const [proposed1, proposed2] = memory.proposeFromMission({
      id: 1,
      taskId: 1,
      projectId,
      phase: 'done',
      plannerId: 'architect',
      devId: 'dev',
      qaId: 'qa',
      plan: 'MEMÓRIA(decisão): Usar SQLite local com WAL.',
      devReport: '',
      review: 'MEMÓRIA(problema): Escrita concorrente exige busy_timeout.',
      verdict: 'approved',
      verdictDetail: 'OK',
      attempts: [],
      files: [],
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    assert.equal(proposed1.status, 'proposed')
    assert.equal(proposed1.approvedBy, null)

    assert.throws(() => gate.consume(undefined, 'approve', proposed1.id), /Autorização humana obrigatória/)
    assert.equal(memory.get(proposed1.id)?.status, 'proposed')

    const ticket1 = gate.issue('approve', proposed1.id)
    gate.consume(ticket1.nonce, 'approve', proposed1.id)
    const approved = memory.approve(proposed1.id, HUMAN)
    assert.equal(approved.status, 'approved')
    assert.equal(approved.approvedBy, 'user')

    assert.throws(() => gate.consume(ticket1.nonce, 'approve', proposed1.id), /inválida ou já utilizada/)

    const ticket2 = gate.issue('approve', proposed2.id)
    assert.throws(() => gate.consume(ticket2.nonce, 'approve', proposed1.id), /outra memória/)

    const expired = gate.issue('approve', proposed2.id, -1)
    assert.throws(() => gate.consume(expired.nonce, 'approve', proposed2.id), /expirada/)

    const rejected = memory.reject(proposed2.id, HUMAN)
    assert.equal(rejected.status, 'rejected')
    const ctx = memory.currentFor(projectId, 'architect')
    assert.ok(ctx.some((m) => m.id === proposed1.id))
    assert.ok(!ctx.some((m) => m.id === proposed2.id))

    projects.close()
    const reopened = openStores(file, dir)
    const listed = reopened.memory.list(projectId)
    assert.equal(listed.length, 2)
    assert.equal(listed.find((m) => m.id === proposed1.id)?.status, 'approved')
    assert.equal(listed.find((m) => m.id === proposed2.id)?.status, 'rejected')
    reopened.projects.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Integração desktop -> backend -> banco: consentimento nativo obrigatório, concorrência, modo web e reinício', async () => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-mem-e2e-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  writeFileSync(path.join(dir, 'README.md'), 'test')
  const dbFile = path.join(dir, 'data.sqlite')
  const prevSecret = process.env.AIDW_DESKTOP_BOOTSTRAP_SECRET
  const DESKTOP_SECRET = 'desktop-secret-integration-test'
  process.env.AIDW_DESKTOP_BOOTSTRAP_SECRET = DESKTOP_SECRET

  const { projects, history, memory, projectId } = openStores(dbFile, dir)
  const tasks = new TaskStore(projects.db, history)
  const agentConfigs = new AgentConfigStore(projects.db)
  const events = new EventStore(projects.db)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: 'fake 1.0', auth: 'ok' }))
  const git = new GitService()
  const team = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    git,
    configs: agentConfigs,
    launch: () => ({ done: Promise.resolve({ code: 0, stdout: 'ok', stderr: '', timedOut: false }), kill: () => {} }),
  })
  const terminals = new TerminalManager(registry, () => ({ onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {} }), () => dir)
  const ORIGIN = 'http://localhost:5173'
  const server = createAppServer({ registry, terminals, projects, git, tasks, history, team, agentConfigs, memory, events, allowedOrigins: [ORIGIN] })

  const serversToClose: Array<ReturnType<typeof createAppServer>> = []
  const socketsToClose: WebSocket[] = []
  const dbsToClose: ProjectStore[] = [projects]

  try {
    serversToClose.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port

    const connectWs = async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        origin: ORIGIN,
        headers: { Authorization: `Bearer ${server.authToken}` },
      })
      socketsToClose.push(socket)
      const queue: ServerMessage[] = []
      const waiters: Array<(msg: ServerMessage) => void> = []
      socket.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as ServerMessage
        const idx = waiters.findIndex((fn) => { fn(msg); return true })
        if (idx >= 0) waiters.splice(idx, 1)
        else queue.push(msg)
      })
      await once(socket, 'open')
      const waitFor = <T extends ServerMessage['type']>(type: T) =>
        new Promise<Extract<ServerMessage, { type: T }>>((resolve) => {
          const hit = queue.findIndex((m) => m.type === type)
          if (hit >= 0) return resolve(queue.splice(hit, 1)[0] as Extract<ServerMessage, { type: T }>)
          const poll = (msg: ServerMessage) => {
            if (msg.type === type) resolve(msg as Extract<ServerMessage, { type: T }>)
            else waiters.push(poll)
          }
          waiters.push(poll)
        })
      await waitFor('snapshot')
      return {
        socket,
        send: (msg: ClientMessage) => socket.send(JSON.stringify(msg)),
        waitFor,
      }
    }

    const requestConsent = async (action: 'create' | 'approve' | 'reject' | 'supersede', targetId: number, secret?: string) =>
      fetch(`http://127.0.0.1:${port}/api/memory/consent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          ...(secret ? { 'x-aidw-desktop-secret': secret } : {}),
        },
        body: JSON.stringify({ action, targetId }),
      })

    const task = tasks.create(projectId, { title: 'Missão Teste', description: 'Desc', priority: 'medium', status: 'todo', agentId: null })
    const mission = tasks.createMission(task.id, projectId)
    const [m1, m2] = memory.proposeFromMission({
      ...mission,
      plan: 'MEMÓRIA(decisão): Validar contratos na borda.',
      review: 'MEMÓRIA(problema): Timeout curto em IO.',
    })
    assert.equal(m1.status, 'proposed')
    assert.equal(m2.status, 'proposed')
    assert.equal(memory.currentFor(projectId, 'architect').length, 0)

    const ws1 = await connectWs()
    const ws2 = await connectWs()

    // 1. Cliente autenticado sem consentimento não aprova
    ws1.send({ type: 'memory-approve', id: m1.id })
    const denied = await ws1.waitFor('notice')
    assert.match(denied.message, /Autorização humana obrigatória/)
    assert.equal(memory.get(m1.id)?.status, 'proposed')

    // 2. Endpoint de consentimento rejeita sem segredo do desktop
    const noSecretRes = await requestConsent('approve', m1.id)
    assert.equal(noSecretRes.status, 403)

    // 3. Nonce de outra memória não funciona
    const otherTicketRes = await requestConsent('approve', m2.id, DESKTOP_SECRET)
    assert.equal(otherTicketRes.status, 200)
    const otherTicket = (await otherTicketRes.json()) as { nonce: string }
    ws1.send({ type: 'memory-approve', id: m1.id, consentNonce: otherTicket.nonce })
    const wrongTarget = await ws1.waitFor('notice')
    assert.match(wrongTarget.message, /outra memória/)
    assert.equal(memory.get(m1.id)?.status, 'proposed')

    // 4. Aprovação concorrente com o mesmo nonce: só uma aprova, outra é rejeitada
    const validRes = await requestConsent('approve', m1.id, DESKTOP_SECRET)
    assert.equal(validRes.status, 200)
    const validTicket = (await validRes.json()) as { nonce: string }
    ws1.send({ type: 'memory-approve', id: m1.id, consentNonce: validTicket.nonce })
    ws2.send({ type: 'memory-approve', id: m1.id, consentNonce: validTicket.nonce })
    await ws1.waitFor('memory-changed')
    const concurrentReject = await ws2.waitFor('notice')
    assert.match(concurrentReject.message, /inválida ou já utilizada/)
    assert.equal(memory.get(m1.id)?.status, 'approved')
    assert.equal(memory.get(m1.id)?.approvedBy, 'user')

    // 5. Rejeição com consentimento mantém fora do contexto futuro
    const rejectRes = await requestConsent('reject', m2.id, DESKTOP_SECRET)
    const rejectTicket = (await rejectRes.json()) as { nonce: string }
    ws1.send({ type: 'memory-reject', id: m2.id, consentNonce: rejectTicket.nonce })
    await ws1.waitFor('memory-changed')
    assert.equal(memory.get(m2.id)?.status, 'rejected')
    assert.deepEqual(memory.currentFor(projectId, 'architect').map((m) => m.id), [m1.id])

    // 6. Auditoria em mission_events não vaza segredo nem nonce
    const evList = events.list({ projectId, missionId: mission.id })
    const audit = evList.find((e) => e.type === 'approval.received')
    assert.ok(audit)
    const serialized = JSON.stringify(audit)
    assert.ok(!serialized.includes(DESKTOP_SECRET))
    assert.ok(!serialized.includes(validTicket.nonce))

    ws1.socket.close()
    ws2.socket.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    projects.close()

    // 7. Modo web/headless (sem AIDW_DESKTOP_BOOTSTRAP_SECRET) falha fechado no /api/memory/consent
    process.env.AIDW_DESKTOP_BOOTSTRAP_SECRET = ''
    const reopened = openStores(dbFile, dir)
    dbsToClose.push(reopened.projects)
    assert.equal(reopened.memory.get(m1.id)?.status, 'approved')
    assert.equal(reopened.memory.get(m2.id)?.status, 'rejected')
    const webServer = createAppServer({
      registry,
      terminals,
      projects: reopened.projects,
      git,
      tasks: new TaskStore(reopened.projects.db, reopened.history),
      history: reopened.history,
      team,
      agentConfigs: new AgentConfigStore(reopened.projects.db),
      memory: reopened.memory,
      allowedOrigins: [ORIGIN],
    })
    serversToClose.push(webServer)
    await new Promise<void>((resolve) => webServer.listen(0, '127.0.0.1', resolve))
    const webPort = (webServer.address() as AddressInfo).port
    const webRes = await fetch(`http://127.0.0.1:${webPort}/api/memory/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, Authorization: `Bearer ${webServer.authToken}` },
      body: JSON.stringify({ action: 'approve', targetId: m1.id }),
    })
    assert.equal(webRes.status, 403)
  } finally {
    for (const s of socketsToClose) s.terminate()
    for (const srv of serversToClose) {
      srv.closeAllConnections?.()
      await new Promise<void>((resolve) => srv.close(() => resolve()))
    }
    for (const db of dbsToClose) {
      try { db.close() } catch {}
    }
    if (prevSecret === undefined) delete process.env.AIDW_DESKTOP_BOOTSTRAP_SECRET
    else process.env.AIDW_DESKTOP_BOOTSTRAP_SECRET = prevSecret
    rmSync(dir, { recursive: true, force: true })
  }
})
