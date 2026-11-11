import { useCallback, useState } from 'react'
import { PhaserGame } from './game/PhaserGame.tsx'
import { useGitStatus } from './net/useGitStatus.ts'
import { type ConnectionStatus, useServer } from './net/useServer.ts'
import { AgentWindow } from './ui/AgentWindow.tsx'
import { GitPanel } from './ui/GitPanel.tsx'
import { ProjectBar } from './ui/ProjectBar.tsx'
import { TeamRoster } from './ui/TeamRoster.tsx'

const STATUS: Record<ConnectionStatus, { label: string; tone: string }> = {
  connecting: { label: 'Conectando…', tone: 'checking' },
  online: { label: 'Backend conectado', tone: 'idle' },
  offline: { label: 'Backend desconectado', tone: 'error' },
}

/** O que ocupa a coluna da direita: a janela de um agente, o painel Git, ou nada. */
type Panel = { agentId: string } | 'git' | null

function App() {
  const { status, agents, workspace, send, subscribe } = useServer()
  const [panel, setPanel] = useState<Panel>(null)
  const online = status === 'online'
  const gitStatus = useGitStatus(send, subscribe, online, workspace.activeProjectId)

  const selectedId = panel && panel !== 'git' ? panel.agentId : null
  const selected = agents.find((a) => a.id === selectedId) ?? null
  const selectAgent = useCallback((agentId: string) => setPanel({ agentId }), [])
  const close = () => setPanel(null)

  return (
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

      <ProjectBar
        workspace={workspace}
        online={online}
        changes={gitStatus?.isRepo ? gitStatus.files.length : null}
        onOpenGit={() => setPanel('git')}
        send={send}
        subscribe={subscribe}
      />

      <main className={selected || panel === 'git' ? 'stage stage-split' : 'stage'}>
        <div className="stage-world">
          <PhaserGame agents={agents} selectedId={selectedId} onSelect={selectAgent} />
          <TeamRoster agents={agents} selectedId={selectedId} onSelect={selectAgent} />
        </div>
        {selected && (
          <AgentWindow
            agent={selected}
            online={online}
            hasProject={workspace.activeProjectId !== null}
            send={send}
            subscribe={subscribe}
            onClose={close}
          />
        )}
        {panel === 'git' && <GitPanel status={gitStatus} send={send} subscribe={subscribe} onClose={close} />}
      </main>
    </div>
  )
}

export default App
