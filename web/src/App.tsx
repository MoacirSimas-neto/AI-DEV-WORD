import { useCallback, useState } from 'react'
import { PhaserGame } from './game/PhaserGame.tsx'
import { useGitStatus } from './net/useGitStatus.ts'
import { type ConnectionStatus, useServer } from './net/useServer.ts'
import { AgentCenter } from './ui/AgentCenter.tsx'
import { AgentWindow } from './ui/AgentWindow.tsx'
import { ErrorBoundary } from './ui/ErrorBoundary.tsx'
import { GitPanel } from './ui/GitPanel.tsx'
import { HistoryPanel } from './ui/HistoryPanel.tsx'
import { ProjectBar } from './ui/ProjectBar.tsx'
import { TaskPanel } from './ui/TaskPanel.tsx'
import { TeamRoster } from './ui/TeamRoster.tsx'

const STATUS: Record<ConnectionStatus, { label: string; tone: string }> = {
  connecting: { label: 'Conectando…', tone: 'checking' },
  online: { label: 'Backend conectado', tone: 'idle' },
  offline: { label: 'Backend desconectado', tone: 'error' },
}

/** O que ocupa a janela auxiliar: a janela de um agente, Tarefas, Histórico ou Central de Agentes. */
type Panel = { agentId: string } | 'tasks' | 'history' | 'agent-center' | null

function App() {
  const { status, agents, workspace, tasks, missions, history, configs, send, subscribe } = useServer()
  const [panel, setPanel] = useState<Panel>(null)
  const [gitOpen, setGitOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('aidw_git_panel_open') !== 'false'
    } catch {
      return true
    }
  })

  const online = status === 'online'
  const gitStatus = useGitStatus(send, subscribe, online, workspace.activeProjectId)

  const selectedId = panel && typeof panel === 'object' ? panel.agentId : null
  const selected = agents.find((a) => a.id === selectedId) ?? null
  const selectAgent = useCallback((agentId: string) => setPanel({ agentId }), [])
  const close = () => setPanel(null)

  const toggleGit = () => {
    setGitOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem('aidw_git_panel_open', String(next))
      } catch {}
      return next
    })
  }

  const activeProject = workspace.projects?.find((p) => p.id === workspace.activeProjectId)
  const projectTasks =
    workspace.activeProjectId && Array.isArray(tasks)
      ? tasks.filter((t) => t.projectId === workspace.activeProjectId)
      : []

  return (
    <ErrorBoundary fallbackTitle="Falha geral na interface do AI Dev World">
      <div className="app">
        <header className="topbar">
          <div>
            <h1>AI Dev World</h1>
            <p className="tagline">Seu escritório de agentes, rodando na sua máquina</p>
          </div>
          <span className={`lamp lamp-${STATUS[status].tone}`}>{STATUS[status].label}</span>
        </header>

        {status === 'offline' && (
          <p className="banner">
            Sem conexão com o backend local. Inicie tudo com <code>npm run dev</code> na raiz do projeto.
          </p>
        )}

        <ErrorBoundary fallbackTitle="Falha na barra de projetos">
          <ProjectBar
            workspace={workspace}
            online={online}
            changes={gitStatus?.isRepo ? gitStatus.files.length : null}
            taskCount={projectTasks.length}
            gitOpen={gitOpen}
            onToggleGit={toggleGit}
            onOpenTasks={() => setPanel('tasks')}
            onOpenHistory={() => setPanel('history')}
            onOpenAgentCenter={() => setPanel('agent-center')}
            send={send}
            subscribe={subscribe}
          />
        </ErrorBoundary>

        <div className={`workspace-layout ${gitOpen ? 'git-open' : 'git-closed'}`}>
          <div className="workspace-main">
            <main className={selected || panel !== null ? 'stage stage-split' : 'stage'}>
              <div className="stage-world">
                <ErrorBoundary fallbackTitle="Falha na visualização do escritório 2D">
                  <PhaserGame agents={agents} selectedId={selectedId} onSelect={selectAgent} />
                  <TeamRoster agents={agents} selectedId={selectedId} onSelect={selectAgent} />
                </ErrorBoundary>
              </div>
              {selected && (
                <ErrorBoundary fallbackTitle="Falha na janela do agente">
                  <AgentWindow
                    agent={selected}
                    online={online}
                    hasProject={workspace.activeProjectId !== null}
                    send={send}
                    subscribe={subscribe}
                    onClose={close}
                  />
                </ErrorBoundary>
              )}
              {panel === 'tasks' && (
                <ErrorBoundary fallbackTitle="Falha no painel de tarefas">
                  <TaskPanel
                    tasks={tasks}
                    missions={missions}
                    agents={agents}
                    activeProjectId={workspace.activeProjectId}
                    online={online}
                    send={send}
                    subscribe={subscribe}
                    onClose={close}
                  />
                </ErrorBoundary>
              )}
              {panel === 'history' && (
                <ErrorBoundary fallbackTitle="Falha no painel de histórico">
                  <HistoryPanel history={history} onClose={close} />
                </ErrorBoundary>
              )}
              {panel === 'agent-center' && (
                <ErrorBoundary fallbackTitle="Falha na Central de Agentes">
                  <AgentCenter
                    agents={agents}
                    configs={configs}
                    online={online}
                    send={send}
                    onClose={close}
                  />
                </ErrorBoundary>
              )}
            </main>
          </div>

          <aside className="workspace-git-sidebar">
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
          </aside>
        </div>
      </div>
    </ErrorBoundary>
  )
}

export default App
