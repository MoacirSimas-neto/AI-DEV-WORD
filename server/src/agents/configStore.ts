import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentConfig, AgentProfileId, ProviderId, ReasoningEffort } from '../../../shared/protocol.ts'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS agent_configs (
    agent_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`

export const DEFAULT_CONFIGS: Record<string, Omit<AgentConfig, 'updatedAt'>> = {
  architect: {
    agentId: 'architect',
    provider: 'gemini',
    model: 'auto',
    reasoningEffort: 'default',
  },
  dev: {
    agentId: 'dev',
    provider: 'codex',
    model: 'default',
    reasoningEffort: 'high',
  },
  qa: {
    agentId: 'qa',
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    reasoningEffort: 'default',
  },
  tutor: {
    agentId: 'tutor',
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    reasoningEffort: 'default',
  },
}

export const PROFILES: Record<AgentProfileId, Record<string, { provider: ProviderId; model: string; reasoningEffort: ReasoningEffort }>> = {
  economy: {
    architect: { provider: 'gemini', model: 'gemini-3.5-flash', reasoningEffort: 'default' },
    dev: { provider: 'codex', model: 'default', reasoningEffort: 'low' },
    qa: { provider: 'gemini', model: 'gemini-3.5-flash', reasoningEffort: 'default' },
    tutor: { provider: 'gemini', model: 'gemini-3.1-flash-lite', reasoningEffort: 'default' },
  },
  balanced: {
    architect: { provider: 'gemini', model: 'auto', reasoningEffort: 'default' },
    dev: { provider: 'codex', model: 'default', reasoningEffort: 'medium' },
    qa: { provider: 'gemini', model: 'auto', reasoningEffort: 'default' },
    tutor: { provider: 'gemini', model: 'gemini-3.5-flash', reasoningEffort: 'default' },
  },
  max_quality: {
    architect: { provider: 'gemini', model: 'gemini-2.5-pro', reasoningEffort: 'default' },
    dev: { provider: 'codex', model: 'default', reasoningEffort: 'high' },
    qa: { provider: 'gemini', model: 'gemini-2.5-pro', reasoningEffort: 'default' },
    tutor: { provider: 'gemini', model: 'gemini-2.5-pro', reasoningEffort: 'default' },
  },
}

/**
 * Persistência local e independente de preferências dos agentes em SQLite.
 * Nunca armazena senhas, tokens ou credenciais.
 */
export class AgentConfigStore extends EventEmitter {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    super()
    this.db = db
    this.db.exec(SCHEMA)
    this.ensureDefaults()
  }

  private ensureDefaults() {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO agent_configs (agent_id, provider, model, reasoning_effort, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    for (const def of Object.values(DEFAULT_CONFIGS)) {
      stmt.run(def.agentId, def.provider, def.model, def.reasoningEffort, now)
    }
  }

  list(): AgentConfig[] {
    const rows = this.db
      .prepare('SELECT agent_id AS agentId, provider, model, reasoning_effort AS reasoningEffort, updated_at AS updatedAt FROM agent_configs')
      .all()
    return rows.map((r) => ({ ...r }) as unknown as AgentConfig)
  }

  get(agentId: string): AgentConfig {
    const row = this.db
      .prepare(
        'SELECT agent_id AS agentId, provider, model, reasoning_effort AS reasoningEffort, updated_at AS updatedAt FROM agent_configs WHERE agent_id = ?',
      )
      .get(agentId)
    if (row) return { ...row } as unknown as AgentConfig

    const def = DEFAULT_CONFIGS[agentId] ?? {
      agentId,
      provider: 'gemini' as ProviderId,
      model: 'auto',
      reasoningEffort: 'default' as ReasoningEffort,
    }
    return { ...def, updatedAt: new Date().toISOString() }
  }

  set(
    agentId: string,
    patch: { provider: ProviderId; model: string; reasoningEffort: ReasoningEffort },
  ): AgentConfig {
    const now = new Date().toISOString()
    const cleanModel = patch.model.trim().slice(0, 100) || 'default'
    this.db
      .prepare(
        `INSERT INTO agent_configs (agent_id, provider, model, reasoning_effort, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(agent_id) DO UPDATE SET
           provider = excluded.provider,
           model = excluded.model,
           reasoning_effort = excluded.reasoning_effort,
           updated_at = excluded.updated_at`,
      )
      .run(agentId, patch.provider, cleanModel, patch.reasoningEffort, now)

    const updated = this.get(agentId)
    this.emit('change', this.list())
    return updated
  }

  applyProfile(profileId: AgentProfileId): AgentConfig[] {
    const prof = PROFILES[profileId]
    if (!prof) throw new Error(`Perfil desconhecido: ${profileId}`)

    const now = new Date().toISOString()
    const stmt = this.db.prepare(
      `INSERT INTO agent_configs (agent_id, provider, model, reasoning_effort, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET
         provider = excluded.provider,
         model = excluded.model,
         reasoning_effort = excluded.reasoning_effort,
         updated_at = excluded.updated_at`,
    )
    for (const [agentId, cfg] of Object.entries(prof)) {
      stmt.run(agentId, cfg.provider, cfg.model, cfg.reasoningEffort, now)
    }
    const list = this.list()
    this.emit('change', list)
    return list
  }

  resetDefaults(): AgentConfig[] {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(
      `INSERT INTO agent_configs (agent_id, provider, model, reasoning_effort, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET
         provider = excluded.provider,
         model = excluded.model,
         reasoning_effort = excluded.reasoning_effort,
         updated_at = excluded.updated_at`,
    )
    for (const def of Object.values(DEFAULT_CONFIGS)) {
      stmt.run(def.agentId, def.provider, def.model, def.reasoningEffort, now)
    }
    const list = this.list()
    this.emit('change', list)
    return list
  }
}
