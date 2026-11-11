import { type FormEvent, useEffect, useState } from 'react'
import type {
  AgentConfig,
  AgentInfo,
  MissionInfo,
  MissionTeamSelection,
  TaskInfo,
  TaskInput,
  TaskPriority,
  TaskStatus,
} from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'
import { AgentPortrait } from './AgentPortrait.tsx'
import { ClarificationBox } from './ClarificationBox.tsx'

interface Props {
  tasks: TaskInfo[]
  missions: MissionInfo[]
  agents: AgentInfo[]
  configs: AgentConfig[]
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
  configs,
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
  const [notice, setNotice] = useState<string | null>(null)

  // Seleção de equipe para Modo Equipe
  const [useDefaultTeam, setUseDefaultTeam] = useState<boolean>(true)
  const [plannerId, setPlannerId] = useState<string>('architect')
  const [devId, setDevId] = useState<string>('dev')
  const [qaId, setQaId] = useState<string>('qa')

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'mission-output') {
        setLiveOutput((prev) => {
          const current = prev?.missionId === msg.missionId ? prev.text : ''
          return { missionId: msg.missionId, text: (current + msg.data).slice(-4000) }
        })
      } else if (msg.type === 'notice') {
        setNotice(msg.message)
      }
    })
  }, [subscribe])

  const projectTasks = activeProjectId ? tasks.filter((t) => t.projectId === activeProjectId) : []
  const activeMission = missions.find(
    (m) =>
      m.projectId === activeProjectId &&
      ['planning', 'awaiting_approval', 'awaiting_clarification', 'developing', 'reviewing'].includes(m.phase),
  )

  const planners = agents.filter(
    (a) => (configs.find((c) => c.agentId === a.id)?.roleCategory ?? a.roleCategory ?? 'planning') === 'planning',
  )
  const developers = agents.filter(
    (a) => (configs.find((c) => c.agentId === a.id)?.roleCategory ?? a.roleCategory ?? 'developing') === 'developing',
  )
  const reviewers = agents.filter(
    (a) => (configs.find((c) => c.agentId === a.id)?.roleCategory ?? a.roleCategory ?? 'reviewing') === 'reviewing',
  )

  const effectivePlannerId = useDefaultTeam ? 'architect' : plannerId
  const effectiveDevId = useDefaultTeam ? 'dev' : devId
  const effectiveQaId = useDefaultTeam ? 'qa' : qaId

  const teamSlots = [
    {
      stageLabel: 'Planejamento',
      selectedId: effectivePlannerId,
      options: planners,
      onSelect: setPlannerId,
    },
    {
      stageLabel: 'Desenvolvimento',
      selectedId: effectiveDevId,
      options: developers,
      onSelect: setDevId,
    },
    {
      stageLabel: 'Revisão QA',
      selectedId: effectiveQaId,
      options: reviewers,
      onSelect: setQaId,
    },
  ]

  const offlineTeamAgents = [effectivePlannerId, effectiveDevId, effectiveQaId]
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is AgentInfo => !a || a.state === 'offline')

  const missingRoleSelection =
    !agents.some((a) => a.id === effectivePlannerId) ||
    !agents.some((a) => a.id === effectiveDevId) ||
    !agents.some((a) => a.id === effectiveQaId)

  const teamReady = !missingRoleSelection && offlineTeamAgents.length === 0

  const verifyTeamClis = () => {
    for (const id of new Set([effectivePlannerId, effectiveDevId, effectiveQaId])) {
      send({ type: 'check-cli', agentId: id })
    }
  }

  const startMissionForTask = (taskId: number) => {
    setNotice(null)
    const team: MissionTeamSelection | undefined = useDefaultTeam
      ? undefined
      : {
          plannerId: effectivePlannerId,
          devId: effectiveDevId,
          qaId: effectiveQaId,
        }
    send({ type: 'mission-start', taskId, team })
  }

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
          <p>{activeProjectId ? 'Tarefas e composição de equipe do projeto ativo' : 'Escolha um projeto acima'}</p>
        </div>
        <button type="button" className="btn-quiet window-close" aria-label="Fechar painel" onClick={onClose}>
          ×
        </button>
      </header>

      {notice && (
        <div className="git-notice-banner" role="alert">
          <span>⚠ {notice}</span>
          <button type="button" className="btn-quiet notice-dismiss" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {/* Missao Ativa / Modo Equipe */}
      {activeMission && (
        <section className="mission-card">
          <div className="mission-head">
            <h3>Missão em Andamento #{activeMission.id}</h3>
            <span className={`mission-phase phase-${activeMission.phase}`}>
              {phaseLabel(activeMission)}
            </span>
          </div>

          <div className="mission-team-summary">
            <span className="mission-team-chip">
              📋 Planejamento:{' '}
              <strong>
                {activeMission.teamSnapshot?.[activeMission.plannerId ?? 'architect']?.name ??
                  (activeMission.plannerId ?? 'architect')}
              </strong>
            </span>
            <span className="mission-team-chip">
              💻 Dev:{' '}
              <strong>
                {activeMission.teamSnapshot?.[activeMission.devId ?? 'dev']?.name ??
                  (activeMission.devId ?? 'dev')}
              </strong>
            </span>
            <span className="mission-team-chip">
              🔍 QA:{' '}
              <strong>
                {activeMission.teamSnapshot?.[activeMission.qaId ?? 'qa']?.name ??
                  (activeMission.qaId ?? 'qa')}
              </strong>
            </span>
          </div>

          {/* Pergunta do planejador ao usuário */}
          <ClarificationBox mission={activeMission} online={online} send={send} />

          {activeMission.phase === 'awaiting_approval' && (
            <div className="mission-approval">
              <p>
                <strong>
                  Plano elaborado por{' '}
                  {activeMission.teamSnapshot?.[activeMission.plannerId ?? 'architect']?.name ??
                    (activeMission.plannerId ?? 'architect')}
                  :
                </strong>
              </p>
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

          {activeMission.phase !== 'awaiting_approval' && activeMission.phase !== 'awaiting_clarification' && (
            <div className="mission-running">
              <p className="mission-step-desc">{stepDescription(activeMission)}</p>
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

      {/* Seletor de Equipe Responsável para Modo Equipe */}
      {activeProjectId && !activeMission && (
        <section className="team-selector-box" aria-label="Equipe responsável pela missão">
          <div className="team-selector-head">
            <div>
              <h3>Equipe responsável (Modo Equipe)</h3>
              <p>Defina quais agentes executarão Planejamento, Desenvolvimento e Revisão QA</p>
            </div>
            <label className="team-default-toggle">
              <input
                type="checkbox"
                checked={useDefaultTeam}
                onChange={(e) => {
                  const checked = e.target.checked
                  setUseDefaultTeam(checked)
                  if (checked) {
                    setPlannerId('architect')
                    setDevId('dev')
                    setQaId('qa')
                  }
                }}
              />
              <span>Usar equipe padrão (Arquiteto · Dev · QA)</span>
            </label>
          </div>

          <div className="team-selector-grid">
            {teamSlots.map((slot) => {
              const ag = agents.find((a) => a.id === slot.selectedId)
              const cfg = configs.find((c) => c.agentId === slot.selectedId)
              const isOffline = !ag || ag.state === 'offline'
              return (
                <div key={slot.stageLabel} className={`team-slot-card ${isOffline ? 'slot-offline' : ''}`}>
                  <div className="team-slot-stage">{slot.stageLabel}</div>
                  {!useDefaultTeam && (
                    <select
                      aria-label={`Selecionar agente de ${slot.stageLabel}`}
                      value={slot.selectedId}
                      onChange={(e) => slot.onSelect(e.target.value)}
                    >
                      {slot.options.map((opt) => {
                        const optCfg = configs.find((c) => c.agentId === opt.id)
                        return (
                          <option key={opt.id} value={opt.id}>
                            {opt.name} · {optCfg?.specializationId ?? opt.specializationId ?? opt.role} (
                            {opt.state === 'offline' ? 'CLI offline' : 'Disponível'})
                          </option>
                        )
                      })}
                    </select>
                  )}
                  {ag ? (
                    <div className="team-slot-agent">
                      <AgentPortrait
                        agentId={ag.id}
                        preset={cfg?.avatarPreset ?? ag.avatarPreset}
                        dimmed={isOffline}
                      />
                      <div className="team-slot-meta">
                        <strong>{ag.name}</strong>
                        <span className="team-slot-spec">
                          Especialização: {cfg?.specializationId ?? ag.specializationId ?? 'padrão'}
                        </span>
                        <span className="team-slot-model">
                          {cfg ? `${cfg.provider} · ${cfg.model}` : ag.cli}
                        </span>
                        <span className={`lamp lamp-${isOffline ? 'offline' : 'idle'}`}>
                          {isOffline ? `CLI indisponível (${ag.cli})` : `CLI pronto (${ag.cli})`}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="git-empty">Agente não encontrado.</p>
                  )}
                </div>
              )
            })}
          </div>

          {!teamReady && (
            <div className="team-selector-warning" role="alert">
              <span>
                ⚠ {offlineTeamAgents.length > 0
                  ? `CLI indisponível para: ${offlineTeamAgents.map((a) => a.name).join(', ')}. Verifique a instalação/autenticação antes de iniciar a missão.`
                  : 'Selecione agentes ativos válidos para as 3 etapas.'}
              </span>
              <button type="button" className="btn-quiet" disabled={!online} onClick={verifyTeamClis}>
                Verificar CLIs da equipe
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
                        disabled={!online || !teamReady}
                        title={
                          teamReady
                            ? `Iniciar missão com ${effectivePlannerId} → ${effectiveDevId} → ${effectiveQaId}`
                            : 'Verifique a disponibilidade do CLI da equipe selecionada antes de iniciar'
                        }
                        onClick={() => startMissionForTask(t.id)}
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

function phaseLabel(mission: MissionInfo) {
  const pId = mission.plannerId ?? 'architect'
  const dId = mission.devId ?? 'dev'
  const qId = mission.qaId ?? 'qa'
  const plannerName = mission.teamSnapshot?.[pId]?.name ?? pId
  const devName = mission.teamSnapshot?.[dId]?.name ?? dId
  const qaName = mission.teamSnapshot?.[qId]?.name ?? qId
  switch (mission.phase) {
    case 'planning':
      return `Planejando (${plannerName})`
    case 'awaiting_clarification':
      return `Aguardando esclarecimento (${plannerName})`
    case 'awaiting_approval':
      return 'Aguardando aprovação'
    case 'developing':
      return `Implementando (${devName})`
    case 'reviewing':
      return `Revisando (${qaName})`
    default:
      return mission.phase
  }
}

function stepDescription(mission: MissionInfo) {
  const pId = mission.plannerId ?? 'architect'
  const dId = mission.devId ?? 'dev'
  const qId = mission.qaId ?? 'qa'
  const planner = mission.teamSnapshot?.[pId]
  const dev = mission.teamSnapshot?.[dId]
  const qa = mission.teamSnapshot?.[qId]
  switch (mission.phase) {
    case 'planning':
      return `${planner?.name ?? pId} (${planner?.provider ?? 'CLI'}) está inspecionando o projeto e elaborando o plano...`
    case 'developing':
      return `${dev?.name ?? dId} (${dev?.provider ?? 'CLI'}) está implementando as alterações no código...`
    case 'reviewing':
      return `${qa?.name ?? qId} (${qa?.provider ?? 'CLI'}) está revisando a qualidade, bugs e segurança do código...`
    default:
      return ''
  }
}
