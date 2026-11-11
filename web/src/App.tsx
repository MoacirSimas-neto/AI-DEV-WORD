import { useState } from 'react'
import { PhaserGame } from './game/PhaserGame.tsx'
import { type ConnectionStatus, useServer } from './net/useServer.ts'
import { AgentWindow } from './ui/AgentWindow.tsx'
import { ProjectBar } from './ui/ProjectBar.tsx'

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Conectando…',
  online: 'Backend conectado',
  offline: 'Backend desconectado',
}

function App() {
  const { status, agents, workspace, send, subscribe } = useServer()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = agents.find((a) => a.id === selectedId) ?? null
  const online = status === 'online'

  return (
    <div className="app">
      <header className="topbar">
        <h1>AI Dev World</h1>
        <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>
      </header>

      {status === 'offline' && (
        <p className="banner">
          Sem conexão com o backend local. Inicie tudo com <code>npm run dev</code> na raiz do projeto.
        </p>
      )}

      <ProjectBar workspace={workspace} online={online} send={send} subscribe={subscribe} />

      <main className={selected ? 'stage stage-split' : 'stage'}>
        <div>
          <PhaserGame agents={agents} selectedId={selectedId} onSelect={setSelectedId} />
          {!selected && <p className="hint">Clique em um personagem para abrir a janela dele.</p>}
        </div>
        {selected && (
          <AgentWindow
            agent={selected}
            online={online}
            hasProject={workspace.activeProjectId !== null}
            send={send}
            subscribe={subscribe}
            onClose={() => setSelectedId(null)}
          />
        )}
      </main>
    </div>
  )
}

export default App
