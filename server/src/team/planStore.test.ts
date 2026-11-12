import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import type { DynamicProposalInput, PlannedStepInput } from '../../../shared/protocol.ts'
import { AgentRegistry, DEFAULT_AGENTS } from '../agents/registry.ts'
import { GitService } from '../git/service.ts'
import { HistoryStore } from '../history/store.ts'
import { EventStore } from '../observability/store.ts'
import { ProjectStore } from '../projects/store.ts'
import { OPEN_PHASES, TaskStore } from '../tasks/store.ts'
import { DEFAULT_LIMITS, nextStep, teamOf } from './coordinator.ts'
import { PlanStore } from './planStore.ts'
import { TeamRunner } from './runner.ts'

const TASK = { title: 'API financeira', description: '', priority: 'high' as const, status: 'todo' as const, agentId: null }

function open(file = ':memory:') {
  const db = new DatabaseSync(file)
  const tasks = new TaskStore(db, new HistoryStore(db))
  return { db, tasks, plans: new PlanStore(db, tasks) }
}

function dynamicMission(tasks: TaskStore, projectId = 1) {
  const task = tasks.create(projectId, TASK)
  return tasks.createMission(task.id, projectId, { mode: 'dynamic' })
}

const step = (key: string, agentId: string, mode: PlannedStepInput['mode'], dependsOn: string[] = []): PlannedStepInput => ({
  key,
  agentId,
  mode,
  objective: `Objetivo de ${key}`,
  dependsOn,
  inputs: [],
})
const convene = (agentId: string) => ({ action: 'convene' as const, agentId, reason: 'Necessário', task: 'Apoiar', expectedImpact: 'Qualidade', context: 'Plano e tarefa', alternative: 'Seguir sem o agente' })
const proposal = (input: Partial<DynamicProposalInput> = {}): DynamicProposalInput => ({
  kind: 'plan',
  objective: 'Entregar a tarefa.',
  reason: 'Competências necessárias.',
  missionState: 'Início.',
  alternative: 'Seguir sem a mudança.',
  teamChanges: [convene('dev'), convene('qa')],
  steps: [step('impl', 'dev', 'implement'), step('teste', 'qa', 'verify', ['impl'])],
  sharedContext: [{ kind: 'plan' }],
  risks: [],
  completionCriteria: ['Testes passando.'],
  ...input,
})

// O banco como era antes da Etapa 6: sem nenhuma das colunas adicionadas depois.
const LEGACY_SCHEMA = `
  CREATE TABLE tasks (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL, status TEXT NOT NULL, agent_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE missions (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL, project_id INTEGER NOT NULL, phase TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT '', dev_report TEXT NOT NULL DEFAULT '', review TEXT NOT NULL DEFAULT '', verdict TEXT,
    files TEXT NOT NULL DEFAULT '[]', error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  INSERT INTO tasks VALUES (1, 1, 'Antiga', '', 'low', 'review', NULL, '2025-01-01', '2025-01-01'), (2, 1, 'Parada', '', 'low', 'doing', NULL, '2025-01-01', '2025-01-01');
  INSERT INTO missions VALUES (1, 1, 1, 'done', 'plano antigo', 'feito', 'ok', 'approved', '["a.ts"]', NULL, '2025-01-01', '2025-01-01');
  INSERT INTO missions VALUES (2, 2, 1, 'awaiting_approval', 'plano esperando', '', '', NULL, '[]', NULL, '2025-01-02', '2025-01-02');
`

