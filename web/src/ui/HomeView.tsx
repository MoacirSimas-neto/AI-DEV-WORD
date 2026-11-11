import { computeMissionProgress } from '../../../shared/missionProgress.ts'
import type {
  ActivityEntry,
  AgentConfig,
  AgentInfo,
  GitStatus,
  MissionInfo,
  TaskInfo,
  Workspace,
} from '../../../shared/protocol.ts'
import type { Send } from '../net/useServer.ts'
import { AgentPortrait } from './AgentPortrait.tsx'
import { stateOf } from './agentText.ts'

interface Props {
  workspace: Workspace
  agents: AgentInfo[]
  configs: AgentConfig[]
  tasks: TaskInfo[]
  missions: MissionInfo[]
  history: ActivityEntry[]
  gitStatus: GitStatus | null
  online: boolean
  send: Send
  onNavigateOffice: () => void
  onSelectAgentInOffice: (agentId: string) => void
  onNavigateTasks: () => void
  onNavigateHistory: () => void
  onNavigateAgents: () => void
}

export function HomeView({
  workspace,
  agents,
  configs,
  tasks,
  missions,
  history,
  gitStatus,
  online,
  send,
  onNavigateOffice,
  onSelectAgentInOffice,
  onNavigateTasks,
  onNavigateHistory,
  onNavigateAgents,
}: Props) {
  const { projects, activeProjectId } = workspace
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  // Métricas reais do sistema
  const runningAgentsCount = agents.filter(
    (a) => a.session || ['working', 'planning', 'reviewing'].includes(a.state),
  ).length
  const activeMissions = missions.filter((m) =>
    ['planning', 'awaiting_approval', 'developing', 'reviewing'].includes(m.phase),
  )
  const completedMissionsCount = missions.filter((m) => m.phase === 'done').length
  const pendingTasksCount = tasks.filter((t) => t.status !== 'done').length
  const pendingApprovalsCount = missions.filter((m) => m.phase === 'awaiting_approval').length

  // Missão em destaque (ativa do projeto atual, ou qualquer ativa, ou última missão)
  const featuredMission =
    activeMissions.find((m) => m.projectId === activeProjectId) ??
    activeMissions[0] ??
    missions.find((m) => m.projectId === activeProjectId) ??
    missions[0] ??
    null

  const missionProgress = computeMissionProgress(featuredMission)
  const featuredTask = featuredMission ? tasks.find((t) => t.id === featuredMission.taskId) : null
  const featuredProject = featuredMission
    ? projects.find((p) => p.id === featuredMission.projectId)
    : activeProject

  return (
    <div className="command-center">
      {/* Banner Hero de Operações */}
      <section className="cc-hero">
        <div className="cc-hero-text">
          <span className="cc-eyebrow">CENTRAL DE OPERAÇÕES LOCAL</span>
          <h2>Command Center & Living Agent Office</h2>
          <p>
            Coordene agentes reais via CLI local (Gemini, Codex e Antigravity), acompanhe missões em etapas verificáveis
            e controle seu repositório Git com transparência total.
          </p>
        </div>
        <div className="cc-quick-actions">
          <button type="button" className="btn-primary-glow" onClick={onNavigateOffice}>
            ▶ Entrar no Escritório 2D
          </button>
          <button type="button" onClick={onNavigateTasks}>
            + Nova Tarefa / Missão
          </button>
          <button type="button" className="btn-quiet" onClick={onNavigateAgents}>
            ⚙ Central de Agentes
          </button>
          <button type="button" className="btn-quiet" onClick={onNavigateHistory}>
            ☰ Histórico
          </button>
        </div>
      </section>

      {/* Grade de Indicadores Operacionais (KPIs Reais) */}
      <section className="cc-kpi-grid" aria-label="Métricas operacionais">
        <div className="cc-kpi-card">
          <span className="cc-kpi-value">{projects.length}</span>
          <span className="cc-kpi-label">Projetos Cadastrados</span>
        </div>
        <div className="cc-kpi-card">
          <span className="cc-kpi-value">{agents.length}</span>
          <span className="cc-kpi-label">Agentes Configurados</span>
        </div>
        <div className={`cc-kpi-card ${runningAgentsCount > 0 ? 'kpi-highlight-mint' : ''}`}>
          <span className="cc-kpi-value">{runningAgentsCount}</span>
          <span className="cc-kpi-label">Agentes em Execução</span>
        </div>
        <div className={`cc-kpi-card ${activeMissions.length > 0 ? 'kpi-highlight-cyan' : ''}`}>
          <span className="cc-kpi-value">{activeMissions.length}</span>
          <span className="cc-kpi-label">Missões em Andamento</span>
        </div>
        <div className="cc-kpi-card">
          <span className="cc-kpi-value">{completedMissionsCount}</span>
          <span className="cc-kpi-label">Missões Concluídas</span>
        </div>
        <div className="cc-kpi-card">
          <span className="cc-kpi-value">{pendingTasksCount}</span>
          <span className="cc-kpi-label">Tarefas Pendentes</span>
        </div>
        <div className={`cc-kpi-card ${pendingApprovalsCount > 0 ? 'kpi-highlight-amber' : ''}`}>
          <span className="cc-kpi-value">{pendingApprovalsCount}</span>
          <span className="cc-kpi-label">Aprovações Pendentes</span>
        </div>
      </section>

      {/* Grade Principal em 2 Colunas: Missão Principal + Equipe de Agentes */}
      <div className="cc-main-grid">
        {/* Card de Missão Principal */}
        <section className="cc-panel cc-featured-mission">
          <header className="cc-panel-head">
            <div>
              <h3>Missão em Destaque</h3>
              <p>Fluxo supervisionado: Arquiteto → Aprovação → Desenvolvedor → Revisão QA</p>
            </div>
            {featuredMission && (
              <span className={`mission-status-pill phase-${featuredMission.phase}`}>
                {missionProgress.statusLabel}
              </span>
            )}
          </header>

          {!featuredMission ? (
            <div className="cc-empty-mission">
              <p className="cc-empty-title">Nenhuma missão registrada ainda</p>
              <p className="cc-empty-sub">
                Selecione um projeto, crie uma tarefa e inicie o <strong>Modo Equipe</strong> para ver o progresso
                verificado etapa por etapa.
              </p>
              <div className="cc-empty-actions">
                <button type="button" onClick={onNavigateTasks}>
                  Criar Tarefa e Iniciar Missão
                </button>
                <button type="button" className="btn-quiet" onClick={onNavigateOffice}>
                  Ir para o Escritório
                </button>
              </div>
            </div>
          ) : (
            <div className="cc-mission-body">
              <div className="cc-mission-meta">
                <span className="mission-id-badge">Missão #{featuredMission.id}</span>
                {featuredProject && <span className="cc-project-tag">📁 {featuredProject.name}</span>}
              </div>
              <h4 className="cc-mission-title">
                {featuredTask ? featuredTask.title : `Tarefa #${featuredMission.taskId}`}
              </h4>
              {featuredTask?.description && <p className="cc-mission-desc">{featuredTask.description}</p>}

              <div className="mission-progress-block">
                <div className="mission-progress-labels">
                  <span>
                    Progresso verificado: {missionProgress.completedSteps} de {missionProgress.totalSteps} etapas
                    concluídas
                  </span>
                  <strong>{missionProgress.percent}%</strong>
                </div>
                <div
                  className={`mission-progress-track ${missionProgress.isRunning ? 'is-running' : ''} ${missionProgress.isInterrupted ? 'is-interrupted' : ''}`}
                >
                  <div className="mission-progress-fill" style={{ width: `${missionProgress.percent}%` }} />
                </div>
              </div>

              <div className="cc-stage-pills">
                {missionProgress.stages.map((st, i) => (
                  <div key={st.id} className={`cc-stage-pill stage-status-${st.status}`}>
                    <span className="cc-stage-idx">{i + 1}</span>
                    <span>{st.label}</span>
                  </div>
                ))}
              </div>

              <div className="cc-mission-footer">
                {featuredMission.phase === 'awaiting_approval' && (
                  <>
                    <button
                      type="button"
                      disabled={!online}
                      onClick={() => send({ type: 'mission-approve', missionId: featuredMission.id })}
                    >
                      ✓ Aprovar Plano e Iniciar Dev
                    </button>
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={!online}
                      onClick={() => send({ type: 'mission-cancel', missionId: featuredMission.id })}
                    >
                      Rejeitar
                    </button>
                  </>
                )}
                <button type="button" className="btn-quiet" onClick={onNavigateOffice}>
                  Acompanhar no Escritório 2D →
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Equipe de Agentes */}
        <section className="cc-panel">
          <header className="cc-panel-head">
            <div>
              <h3>Esquadrão de Agentes</h3>
              <p>Estado em tempo real e configuração individual de provedor/modelo</p>
            </div>
            <button type="button" className="btn-quiet" onClick={onNavigateAgents}>
              Configurar Modelos
            </button>
          </header>

          <div className="cc-agents-grid">
            {agents.map((agent) => {
              const st = stateOf(agent)
              const cfg = configs.find((c) => c.agentId === agent.id)
              return (
                <div key={agent.id} className="cc-agent-card">
                  <div className="cc-agent-top">
                    <AgentPortrait agentId={agent.id} dimmed={agent.state === 'offline'} />
                    <div className="cc-agent-id">
                      <strong>{agent.name}</strong>
                      <span className="cc-agent-role">{agent.role}</span>
                      <span className={`lamp lamp-${st.tone}`}>{st.label}</span>
                    </div>
                  </div>
                  <div className="cc-agent-specs">
                    <span className="cc-spec-pill" title="Provedor e modelo configurados para este agente">
                      Config: {cfg ? `${cfg.provider} · ${cfg.model}` : agent.cli}
                    </span>
                    <span className="cc-spec-pill">
                      CLI: {agent.cliVersion ? agent.cliVersion : agent.cli}
                    </span>
                  </div>
                  <p className="cc-agent-msg">{agent.message}</p>
                  <div className="cc-agent-actions">
                    <button
                      type="button"
                      className="btn-quiet"
                      onClick={() => onSelectAgentInOffice(agent.id)}
                    >
                      Abrir Terminal no Escritório
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {/* Grade Secundária: Projetos Recentes & Git + Linha do Tempo */}
      <div className="cc-bottom-grid">
        {/* Projetos Cadastrados */}
        <section className="cc-panel">
          <header className="cc-panel-head">
            <div>
              <h3>Projetos Locais & Estado Git</h3>
              <p>Selecione o diretório onde os agentes executam comandos</p>
            </div>
            <button type="button" className="btn-quiet" onClick={onNavigateTasks}>
              Gerenciar Tarefas ({pendingTasksCount})
            </button>
          </header>

          {projects.length === 0 ? (
            <p className="git-empty">
              Nenhum projeto adicionado. Use a barra superior para procurar ou adicionar uma pasta local.
            </p>
          ) : (
            <ul className="cc-project-list">
              {projects.map((proj) => {
                const isActive = proj.id === activeProjectId
                const projTasks = tasks.filter((t) => t.projectId === proj.id)
                return (
                  <li key={proj.id} className={`cc-project-item ${isActive ? 'is-active' : ''}`}>
                    <div className="cc-project-info">
                      <div className="cc-project-title-row">
                        <strong>{proj.name}</strong>
                        {isActive && <span className="cc-active-badge">Projeto Ativo</span>}
                        <span className="cc-task-count-badge">{projTasks.length} tarefa(s)</span>
                      </div>
                      <span className="cc-project-path">{proj.path}</span>
                      {isActive && gitStatus && (
                        <div className="cc-project-git-row">
                          {gitStatus.isRepo ? (
                            <>
                              <span className="git-branch-pill">⎇ {gitStatus.branch ?? 'HEAD'}</span>
                              <span className="git-badge-summary">
                                {gitStatus.files.length} arquivo(s) alterado(s)
                              </span>
                              <span className={`git-remote-badge remote-${gitStatus.remoteState}`}>
                                {gitStatus.remoteState === 'configured'
                                  ? `Remote: ${gitStatus.remoteName ?? 'origin'}`
                                  : gitStatus.remoteState === 'none'
                                    ? 'Apenas Git Local'
                                    : 'Remote ?'}
                              </span>
                            </>
                          ) : (
                            <span className="git-empty">Pasta sem repositório Git</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="cc-project-actions">
                      {!isActive ? (
                        <button
                          type="button"
                          disabled={!online}
                          onClick={() => send({ type: 'project-select', projectId: proj.id })}
                        >
                          Ativar
                        </button>
                      ) : (
                        <button type="button" className="btn-quiet" onClick={onNavigateOffice}>
                          Abrir no Escritório
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Linha do Tempo de Atividades Recentes */}
        <section className="cc-panel">
          <header className="cc-panel-head">
            <div>
              <h3>Linha do Tempo Operacional</h3>
              <p>Últimos eventos persistidos no SQLite local</p>
            </div>
            <button type="button" className="btn-quiet" onClick={onNavigateHistory}>
              Ver tudo ({history.length})
            </button>
          </header>

          {history.length === 0 ? (
            <p className="git-empty">Nenhuma atividade registrada ainda.</p>
          ) : (
            <ul className="cc-timeline">
              {history.slice(0, 7).map((entry) => (
                <li key={entry.id} className={`cc-timeline-item history-${entry.kind}`}>
                  <div className="cc-timeline-head">
                    <span className="history-kind-badge">{entry.kind.toUpperCase()}</span>
                    <span className="history-time">{formatShortTime(entry.at)}</span>
                  </div>
                  <p className="cc-timeline-msg">{entry.message}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function formatShortTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}
