import { useState, useRef, useCallback } from 'react'

interface WorkspaceStation {
  id: string
  agentName: string
  agentRole: string
  agentIcon: string
  status: 'working' | 'waiting' | 'idle' | 'error'
  currentAction: string
  activeFile?: string
  progress: number
  x: number
  y: number
  color: string
}

const STATIONS: WorkspaceStation[] = [
  {
    id: 'lead',
    agentName: 'Arquiteto (Ada)',
    agentRole: 'Tech Lead / Coordenação',
    agentIcon: '📐',
    status: 'idle',
    currentAction: 'Aguardando entrega do QA para validar conformidade do plano.',
    progress: 100,
    x: 18,
    y: 25,
    color: '#38bdf8'
  },
  {
    id: 'dev',
    agentName: 'Desenvolvedor (Linus)',
    agentRole: 'Engenheiro de Código',
    agentIcon: '⚡',
    status: 'working',
    currentAction: 'Escrevendo teste de limite monetário com BigInt e centavos inteiros.',
    activeFile: 'tests/estoque.test.js',
    progress: 74,
    x: 50,
    y: 45,
    color: '#10b981'
  },
  {
    id: 'sec',
    agentName: 'Segurança (Bruce)',
    agentRole: 'Auditoria & SAST',
    agentIcon: '🛡️',
    status: 'waiting',
    currentAction: 'Na fila: aguardando submissão do diff do Dev para inspeção estática.',
    progress: 0,
    x: 82,
    y: 30,
    color: '#a855f7'
  },
  {
    id: 'qa',
    agentName: 'QA (Margaret)',
    agentRole: 'Engenharia de Qualidade',
    agentIcon: '🔍',
    status: 'waiting',
    currentAction: 'Na fila: aguardando parecer de segurança e execução da suíte.',
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

  // Estado de Arrastar / Pan e Zoom
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number; startPanX: number; startPanY: number } | null>(null)
  const hasDraggedRef = useRef(false)

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, .proto-living-sidebar, input')) return
    setIsDragging(true)
    hasDraggedRef.current = false
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y
    }
  }

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStartRef.current) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasDraggedRef.current = true
    }
    setPan({
      x: dragStartRef.current.startPanX + dx,
      y: dragStartRef.current.startPanY + dy
    })
  }, [])

  const handleMouseUp = () => {
    setIsDragging(false)
    dragStartRef.current = null
  }

  const handleWheel = (e: React.WheelEvent) => {
    const zoomDelta = e.deltaY < 0 ? 0.08 : -0.08
    setZoom(prev => Math.min(Math.max(0.6, prev + zoomDelta), 2.0))
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button, .proto-living-sidebar, input')) return
    if (e.touches.length === 1) {
      const touch = e.touches[0]
      setIsDragging(true)
      hasDraggedRef.current = false
      dragStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        startPanX: pan.x,
        startPanY: pan.y
      }
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragStartRef.current || e.touches.length !== 1) return
    const touch = e.touches[0]
    const dx = touch.clientX - dragStartRef.current.x
    const dy = touch.clientY - dragStartRef.current.y
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasDraggedRef.current = true
    }
    setPan({
      x: dragStartRef.current.startPanX + dx,
      y: dragStartRef.current.startPanY + dy
    })
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
    dragStartRef.current = null
  }

  const resetView = () => {
    setPan({ x: 0, y: 0 })
    setZoom(1)
  }

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

      <div 
        className={`proto-living-stage-wrapper ${isDragging ? 'is-dragging' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Espaço Isométrico 2.5D */}
        <div 
          className={`proto-iso-stage ${viewMode === 'isometric' ? 'is-iso' : 'is-flat'} ${isDragging ? 'is-dragging' : ''}`}
          style={{
            transform: viewMode === 'isometric'
              ? `perspective(1200px) translate3d(${pan.x}px, ${pan.y}px, 0px) scale(${zoom}) rotateX(42deg) rotateZ(-12deg)`
              : `translate3d(${pan.x}px, ${pan.y}px, 0px) scale(${zoom})`,
            transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
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
                onClick={() => {
                  if (hasDraggedRef.current) return
                  setActiveStation(station)
                }}
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
                  <strong className="bubble-title" style={{ color: station.color }}>{station.agentName}</strong>
                  <p className="bubble-text">{station.currentAction}</p>
                  {station.activeFile && (
                    <code className="bubble-code">{station.activeFile}</code>
                  )}
                </div>

                {/* Estação Física no Piso */}
                <div className="proto-station-desk">
                  <span className="desk-label">{station.agentRole}</span>
                  {station.progress > 0 && (
                    <div className="desk-progress-bar">
                      <div className="desk-progress-fill" style={{ width: `${station.progress}%`, background: station.color }} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Painel Lateral de Inspeção do Agente Ativo */}
        <aside className="proto-inspector-glass">
          <div className="proto-glass-header">
            <div className="proto-glass-avatar" style={{ borderColor: activeStation.color }}>
              <span>{activeStation.agentIcon}</span>
            </div>
            <div>
              <h3>{activeStation.agentName}</h3>
              <p>{activeStation.agentRole}</p>
            </div>
            <span className={`tag tag-${activeStation.status}`}>{activeStation.status.toUpperCase()}</span>
          </div>

          <div className="proto-glass-body">
            <div className="proto-glass-section">
              <h4>Atividade em Andamento</h4>
              <p className="proto-activity-desc">{activeStation.currentAction}</p>
              {activeStation.progress > 0 && (
                <div className="proto-progress-widget">
                  <div className="proto-progress-labels">
                    <span>Progresso da Etapa:</span>
                    <strong>{activeStation.progress}%</strong>
                  </div>
                  <div className="proto-progress-track">
                    <div className="proto-progress-fill" style={{ width: `${activeStation.progress}%`, background: activeStation.color }} />
                  </div>
                </div>
              )}
            </div>

            <div className="proto-glass-section">
              <h4>Colaboração na Missão</h4>
              <ul className="proto-collab-list">
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

        {/* Controles de Câmera e Dica de Arraste */}
        <div className="proto-cam-controls">
          <span className="proto-cam-hint">✋ Arraste para navegar</span>
          <button type="button" onClick={() => setZoom(z => Math.min(2.0, Number((z + 0.15).toFixed(2))))} title="Aproximar">＋</button>
          <button type="button" onClick={resetView} title="Resetar Câmera">⟲ Reset</button>
          <button type="button" onClick={() => setZoom(z => Math.max(0.6, Number((z - 0.15).toFixed(2))))} title="Afastar">－</button>
        </div>
      </div>
    </div>
  )
}
