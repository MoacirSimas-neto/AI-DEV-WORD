import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import type { ClientMessage, DynamicLimits, DynamicProposal, PlannedStep, ServerMessage } from '../../../shared/protocol.ts'
import { AgentConfigStore } from '../agents/configStore.ts'
import { AgentRegistry, DEFAULT_AGENTS } from '../agents/registry.ts'
import { GitService } from '../git/service.ts'
import { HistoryStore } from '../history/store.ts'
import { MemoryStore } from '../memory/store.ts'
import { EventStore } from '../observability/store.ts'
import { ProjectStore } from '../projects/store.ts'
import { createAppServer, parseClientMessage } from '../server.ts'
import { SkillStore } from '../skills/store.ts'
import { TaskStore } from '../tasks/store.ts'
import { TerminalManager } from '../terminal/manager.ts'
import { DEFAULT_LIMITS, stepBlocker, validateProposal } from './coordinator.ts'
import { PlanStore } from './planStore.ts'
import { PROPOSAL_CLOSE, PROPOSAL_OPEN } from './proposal.ts'
import { TeamRunner } from './runner.ts'

// Tudo aqui usa CLIs falsos, bancos e repositórios descartáveis. As "decisões do usuário" são simuladas
// pelo próprio teste pelo protocolo autorizado (decideProposal / proposal-decide): não são aprovações reais.

const ORIGIN = 'http://localhost:5173'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 400; i++) {
    if (check()) return
    await sleep(10)
  }
  assert.fail(`tempo esgotado esperando: ${label}`)
}

function gitRepo() {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-dyn-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  writeFileSync(path.join(dir, 'init.txt'), 'init')
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'initial'], { cwd: dir })
  return dir
}

// ---------- respostas do "Tech Lead" ----------

const change = (action: 'convene' | 'release', agentId: string, task = `Apoiar a missão como ${agentId}.`) => ({
  action,
  agentId,
  reason: `Precisamos de ${agentId}.`,
  task,
  context: 'Plano aprovado.',
  expectedImpact: 'Mais qualidade.',
  alternative: 'Seguir sem a mudança.',
})
const stepJson = (key: string, agentId: string, mode: string, dependsOn: string[] = [], inputs: unknown[] = [{ kind: 'plan' }]) => ({
  key,
  agentId,
  mode,
  objective: `Entregar ${key}.`,
  dependsOn,
  inputs,
})
const PLAN = {
  schemaVersion: 1,
  kind: 'plan',
  baseRevision: 0,
  objective: 'API financeira com testes.',
  reason: 'Precisa de implementação e verificação.',
  missionState: 'Nada feito.',
  alternative: 'A missão fica parada.',
  teamChanges: [change('convene', 'dev'), change('convene', 'qa')],
  steps: [stepJson('impl', 'dev', 'implement'), stepJson('teste', 'qa', 'verify', ['impl'], [{ kind: 'plan' }, { kind: 'step', key: 'impl' }, { kind: 'git-diff' }])],
  sharedContext: [{ kind: 'plan' }],
  risks: ['Arredondamento indefinido.'],
  completionCriteria: ['QA aprova.'],
}
const proposalText = (extra: Record<string, unknown> = {}) => `Analisei a tarefa.\n${PROPOSAL_OPEN}\n${JSON.stringify({ ...PLAN, ...extra })}\n${PROPOSAL_CLOSE}`

// ---------- mundo de teste ----------

interface Call {
  cli: string
  args: string[]
  prompt: string
  key: string
}
type Reply = { stdout: string; code?: number; stderr?: string }

