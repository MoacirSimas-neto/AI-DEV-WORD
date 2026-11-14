import { type FormEvent, useEffect, useState } from 'react'
import { isOpenMission } from '../../../shared/missionPhases.ts'
import type {
  AgentConfig,
  AgentInfo,
  ChatMissionLink,
  MissionInfo,
  MissionSpecialistSelection,
  MissionTeamSelection,
  SpecialistRole,
  SpecialistTiming,
  TaskInfo,
  TaskInput,
  TaskPriority,
  TaskStatus,
} from '../../../shared/protocol.ts'
import { MAX_MISSION_SPECIALISTS } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'
import { AgentPortrait } from './AgentPortrait.tsx'
import { Markdown } from './chat/markdown.tsx'
import { ClarificationBox } from './ClarificationBox.tsx'
import { DynamicMissionMonitor } from './DynamicMissionMonitor.tsx'
import { DYNAMIC_PHASE_LABEL, startMessage } from './dynamicView.ts'

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
  /** Etapa 12.2: missões nascidas de conversas (origem + voltar ao chat). */
  chatLinks?: ChatMissionLink[]
  onOpenChat?: (conversationId: number) => void
  onOpenChatNew?: () => void
  onOpenObservability?: (missionId: number) => void
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
  chatLinks = [],
  onOpenChat,
  onOpenChatNew,
  onOpenObservability,
}: Props) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [agentId, setAgentId] = useState<string>('')
  const [liveOutput, setLiveOutput] = useState<{ missionId: number; text: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showManualForm, setShowManualForm] = useState(false)
  const [expandedTasks, setExpandedTasks] = useState<Record<number, boolean>>({})

  // Modo da missão: clássico (pipeline) ou dinâmico (Tech Lead propõe a equipe e os passos).
  const [missionMode, setMissionMode] = useState<'pipeline' | 'dynamic'>('pipeline')
  const [leadId, setLeadId] = useState<string>('architect')

  // Seleção de equipe para Modo Equipe
  const [useDefaultTeam, setUseDefaultTeam] = useState<boolean>(true)
  const [plannerId, setPlannerId] = useState<string>('architect')
  const [devId, setDevId] = useState<string>('dev')
  const [qaId, setQaId] = useState<string>('qa')
  const [specialists, setSpecialists] = useState<MissionSpecialistSelection[]>([])
  const [addingSpecialist, setAddingSpecialist] = useState<boolean>(false)
  const [newSpecAgentId, setNewSpecAgentId] = useState<string>('')
  const [newSpecRole, setNewSpecRole] = useState<SpecialistRole>('database')
  const [newSpecTiming, setNewSpecTiming] = useState<SpecialistTiming>('pre-dev')
  const [newSpecContribution, setNewSpecContribution] = useState<string>('')

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
      isOpenMission(m),
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

  const offlineTeamAgents = [effectivePlannerId, effectiveDevId, effectiveQaId, ...specialists.map(s => s.agentId)]
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is AgentInfo => !a || a.state === 'offline')

  const missingRoleSelection =
    !agents.some((a) => a.id === effectivePlannerId) ||
    !agents.some((a) => a.id === effectiveDevId) ||
    !agents.some((a) => a.id === effectiveQaId)

  const lead = agents.find((a) => a.id === leadId)
  const dynamic = missionMode === 'dynamic'
  const teamReady = dynamic ? Boolean(lead && lead.state !== 'offline') : !missingRoleSelection && offlineTeamAgents.length === 0

  const verifyTeamClis = () => {
    for (const id of new Set([effectivePlannerId, effectiveDevId, effectiveQaId, ...specialists.map(s => s.agentId)])) {
      send({ type: 'check-cli', agentId: id })
    }
  }

  const startMissionForTask = (taskId: number) => {
    setNotice(null)
    if (dynamic) {
      send(startMessage(taskId, 'dynamic', leadId))
      return
    }
    const team: MissionTeamSelection | undefined = useDefaultTeam
      ? undefined
      : {
          plannerId: effectivePlannerId,
          devId: effectiveDevId,
          qaId: effectiveQaId,
          specialists: specialists.length > 0 ? specialists : undefined,
        }
    send({ type: 'mission-start', taskId, team })
  }

  const addSpecialist = () => {
    if (!newSpecAgentId || specialists.length >= MAX_MISSION_SPECIALISTS) return
    if (specialists.some((s) => s.agentId === newSpecAgentId)) {
      setNotice('Este especialista já foi adicionado.')
      return
    }
    if ([effectivePlannerId, effectiveDevId, effectiveQaId].includes(newSpecAgentId)) {
      setNotice('O agente já possui função principal na missão.')
      return
    }
    setSpecialists([
      ...specialists,
      {
        agentId: newSpecAgentId,
        role: newSpecRole,
        timing: newSpecTiming,
        expectedContribution: newSpecContribution.trim() || undefined,
      },
    ])
    setNewSpecAgentId('')
    setNewSpecContribution('')
    setAddingSpecialist(false)
  }

  const removeSpecialist = (agentIdToRemove: string) => {
    setSpecialists(specialists.filter((s) => s.agentId !== agentIdToRemove))
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
    <aside className="window task-panel-window">
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

      {/* Missão dinâmica ativa: propostas, passos e decisões */}
      {activeMission?.mode === 'dynamic' && (
        <section className="mission-card">
          <DynamicMissionMonitor
            mission={activeMission}
            task={tasks.find((t) => t.id === activeMission.taskId) ?? null}
            agents={agents}
            configs={configs}
            online={online}
            send={send}
            subscribe={subscribe}
            liveOutput={liveOutput?.missionId === activeMission.id ? liveOutput.text : undefined}
            origin={chatLinks.find((l) => l.missionId === activeMission.id) ?? null}
            onOpenChat={onOpenChat}
            onOpenObservability={onOpenObservability ? () => onOpenObservability(activeMission.id) : undefined}
          />
        </section>
      )}

      {/* Missao Ativa / Modo Equipe */}
      {activeMission && activeMission.mode !== 'dynamic' && (
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

      {/* Barra principal de ação (Etapa 12.4.1) */}
      {activeProjectId && (
        <div className="task-hero-bar">
          <div className="task-hero-actions">
            {onOpenChatNew && (
              <button type="button" onClick={onOpenChatNew}>
                💬 Conversar com Tech Lead
              </button>
            )}
            <button type="button" className="btn-quiet" onClick={() => setShowManualForm((v) => !v)}>
              {showManualForm || editingId ? 'Ocultar formulário manual' : '+ Nova tarefa manual'}
            </button>
          </div>
        </div>
      )}

      {/* Modo da missão & equipe (recolhível por padrão) */}
      {activeProjectId && !activeMission && (
        <details className="task-advanced-panel">
          <summary className="task-advanced-summary">
            <span>⚙ Configurações avançadas da missão</span>
            <span className="task-advanced-hint">
              Modo: {dynamic ? 'Dinâmico' : 'Clássico'} · {useDefaultTeam ? 'Equipe padrão' : 'Equipe personalizada'}
            </span>
          </summary>
          <section className="mode-selector" aria-label="Modo da missão">
          <h3>Como a equipe vai trabalhar</h3>
          <div className="mode-options" role="radiogroup">
            <label className={`mode-option ${!dynamic ? 'is-selected' : ''}`}>
              <input type="radio" name="mission-mode" checked={!dynamic} onChange={() => setMissionMode('pipeline')} />
              <span>
                <strong>Clássico</strong>
                <small>Equipe fixa em sequência: planejamento, desenvolvimento e revisão QA. Você aprova o plano uma vez.</small>
              </span>
            </label>
            <label className={`mode-option ${dynamic ? 'is-selected' : ''}`}>
              <input type="radio" name="mission-mode" checked={dynamic} onChange={() => setMissionMode('dynamic')} />
              <span>
                <strong>Dinâmico</strong>
                <small>
                  O Tech Lead propõe a equipe e os passos, e replaneja quando algo trava. Toda mudança de equipe e todo plano novo
                  esperam a sua aprovação. Pode fazer mais chamadas aos CLIs que o modo clássico.
                </small>
              </span>
            </label>
          </div>
          {dynamic && (
            <div className="mode-lead-row">
              <label htmlFor="dyn-lead">Tech Lead</label>
              <select id="dyn-lead" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                {planners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.state === 'offline' ? 'CLI offline' : 'disponível'})
                  </option>
                ))}
              </select>
              {!teamReady && (
                <button type="button" className="btn-quiet btn-xs" disabled={!online} onClick={() => send({ type: 'check-cli', agentId: leadId })}>
                  Verificar CLI
                </button>
              )}
              <p className="dyn-dim">O objetivo da missão é a tarefa escolhida abaixo (título e descrição).</p>
            </div>
          )}
        </section>

      {/* Seletor de Equipe Responsável para Modo Equipe */}
      {!dynamic && (
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
                        roleOrName={`${ag.name} ${ag.role} ${cfg?.specializationId ?? ag.specializationId ?? ''}`}
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

          {/* Especialistas Opcionais da Missão (Etapa 7) */}
          <div className="team-specialists-section">
            <div className="team-specialists-head">
              <h4>Especialistas Adicionais ({specialists.length}/{MAX_MISSION_SPECIALISTS})</h4>
              {!useDefaultTeam && specialists.length < MAX_MISSION_SPECIALISTS && !addingSpecialist && (
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => setAddingSpecialist(true)}
                >
                  + Adicionar Especialista
                </button>
              )}
            </div>

            {specialists.length > 0 && (
              <div className="team-specialists-list">
                {specialists.map((s) => {
                  const ag = agents.find((a) => a.id === s.agentId)
                  return (
                    <div key={s.agentId} className="team-specialist-chip">
                      <strong>{ag?.name || s.agentId}</strong>
                      <span className="spec-role-tag">{s.role}</span>
                      <span className="spec-timing-tag">{s.timing === 'pre-dev' ? 'Pré-Dev (Análise)' : 'Pós-Dev (Revisão)'}</span>
                      <button
                        type="button"
                        className="btn-quiet chip-remove"
                        aria-label={`Remover especialista ${s.agentId}`}
                        onClick={() => removeSpecialist(s.agentId)}
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {addingSpecialist && (
              <div className="team-specialist-form">
                <h5>Novo Especialista na Missão</h5>
                <div className="specialist-form-row">
                  <select
                    value={newSpecAgentId}
                    onChange={(e) => setNewSpecAgentId(e.target.value)}
                  >
                    <option value="">Selecione um agente...</option>
                    {agents
                      .filter((a) => ![effectivePlannerId, effectiveDevId, effectiveQaId, ...specialists.map((s) => s.agentId)].includes(a.id))
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.role})
                        </option>
                      ))}
                  </select>

                  <select
                    value={newSpecRole}
                    onChange={(e) => setNewSpecRole(e.target.value as SpecialistRole)}
                  >
                    <option value="database">Banco de Dados</option>
                    <option value="security">Segurança</option>
                    <option value="ui">Design / UI</option>
                    <option value="docs">Documentação</option>
                    <option value="api">APIs / Integrações</option>
                    <option value="testing">Testes Automatizados</option>
                    <option value="data">Dados / BI</option>
                    <option value="custom">Personalizado</option>
                  </select>

                  <select
                    value={newSpecTiming}
                    onChange={(e) => setNewSpecTiming(e.target.value as SpecialistTiming)}
                  >
                    <option value="pre-dev">Antes do Dev (Análise/Schema)</option>
                    <option value="post-dev">Depois do Dev (Revisão Especializada)</option>
                  </select>
                </div>

                <input
                  type="text"
                  placeholder="Contribuição esperada (ex: Modelagem de entidades, checagem de vulnerabilidades)"
                  value={newSpecContribution}
                  onChange={(e) => setNewSpecContribution(e.target.value)}
                  maxLength={200}
                />

                <div className="specialist-form-actions">
                  <button
                    type="button"
                    disabled={!newSpecAgentId}
                    onClick={addSpecialist}
                  >
                    Confirmar Especialista
                  </button>
                  <button
                    type="button"
                    className="btn-quiet"
                    onClick={() => {
                      setAddingSpecialist(false)
                      setNewSpecAgentId('')
                      setNewSpecContribution('')
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
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
        </details>
      )}

      {/* Formulario de Criar / Editar (secundário) */}
      {activeProjectId && (showManualForm || editingId !== null) && (
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
            const isLong = Boolean(t.description && (t.description.length > 220 || t.description.split('\n').length > 4))
            const isExpanded = Boolean(expandedTasks[t.id])
            const latestClosedMission = missions
              .filter((m) => m.taskId === t.id && !isOpenMission(m))
              .sort((a, b) => b.id - a.id)[0]
            const footer = (
              <div className="task-footer">
                <span className="task-assignee">
                  {assigned ? `Atribuído: ${assigned.name}` : 'Sem agente'}
                </span>
                <div className="task-actions">
                  {latestClosedMission && onOpenObservability && (
                    <button
                      type="button"
                      className="btn-quiet"
                      onClick={() => onOpenObservability(latestClosedMission.id)}
                    >
                      Histórico da Missão #{latestClosedMission.id}
                    </button>
                  )}
                  {canStartMission && (
                    <button
                      type="button"
                      disabled={!online || !teamReady}
                      title={
                        !teamReady
                          ? 'Verifique a disponibilidade do CLI antes de iniciar'
                          : dynamic
                            ? `Iniciar missão dinâmica com ${lead?.name ?? leadId} como Tech Lead`
                            : `Iniciar missão com ${effectivePlannerId} → ${effectiveDevId} → ${effectiveQaId}`
                      }
                      onClick={() => startMissionForTask(t.id)}
                    >
                      {dynamic ? 'Missão dinâmica' : 'Modo Equipe'}
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
            )
            const expandBtn = isLong ? (
              <button
                type="button"
                className="btn-quiet btn-xs task-expand-btn"
                aria-expanded={isExpanded}
                onClick={() => setExpandedTasks((prev) => ({ ...prev, [t.id]: !isExpanded }))}
              >
                {isExpanded ? 'Ver menos' : 'Ver mais'}
              </button>
            ) : null
            return (
              <li key={t.id} className={`task-item task-priority-${t.priority} ${isExpanded ? 'is-expanded' : ''}`}>
                <div className="task-item-head">
                  <span
                    className={`task-status-pill status-${t.status}`}
                    title={
                      t.status === 'review' && latestClosedMission
                        ? `Missão #${latestClosedMission.id} concluída pelos agentes (${DYNAMIC_PHASE_LABEL[latestClosedMission.phase] ?? latestClosedMission.phase}); aguardando sua revisão antes de marcar como Concluída.`
                        : undefined
                    }
                  >
                    {STATUS_LABEL[t.status]}
                  </span>
                  <strong>{t.title}</strong>
                  {t.status === 'review' && latestClosedMission && (
                    <span className="task-review-hint">
                      Missão #{latestClosedMission.id} concluída · aguardando revisão humana
                    </span>
                  )}
                  <span className="task-priority-tag">{PRIORITY_LABEL[t.priority]}</span>
                </div>
                {isExpanded && footer}
                {isExpanded && expandBtn}
                {t.description && (
                  <div className={`task-desc task-desc-markdown ${isLong && !isExpanded ? 'is-collapsed' : ''}`}>
                    <Markdown text={t.description} />
                  </div>
                )}
                {!isExpanded && expandBtn}
                {!isExpanded && footer}
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
      return DYNAMIC_PHASE_LABEL[mission.phase] ?? mission.phase
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
