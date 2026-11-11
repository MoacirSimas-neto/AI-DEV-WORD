import { useState } from 'react'
import type { ActivityEntry, ActivityKind } from '../../../shared/protocol.ts'

interface Props {
  history: ActivityEntry[]
  onClose: () => void
}

const KIND_LABEL: Record<ActivityKind, string> = {
  task: 'Tarefa',
  status: 'Status',
  mission: 'Missão',
  agent: 'Agente',
  review: 'Revisão',
  files: 'Arquivos',
  commit: 'Git Commit',
  push: 'Git Push',
  error: 'Erro',
  memory: 'Memória',
}

export function HistoryPanel({ history, onClose }: Props) {
  const [filter, setFilter] = useState<string>('all')

  const filtered = filter === 'all' ? history : history.filter((h) => h.kind === filter)

  return (
    <aside className="window">
      <header className="window-head">
        <div className="window-id">
          <h2>Histórico de Atividades</h2>
          <p>Registro persistente de ações, agentes e commits</p>
        </div>
        <button type="button" className="btn-quiet window-close" aria-label="Fechar painel" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="history-filter">
        <label htmlFor="history-kind">Filtrar:</label>
        <select id="history-kind" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Todas as atividades</option>
          <option value="task">Tarefas</option>
          <option value="status">Status</option>
          <option value="mission">Missões</option>
          <option value="agent">Agentes</option>
          <option value="review">Revisões</option>
          <option value="files">Arquivos</option>
          <option value="commit">Git Commits</option>
          <option value="push">Git Pushes</option>
          <option value="error">Erros</option>
        </select>
        <span>{filtered.length} registro(s)</span>
      </div>

      {filtered.length === 0 ? (
        <p className="window-message">Nenhuma atividade registrada ainda.</p>
      ) : (
        <ul className="history-list">
          {filtered.map((item) => (
            <li key={item.id} className={`history-item history-${item.kind}`}>
              <div className="history-meta">
                <span className="history-kind-badge">{KIND_LABEL[item.kind] ?? item.kind}</span>
                <span className="history-time">{formatTime(item.at)}</span>
              </div>
              <p className="history-msg">{item.message}</p>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}