async function world(options: { file?: string; dir?: string; limits?: Partial<DynamicLimits> } = {}) {
  const dir = options.dir ?? gitRepo()
  const projects = new ProjectStore(options.file ?? ':memory:')
  if (projects.workspace().projects.length === 0) projects.add(dir)
  const project = projects.workspace().projects[0]
  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const configs = new AgentConfigStore(projects.db)
  const skills = new SkillStore(projects.db)
  const events = new EventStore(projects.db)
  const plans = new PlanStore(projects.db, tasks)
  const memory = new MemoryStore(projects.db, history)
  for (const [id, roleCategory, specializationId] of [
    ['dados', 'developing', 'developer'],
    ['seguranca', 'reviewing', 'qa-tester'],
  ] as const) {
    if (!configs.find(id)) configs.createAgent({ id, name: id === 'dados' ? 'Dados' : 'Segurança', role: `Especialista em ${id}`, roleCategory, specializationId, provider: 'gemini' })
  }
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: 'fake', auth: 'ok' }))
  registry.syncFromConfigs(configs.list())
  for (const agent of registry.list()) await registry.check(agent.id)

  const lead: string[] = []
  const steps: Record<string, (prompt: string) => Reply | Promise<Reply>> = {}
  const calls: Call[] = []
  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    git: new GitService(),
    configs,
    skills,
    events,
    memory,
    plans,
    launch: (cli, args, opts) => {
      const prompt = opts.input ?? args.at(-1) ?? ''
      const key = prompt.includes('Você é o Tech Lead de uma equipe dinâmica') ? 'lead' : (/Objetivo deste passo \(([\w-]+)\)/.exec(prompt)?.[1] ?? 'other')
      calls.push({ cli, args, prompt, key })
      let kill = () => {}
      const done = new Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
        kill = () => resolve({ code: 1, stdout: '', stderr: 'encerrado', timedOut: false })
        const reply = key === 'lead' ? { stdout: lead.shift() ?? 'Sem proposta.' } : (steps[key]?.(prompt) ?? { stdout: `Feito: ${key}.` })
        void Promise.resolve(reply).then((r) => resolve({ code: r.code ?? 0, stdout: r.stdout, stderr: r.stderr ?? '', timedOut: false }))
      })
      return { done, kill: () => kill() }
    },
  })
  const task = tasks.create(project.id, { title: 'API financeira', description: 'Criar a API com testes.', priority: 'high', status: 'todo', agentId: null })
  steps.impl = () => {
    writeFileSync(path.join(dir, 'api.ts'), 'export const saldo = 0\n')
    return { stdout: 'Implementei a API em api.ts. Rodei npm test e 3 testes passaram.' }
  }
  steps.teste = () => ({ stdout: 'Parecer: a API atende.\nVEREDITO: APROVADO' })

  const q = (missionId: number) => ({ projectId: project.id, missionId })
  const phase = (missionId: number) => tasks.getMission(missionId)!.phase
  const pending = (missionId: number) => plans.listProposals(q(missionId)).at(-1)!
  const types = (missionId: number) => events.list({ projectId: project.id, missionId }).map((e) => e.type)
  const decide = (missionId: number, decision: 'approve' | 'reject' | 'adjust', extra: { proposal?: DynamicProposal; feedback?: string; opId?: string } = {}) => {
    const proposal = extra.proposal ?? pending(missionId)
    return runner.decideProposal({ missionId, proposalId: proposal.id, revision: proposal.revision, decision, feedback: extra.feedback, opId: extra.opId ?? `op-${decision}-${proposal.id}` })
  }
  /** Inicia uma missão dinâmica e espera a primeira proposta ficar pendente. */
  const startPending = async (limits = options.limits) => {
    lead.push(proposalText())
    const mission = await runner.start(task.id, { plannerId: 'architect' }, { mode: 'dynamic', limits })
    await until(() => phase(mission.id) !== 'planning', 'proposta inicial')
    return mission
  }
  return { dir, projects, project, history, tasks, configs, skills, events, plans, memory, registry, runner, lead, steps, calls, task, q, phase, pending, types, decide, startPending }
}

// ---------- demonstração ponta a ponta pelo protocolo ----------

