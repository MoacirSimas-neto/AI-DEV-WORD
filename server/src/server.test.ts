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
import { computeOfficePlacement, shortLabelForAgent } from '../../web/src/game/officeLayout.ts'
import { AgentConfigStore } from './agents/configStore.ts'
import { AgentRegistry, DEFAULT_AGENTS } from './agents/registry.ts'
import { GitService } from './git/service.ts'
import { HistoryStore } from './history/store.ts'
import { MemoryStore } from './memory/store.ts'
import { EventStore } from './observability/store.ts'
import { ProjectStore } from './projects/store.ts'
import { createAppServer, parseClientMessage } from './server.ts'
import { SkillStore } from './skills/store.ts'
import { TaskStore } from './tasks/store.ts'
import { TeamRunner } from './team/runner.ts'
import { TerminalManager } from './terminal/manager.ts'

const ORIGIN = 'http://localhost:5173'
const projectDir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-srv-')))

const projects = new ProjectStore(':memory:')
const history = new HistoryStore(projects.db)
const tasks = new TaskStore(projects.db, history)
const agentConfigs = new AgentConfigStore(projects.db)
const memory = new MemoryStore(projects.db, history)
const skills = new SkillStore(projects.db)
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
  {
    // "Shell" falso do terminal pessoal: ecoa a entrada e encerra de verdade no kill.
    spawnShell: () => {
      let emit: (data: string) => void = () => {}
      let exit: (event: { exitCode: number }) => void = () => {}
      return {
        onData: (listener) => (emit = listener),
        onExit: (listener) => (exit = listener),
        write: (data) => emit(`shell:${data}`),
        resize: () => {},
        kill: () => exit({ exitCode: 0 }),
      }
    },
  },
)
const DESKTOP_SECRET = 'aidw-test-desktop-secret'
process.env.AIDW_DESKTOP_BOOTSTRAP_SECRET = DESKTOP_SECRET
const server = createAppServer({
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
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    origin: ORIGIN,
    headers: { Authorization: `Bearer ${server.authToken}` },
  })
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

test('terminal pessoal via WebSocket: lista vem do backend, eco isolado, reconexão e encerramento', async () => {
  const client = await connect()
  await client.waitFor('snapshot')
  assert.deepEqual((await client.waitFor('term-sessions')).ids, [])

  client.send({ type: 'term-open', agentId: 'user:1', cols: 80, rows: 24 })
  assert.deepEqual((await client.waitFor('term-sessions')).ids, ['user:1'])
  assert.equal((await client.waitFor('term-ready')).agentId, 'user:1')
  client.send({ type: 'term-input', agentId: 'user:1', data: 'git status\n' })
  const out = await client.waitFor('term-data')
  assert.deepEqual([out.agentId, out.data], ['user:1', 'shell:git status\n'])

  // A conexão cai (janela na bandeja, recarga): o processo fica; quem reconecta vê a sessão viva.
  client.socket.close()
  const again = await connect()
  await again.waitFor('snapshot')
  assert.deepEqual((await again.waitFor('term-sessions')).ids, ['user:1'])
  again.send({ type: 'term-open', agentId: 'user:1', cols: 80, rows: 24 })
  assert.equal((await again.waitFor('term-ready')).replay, 'shell:git status\n')

  again.send({ type: 'term-close', agentId: 'user:1' })
  assert.deepEqual((await again.waitFor('term-sessions')).ids, [])
  assert.equal((await again.waitFor('term-exit')).agentId, 'user:1')

  // Id que não é de agente nem `user:<n>` nunca abre processo.
  again.send({ type: 'term-open', agentId: 'user:../../x', cols: 80, rows: 24 })
  assert.match((await again.waitFor('term-error')).message, /Agente desconhecido/)
  again.socket.close()
})

test('tarefa não pode ser criada em projeto inexistente', async () => {
  const client = await connect()
  await client.waitFor('snapshot')
  client.send({
    type: 'task-create',
    projectId: 9999,
    task: { title: 'Órfã', description: '', priority: 'low', status: 'todo', agentId: null },
  })
  assert.match((await client.waitFor('notice')).message, /Projeto desconhecido/)
  assert.equal(tasks.list().length, 0)
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

  // Abre sessão PTY para o agente personalizado e verifica encerramento ao desativar
  client.send({ type: 'term-open', agentId: 'ws-dev-custom', cols: 90, rows: 28 })
  await client.waitFor('term-ready')
  assert.equal(registry.get('ws-dev-custom')?.session, true)

  client.send({
    type: 'agent-set-active',
    agentId: 'ws-dev-custom',
    active: false,
  })
  await client.waitFor('agent-configs')
  assert.equal(registry.get('ws-dev-custom'), undefined)

  client.socket.close()
})

