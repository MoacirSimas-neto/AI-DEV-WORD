import { useCallback, useState } from 'react'
import { PhaserGame } from './game/PhaserGame.tsx'
import type { WorldAction } from './game/WorldBridge.ts'
import { useGitStatus } from './net/useGitStatus.ts'
import { type ConnectionStatus, useServer } from './net/useServer.ts'
import { AgentCenter } from './ui/AgentCenter.tsx'
import { AgentWindow } from './ui/AgentWindow.tsx'
import { ErrorBoundary } from './ui/ErrorBoundary.tsx'
import { GitPanel } from './ui/GitPanel.tsx'
import { HistoryPanel } from './ui/HistoryPanel.tsx'
import { HomeView } from './ui/HomeView.tsx'
import { MemoryCenter } from './ui/MemoryCenter.tsx'
import { MissionMonitor } from './ui/MissionMonitor.tsx'
import { ObservabilityCenter } from './ui/ObservabilityCenter.tsx'
import { ProjectBar } from './ui/ProjectBar.tsx'
import { TaskPanel } from './ui/TaskPanel.tsx'
import { TeamRoster } from './ui/TeamRoster.tsx'

const STATUS: Record<ConnectionStatus, { label: string; tone: string }> = {
  connecting: { label: 'Conectando…', tone: 'checking' },
  online: { label: 'Backend conectado', tone: 'idle' },
  offline: { label: 'Backend desconectado', tone: 'error' },
}

export type NavTab = 'home' | 'office' | 'tasks' | 'history' | 'agents' | 'memory' | 'observability'

