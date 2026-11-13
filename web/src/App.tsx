import { Suspense, useCallback, useEffect, useState } from 'react'
import { isOpenMission } from '../../shared/missionPhases.ts'
import type { WorldAction } from './game/WorldBridge.ts'
import { useChatLinks } from './net/useChatLinks.ts'
import { useGitStatus } from './net/useGitStatus.ts'
import { useServer } from './net/useServer.ts'
import { ErrorBoundary } from './ui/ErrorBoundary.tsx'
import { CloseConfirmModal } from './ui/CloseConfirmModal.tsx'
import { FirstRunWizard, loadFirstRunState, saveFirstRunState } from './ui/FirstRunWizard.tsx'
import { loadCloseBehavior, saveCloseBehavior } from './ui/closeBehavior.ts'
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
    authRequired,
    pair,
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
  const [closeModalOpen, setCloseModalOpen] = useState(false)
  const [firstRunOpen, setFirstRunOpen] = useState(() => !loadFirstRunState().completed)
  const [firstRunStep, setFirstRunStep] = useState(() => loadFirstRunState().lastStep)

  useEffect(() => {
    const tauri = (window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke: <R>(c: string, args?: unknown) => Promise<R>
        transformCallback: (cb: () => void) => number
      }
    }).__TAURI_INTERNALS__
    if (!tauri) return

    let unlistenId: number | null = null
    let unlistenTrayQuitId: number | null = null
    const cbId = tauri.transformCallback(() => {
      const pref = loadCloseBehavior()
      const hasActive = missions.some((m) => isOpenMission(m))
      if (pref === 'minimize') {
        void tauri.invoke('minimize_to_tray')
        return
      }
      if (pref === 'quit' && !hasActive) {
        void tauri.invoke('quit_app')
        return
      }
      setCloseModalOpen(true)
    })

    const trayQuitCbId = tauri.transformCallback(() => {
      const hasActive = missions.some((m) => isOpenMission(m))
      if (!hasActive) {
        void tauri.invoke('quit_app')
        return
      }
      setCloseModalOpen(true)
    })

    void tauri
      .invoke<number>('plugin:event|listen', {
        event: 'close-requested',
        target: { kind: 'Any' },
        handler: cbId,
      })
      .then((id) => {
        unlistenId = id
      })
      .catch(() => {})

    void tauri
      .invoke<number>('plugin:event|listen', {
        event: 'tray-quit-requested',
        target: { kind: 'Any' },
        handler: trayQuitCbId,
      })
      .then((id) => {
        unlistenTrayQuitId = id
      })
      .catch(() => {})

    return () => {
      if (unlistenId !== null) {
        void tauri.invoke('plugin:event|unlisten', { event: 'close-requested', eventId: unlistenId }).catch(() => {})
      }
      if (unlistenTrayQuitId !== null) {
        void tauri.invoke('plugin:event|unlisten', { event: 'tray-quit-requested', eventId: unlistenTrayQuitId }).catch(() => {})
      }
    }
  }, [missions])

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
    if (activeTab !== 'office') {
      setActiveTab('office')
      if (tab) {
        setSideTab(tab)
        setSidePanelOpen(true)
      } else {
        setSidePanelOpen(false)
      }
    } else if (tab) {
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

  const [pairingInput, setPairingInput] = useState('')
  const [pairingError, setPairingError] = useState<string | null>(null)
  const [pairingBusy, setPairingBusy] = useState(false)

  return (
    <ErrorBoundary fallbackTitle="Falha geral na interface do AI Dev World">
      <div className="proto-office-studio-shell">
        {authRequired && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Pareamento local"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              background: 'rgba(2, 6, 23, 0.84)',
              backdropFilter: 'blur(12px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
          >
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (!pairingInput.trim() || pairingBusy) return
                setPairingBusy(true)
                setPairingError(null)
                const err = await pair(pairingInput)
                setPairingBusy(false)
                if (err) setPairingError(err)
                else setPairingInput('')
              }}
              style={{
                width: '100%',
                maxWidth: 400,
                background: 'rgba(15, 23, 42, 0.94)',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                borderRadius: 12,
                padding: 20,
                color: '#f8fafc',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18 }}>Pareamento Local</h2>
              <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1' }}>
                Digite o código exibido no terminal do backend para autenticar esta sessão.
              </p>
              <input
                type="text"
                autoFocus
                value={pairingInput}
                onChange={(e) => setPairingInput(e.target.value)}
                placeholder="Ex.: A3F9C102"
                aria-label="Código de pareamento"
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid rgba(148, 163, 184, 0.35)',
                  background: '#0f172a',
                  color: '#f8fafc',
                  fontSize: 15,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              />
              {pairingError && (
                <p role="alert" style={{ margin: 0, fontSize: 12, color: '#fca5a5' }}>
                  {pairingError}
                </p>
              )}
              <button
                type="submit"
                disabled={pairingBusy || !pairingInput.trim()}
                style={{
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#38bdf8',
                  color: '#0f172a',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {pairingBusy ? 'Validando…' : 'Conectar'}
              </button>
            </form>
          </div>
        )}
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
            {'__TAURI_INTERNALS__' in window ? (
              <>Recuperando conexão com o backend integrado...</>
            ) : (
              <>Sem conexão com o backend local. Inicie com <code>npm run dev</code>.</>
            )}
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

        {activeTab !== 'office' && (
          <div className="studio-page-breadcrumb">
            <button type="button" className="btn btn-sm" onClick={() => setActiveTab('office')}>
              ← Voltar ao Escritório
            </button>
          </div>
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

        <FirstRunWizard
          open={online && firstRunOpen}
          initialStep={firstRunStep}
          authToken={null}
          projects={workspace.projects ?? []}
          activeProjectId={workspace.activeProjectId ?? null}
          onSelectProject={(id) => send({ type: 'project-select', projectId: id })}
          onOpenFolderDialog={() => send({ type: 'dialog-open-folder' })}
          onComplete={() => {
            saveFirstRunState({ completed: true, lastStep: 2 })
            setFirstRunOpen(false)
          }}
          onDismiss={(step) => {
            saveFirstRunState({ completed: false, lastStep: step })
            setFirstRunStep(step)
            setFirstRunOpen(false)
          }}
        />
        <CloseConfirmModal
          open={closeModalOpen}
          activeMissionsCount={missions.filter((m) => isOpenMission(m)).length}
          onMinimize={(remember) => {
            if (remember) saveCloseBehavior('minimize')
            setCloseModalOpen(false)
            const tauri = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (c: string) => Promise<void> } }).__TAURI_INTERNALS__
            void tauri?.invoke('minimize_to_tray')
          }}
          onQuit={(remember) => {
            if (remember) saveCloseBehavior('quit')
            setCloseModalOpen(false)
            const tauri = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (c: string) => Promise<void> } }).__TAURI_INTERNALS__
            void tauri?.invoke('quit_app')
          }}
          onCancel={() => setCloseModalOpen(false)}
        />
      </div>
    </ErrorBoundary>
  )
}

export default App