test('demonstração: Tech Lead propõe → backend valida → pendente → aprovação pelo protocolo → equipe aplicada → Dev executa → QA verifica → eventos persistidos', async () => {
  const w = await world()
  const terminals = new TerminalManager(w.registry, () => ({ onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {} }), () => w.dir)
  const server = createAppServer({ registry: w.registry, terminals, projects: w.projects, git: new GitService(), tasks: w.tasks, history: w.history, team: w.runner, agentConfigs: w.configs, memory: w.memory, skills: w.skills, events: w.events, plans: w.plans, allowedOrigins: [ORIGIN] })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port
  const sockets: WebSocket[] = []
  const connect = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ORIGIN })
    sockets.push(socket)
    const received: ServerMessage[] = []
    socket.on('message', (raw) => received.push(JSON.parse(String(raw)) as ServerMessage))
    await once(socket, 'open')
    const send = (message: ClientMessage) => socket.send(JSON.stringify(message))
    const take = async <T extends ServerMessage['type']>(type: T, match: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true) => {
      let found: Extract<ServerMessage, { type: T }> | undefined
      await until(() => {
        const i = received.findIndex((m) => m.type === type && match(m as Extract<ServerMessage, { type: T }>))
        if (i >= 0) found = received.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>
        return found !== undefined
      }, `mensagem ${type}`)
      return found!
    }
    return { socket, send, take }
  }

  try {
    const user = await connect()
    // 1. O usuário pede a missão dinâmica.
    w.lead.push(proposalText())
    user.send({ type: 'mission-start', taskId: w.task.id, mode: 'dynamic' })
    await until(() => w.tasks.listMissions().length === 1 && w.tasks.listMissions()[0].phase === 'awaiting_approval', 'proposta pendente')
    const mission = w.tasks.listMissions()[0]
    assert.equal(mission.mode, 'dynamic')

    // 2. Proposta validada e pendente; nenhum passo existe e só o Tech Lead foi chamado.
    assert.deepEqual(w.calls.map((c) => c.key), ['lead'])
    assert.deepEqual(w.plans.listSteps(w.q(mission.id)), [])
    const announced = await user.take('mission-plan', (m) => m.missionId === mission.id && m.proposals.length === 1)
    assert.equal(announced.proposals[0].status, 'pending')
    assert.deepEqual(announced.proposals[0].previouslyRejected, [])

    // 3. Reconexão: um cliente novo recupera a proposta pendente pelo plan-list.
    const again = await connect()
    again.send({ type: 'plan-list', projectId: w.project.id, missionId: mission.id })
    const recovered = await again.take('mission-plan', (m) => m.missionId === mission.id)
    const proposal = recovered.proposals[0]
    assert.equal(proposal.status, 'pending')
    assert.equal(proposal.revision, 1)
    // Isolamento: o mesmo pedido com outro projeto não traz nada.
    again.send({ type: 'plan-list', projectId: w.project.id + 99, missionId: mission.id })
    const foreign = await again.take('mission-plan', (m) => m.projectId === w.project.id + 99)
    assert.deepEqual([foreign.proposals, foreign.steps], [[], []])

    // 4. Usuário SIMULADO aprova pelo protocolo autorizado (parte do teste, não uma aprovação real).
    const decision: ClientMessage = { type: 'proposal-decide', missionId: mission.id, proposalId: proposal.id, revision: 1, decision: 'approve', opId: 'demo-op-1' }
    again.send(decision)
    const result = await again.take('proposal-result', (m) => m.opId === 'demo-op-1')
    assert.deepEqual([result.ok, result.applied, result.status], [true, true, 'approved'])
    // O reenvio da mesma mensagem (reconexão, duplo clique) não executa nada de novo.
    user.send(decision)
    const repeated = await user.take('proposal-result', (m) => m.opId === 'demo-op-1')
    assert.deepEqual([repeated.ok, repeated.applied], [true, false])

    // 5. Dev executa e QA verifica, em sequência; depois a missão espera a confirmação do usuário.
    await until(() => w.phase(mission.id) === 'awaiting_decision', 'fila concluída')
    assert.deepEqual(w.calls.map((c) => c.key), ['lead', 'impl', 'teste'])
    const [, dev, qa] = w.calls
    assert.equal(dev.cli, 'codex')
    assert.ok(dev.args.includes('workspace-write'), 'só implement recebe sandbox de escrita')
    // Seja qual for o CLI do QA, verificar não recebe nenhuma opção de escrita.
    for (const flag of ['workspace-write', 'auto_edit', 'accept-edits']) assert.ok(!qa.args.includes(flag), `QA recebeu ${flag}`)
    // O resultado do Dev chegou ao QA como dado não confiável, com o diff.
    assert.match(qa.prompt, /\(Os textos abaixo foram produzidos por outros agentes[^\n]*\n#### Resultado de dev no passo r1\/impl \(implement\):\nImplementei a API/)
    assert.match(qa.prompt, /api\.ts/)
    const steps = w.plans.listSteps(w.q(mission.id))
    assert.deepEqual(steps.map((s) => [s.key, s.status]), [['impl', 'completed'], ['teste', 'completed']])
    assert.match(steps[0].result, /Implementei a API/)
    assert.ok(steps[0].correlationId && steps[1].correlationId)
    const after = w.tasks.getMission(mission.id)!
    assert.deepEqual(after.files, ['api.ts'])
    assert.equal(after.verdictDetail, 'APROVADO')
    assert.deepEqual(Object.keys(after.teamSnapshot!).sort(), ['architect', 'dev', 'qa'])

    // 6. Eventos persistidos, na ordem dos fatos e com a evidência certa.
    const trail = w.events.list({ projectId: w.project.id, missionId: mission.id })
    const at = (type: string, match: (e: (typeof trail)[number]) => boolean = () => true) => {
      const i = trail.findIndex((e) => e.type === type && match(e))
      assert.ok(i >= 0, `faltou o evento ${type}`)
      return i
    }
    const order = [
      at('mission.started'),
      at('proposal.declared'),
      at('approval.requested'),
      at('approval.received'),
      at('team.joined', (e) => e.agentId === 'dev'),
      at('plan.revised'),
      at('task.delegated', (e) => e.data.stage === 'step' && e.agentId === 'dev'),
      at('step.started', (e) => e.agentId === 'dev'),
      at('cli.started', (e) => e.agentId === 'dev'),
      at('cli.finished', (e) => e.agentId === 'dev'),
      at('step.finished', (e) => e.agentId === 'dev'),
      at('result.forwarded', (e) => e.data.from === 'dev' && e.data.to === 'qa'),
      at('verdict.declared'),
      at('mission.blocked', (e) => e.data.reason === 'queue_empty'),
    ]
    assert.deepEqual(order, [...order].sort((a, b) => a - b))
    const one = (type: string) => trail.find((e) => e.type === type)!
    assert.equal(one('proposal.declared').evidence, 'declared')
    assert.equal(one('proposal.declared').data.actor, 'model')
    assert.equal(one('approval.received').evidence, 'observed')
    assert.equal(one('approval.received').data.actor, 'user')
    assert.equal(one('approval.received').data.opId, 'demo-op-1')
    assert.equal(trail.filter((e) => e.type === 'approval.received').length, 1, 'o reenvio não gerou outra decisão')
    assert.equal(one('team.joined').data.actor, 'backend')
    assert.equal(one('tests.declared').evidence, 'declared')
    assert.equal(one('tests.executed').evidence, 'unavailable')
    assert.equal(one('verdict.declared').evidence, 'declared')
    // Nenhum prompt completo vai para a trilha.
    assert.doesNotMatch(JSON.stringify(trail), /Você é o Tech Lead de uma equipe dinâmica|Objetivo deste passo/)

    // 7. O usuário confirma o encerramento.
    user.send({ type: 'mission-close', missionId: mission.id })
    await until(() => w.phase(mission.id) === 'done', 'encerramento')
    assert.equal(w.events.list({ projectId: w.project.id, missionId: mission.id }).find((e) => e.type === 'mission.completed')!.data.basedOn, 'human-confirmation')

    // Decisão dinâmica sobre missão clássica é recusada pelo backend.
    const classic = w.tasks.createMission(w.tasks.create(w.project.id, { title: 'Clássica', description: '', priority: 'low', status: 'todo', agentId: null }).id, w.project.id)
    user.send({ type: 'proposal-decide', missionId: classic.id, proposalId: proposal.id, revision: 1, decision: 'approve', opId: 'op-classic' })
    const refused = await user.take('proposal-result', (m) => m.opId === 'op-classic')
    assert.equal(refused.ok, false)
    assert.match(refused.message, /fluxo clássico/)
  } finally {
    for (const socket of sockets) socket.terminate()
    server.close()
  }
})

