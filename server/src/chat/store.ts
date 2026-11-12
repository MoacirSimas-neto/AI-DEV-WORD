import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import { CHAT_LIMITS, type ChatContextInfo, type ChatConversation, type ChatMessage, type ChatMessageStatus, type ChatMissionLink, type CliId } from '../../../shared/protocol.ts'
import { inTransaction } from '../db/database.ts'
import { redact } from '../security/redact.ts'

// Tabelas novas: nenhuma tabela de missões é alterada.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS chat_conversations (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chat_conversations_project ON chat_conversations (project_id, updated_at);
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    author TEXT NOT NULL,
    agent_id TEXT,
    cli TEXT,
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('complete', 'streaming', 'interrupted', 'error')),
    op_id TEXT,
    reply_to INTEGER,
    error TEXT,
    context TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chat_messages_conversation ON chat_messages (conversation_id, id);
  CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_op ON chat_messages (conversation_id, role, op_id) WHERE op_id IS NOT NULL;
  -- Etapa 12.2: missão nascida de uma conversa. Uma conversa -> várias missões; missão -> uma conversa.
  CREATE TABLE IF NOT EXISTS chat_mission_links (
    mission_id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    conversation_id INTEGER NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
    task_id INTEGER NOT NULL,
    op_id TEXT NOT NULL,
    context TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (conversation_id, op_id)
  );
  CREATE INDEX IF NOT EXISTS chat_mission_links_project ON chat_mission_links (project_id, conversation_id);
