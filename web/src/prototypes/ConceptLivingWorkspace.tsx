import { useState } from 'react'

interface WorkspaceStation {
  id: string
  name: string
  agentName: string
  agentRole: string
  agentIcon: string
  stationType: 'design' | 'dev' | 'security' | 'qa'
  status: 'working' | 'idle' | 'waiting' | 'review'
  currentThought: string
  progress: number
  x: number // coordenadas relativas no plano 2.5D
  y: number
  color: string
}

const STATIONS: WorkspaceStation[] = [
  {
    id: 'station-arch',
    name: 'Estação de Arquitetura',
    agentName: 'Arquiteto',
    agentRole: 'Tech Lead',
    agentIcon: '📐',
    stationType: 'design',
    status: 'idle',
    currentThought: 'Plano aprovado. Monitorando conformidade dos contratos.',
    progress: 100,
    x: 18,
    y: 25,
    color: '#38bdf8'
  },
  {
    id: 'station-dev',
    name: 'Bancada de Código',
    agentName: 'Dev',
    agentRole: 'Implementador',
    agentIcon: '⚡',
    stationType: 'dev',
    status: 'working',
    currentThought: 'Refatorando cálculo de centavos com Number.isSafeInteger...',
    progress: 78,
    x: 50,
    y: 45,
    color: '#10b981'
  },
  {
    id: 'station-sec',
    name: 'Posto de Auditoria',
    agentName: 'Especialista em Segurança',
    agentRole: 'Security Reviewer',
    agentIcon: '🛡️',
    stationType: 'security',
    status: 'waiting',
    currentThought: 'Aguardando encerramento do processo do Dev para rodar auditoria estática.',
    progress: 0,
    x: 82,
    y: 30,
    color: '#a855f7'
  },
  {
    id: 'station-qa',
    name: 'Laboratório de Testes',
    agentName: 'QA Engineer',
    agentRole: 'Quality & Resilience',
    agentIcon: '🔍',
    stationType: 'qa',
    status: 'waiting',
    currentThought: 'Fila pronta: validação estática de cobertura e bordas numéricas.',
    progress: 0,
    x: 65,
    y: 75,
    color: '#f59e0b'
  }
]