test('migração: banco legado ganha modo pipeline e tabelas novas sem perder nada, e repetir não muda nada', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'aidw-plan-legacy-')), 'app.db')
  const legacy = new DatabaseSync(file)
  legacy.exec(LEGACY_SCHEMA)
  legacy.close()

  let snapshot = ''
  for (let boot = 0; boot < 3; boot++) {
    const { db, tasks, plans } = open(file)
    const missions = tasks.listMissions()
    assert.equal(missions.length, 2)
    const [waiting, done] = missions
    assert.equal(done.mode, 'pipeline')
    assert.equal(done.limits, undefined)
    assert.equal(done.plan, 'plano antigo')
    assert.equal(done.verdict, 'approved')
    assert.deepEqual(done.files, ['a.ts'])
    assert.equal(done.plannerId, 'architect')
    assert.equal(waiting.mode, 'pipeline')
    assert.equal(waiting.phase, 'awaiting_approval')
    assert.deepEqual(tasks.openMissions().map((m) => m.id), [2])
    assert.deepEqual(plans.listProposals({ projectId: 1, missionId: 1 }), [])
    assert.deepEqual(plans.listSteps({ projectId: 1, missionId: 1 }), [])
    // Uma missão clássica nunca recebe proposta.
    assert.throws(() => plans.propose(2, 'architect', proposal()), /fluxo clássico/)

    const schema = JSON.stringify(db.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all())
    const rows = JSON.stringify(db.prepare('SELECT * FROM missions ORDER BY id').all())
    if (boot > 0) assert.equal(`${schema}${rows}`, snapshot, 'reabrir não pode alterar esquema nem dados')
    snapshot = `${schema}${rows}`
    db.close()
  }
})

test('missões: o padrão é pipeline; dynamic guarda limites validados', () => {
  const { tasks } = open()
  const classic = tasks.createMission(tasks.create(1, TASK).id, 1)
  assert.equal(classic.mode, 'pipeline')
  assert.equal(classic.limits, undefined)
  assert.equal(tasks.updateMission(classic.id, { phase: 'cancelled' }).mode, 'pipeline')

  const dynamic = dynamicMission(tasks)
  assert.equal(dynamic.mode, 'dynamic')
  assert.deepEqual(dynamic.limits, DEFAULT_LIMITS)
  tasks.updateMission(dynamic.id, { phase: 'cancelled' })

  const custom = tasks.createMission(tasks.create(1, TASK).id, 1, { mode: 'dynamic', limits: { maxSteps: 40, maxActiveMembers: 15 } })
  assert.deepEqual(custom.limits, { ...DEFAULT_LIMITS, maxSteps: 40, maxActiveMembers: 15 })
  assert.throws(() => tasks.createMission(tasks.create(1, TASK).id, 1, { mode: 'dynamic', limits: { maxSteps: -1 } }), /maxSteps/)
})

test('missões: limites ilegíveis no banco não impedem carregar a missão', () => {
  const { db, tasks } = open()
  const mission = dynamicMission(tasks)
  for (const broken of ['não é json', '{"maxSteps": "muitos"}', '[1,2]']) {
    db.prepare('UPDATE missions SET limits = ? WHERE id = ?').run(broken, mission.id)
    assert.deepEqual(tasks.getMission(mission.id)!.limits, DEFAULT_LIMITS)
  }
})

test('missões: as fases novas contam como abertas (uma missão aberta por tarefa)', () => {
  const { tasks } = open()
  const mission = dynamicMission(tasks)
  for (const phase of ['executing', 'awaiting_decision'] as const) {
    tasks.updateMission(mission.id, { phase })
    assert.ok(OPEN_PHASES.includes(phase))
    assert.deepEqual(tasks.openMissions().map((m) => m.id), [mission.id])
    assert.throws(() => tasks.createMission(mission.taskId, 1), /já tem uma missão em andamento/)
  }
})

