import { useState } from 'react'
import { PhaserGame } from './game/PhaserGame.tsx'
import { type ConnectionStatus, useServer } from './net/useServer.ts'
import { AgentPanel } from './ui/AgentPanel.tsx'

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Conectando…',
  online: 'Backend conectado',
  offline: 'Backend desconectado',
}

function App() {
  const { status, agents, send } = useServer()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = agents.find((a) => a.id === selectedId) ?? null

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

      <main className="stage">
        <PhaserGame agents={agents} selectedId={selectedId} onSelect={setSelectedId} />
        <AgentPanel agent={selected} onCheck={(agentId) => send({ type: 'check-cli', agentId })} />
      </main>
    </div>
  )
}

export default App
