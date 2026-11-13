import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { AgentConfigStore } from './agents/configStore.ts'
import { AgentRegistry, DEFAULT_AGENTS } from './agents/registry.ts'
import { GitService } from './git/service.ts'
import { HistoryStore } from './history/store.ts'
import { MemoryStore } from './memory/store.ts'
import { EventStore } from './observability/store.ts'
import { ProjectStore } from './projects/store.ts'
import { createAppServer } from './server.ts'
import { SkillStore } from './skills/store.ts'
import { TaskStore } from './tasks/store.ts'
import { TeamRunner } from './team/runner.ts'
import { TerminalManager } from './terminal/manager.ts'

test('securityGauntlet: bloqueia acesso não autenticado, Origin falsificado e consentimento sem segredo desktop', async () => {
  const prevSecret = process.env.AIDW_DESKTOP_BOOTSTRAP_SECRET
  process.env.AIDW_DESKTOP_BOOTSTRAP_SECRET = 'test-desktop-secret-14-5'

  const projects = new ProjectStore(':memory:')
  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const agentConfigs = new AgentConfigStore(projects.db)
  const memory = new MemoryStore(projects.db, history)
  const skills = new SkillStore(projects.db)
  const events = new EventStore(projects.db)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: 'fake 1.0', auth: 'ok' }))
  const terminals = new EventEmitter() as unknown as TerminalManager
  const team = new EventEmitter() as unknown as TeamRunner
  const git = new EventEmitter() as unknown as GitService

  const server = createAppServer({
    registry,
    terminals,
    projects,
    tasks,
    history,
    memory,
    agentConfigs,
    skills,
    events,
    team,
    git,
    allowedOrigins: ['http://localhost:5173'],
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  const base = `http://127.0.0.1:${port}`

  try {
    // 1. Unauthenticated requests -> 401
    const diagUnauth = await fetch(`${base}/api/diagnostics`)
    assert.equal(diagUnauth.status, 401)
    const catUnauth = await fetch(`${base}/api/setup/catalog`)
    assert.equal(catUnauth.status, 401)
    const instUnauth = await fetch(`${base}/api/setup/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toolId: 'git', consentNonce: 'fake' }),
    })
    assert.equal(instUnauth.status, 401)

    // 2. Consent without x-aidw-desktop-secret even with Bearer -> 403
    const consentNoSecret = await fetch(`${base}/api/setup/consent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${server.authToken}`,
      },
      body: JSON.stringify({ toolId: 'git' }),
    })
    assert.equal(consentNoSecret.status, 403)

    // 3. Consent WITH x-aidw-desktop-secret -> 200, then forged Origin -> 403
    const consentOk = await fetch(`${base}/api/setup/consent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aidw-desktop-secret': 'test-desktop-secret-14-5',
      },
      body: JSON.stringify({ toolId: 'git' }),
    })
    assert.equal(consentOk.status, 200)
    const { nonce } = (await consentOk.json()) as { nonce: string }
    assert.ok(nonce)

    const forgedOrigin = await fetch(`${base}/api/setup/install`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${server.authToken}`,
        origin: 'http://evil.example',
      },
      body: JSON.stringify({ toolId: 'git', consentNonce: nonce }),
    })
    assert.equal(forgedOrigin.status, 403)

    // 4. Wrong toolId for nonce -> 403
    const wrongTool = await fetch(`${base}/api/setup/install`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${server.authToken}`,
        origin: 'http://localhost:5173',
      },
      body: JSON.stringify({ toolId: 'codex', consentNonce: nonce }),
    })
    assert.equal(wrongTool.status, 403)
  } finally {
    server.close()
    projects.db.close()
    if (prevSecret === undefined) delete process.env.AIDW_DESKTOP_BOOTSTRAP_SECRET
    else process.env.AIDW_DESKTOP_BOOTSTRAP_SECRET = prevSecret
  }
})
