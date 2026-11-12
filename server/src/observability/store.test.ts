import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import type { MissionEvent } from '../../../shared/protocol.ts'
import { HistoryStore } from '../history/store.ts'
import { TaskStore } from '../tasks/store.ts'
import { EventStore, MAX_EVENTS_PER_MISSION, type NewMissionEvent } from './store.ts'

const base: NewMissionEvent = { projectId: 1, missionId: 1, type: 'mission.started', evidence: 'observed', summary: 'início' }

test('EventStore persiste em SQLite com ids únicos e ordem estável entre reaberturas', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'aidw-events-')), 'app.db')
  const db = new DatabaseSync(file)
  const store = new EventStore(db)
  const a = store.record({ ...base, agentId: 'dev', taskId: 7, state: 'started', correlationId: 'exec-1', data: { ref: 'missions.plan' } })!
  const b = store.record({ ...base, type: 'cli.started', summary: 'cli' })!
  const c = store.record({ ...base, type: 'cli.finished', summary: 'fim', data: { exitCode: 0 } })!
  assert.ok(a.id < b.id && b.id < c.id)
  assert.match(a.at, /^\d{4}-\d{2}-\d{2}T/)
  db.close()

  const reopened = new DatabaseSync(file)
  const again = new EventStore(reopened)
  const listed = again.list({ projectId: 1, missionId: 1 })
  assert.deepEqual(listed.map((e) => e.id), [a.id, b.id, c.id])
  assert.deepEqual(listed[0], a)
  assert.equal(listed[0].correlationId, 'exec-1')
  assert.deepEqual(listed[2].data, { exitCode: 0 })
  // afterId pagina sem repetir, e um id nunca é reaproveitado.
  assert.deepEqual(again.list({ projectId: 1, afterId: b.id }).map((e) => e.id), [c.id])
  assert.ok(again.record(base)!.id > c.id)
  reopened.close()
})

test('EventStore trata evento duplicado: mesma chave na mesma missão não cria outro registro', () => {
  const store = new EventStore(new DatabaseSync(':memory:'))
  const emitted: MissionEvent[] = []
  store.on('added', (e) => emitted.push(e))
  const first = store.record({ ...base, dedupeKey: 'mission.started' })!
  const repeat = store.record({ ...base, summary: 'repetido', dedupeKey: 'mission.started' })!
  assert.equal(repeat.id, first.id)
  assert.equal(repeat.summary, 'início')
  assert.equal(emitted.length, 1)
  // A mesma chave em outra missão é outro fato; sem chave, cada registro é um fato.
  assert.notEqual(store.record({ ...base, missionId: 2, dedupeKey: 'mission.started' })!.id, first.id)
  store.record(base)
  store.record(base)
  assert.equal(store.list({ projectId: 1, missionId: 1 }).length, 3)
})

test('EventStore isola por projeto e por missão', () => {
  const store = new EventStore(new DatabaseSync(':memory:'))
  store.record({ ...base, projectId: 1, missionId: 1, summary: 'projeto 1' })
  store.record({ ...base, projectId: 2, missionId: 2, summary: 'projeto 2' })
  store.record({ ...base, projectId: 1, missionId: 3, summary: 'outra missão' })
  assert.deepEqual(store.list({ projectId: 1 }).map((e) => e.summary), ['projeto 1', 'outra missão'])
  assert.deepEqual(store.list({ projectId: 2 }).map((e) => e.summary), ['projeto 2'])
  assert.deepEqual(store.list({ projectId: 1, missionId: 3 }).map((e) => e.summary), ['outra missão'])
  // Missão de outro projeto não aparece, mesmo pedindo pelo id dela.
  assert.deepEqual(store.list({ projectId: 1, missionId: 2 }), [])
  assert.deepEqual(store.list({ projectId: 0 }), [])
  assert.deepEqual(store.list({ projectId: Number.NaN }), [])
})

