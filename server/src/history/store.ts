import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
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

// Padrões comuns de segredo. Não é perfeito: é uma rede de proteção para o que
// os agentes escrevem, não um motivo para colar segredos nas tarefas.
const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[SEGREDO REMOVIDO]'],
  [/\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, '[SEGREDO REMOVIDO]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[SEGREDO REMOVIDO]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[SEGREDO REMOVIDO]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[SEGREDO REMOVIDO]'],
  [/\bya29\.[0-9A-Za-z_-]{20,}/g, '[SEGREDO REMOVIDO]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[SEGREDO REMOVIDO]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[SEGREDO REMOVIDO]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [SEGREDO REMOVIDO]'],
  [/\b((?:password|passwd|pwd|senha|secret|token|api[_-]?key|client[_-]?secret)["']?\s*[:=]\s*)(["']?)[^\s"']{4,}\2/gi, '$1[SEGREDO REMOVIDO]'],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[SEGREDO REMOVIDO]@'],
]

/** Tira dos textos o que parece credencial, antes de gravar ou mostrar. */
export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text)
}

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
