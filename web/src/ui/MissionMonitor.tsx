import { useEffect, useState } from 'react'
import { computeMissionProgress } from '../../../shared/missionProgress.ts'
import type { AgentConfig, AgentInfo, MissionInfo, TaskInfo } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'
import { ClarificationBox } from './ClarificationBox.tsx'

interface Props {
  missions: MissionInfo[]
  tasks: TaskInfo[]
  agents: AgentInfo[]
  configs: AgentConfig[]
  activeProjectId: number | null
  projectName?: string
  online: boolean
  send: Send
  subscribe: Subscribe
  collapsed: boolean
  onToggleCollapse: () => void
  onOpenTasks: () => void
}

export function MissionMonitor({
  missions,
  tasks,
  agents,
  configs,
  activeProjectId,
  projectName,
  online,
  send,
  subscribe,
  collapsed,
  onToggleCollapse,
  onOpenTasks,
}: Props) {
  const [selectedMissionId, setSelectedMissionId] = useState<number | null>(null)
  const [liveOutput, setLiveOutput] = useState<Record<number, string>>({})

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'mission-output') {
        setLiveOutput((prev) => ({
          ...prev,
          [msg.missionId]: ((prev[msg.missionId] ?? '') + msg.data).slice(-5000),
        }))
      }
    })
  }, [subscribe])

  const projectMissions = activeProjectId
    ? missions.filter((m) => m.projectId === activeProjectId)
    : missions

  const runningMission = projectMissions.find((m) =>
    ['planning', 'awaiting_approval', 'awaiting_clarification', 'developing', 'reviewing'].includes(m.phase),
  )

  const currentMission =
    projectMissions.find((m) => m.id === selectedMissionId) ??
    runningMission ??
    projectMissions[0] ??
    null

  const progress = computeMissionProgress(currentMission)
  const linkedTask = currentMission ? tasks.find((t) => t.id === currentMission.taskId) : null
  const stageAgentId = currentMission
    ? (progress.activeAgentId ??
      (currentMission.phase === 'done'
        ? (currentMission.qaId || 'qa')
        : currentMission.phase === 'failed'
          ? (currentMission.devId || 'dev')
          : (currentMission.plannerId || 'architect')))
    : null
  const snapEntry = stageAgentId ? currentMission?.teamSnapshot?.[stageAgentId] : undefined
  const activeAgent = stageAgentId ? agents.find((a) => a.id === stageAgentId) : null
  const activeConfig = stageAgentId ? configs.find((c) => c.agentId === stageAgentId) : null
  const displayAgentName = snapEntry?.name ?? activeAgent?.name ?? stageAgentId
  const displayAgentRole = snapEntry?.role ?? activeAgent?.role ?? ''
  const displayProvider = snapEntry?.provider ?? activeConfig?.provider
  const displayModel = snapEntry?.model ?? activeConfig?.model

  if (collapsed) {
    return (
      <aside className="mission-sidebar-collapsed" title="Expandir Monitor de Missão">
        <button type="button" className="btn-expand-sidebar" onClick={onToggleCollapse}>
          <span className="expand-icon">»</span>
          <span className="expand-text">
            Missão {runningMission ? `#${runningMission.id} (${progress.percent}%)` : ''}
          </span>
        </button>
      </aside>
    )
  }

  return (
    <aside className="window mission-monitor-panel">
      <header className="window-head mission-panel-head">
        <div className="window-id">
          <h2>Monitor de Missão</h2>
          <p className="mission-sub">
            {projectName ? `Projeto: ${projectName}` : 'Selecione um projeto ativo'}
          </p>
        </div>
        <button
          type="button"
          className="btn-quiet git-collapse-btn"
          title="Recolher Monitor de Missão"
          aria-label="Recolher monitor de missão"
          onClick={onToggleCollapse}
        >
          «
        </button>
      </header>

      {projectMissions.length > 1 && (
        <div className="mission-selector-row">
          <label htmlFor="mission-select">Missão:</label>
          <select
            id="mission-select"
            value={currentMission?.id ?? ''}
            onChange={(e) => setSelectedMissionId(Number(e.target.value))}
          >
            {projectMissions.map((m) => {
              const t = tasks.find((task) => task.id === m.taskId)
              return (
                <option key={m.id} value={m.id}>
                  #{m.id} · {t ? t.title.slice(0, 28) : `Tarefa #${m.taskId}`} ({m.phase})
                </option>
              )
            })}
          </select>
        </div>
      )}

      {!currentMission ? (
        <div className="mission-empty-state">
          <p className="mission-empty-title">Nenhuma missão iniciada neste projeto</p>
          <p className="mission-empty-desc">
            Crie uma tarefa e acione o <strong>Modo Equipe</strong> para que Arquiteto, Dev e QA trabalhem em sequência supervisionada.
          </p>
          <button type="button" onClick={onOpenTasks}>
            Abrir Tarefas / Iniciar Missão
          </button>
        </div>
      ) : (
        <>
          {/* Cabeçalho da missão selecionada */}
          <section className="mission-overview-card">
            <div className="mission-overview-top">
              <span className="mission-id-badge">Missão #{currentMission.id}</span>
              <span className={`mission-status-pill phase-${currentMission.phase}`}>
                {progress.statusLabel}
              </span>
            </div>
            <h3 className="mission-task-title">
              {linkedTask ? linkedTask.title : `Tarefa #${currentMission.taskId}`}
            </h3>
            {linkedTask?.description && (
              <p className="mission-task-desc">{linkedTask.description}</p>
            )}

            {/* Equipe da missão (snapshot imutável) */}
            <div className="mission-team-summary">
              <span className="mission-team-chip" title="Responsável pelo Planejamento">
                📋 Plan:{' '}
                <strong>
                  {currentMission.teamSnapshot?.[currentMission.plannerId ?? 'architect']?.name ??
                    (currentMission.plannerId ?? 'architect')}
                </strong>
              </span>
              <span className="mission-team-chip" title="Responsável pelo Desenvolvimento">
                💻 Dev:{' '}
                <strong>
                  {currentMission.teamSnapshot?.[currentMission.devId ?? 'dev']?.name ??
                    (currentMission.devId ?? 'dev')}
                </strong>
              </span>
              <span className="mission-team-chip" title="Responsável pela Revisão QA">
                🔍 QA:{' '}
                <strong>
                  {currentMission.teamSnapshot?.[currentMission.qaId ?? 'qa']?.name ??
                    (currentMission.qaId ?? 'qa')}
                </strong>
              </span>
            </div>

            {/* Agente responsável na etapa atual */}
            {displayAgentName && (
              <div className="mission-agent-meta">
                <span>
                  Etapa atual: <strong>{displayAgentName}</strong> {displayAgentRole ? `(${displayAgentRole})` : ''}
                </span>
                {displayProvider && displayModel && (
                  <span className="mission-model-badge" title="Modelo configurado para a missão">
                    Config: {displayProvider} / {displayModel}
                  </span>
                )}
              </div>
            )}

            {/* Barra de progresso verificável por etapas */}
            <div className="mission-progress-block">
              <div className="mission-progress-labels">
                <span>
                  {progress.completedSteps} de {progress.totalSteps} etapas concluídas
                </span>
                <strong>{progress.percent}%</strong>
              </div>
              <div
                className={`mission-progress-track ${progress.isRunning ? 'is-running' : ''} ${progress.isInterrupted ? 'is-interrupted' : ''}`}
                role="progressbar"
                aria-valuenow={progress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="mission-progress-fill"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              {progress.isRunning && (
                <span className="mission-running-indicator">
                  ● Execução em andamento no CLI local (sem estimativa artificial)
                </span>
              )}
            </div>
          </section>

          {/* Timeline operacional de 4 estágios */}
          <section className="mission-timeline-section">
            <h4>Etapas da Operação</h4>
            <ol className="mission-stage-list">
              {progress.stages.map((stage, idx) => (
                <li key={stage.id} className={`mission-stage-item stage-status-${stage.status}`}>
                  <span className="stage-step-num">{idx + 1}</span>
                  <div className="stage-step-body">
                    <strong>{stage.label}</strong>
                    <span className="stage-step-state">{stageStatusText(stage.status)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* Pergunta do planejador ao usuário */}
          <ClarificationBox mission={currentMission} online={online} send={send} />

          {/* Aprovação do Plano (quando em awaiting_approval) */}
          {currentMission.phase === 'awaiting_approval' && (
            <section className="mission-approval-box">
              <div className="mission-approval-head">
                <strong>✋ Plano aguardando sua aprovação</strong>
              </div>
              <pre className="mission-plan-text">{currentMission.plan || 'Sem plano detalhado.'}</pre>
              <div className="mission-actions">
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => send({ type: 'mission-approve', missionId: currentMission.id })}
                >
                  Aprovar e Iniciar Dev
                </button>
                <button
                  type="button"
                  className="btn-quiet"
                  disabled={!online}
                  onClick={() => send({ type: 'mission-cancel', missionId: currentMission.id })}
                >
                  Cancelar
                </button>
              </div>
            </section>
          )}

          {/* Plano aprovado (consulta rápida durante dev/review/done) */}
          {currentMission.plan && currentMission.phase !== 'awaiting_approval' && (
            <details className="mission-details-box">
              <summary>Plano do Arquiteto (concluído)</summary>
              <pre className="mission-plan-text">{currentMission.plan}</pre>
            </details>
          )}

          {/* Saída ao vivo do CLI */}
          {progress.isRunning && (
            <section className="mission-live-box">
              <div className="mission-live-head">
                <strong>Saída em tempo real</strong>
                <button
                  type="button"
                  className="btn-quiet"
                  disabled={!online}
                  onClick={() => send({ type: 'mission-cancel', missionId: currentMission.id })}
                >
                  Interromper
                </button>
              </div>
              <pre className="mission-live-output">
                {liveOutput[currentMission.id] || 'Aguardando stream do agente...'}
              </pre>
            </section>
          )}

          {/* Resultado da Revisão de QA */}
          {currentMission.review && (
            <section className="mission-review-box">
              <div className="mission-live-head">
                <h4>Relatório do QA</h4>
                {(currentMission.attempts?.length ?? 0) > 1 && (
                  <span className="mission-status-pill">{currentMission.attempts!.length}ª tentativa</span>
                )}
                {currentMission.verdictDetail && (
                  <span className="mission-status-pill">{currentMission.verdictDetail}</span>
                )}
              </div>
              <pre className="mission-plan-text">{currentMission.review}</pre>
            </section>
          )}

          {/* Alerta de erro */}
          {currentMission.error && (
            <section className="mission-error-box" role="alert">
              <strong>Erro registrado na missão:</strong>
              <p>{currentMission.error}</p>
            </section>
          )}
        </>
      )}
    </aside>
  )
}

function stageStatusText(status: string): string {
  switch (status) {
    case 'completed':
      return 'Concluída'
    case 'running':
      return 'Em execução…'
    case 'awaiting_approval':
      return 'Aguardando aprovação'
    case 'failed':
      return 'Interrompida'
    default:
      return 'Pendente'
  }
}
