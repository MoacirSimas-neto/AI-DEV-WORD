import { useState, useRef, useCallback } from 'react'

interface StudioMember {
  id: string
  name: string
  role: string
  cli: string
  model: string
  state: 'active' | 'idle' | 'waiting' | 'error'
  currentThought: string
  avatarIcon: string
  avatarColor: string
  progress: number
  skills: string[]
  metrics: {
    tasksCompleted: number
    evidencesGenerated: number
    lastActive: string
  }
}

const MEMBERS: StudioMember[] = [
  {
    id: 'lead',
    name: 'Ada Lovelace',
    role: 'Tech Lead & Arquiteto',
    cli: 'agy',
    model: 'gemini-3.8-flash',
    state: 'idle',
    currentThought: 'Plano aprovado. Monitorando conformidade dos contratos da equipe.',
    avatarIcon: '📐',
    avatarColor: '#38bdf8',
    progress: 100,
    skills: ['Ponytail v5.3', 'Caveman Lite'],
    metrics: { tasksCompleted: 14, evidencesGenerated: 28, lastActive: 'Há 5 min' }
  },
  {
    id: 'dev',
    name: 'Linus Torvalds',
    role: 'Engenheiro de Software',
    cli: 'codex',
    model: 'gpt-4o',
    state: 'active',
    currentThought: 'Implementando src/estoque.js com Map privado e centavos inteiros...',
    avatarIcon: '⚡',
    avatarColor: '#10b981',
    progress: 82,
    skills: ['Ponytail v5.3', 'Clean Modules'],
    metrics: { tasksCompleted: 32, evidencesGenerated: 94, lastActive: 'Agora' }
  },
  {
    id: 'sec',
    name: 'Bruce Schneier',
    role: 'Auditor de Segurança',
    cli: 'agy',
    model: 'gemini-3.8-flash',
    state: 'waiting',
    currentThought: 'Aguardando diff do Dev para auditoria estática de integridade.',
    avatarIcon: '🛡️',
    avatarColor: '#a855f7',
    progress: 0,
    skills: ['Threat Modeling'],
    metrics: { tasksCompleted: 9, evidencesGenerated: 18, lastActive: 'Há 12 min' }
  },
  {
    id: 'qa',
    name: 'Margaret Hamilton',
    role: 'Engenheira de Qualidade',
    cli: 'agy',
    model: 'gemini-3.8-flash',
    state: 'waiting',
    currentThought: 'Pronta para verificação dos 51 testes e asserções de limite.',
    avatarIcon: '🔍',
    avatarColor: '#f59e0b',
    progress: 0,
    skills: ['Strict Assertions', 'Boundary Check'],
    metrics: { tasksCompleted: 27, evidencesGenerated: 62, lastActive: 'Há 8 min' }
  }
]