test('propostas: revisões crescem, só uma fica pendente e a missão espera o usuário', () => {
  const { tasks, plans } = open()
  const mission = dynamicMission(tasks)
  const query = { projectId: 1, missionId: mission.id }

  const first = plans.propose(mission.id, 'architect', proposal())
  assert.equal(first.revision, 1)
  assert.equal(first.status, 'pending')
  assert.equal(first.author, 'architect')
  assert.equal(first.decidedAt, null)
  assert.deepEqual(first.steps.map((s) => s.key), ['impl', 'teste'])
  assert.deepEqual(first.sharedContext, [{ kind: 'plan' }])
  assert.equal(tasks.getMission(mission.id)!.phase, 'awaiting_approval')
  // Propor não cria passos: eles só existem depois da aprovação.
  assert.deepEqual(plans.listSteps(query), [])

  const second = plans.propose(mission.id, 'architect', proposal({ reason: 'Versão melhor.' }))
  assert.equal(second.revision, 2)
  assert.deepEqual(plans.listProposals(query).map((p) => [p.revision, p.status]), [[1, 'superseded'], [2, 'pending']])
})

test('propostas: segredos não são gravados', () => {
  const { tasks, plans } = open()
  const mission = dynamicMission(tasks)
  const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456'
  const saved = plans.propose(mission.id, 'architect', proposal({ reason: `Usar a chave ${secret}`, steps: [{ ...step('impl', 'dev', 'implement'), objective: `Configurar ${secret}` }] }))
  assert.doesNotMatch(JSON.stringify(saved), /sk-abcdefghij/)
  assert.equal(saved.steps.length, 1)
})

test('aprovação: cria os passos e libera a execução de uma vez; a repetição não duplica', () => {
  const { tasks, plans } = open()
  const mission = dynamicMission(tasks)
  const query = { projectId: 1, missionId: mission.id }
  const pending = plans.propose(mission.id, 'architect', proposal())

  const { proposal: approved, applied } = plans.decide(pending.id, 1, 'approve')
  assert.equal(applied, true)
  assert.equal(approved.status, 'approved')
  assert.equal(approved.decidedBy, 'user')
  assert.match(approved.decidedAt!, /^\d{4}-/)
  assert.equal(tasks.getMission(mission.id)!.phase, 'executing')
  const steps = plans.listSteps(query)
  assert.deepEqual(steps.map((s) => [s.key, s.status, s.revision, s.seq, s.proposalId]), [['impl', 'approved', 1, 0, pending.id], ['teste', 'approved', 1, 1, pending.id]])
  assert.deepEqual(steps[1].dependsOn, ['impl'])
  assert.deepEqual(teamOf('architect', plans.listProposals(query)).sort(), ['architect', 'dev', 'qa'])

  // Segundo clique em "Aprovar": mesma resposta, nenhum efeito.
  const again = plans.decide(pending.id, 1, 'approve')
  assert.equal(again.applied, false)
  assert.equal(again.proposal.decidedAt, approved.decidedAt)
  assert.equal(plans.listSteps(query).length, 2)
  // Mudar de ideia depois de decidido não vale.
  assert.throws(() => plans.decide(pending.id, 1, 'reject'), /não está mais aguardando decisão/)
  assert.equal(plans.getProposal(pending.id)!.status, 'approved')
})

test('aprovação obsoleta: proposta substituída ou revisão errada não executa nada', () => {
  const { tasks, plans } = open()
  const mission = dynamicMission(tasks)
  const query = { projectId: 1, missionId: mission.id }
  const old = plans.propose(mission.id, 'architect', proposal())
  const current = plans.propose(mission.id, 'architect', proposal({ steps: [step('so-dev', 'dev', 'implement')] }))

  assert.throws(() => plans.decide(old.id, old.revision, 'approve'), /não está mais aguardando decisão/)
  // A revisão que o usuário viu não é a da proposta.
  assert.throws(() => plans.decide(current.id, old.revision, 'approve'), /não está mais aguardando decisão/)
  assert.throws(() => plans.decide(999, 1, 'approve'), /não encontrada/)
  assert.deepEqual(plans.listSteps(query), [])
  assert.equal(tasks.getMission(mission.id)!.phase, 'awaiting_approval')
  assert.deepEqual(plans.listProposals(query).map((p) => p.status), ['superseded', 'pending'])

  assert.equal(plans.decide(current.id, current.revision, 'approve').applied, true)
  assert.deepEqual(plans.listSteps(query).map((s) => s.key), ['so-dev'])
})