test('protocolo: decisões malformadas são descartadas antes de chegar ao backend', () => {
  const base = { type: 'proposal-decide', missionId: 1, proposalId: 1, revision: 1, decision: 'approve', opId: 'op-1' }
  assert.deepEqual(parseClientMessage(JSON.stringify(base)), base)
  for (const bad of [{ opId: undefined }, { opId: 'tem espaço' }, { decision: 'auto' }, { decision: 'adjust_requested' }, { revision: 0 }, { revision: 1.5 }, { proposalId: -1 }, { feedback: 'x'.repeat(5001) }]) {
    assert.equal(parseClientMessage(JSON.stringify({ ...base, ...bad })), null, JSON.stringify(bad))
  }
  assert.equal(parseClientMessage(JSON.stringify({ type: 'mission-start', taskId: 1, mode: 'turbo' })), null)
  assert.equal(parseClientMessage(JSON.stringify({ type: 'mission-start', taskId: 1, limits: [1] })), null)
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'mission-start', taskId: 1 })), { type: 'mission-start', taskId: 1 })
  assert.equal(parseClientMessage(JSON.stringify({ type: 'plan-list', projectId: 1 })), null)
})

// ---------- aprovação ----------

test('nada executa antes da aprovação; rejeitar não convoca, não executa e não cancela a missão', async () => {
  const w = await world()
  const mission = await w.startPending()
  assert.equal(w.phase(mission.id), 'awaiting_approval')
  await sleep(30)
  assert.deepEqual(w.calls.map((c) => c.key), ['lead'])
  assert.deepEqual(w.plans.listSteps(w.q(mission.id)), [])

  const { proposal, applied } = w.decide(mission.id, 'reject', { feedback: 'Ainda não.' })
  assert.equal(applied, true)
  assert.equal(proposal.status, 'rejected')
  assert.equal(proposal.feedback, 'Ainda não.')
  assert.equal(w.phase(mission.id), 'awaiting_decision')
  await sleep(30)
  assert.deepEqual(w.calls.map((c) => c.key), ['lead'])
  assert.deepEqual(w.plans.listSteps(w.q(mission.id)), [])
  assert.deepEqual(Object.keys(w.tasks.getMission(mission.id)!.teamSnapshot!), ['architect'])
  assert.ok(!w.types(mission.id).includes('team.joined') || w.events.list({ projectId: w.project.id, missionId: mission.id }).filter((e) => e.type === 'team.joined').every((e) => e.agentId === 'architect'))
  assert.equal(w.events.list({ projectId: w.project.id, missionId: mission.id }).at(-1)!.data.reason, 'proposal_rejected')
  // Mudar de ideia depois não vale.
  assert.throws(() => w.decide(mission.id, 'approve', { proposal }), /não está mais aguardando decisão/)
})

test('pedir ajustes registra o pedido, não executa e leva o texto ao novo turno do Tech Lead', async () => {
  const w = await world()
  const mission = await w.startPending()
  const first = w.pending(mission.id)
  w.lead.push(proposalText({ baseRevision: 1, teamChanges: [change('convene', 'dev')], steps: [stepJson('impl', 'dev', 'implement')] }))
  const { proposal } = w.decide(mission.id, 'adjust', { feedback: 'Sem QA nesta missão.' })
  assert.equal(proposal.status, 'adjust_requested')
  await until(() => w.phase(mission.id) === 'awaiting_approval', 'nova proposta')
  assert.match(w.calls[1].prompt, /pediu ajustes[\s\S]*Texto do usuário: Sem QA nesta missão\./)
  const second = w.pending(mission.id)
  assert.deepEqual([second.revision, second.status, second.adjustRound], [2, 'pending', 1])
  assert.deepEqual(w.calls.map((c) => c.key), ['lead', 'lead'])
  // A proposta devolvida para ajuste não pode ser aprovada depois (aprovação atrasada).
  assert.throws(() => w.decide(mission.id, 'approve', { proposal: first }), /não está mais aguardando decisão/)
  assert.deepEqual(w.plans.listSteps(w.q(mission.id)), [])
})