test('posicionamento dinâmico no escritório 2D: inclusão, remoção e paginação sem sobreposição', () => {
  const baseAgents = registry.list()
  const initial = computeOfficePlacement(baseAgents, 0)
  assert.equal(initial.visible.length, 4)
  assert.equal(initial.totalSpecialists, 0)
  assert.equal(initial.totalPages, 1)

  // Adiciona 8 agentes personalizados ativos para testar paginação (máx 6 por página + 4 fixos = 10)
  const customAgents = Array.from({ length: 8 }, (_, idx) => ({
    id: `custom-agent-${idx + 1}`,
    name: `Especialista ${idx + 1}`,
    role: `Função ${idx + 1}`,
    cli: 'gemini' as const,
    roleCategory: 'developing' as const,
    specializationId: 'developer' as const,
    avatarPreset: 'specialist' as const,
    isBuiltin: false,
    state: 'idle' as const,
    checking: false,
    cliVersion: '1.0',
    auth: 'ok' as const,
    session: false,
    message: 'Pronto',
    checkedAt: new Date().toISOString(),
  }))

  const allWith8 = [...baseAgents.slice(0, 4), ...customAgents]
  const page0 = computeOfficePlacement(allWith8, 0)
  assert.equal(page0.totalSpecialists, 8)
  assert.equal(page0.totalPages, 2)
  assert.equal(page0.page, 0)
  assert.equal(page0.visible.length, 10) // 4 padrão + 6 página 1

  // Garante que nenhuma estação se sobrepõe (10 coordenadas distintas)
  const coords0 = new Set(page0.visible.map((p) => `${p.seat.x},${p.seat.y}`))
  assert.equal(coords0.size, 10)

  // Página 2 mostra os 4 agentes padrão + os 2 especialistas restantes (total 6)
  const page1 = computeOfficePlacement(allWith8, 1)
  assert.equal(page1.page, 1)
  assert.equal(page1.visible.length, 6)
  assert.ok(page1.visible.some((p) => p.agent.id === 'custom-agent-7'))
  assert.ok(page1.visible.some((p) => p.agent.id === 'custom-agent-8'))

  // Remover um agente desativado da lista de ativos atualiza imediatamente o escritório
  const afterDeactivation = baseAgents.slice(0, 4).concat(customAgents.slice(0, 1))
  const afterPlacement = computeOfficePlacement(afterDeactivation, 0)
  assert.equal(afterPlacement.totalSpecialists, 1)
  assert.equal(afterPlacement.visible.length, 5)
  assert.ok(afterPlacement.visible.some((p) => p.agent.id === 'custom-agent-1'))
  assert.ok(!afterPlacement.visible.some((p) => p.agent.id === 'custom-agent-2'))

  // Rótulos concisos e numeração de especialidades duplicadas (sem nomes longos flutuando)
  const testAgents = [
    { id: 'architect', name: 'Arquiteto', role: 'Planeja a solução' } as any,
    { id: 'dev', name: 'Dev', role: 'Implementa o código' } as any,
    { id: 'qa', name: 'QA', role: 'Revisa e testa' } as any,
    { id: 'tutor', name: 'Tutor', role: 'Explica e ensina' } as any,
    { id: 'data-1', name: 'Especialista em Dados', role: 'Valida regras de dados e integridade' } as any,
    { id: 'sec-1', name: 'Especialista em Segurança', role: 'Audita vulnerabilidades e validação' } as any,
    { id: 'data-2', name: 'Especialista em Dados', role: 'Valida regras de dados e integridade' } as any,
    { id: 'sec-2', name: 'Especialista em Segurança', role: 'Audita vulnerabilidades e validação' } as any,
  ]
  assert.equal(shortLabelForAgent(testAgents[0], testAgents), 'Arquiteto')
  assert.equal(shortLabelForAgent(testAgents[1], testAgents), 'Dev')
  assert.equal(shortLabelForAgent(testAgents[2], testAgents), 'QA')
  assert.equal(shortLabelForAgent(testAgents[3], testAgents), 'Tutor')
  assert.equal(shortLabelForAgent(testAgents[4], testAgents), 'Dados 1')
  assert.equal(shortLabelForAgent(testAgents[5], testAgents), 'Segurança 1')
  assert.equal(shortLabelForAgent(testAgents[6], testAgents), 'Dados 2')
  assert.equal(shortLabelForAgent(testAgents[7], testAgents), 'Segurança 2')

  // Se houver apenas 1 especialista em dados, exibe sem número
  const singleData = [testAgents[0], testAgents[4]]
  assert.equal(shortLabelForAgent(testAgents[4], singleData), 'Dados')

  // Profundidade matemática consistente: todos os assentos têm profundidade < profundidade da bancada
  for (const placed of initial.visible) {
    // Top desks: desk surface depth is 66 * 3 = 198, seat depth is 56 * 3 = 168
    assert.ok(placed.seat.y < 198, `Agente ${placed.agent.id} deve ter profundidade atrás da bancada`)
  }
})