test('aprovação: uma falha no meio desfaz tudo', () => {
  const { tasks, plans } = open()
  const mission = dynamicMission(tasks)
  const query = { projectId: 1, missionId: mission.id }
  // Chaves repetidas violam o índice único na segunda inserção (a validação do coordenador barraria antes).
  const pending = plans.propose(mission.id, 'architect', proposal({ steps: [step('a', 'dev', 'implement'), step('a', 'dev', 'analyze')] }))
  assert.throws(() => plans.decide(pending.id, 1, 'approve'), /UNIQUE/)
  assert.equal(plans.getProposal(pending.id)!.status, 'pending')
  assert.deepEqual(plans.listSteps(query), [])
  assert.equal(tasks.getMission(mission.id)!.phase, 'awaiting_approval')
})

test('rejeição e ajuste: ficam registrados com o texto do usuário e não criam passos', () => {
  const { tasks, plans } = open()
  const mission = dynamicMission(tasks)
  const query = { projectId: 1, missionId: mission.id }

  const first = plans.propose(mission.id, 'architect', proposal())
  const adjusted = plans.decide(first.id, 1, 'adjust', { feedback: 'Sem o QA por enquanto.' }).proposal
  assert.equal(adjusted.status, 'adjust_requested')
  assert.equal(adjusted.feedback, 'Sem o QA por enquanto.')
  assert.equal(tasks.getMission(mission.id)!.phase, 'planning')
  assert.equal(plans.decide(first.id, 1, 'adjust').applied, false)

  const second = plans.propose(mission.id, 'architect', proposal())
  assert.equal(second.adjustRound, 1)
  // Sem plano vigente, rejeitar deixa a missão esperando o usuário, sem chamar ninguém.
  assert.equal(plans.decide(second.id, 2, 'reject', { decidedBy: 'user', feedback: 'Não.' }).proposal.status, 'rejected')
  assert.equal(tasks.getMission(mission.id)!.phase, 'awaiting_decision')
  assert.deepEqual(plans.listSteps(query), [])
  assert.deepEqual(teamOf('architect', plans.listProposals(query)), ['architect'])
  // A proposta seguinte volta à rodada zero de ajuste.
  tasks.updateMission(mission.id, { phase: 'planning' })
  assert.equal(plans.propose(mission.id, 'architect', proposal()).adjustRound, 0)
})

