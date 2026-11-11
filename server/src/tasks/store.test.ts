import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { AgentConfigStore } from '../agents/configStore.ts'
import { HistoryStore } from '../history/store.ts'
import { TaskStore } from './store.ts'

test('TaskStore CRUD de tarefas e atualizacao de status', () => {
  const db = new DatabaseSync(':memory:')
  const history = new HistoryStore(db)
  const store = new TaskStore(db, history)

  const task = store.create(1, {
    title: 'Minha Tarefa',
    description: 'Descricao',
    priority: 'high',
    status: 'todo',
    agentId: 'dev',
  })

  assert.equal(task.id, 1)
  assert.equal(task.title, 'Minha Tarefa')
  assert.equal(task.status, 'todo')

  const updated = store.update(task.id, {
    title: 'Titulo Modificado',
    description: 'Nova Descricao',
    priority: 'medium',
    status: 'doing',
    agentId: null,
  })

  assert.equal(updated.title, 'Titulo Modificado')
  assert.equal(updated.status, 'doing')

  store.setStatus(task.id, 'done')
  const doneTask = store.get(task.id)!
  assert.equal(doneTask.status, 'done')

  const tasks = store.list()
  assert.equal(tasks.length, 1)

  store.delete(task.id)
  assert.equal(store.list().length, 0)
  assert.equal(store.get(task.id), null)
})

test('TaskStore gerencia missoes e impede duplicidade aberta', () => {
  const db = new DatabaseSync(':memory:')
  const history = new HistoryStore(db)
  const store = new TaskStore(db, history)

  const task = store.create(1, {
    title: 'Tarefa Missao',
    description: '',
    priority: 'low',
    status: 'todo',
    agentId: null,
  })

  const mission = store.createMission(task.id, 1)
  assert.equal(mission.phase, 'planning')
  assert.equal(mission.taskId, task.id)
  assert.equal(mission.plannerId, 'architect')
  assert.equal(mission.devId, 'dev')
  assert.equal(mission.qaId, 'qa')

  // Nao pode abrir outra missao aberta para a mesma tarefa
  assert.throws(() => store.createMission(task.id, 1), /já tem uma missão em andamento/)

  const updatedMission = store.updateMission(mission.id, {
    phase: 'awaiting_approval',
    plan: 'Plano teste',
  })
  assert.equal(updatedMission.phase, 'awaiting_approval')
  assert.equal(updatedMission.plan, 'Plano teste')

  const openList = store.openMissions()
  assert.equal(openList.length, 1)

  // Falha missoes interrompidas
  store.updateMission(mission.id, { phase: 'developing' })
  const failed = store.failInterrupted()
  assert.equal(failed.length, 1)
  assert.equal(failed[0].phase, 'failed')
})