test('WebSocket de memória: listar com filtros, aprovar, rejeitar e substituir decisões', async () => {
  const client = await connect()
  let pId = projects.active()?.id
  if (!pId) {
    projects.add(projectDir)
    pId = projects.active()!.id
  }
  const consentFor = async (action: 'create' | 'approve' | 'reject' | 'supersede', targetId: number) => {
    const port = (server.address() as AddressInfo).port
    const res = await fetch(`http://127.0.0.1:${port}/api/memory/consent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aidw-desktop-secret': DESKTOP_SECRET,
        origin: ORIGIN,
      },
      body: JSON.stringify({ action, targetId }),
    })
    assert.equal(res.status, 200)
    const data = (await res.json()) as { nonce: string }
    return data.nonce
  }

  // 1. Criar memória aprovada pelo usuário
  client.send({
    type: 'memory-create',
    projectId: pId,
    entry: {
      scope: 'team',
      agentId: null,
      category: 'architecture',
      content: 'Arquitetura: microsserviços Node e SQLite local',
    },
    consentNonce: await consentFor('create', pId),
  })
  const changed1 = await client.waitFor('memory-changed')
  assert.equal(changed1.projectId, pId)

  // 2. Listar memórias do projeto
  client.send({ type: 'memory-list', projectId: pId })
  const list1 = await client.waitFor('memory-entries')
  const created = list1.entries.find((m) => m.content.includes('microsserviços Node'))
  assert.ok(created)
  assert.equal(created.status, 'approved')

  // 3. Criar proposta de agente via store direto para testar aprovação via WebSocket
  const proposal = memory.propose({
    projectId: pId,
    scope: 'team',
    category: 'decision',
    content: 'Usar Redis como cache volátil',
    author: 'architect',
  })
  // Aguarda evento de criação antes de aprovar
  await client.waitFor('memory-changed')

  client.send({ type: 'memory-approve', id: proposal.id, consentNonce: await consentFor('approve', proposal.id) })
  await client.waitFor('memory-changed')
  assert.equal(memory.get(proposal.id)?.status, 'approved')

  // 4. Rejeição via WebSocket
  const proposal2 = memory.propose({
    projectId: pId,
    scope: 'team',
    category: 'problem',
    content: 'Timeout excessivo no Docker',
    author: 'dev',
  })
  await client.waitFor('memory-changed')

  client.send({ type: 'memory-reject', id: proposal2.id, consentNonce: await consentFor('reject', proposal2.id) })
  await client.waitFor('memory-changed')
  assert.equal(memory.get(proposal2.id)?.status, 'rejected')

  // 5. Substituição (supersede) e consulta de versões
  client.send({
    type: 'memory-supersede',
    id: created.id,
    content: 'Arquitetura: monolito modular Node e SQLite local',
    consentNonce: await consentFor('supersede', created.id),
  })
  await client.waitFor('memory-changed')
  assert.equal(memory.get(created.id)?.status, 'superseded')

  client.send({ type: 'memory-versions', id: created.id })
  const versionsMsg = await client.waitFor('memory-versions')
  assert.equal(versionsMsg.versions.length, 2)
  assert.equal(versionsMsg.versions[0].id, created.id)
  assert.equal(versionsMsg.versions[1].content, 'Arquitetura: monolito modular Node e SQLite local')

  client.socket.close()
})

test('WebSocket de skills: snapshot, ativação global, ajuste por agente, criação e mensagens inválidas', async () => {
  const client = await connect()
  const snapshot = await client.waitFor('snapshot')
  assert.deepEqual(snapshot.skills!.map((s) => [s.id, s.enabled]), [['ponytail', true], ['caveman-lite', true]])
  assert.deepEqual(snapshot.skillOverrides, [{ agentId: 'tutor', skillId: 'caveman-lite', state: 'off' }])

  client.send({ type: 'skill-set-enabled', id: 'caveman-lite', enabled: false })
  assert.equal((await client.waitFor('skills')).skills.find((s) => s.id === 'caveman-lite')!.enabled, false)

  client.send({ type: 'skill-set-agent', agentId: 'qa', skillId: 'caveman-lite', state: 'on' })
  assert.ok((await client.waitFor('skills')).overrides.some((o) => o.agentId === 'qa' && o.state === 'on'))
  client.send({ type: 'skill-set-agent', agentId: 'qa', skillId: 'caveman-lite', state: 'inherit' })
  assert.equal((await client.waitFor('skills')).overrides.some((o) => o.agentId === 'qa'), false)

  client.send({ type: 'skill-save', skill: { id: 'estilo-local', name: 'Estilo local', content: 'Prefira funções puras. token=abcd1234efgh' } })
  const created = (await client.waitFor('skills')).skills.find((s) => s.id === 'estilo-local')!
  assert.equal(created.content, 'Prefira funções puras. token=[SEGREDO REMOVIDO]')
  assert.equal(created.enabled, false)
  client.send({
    type: 'skill-save',
    createOnly: true,
    skill: { id: ' ESTILO-LOCAL ', name: 'Colisão', content: 'Não deve substituir a skill existente.' },
  })
  assert.match((await client.waitFor('notice')).message, /Já existe uma skill/)
  assert.deepEqual(skills.get(created.id), created)

  // Erros voltam só para quem pediu e não mudam nada.
  client.send({ type: 'skill-set-agent', agentId: 'fantasma', skillId: 'ponytail', state: 'off' })
  assert.match((await client.waitFor('notice')).message, /Agente não encontrado/)
  client.send({ type: 'skill-set-enabled', id: 'nao-existe', enabled: true })
  assert.match((await client.waitFor('notice')).message, /Skill não encontrada/)

  assert.equal(parseClientMessage(JSON.stringify({ type: 'skill-set-agent', agentId: 'qa', skillId: 'ponytail', state: 'force' })), null)
  assert.equal(parseClientMessage(JSON.stringify({ type: 'skill-save', skill: { id: 'x1', name: 'X', content: 'a', mode: 'shell' } })), null)
  assert.equal(parseClientMessage(JSON.stringify({ type: 'skill-save', skill: { id: 'x1', name: 'X', content: 'a'.repeat(20_001) } })), null)
  assert.equal(parseClientMessage(JSON.stringify({ type: 'skill-set-enabled', id: 'ponytail', enabled: 'yes' })), null)

  skills.setEnabled('caveman-lite', true)
  client.socket.close()
})

test('eventos: events-list responde só com a trilha do projeto pedido e eventos novos chegam ao vivo, sem credenciais', async () => {
  const client = await connect()
  await client.waitFor('snapshot')
  const base = { type: 'cli.finished', evidence: 'observed', summary: 'CLI terminou' } as const
  events.record({ ...base, projectId: 901, missionId: 11, data: { exitCode: 0 } })
  events.record({ ...base, projectId: 901, missionId: 12 })
  events.record({ ...base, projectId: 902, missionId: 13, summary: 'de outro projeto' })
  for (let i = 0; i < 3; i++) await client.waitFor('mission-event')

  client.send({ type: 'events-list', projectId: 901 })
  const all = await client.waitFor('mission-events')
  assert.equal(all.projectId, 901)
  assert.deepEqual(all.events.map((e) => e.missionId), [11, 12])
  assert.equal(all.events[0].data.exitCode, 0)

  client.send({ type: 'events-list', projectId: 901, missionId: 12, afterId: all.events[0].id })
  assert.deepEqual((await client.waitFor('mission-events')).events.map((e) => e.missionId), [12])
  // Missão de outro projeto não vaza pelo id.
  client.send({ type: 'events-list', projectId: 901, missionId: 13 })
  assert.deepEqual((await client.waitFor('mission-events')).events, [])

  events.record({ ...base, projectId: 901, missionId: 11, summary: 'falhou: token=abcd1234efgh', data: { apiKey: 'sk-live-1234567890abcdefgh' } })
  const live = JSON.stringify(await client.waitFor('mission-event'))
  assert.ok(!live.includes('abcd1234efgh') && !live.includes('sk-live'))

  assert.equal(parseClientMessage(JSON.stringify({ type: 'events-list' })), null)
  assert.equal(parseClientMessage(JSON.stringify({ type: 'events-list', projectId: '1' })), null)
  assert.equal(parseClientMessage(JSON.stringify({ type: 'events-list', projectId: 1, missionId: -2 })), null)
  assert.equal(parseClientMessage(JSON.stringify({ type: 'events-list', projectId: 1, afterId: 'x' })), null)
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'events-list', projectId: 1, missionId: 2, extra: 'x' })), { type: 'events-list', projectId: 1, missionId: 2 })
  client.socket.close()
})

test('WebSocket recusa conexão sem token ou com token inválido (401) e aceita Sec-WebSocket-Protocol', async () => {
  await new Promise<void>((resolve, reject) => {
    const wsNoToken = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ORIGIN })
    wsNoToken.once('error', reject)
    wsNoToken.once('unexpected-response', (_req, res) => {
      res.resume()
      if (res.statusCode === 401) resolve()
      else reject(new Error(`Esperava HTTP 401 sem token, recebi ${res.statusCode}`))
    })
    wsNoToken.once('open', () => {
      wsNoToken.close()
      reject(new Error('Deveria recusar conexão sem token'))
    })
  })

  await new Promise<void>((resolve, reject) => {
    const wsBadToken = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: ORIGIN,
      headers: { Authorization: 'Bearer token-invalido' },
    })
    wsBadToken.once('error', reject)
    wsBadToken.once('unexpected-response', (_req, res) => {
      res.resume()
      if (res.statusCode === 401) resolve()
      else reject(new Error(`Esperava HTTP 401 com token inválido, recebi ${res.statusCode}`))
    })
    wsBadToken.once('open', () => {
      wsBadToken.close()
      reject(new Error('Deveria recusar token inválido'))
    })
  })

  await new Promise<void>((resolve, reject) => {
    const wsProto = new WebSocket(`ws://127.0.0.1:${port}/ws`, ['aidw-auth', server.authToken], {
      origin: ORIGIN,
    })
    wsProto.once('open', () => {
      wsProto.close()
      resolve()
    })
    wsProto.once('error', reject)
  })
})