test('replanejamento: substitui o que não começou e preserva o que já rodou e seus resultados', () => {
  const { tasks, plans } = open()
  const mission = dynamicMission(tasks)
  const query = { projectId: 1, missionId: mission.id }
  plans.decide(plans.propose(mission.id, 'architect', proposal()).id, 1, 'approve')

  const impl = nextStep(plans.listSteps(query))!
  assert.equal(impl.key, 'impl')
  assert.equal(plans.startStep(impl.id, 'exec-1').status, 'running')
  // Um passo por vez: com um rodando, não há próximo.
  assert.equal(nextStep(plans.listSteps(query)), null)
  const done = plans.finishStep(impl.id, 'completed', { result: 'Implementado. Dúvida na consulta SQL.' })
  assert.equal(done.correlationId, 'exec-1')
  assert.match(done.startedAt!, /^\d{4}-/)
  assert.match(done.finishedAt!, /^\d{4}-/)

  // Gatilho: o Tech Lead volta a planejar e propõe reconvocar um especialista.
  tasks.updateMission(mission.id, { phase: 'planning' })
  const replan = plans.propose(
    mission.id,
    'architect',
    proposal({
      kind: 'replan',
      teamChanges: [convene('dados')],
      steps: [{ ...step('sql', 'dados', 'analyze'), inputs: [{ kind: 'step', key: 'impl', revision: 1 }] }, step('ajuste', 'dev', 'implement', ['sql']), step('teste', 'qa', 'verify', ['ajuste'])],
    }),
  )
  plans.decide(replan.id, 2, 'approve')

  const steps = plans.listSteps(query)
  assert.deepEqual(
    steps.map((s) => [s.revision, s.key, s.status]),
    [[1, 'impl', 'completed'], [1, 'teste', 'superseded'], [2, 'sql', 'approved'], [2, 'ajuste', 'approved'], [2, 'teste', 'approved']],
  )
  assert.equal(steps[0].result, 'Implementado. Dúvida na consulta SQL.')
  assert.deepEqual(steps[2].inputs, [{ kind: 'step', key: 'impl', revision: 1 }])
  assert.equal(nextStep(steps)!.key, 'sql')
  assert.deepEqual(teamOf('architect', plans.listProposals(query)).sort(), ['architect', 'dados', 'dev', 'qa'])
  // O passo substituído não pode mais começar.
  assert.throws(() => plans.startStep(steps[1].id, 'exec-x'), /não está aprovado/)

  // Uma proposta só de equipe mantém a fila aprovada.
  tasks.updateMission(mission.id, { phase: 'planning' })
  const teamOnly = plans.propose(mission.id, 'architect', proposal({ kind: 'replan', teamChanges: [convene('seguranca')], steps: [] }))
  plans.decide(teamOnly.id, 3, 'approve')
  assert.equal(nextStep(plans.listSteps(query))!.key, 'sql')
  assert.equal(tasks.getMission(mission.id)!.phase, 'executing')
})

test('passos: só o que foi aprovado começa, e só o que está rodando termina', () => {
  const { tasks, plans } = open()
  const mission = dynamicMission(tasks)
  const query = { projectId: 1, missionId: mission.id }
  plans.decide(plans.propose(mission.id, 'architect', proposal()).id, 1, 'approve')
  const [impl, teste] = plans.listSteps(query)

  assert.throws(() => plans.startStep(999, 'x'), /não está aprovado/)
  assert.throws(() => plans.finishStep(impl.id, 'completed'), /não está em execução/)
  plans.startStep(impl.id, 'exec-1')
  assert.throws(() => plans.startStep(impl.id, 'exec-2'), /não está aprovado/)
  const failed = plans.finishStep(impl.id, 'failed', { error: 'codex: limite de uso atingido' })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error, 'codex: limite de uso atingido')
  assert.throws(() => plans.finishStep(impl.id, 'completed'), /não está em execução/)
  // A dependência falhou: o seguinte continua aprovado, mas não é elegível.
  assert.equal(plans.getStep(teste.id)!.status, 'approved')
  assert.equal(nextStep(plans.listSteps(query)), null)
})

test('encerramento: só com confirmação humana; cancelar invalida o que estava pendente', () => {
  const { tasks, plans } = open()
  const mission = dynamicMission(tasks)
  const query = { projectId: 1, missionId: mission.id }
  plans.decide(plans.propose(mission.id, 'architect', proposal()).id, 1, 'approve')
  tasks.updateMission(mission.id, { phase: 'planning' })
  const closure = plans.propose(mission.id, 'architect', proposal({ kind: 'closure', teamChanges: [], steps: [] }))
  assert.equal(tasks.getMission(mission.id)!.phase, 'awaiting_approval')
  plans.decide(closure.id, 2, 'approve')
  assert.equal(tasks.getMission(mission.id)!.phase, 'done')

  // Cancelamento com proposta pendente e passo rodando.
  const other = dynamicMission(tasks)
  const otherQuery = { projectId: 1, missionId: other.id }
  plans.decide(plans.propose(other.id, 'architect', proposal()).id, 1, 'approve')
  plans.startStep(plans.listSteps(otherQuery)[0].id, 'exec-1')
  tasks.updateMission(other.id, { phase: 'planning' })
  const late = plans.propose(other.id, 'architect', proposal({ kind: 'replan', teamChanges: [convene('dados')], steps: [] }))
  tasks.updateMission(other.id, { phase: 'cancelled' })
  plans.closeMission(other.id)
  assert.deepEqual(plans.listSteps(otherQuery).map((s) => s.status), ['cancelled', 'cancelled'])
  assert.equal(plans.getProposal(late.id)!.status, 'superseded')
  // A aprovação que chega depois do cancelamento não faz nada.
  assert.throws(() => plans.decide(late.id, late.revision, 'approve'), /não está mais aguardando decisão/)
  assert.equal(tasks.getMission(other.id)!.phase, 'cancelled')
  // A outra missão não foi tocada.
  assert.deepEqual(plans.listSteps(query).map((s) => s.status), ['approved', 'approved'])
})