test('decisões duplicadas e simultâneas: só a primeira vale', async () => {
  const w = await world()
  const mission = await w.startPending()
  const proposal = w.pending(mission.id)
  // Duas decisões no mesmo instante: o SQLite serializa; a segunda vê a primeira já aplicada.
  const results = [w.decide(mission.id, 'approve', { proposal }), w.decide(mission.id, 'approve', { proposal })]
  assert.deepEqual(results.map((r) => r.applied), [true, false])
  assert.throws(() => w.decide(mission.id, 'reject', { proposal }), /execução em andamento|não está mais aguardando/)
  await until(() => w.phase(mission.id) === 'awaiting_decision', 'execução')
  assert.equal(w.calls.filter((c) => c.key === 'impl').length, 1, 'o Dev rodou uma vez só')
  assert.equal(w.plans.listSteps(w.q(mission.id)).length, 2)
  assert.throws(() => w.decide(mission.id, 'reject', { proposal }), /não está mais aguardando decisão/)
})

test('cancelar antes da aprovação: a aprovação que chega depois não executa nada', async () => {
  const w = await world()
  const mission = await w.startPending()
  const proposal = w.pending(mission.id)
  w.runner.cancel(mission.id)
  assert.equal(w.plans.getProposal(proposal.id)!.status, 'superseded')
  assert.throws(() => w.decide(mission.id, 'approve', { proposal }), /não está mais aguardando decisão/)
  await sleep(30)
  assert.equal(w.phase(mission.id), 'cancelled')
  assert.deepEqual(w.calls.map((c) => c.key), ['lead'])
  assert.deepEqual(w.plans.listSteps(w.q(mission.id)), [])
})

test('aprovar exige que a proposta ainda valha agora: agente desativado depois da proposta bloqueia a aprovação', async () => {
  const w = await world()
  w.lead.push(proposalText({ teamChanges: [change('convene', 'dados'), change('convene', 'dev')], steps: [stepJson('modelo', 'dados', 'analyze'), stepJson('impl', 'dev', 'implement', ['modelo'])] }))
  const mission = await w.runner.start(w.task.id, {}, { mode: 'dynamic' })
  await until(() => w.phase(mission.id) === 'awaiting_approval', 'proposta')
  w.configs.setAgentActive('dados', false)
  assert.throws(() => w.decide(mission.id, 'approve'), /não pode mais ser aprovada.*"dados" não existe ou está inativo/)
  assert.equal(w.pending(mission.id).status, 'pending')
  assert.deepEqual(w.plans.listSteps(w.q(mission.id)), [])
  // O cadastro continua lá, só inativo.
  assert.equal(w.configs.find('dados')!.active, false)
})

// ---------- equipe ----------

test('equipe: novo especialista entra com snapshot do momento; quem já estava não muda; dispensa preserva cadastro', async () => {
  const w = await world()
  w.skills.save({ id: 'estilo', name: 'Estilo', content: 'Versão 1 da skill.', enabled: true })
  const mission = await w.startPending()
  w.decide(mission.id, 'approve')
  await until(() => w.phase(mission.id) === 'awaiting_decision', 'plano inicial executado')
  const before = w.tasks.getMission(mission.id)!.teamSnapshot!
  const devSkill = before.dev.skills!.find((s) => s.id === 'estilo')!

  // A skill muda depois que o Dev entrou.
  w.skills.save({ id: 'estilo', name: 'Estilo', content: 'Versão 2 da skill, diferente.', enabled: true })
  // shortcut: o turno de replanejamento por gatilho é da 10.4; aqui a proposta validada é gravada direto.
  w.tasks.updateMission(mission.id, { phase: 'planning' })
  w.plans.propose(mission.id, 'architect', {
    ...validInput(),
    kind: 'replan',
    teamChanges: [change('convene', 'dados'), change('release', 'qa')],
    steps: [{ key: 'sql', agentId: 'dados', mode: 'analyze', objective: 'Revisar as consultas.', dependsOn: [], inputs: [{ kind: 'step', key: 'impl', revision: 1 }] }],
  })
  w.decide(mission.id, 'approve')
  await until(() => w.phase(mission.id) === 'awaiting_decision' && w.calls.some((c) => c.key === 'sql'), 'passo do especialista')

  const snap = w.tasks.getMission(mission.id)!.teamSnapshot!
  assert.equal(snap.dados.name, 'Dados')
  assert.notEqual(snap.dados.skills!.find((s) => s.id === 'estilo')!.hash, devSkill.hash, 'quem entrou agora recebe a versão atual')
  assert.deepEqual(snap.dev, before.dev, 'snapshot anterior não muda')
  assert.ok(snap.qa, 'quem sai mantém o histórico na missão')
  assert.ok(w.configs.find('qa'), 'a dispensa não exclui o cadastro')
  const trail = w.events.list({ projectId: w.project.id, missionId: mission.id })
  assert.ok(trail.some((e) => e.type === 'team.joined' && e.agentId === 'dados' && e.data.revision === 2))
  assert.ok(trail.some((e) => e.type === 'team.released' && e.agentId === 'qa' && e.evidence === 'observed'))
  // O especialista recebeu o resultado anterior do Dev, e roda sem escrita.
  const sql = w.calls.find((c) => c.key === 'sql')!
  assert.match(sql.prompt, /Resultado de dev no passo r1\/impl/)
  assert.ok(sql.args.includes('default') && !sql.args.includes('auto_edit'))
})