test('EventStore remove credenciais e limita o tamanho do que grava', () => {
  const store = new EventStore(new DatabaseSync(':memory:'))
  const event = store.record({
    ...base,
    summary: `falhou \u001b[31mtoken=abcdef123456\u001b[0m ${'x'.repeat(2000)}`,
    data: {
      apiKey: 'sk-live-1234567890abcdefgh',
      password: 'hunter22',
      nested: { note: 'Authorization: Bearer abcdefghijklmnop123', url: 'https://user:senha123@host/repo.git' },
      list: Array.from({ length: 500 }, (_, i) => i),
      long: 'y'.repeat(5000),
      fn: () => 'x',
    },
  })!
  const raw = JSON.stringify(event)
  for (const secret of ['abcdef123456', 'sk-live-1234567890abcdefgh', 'hunter22', 'abcdefghijklmnop123', 'senha123', '\u001b']) {
    assert.ok(!raw.includes(secret), `vazou: ${secret}`)
  }
  assert.ok(event.summary.length <= 500)
  assert.equal((event.data.list as unknown[]).length, 100)
  assert.equal((event.data.long as string).length, 500)
  assert.equal(event.data.fn, null)

  // Metadados grandes demais viram só um aviso de corte.
  const huge = store.record({ ...base, data: Object.fromEntries(Array.from({ length: 90 }, (_, i) => [`k${i}`, 'z'.repeat(400)])) })!
  assert.equal(huge.data.truncated, true)
})

test('EventStore ignora eventos malformados sem lançar e sobrevive a dados corrompidos', () => {
  const db = new DatabaseSync(':memory:')
  const store = new EventStore(db)
  const bad: unknown[] = [
    null,
    {},
    { ...base, projectId: 0 },
    { ...base, missionId: 1.5 },
    { ...base, type: 'DROP TABLE' },
    { ...base, evidence: 'verified' },
    { ...base, state: 'weird' },
    { ...base, summary: 42 },
  ]
  for (const input of bad) assert.equal(store.record(input as NewMissionEvent), null)
  assert.deepEqual(store.list({ projectId: 1 }), [])

  // Campos opcionais inválidos são descartados, não o evento.
  const circular: Record<string, unknown> = {}
  circular.self = circular
  const kept = store.record({ ...base, agentId: 'id com espaço; DROP', correlationId: '<script>', data: circular })!
  assert.equal(kept.agentId, null)
  assert.equal(kept.correlationId, null)

  db.prepare("UPDATE mission_events SET data = '{quebrado' WHERE id = ?").run(kept.id)
  assert.deepEqual(store.list({ projectId: 1 })[0].data, {})
})

test('EventStore aplica limite por missão e retenção por projeto', () => {
  const store = new EventStore(new DatabaseSync(':memory:'))
  for (let i = 0; i < MAX_EVENTS_PER_MISSION + 5; i++) store.record({ ...base, summary: `e${i}` })
  const events = store.list({ projectId: 1, missionId: 1, afterId: MAX_EVENTS_PER_MISSION - 1 })
  assert.deepEqual(events.map((e) => e.type), ['mission.started', 'log.truncated'])
  assert.equal(store.record(base), null)

  for (const missionId of [2, 3, 4]) store.record({ ...base, missionId })
  store.record({ ...base, projectId: 2, missionId: 9 })
  store.prune(1, 2)
  assert.deepEqual([...new Set(store.list({ projectId: 1 }).map((e) => e.missionId))], [3, 4])
  assert.equal(store.list({ projectId: 2 }).length, 1)
})

test('EventStore em banco antigo: missões anteriores continuam legíveis e apenas não têm eventos', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE missions (
      id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL, project_id INTEGER NOT NULL, phase TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT '', dev_report TEXT NOT NULL DEFAULT '', review TEXT NOT NULL DEFAULT '',
      verdict TEXT, files TEXT NOT NULL DEFAULT '[]', error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO missions (task_id, project_id, phase, plan, created_at, updated_at)
      VALUES (1, 1, 'done', 'plano antigo', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
  `)
  const tasks = new TaskStore(db, new HistoryStore(db))
  const store = new EventStore(db)
  new EventStore(db) // abrir de novo não quebra nem duplica nada
  assert.equal(tasks.getMission(1)!.plan, 'plano antigo')
  assert.deepEqual(store.list({ projectId: 1, missionId: 1 }), [])
  assert.ok(store.record({ ...base, missionId: 2 }))
  assert.deepEqual(store.list({ projectId: 1, missionId: 1 }), [])
})
