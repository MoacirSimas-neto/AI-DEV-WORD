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
import { AgentConfigStore } from './agents/configStore.ts'
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
const agentConfigs = new AgentConfigStore(projects.db)
const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: 'fake 1.0', auth: 'ok' }))
const git = new GitService()
const team = new TeamRunner({
  tasks,
  history,
  projects,
  registry,
  git,
  configs: agentConfigs,
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
  agentConfigs,
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
  assert.equal(snapshot.configs.length, 4)
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

test('configuração dos agentes pode ser atualizada, aplicar perfis e restaurar padrões', async () => {
  const client = await connect()
  const snapshot = await client.waitFor('snapshot')
  assert.equal(snapshot.configs.length, 4)

  client.send({
    type: 'agent-config-set',
    config: { agentId: 'architect', provider: 'gemini', model: 'gemini-2.5-pro', reasoningEffort: 'default' },
  })
  const updated = await client.waitFor('agent-configs')
  const arch = updated.configs.find((c) => c.agentId === 'architect')
  assert.equal(arch?.model, 'gemini-2.5-pro')

  client.send({ type: 'agent-config-profile', profile: 'economy' })
  const eco = await client.waitFor('agent-configs')
  const devEco = eco.configs.find((c) => c.agentId === 'dev')
  assert.equal(devEco?.reasoningEffort, 'low')

  client.send({ type: 'agent-config-reset' })
  const reset = await client.waitFor('agent-configs')
  const devReset = reset.configs.find((c) => c.agentId === 'dev')
  assert.equal(devReset?.reasoningEffort, 'high')

  // Configura agente com Antigravity
  client.send({
    type: 'agent-config-set',
    config: { agentId: 'architect', provider: 'antigravity', model: 'gemini-4-argon-high', reasoningEffort: 'high' },
  })
  const agyUpdated = await client.waitFor('agent-configs')
  const archAgy = agyUpdated.configs.find((c) => c.agentId === 'architect')
  assert.equal(archAgy?.provider, 'antigravity')
  assert.equal(archAgy?.model, 'gemini-4-argon-high')

  // Validação de projeto
  client.send({ type: 'project-validate', path: projectDir })
  const validRes = await client.waitFor('project-validate-result')
  assert.equal(validRes.valid, true)
  assert.equal(validRes.exists, true)
  assert.equal(validRes.isDirectory, true)

  client.send({ type: 'project-validate', path: 'caminho_inexistente_xyz' })
  const invalidRes = await client.waitFor('project-validate-result')
  assert.equal(invalidRes.valid, false)

  client.socket.close()
})

test('criar, atualizar, ativar e desativar agentes personalizados e consultar especializações via WebSocket', async () => {
  const client = await connect()
  const snapshot = await client.waitFor('snapshot')
  assert.ok(Array.isArray(snapshot.specializations))
  assert.equal(snapshot.specializations?.length, 4)

  // Cria um agente personalizado via WebSocket
  client.send({
    type: 'agent-create',
    agent: {
      id: 'ws-dev-custom',
      name: 'Dev WebSocket',
      role: 'Especialista API',
      roleCategory: 'developing',
      specializationId: 'developer',
      provider: 'codex',
      model: 'gpt-5',
      reasoningEffort: 'high',
      customInstructions: 'Seguir convenções REST.',
    },
  })
  const afterCreate = await client.waitFor('agent-configs')
  const created = afterCreate.configs.find((c) => c.agentId === 'ws-dev-custom')
  assert.ok(created)
  assert.equal(created.name, 'Dev WebSocket')
  assert.equal(created.roleCategory, 'developing')
  assert.equal(registry.get('ws-dev-custom')?.name, 'Dev WebSocket')

  // Atualiza o agente personalizado via WebSocket
  client.send({
    type: 'agent-update',
    agentId: 'ws-dev-custom',
    patch: {
      name: 'Dev WebSocket v2',
      model: 'gpt-5-mini',
      reasoningEffort: 'medium',
    },
  })
  const afterUpdate = await client.waitFor('agent-configs')
  const updated = afterUpdate.configs.find((c) => c.agentId === 'ws-dev-custom')
  assert.equal(updated?.name, 'Dev WebSocket v2')
  assert.equal(updated?.model, 'gpt-5-mini')

  // Desativa o agente personalizado via WebSocket
  client.send({
    type: 'agent-set-active',
    agentId: 'ws-dev-custom',
    active: false,
  })
  const afterDeactivate = await client.waitFor('agent-configs')
  assert.ok(!afterDeactivate.configs.some((c) => c.agentId === 'ws-dev-custom'))
  assert.ok(afterDeactivate.allConfigs?.some((c) => c.agentId === 'ws-dev-custom' && c.active === false))
  assert.equal(registry.get('ws-dev-custom'), undefined)

  // Reativa o agente personalizado via WebSocket
  client.send({
    type: 'agent-set-active',
    agentId: 'ws-dev-custom',
    active: true,
  })
  const afterReactivate = await client.waitFor('agent-configs')
  assert.ok(afterReactivate.configs.some((c) => c.agentId === 'ws-dev-custom' && c.active === true))
  assert.equal(registry.get('ws-dev-custom')?.name, 'Dev WebSocket v2')

  // Impede desativar agente padrão via WebSocket
  client.send({
    type: 'agent-set-active',
    agentId: 'architect',
    active: false,
  })
  const notice = await client.waitFor('notice')
  assert.match(notice.message, /Agentes padrão não podem ser desativados/)

  // Consulta especializações explicitamente
  client.send({ type: 'specializations-list' })
  const specsMsg = await client.waitFor('specializations')
  assert.equal(specsMsg.specializations.length, 4)

  client.socket.close()
})
