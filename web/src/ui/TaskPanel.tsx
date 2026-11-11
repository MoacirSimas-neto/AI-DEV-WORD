import { type FormEvent, useEffect, useState } from 'react'
import type { AgentInfo, MissionInfo, TaskInfo, TaskInput, TaskPriority, TaskStatus } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'

interface Props {
  tasks: TaskInfo[]
  missions: MissionInfo[]
  agents: AgentInfo[]
  activeProjectId: number | null
  online: boolean
  send: Send
  subscribe: Subscribe
  onClose: () => void
}

const PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'Baixa', medium: 'Média', high: 'Alta' }
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'A fazer',
  doing: 'Em andamento',
  review: 'Em revisão',
  done: 'Concluída',
}

export function TaskPanel({
  tasks,
  missions,
  agents,
  activeProjectId,
  online,
  send,
  subscribe,
  onClose,
}: Props) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [agentId, setAgentId] = useState<string>('')
  const [liveOutput, setLiveOutput] = useState<{ missionId: number; text: string } | null>(null)

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'mission-output') {
        setLiveOutput((prev) => {
          const current = prev?.missionId === msg.missionId ? prev.text : ''
          return { missionId: msg.missionId, text: (current + msg.data).slice(-4000) }
        })
      }
    })
  }, [subscribe])

  const projectTasks = activeProjectId ? tasks.filter((t) => t.projectId === activeProjectId) : []
  const activeMission = missions.find(
    (m) =>
      m.projectId === activeProjectId &&
      ['planning', 'awaiting_approval', 'developing', 'reviewing'].includes(m.phase),
  )

  const resetForm = () => {
    setEditingId(null)
    setTitle('')
    setDescription('')
    setPriority('medium')
    setStatus('todo')
    setAgentId('')
  }

  const startEdit = (t: TaskInfo) => {
    setEditingId(t.id)
    setTitle(t.title)
    setDescription(t.description)
    setPriority(t.priority)
    setStatus(t.status)
    setAgentId(t.agentId ?? '')
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !activeProjectId) return
    const input: TaskInput = {
      title: title.trim(),
      description: description.trim(),
      priority,
      status,
      agentId: agentId || null,
    }
    if (editingId) {
      send({ type: 'task-update', taskId: editingId, task: input })
    } else {
      send({ type: 'task-create', projectId: activeProjectId, task: input })
    }
    resetForm()
  }

  return (
    <aside className="window">
      <header className="window-head">
        <div className="window-id">
          <h2>Gerenciador de Tarefas</h2>
          <p>{activeProjectId ? 'Tarefas do projeto ativo' : 'Escolha um projeto acima'}</p>
        </div>
        <button type="button" className="btn-quiet window-close" aria-label="Fechar painel" onClick={onClose}>
          ×
        </button>
      </header>

      {/* Missao Ativa / Modo Equipe */}
      {activeMission && (
        <section className="mission-card">
          <div className="mission-head">
            <h3>Missão em Andamento #{activeMission.id}</h3>
            <span className={`mission-phase phase-${activeMission.phase}`}>{phaseLabel(activeMission.phase)}</span>
          </div>

          {activeMission.phase === 'awaiting_approval' && (
            <div className="mission-approval">
              <p><strong>Plano do Arquiteto (Gemini):</strong></p>
              <pre className="mission-plan-text">{activeMission.plan}</pre>
              <div className="mission-actions">
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => send({ type: 'mission-approve', missionId: activeMission.id })}
                >
                  Aprovar plano e iniciar Dev
                </button>
                <button
                  type="button"
                  className="btn-quiet"
                  disabled={!online}
                  onClick={() => send({ type: 'mission-cancel', missionId: activeMission.id })}
                >
                  Rejeitar plano
                </button>
              </div>
            </div>
          )}

          {activeMission.phase !== 'awaiting_approval' && (
            <div className="mission-running">
              <p className="mission-step-desc">{stepDescription(activeMission.phase)}</p>
              {liveOutput?.missionId === activeMission.id && (
                <pre className="mission-live-output">{liveOutput.text}</pre>
              )}
              <button
                type="button"
                className="btn-quiet"
                disabled={!online}
                onClick={() => send({ type: 'mission-cancel', missionId: activeMission.id })}
              >
                Cancelar missão
              </button>
            </div>
          )}
        </section>
      )}

      {/* Formulario de Criar / Editar */}
      {activeProjectId && (
        <form className="task-form" onSubmit={save}>
          <h3>{editingId ? 'Editar Tarefa' : 'Nova Tarefa'}</h3>
          <div className="task-form-row">
            <input
              placeholder="Título da tarefa"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              <option value="todo">A fazer</option>
              <option value="doing">Em andamento</option>
              <option value="review">Em revisão</option>
              <option value="done">Concluída</option>
            </select>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Sem agente</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.role})
                </option>
              ))}
            </select>
          </div>
          <textarea
            rows={2}
            placeholder="Descrição ou orientações para os agentes..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="task-form-actions">
            <button type="submit" disabled={!online || !title.trim()}>
              {editingId ? 'Salvar Alterações' : 'Criar Tarefa'}
            </button>
            {editingId && (
              <button type="button" className="btn-quiet" onClick={resetForm}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {/* Lista de Tarefas */}
      {!activeProjectId ? (
        <p className="window-message">Selecione ou adicione um projeto para gerenciar tarefas.</p>
      ) : projectTasks.length === 0 ? (
        <p className="git-empty">Nenhuma tarefa criada para este projeto.</p>
      ) : (
        <ul className="task-list">
          {projectTasks.map((t) => {
            const assigned = agents.find((a) => a.id === t.agentId)
            const canStartMission = !activeMission && t.status !== 'done'
            return (
              <li key={t.id} className={`task-item task-priority-${t.priority}`}>
                <div className="task-item-head">
                  <span className={`task-status-pill status-${t.status}`}>{STATUS_LABEL[t.status]}</span>
                  <strong>{t.title}</strong>
                  <span className="task-priority-tag">{PRIORITY_LABEL[t.priority]}</span>
                </div>
                {t.description && <p className="task-desc">{t.description}</p>}
                <div className="task-footer">
                  <span className="task-assignee">
                    {assigned ? `Atribuído: ${assigned.name}` : 'Sem agente'}
                  </span>
                  <div className="task-actions">
                    {canStartMission && (
                      <button
                        type="button"
                        disabled={!online}
                        title="Iniciar Arquiteto (Gemini) -> Dev (Codex) -> QA (Gemini)"
                        onClick={() => send({ type: 'mission-start', taskId: t.id })}
                      >
                        Modo Equipe
                      </button>
                    )}
                    <button type="button" className="btn-quiet" onClick={() => startEdit(t)}>
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn-quiet"
                      onClick={() => send({ type: 'task-delete', taskId: t.id })}
                    >
                      Excluir
                    </button>
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

function phaseLabel(phase: string) {
  switch (phase) {
    case 'planning':
      return 'Planejando (Arquiteto)'
    case 'awaiting_approval':
      return 'Aguardando aprovação'
    case 'developing':
      return 'Implementando (Dev)'
    case 'reviewing':
      return 'Revisando (QA)'
    default:
      return phase
  }
}

function stepDescription(phase: string) {
  switch (phase) {
    case 'planning':
      return 'O Arquiteto (Gemini) está inspecionando o projeto e elaborando o plano...'
    case 'developing':
      return 'O Desenvolvedor (Codex) está implementando as alterações no código...'
    case 'reviewing':
      return 'O QA (Gemini) está revisando a qualidade, bugs e segurança do código...'
    default:
      return ''
  }
}
