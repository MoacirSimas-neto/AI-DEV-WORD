import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { AgentConfigStore } from '../agents/configStore.ts'
import { HistoryStore } from '../history/store.ts'
import { MemoryStore } from '../memory/store.ts'
import { EventStore } from '../observability/store.ts'
import { ProjectStore } from '../projects/store.ts'
import { SkillStore } from '../skills/store.ts'
import { TaskStore } from '../tasks/store.ts'
import { PlanStore } from '../team/planStore.ts'
import { acquireInstanceLock, BUSY_TIMEOUT_MS, describeDatabaseError, isBusyError, openDatabase } from './database.ts'

const dirs: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidw-db-'))
  dirs.push(dir)
  return dir
}
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const MODULE = pathToFileURL(path.join(import.meta.dirname, 'database.ts')).href

/** Processo filho real (outro PID, outras travas do SO) rodando um script ESM. */
function child(script: string): ChildProcess & { output: Promise<{ code: number | null; stdout: string; stderr: string }> } {
  const proc = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  proc.stdout!.on('data', (d) => (stdout += d))
  proc.stderr!.on('data', (d) => (stderr += d))
  const output = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) =>
    proc.on('close', (code) => resolve({ code, stdout, stderr })),
  )
  return Object.assign(proc, { output })
}

const waitFor = (proc: ChildProcess, text: string) =>
  new Promise<void>((resolve, reject) => {
    let seen = ''
    proc.stdout!.on('data', (d) => {
      seen += d
      if (seen.includes(text)) resolve()
    })
    proc.on('close', () => reject(new Error(`filho saiu antes de "${text}": ${seen}`)))
  })

