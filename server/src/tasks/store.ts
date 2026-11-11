import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import type { MissionInfo, MissionPhase, TaskInfo, TaskInput, TaskStatus } from '../../../shared/protocol.ts'
import type { HistoryStore } from '../history/store.ts'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL,
    status TEXT NOT NULL,
    agent_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS missions (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    phase TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT '',
    dev_report TEXT NOT NULL DEFAULT '',
    review TEXT NOT NULL DEFAULT '',
    verdict TEXT,
    files TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  -- O próprio banco impede duas missões abertas para a mesma tarefa.
  CREATE UNIQUE INDEX IF NOT EXISTS missions_one_open_per_task ON missions (task_id)
    WHERE phase IN ('planning', 'awaiting_approval', 'developing', 'reviewing');
`

export const OPEN_PHASES: MissionPhase[] = ['planning', 'awaiting_approval', 'developing', 'reviewing']
/** Fases em que um processo de CLI está rodando (não sobrevivem a um reinício). */
const RUNNING_PHASES = "('planning', 'developing', 'reviewing')"

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'A fazer',
  doing: 'Em andamento',
  review: 'Em revisão',
  done: 'Concluída',
}

const TASK_COLUMNS = `id, project_id AS projectId, title, description, priority, status, agent_id AS agentId,
  created_at AS createdAt, updated_at AS updatedAt`
const MISSION_COLUMNS = `id, task_id AS taskId, project_id AS projectId, phase, plan, dev_report AS devReport,
  review, verdict, files, error, created_at AS createdAt, updated_at AS updatedAt`

type MissionPatch = Partial<Pick<MissionInfo, 'phase' | 'plan' | 'devReport' | 'review' | 'verdict' | 'files' | 'error'>>
const MISSION_FIELDS: Record<keyof MissionPatch, string> = {
  phase: 'phase',
  plan: 'plan',
  devReport: 'dev_report',
  review: 'review',
  verdict: 'verdict',
  files: 'files',
  error: 'error',
}

const toMission = (row: Record<string, unknown>): MissionInfo =>
  ({ ...row, files: JSON.parse(String(row.files)) }) as unknown as MissionInfo

/**
 * Tarefas e missões do modo equipe, no mesmo SQLite dos projetos.
 * Toda mudança de tarefa vira uma linha no histórico.
 * Emite 'tasks' e 'missions' quando as listas mudam.
 */
export class TaskStore extends EventEmitter {
  private readonly db: DatabaseSync
  private readonly history: HistoryStore

  constructor(db: DatabaseSync, history: HistoryStore) {
    super()
    this.db = db
    this.history = history
    this.db.exec(SCHEMA)
  }

  list(): TaskInfo[] {
    return this.db
      .prepare(`SELECT ${TASK_COLUMNS} FROM tasks ORDER BY id DESC`)
      .all()
      .map((row) => ({ ...row }) as unknown as TaskInfo)
  }

  get(taskId: number): TaskInfo | null {
    const row = this.db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`).get(taskId)
    return row ? ({ ...row } as unknown as TaskInfo) : null
  }

  create(projectId: number, input: TaskInput): TaskInfo {
    const task = normalize(input)
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO tasks (project_id, title, description, priority, status, agent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(projectId, task.title, task.description, task.priority, task.status, task.agentId, now, now)
    const created = this.get(Number(result.lastInsertRowid))!
    this.history.add({ kind: 'task', message: `Tarefa criada: "${created.title}"`, projectId, taskId: created.id })
    this.emit('tasks')
    return created
  }

  update(taskId: number, input: TaskInput): TaskInfo {
    const before = this.require(taskId)
    const task = normalize(input)
    this.db
      .prepare(
        'UPDATE tasks SET title = ?, description = ?, priority = ?, status = ?, agent_id = ?, updated_at = ? WHERE id = ?',
      )
      .run(task.title, task.description, task.priority, task.status, task.agentId, new Date().toISOString(), taskId)
    const after = this.get(taskId)!
    const fieldsChanged = (['title', 'description', 'priority', 'agentId'] as const).some((k) => before[k] !== after[k])
    if (fieldsChanged) {
      this.history.add({ kind: 'task', message: `Tarefa editada: "${after.title}"`, projectId: after.projectId, taskId })
    }
    if (before.status !== after.status) this.logStatus(after, before.status)
    this.emit('tasks')
    return after
  }

  setStatus(taskId: number, status: TaskStatus) {
    const before = this.require(taskId)
    if (before.status === status) return
    this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), taskId)
    this.logStatus({ ...before, status }, before.status)
    this.emit('tasks')
  }

  delete(taskId: number) {
    const task = this.require(taskId)
    if (this.openMissions().some((m) => m.taskId === taskId)) {
      throw new Error('Esta tarefa tem uma missão em andamento. Cancele a missão antes de excluir.')
    }
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
    this.history.add({ kind: 'task', message: `Tarefa excluída: "${task.title}"`, projectId: task.projectId, taskId })
    this.emit('tasks')
  }

  // ---------- missões ----------

  /** Mais recentes primeiro. */
  listMissions(limit = 30): MissionInfo[] {
    return this.db.prepare(`SELECT ${MISSION_COLUMNS} FROM missions ORDER BY id DESC LIMIT ?`).all(limit).map(toMission)
  }

  getMission(missionId: number): MissionInfo | null {
    const row = this.db.prepare(`SELECT ${MISSION_COLUMNS} FROM missions WHERE id = ?`).get(missionId)
    return row ? toMission(row) : null
  }

  openMissions(): MissionInfo[] {
    return this.db
      .prepare(`SELECT ${MISSION_COLUMNS} FROM missions WHERE phase IN (${OPEN_PHASES.map(() => '?').join(', ')})`)
      .all(...OPEN_PHASES)
      .map(toMission)
  }

  createMission(taskId: number, projectId: number): MissionInfo {
    const now = new Date().toISOString()
    try {
      const result = this.db
        .prepare('INSERT INTO missions (task_id, project_id, phase, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(taskId, projectId, 'planning', now, now)
      this.emit('missions')
      return this.getMission(Number(result.lastInsertRowid))!
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error('Esta tarefa já tem uma missão em andamento.')
      throw error
    }
  }

  updateMission(missionId: number, patch: MissionPatch): MissionInfo {
    const keys = Object.keys(patch) as (keyof MissionPatch)[]
    const values = keys.map((k) => (k === 'files' ? JSON.stringify(patch.files) : (patch[k] as string | null)))
    this.db
      .prepare(`UPDATE missions SET ${keys.map((k) => `${MISSION_FIELDS[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...values, new Date().toISOString(), missionId)
    this.emit('missions')
    return this.getMission(missionId)!
  }

  /** Na inicialização: missões que tinham um CLI rodando morreram com o app anterior. */
  failInterrupted(): MissionInfo[] {
    const lost = this.db
      .prepare(`SELECT ${MISSION_COLUMNS} FROM missions WHERE phase IN ${RUNNING_PHASES}`)
      .all()
      .map(toMission)
    return lost.map((mission) =>
      this.updateMission(mission.id, { phase: 'failed', error: 'Interrompida: o app foi fechado durante a execução.' }),
    )
  }

  private require(taskId: number): TaskInfo {
    const task = this.get(taskId)
    if (!task) throw new Error('Tarefa não encontrada.')
    return task
  }

  private logStatus(task: TaskInfo, from: TaskStatus) {
    const message =
      task.status === 'done'
        ? `Tarefa concluída: "${task.title}"`
        : `Tarefa "${task.title}": ${STATUS_LABEL[from]} → ${STATUS_LABEL[task.status]}`
    this.history.add({ kind: 'status', message, projectId: task.projectId, taskId: task.id })
  }
}

function normalize(input: TaskInput): TaskInput {
  const title = input.title.trim()
  if (!title) throw new Error('Dê um título para a tarefa.')
  return { ...input, title, description: input.description.trim() }
}