`

type Row = Record<string, unknown>
const MAX_STORED = 200_000

const conversationOf = (r: Row): ChatConversation => ({
  id: Number(r.id),
  projectId: Number(r.project_id),
  title: String(r.title),
  agentId: String(r.agent_id),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  messageCount: Number(r.message_count ?? 0),
})

const messageOf = (r: Row): ChatMessage => ({
  id: Number(r.id),
  conversationId: Number(r.conversation_id),
  projectId: Number(r.project_id),
  role: r.role as ChatMessage['role'],
  author: String(r.author),
  agentId: (r.agent_id as string | null) ?? null,
  cli: (r.cli as CliId | null) ?? null,
  content: String(r.content),
  status: r.status as ChatMessageStatus,
  opId: (r.op_id as string | null) ?? null,
  replyTo: r.reply_to === null || r.reply_to === undefined ? null : Number(r.reply_to),
  error: (r.error as string | null) ?? null,
  context: r.context ? (JSON.parse(String(r.context)) as ChatContextInfo) : null,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
})

const linkOf = (r: Row): ChatMissionLink => ({
  projectId: Number(r.project_id),
  conversationId: Number(r.conversation_id),
  missionId: Number(r.mission_id),
  taskId: Number(r.task_id),
  opId: String(r.op_id),
  context: JSON.parse(String(r.context)) as ChatContextInfo,
  createdAt: String(r.created_at),
})

/** Título inicial sem chamar o modelo: começo da primeira mensagem do usuário. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return 'Nova conversa'
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line
}

/**
 * Conversas e mensagens do chat. Toda leitura e escrita exige o projeto: uma conversa de um
 * projeto nunca é encontrada pelo id a partir de outro. Emite 'conversations' (projectId).
 */
export class ChatStore extends EventEmitter {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    super()
    this.db = db
    inTransaction(this.db, () => this.db.exec(SCHEMA))
  }

  listConversations(projectId: number): ChatConversation[] {
    return (
      this.db
        .prepare(
          `SELECT c.*, (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) AS message_count
           FROM chat_conversations c WHERE c.project_id = ? ORDER BY c.updated_at DESC, c.id DESC`,
        )
        .all(projectId) as Row[]
    ).map(conversationOf)
  }

  getConversation(projectId: number, conversationId: number): ChatConversation | null {
    const row = this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) AS message_count
         FROM chat_conversations c WHERE c.id = ? AND c.project_id = ?`,
      )
      .get(conversationId, projectId) as Row | undefined
    return row ? conversationOf(row) : null
  }

  requireConversation(projectId: number, conversationId: number): ChatConversation {
    const conv = this.getConversation(projectId, conversationId)
    if (!conv) throw new Error('Conversa não encontrada neste projeto.')
    return conv
  }

  createConversation(projectId: number, agentId: string, title = 'Nova conversa'): ChatConversation {
    const now = new Date().toISOString()
    const id = Number(
      this.db
        .prepare('INSERT INTO chat_conversations (project_id, title, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(projectId, cleanTitle(title), agentId, now, now).lastInsertRowid,
    )
    this.emit('conversations', projectId)
    return this.requireConversation(projectId, id)
  }

  rename(projectId: number, conversationId: number, title: string): ChatConversation {
    this.requireConversation(projectId, conversationId)
    const clean = cleanTitle(title)
    if (!clean) throw new Error('Informe um título.')
    this.db.prepare('UPDATE chat_conversations SET title = ?, updated_at = ? WHERE id = ? AND project_id = ?').run(clean, new Date().toISOString(), conversationId, projectId)
    this.emit('conversations', projectId)
    return this.requireConversation(projectId, conversationId)
  }

  /** Exclusão definitiva (mensagens incluídas). A interface confirma antes. */
  delete(projectId: number, conversationId: number) {
    this.requireConversation(projectId, conversationId)
    inTransaction(this.db, () => {
      // A missão e a trilha dela ficam; só o vínculo com a conversa some.
      this.db.prepare('DELETE FROM chat_mission_links WHERE conversation_id = ? AND project_id = ?').run(conversationId, projectId)
      this.db.prepare('DELETE FROM chat_messages WHERE conversation_id = ? AND project_id = ?').run(conversationId, projectId)
      this.db.prepare('DELETE FROM chat_conversations WHERE id = ? AND project_id = ?').run(conversationId, projectId)
    })
    this.emit('conversations', projectId)
  }

  /** Mensagens em ordem cronológica; beforeId pagina para trás. */
  listMessages(projectId: number, conversationId: number, options: { beforeId?: number; limit?: number } = {}): { messages: ChatMessage[]; hasMore: boolean } {
    this.requireConversation(projectId, conversationId)
    const limit = options.limit ?? CHAT_LIMITS.pageSize
    const rows = this.db
      .prepare(
        `SELECT * FROM chat_messages WHERE conversation_id = ? AND project_id = ? AND id < ?
         ORDER BY id DESC LIMIT ?`,
      )
      .all(conversationId, projectId, options.beforeId ?? Number.MAX_SAFE_INTEGER, limit + 1) as Row[]
    const hasMore = rows.length > limit
    return { messages: rows.slice(0, limit).reverse().map(messageOf), hasMore }
  }

  /** Mensagem do usuário com o opId desta operação, se já gravada (envio repetido). */
  findUserMessage(conversationId: number, opId: string): ChatMessage | null {
    const row = this.db.prepare("SELECT * FROM chat_messages WHERE conversation_id = ? AND role = 'user' AND op_id = ?").get(conversationId, opId) as Row | undefined
    return row ? messageOf(row) : null
  }

  getMessage(projectId: number, messageId: number): ChatMessage | null {
    const row = this.db.prepare('SELECT * FROM chat_messages WHERE id = ? AND project_id = ?').get(messageId, projectId) as Row | undefined
    return row ? messageOf(row) : null
  }

  /**
   * Grava a pergunta e a resposta (vazia, em andamento) numa transação. O título da conversa
   * nova vira o começo da primeira pergunta.
   */
  addExchange(
    conv: ChatConversation,
    input: { content: string; opId: string; agentId: string; cli: CliId; context: ChatContextInfo },
  ): { user: ChatMessage; reply: ChatMessage } {
    const now = new Date().toISOString()
    const ids = inTransaction(this.db, () => {
      const userId = Number(
        this.db
          .prepare(
            `INSERT INTO chat_messages (conversation_id, project_id, role, author, content, status, op_id, created_at, updated_at)
             VALUES (?, ?, 'user', 'user', ?, 'complete', ?, ?, ?)`,
          )
          .run(conv.id, conv.projectId, redact(input.content).slice(0, MAX_STORED), input.opId, now, now).lastInsertRowid,
      )
      const replyId = Number(
        this.db
          .prepare(
            `INSERT INTO chat_messages (conversation_id, project_id, role, author, agent_id, cli, content, status, reply_to, context, created_at, updated_at)
             VALUES (?, ?, 'assistant', ?, ?, ?, '', 'streaming', ?, ?, ?, ?)`,
          )
          .run(conv.id, conv.projectId, input.agentId, input.agentId, input.cli, userId, JSON.stringify(input.context), now, now).lastInsertRowid,
      )
      const first = conv.messageCount === 0 && conv.title === 'Nova conversa'
      this.db
        .prepare(`UPDATE chat_conversations SET updated_at = ?${first ? ', title = ?' : ''} WHERE id = ?`)
        .run(...(first ? [now, titleFrom(input.content), conv.id] : [now, conv.id]))
      return { userId, replyId }
    })
    this.emit('conversations', conv.projectId)
    return { user: this.getMessage(conv.projectId, ids.userId)!, reply: this.getMessage(conv.projectId, ids.replyId)! }
  }

  /** Grava o texto parcial da resposta (checkpoint) ou o final, sempre redigido. */
  updateReply(projectId: number, messageId: number, patch: { content?: string; status?: ChatMessageStatus; error?: string | null }): ChatMessage {
    const current = this.getMessage(projectId, messageId)
    if (!current) throw new Error('Mensagem não encontrada.')
    const content = patch.content === undefined ? current.content : redact(patch.content).slice(0, MAX_STORED)
    const error = patch.error === undefined ? current.error : patch.error === null ? null : redact(patch.error).slice(0, 4000)
    this.db
      .prepare('UPDATE chat_messages SET content = ?, status = ?, error = ?, updated_at = ? WHERE id = ? AND project_id = ?')
      .run(content, patch.status ?? current.status, error, new Date().toISOString(), messageId, projectId)
    return this.getMessage(projectId, messageId)!
  }

  /** Mensagens anteriores da conversa (para a janela de contexto), mais recentes por último. */
  previousMessages(conversationId: number, projectId: number, beforeId: number, limit: number): ChatMessage[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM chat_messages WHERE conversation_id = ? AND project_id = ? AND id < ? AND content <> ''
           ORDER BY id DESC LIMIT ?`,
        )
        .all(conversationId, projectId, beforeId, limit) as Row[]
    )
      .reverse()
      .map(messageOf)
  }

  countBefore(conversationId: number, projectId: number, beforeId: number): number {
    return Number(
      (this.db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ? AND project_id = ? AND id < ? AND content <> ''").get(conversationId, projectId, beforeId) as Row).n,
    )
  }

  /** Vincula a missão à conversa (mesmo projeto, conferido aqui). Emite 'links' (projectId). */
  linkMission(input: Omit<ChatMissionLink, 'createdAt'>): ChatMissionLink {
    this.requireConversation(input.projectId, input.conversationId)
    this.db
      .prepare('INSERT INTO chat_mission_links (mission_id, project_id, conversation_id, task_id, op_id, context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(input.missionId, input.projectId, input.conversationId, input.taskId, input.opId, JSON.stringify(input.context), new Date().toISOString())
    this.emit('links', input.projectId)
    return this.findLink(input.projectId, input.conversationId, input.opId)!
  }

  /** Vínculo criado por esta operação (clique repetido no mesmo botão). */
  findLink(projectId: number, conversationId: number, opId: string): ChatMissionLink | null {
    const row = this.db.prepare('SELECT * FROM chat_mission_links WHERE project_id = ? AND conversation_id = ? AND op_id = ?').get(projectId, conversationId, opId) as Row | undefined
    return row ? linkOf(row) : null
  }

  /** Vínculos do projeto, do mais antigo ao mais novo. */
  listLinks(projectId: number): ChatMissionLink[] {
    return (this.db.prepare('SELECT * FROM chat_mission_links WHERE project_id = ? ORDER BY mission_id').all(projectId) as Row[]).map(linkOf)
  }

  /** Na inicialização: respostas que estavam chegando quando o app fechou ficam interrompidas. */
  interruptStreaming(): number {
    return Number(
      this.db
        .prepare("UPDATE chat_messages SET status = 'interrupted', error = 'Resposta interrompida: o app foi fechado.', updated_at = ? WHERE status = 'streaming'")
        .run(new Date().toISOString()).changes,
    )
  }
}

function cleanTitle(title: string): string {
  return redact(title.replace(/\s+/g, ' ').trim()).slice(0, CHAT_LIMITS.maxTitleChars)
}