export function ConceptHybridWorkspace() {
  const [activeTab, setActiveTab] = useState<'workspace' | 'operations' | 'terminal'>('workspace')
  const [selectedMember, setSelectedMember] = useState<StudioMember>(MEMBERS[1])
  const [isIsoPerspective, setIsIsoPerspective] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(true)

  // Estado de Navegação Espacial 2.5D (Arrastar / Pan e Zoom)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number; startPanX: number; startPanY: number } | null>(null)
  const hasDraggedRef = useRef(false)

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, .proto-mix-inspector, input, select')) return
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
    // Zoom suave com a rodinha
    const zoomDelta = e.deltaY < 0 ? 0.08 : -0.08
    setZoom(prev => Math.min(Math.max(0.6, prev + zoomDelta), 2.2))
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button, .proto-mix-inspector, input')) return
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
    <div className="proto-mix-container">
      {/* 1. TOP BAR INTEGRADA */}
      <div className="proto-concept-banner">
        <div className="proto-mix-brand">
          <span className="proto-badge" style={{ background: 'linear-gradient(135deg, #10b981, #38bdf8)', color: '#090d16' }}>
            CONCEITO D — THE MIX
          </span>
          <strong>Living Studio & Command Center</strong>
          <span className="proto-sub"> · Estações 2.5D Vivas + Dashboard Executivo + PTY Integrado</span>
        </div>

        <div className="proto-controls-group">
          <div className="proto-mix-tabs">
            <button
              type="button"
              className={activeTab === 'workspace' ? 'active' : ''}
              onClick={() => setActiveTab('workspace')}
            >
              🏢 Workspace 2.5D
            </button>
            <button
              type="button"
              className={activeTab === 'operations' ? 'active' : ''}
              onClick={() => setActiveTab('operations')}
            >
              📊 Operações & Trilha
            </button>
            <button
              type="button"
              className={activeTab === 'terminal' ? 'active' : ''}
              onClick={() => setActiveTab('terminal')}
            >
              ⌨️ Terminal PTY
            </button>
          </div>
          <span className="proto-mock-pill">PROTÓTIPO HÍBRIDO B + C</span>
        </div>
      </div>

      {/* 2. BANNER DA MISSÃO EM ANDAMENTO (Visível em todos os modos) */}
      <div className="proto-mix-mission-bar">
        <div className="mission-bar-left">
          <span className="proto-mission-pill">MISSÃO ATIVA #104</span>
          <h3>Módulo de Cadastro e Cálculo Contábil</h3>
          <span className="proto-mission-repo">aidw-e2e-etapa8 · branch: main</span>
        </div>

        {/* Stepper Compacto com Nós e Conectores */}
        <div className="proto-mini-stepper">
          <div className="mini-step step-done" title="Planejamento concluído">
            <span className="mini-num">✓</span>
            <span>Planejamento</span>
          </div>
          <div className="mini-line line-done" />
          <div className="mini-step step-active" title="Desenvolvimento em execução">
            <span className="mini-num">⚡</span>
            <span>Dev (Linus)</span>
          </div>
          <div className="mini-line" />
          <div className="mini-step step-waiting" title="Aguardando Dev">
            <span className="mini-num">3</span>
            <span>Segurança</span>
          </div>
          <div className="mini-line" />
          <div className="mini-step step-waiting" title="Aguardando Auditoria">
            <span className="mini-num">4</span>
            <span>QA Review</span>
          </div>
        </div>

        <div className="mission-bar-right">
          <span className="tag tag-green">● Em Execução</span>
          <span className="tag-evidences">74 Evidências</span>
        </div>
      </div>

      {/* 3. CORPO PRINCIPAL COM CONTEÚDO DINÂMICO */}
      <div className="proto-mix-body">
        {/* ABA 1: LIVING WORKSPACE 2.5D MODERNO COM NAVEGAÇÃO ESPACIAL */}
        {activeTab === 'workspace' && (
          <div 
            className={`proto-mix-stage-area ${isDragging ? 'is-dragging' : ''}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Palco do Escritório Tecnológico 2.5D */}
            <div 
              className={`proto-mix-iso-canvas ${isIsoPerspective ? 'is-iso' : 'is-flat'} ${isDragging ? 'is-dragging' : ''}`}
              style={{
                transform: isIsoPerspective
                  ? `perspective(1200px) translate3d(${pan.x}px, ${pan.y}px, 0px) scale(${zoom}) rotateX(42deg) rotateZ(-12deg)`
                  : `translate3d(${pan.x}px, ${pan.y}px, 0px) scale(${zoom})`,
                transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
              }}
            >
              {/* Piso de Madeira Escura / Carpete Tech de Escritório */}
              <div className="proto-office-floor">
                {/* Divisões de Áreas do Escritório */}
                <div className="office-zone zone-planning">
                  <span className="zone-title">📐 Sala de Arquitetura & Planning</span>
                </div>
                <div className="office-zone zone-dev">
                  <span className="zone-title">💻 Bancada de Engenharia (Dev Lab)</span>
                </div>
                <div className="office-zone zone-security">
                  <span className="zone-title">🛡️ Central de Segurança & NOC</span>
                </div>
                <div className="office-zone zone-qa">
                  <span className="zone-title">🔍 Laboratório de Qualidade QA</span>
                </div>
                <div className="office-zone zone-lounge">
                  <span className="zone-title">☕ Coffee Lounge & Descompressão</span>
                </div>
              </div>

              {/* MOBÍLIA E AMBIENTAÇÃO DE ESCRITÓRIO */}

              {/* 1. Lousa de Arquitetura / Whiteboard */}
              <div className="office-prop prop-whiteboard" title="Quadro Branco de Arquitetura e Decisões">
                <div className="whiteboard-frame">
                  <div className="whiteboard-header">
                    <span>📋 Arquitetura: Módulo Estoque</span>
                  </div>
                  <div className="whiteboard-diagram">
                    <span className="wb-box">Map()</span>
                    <span className="wb-arrow">➔</span>
                    <span className="wb-box">Centavos (Int)</span>
                    <span className="wb-arrow">➔</span>
                    <span className="wb-box">Immutable</span>
                  </div>
                  <div className="whiteboard-postits">
                    <span className="postit postit-yellow">BigInt Safe</span>
                    <span className="postit postit-pink">Sem Floats</span>
                    <span className="postit postit-cyan">110 Testes</span>
                  </div>
                </div>
              </div>

              {/* 2. Rack de Servidores / CI/CD Local */}
              <div className="office-prop prop-server-rack" title="Rack de Servidores e Trilha de Observabilidade">
                <div className="server-tower">
                  <div className="server-unit">
                    <span className="srv-label">NODE.JS RUNTIME</span>
                    <div className="srv-leds">
                      <span className="led led-green" />
                      <span className="led led-blue blink-fast" />
                    </div>
                  </div>
                  <div className="server-unit">
                    <span className="srv-label">SQLITE OBSERVABILITY</span>
                    <div className="srv-leds">
                      <span className="led led-green" />
                      <span className="led led-blue blink-slow" />
                    </div>
                  </div>
                  <div className="server-unit">
                    <span className="srv-label">PTY PROCESS MASTER</span>
                    <div className="srv-leds">
                      <span className="led led-green" />
                      <span className="led led-amber" />
                    </div>
                  </div>
                  <div className="server-vent">
                    <span className="fan-blade">❄</span>
                  </div>
                </div>
              </div>

              {/* 3. Estação de Café & Descompressão */}
              <div className="office-prop prop-coffee-station" title="Café Gourmet da Equipe">
                <div className="coffee-counter">
                  <div className="espresso-machine">
                    <span className="steam-particle s1">♨️</span>
                    <span className="coffee-icon">☕</span>
                    <span className="coffee-label">EXPRESSO DEV</span>
                  </div>
                  <div className="water-cooler" title="Bebedouro">
                    <span className="water-bottle">💧</span>
                  </div>
                  <div className="office-plant" title="Costela de Adão (Monstera)">
                    <span className="plant-leaf">🪴</span>
                  </div>
                </div>
              </div>

              {/* Linhas de Fluxo Físico entre as Mesas */}
              <svg className="proto-flow-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
                <path d="M 22 28 Q 36 24 50 48" className="flow-path flow-active" />
                <path d="M 50 48 Q 65 72 78 38" className="flow-path flow-pending" />
                <path d="M 78 38 Q 62 68 50 78" className="flow-path flow-pending" />
              </svg>

              {/* MESAS DE TRABALHO DE ESCRITÓRIO DOS AGENTES */}
              {MEMBERS.map((m, idx) => {
                const isSelected = selectedMember.id === m.id
                // Coordenadas das estações de trabalho de cada agente no escritório
                const positions = [
                  { x: 22, y: 28, room: 'Arquitetura' },
                  { x: 50, y: 48, room: 'Dev Lab' },
                  { x: 78, y: 38, room: 'Segurança' },
                  { x: 50, y: 78, room: 'QA Lab' }
                ]
                const pos = positions[idx]

                return (
                  <div
                    key={m.id}
                    className={`office-workstation ${isSelected ? 'is-selected' : ''} state-${m.state}`}
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                    onClick={() => {
                      if (hasDraggedRef.current) return
                      setSelectedMember(m)
                    }}
                  >
                    {/* Mesa de Madeira e Setup Físico do Desenvolvedor */}
                    <div className="desk-surface">
                      {/* Monitores Duplos com Telas Ligadas */}
                      <div className="desk-monitors">
                        <div className={`screen-monitor screen-ide ${m.state === 'active' ? 'screen-glow-active' : ''}`}>
                          <div className="code-lines">
                            <span className="cline c1" />
                            <span className="cline c2" />
                            <span className="cline c3" />
                          </div>
                        </div>
                        <div className="screen-monitor screen-terminal">
                          <span className="term-prompt">$</span>
                          <span className="term-cursor">_</span>
                        </div>
                      </div>

                      {/* Itens na Mesa: Teclado, Mouse e Xícara */}
                      <div className="desk-accessories">
                        <div className="desk-keyboard" />
                        <div className="desk-mouse" />
                        <div className="desk-coffee-mug" title="Café quentinho">☕</div>
                      </div>

                      {/* Cadeira de Escritório Ergonômica com o Agente Sentado */}
                      <div className="desk-chair-wrapper">
                        <div className="ergonomic-chair">
                          <div className={`agent-seated ${m.state === 'active' ? 'is-typing' : ''}`}>
                            <div className="agent-avatar-face" style={{ borderColor: m.avatarColor, boxShadow: `0 0 14px ${m.avatarColor}55` }}>
                              <span className="agent-face-emoji">{m.avatarIcon}</span>
                              <span className={`status-led led-${m.state}`} />
                            </div>

                            {/* Efeitos de Digitação e Código Flutuante no Dev */}
                            {m.state === 'active' && (
                              <div className="agent-typing-fx">
                                <span className="type-spark s1">⚡</span>
                                <span className="type-spark s2">💻</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Balão de Pensamento / Diálogo de Escritório */}
                    <div className="office-thought-bubble">
                      <div className="bubble-header">
                        <strong style={{ color: m.avatarColor }}>{m.name}</strong>
                        <span className="bubble-room">{pos.room}</span>
                      </div>
                      <p className="bubble-thought">{m.currentThought}</p>
                    </div>

                    {/* Placa de Identificação da Mesa */}
                    <div className="desk-nameplate" style={{ borderLeftColor: m.avatarColor }}>
                      <span className="nameplate-role">{m.role}</span>
                      {m.progress > 0 && (
                        <div className="nameplate-bar">
                          <div className="nameplate-fill" style={{ width: `${m.progress}%`, background: m.avatarColor }} />
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Barra de Navegação e Controles de Câmera */}
            <div className="proto-stage-controls">
              <div className="proto-drag-indicator">
                <span className="proto-drag-icon">✋</span>
                <span>Clique e arraste para o lado para explorar o espaço</span>
              </div>
              <div className="proto-cam-buttons">
                <button 
                  type="button" 
                  onClick={() => setZoom(z => Math.min(2.0, Number((z + 0.15).toFixed(2))))} 
                  title="Aproximar (+)"
                >
                  ＋
                </button>
                <button 
                  type="button" 
                  onClick={() => setZoom(z => Math.max(0.6, Number((z - 0.15).toFixed(2))))} 
                  title="Afastar (-)"
                >
                  −
                </button>
                <button 
                  type="button" 
                  onClick={resetView} 
                  title="Resetar posição e zoom"
                  className="btn-reset-view"
                >
                  ⟲ Centralizar
                </button>
                <button 
                  type="button" 
                  onClick={() => setIsIsoPerspective(!isIsoPerspective)}
                  title="Alternar entre Perspectiva 2.5D e Planta Baixa"
                  className="btn-perspective"
                >
                  {isIsoPerspective ? '📐 Visão 2.5D' : '📄 Planta Baixa 2D'}
                </button>
                {!inspectorOpen && (
                  <button
                    type="button"
                    onClick={() => setInspectorOpen(true)}
                    className="btn-open-inspector"
                    title="Abrir painel lateral do agente"
                  >
                    👤 Detalhes do Agente
                  </button>
                )}
              </div>
            </div>

            {/* Inspector Lateral Retrátil Estilo Studio */}
            {inspectorOpen ? (
              <aside className="proto-mix-inspector">
                <header className="inspector-head">
                  <div className="inspector-avatar" style={{ borderColor: selectedMember.avatarColor }}>
                    <span>{selectedMember.avatarIcon}</span>
                  </div>
                  <div>
                    <h4>{selectedMember.name}</h4>
                    <p>{selectedMember.role}</p>
                  </div>
                  <button type="button" className="btn-close" onClick={() => setInspectorOpen(false)}>✕</button>
                </header>

                <div className="inspector-body">
                  <div className="inspector-box">
                    <span className="box-tag">Status em Tempo Real</span>
                    <p className="thought-focus">{selectedMember.currentThought}</p>
                    <div className="progress-row">
                      <span>Progresso:</span>
                      <strong>{selectedMember.progress}%</strong>
                    </div>
                  </div>

                  <div className="inspector-box">
                    <span className="box-tag">Provedor & CLI</span>
                    <p><strong>{selectedMember.cli}</strong> ({selectedMember.model})</p>
                  </div>

                  <div className="inspector-box">
                    <span className="box-tag">Skills Injetadas</span>
                    <div className="skills-row">
                      {selectedMember.skills.map(s => (
                        <span key={s} className="tag tag-skill">{s}</span>
                      ))}
                    </div>
                  </div>

                  <div className="inspector-box">
                    <span className="box-tag">Métricas</span>
                    <ul className="metrics-list">
                      <li>Tarefas concluídas: <strong>{selectedMember.metrics.tasksCompleted}</strong></li>
                      <li>Evidências gravadas: <strong>{selectedMember.metrics.evidencesGenerated}</strong></li>
                      <li>Último ciclo: <strong>{selectedMember.metrics.lastActive}</strong></li>
                    </ul>
                  </div>

                  <div className="inspector-actions">
                    <button type="button" className="btn-action primary" onClick={() => setActiveTab('terminal')}>
                      Abrir Terminal PTY
                    </button>
                    <button type="button" className="btn-action" onClick={() => setActiveTab('operations')}>
                      Ver na Trilha de Evidências
                    </button>
                  </div>
                </div>
              </aside>
            ) : (
              <button type="button" className="btn-open-inspector" onClick={() => setInspectorOpen(true)}>
                ◀ Inspecionar {selectedMember.name}
              </button>
            )}
          </div>
        )}

        {/* ABA 2: PAINEL OPERACIONAL & TRILHA DE EVIDÊNCIAS */}
        {activeTab === 'operations' && (
          <div className="proto-mix-ops-view">
            <div className="ops-grid">
              {/* Card 1: Roster Resumido */}
              <div className="ops-card">
                <h3>Agentes na Missão</h3>
                <div className="ops-members-list">
                  {MEMBERS.map(m => (
                    <div 
                      key={m.id} 
                      className={`ops-member-row ${selectedMember.id === m.id ? 'active' : ''}`}
                      onClick={() => setSelectedMember(m)}
                    >
                      <span className="ops-icon">{m.avatarIcon}</span>
                      <div className="ops-member-meta">
                        <strong>{m.name}</strong>
                        <small>{m.role}</small>
                      </div>
                      <span className={`tag tag-status-${m.state}`}>{m.state}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Card 2: Trilha de Observabilidade ao Vivo */}
              <div className="ops-card ops-evidence-col">
                <div className="ops-card-head">
                  <h3>Trilha de Evidências Reais</h3>
                  <span className="proto-live-indicator">AO VIVO (WEBSOCKET)</span>
                </div>
                <div className="ops-timeline">
                  <div className="ops-ev-item ev-observed">
                    <span className="ev-bullet">●</span>
                    <div>
                      <div className="ev-top">
                        <strong>Alteração Git Observada pelo Backend</strong>
                        <time>22:42:15</time>
                      </div>
                      <p>Arquivo <code>src/estoque.js</code> criado (+68 linhas). Sem commit/push automático.</p>
                      <span className="ev-badge-obs">● Observado pelo sistema</span>
                    </div>
                  </div>

                  <div className="ops-ev-item ev-context">
                    <span className="ev-bullet">▲</span>
                    <div>
                      <div className="ev-top">
                        <strong>Skills Globais Injetadas no Prompt</strong>
                        <time>22:41:50</time>
                      </div>
                      <p>Ponytail v5.3.3 + Caveman Lite aplicadas no contexto do Dev (Linus).</p>
                      <span className="ev-badge-ctx">▲ Incluído no contexto</span>
                    </div>
                  </div>

                  <div className="ops-ev-item ev-declared">
                    <span className="ev-bullet">◆</span>
                    <div>
                      <div className="ev-top">
                        <strong>Execução de Testes Declarada</strong>
                        <time>22:41:30</time>
                      </div>
                      <p>"51 testes unitários criados com node:test" — execução de terminal não verificada pelo sistema.</p>
                      <span className="ev-badge-dec">◆ Declarado pelo agente</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ABA 3: TERMINAL PTY HEADLESS INTEGRADO */}
        {activeTab === 'terminal' && (
          <div className="proto-mix-term-view">
            <header className="term-bar">
              <div className="term-bar-left">
                <span className="term-dot green" />
                <strong>Terminal PTY — {selectedMember.name}</strong>
                <span className="term-cli-badge">{selectedMember.cli} · {selectedMember.model}</span>
              </div>
              <span className="term-cwd">~/aidw-e2e-etapa8</span>
            </header>
            <div className="term-screen">
              <p className="dim">$ {selectedMember.cli} exec -p "Implementar classe Estoque com aritmética de inteiros"</p>
              <p className="cyan">Codex: analisando diretrizes do Arquiteto e regras de dados...</p>
              <p className="cyan">Codex: gerando src/estoque.js com Map privado...</p>
              <p className="cyan">Codex: gerando test/estoque.test.js com 51 cenários de teste...</p>
              <p className="yellow">▶ node --test test/estoque.test.js</p>
              <p className="dim">  ✔ validarProduto (8.2ms)</p>
              <p className="dim">  ✔ Estoque: soma em centavos (1.6ms)</p>
              <p className="dim">  ✔ limites de precisão e Number.isSafeInteger (0.6ms)</p>
              <p className="green">ℹ tests 51, pass 51, fail 0 (133ms)</p>
              <p className="white">Codex: código e testes prontos. Liberando diff para auditoria de segurança.</p>
              <p className="cursor-line">_</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