test('pareamento local emite cookie HttpOnly, bloqueia reuso/força bruta/expiração e logout invalida sessão', async () => {
  // 1. Sem Origin -> 403 (CSRF)
  const noOriginRes = await fetch(`http://127.0.0.1:${port}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: server.pairingCode }),
  })
  assert.equal(noOriginRes.status, 403)

  // 2. Código válido -> 200 + Set-Cookie HttpOnly; SameSite=Strict; Path=/
  const pairRes = await fetch(`http://127.0.0.1:${port}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ code: server.pairingCode }),
  })
  assert.equal(pairRes.status, 200)
  const setCookie = pairRes.headers.get('set-cookie') ?? ''
  assert.match(setCookie, /aidw_session=[a-f0-9]+/)
  assert.match(setCookie, /HttpOnly/i)
  assert.match(setCookie, /SameSite=Strict/i)
  assert.match(setCookie, /Path=\//i)
  const cookiePair = setCookie.split(';')[0]

  // 3. Reuso do mesmo código -> 409
  const reuseRes = await fetch(`http://127.0.0.1:${port}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ code: server.pairingCode }),
  })
  assert.equal(reuseRes.status, 409)

  // 4. WebSocket com cookie de sessão -> aceito
  await new Promise<void>((resolve, reject) => {
    const wsCookie = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: ORIGIN,
      headers: { Cookie: cookiePair },
    })
    wsCookie.once('open', () => {
      wsCookie.close()
      resolve()
    })
    wsCookie.once('error', reject)
  })

  // 5. Logout invalida sessão -> WebSocket com cookie antigo recebe 401
  const logoutRes = await fetch(`http://127.0.0.1:${port}/api/logout`, {
    method: 'POST',
    headers: { origin: ORIGIN, cookie: cookiePair },
  })
  assert.equal(logoutRes.status, 200)

  await new Promise<void>((resolve, reject) => {
    const wsAfterLogout = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: ORIGIN,
      headers: { Cookie: cookiePair },
    })
    wsAfterLogout.on('error', () => {})
    wsAfterLogout.once('unexpected-response', (_req, res) => {
      assert.equal(res.statusCode, 401)
      resolve()
    })
    wsAfterLogout.once('open', () => {
      wsAfterLogout.close()
      reject(new Error('Deveria recusar cookie após logout'))
    })
  })
})
