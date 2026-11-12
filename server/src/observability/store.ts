import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import type { EvidenceKind, MissionEvent, MissionEventState, MissionEventType } from '../../../shared/protocol.ts'
import { cleanOutput } from '../history/store.ts'

// Tabela nova e independente: bancos antigos ganham a tabela vazia e as missões antigas seguem sem eventos.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS mission_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    mission_id INTEGER NOT NULL,
    task_id INTEGER,
    agent_id TEXT,
    type TEXT NOT NULL,
    at TEXT NOT NULL,
    state TEXT NOT NULL,
    evidence TEXT NOT NULL,
    summary TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    correlation_id TEXT,
    dedupe_key TEXT
  );
  CREATE INDEX IF NOT EXISTS mission_events_by_mission ON mission_events (project_id, mission_id, id);
  CREATE UNIQUE INDEX IF NOT EXISTS mission_events_dedupe ON mission_events (mission_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL;
`

const COLUMNS = `id, project_id AS projectId, mission_id AS missionId, task_id AS taskId, agent_id AS agentId,
  type, at, state, evidence, summary, data, correlation_id AS correlationId`

export const MAX_EVENTS_PER_MISSION = 1000
/** Missões com eventos guardadas por projeto; as mais antigas perdem a trilha (a missão em si continua). */
export const MAX_MISSIONS_WITH_EVENTS = 200
const MAX_SUMMARY = 500
const MAX_STRING = 500
const MAX_ITEMS = 100
const MAX_DATA_JSON = 16_000
const LIST_LIMIT = 1000

const EVIDENCE = new Set<EvidenceKind>(['observed', 'declared', 'context', 'unavailable'])
const STATES = new Set<MissionEventState>(['started', 'completed', 'failed', 'cancelled', 'info'])
const TYPE_PATTERN = /^[a-z]+\.[a-z_]+$/
const ID_PATTERN = /^[\w.:-]{1,80}$/
const SECRET_KEY = /pass(word|wd)?|senha|secret|token|api[_-]?key|authorization|credential|cookie/i
const REMOVED = '[SEGREDO REMOVIDO]'

const isId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0

/** Tamanho e hash de um texto: referência verificável sem copiar o conteúdo. */
export function fingerprint(text: string) {
  return { chars: text.length, sha256: createHash('sha256').update(text).digest('hex').slice(0, 16) }
}

/** Metadados prontos para gravar: sem segredos, sem controles de terminal, com profundidade e tamanho limitados. */
export function sanitizeData(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return cleanOutput(value).slice(0, MAX_STRING)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean' || value === null) return value
  if (typeof value !== 'object' || depth >= 4) return null
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => sanitizeData(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value).slice(0, MAX_ITEMS)) {
    if (v === undefined) continue
    out[key.slice(0, 60)] = SECRET_KEY.test(key) ? REMOVED : sanitizeData(v, depth + 1)
  }
  return out
}

export interface NewMissionEvent {
  projectId: number
  missionId: number
  type: MissionEventType
  evidence: EvidenceKind
  summary: string
  state?: MissionEventState
  taskId?: number | null
  agentId?: string | null
  data?: Record<string, unknown>
  correlationId?: string | null
  /** Mesma chave na mesma missão = mesmo fato: a repetição não cria outro evento. */
  dedupeKey?: string
}

export interface EventQuery {
  /** Obrigatório: nenhuma consulta atravessa projetos. */
  projectId: number
  missionId?: number
  afterId?: number
  limit?: number
}

const toEvent = (row: Record<string, unknown>): MissionEvent => {
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(String(row.data)) as Record<string, unknown>
  } catch {}
  return { ...row, data } as unknown as MissionEvent
}

/**
 * Trilha estruturada das missões: só fatos que o backend registrou, cada um com a origem
 * da evidência. Emite 'added' (MissionEvent) a cada evento novo.
 */
export class EventStore extends EventEmitter {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    super()
    this.db = db
    this.db.exec(SCHEMA)
  }

  /**
   * Grava um evento. Nunca lança: observabilidade não pode derrubar uma missão.
   * Devolve null para evento malformado ou acima do limite, e o evento já gravado quando é repetição.
   */
  record(input: NewMissionEvent): MissionEvent | null {
    try {
      if (!isId(input?.projectId) || !isId(input.missionId)) return null
      if (typeof input.type !== 'string' || !TYPE_PATTERN.test(input.type)) return null
      if (!EVIDENCE.has(input.evidence) || typeof input.summary !== 'string') return null
      const state = input.state ?? 'info'
      if (!STATES.has(state)) return null
      const taskId = isId(input.taskId) ? input.taskId : null
      const agentId = typeof input.agentId === 'string' && ID_PATTERN.test(input.agentId) ? input.agentId : null
      const correlationId = typeof input.correlationId === 'string' && ID_PATTERN.test(input.correlationId) ? input.correlationId : null
      const dedupeKey = typeof input.dedupeKey === 'string' ? input.dedupeKey.slice(0, 200) : null

      const count = Number(this.db.prepare('SELECT COUNT(*) AS n FROM mission_events WHERE mission_id = ?').get(input.missionId)!.n)
      // O próprio aviso de limite passa (uma vez só, pela chave de repetição).
      if (count >= MAX_EVENTS_PER_MISSION && input.type !== 'log.truncated') {
        this.record({
          projectId: input.projectId,
          missionId: input.missionId,
          type: 'log.truncated',
          evidence: 'observed',
          summary: `Limite de ${MAX_EVENTS_PER_MISSION} eventos da missão atingido: os eventos seguintes não foram gravados.`,
          dedupeKey: 'log.truncated',
        })
        return null
      }

      let data = JSON.stringify(sanitizeData(input.data ?? {}))
      if (data.length > MAX_DATA_JSON) data = JSON.stringify({ truncated: true, chars: data.length })
      const result = this.db
        .prepare(
          `INSERT OR IGNORE INTO mission_events
             (project_id, mission_id, task_id, agent_id, type, at, state, evidence, summary, data, correlation_id, dedupe_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.projectId,
          input.missionId,
          taskId,
          agentId,
          input.type,
          new Date().toISOString(),
          state,
          input.evidence,
          cleanOutput(input.summary).slice(0, MAX_SUMMARY),
          data,
          correlationId,
          dedupeKey,
        )
      if (result.changes === 0) {
        const existing = this.db
          .prepare(`SELECT ${COLUMNS} FROM mission_events WHERE mission_id = ? AND dedupe_key = ?`)
          .get(input.missionId, dedupeKey)
        return existing ? toEvent(existing) : null
      }
      const event = toEvent(this.db.prepare(`SELECT ${COLUMNS} FROM mission_events WHERE id = ?`).get(result.lastInsertRowid)!)
      this.emit('added', event)
      return event
    } catch {
      return null
    }
  }

  /** Em ordem de id (a ordem em que os fatos foram registrados). */
  list(query: EventQuery): MissionEvent[] {
    if (!isId(query?.projectId)) return []
    const where = ['project_id = ?']
    const params: number[] = [query.projectId]
    if (query.missionId !== undefined) {
      if (!isId(query.missionId)) return []
      where.push('mission_id = ?')
      params.push(query.missionId)
    }
    if (isId(query.afterId)) {
      where.push('id > ?')
      params.push(query.afterId)
    }
    const limit = isId(query.limit) ? Math.min(query.limit, LIST_LIMIT) : LIST_LIMIT
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM mission_events WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`)
      .all(...params, limit)
      .map(toEvent)
  }

  /** Retenção: guarda a trilha das missões mais recentes do projeto. */
  prune(projectId: number, keepMissions = MAX_MISSIONS_WITH_EVENTS) {
    this.db
      .prepare(
        `DELETE FROM mission_events WHERE project_id = ? AND mission_id NOT IN
           (SELECT DISTINCT mission_id FROM mission_events WHERE project_id = ? ORDER BY mission_id DESC LIMIT ?)`,
      )
      .run(projectId, projectId, keepMissions)
  }
}