test('decidir durante uma execução é recusado: nenhuma dispensa silenciosa de quem está rodando', async () => {
  const w = await world()
  let release = (_r: Reply) => {}
  w.steps.impl = () => new Promise<Reply>((resolve) => (release = resolve))
  const mission = await w.startPending()
  w.decide(mission.id, 'approve')
  await until(() => w.calls.some((c) => c.key === 'impl'), 'Dev rodando')
  const p = w.plans.getProposal(w.pending(mission.id).id)!
  assert.throws(() => w.runner.decideProposal({ missionId: mission.id, proposalId: p.id, revision: p.revision, decision: 'reject', opId: 'x' }), /execução em andamento|não está mais/)
  release({ stdout: 'feito' })
  await until(() => w.phase(mission.id) === 'awaiting_decision', 'fim')
})

test('reconvocação: a mesma rejeição sem contexto novo continua bloqueada; necessidade nova com contexto novo volta marcada', async () => {
  const w = await world()
  const mission = await w.startPending()
  w.decide(mission.id, 'approve')
  await until(() => w.phase(mission.id) === 'awaiting_decision', 'plano inicial')
  const ctx = () => ({
    techLeadId: 'architect',
    agents: w.configs.list({ includeInactive: true }),
    steps: w.plans.listSteps(w.q(mission.id)),
    proposals: w.plans.listProposals(w.q(mission.id)),
    limits: DEFAULT_LIMITS,
  })
  const convene = (task: string) => ({ ...validInput(), kind: 'replan' as const, teamChanges: [change('convene', 'seguranca', task)], steps: [] })

  w.tasks.updateMission(mission.id, { phase: 'planning' })
  w.plans.propose(mission.id, 'architect', convene('Auditar a autenticação.'))
  w.decide(mission.id, 'reject', { feedback: 'Não agora.' })

  // Mesmo pedido: bloqueado. Pedido diferente, mas nada aconteceu desde a rejeição: bloqueado.
  assert.match(validateProposal(convene('Auditar a autenticação.'), ctx()).join(' '), /mesmo objetivo/)
  assert.match(validateProposal(convene('Revisar a criptografia das senhas.'), ctx()).join(' '), /nenhum passo terminou desde então/)

  // Um passo novo termina depois da rejeição: agora há contexto novo.
  w.tasks.updateMission(mission.id, { phase: 'planning' })
  w.plans.propose(mission.id, 'architect', { ...validInput(), kind: 'replan', teamChanges: [], steps: [{ key: 'ajuste', agentId: 'dev', mode: 'implement', objective: 'Ajustar a API.', dependsOn: [], inputs: [] }] })
  w.decide(mission.id, 'approve')
  await until(() => w.phase(mission.id) === 'awaiting_decision' && w.plans.listSteps(w.q(mission.id)).some((s) => s.key === 'ajuste' && s.status === 'completed'), 'passo novo')
  await sleep(5)
  const renewed = convene('Revisar a criptografia das senhas.')
  assert.deepEqual(validateProposal(renewed, ctx()), [])
  w.tasks.updateMission(mission.id, { phase: 'planning' })
  const back = w.plans.propose(mission.id, 'architect', renewed)
  // A interface recebe a marca de que este agente já foi rejeitado, e em qual revisão.
  assert.deepEqual(w.runner.previouslyRejected(back), [{ agentId: 'seguranca', action: 'convene', revisions: [2] }])
  assert.match(back.teamChanges[0].task, /criptografia/)

  // Rejeitada de novo: o Tech Lead não pode insistir mais nesta missão.
  w.decide(mission.id, 'reject')
  assert.match(validateProposal(convene('Terceiro motivo qualquer.'), ctx()).join(' '), /2 vezes nesta missão/)
})

// ---------- execução ----------

