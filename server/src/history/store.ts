import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import { redact } from '../security/redact.ts'
import type { ActivityEntry, ActivityKind } from '../../../shared/protocol.ts'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    project_id INTEGER,
    task_id INTEGER,
    mission_id INTEGER,
    agent_id TEXT
  );
`

const MAX_MESSAGE = 4000
const LIST_LIMIT = 200

// A redação vive em security/redact.ts (mesma detecção para texto gravado e saída ao vivo).
export { redact }

// Sequências de cor/cursor do terminal (ESC [ ... letra) e outros controles, exceto \t \n \r.
const ANSI = new RegExp(String.raw`\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]`, 'g')

/** Saída de CLI pronta para mostrar como texto simples. */
export function cleanOutput(text: string): string {
  return redact(text.replace(ANSI, ''))
}

export interface NewActivity {
  kind: ActivityKind
  message: string
  projectId?: number | null
  taskId?: number | null
  missionId?: number | null
  agentId?: string | null
}

/** Histórico persistente. Emite 'added' (ActivityEntry) a cada registro. */
export class HistoryStore extends EventEmitter {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    super()
    this.db = db
    this.db.exec(SCHEMA)
  }

  add(entry: NewActivity): ActivityEntry {
    const row: ActivityEntry = {
      id: 0,
      at: new Date().toISOString(),
      kind: entry.kind,
      message: redact(entry.message).slice(0, MAX_MESSAGE),
      projectId: entry.projectId ?? null,
      taskId: entry.taskId ?? null,
      missionId: entry.missionId ?? null,
      agentId: entry.agentId ?? null,
    }
    const result = this.db
      .prepare(
        'INSERT INTO activity (at, kind, message, project_id, task_id, mission_id, agent_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(row.at, row.kind, row.message, row.projectId, row.taskId, row.missionId, row.agentId)
    row.id = Number(result.lastInsertRowid)
    this.emit('added', row)
    return row
  }

  /** Mais recentes primeiro. */
  list(limit = LIST_LIMIT): ActivityEntry[] {
    return this.db
      .prepare(
        `SELECT id, at, kind, message, project_id AS projectId, task_id AS taskId,
                mission_id AS missionId, agent_id AS agentId
         FROM activity ORDER BY id DESC LIMIT ?`,
      )
      .all(limit)
      .map((row) => ({ ...row }) as unknown as ActivityEntry)
  }
}
