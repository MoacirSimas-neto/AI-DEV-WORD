import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
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