export function ConceptLivingWorkspace() {
  const [activeStation, setActiveStation] = useState<WorkspaceStation>(STATIONS[1])
  const [viewMode, setViewMode] = useState<'isometric' | 'topdown'>('isometric')
  const [zoom, setZoom] = useState(1)

  return (
    <div className="proto-living-container">
      {/* Top Banner de Identificação */}
      <div className="proto-concept-banner">
        <div>
          <span className="proto-badge">Conceito B</span>
          <strong>Living Workspace 2.5D</strong>
          <span className="proto-sub"> · Ambiente Espacial Isométrico Moderno, Estações Interativas e Agentes Vivos</span>
        </div>
        <div className="proto-controls-group">
          <button 
            type="button" 
            className={`proto-btn-toggle ${viewMode === 'isometric' ? 'active' : ''}`}
            onClick={() => setViewMode(viewMode === 'isometric' ? 'topdown' : 'isometric')}
          >
            {viewMode === 'isometric' ? 'Modo Isométrico 2.5D' : 'Planta Baixa 2D'}
          </button>
          <span className="proto-mock-pill">DADOS MOCK DE DEMONSTRAÇÃO</span>
        </div>
      </div>

      <div className="proto-living-stage-wrapper">
        {/* Espaço Isométrico 2.5D */}
        <div className={`proto-iso-stage ${viewMode === 'isometric' ? 'is-iso' : 'is-flat'}`} style={{ transform: `scale(${zoom})` }}>
          {/* Grid de Piso Tecnológico */}
          <div className="proto-iso-floor" />

          {/* Linhas de Fluxo de Dados entre Estações (Conexões) */}
          <svg className="proto-flow-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M 18 25 Q 35 30 50 45" className="flow-path flow-active" />
            <path d="M 50 45 Q 65 35 82 30" className="flow-path flow-pending" />
            <path d="M 82 30 Q 75 60 65 75" className="flow-path flow-pending" />
          </svg>

          {/* Estações de Trabalho 2.5D com Personagens */}
          {STATIONS.map((station) => {
            const isSelected = activeStation.id === station.id
            return (
              <div
                key={station.id}
                className={`proto-iso-pod ${isSelected ? 'pod-selected' : ''} pod-${station.status}`}
                style={{
                  left: `${station.x}%`,
                  top: `${station.y}%`,
                  borderColor: station.color
                }}
                onClick={() => setActiveStation(station)}
              >
                {/* Personagem Animado 2.5D */}
                <div className="proto-avatar-3d" style={{ background: `radial-gradient(circle, ${station.color}44 0%, transparent 70%)` }}>
                  <div className={`proto-char-body ${station.status === 'working' ? 'char-anim-work' : ''}`}>
                    <span className="char-icon">{station.agentIcon}</span>
                    <span className={`char-status-halo halo-${station.status}`} />
                  </div>
                  {station.status === 'working' && (
                    <div className="proto-work-particles">
                      <span className="particle p1">⚡</span>
                      <span className="particle p2">💻</span>
                    </div>
                  )}
                </div>

                {/* Balão de Pensamento / Atividade em Tempo Real */}
                <div className="proto-thought-bubble">
                  <span className="bubble-role">{station.agentName}</span>
                  <p className="bubble-text">{station.currentThought}</p>
                </div>

                {/* Base da Estação */}
                <div className="proto-pod-base">
                  <strong>{station.name}</strong>
                  {station.progress > 0 && (
                    <div className="proto-pod-progress">
                      <div className="proto-progress-bar" style={{ width: `${station.progress}%`, background: station.color }} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Painel Flutuante Lateral: Inspeção da Estação Ativa */}
        <aside className="proto-inspector-glass">
          <header className="proto-glass-header">
            <div className="proto-glass-avatar" style={{ borderColor: activeStation.color }}>
              <span>{activeStation.agentIcon}</span>
            </div>
            <div>
              <h3>{activeStation.agentName}</h3>
              <p>{activeStation.agentRole} · {activeStation.name}</p>
            </div>
            <span className={`tag tag-${activeStation.status}`}>{activeStation.status.toUpperCase()}</span>
          </header>

          <div className="proto-glass-body">
            <div className="proto-glass-section">
              <h4>Estado da Estação</h4>
              <p className="proto-highlight-text">{activeStation.currentThought}</p>
              <div className="proto-metric-row">
                <span>Progresso da Etapa:</span>
                <strong>{activeStation.progress}%</strong>
              </div>
            </div>

            <div className="proto-glass-section">
              <h4>Conexões no Workspace</h4>
              <ul className="proto-connections-list">
                <li>
                  <span className="dot dot-green" /> Recebeu diretrizes de: <strong>Arquiteto</strong> (via prompt)
                </li>
                <li>
                  <span className="dot dot-amber" /> Próximo da fila: <strong>Especialista em Segurança</strong>
                </li>
              </ul>
            </div>

            <div className="proto-glass-section">
              <h4>Ações Rápidas</h4>
              <div className="proto-action-btns">
                <button type="button" className="proto-btn-action">Abrir Terminal PTY</button>
                <button type="button" className="proto-btn-action">Ver Linha do Tempo</button>
                <button type="button" className="proto-btn-action secondary">Pausar Agente</button>
              </div>
            </div>
          </div>
        </aside>

        {/* Controles de Câmera */}
        <div className="proto-cam-controls">
          <button type="button" onClick={() => setZoom(z => Math.min(1.4, z + 0.1))}>＋</button>
          <button type="button" onClick={() => setZoom(1)}>Reset</button>
          <button type="button" onClick={() => setZoom(z => Math.max(0.7, z - 0.1))}>－</button>
        </div>
      </div>
    </div>
  )
}
