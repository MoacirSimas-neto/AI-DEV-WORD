import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AgentConfig,
  AgentProfileId,
  AvatarPreset,
  CustomAgentInput,
  CustomAgentPatch,
  ProviderId,
  ReasoningEffort,
  RoleCategory,
  SpecializationId,
  SpecializationInfo,
} from '../../../shared/protocol.ts'
import { redact } from '../history/store.ts'
import { defaultSpecializations, type SpecializationRegistry } from './specializations.ts'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS agent_configs (
    agent_id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    role_category TEXT NOT NULL DEFAULT 'developing',
    specialization_id TEXT NOT NULL DEFAULT 'developer',
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    custom_instructions TEXT NOT NULL DEFAULT '',
    avatar_preset TEXT NOT NULL DEFAULT 'dev',
    active INTEGER NOT NULL DEFAULT 1,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
`

const EXTRA_COLUMNS: [string, string][] = [
  ['name', "TEXT NOT NULL DEFAULT ''"],
  ['role', "TEXT NOT NULL DEFAULT ''"],
  ['description', "TEXT NOT NULL DEFAULT ''"],
  ['role_category', "TEXT NOT NULL DEFAULT 'developing'"],
  ['specialization_id', "TEXT NOT NULL DEFAULT 'developer'"],
  ['custom_instructions', "TEXT NOT NULL DEFAULT ''"],
  ['avatar_preset', "TEXT NOT NULL DEFAULT 'dev'"],
  ['active', 'INTEGER NOT NULL DEFAULT 1'],
  ['is_builtin', 'INTEGER NOT NULL DEFAULT 0'],
  ['created_at', "TEXT NOT NULL DEFAULT ''"],
]

const VALID_PROVIDERS = new Set<ProviderId>(['antigravity', 'codex', 'gemini'])
const VALID_EFFORTS = new Set<ReasoningEffort>(['default', 'low', 'medium', 'high', 'extra-high'])
const VALID_CATEGORIES = new Set<RoleCategory>(['planning', 'developing', 'reviewing', 'teaching'])
const VALID_AVATARS = new Set<AvatarPreset>([
  'architect',
  'dev',
  'qa',
  'tutor',
  'designer',
  'data',
  'security',
  'docs',
  'specialist',
])
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,39}$/
export const MAX_INSTRUCTIONS_LEN = 4000

export const BUILTIN_AGENT_IDS = new Set(['architect', 'dev', 'qa', 'tutor'])

export const DEFAULT_CONFIGS: Record<string, Omit<AgentConfig, 'updatedAt' | 'createdAt'>> = {
  architect: {
    agentId: 'architect',
    name: 'Arquiteto',
    role: 'Planeja a solução',
    description: 'Líder técnico responsável por arquitetura, análise de alternativas e planejamento.',
    roleCategory: 'planning',
    specializationId: 'tech-lead',
    provider: 'antigravity',
    model: 'gemini-4-argon-high',
    reasoningEffort: 'high',
    customInstructions: '',
    avatarPreset: 'architect',
    active: true,
    isBuiltin: true,
  },
  dev: {
    agentId: 'dev',
    name: 'Dev',
    role: 'Implementa o código',
    description: 'Desenvolvedor pragmático encarregado da implementação, refatoração e testes.',
    roleCategory: 'developing',
    specializationId: 'developer',
    provider: 'codex',
    model: 'default',
    reasoningEffort: 'high',
    customInstructions: '',
    avatarPreset: 'dev',
    active: true,
    isBuiltin: true,
  },
  qa: {
    agentId: 'qa',
    name: 'QA',
    role: 'Revisa e testa',
    description: 'Engenheiro de qualidade dedicado à investigação de defeitos, riscos e validação independente.',
    roleCategory: 'reviewing',
    specializationId: 'qa-tester',
    provider: 'antigravity',
    model: 'gemini-4-argon-high',
    reasoningEffort: 'high',
    customInstructions: '',
    avatarPreset: 'qa',
    active: true,
    isBuiltin: true,
  },
  tutor: {
    agentId: 'tutor',
    name: 'Tutor',
    role: 'Explica e ensina',
    description: 'Mentor técnico para estudo guiado, raciocínio progressivo e explicação do código.',
    roleCategory: 'teaching',
    specializationId: 'tutor',
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    reasoningEffort: 'default',
    customInstructions: '',
    avatarPreset: 'tutor',
    active: true,
    isBuiltin: true,
  },
}

export const PROFILES: Record<
  AgentProfileId,
  Record<string, { provider: ProviderId; model: string; reasoningEffort: ReasoningEffort }>
> = {
  economy: {
    architect: { provider: 'antigravity', model: 'gemini-3.8-flash-low', reasoningEffort: 'low' },
    dev: { provider: 'codex', model: 'default', reasoningEffort: 'low' },
    qa: { provider: 'antigravity', model: 'gemini-3.8-flash-low', reasoningEffort: 'low' },
    tutor: { provider: 'gemini', model: 'gemini-3.1-flash-lite', reasoningEffort: 'default' },
  },
  balanced: {
    architect: { provider: 'antigravity', model: 'gemini-4-argon-medium', reasoningEffort: 'medium' },
    dev: { provider: 'codex', model: 'default', reasoningEffort: 'medium' },
    qa: { provider: 'antigravity', model: 'gemini-4-argon-medium', reasoningEffort: 'medium' },
    tutor: { provider: 'gemini', model: 'gemini-3.5-flash', reasoningEffort: 'default' },
  },
  max_quality: {
    architect: { provider: 'antigravity', model: 'gemini-4-argon-high', reasoningEffort: 'high' },
    dev: { provider: 'codex', model: 'default', reasoningEffort: 'high' },
    qa: { provider: 'antigravity', model: 'gemini-4-argon-high', reasoningEffort: 'high' },
    tutor: { provider: 'gemini', model: 'gemini-2.5-pro', reasoningEffort: 'default' },
  },
}

const SELECT_COLUMNS = `
  agent_id AS agentId,
  name,
  role,
  description,
  role_category AS roleCategory,
  specialization_id AS specializationId,
  provider,
  model,
  reasoning_effort AS reasoningEffort,
  custom_instructions AS customInstructions,
  avatar_preset AS avatarPreset,
  active,
  is_builtin AS isBuiltin,
  created_at AS createdAt,
  updated_at AS updatedAt
`

export function slugifyAgentId(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * Persistência local e independente de perfis e configurações dos agentes em SQLite.
 * Nunca armazena senhas, tokens ou credenciais.
 */
export class AgentConfigStore extends EventEmitter {
  private readonly db: DatabaseSync
  private readonly specializations: SpecializationRegistry

  constructor(db: DatabaseSync, specializations: SpecializationRegistry = defaultSpecializations) {
    super()
    this.db = db
    this.specializations = specializations
    this.db.exec(SCHEMA)
    this.migrate()
    this.ensureDefaults()
  }

  /** Migração incremental e idempotente para bancos existentes sem perda de dados. */
  private migrate() {
    const info = this.db.prepare('PRAGMA table_info(agent_configs)').all() as { name: string }[]
    const existingCols = new Set(info.map((c) => c.name))

    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const [col, def] of EXTRA_COLUMNS) {
        if (!existingCols.has(col)) {
          this.db.exec(`ALTER TABLE agent_configs ADD COLUMN ${col} ${def}`)
        }
      }

      // Preenche metadados dos 4 agentes padrão em bancos legados preservando provider/model/effort
      const updateBuiltinMeta = this.db.prepare(`
        UPDATE agent_configs
        SET
          name = CASE WHEN name = '' THEN ? ELSE name END,
          role = CASE WHEN role = '' THEN ? ELSE role END,
          description = CASE WHEN description = '' THEN ? ELSE description END,
          role_category = ?,
          specialization_id = CASE WHEN specialization_id = '' OR specialization_id = 'developer' THEN ? ELSE specialization_id END,
          avatar_preset = ?,
          is_builtin = 1,
          active = 1,
          created_at = CASE WHEN created_at = '' THEN updated_at ELSE created_at END
        WHERE agent_id = ?
      `)

      for (const def of Object.values(DEFAULT_CONFIGS)) {
        updateBuiltinMeta.run(
          def.name!,
          def.role!,
          def.description!,
          def.roleCategory!,
          def.specializationId!,
          def.avatarPreset!,
          def.agentId,
        )
      }

      this.db.exec(`UPDATE agent_configs SET created_at = updated_at WHERE created_at = ''`)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private ensureDefaults() {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO agent_configs (
        agent_id, name, role, description, role_category, specialization_id,
        provider, model, reasoning_effort, custom_instructions, avatar_preset,
        active, is_builtin, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
    `)
    for (const def of Object.values(DEFAULT_CONFIGS)) {
      stmt.run(
        def.agentId,
        def.name!,
        def.role!,
        def.description!,
        def.roleCategory!,
        def.specializationId!,
        def.provider,
        def.model,
        def.reasoningEffort,
        def.customInstructions ?? '',
        def.avatarPreset!,
        now,
        now,
      )
    }
  }

  private toAgentConfig(row: Record<string, unknown>): AgentConfig {
    const roleCategory: RoleCategory = VALID_CATEGORIES.has(row.roleCategory as RoleCategory)
      ? (row.roleCategory as RoleCategory)
      : 'developing'
    const rawSpec = String(row.specializationId ?? '')
    const specializationId: SpecializationId = this.specializations.hasSpecialization(rawSpec)
      ? rawSpec
      : this.specializations.defaultForCategory(roleCategory)
    const avatarPreset: AvatarPreset = VALID_AVATARS.has(row.avatarPreset as AvatarPreset)
      ? (row.avatarPreset as AvatarPreset)
      : 'dev'

    return {
      agentId: String(row.agentId),
      name: String(row.name || row.agentId),
      role: String(row.role || ''),
      description: String(row.description || ''),
      roleCategory,
      specializationId,
      provider: (VALID_PROVIDERS.has(row.provider as ProviderId) ? row.provider : 'gemini') as ProviderId,
      model: String(row.model || 'default'),
      reasoningEffort: (VALID_EFFORTS.has(row.reasoningEffort as ReasoningEffort)
        ? row.reasoningEffort
        : 'default') as ReasoningEffort,
      customInstructions: String(row.customInstructions || ''),
      avatarPreset,
      active: Boolean(row.active),
      isBuiltin: Boolean(row.isBuiltin) || BUILTIN_AGENT_IDS.has(String(row.agentId)),
      createdAt: String(row.createdAt || row.updatedAt || ''),
      updatedAt: String(row.updatedAt || ''),
    }
  }

  /** Lista agentes configurados (por padrão apenas ativos; passe `includeInactive: true` para todos). */
  list(options?: { includeInactive?: boolean }): AgentConfig[] {
    const includeInactive = options?.includeInactive ?? false
    const where = includeInactive ? '' : 'WHERE active = 1'
    const rows = this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM agent_configs ${where} ORDER BY is_builtin DESC, created_at ASC, agent_id ASC`)
      .all() as Record<string, unknown>[]
    return rows.map((r) => this.toAgentConfig(r))
  }

  /** Retorna o perfil/configuração do agente se existir no banco, ou null. */
  find(agentId: string): AgentConfig | null {
    const row = this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM agent_configs WHERE agent_id = ?`)
      .get(agentId) as Record<string, unknown> | undefined
    return row ? this.toAgentConfig(row) : null
  }

  /** Consulta agente por ID (retorna fallback se não cadastrado para preservar compatibilidade). */
  get(agentId: string): AgentConfig {
    const found = this.find(agentId)
    if (found) return found

    const now = new Date().toISOString()
    const def = DEFAULT_CONFIGS[agentId] ?? {
      agentId,
      name: agentId,
      role: 'Agente personalizado',
      description: '',
      roleCategory: 'developing' as RoleCategory,
      specializationId: 'developer' as SpecializationId,
      provider: 'gemini' as ProviderId,
      model: 'auto',
      reasoningEffort: 'default' as ReasoningEffort,
      customInstructions: '',
      avatarPreset: 'dev' as AvatarPreset,
      active: true,
      isBuiltin: false,
    }
    return { ...def, createdAt: now, updatedAt: now }
  }

  /** Consulta a especialização associada a um agente. */
  getSpecialization(agentId: string): SpecializationInfo {
    const cfg = this.get(agentId)
    const specId = cfg.specializationId ?? this.specializations.resolveId(agentId)
    return this.specializations.getInfo(specId)
  }

  /** Cria um novo agente personalizado no SQLite com validação completa. */
  createAgent(input: CustomAgentInput): AgentConfig {
    const name = (input.name ?? '').trim().slice(0, 60)
    if (!name) throw new Error('Informe um nome válido para o agente.')

    const role = (input.role ?? '').trim().slice(0, 80)
    if (!role) throw new Error('Informe a função (role) do agente.')

    const id = (input.id ? input.id.trim().toLowerCase() : slugifyAgentId(name))
    if (!id || !ID_PATTERN.test(id)) {
      throw new Error('ID do agente inválido. Use de 2 a 40 caracteres (letras minúsculas, números, hífen ou sublinhado).')
    }
    if (BUILTIN_AGENT_IDS.has(id) || this.find(id)) {
      throw new Error(`Já existe um agente cadastrado com o ID "${id}".`)
    }

    if (!VALID_CATEGORIES.has(input.roleCategory)) {
      throw new Error(`Categoria de atuação inválida: "${String(input.roleCategory)}".`)
    }
    if (!this.specializations.hasSpecialization(input.specializationId)) {
      throw new Error(`Especialização desconhecida: "${String(input.specializationId)}".`)
    }
    if (!VALID_PROVIDERS.has(input.provider)) {
      throw new Error(`Provedor CLI inválido: "${String(input.provider)}".`)
    }

    const effort: ReasoningEffort = input.reasoningEffort ?? 'default'
    if (!VALID_EFFORTS.has(effort)) {
      throw new Error(`Esforço de raciocínio inválido: "${String(effort)}".`)
    }

    const avatarPreset: AvatarPreset = input.avatarPreset ?? this.defaultAvatarForCategory(input.roleCategory)
    if (!VALID_AVATARS.has(avatarPreset)) {
      throw new Error(`Preset visual inválido: "${String(avatarPreset)}".`)
    }

    const model = (input.model ?? 'default').trim().slice(0, 100) || 'default'
    const description = (input.description ?? '').trim().slice(0, 300)
    const customInstructions = redact((input.customInstructions ?? '').trim()).slice(0, MAX_INSTRUCTIONS_LEN)
    const active = input.active !== false ? 1 : 0
    const now = new Date().toISOString()

    this.db
      .prepare(`
        INSERT INTO agent_configs (
          agent_id, name, role, description, role_category, specialization_id,
          provider, model, reasoning_effort, custom_instructions, avatar_preset,
          active, is_builtin, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `)
      .run(
        id,
        name,
        role,
        description,
        input.roleCategory,
        input.specializationId,
        input.provider,
        model,
        effort,
        customInstructions,
        avatarPreset,
        active,
        now,
        now,
      )

    const created = this.find(id)!
    this.emit('change', this.list())
    return created
  }

  /** Atualiza o perfil de um agente existente respeitando as proteções dos agentes padrão. */
  updateAgent(agentId: string, patch: CustomAgentPatch): AgentConfig {
    const current = this.find(agentId)
    if (!current) throw new Error(`Agente não encontrado: "${agentId}".`)

    const isBuiltin = current.isBuiltin || BUILTIN_AGENT_IDS.has(agentId)
    if (isBuiltin) {
      if (patch.active === false) {
        throw new Error('Agentes padrão não podem ser desativados.')
      }
      if (patch.roleCategory && patch.roleCategory !== current.roleCategory) {
        throw new Error('A categoria principal de um agente padrão não pode ser alterada.')
      }
    }

    const name = patch.name !== undefined ? patch.name.trim().slice(0, 60) : current.name!
    if (!name) throw new Error('O nome do agente não pode ficar vazio.')

    const role = patch.role !== undefined ? patch.role.trim().slice(0, 80) : current.role!
    if (!role) throw new Error('A função (role) do agente não pode ficar vazia.')

    const roleCategory = patch.roleCategory ?? current.roleCategory!
    if (!VALID_CATEGORIES.has(roleCategory)) {
      throw new Error(`Categoria de atuação inválida: "${String(roleCategory)}".`)
    }

    const specializationId = patch.specializationId ?? current.specializationId!
    if (!this.specializations.hasSpecialization(specializationId)) {
      throw new Error(`Especialização desconhecida: "${String(specializationId)}".`)
    }

    const provider = patch.provider ?? current.provider
    if (!VALID_PROVIDERS.has(provider)) {
      throw new Error(`Provedor CLI inválido: "${String(provider)}".`)
    }

    const reasoningEffort = patch.reasoningEffort ?? current.reasoningEffort
    if (!VALID_EFFORTS.has(reasoningEffort)) {
      throw new Error(`Esforço de raciocínio inválido: "${String(reasoningEffort)}".`)
    }

    const avatarPreset = patch.avatarPreset ?? current.avatarPreset!
    if (!VALID_AVATARS.has(avatarPreset)) {
      throw new Error(`Preset visual inválido: "${String(avatarPreset)}".`)
    }

    const model =
      patch.model !== undefined ? patch.model.trim().slice(0, 100) || 'default' : current.model
    const description =
      patch.description !== undefined ? patch.description.trim().slice(0, 300) : current.description!
    const customInstructions =
      patch.customInstructions !== undefined
        ? redact(patch.customInstructions.trim()).slice(0, MAX_INSTRUCTIONS_LEN)
        : current.customInstructions!
    const active = patch.active !== undefined ? (patch.active ? 1 : 0) : current.active ? 1 : 0
    const now = new Date().toISOString()

    this.db
      .prepare(`
        UPDATE agent_configs
        SET
          name = ?,
          role = ?,
          description = ?,
          role_category = ?,
          specialization_id = ?,
          provider = ?,
          model = ?,
          reasoning_effort = ?,
          custom_instructions = ?,
          avatar_preset = ?,
          active = ?,
          updated_at = ?
        WHERE agent_id = ?
      `)
      .run(
        name,
        role,
        description,
        roleCategory,
        specializationId,
        provider,
        model,
        reasoningEffort,
        customInstructions,
        avatarPreset,
        active,
        now,
        agentId,
      )

    const updated = this.find(agentId)!
    this.emit('change', this.list())
    return updated
  }

  /** Ativa ou desativa um agente personalizado sem removê-lo fisicamente do banco. */
  setAgentActive(agentId: string, active: boolean): AgentConfig {
    return this.updateAgent(agentId, { active })
  }

  /** Atualiza provedor, modelo e esforço (mantém compatibilidade com a Central de Agentes atual). */
  set(
    agentId: string,
    patch: {
      provider: ProviderId
      model: string
      reasoningEffort: ReasoningEffort
      specializationId?: SpecializationId
      customInstructions?: string
    },
  ): AgentConfig {
    if (this.find(agentId)) {
      return this.updateAgent(agentId, patch)
    }

    if (!VALID_PROVIDERS.has(patch.provider)) {
      throw new Error(`Provedor CLI inválido: "${String(patch.provider)}".`)
    }
    if (!VALID_EFFORTS.has(patch.reasoningEffort)) {
      throw new Error(`Esforço de raciocínio inválido: "${String(patch.reasoningEffort)}".`)
    }
    const specId = patch.specializationId ?? this.specializations.resolveId(agentId)
    if (!this.specializations.hasSpecialization(specId)) {
      throw new Error(`Especialização desconhecida: "${String(specId)}".`)
    }

    const now = new Date().toISOString()
    const cleanModel = patch.model.trim().slice(0, 100) || 'default'
    const cleanInstructions = redact((patch.customInstructions ?? '').trim()).slice(0, MAX_INSTRUCTIONS_LEN)
    this.db
      .prepare(`
        INSERT INTO agent_configs (
          agent_id, name, role, description, role_category, specialization_id,
          provider, model, reasoning_effort, custom_instructions, avatar_preset,
          active, is_builtin, created_at, updated_at
        ) VALUES (?, ?, 'Agente personalizado', '', 'developing', ?, ?, ?, ?, ?, 'dev', 1, 0, ?, ?)
      `)
      .run(agentId, agentId, specId, patch.provider, cleanModel, patch.reasoningEffort, cleanInstructions, now, now)

    const updated = this.get(agentId)
    this.emit('change', this.list())
    return updated
  }

  applyProfile(profileId: AgentProfileId): AgentConfig[] {
    const prof = PROFILES[profileId]
    if (!prof) throw new Error(`Perfil desconhecido: ${profileId}`)

    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      UPDATE agent_configs
      SET provider = ?, model = ?, reasoning_effort = ?, updated_at = ?
      WHERE agent_id = ?
    `)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const [agentId, cfg] of Object.entries(prof)) {
        stmt.run(cfg.provider, cfg.model, cfg.reasoningEffort, now, agentId)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    const list = this.list()
    this.emit('change', list)
    return list
  }

  resetDefaults(): AgentConfig[] {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      UPDATE agent_configs
      SET
        name = ?,
        role = ?,
        description = ?,
        role_category = ?,
        specialization_id = ?,
        provider = ?,
        model = ?,
        reasoning_effort = ?,
        custom_instructions = '',
        avatar_preset = ?,
        active = 1,
        is_builtin = 1,
        updated_at = ?
      WHERE agent_id = ?
    `)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const def of Object.values(DEFAULT_CONFIGS)) {
        stmt.run(
          def.name!,
          def.role!,
          def.description!,
          def.roleCategory!,
          def.specializationId!,
          def.provider,
          def.model,
          def.reasoningEffort,
          def.avatarPreset!,
          now,
          def.agentId,
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    const list = this.list()
    this.emit('change', list)
    return list
  }

  private defaultAvatarForCategory(category: RoleCategory): AvatarPreset {
    switch (category) {
      case 'planning':
        return 'architect'
      case 'developing':
        return 'dev'
      case 'reviewing':
        return 'qa'
      case 'teaching':
        return 'tutor'
    }
  }
}