test('stepBlocker: passo não aprovado, dependência pendente, agente inválido, fora da equipe, modo sem permissão e limite', () => {
  const step = (key: string, agentId: string, mode: PlannedStep['mode'], status: PlannedStep['status'] = 'approved', dependsOn: string[] = []): PlannedStep => ({
    id: key.length * 10 + agentId.length,
    missionId: 1,
    projectId: 1,
    proposalId: 1,
    revision: 1,
    seq: 0,
    key,
    agentId,
    mode,
    objective: key,
    dependsOn,
    inputs: [],
    status,
    startedAt: status === 'approved' ? null : '2026-01-01',
    finishedAt: null,
    result: '',
    error: null,
    correlationId: null,
  })
  const plan = { ...validInput(), teamChanges: [change('convene', 'dev'), change('convene', 'qa')] }
  const approved = [{ ...plan, id: 1, missionId: 1, projectId: 1, revision: 1, status: 'approved' as const, author: 'architect', adjustRound: 0, createdAt: '', decidedAt: '', decidedBy: 'user', feedback: null }]
  const agents = [
    { agentId: 'dev', roleCategory: 'developing' as const },
    { agentId: 'qa', roleCategory: 'reviewing' as const },
    { agentId: 'dados', roleCategory: 'developing' as const },
    { agentId: 'off', roleCategory: 'developing' as const, active: false },
  ]
  const ctx = (steps: PlannedStep[], limits = DEFAULT_LIMITS) => ({ techLeadId: 'architect', agents, steps, proposals: approved, limits })

  const ok = step('impl', 'dev', 'implement')
  assert.equal(stepBlocker(ok, ctx([ok])), null)
  assert.equal(stepBlocker({ ...ok, status: 'superseded' }, ctx([{ ...ok, status: 'superseded' }]))?.reason, 'not_eligible')
  const waiting = step('teste', 'qa', 'verify', 'approved', ['impl'])
  assert.equal(stepBlocker(waiting, ctx([ok, waiting]))?.reason, 'not_eligible')
  const off = step('x', 'off', 'analyze')
  assert.equal(stepBlocker(off, ctx([off]))?.reason, 'agent_unavailable')
  const outsider = step('y', 'dados', 'analyze')
  assert.equal(stepBlocker(outsider, ctx([outsider]))?.reason, 'not_in_team')
  // Um passo adulterado no banco para o QA gravar arquivos é barrado na hora de executar.
  const tampered = step('z', 'qa', 'implement')
  assert.equal(stepBlocker(tampered, ctx([tampered]))?.reason, 'mode_not_allowed')
  const done = Array.from({ length: 2 }, (_, i) => step(`d${i}`, 'dev', 'analyze', 'completed'))
  assert.equal(stepBlocker(ok, ctx([...done, ok], { ...DEFAULT_LIMITS, maxSteps: 2 }))?.reason, 'limit_reached')
})

test('falha de CLI: o passo falha, os dependentes não rodam, nada é repetido e a missão espera o usuário', async () => {
  const w = await world()
  w.steps.impl = () => ({ code: 1, stdout: '', stderr: 'rate limit exceeded (429)' })
  const mission = await w.startPending()
  w.decide(mission.id, 'approve')
  await until(() => w.phase(mission.id) === 'awaiting_decision', 'bloqueio')
  await sleep(30)
  assert.deepEqual(w.calls.map((c) => c.key), ['lead', 'impl'])
  const steps = w.plans.listSteps(w.q(mission.id))
  assert.deepEqual(steps.map((s) => s.status), ['failed', 'approved'])
  assert.match(steps[0].error!, /limite de uso/)
  assert.match(w.tasks.getMission(mission.id)!.error!, /limite de uso/)
  const blocked = w.events.list({ projectId: w.project.id, missionId: mission.id }).filter((e) => e.type === 'mission.blocked')
  assert.equal(blocked.length, 1)
  assert.equal(blocked[0].data.reason, 'failure')
  // A missão não falhou nem foi cancelada: o usuário decide.
  assert.notEqual(w.phase(mission.id), 'failed')
})

test('veredito que não aprova pausa a missão para decisão humana', async () => {
  const w = await world()
  w.steps.teste = () => ({ stdout: 'Achei um defeito.\nVEREDITO: REPROVADO' })
  const mission = await w.startPending()
  w.decide(mission.id, 'approve')
  await until(() => w.phase(mission.id) === 'awaiting_decision', 'veredito')
  assert.equal(w.tasks.getMission(mission.id)!.verdictDetail, 'REPROVADO')
  assert.equal(w.events.list({ projectId: w.project.id, missionId: mission.id }).at(-1)!.data.reason, 'verdict_rejected')
})

test('repositório com alterações de fora da missão: a implementação não começa e nada é descartado', async () => {
  const w = await world()
  const mission = await w.startPending()
  writeFileSync(path.join(w.dir, 'meu-rascunho.txt'), 'trabalho do usuário')
  w.decide(mission.id, 'approve')
  await until(() => w.phase(mission.id) === 'awaiting_decision', 'bloqueio')
  assert.deepEqual(w.calls.map((c) => c.key), ['lead'])
  assert.equal(w.events.list({ projectId: w.project.id, missionId: mission.id }).at(-1)!.data.reason, 'dirty_repo')
  assert.match(execFileSync('git', ['status', '--porcelain'], { cwd: w.dir, encoding: 'utf8' }), /meu-rascunho\.txt/)
})