test('decisão fora da espera: proposta pendente de missão que saiu de awaiting_approval não é aplicada', () => {
  const { tasks, plans } = open()
  const mission = dynamicMission(tasks)
  const pending = plans.propose(mission.id, 'architect', proposal())
  tasks.updateMission(mission.id, { phase: 'awaiting_decision' })
  assert.throws(() => plans.decide(pending.id, 1, 'approve'), /não está mais aguardando decisão/)
  assert.equal(plans.getProposal(pending.id)!.status, 'pending')
  // Propor só é possível a partir do planejamento.
  tasks.updateMission(mission.id, { phase: 'executing' })
  assert.throws(() => plans.propose(mission.id, 'architect', proposal()), /executing → awaiting_approval/)
})

test('persistência: propostas, decisões e passos sobrevivem ao reinício; passo rodando vira interrompido', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'aidw-plan-')), 'app.db')
  const first = open(file)
  const mission = dynamicMission(first.tasks)
  const query = { projectId: 1, missionId: mission.id }
  const approved = first.plans.decide(first.plans.propose(mission.id, 'architect', proposal()).id, 1, 'approve', { feedback: 'Pode seguir.' }).proposal
  first.plans.startStep(first.plans.listSteps(query)[0].id, 'exec-1')
  first.tasks.updateMission(mission.id, { phase: 'planning' })
  const pending = first.plans.propose(mission.id, 'architect', proposal({ kind: 'replan', teamChanges: [convene('dados')], steps: [] }))
  first.db.close()

  const second = open(file)
  assert.deepEqual(second.plans.getProposal(approved.id), approved)
  assert.deepEqual(second.plans.getProposal(pending.id), pending)
  assert.equal(second.tasks.getMission(mission.id)!.mode, 'dynamic')
  assert.equal(second.tasks.getMission(mission.id)!.phase, 'awaiting_approval')
  // O fluxo clássico não marca a missão dinâmica como falha ao iniciar.
  assert.deepEqual(second.tasks.failInterrupted(), [])

  const interrupted = second.plans.interruptRunning()
  assert.deepEqual(interrupted.map((s) => [s.key, s.status, s.correlationId]), [['impl', 'interrupted', 'exec-1']])
  assert.match(interrupted[0].error!, /Interrompido/)
  assert.deepEqual(second.plans.interruptRunning(), [])
  assert.equal(second.plans.listSteps(query)[1].status, 'approved')
  // A decisão pendente continua valendo depois do reinício, uma única vez.
  assert.equal(second.plans.decide(pending.id, pending.revision, 'approve').applied, true)
  assert.equal(second.plans.decide(pending.id, pending.revision, 'approve').applied, false)
  second.db.close()
})