test('TaskStore: migração de missões antigas e preservação de histórico/missões com agente desativado', () => {
  const db = new DatabaseSync(':memory:')

  // 1. Cria tabela missions no formato antigo (sem planner_id, dev_id, qa_id, verdict_detail, team_snapshot)
  db.exec(`
    CREATE TABLE missions (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      phase TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT '',
      dev_report TEXT NOT NULL DEFAULT '',
      review TEXT NOT NULL DEFAULT '',
      verdict TEXT,
      files TEXT NOT NULL DEFAULT '["index.ts"]',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO missions (id, task_id, project_id, phase, plan, dev_report, review, verdict, files, created_at, updated_at)
    VALUES (1, 1, 1, 'done', 'Plano v1', 'Dev v1', 'QA v1', 'approved', '["index.ts"]', '2026-01-01', '2026-01-01');
  `)

  const history = new HistoryStore(db)
  const store = new TaskStore(db, history)
  // Executa segunda vez para confirmar idempotência
  new TaskStore(db, history)

  const legacyMission = store.getMission(1)
  assert.ok(legacyMission)
  assert.equal(legacyMission.plannerId, 'architect')
  assert.equal(legacyMission.devId, 'dev')
  assert.equal(legacyMission.qaId, 'qa')
  assert.equal(legacyMission.verdict, 'approved')
  assert.equal(legacyMission.verdictDetail, null)
  assert.deepEqual(legacyMission.files, ['index.ts'])
  assert.deepEqual(legacyMission.specialists, [])
  assert.deepEqual(legacyMission.specialistResults, [])

  // 1.1 Testa persistência de missão com especialistas da Etapa 7
  store.updateMission(legacyMission.id, { phase: 'done' })
  const specMission = store.createMission(1, 1, {
    plannerId: 'architect',
    devId: 'dev',
    qaId: 'qa',
    specialists: [
      { agentId: 'data-expert', role: 'database', timing: 'pre-dev', expectedContribution: 'Schema SQL' },
      { agentId: 'sec-guard', role: 'security', timing: 'post-dev', expectedContribution: 'Análise de injeção' },
    ],
  })
  assert.equal(specMission.specialists?.length, 2)
  assert.equal(specMission.specialists?.[0].role, 'database')
  assert.equal(specMission.specialists?.[1].timing, 'post-dev')

  store.updateMission(specMission.id, {
    phase: 'done',
    specialistResults: [
      {
        agentId: 'data-expert',
        role: 'database',
        timing: 'pre-dev',
        status: 'completed',
        summary: 'Tabelas normalizadas',
        details: 'CREATE TABLE produtos...',
      },
    ],
  })
  const updatedSpec = store.getMission(specMission.id)!
  assert.equal(updatedSpec.specialistResults?.length, 1)
  assert.equal(updatedSpec.specialistResults?.[0].status, 'completed')
  assert.equal(updatedSpec.specialistResults?.[0].summary, 'Tabelas normalizadas')

  // 2. Cria agente customizado, associa a tarefa/missão/histórico e depois desativa o agente
  const configs = new AgentConfigStore(db)
  const customQa = configs.createAgent({
    id: 'qa-auditor',
    name: 'QA Auditor',
    role: 'Auditoria Rigorosa',
    roleCategory: 'reviewing',
    specializationId: 'qa-tester',
    provider: 'antigravity',
    model: 'gemini-4-argon-high',
  })

  const task = store.create(1, {
    title: 'Validar módulo financeiro',
    description: 'Auditoria',
    priority: 'high',
    status: 'todo',
    agentId: customQa.agentId,
  })

  const m2 = store.createMission(task.id, 1, {
    plannerId: 'architect',
    devId: 'dev',
    qaId: customQa.agentId,
    teamSnapshot: {
      [customQa.agentId]: {
        agentId: customQa.agentId,
        name: customQa.name!,
        role: customQa.role!,
        provider: customQa.provider,
        model: customQa.model,
        specializationId: customQa.specializationId!,
      },
    },
  })

  history.add({
    kind: 'review',
    message: 'QA Auditor finalizou revisão com ressalvas.',
    projectId: 1,
    taskId: task.id,
    missionId: m2.id,
    agentId: customQa.agentId,
  })

  store.updateMission(m2.id, {
    phase: 'done',
    verdict: 'approved',
    verdictDetail: 'APROVADO COM RESSALVAS',
  })

  // Desativa o agente customizado
  configs.setAgentActive(customQa.agentId, false)

  // Missão, snapshot e histórico continuam íntegros
  const loadedM2 = store.getMission(m2.id)!
  assert.equal(loadedM2.qaId, 'qa-auditor')
  assert.equal(loadedM2.verdictDetail, 'APROVADO COM RESSALVAS')
  assert.equal(loadedM2.teamSnapshot?.['qa-auditor']?.name, 'QA Auditor')

  const histEntries = history.list().filter((h) => h.agentId === 'qa-auditor')
  assert.equal(histEntries.length, 1)
  assert.ok(histEntries[0].message.includes('QA Auditor'))
})