test('proposta inválida: uma correção pelo Tech Lead e depois a missão para — sem laço', async () => {
  const w = await world()
  const bad = proposalText({ steps: [stepJson('impl', 'qa', 'implement')] })
  w.lead.push(bad, bad, bad)
  const mission = await w.runner.start(w.task.id, {}, { mode: 'dynamic' })
  await until(() => w.phase(mission.id) === 'awaiting_decision', 'bloqueio')
  await sleep(30)
  assert.deepEqual(w.calls.map((c) => c.key), ['lead', 'lead'])
  assert.match(w.calls[1].prompt, /recusada pelo backend[\s\S]*"implement" não é permitido para o agente "qa"/)
  assert.deepEqual(w.plans.listProposals(w.q(mission.id)), [])
  const trail = w.events.list({ projectId: w.project.id, missionId: mission.id })
  assert.equal(trail.filter((e) => e.type === 'proposal.invalid').length, 2)
  assert.equal(trail.at(-1)!.data.reason, 'invalid_proposal')
})

test('limite atingido: sem turnos do Tech Lead sobrando, o ajuste pedido para a missão em vez de chamar o CLI', async () => {
  const w = await world({ limits: { maxTechLeadTurns: 1 } })
  const mission = await w.startPending()
  w.decide(mission.id, 'adjust', { feedback: 'Mude.' })
  await until(() => w.phase(mission.id) === 'awaiting_decision', 'limite')
  assert.deepEqual(w.calls.map((c) => c.key), ['lead'])
  assert.match(w.tasks.getMission(mission.id)!.error!, /Limite de propostas do Tech Lead atingido \(1\)/)
})

// ---------- persistência e modo clássico ----------

test('persistência: proposta pendente sobrevive ao reinício e continua aprovável uma única vez; passo rodando vira interrompido', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'aidw-dyn-db-')), 'app.db')
  const first = await world({ file })
  const mission = await first.startPending()
  const proposal = first.pending(mission.id)
  first.projects.db.close()

  const second = await world({ file, dir: first.dir })
  second.runner.recover()
  assert.equal(second.phase(mission.id), 'awaiting_approval')
  assert.deepEqual(second.plans.getProposal(proposal.id), proposal)
  let hold = (_r: Reply) => {}
  second.steps.impl = () => new Promise<Reply>((resolve) => (hold = resolve))
  assert.equal(second.decide(mission.id, 'approve').applied, true)
  await until(() => second.calls.some((c) => c.key === 'impl'), 'Dev rodando')
  // "Reabre o app" com o Dev ainda marcado como rodando no banco (o processo anterior morreu).
  const third = await world({ file, dir: first.dir })
  third.runner.recover()
  assert.equal(third.phase(mission.id), 'awaiting_decision')
  const steps = third.plans.listSteps(third.q(mission.id))
  assert.equal(steps[0].status, 'interrupted')
  assert.equal(steps[1].status, 'approved')
  assert.deepEqual(third.calls, [], 'nada é relançado sozinho')
  assert.equal(third.decide(mission.id, 'approve', { proposal }).applied, false)
  // O processo "morto" termina depois: não ressuscita o passo interrompido.
  hold({ stdout: 'tarde demais' })
  await sleep(50)
  assert.equal(third.plans.listSteps(third.q(mission.id))[0].status, 'interrupted')
})

test('modo clássico intacto: start sem modo é pipeline, mission-approve recusa a dinâmica e a dinâmica não roda o pipeline fixo', async () => {
  const w = await world()
  const dynamic = await w.startPending()
  await assert.rejects(w.runner.approve(dynamic.id), /não está aguardando aprovação/)
  w.runner.cancel(dynamic.id)

  w.lead.length = 0
  const classic = await w.runner.start(w.task.id)
  assert.equal(classic.mode, 'pipeline')
  await until(() => w.phase(classic.id) === 'awaiting_approval', 'plano clássico')
  const pipelinePrompt = w.calls.at(-1)!.prompt
  assert.match(pipelinePrompt, /Você é o Arquiteto \(Tech Lead\)/)
  assert.doesNotMatch(pipelinePrompt, /PROPOSTA|schemaVersion/)
  assert.throws(() => w.runner.decideProposal({ missionId: classic.id, proposalId: 1, revision: 1, decision: 'approve', opId: 'x' }), /fluxo clássico/)
  assert.throws(() => w.runner.closeMission(classic.id), /fluxo clássico/)
  w.runner.cancel(classic.id)
  assert.deepEqual(w.plans.listProposals(w.q(classic.id)), [])
})

function validInput() {
  return {
    kind: 'plan' as const,
    objective: 'API financeira.',
    reason: 'Motivo.',
    missionState: 'Estado.',
    alternative: 'Alternativa.',
    teamChanges: [] as ReturnType<typeof change>[],
    steps: [],
    sharedContext: [{ kind: 'plan' as const }],
    risks: [],
    completionCriteria: ['QA aprova.'],
  }
}
