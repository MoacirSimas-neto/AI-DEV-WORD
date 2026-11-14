import { type FormEvent, useCallback, useEffect, useState } from 'react'
import type {
  AgentInfo,
  MemoryCategory,
  MemoryEntry,
  MemoryFilter,
  MemoryScope,
  MemoryStatus,
} from '../../../shared/protocol.ts'
import type { MemoryConsentAction, MemoryConsentRequester, Send, Subscribe } from '../net/useServer.ts'

interface Props {
  projectId: number | null
  projectName?: string
  agents: AgentInfo[]
  online: boolean
  send: Send
  subscribe: Subscribe
  onRequestMemoryConsent?: MemoryConsentRequester
  onClose: () => void
}

/** Formata timestamp ISO UTC para o fuso local do usuário. */
function formatLocalDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ')
  return d.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  decision: 'Decisão',
  requirement: 'Requisito',
  architecture: 'Arquitetura',
  problem: 'Problema',
  solution: 'Solução',
  qa_result: 'Resultado de QA',
  learning: 'Aprendizado',
}

const CATEGORIES: MemoryCategory[] = [
  'decision',
  'requirement',
  'architecture',
  'problem',
  'solution',
  'qa_result',
  'learning',
]

const STATUS_LABEL: Record<MemoryStatus, string> = {
  proposed: 'Aguardando aprovação',
  approved: 'Aprovada (oficial)',
  rejected: 'Rejeitada',
  superseded: 'Substituída (histórico)',
}

