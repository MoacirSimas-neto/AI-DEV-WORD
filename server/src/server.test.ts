import assert from 'node:assert/strict'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '../../shared/protocol.ts'
import { AgentRegistry, DEFAULT_AGENTS } from './agents/registry.ts'
import { GitService } from './git/service.ts'
import { HistoryStore } from './history/store.ts'
import { ProjectStore } from './projects/store.ts'
import { createAppServer, parseClientMessage } from './server.ts'
import { TaskStore } from './tasks/store.ts'
import { TeamRunner } from './team/runner.ts'
import { TerminalManager } from './terminal/manager.ts'

const ORIGIN = 'http://localhost:5173'
const projectDir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-srv-')))

const projects = new ProjectStore(':memory:')
const history = new HistoryStore(projects.db)
const tasks = new TaskStore(projects.db, history)
const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: 'fake 1.0', auth: 'ok' }))
const git = new GitService()
const team = new TeamRunner({
  tasks,
  history,
  projects,
  registry,
  git,
  launch: () => ({
    done: Promise.resolve({ code: 0, stdout: 'ok', stderr: '', timedOut: false }),
    kill: () => {},
  }),
})

// "Processo" falso que responde com eco, para testar o caminho do terminal.
const terminals = new TerminalManager(
  registry,
  () => {
    let emit: (data: string) => void = () => {}
    return {
      onData: (listener) => (emit = listener),
      onExit: () => {},
      write: (data) => emit(`eco:${data}`),
      resize: () => {},
      kill: () => {},
    }
  },
  () => projects.active()?.path ?? null,
)
const server = createAppServer({
  registry,
  terminals,
  projects,
  git,
  tasks,
  history,
  team,
  allowedOrigins: [ORIGIN],
})
let port = 0

before(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  port = (server.address() as AddressInfo).port
  await registry.check('dev')
})
after(() => server.close())

/** Cliente de teste: guarda tudo que chega e permite esperar por uma mensagem. */
async function connect() {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ORIGIN })
  const received: ServerMessage[] = []
  let notify = () => {}
  socket.on('message', (raw) => {
    received.push(JSON.parse(String(raw)) as ServerMessage)
    notify()
  })
  const waitFor = async <T extends ServerMessage['type']>(type: T) => {
    for (;;) {
      const index = received.findIndex((m) => m.type === type)
      if (index >= 0) return received.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>
      await new Promise<void>((resolve) => (notify = resolve))
    }
  }
  const send = (message: ClientMessage) => socket.send(JSON.stringify(message))
  await once(socket, 'open')
  return { socket, send, waitFor }
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

test('cliente recebe snapshot e o resultado de uma verificação', async () => {
  const client = await connect()
  const snapshot = await client.waitFor('snapshot')
  assert.equal(snapshot.agents.length, 4)
  assert.deepEqual(snapshot.workspace, { projects: [], activeProjectId: null })

  client.send({ type: 'check-cli', agentId: 'dev' })
  assert.equal((await client.waitFor('agent')).agent.checking, true)
  const checked = (await client.waitFor('agent')).agent
  assert.equal(checked.state, 'idle')
  assert.equal(checked.cliVersion, 'fake 1.0')
  client.socket.close()
})

test('terminal é recusado sem projeto e funciona depois de adicionar um', async () => {
  const client = await connect()
  await client.waitFor('snapshot')

  client.send({ type: 'term-open', agentId: 'dev', cols: 80, rows: 24 })
  assert.match((await client.waitFor('term-error')).message, /Escolha um projeto/)

  client.send({ type: 'project-add', path: 'caminho/relativo' })
  assert.match((await client.waitFor('notice')).message, /caminho completo/)

  client.send({ type: 'project-add', path: projectDir })
  const { workspace } = await client.waitFor('workspace')
  assert.equal(workspace.projects[0].path, projectDir)
  assert.equal(workspace.activeProjectId, workspace.projects[0].id)

  client.send({ type: 'term-open', agentId: 'dev', cols: 80, rows: 24 })
  assert.equal((await client.waitFor('term-ready')).replay, '')
  client.send({ type: 'term-input', agentId: 'dev', data: 'ls' })
  assert.equal((await client.waitFor('term-data')).data, 'eco:ls')
  client.socket.close()
})

test('git: estado, diff e preparação pelo WebSocket; push sem prévia é recusado', async () => {
  const client = await connect()
  await client.waitFor('snapshot') // o projeto ativo já é projectDir (teste anterior)

  client.send({ type: 'git-status' })
  assert.equal((await client.waitFor('git-status')).status?.isRepo, false)

  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: projectDir })
  writeFileSync(path.join(projectDir, 'nota.txt'), 'linha nova\n')
  client.send({ type: 'git-status' })
  const { status } = await client.waitFor('git-status')
  assert.deepEqual(
    status?.files.map((f) => f.path),
    ['nota.txt'],
  )

  client.send({ type: 'git-diff', path: 'nota.txt', staged: false })
  assert.match((await client.waitFor('git-diff')).text, /\+linha nova/)

  client.send({ type: 'git-stage', paths: ['nota.txt'] })
  assert.equal((await client.waitFor('git-status')).status?.files[0].staged, true)

  client.send({ type: 'git-push', token: 'sem-previa' })
  const refused = await client.waitFor('git-result')
  assert.equal(refused.ok, false)
  assert.match(refused.message, /expirou ou o repositório mudou/)
  client.socket.close()
})

test('mensagens malformadas do cliente são descartadas', () => {
  assert.equal(parseClientMessage('{"type":"git-stage","paths":[]}'), null)
  assert.equal(parseClientMessage('{"type":"git-push"}'), null)
  assert.equal(parseClientMessage('não é json'), null)
  assert.equal(parseClientMessage('{"type":"term-open","agentId":"dev","cols":99999,"rows":24}'), null)
  assert.equal(parseClientMessage('{"type":"term-input","agentId":"dev","data":42}'), null)
  assert.equal(parseClientMessage('{"type":"check-cli"}'), null)
  assert.equal(parseClientMessage('{"type":"project-select","projectId":"1"}'), null)
  assert.equal(parseClientMessage('{"type":"desconhecido","agentId":"dev"}'), null)
})