test('openDatabase: arquivo em WAL com busy_timeout; :memory: só com busy_timeout', () => {
  const file = path.join(tempDir(), 'data.sqlite')
  const db = openDatabase(file)
  assert.equal((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal')
  assert.equal(Object.values(db.prepare('PRAGMA busy_timeout').get()!)[0], BUSY_TIMEOUT_MS)
  db.close()
  const mem = openDatabase(':memory:')
  assert.equal(Object.values(mem.prepare('PRAGMA busy_timeout').get()!)[0], BUSY_TIMEOUT_MS)
  mem.close()
})

test('migração idempotente: abrir todos os stores duas vezes no mesmo arquivo não perde dados', () => {
  const dir = tempDir()
  const file = path.join(dir, 'data.sqlite')
  const openAll = () => {
    const projects = new ProjectStore(file)
    const history = new HistoryStore(projects.db)
    const tasks = new TaskStore(projects.db, history)
    new AgentConfigStore(projects.db)
    new MemoryStore(projects.db, history)
    new SkillStore(projects.db, path.join(dir, 'skills'))
    new EventStore(projects.db)
    new PlanStore(projects.db, tasks)
    return { projects, tasks }
  }
  const first = openAll()
  first.projects.add(dir)
  const projectId = first.projects.active()!.id
  const task = first.tasks.create(projectId, { title: 'Tarefa que sobrevive à migração', description: '', priority: 'medium', status: 'todo', agentId: null })
  first.projects.close()

  const second = openAll()
  assert.equal(second.projects.active()?.id, projectId)
  assert.equal(second.tasks.get(task.id)?.title, 'Tarefa que sobrevive à migração')
  assert.equal((second.projects.db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok')
  second.projects.close()
})

test('trava de instância: a segunda aquisição falha com mensagem clara e volta a funcionar após liberar', () => {
  const lockFile = path.join(tempDir(), 'instance.lock')
  const lock = acquireInstanceLock(lockFile)
  assert.throws(() => acquireInstanceLock(lockFile), /Outra instância do AI Dev World já está usando estes dados/)
  lock.release()
  lock.release() // idempotente
  acquireInstanceLock(lockFile).release()
})

test('trava de instância entre processos: outro PID é recusado e a queda do dono (kill) libera a trava', async () => {
  const lockFile = path.join(tempDir(), 'instance.lock')
  const holder = child(`
    import { acquireInstanceLock } from ${JSON.stringify(MODULE)}
    acquireInstanceLock(${JSON.stringify(lockFile)})
    console.log('LOCKED')
    setInterval(() => {}, 1000)
  `)
  await waitFor(holder, 'LOCKED')
  assert.throws(() => acquireInstanceLock(lockFile), /Outra instância/)

  holder.kill('SIGKILL') // encerramento inesperado: nenhum código de limpeza roda
  await holder.output
  const lock = acquireInstanceLock(lockFile)
  lock.release()
})

test('escritas concorrentes de dois processos com busy_timeout: nenhuma se perde nem falha', async () => {
  const file = path.join(tempDir(), 'data.sqlite')
  const db = openDatabase(file)
  db.exec('CREATE TABLE rows (writer TEXT NOT NULL, n INTEGER NOT NULL)')
  db.close()
  const writer = (name: string) =>
    child(`
      import { openDatabase } from ${JSON.stringify(MODULE)}
      const db = openDatabase(${JSON.stringify(file)})
      const insert = db.prepare('INSERT INTO rows (writer, n) VALUES (?, ?)')
      for (let i = 0; i < 150; i++) {
        db.exec('BEGIN IMMEDIATE')
        insert.run(${JSON.stringify(name)}, i)
        // Segura a transação um pouco para forçar disputa pela trava de escrita.
        const until = Date.now() + 2; while (Date.now() < until) {}
        db.exec('COMMIT')
      }
      db.close()
      console.log('DONE')
    `)
  const results = await Promise.all([writer('a').output, writer('b').output])
  for (const r of results) assert.equal(r.code, 0, r.stderr)
  const check = openDatabase(file)
  const counts = check.prepare('SELECT writer, COUNT(*) AS c FROM rows GROUP BY writer ORDER BY writer').all()
  assert.deepEqual(counts.map((r) => [r.writer, r.c]), [['a', 150], ['b', 150]])
  check.close()
})

test('encerramento abrupto no meio da transação: o commit anterior fica, o pendente some e o banco segue íntegro', async () => {
  const file = path.join(tempDir(), 'data.sqlite')
  const db = openDatabase(file)
  db.exec('CREATE TABLE rows (v TEXT NOT NULL)')
  db.close()
  const crasher = child(`
    import { openDatabase } from ${JSON.stringify(MODULE)}
    const db = openDatabase(${JSON.stringify(file)})
    db.prepare('INSERT INTO rows (v) VALUES (?)').run('confirmado')
    db.exec('BEGIN IMMEDIATE')
    db.prepare('INSERT INTO rows (v) VALUES (?)').run('pendente')
    console.log('MIDWAY')
    setInterval(() => {}, 1000)
  `)
  await waitFor(crasher, 'MIDWAY')
  crasher.kill('SIGKILL')
  await crasher.output

  const reopened = openDatabase(file)
  assert.deepEqual(reopened.prepare('SELECT v FROM rows').all().map((r) => r.v), ['confirmado'])
  assert.equal((reopened.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok')
  reopened.close()
})

test('erro de banco ocupado vira mensagem legível; outros erros não são reescritos', () => {
  const file = path.join(tempDir(), 'data.sqlite')
  const a = new DatabaseSync(file)
  a.exec('CREATE TABLE t (v INTEGER)')
  const b = new DatabaseSync(file)
  b.exec('PRAGMA busy_timeout = 0')
  a.exec('BEGIN IMMEDIATE')
  let busy: unknown
  try {
    b.exec('BEGIN IMMEDIATE')
  } catch (error) {
    busy = error
  }
  a.exec('ROLLBACK')
  a.close()
  b.close()
  assert.ok(isBusyError(busy))
  assert.match(describeDatabaseError(busy)!, /banco de dados local está ocupado/)
  assert.equal(describeDatabaseError(new Error('outra coisa')), null)
})
