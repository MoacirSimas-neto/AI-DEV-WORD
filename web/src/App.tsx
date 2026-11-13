import { Suspense, useCallback, useEffect, useState } from 'react'
import { isOpenMission } from '../../shared/missionPhases.ts'
import type { WorldAction } from './game/WorldBridge.ts'
import { useChatLinks } from './net/useChatLinks.ts'
import { useGitStatus } from './net/useGitStatus.ts'
import { useServer } from './net/useServer.ts'
import { ErrorBoundary } from './ui/ErrorBoundary.tsx'
import { StudioTopBar, type StudioTab } from './ui/StudioTopBar.tsx'
import { StudioOfficeView } from './ui/StudioOfficeView.tsx'
import {
  LazyAgentCenter,
  LazyChatView,
  LazyHistoryPanel,
  LazyHomeView,
  LazyMemoryCenter,
  LazyObservabilityCenter,
  LazyPrototypeShowcase,
  LazyTaskPanel,
  prefetchScreens,
} from './lazyScreens.ts'
// Estilos do shell do Studio (não só dos protótipos): ficam no carregamento inicial.
import './prototypes/prototypes.css'

const pageFallback = <p className="window-message studio-page-loading">Carregando…</p>

export type NavTab = StudioTab | 'home' | 'prototypes'

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

  // Etapa 12.1: o chat com o Tech Lead é a porta de entrada; o escritório segue a uma aba.
  const [activeTab, setActiveTab] = useState<NavTab>('office')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [observabilityMissionId, setObservabilityMissionId] = useState<number | null>(null)
  const [observabilityAgentId, setObservabilityAgentId] = useState<string | null>(null)
  // Etapa 12.2: "Voltar ao chat" abre a conversa de origem da missão.
  const [chatConversationId, setChatConversationId] = useState<number | null>(null)

  // Controle integrado do Drawer lateral do Studio (Agente, Missão, Git)
  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [sideTab, setSideTab] = useState<'agent' | 'git' | 'mission'>('agent')

  const online = status === 'online'

  // As telas secundárias descem em segundo plano depois da primeira pintura.
  useEffect(() => prefetchScreens(), [])
  const gitStatus = useGitStatus(send, subscribe, online, workspace.activeProjectId)
  const chatLinks = useChatLinks(send, subscribe, online, workspace.activeProjectId)
  const openChat = useCallback((conversationId: number) => {
    setChatConversationId(conversationId)
    setActiveTab('chat')
  }, [])
  const openObservability = useCallback((missionId?: number | null, agentId?: string | null) => {
    setObservabilityMissionId(missionId ?? null)
    setObservabilityAgentId(agentId ?? null)
    setActiveTab('observability')
  }, [])

  const selectAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId)
    setSideTab('agent')
    setSidePanelOpen(true)
    setActiveTab('office')
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
  }, [])

  const handleWorldAction = useCallback((action: WorldAction) => {
    if (action === 'tasks') setActiveTab('tasks')
    else if (action === 'history') setActiveTab('history')
    else if (action === 'agents') setActiveTab('agents')
    else if (action === 'mission') {
      setSideTab('mission')
      setSidePanelOpen(true)
      setActiveTab('office')
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
    }
  }, [])

  const handleToggleSidePanel = (tab?: 'agent' | 'git' | 'mission') => {
    if (tab) {
      if (sidePanelOpen && sideTab === tab) {
        setSidePanelOpen(false)
      } else {
        setSideTab(tab)
        setSidePanelOpen(true)
      }
    } else {
      setSidePanelOpen((prev) => !prev)
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
    setTimeout(() => window.dispatchEvent(new Event('resize')), 250)
  }

  const activeProject = workspace.projects?.find((p) => p.id === workspace.activeProjectId) ?? null
  const projectTasks =
    workspace.activeProjectId && Array.isArray(tasks)
      ? tasks.filter((t) => t.projectId === workspace.activeProjectId)
      : []
  const activeMissionsCount = Array.isArray(missions)
    ? missions.filter((m) =>
        isOpenMission(m),
      ).length
    : 0

  return (
    <ErrorBoundary fallbackTitle="Falha geral na interface do AI Dev World">
      <div className="proto-office-studio-shell">
        {/* 1. Barra Superior Moderna Unificada do Studio */}
        <StudioTopBar
          workspace={workspace}
          activeProject={activeProject}
          gitStatus={gitStatus}
          activeTab={activeTab === 'home' || activeTab === 'prototypes' ? 'office' : activeTab}
          onSelectTab={(tab) => {
            setActiveTab(tab)
            if (tab !== 'office') setSidePanelOpen(false)
          }}
          tasksCount={projectTasks.length}
          activeMissionsCount={activeMissionsCount}
          missions={missions}
          tasks={tasks}
          agents={agents}
          onSelectAgent={selectAgent}
          sidePanelOpen={sidePanelOpen}
          sideTab={sideTab}
          onToggleSidePanel={handleToggleSidePanel}
          send={send}
          subscribe={subscribe}
          online={online}
        />

        {status === 'offline' && (
          <div className="banner" style={{ margin: '8px 16px', background: '#ef444422', borderColor: '#ef4444' }}>
            Sem conexão com o backend local. Inicie com <code>npm run dev</code>.
          </div>
        )}

        {/* 1b. Chat com o Tech Lead (entrada principal) */}
        {activeTab === 'chat' && (
          <div className="studio-chat-view">
            <ErrorBoundary fallbackTitle="Falha no chat">
              <Suspense fallback={pageFallback}>
                <LazyChatView
                  projectId={workspace.activeProjectId}
                  projectName={activeProject?.name}
                  agents={agents}
                  configs={allConfigs.length > 0 ? allConfigs : configs}
                  online={online}
                  send={send}
                  subscribe={subscribe}
                  onOpenTasks={() => setActiveTab('tasks')}
                  links={chatLinks}
                  missions={missions}
                  tasks={tasks}
                  initialConversationId={chatConversationId}
                  onOpenObservability={(missionId) => openObservability(missionId)}
                  onOpenOffice={() => setActiveTab('office')}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {/* 2. Visualização Principal: Escritório 2D Studio */}
        {activeTab === 'office' && (
          <StudioOfficeView
            agents={agents}
            configs={allConfigs.length > 0 ? allConfigs : configs}
            selectedAgentId={selectedAgentId}
            // Clicar num agente abre o painel com o terminal dele (a dica do dock já prometia isso).
            onSelectAgent={(id) => (id ? selectAgent(id) : setSelectedAgentId(null))}
            sidePanelOpen={sidePanelOpen}
            sideTab={sideTab}
            onCloseSidePanel={() => {
              setSidePanelOpen(false)
              setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
            }}
            onSetSideTab={setSideTab}
            gitStatus={gitStatus}
            projectName={activeProject?.name}
            projectPath={activeProject?.path}
            missions={missions}
            tasks={tasks}
            activeProjectId={workspace.activeProjectId}
            online={online}
            send={send}
            subscribe={subscribe}
            onAction={handleWorldAction}
            onOpenTasks={() => setActiveTab('tasks')}
            onOpenObservability={openObservability}
          />
        )}

        {/* 3. Painel de Tarefas & Projetos */}
        {activeTab === 'tasks' && (
          <div className="studio-page-view">
            <ErrorBoundary fallbackTitle="Falha no painel de tarefas">
              <Suspense fallback={pageFallback}>
                <LazyTaskPanel
                  tasks={tasks}
                  missions={missions}
                  agents={agents}
                  configs={configs}
                  activeProjectId={workspace.activeProjectId}
                  online={online}
                  send={send}
                  subscribe={subscribe}
                  onClose={() => setActiveTab('office')}
                  chatLinks={chatLinks}
                  onOpenChat={openChat}
                  onOpenChatNew={() => {
                    setChatConversationId(null)
                    setActiveTab('chat')
                  }}
                  onOpenObservability={(missionId) => openObservability(missionId)}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {/* 4. Histórico de Missões */}
        {activeTab === 'history' && (
          <div className="studio-page-view">
            <ErrorBoundary fallbackTitle="Falha no painel de histórico">
              <Suspense fallback={pageFallback}>
                <LazyHistoryPanel history={history} onClose={() => setActiveTab('office')} />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {/* 5. Central de Agentes */}
        {activeTab === 'agents' && (
          <div className="studio-page-view">
            <ErrorBoundary fallbackTitle="Falha na Central de Agentes">
              <Suspense fallback={pageFallback}>
                <LazyAgentCenter
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
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {/* 6. Central de Memória */}
        {activeTab === 'memory' && (
          <div className="studio-page-view">
            <ErrorBoundary fallbackTitle="Falha na Central de Memória">
              <Suspense fallback={pageFallback}>
                <LazyMemoryCenter
                  projectId={workspace.activeProjectId}
                  projectName={activeProject?.name}
                  agents={agents}
                  online={online}
                  send={send}
                  subscribe={subscribe}
                  onClose={() => setActiveTab('office')}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {/* 7. Central de Observabilidade */}
        {activeTab === 'observability' && (
          <div className="studio-page-view">
            <ErrorBoundary fallbackTitle="Falha na Central de Observabilidade">
              <Suspense fallback={pageFallback}>
                <LazyObservabilityCenter
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
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {/* 8. Home Command Center (opcional) */}
        {activeTab === 'home' && (
          <div className="studio-page-view">
            <ErrorBoundary fallbackTitle="Falha na Home Command Center">
              <Suspense fallback={pageFallback}>
                <LazyHomeView
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
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {/* 9. Laboratório de Protótipos (Etapa 9.1 para referência) */}
        {activeTab === 'prototypes' && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, width: '100%', height: '100%', overflow: 'hidden' }}>
            <ErrorBoundary fallbackTitle="Falha no laboratório de protótipos">
              <Suspense fallback={pageFallback}>
                <LazyPrototypeShowcase onBackToApp={() => setActiveTab('office')} />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}

export default App
