import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import type {
  MemoryCategory,
  MemoryEntry,
  MemoryFilter,
  MemoryScope,
  MemoryStatus,
  MissionInfo,
} from '../../../shared/protocol.ts'
import { type HistoryStore, redact } from '../history/store.ts'

// Memórias nunca são apagadas nem editadas: mudar uma decisão cria um registro
// novo que aponta para o anterior (supersedes_id). O histórico fica na própria tabela.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS memory_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('agent', 'team')),
    agent_id TEXT,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'superseded')),
    source_mission_id INTEGER,
    author TEXT NOT NULL,
    approved_by TEXT,
    supersedes_id INTEGER REFERENCES memory_entries (id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (scope = 'team' OR agent_id IS NOT NULL)
  );
  CREATE INDEX IF NOT EXISTS memory_project_status ON memory_entries (project_id, status);
  CREATE INDEX IF NOT EXISTS memory_supersedes ON memory_entries (supersedes_id);
`

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  'decision',
  'requirement',
  'architecture',
  'problem',
  'solution',
  'qa_result',
  'learning',
]
export const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  decision: 'Decisão',
  requirement: 'Requisito',
  architecture: 'Arquitetura',
  problem: 'Problema',
  solution: 'Solução',
  qa_result: 'Resultado de QA',
  learning: 'Aprendizado',
}
const SCOPES = new Set<MemoryScope>(['agent', 'team'])
const STATUSES = new Set<MemoryStatus>(['proposed', 'approved', 'rejected', 'superseded'])
/** Memória é um fato curto, não um documento: o limite protege o orçamento dos prompts. */
export const MAX_MEMORY_CHARS = 600
/** Quem aprova, rejeita e substitui: só ações humanas vindas da interface. */
export const HUMAN = 'user'

const COLUMNS = `id, project_id AS projectId, scope, agent_id AS agentId, category, content, status,
  source_mission_id AS sourceMissionId, author, approved_by AS approvedBy, supersedes_id AS supersedesId,
  created_at AS createdAt, updated_at AS updatedAt`

export interface NewMemory {
  projectId: number
  scope: MemoryScope
  agentId?: string | null
  category: MemoryCategory
  content: string
  sourceMissionId?: number | null
  author: string
}

// Palavras que os agentes escrevem nas linhas "MEMÓRIA(categoria): texto".
const CATEGORY_WORDS: Record<string, MemoryCategory> = {
  decisao: 'decision',
  requisito: 'requirement',
  arquitetura: 'architecture',
  problema: 'problem',
  solucao: 'solution',
  aprendizado: 'learning',
}
const PROPOSAL_LINE = /^[\s>*-]*MEM[ÓO]RIA\s*\(\s*([a-zçãõáéíóú]+)\s*\)\s*:\s*(.+)$/gim
const MAX_PROPOSALS_PER_TEXT = 3

/** Extrai as memórias que um agente propôs no próprio texto (plano, relatório ou revisão). */
export function parseProposals(text: string): { category: MemoryCategory; content: string }[] {
  const found: { category: MemoryCategory; content: string }[] = []
  for (const match of text.matchAll(PROPOSAL_LINE)) {
    const word = match[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const category = CATEGORY_WORDS[word]
    const content = match[2].replace(/^[\s*]+|[\s*]+$/g, '')
    if (category && content && found.length < MAX_PROPOSALS_PER_TEXT) found.push({ category, content })
  }
  return found
}

/**
 * Memória persistente por projeto, no mesmo SQLite. Agentes só criam propostas;
 * apenas o usuário aprova, rejeita ou substitui. Emite 'change' (projectId).
 */
export class MemoryStore extends EventEmitter {
  private readonly db: DatabaseSync
  private readonly history: HistoryStore

  constructor(db: DatabaseSync, history: HistoryStore) {
    super()
    this.db = db
    this.history = history
    this.db.exec(SCHEMA)
  }

  get(id: number): MemoryEntry | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM memory_entries WHERE id = ?`).get(id)
    return row ? ({ ...row } as unknown as MemoryEntry) : null
  }

  /** Sempre dentro de um projeto: não existe consulta que atravesse projetos. */
  list(projectId: number, filter: MemoryFilter = {}): MemoryEntry[] {
    const where = ['project_id = ?']
    const params: (string | number)[] = [projectId]
    const add = (use: unknown, sql: string, value: string | number) => {
      if (!use) return
      where.push(sql)
      params.push(value)
    }
    add(filter.scope && SCOPES.has(filter.scope), 'scope = ?', filter.scope!)
    add(filter.agentId, 'agent_id = ?', filter.agentId!)
    add(filter.category && MEMORY_CATEGORIES.includes(filter.category), 'category = ?', filter.category!)
    add(filter.status && STATUSES.has(filter.status), 'status = ?', filter.status!)
    add(filter.from, 'created_at >= ?', filter.from!)
    // Datas vêm como AAAA-MM-DD: o sufixo inclui o dia inteiro.
    add(filter.to, 'created_at <= ?', `${filter.to}￿`)
    add(filter.q?.trim(), "content LIKE ? ESCAPE '\\'", `%${(filter.q ?? '').trim().replace(/[\\%_]/g, '\\$&')}%`)
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM memory_entries WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 500`)
      .all(...params)
      .map((row) => ({ ...row }) as unknown as MemoryEntry)
  }

  /** O que um agente pode usar agora: aprovadas do time e as individuais dele. */
  currentFor(projectId: number, agentId: string): MemoryEntry[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM memory_entries
         WHERE project_id = ? AND status = 'approved' AND (scope = 'team' OR agent_id = ?)
         ORDER BY id DESC`,
      )
      .all(projectId, agentId)
      .map((row) => ({ ...row }) as unknown as MemoryEntry)
  }

  /** Proposta de um agente. Não entra em nenhum prompt até o usuário aprovar. */
  propose(input: NewMemory): MemoryEntry {
    return this.insert(input, 'proposed', null, null)
  }

  /** Memória criada pelo próprio usuário: já nasce aprovada. */
  createApproved(input: Omit<NewMemory, 'author'>): MemoryEntry {
    return this.insert({ ...input, author: HUMAN }, 'approved', HUMAN, null)
  }

  /** Propostas que os agentes deixaram nos textos de uma missão; a missão fica como origem. */
  proposeFromMission(mission: MissionInfo): MemoryEntry[] {
    const sources: [string, string][] = [
      [mission.plannerId || 'architect', mission.plan],
      [mission.devId || 'dev', mission.devReport],
      [mission.qaId || 'qa', mission.review],
    ]
    const created: MemoryEntry[] = []
    for (const [agentId, text] of sources) {
      for (const proposal of parseProposals(text)) {
        try {
          created.push(
            this.propose({
              projectId: mission.projectId,
              // Aprendizado é do próprio agente; o resto interessa à equipe.
              scope: proposal.category === 'learning' ? 'agent' : 'team',
              agentId,
              category: proposal.category,
              content: proposal.content,
              sourceMissionId: mission.id,
              author: agentId,
            }),
          )
        } catch {
          // Proposta inválida de um agente não derruba a missão.
        }
      }
    }
    return created
  }

  approve(id: number, by: string): MemoryEntry {
    return this.decide(id, 'approved', by)
  }

  reject(id: number, by: string): MemoryEntry {
    return this.decide(id, 'rejected', by)
  }

  /** Troca uma memória aprovada por uma nova versão; a anterior fica no histórico como 'superseded'. */
  supersede(id: number, content: string, by: string): MemoryEntry {
    const old = this.require(id)
    if (old.status !== 'approved') throw new Error('Só uma memória aprovada pode ser substituída.')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const next = this.insert(
        { projectId: old.projectId, scope: old.scope, agentId: old.agentId, category: old.category, content, author: by },
        'approved',
        by,
        old.id,
      )
      this.db
        .prepare("UPDATE memory_entries SET status = 'superseded', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), old.id)
      this.db.exec('COMMIT')
      this.log(next, `Memória #${old.id} substituída pela #${next.id} (${CATEGORY_LABEL[next.category]}).`)
      this.emit('change', next.projectId)
      return next
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Todas as versões de uma memória, da mais antiga para a atual. */
  versions(id: number): MemoryEntry[] {
    let first = this.require(id)
    while (first.supersedesId) first = this.require(first.supersedesId)
    const chain = [first]
    for (;;) {
      const next = this.db.prepare(`SELECT ${COLUMNS} FROM memory_entries WHERE supersedes_id = ?`).get(chain.at(-1)!.id)
      if (!next) return chain
      chain.push({ ...next } as unknown as MemoryEntry)
    }
  }

  private decide(id: number, status: 'approved' | 'rejected', by: string): MemoryEntry {
    const entry = this.require(id)
    if (entry.status !== 'proposed') throw new Error('Esta memória não está aguardando aprovação.')
    this.db
      .prepare('UPDATE memory_entries SET status = ?, approved_by = ?, updated_at = ? WHERE id = ?')
      .run(status, by, new Date().toISOString(), id)
    const updated = this.require(id)
    this.log(updated, `Memória #${id} ${status === 'approved' ? 'aprovada' : 'rejeitada'} (${CATEGORY_LABEL[updated.category]}).`)
    this.emit('change', updated.projectId)
    return updated
  }

  private insert(input: NewMemory, status: MemoryStatus, approvedBy: string | null, supersedesId: number | null): MemoryEntry {
    if (!this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(input.projectId)) {
      throw new Error('Projeto desconhecido: a memória precisa pertencer a um projeto existente.')
    }
    if (!SCOPES.has(input.scope)) throw new Error(`Escopo de memória inválido: "${String(input.scope)}".`)
    if (!MEMORY_CATEGORIES.includes(input.category)) throw new Error(`Categoria de memória inválida: "${String(input.category)}".`)
    const agentId = input.agentId?.trim() || null
    if (input.scope === 'agent' && !agentId) throw new Error('Memória individual precisa de um agente.')
    const content = redact(String(input.content ?? '').trim()).slice(0, MAX_MEMORY_CHARS)
    if (!content) throw new Error('A memória não pode ficar vazia.')
    const author = input.author.trim()
    if (!author) throw new Error('A memória precisa de um autor.')

    // O mesmo fato proposto de novo (ex.: a cada missão) não vira duplicata.
    const same = this.db
      .prepare(
        `SELECT id FROM memory_entries
         WHERE project_id = ? AND scope = ? AND (scope = 'team' OR agent_id = ?) AND content = ? AND status IN ('proposed', 'approved')`,
      )
      .get(input.projectId, input.scope, agentId, content)
    if (same && supersedesId === null) return this.require(Number(same.id))

    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO memory_entries (project_id, scope, agent_id, category, content, status, source_mission_id,
           author, approved_by, supersedes_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.projectId,
        input.scope,
        input.scope === 'agent' ? agentId : (agentId ?? null),
        input.category,
        content,
        status,
        input.sourceMissionId ?? null,
        author,
        approvedBy,
        supersedesId,
        now,
        now,
      )
    const created = this.require(Number(result.lastInsertRowid))
    if (supersedesId === null) {
      this.log(created, `Memória #${created.id} ${status === 'proposed' ? `proposta por ${author}` : 'criada pelo usuário'} (${CATEGORY_LABEL[created.category]}).`)
      this.emit('change', created.projectId)
    }
    return created
  }

  private require(id: number): MemoryEntry {
    const entry = this.get(id)
    if (!entry) throw new Error('Memória não encontrada.')
    return entry
  }

  private log(entry: MemoryEntry, message: string) {
    this.history.add({
      kind: 'memory',
      message,
      projectId: entry.projectId,
      missionId: entry.sourceMissionId,
      agentId: entry.scope === 'agent' ? entry.agentId : null,
    })
  }
}