function App() {
  const {
    status,
    agents,
    workspace,
    tasks,
    missions,
    history,
    configs,
    allConfigs,
    specializations,
    skills,
    skillOverrides,
    send,
    subscribe,
  } = useServer()
  const [activeTab, setActiveTab] = useState<NavTab>('home')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [observabilityMissionId, setObservabilityMissionId] = useState<number | null>(null)
  const [observabilityAgentId, setObservabilityAgentId] = useState<string | null>(null)

  const [missionOpen, setMissionOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('aidw_mission_panel_open') !== 'false'
    } catch {
      return true
    }
  })

  const [gitOpen, setGitOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('aidw_git_panel_open') !== 'false'
    } catch {
      return true
    }
  })

  const online = status === 'online'
  const gitStatus = useGitStatus(send, subscribe, online, workspace.activeProjectId)

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null
  const selectedAgentConfig = configs.find((c) => c.agentId === selectedAgentId)

  const selectAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId)
    setActiveTab('office')
  }, [])

  const handleWorldAction = useCallback((action: WorldAction) => {
    if (action === 'tasks') setActiveTab('tasks')
    else if (action === 'history') setActiveTab('history')
    else if (action === 'agents') setActiveTab('agents')
    else if (action === 'mission') {
      setMissionOpen(true)
      setActiveTab('office')
    }
  }, [])

  const toggleMission = () => {
    setMissionOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem('aidw_mission_panel_open', String(next))
      } catch {}
      return next
    })
  }

  const toggleGit = () => {
    setGitOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem('aidw_git_panel_open', String(next))
      } catch {}
      return next
    })
  }

  const isImmersive = !missionOpen && !gitOpen
  const toggleImmersive = () => {
    const nextOpen = isImmersive
    setMissionOpen(nextOpen)
    setGitOpen(nextOpen)
    try {
      localStorage.setItem('aidw_mission_panel_open', String(nextOpen))
      localStorage.setItem('aidw_git_panel_open', String(nextOpen))
    } catch {}
  }

  const activeProject = workspace.projects?.find((p) => p.id === workspace.activeProjectId)
  const projectTasks =
    workspace.activeProjectId && Array.isArray(tasks)
      ? tasks.filter((t) => t.projectId === workspace.activeProjectId)
      : []
  const activeMissionsCount = Array.isArray(missions)
    ? missions.filter((m) =>
        ['planning', 'awaiting_approval', 'awaiting_clarification', 'developing', 'reviewing'].includes(m.phase),
      ).length
    : 0

  return (
    <ErrorBoundary fallbackTitle="Falha geral na interface do AI Dev World">
      <div className="app">
        {/* Barra Superior de Navegação e Status Global */}
        <header className="topbar">
          <div className="topbar-brand" onClick={() => setActiveTab('home')} role="button" tabIndex={0}>
            <div className="brand-badge">AI</div>
            <div>
              <h1>AI Dev World</h1>
              <p className="tagline">Command Center & Living Pixel Art Office</p>
            </div>
          </div>

          <nav className="main-nav" aria-label="Navegação principal">
            <button
              type="button"
              className={`nav-tab ${activeTab === 'home' ? 'nav-tab-active' : ''}`}
              onClick={() => setActiveTab('home')}
            >
              Home
            </button>
            <button
              type="button"
              className={`nav-tab ${activeTab === 'office' ? 'nav-tab-active' : ''}`}
              onClick={() => setActiveTab('office')}
            >
              Escritório 2D
              {activeMissionsCount > 0 && <span className="nav-pill nav-pill-cyan">{activeMissionsCount}</span>}
            </button>
            <button
              type="button"
              className={`nav-tab ${activeTab === 'tasks' ? 'nav-tab-active' : ''}`}
              onClick={() => setActiveTab('tasks')}
            >
              Projetos e Tarefas
              {projectTasks.length > 0 && <span className="nav-pill">{projectTasks.length}</span>}
            </button>
            <button
              type="button"
              className={`nav-tab ${activeTab === 'history' ? 'nav-tab-active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              Histórico
            </button>
            <button
              type="button"
              className={`nav-tab ${activeTab === 'agents' ? 'nav-tab-active' : ''}`}
              onClick={() => setActiveTab('agents')}
            >
              Central de Agentes
            </button>
            <button
              type="button"
              className={`nav-tab ${activeTab === 'memory' ? 'nav-tab-active' : ''}`}
              onClick={() => setActiveTab('memory')}
            >
              Memória
            </button>
            <button
              type="button"
              className={`nav-tab ${activeTab === 'observability' ? 'nav-tab-active' : ''}`}
              onClick={() => {
                setObservabilityMissionId(null)
                setObservabilityAgentId(null)
                setActiveTab('observability')
              }}
            >
              Observabilidade
            </button>
          </nav>

          <div className="topbar-status">
            <span className={`lamp lamp-${STATUS[status].tone}`}>{STATUS[status].label}</span>
          </div>
        </header>

        {status === 'offline' && (
          <p className="banner">
            Sem conexão com o backend local. Inicie tudo com <code>npm run dev</code> na raiz do projeto.
          </p>
        )}

        {/* Seletor de Projeto Ativo (sempre acessível no topo) */}
        <ErrorBoundary fallbackTitle="Falha na barra de projetos">
          <ProjectBar
            workspace={workspace}
            online={online}
            changes={gitStatus?.isRepo ? gitStatus.files.length : null}
            taskCount={projectTasks.length}
            gitOpen={gitOpen}
            onToggleGit={() => {
              if (activeTab !== 'office') setActiveTab('office')
              toggleGit()
            }}
            onOpenTasks={() => setActiveTab('tasks')}
            onOpenHistory={() => setActiveTab('history')}
            onOpenAgentCenter={() => setActiveTab('agents')}
            send={send}
            subscribe={subscribe}
          />
        </ErrorBoundary>

        {/* ABA 1: HOME (COMMAND CENTER) */}
        {activeTab === 'home' && (
          <ErrorBoundary fallbackTitle="Falha na Home Command Center">
            <HomeView
              workspace={workspace}
              agents={agents}
              configs={configs}
              tasks={tasks}
              missions={missions}
              history={history}
              gitStatus={gitStatus}
              online={online}
              send={send}
              onNavigateOffice={() => setActiveTab('office')}
              onSelectAgentInOffice={selectAgent}
              onNavigateTasks={() => setActiveTab('tasks')}
              onNavigateHistory={() => setActiveTab('history')}
              onNavigateAgents={() => setActiveTab('agents')}
            />
          </ErrorBoundary>
        )}

        {/* ABA 2: ESCRITÓRIO 2D (3 COLUNAS) — mantido montado no DOM para preservar o canvas Phaser e sessões */}
        <div
          className={`office-tri-layout ${activeTab !== 'office' ? 'view-hidden' : ''} ${missionOpen ? 'mission-open' : 'mission-closed'} ${gitOpen ? 'git-open' : 'git-closed'}`}
        >
          {/* Coluna Esquerda: Monitor de Missão */}
          <div className="office-left-sidebar">
            <ErrorBoundary fallbackTitle="Falha no Monitor de Missão">
              <MissionMonitor
                missions={missions}
                tasks={tasks}
                agents={agents}
                configs={configs}
                activeProjectId={workspace.activeProjectId}
                projectName={activeProject?.name}
                online={online}
                send={send}
                subscribe={subscribe}
                collapsed={!missionOpen}
                onToggleCollapse={toggleMission}
                onOpenTasks={() => setActiveTab('tasks')}
                onOpenObservability={(mId) => {
                  setObservabilityMissionId(mId)
                  setObservabilityAgentId(null)
                  setActiveTab('observability')
                }}
              />
            </ErrorBoundary>
          </div>

          {/* Coluna Central: Living Agent World + Roster + Terminal do Agente */}
          <div className="office-center-stage">
            <div className="office-stage-toolbar">
              <div className="office-stage-title">
                <span className="stage-live-dot" />
                <strong>Living Agent Office</strong>
                <span className="stage-hint">
                  Clique em um agente, mesa, quadro Kanban ou rack de servidores para interagir
                </span>
              </div>
              <div className="office-stage-controls">
                <button
                  type="button"
                  className="btn-quiet btn-xs"
                  onClick={toggleMission}
                  title="Alternar barra lateral esquerda (Monitor de Missão)"
                >
                  {missionOpen ? 'Ocultar Missão' : 'Mostrar Missão'}
                </button>
                <button
                  type="button"
                  className="btn-quiet btn-xs"
                  onClick={toggleImmersive}
                  title="Recolher ou expandir ambas as barras laterais para maximizar o escritório"
                >
                  {isImmersive ? 'Restaurar Painéis' : '⛶ Modo Imersivo'}
                </button>
                <button
                  type="button"
                  className="btn-quiet btn-xs"
                  onClick={toggleGit}
                  title="Alternar barra lateral direita (Git Control)"
                >
                  {gitOpen ? 'Ocultar Git' : 'Mostrar Git'}
                </button>
              </div>
            </div>

            <main className={selectedAgent ? 'stage stage-split' : 'stage'}>
              <div className="stage-world">
                <ErrorBoundary fallbackTitle="Falha na visualização do escritório 2D">
                  <PhaserGame
                    agents={agents}
                    selectedId={selectedAgentId}
                    onSelect={selectAgent}
                    onAction={handleWorldAction}
                  />
                  <TeamRoster agents={agents} selectedId={selectedAgentId} onSelect={selectAgent} />
                </ErrorBoundary>
              </div>

              {selectedAgent && (
                <ErrorBoundary fallbackTitle="Falha na janela do agente">
                  <AgentWindow
                    agent={selectedAgent}
                    config={selectedAgentConfig}
                    online={online}
                    hasProject={workspace.activeProjectId !== null}
                    send={send}
                    subscribe={subscribe}
                    onClose={() => setSelectedAgentId(null)}
                    onOpenObservability={(agId) => {
                      setObservabilityAgentId(agId)
                      setActiveTab('observability')
                    }}
                  />
                </ErrorBoundary>
              )}
            </main>
          </div>

          {/* Coluna Direita: Git Control Permanente */}
          <div className="office-right-sidebar">
            <ErrorBoundary fallbackTitle="Falha no painel Git">
              <GitPanel
                status={gitStatus}
                projectName={activeProject?.name}
                projectPath={activeProject?.path}
                send={send}
                subscribe={subscribe}
                collapsed={!gitOpen}
                onToggleCollapse={toggleGit}
              />
            </ErrorBoundary>
          </div>
        </div>

        {/* ABA 3: PROJETOS E TAREFAS */}
        {activeTab === 'tasks' && (
          <div className="full-view-container">
            <ErrorBoundary fallbackTitle="Falha no painel de tarefas">
              <TaskPanel
                tasks={tasks}
                missions={missions}
                agents={agents}
                configs={configs}
                activeProjectId={workspace.activeProjectId}
                online={online}
                send={send}
                subscribe={subscribe}
                onClose={() => setActiveTab('office')}
              />
            </ErrorBoundary>
          </div>
        )}

        {/* ABA 4: HISTÓRICO */}
        {activeTab === 'history' && (
          <div className="full-view-container">
            <ErrorBoundary fallbackTitle="Falha no painel de histórico">
              <HistoryPanel history={history} onClose={() => setActiveTab('office')} />
            </ErrorBoundary>
          </div>
        )}

        {/* ABA 5: CENTRAL DE AGENTES */}
        {activeTab === 'agents' && (
          <div className="full-view-container">
            <ErrorBoundary fallbackTitle="Falha na Central de Agentes">
              <AgentCenter
                agents={agents}
                configs={configs}
                allConfigs={allConfigs}
                specializations={specializations}
                skills={skills}
                skillOverrides={skillOverrides}
                online={online}
                send={send}
                subscribe={subscribe}
                onClose={() => setActiveTab('office')}
              />
            </ErrorBoundary>
          </div>
        )}

        {/* ABA 6: CENTRAL DE MEMÓRIA */}
        {activeTab === 'memory' && (
          <div className="full-view-container">
            <ErrorBoundary fallbackTitle="Falha na Central de Memória">
              <MemoryCenter
                projectId={workspace.activeProjectId}
                projectName={activeProject?.name}
                agents={agents}
                online={online}
                send={send}
                subscribe={subscribe}
                onClose={() => setActiveTab('office')}
              />
            </ErrorBoundary>
          </div>
        )}

        {/* ABA 7: CENTRAL DE OBSERVABILIDADE */}
        {activeTab === 'observability' && (
          <div className="full-view-container">
            <ErrorBoundary fallbackTitle="Falha na Central de Observabilidade">
              <ObservabilityCenter
                workspace={workspace}
                missions={missions}
                agents={agents}
                configs={allConfigs ?? configs}
                skills={skills}
                skillOverrides={skillOverrides}
                online={online}
                send={send}
                subscribe={subscribe}
                initialMissionId={observabilityMissionId}
                initialAgentId={observabilityAgentId}
                onClose={() => setActiveTab('office')}
                onSelectAgentInOffice={selectAgent}
              />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}

export default App