export function MemoryCenter({
  projectId,
  projectName,
  agents,
  online,
  send,
  subscribe,
  onRequestMemoryConsent,
  onClose,
}: Props) {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Filtros
  const [scopeFilter, setScopeFilter] = useState<'all' | MemoryScope>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | MemoryCategory>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | MemoryStatus>('all')
  const [agentFilter, setAgentFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')

  // Modais de Criação, Substituição e Histórico
  const [creating, setCreating] = useState(false)
  const [newScope, setNewScope] = useState<MemoryScope>('team')
  const [newAgentId, setNewAgentId] = useState('')
  const [newCategory, setNewCategory] = useState<MemoryCategory>('decision')
  const [newContent, setNewContent] = useState('')

  const [supersedingEntry, setSupersedingEntry] = useState<MemoryEntry | null>(null)
  const [supersedingContent, setSupersedingContent] = useState('')

  const [viewingVersionsId, setViewingVersionsId] = useState<number | null>(null)
  const [versionChain, setVersionChain] = useState<MemoryEntry[]>([])

  const loadMemories = useCallback(() => {
    if (!projectId) return
    const filter: MemoryFilter = {}
    if (scopeFilter !== 'all') filter.scope = scopeFilter
    if (categoryFilter !== 'all') filter.category = categoryFilter
    if (statusFilter !== 'all') filter.status = statusFilter
    if (agentFilter) filter.agentId = agentFilter
    if (searchQuery.trim()) filter.q = searchQuery.trim()
    send({ type: 'memory-list', projectId, filter })
  }, [projectId, scopeFilter, categoryFilter, statusFilter, agentFilter, searchQuery, send])

  useEffect(() => {
    loadMemories()
  }, [loadMemories])

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'memory-entries' && msg.projectId === projectId) {
        setEntries(msg.entries)
        setLoading(false)
      } else if (msg.type === 'memory-changed' && msg.projectId === projectId) {
        loadMemories()
      } else if (msg.type === 'memory-versions') {
        setVersionChain(msg.versions)
      } else if (msg.type === 'notice') {
        setNotice(msg.message)
      }
    })
  }, [subscribe, projectId, loadMemories])

  const authorizeMemory = async (
    action: MemoryConsentAction,
    targetId: number,
    details: string,
  ): Promise<string | null> => {
    if (!onRequestMemoryConsent) {
      setNotice('Confirmação nativa indisponível nesta sessão.')
      return null
    }
    const res = await onRequestMemoryConsent(action, targetId, details)
    if (res.error) setNotice(res.error)
    return res.nonce
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!projectId || !newContent.trim()) return
    const content = newContent.trim()
    const nonce = await authorizeMemory(
      'create',
      projectId,
      `Criar e aprovar memória (${CATEGORY_LABEL[newCategory]}) no projeto "${projectName ?? projectId}":\n\n${content}`,
    )
    if (!nonce) return
    send({
      type: 'memory-create',
      projectId,
      entry: {
        scope: newScope,
        agentId: newScope === 'agent' ? newAgentId || null : null,
        category: newCategory,
        content,
      },
      consentNonce: nonce,
    })
    setCreating(false)
    setNewContent('')
  }

  const handleSupersede = async (e: FormEvent) => {
    e.preventDefault()
    if (!supersedingEntry || !supersedingContent.trim()) return
    const content = supersedingContent.trim()
    const nonce = await authorizeMemory(
      'supersede',
      supersedingEntry.id,
      `Substituir memória #${supersedingEntry.id} (${CATEGORY_LABEL[supersedingEntry.category]}):\n\n${content}`,
    )
    if (!nonce) return
    send({
      type: 'memory-supersede',
      id: supersedingEntry.id,
      content,
      consentNonce: nonce,
    })
    setSupersedingEntry(null)
    setSupersedingContent('')
  }

  const handleDecide = async (entry: MemoryEntry, action: 'approve' | 'reject') => {
    const label = action === 'approve' ? 'Aprovar' : 'Rejeitar'
    const nonce = await authorizeMemory(
      action,
      entry.id,
      `${label} memória #${entry.id} (origem: ${entry.author}, ${CATEGORY_LABEL[entry.category]}):\n\n${entry.content}`,
    )
    if (!nonce) return
    send({
      type: action === 'approve' ? 'memory-approve' : 'memory-reject',
      id: entry.id,
      consentNonce: nonce,
    })
  }

  const openVersions = (id: number) => {
    setViewingVersionsId(id)
    send({ type: 'memory-versions', id })
  }

  return (
    <aside className="window memory-center-window">
      <header className="window-head">
        <div className="window-id">
          <h2>Central de Memória & Conhecimento</h2>
          <p>
            {projectName
              ? `Memórias do projeto: ${projectName}`
              : 'Selecione um projeto ativo para gerenciar a memória'}
          </p>
        </div>
        <div className="agent-center-head-actions">
          {projectId && (
            <button
              type="button"
              className="btn-primary-glow"
              disabled={!online}
              onClick={() => setCreating(true)}
            >
              + Adicionar Memória
            </button>
          )}
          <button
            type="button"
            className="btn-quiet window-close"
            aria-label="Fechar Central"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>

      {notice && (
        <div className="git-notice-banner" role="alert">
          <span>⚠ {notice}</span>
          <button type="button" className="btn-quiet notice-dismiss" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {/* Formulário de Criação Manual */}
      {creating && projectId && (
        <form className="agent-creator-panel" onSubmit={handleCreate}>
          <h3>Criar Nova Memória Aprovada</h3>
          <p>Fatos registrados pelo usuário nascem aprovados e entram no contexto dos agentes.</p>
          <div className="agent-creator-row">
            <div className="agent-config-field">
              <label>Escopo:</label>
              <select
                value={newScope}
                onChange={(e) => setNewScope(e.target.value as MemoryScope)}
              >
                <option value="team">Compartilhada (Equipe)</option>
                <option value="agent">Individual (Agente Específico)</option>
              </select>
            </div>
            {newScope === 'agent' && (
              <div className="agent-config-field">
                <label>Agente Responsável:</label>
                <select
                  value={newAgentId}
                  onChange={(e) => setNewAgentId(e.target.value)}
                  required
                >
                  <option value="">Selecione um agente...</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.role})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="agent-config-field">
              <label>Categoria:</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="agent-config-field">
            <label>Conteúdo da Memória (frase curta e autocontida, máx. 600 chars):</label>
            <textarea
              rows={3}
              maxLength={600}
              placeholder="Ex.: Banco de dados oficial é PostgreSQL 16. Datas sempre salvas em UTC."
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              required
            />
          </div>
          <div className="agent-creator-actions">
            <button type="submit" disabled={!online || !newContent.trim()}>
              Gravar Memória
            </button>
            <button type="button" className="btn-quiet" onClick={() => setCreating(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Formulário de Substituição (Supersede) */}
      {supersedingEntry && (
        <form className="agent-creator-panel" onSubmit={handleSupersede}>
          <h3>Substituir Memória #{supersedingEntry.id} ({CATEGORY_LABEL[supersedingEntry.category]})</h3>
          <p>
            Decisões antigas não são apagadas: a versão anterior será marcada como substituída e preservada no histórico.
          </p>
          <div className="agent-config-field">
            <label>Versão Anterior:</label>
            <blockquote className="window-message">{supersedingEntry.content}</blockquote>
          </div>
          <div className="agent-config-field">
            <label>Nova Versão da Decisão / Fato:</label>
            <textarea
              rows={3}
              maxLength={600}
              placeholder="Nova especificação ou decisão atualizada..."
              value={supersedingContent}
              onChange={(e) => setSupersedingContent(e.target.value)}
              required
            />
          </div>
          <div className="agent-creator-actions">
            <button type="submit" disabled={!online || !supersedingContent.trim()}>
              Substituir Decisão
            </button>
            <button
              type="button"
              className="btn-quiet"
              onClick={() => {
                setSupersedingEntry(null)
                setSupersedingContent('')
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Modal / Painel de Histórico de Versões */}
      {viewingVersionsId !== null && (
        <section className="agent-creator-panel">
          <div className="agent-creator-head">
            <h3>Histórico de Evolução da Decisão #{viewingVersionsId}</h3>
            <button
              type="button"
              className="btn-quiet"
              onClick={() => {
                setViewingVersionsId(null)
                setVersionChain([])
              }}
            >
              Fechar Histórico
            </button>
          </div>
          <ol className="task-list">
            {versionChain.map((v, idx) => (
              <li key={v.id} className="task-item">
                <div className="task-item-head">
                  <span className={`task-status-pill status-${v.status === 'approved' ? 'done' : 'todo'}`}>
                    {v.status === 'approved' ? 'Versão Atual' : `Versão ${idx + 1} (${v.status})`}
                  </span>
                  <strong>Memória #{v.id}</strong>
                  <span className="task-assignee">Autor: {v.author}</span>
                  <span className="history-time">{formatLocalDateTime(v.createdAt)}</span>
                </div>
                <p className="task-desc">{v.content}</p>
                {v.approvedBy && (
                  <span className="cc-spec-pill">Aprovado por: {v.approvedBy}</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Barra de Filtros */}
      <div className="agent-toolbar-row">
        <section className="agent-filters-bar" aria-label="Filtros de memória">
          <label>
            Status:
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | MemoryStatus)}
            >
              <option value="all">Todos os Status</option>
              <option value="proposed">Aguardando aprovação</option>
              <option value="approved">Aprovadas (ativas)</option>
              <option value="superseded">Substituídas</option>
              <option value="rejected">Rejeitadas</option>
            </select>
          </label>
          <label>
            Categoria:
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as 'all' | MemoryCategory)}
            >
              <option value="all">Todas as Categorias</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Escopo:
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value as 'all' | MemoryScope)}
            >
              <option value="all">Todos os Escopos</option>
              <option value="team">Equipe</option>
              <option value="agent">Individual</option>
            </select>
          </label>
          <label>
            Agente:
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
            >
              <option value="">Qualquer agente</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Buscar:
            <input
              type="search"
              placeholder="Filtrar por termo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </label>
        </section>
      </div>

      {/* Lista de Registros de Memória */}
      {!projectId ? (
        <p className="window-message">Selecione um projeto acima para visualizar a memória.</p>
      ) : loading ? (
        <p className="git-empty">Carregando memórias...</p>
      ) : entries.length === 0 ? (
        <p className="git-empty">Nenhum registro de memória encontrado com os filtros selecionados.</p>
      ) : (
        <ul className="task-list">
          {entries.map((m) => {
            const isProposed = m.status === 'proposed'
            const isApproved = m.status === 'approved'
            const hasChain = m.supersedesId !== null || m.status === 'superseded'
            const agentName = m.agentId ? agents.find((a) => a.id === m.agentId)?.name ?? m.agentId : null

            return (
              <li key={m.id} className="task-item">
                <div className="task-item-head">
                  <span className="cc-spec-pill">#{m.id}</span>
                  <span className={`task-status-pill status-${m.status === 'approved' ? 'done' : isProposed ? 'doing' : 'todo'}`}>
                    {STATUS_LABEL[m.status]}
                  </span>
                  <strong>{CATEGORY_LABEL[m.category]}</strong>
                  <span className="task-assignee">
                    {m.scope === 'team' ? '👥 Compartilhada' : `👤 Individual (${agentName})`}
                  </span>
                  <span className="history-time">{formatLocalDateTime(m.createdAt)}</span>
                </div>

                <p className="task-desc">{m.content}</p>

                <div className="task-footer">
                  <div className="agent-card-badges">
                    <span className="agent-badge">Origem: {m.author}</span>
                    {m.sourceMissionId && (
                      <span className="agent-badge">Missão #{m.sourceMissionId}</span>
                    )}
                    {m.approvedBy && (
                      <span className="agent-badge">Aprovado por: {m.approvedBy}</span>
                    )}
                  </div>

                  <div className="task-actions">
                    {isProposed && (
                      <>
                        <button
                          type="button"
                          disabled={!online}
                          onClick={() => void handleDecide(m, 'approve')}
                        >
                          ✓ Aprovar
                        </button>
                        <button
                          type="button"
                          className="btn-quiet"
                          disabled={!online}
                          onClick={() => void handleDecide(m, 'reject')}
                        >
                          ✕ Rejeitar
                        </button>
                      </>
                    )}

                    {isApproved && (
                      <button
                        type="button"
                        className="btn-quiet"
                        disabled={!online}
                        onClick={() => {
                          setSupersedingEntry(m)
                          setSupersedingContent(m.content)
                        }}
                      >
                        Substituir Decisão
                      </button>
                    )}

                    {hasChain && (
                      <button
                        type="button"
                        className="btn-quiet"
                        disabled={!online}
                        onClick={() => openVersions(m.id)}
                      >
                        Ver Histórico
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