test('isolamento: nenhuma consulta atravessa projetos', () => {
  const { tasks, plans } = open()
  const a = dynamicMission(tasks, 1)
  const b = dynamicMission(tasks, 2)
  plans.decide(plans.propose(a.id, 'architect', proposal()).id, 1, 'approve')
  plans.propose(b.id, 'architect', proposal({ reason: 'Projeto B.' }))

  assert.equal(plans.listProposals({ projectId: 1, missionId: a.id }).length, 1)
  assert.equal(plans.listSteps({ projectId: 1, missionId: a.id }).length, 2)
  // Missão certa com o projeto errado não devolve nada.
  assert.deepEqual(plans.listProposals({ projectId: 2, missionId: a.id }), [])
  assert.deepEqual(plans.listSteps({ projectId: 2, missionId: a.id }), [])
  assert.deepEqual(plans.listProposals({ projectId: 1, missionId: b.id }), [])
  // Cada missão tem a sua numeração de revisões e os seus passos.
  assert.equal(plans.listProposals({ projectId: 2, missionId: b.id })[0].revision, 1)
  assert.equal(plans.listProposals({ projectId: 2, missionId: b.id })[0].projectId, 2)
  assert.deepEqual(plans.listSteps({ projectId: 2, missionId: b.id }), [])
})

test('compatibilidade: o fluxo clássico não aprova nem esclarece missão dinâmica, e falha só as clássicas no reinício', async () => {
  const projects = new ProjectStore(':memory:')
  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const plans = new PlanStore(projects.db, tasks)
  const events = new EventStore(projects.db)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))
  for (const agent of registry.list()) await registry.check(agent.id)
  let launched = 0
  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    events,
    git: new GitService(),
    launch: () => {
      launched++
      return { done: Promise.resolve({ code: 0, stdout: 'ok', stderr: '', timedOut: false }), kill: () => {} }
    },
  })

  const dynamic = dynamicMission(tasks)
  plans.propose(dynamic.id, 'architect', proposal())
  await assert.rejects(runner.approve(dynamic.id), /não está aguardando aprovação/)
  tasks.updateMission(dynamic.id, { phase: 'awaiting_clarification' })
  await assert.rejects(runner.clarify(dynamic.id, 'resposta'), /não está aguardando esclarecimento/)
  assert.equal(launched, 0)

  // Reinício com uma clássica e uma dinâmica "rodando": só a clássica falha.
  tasks.updateMission(dynamic.id, { phase: 'executing' })
  const classic = tasks.createMission(tasks.create(1, TASK).id, 1)
  tasks.updateMission(classic.id, { phase: 'developing' })
  runner.recover()
  assert.equal(tasks.getMission(classic.id)!.phase, 'failed')
  assert.equal(tasks.getMission(dynamic.id)!.phase, 'executing')
  assert.equal(tasks.getMission(dynamic.id)!.mode, 'dynamic')
  // O cancelamento do fluxo clássico continua funcionando para qualquer missão aberta.
  runner.cancel(dynamic.id)
  assert.equal(tasks.getMission(dynamic.id)!.phase, 'cancelled')
})

test('migração 10.2: tabela de propostas da 10.1 ganha os campos novos sem perder registros', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'aidw-plan-102-')), 'app.db')
  const first = open(file)
  const mission = dynamicMission(first.tasks)
  // Volta a tabela ao formato da 10.1 e grava uma proposta como aquela versão gravaria.
  for (const column of ['objective', 'risks', 'completion_criteria']) first.db.exec(`ALTER TABLE mission_proposals DROP COLUMN ${column}`)
  first.db
    .prepare(`INSERT INTO mission_proposals (mission_id, project_id, revision, kind, status, author, reason, created_at) VALUES (?, 1, 1, 'plan', 'pending', 'architect', 'Antiga', '2026-01-01')`)
    .run(mission.id)
  first.db.close()

  for (let boot = 0; boot < 2; boot++) {
    const { db, plans } = open(file)
    const [old] = plans.listProposals({ projectId: 1, missionId: mission.id })
    assert.equal(old.reason, 'Antiga')
    assert.equal(old.objective, '')
    assert.deepEqual(old.risks, [])
    assert.deepEqual(old.completionCriteria, [])
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mission_proposals').get()!.n, 1)
    db.close()
  }
})
