import { useState } from 'react'

interface StudioMember {
  id: string
  name: string
  role: string
  cli: string
  model: string
  state: 'active' | 'idle' | 'waiting'
  currentAction: string
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
    name: 'Ada (Arquiteto)',
    role: 'Lead System Designer',
    cli: 'agy',
    model: 'gemini-3.8-flash',
    state: 'idle',
    currentAction: 'Plano aprovado e persistido no SQLite.',
    skills: ['Ponytail 5.3', 'Caveman Lite'],
    metrics: { tasksCompleted: 14, evidencesGenerated: 28, lastActive: 'Há 5 min' }
  },
  {
    id: 'dev',
    name: 'Linus (Dev)',
    role: 'Pragmatic Implementer',
    cli: 'codex',
    model: 'gpt-4o',
    state: 'active',
    currentAction: 'Executando suíte de testes com node:test...',
    skills: ['Ponytail 5.3', 'Clean Modules'],
    metrics: { tasksCompleted: 32, evidencesGenerated: 94, lastActive: 'Agora' }
  },
  {
    id: 'sec',
    name: 'Bruce (Segurança)',
    role: 'Threat & Static Auditor',
    cli: 'agy',
    model: 'gemini-3.8-flash',
    state: 'waiting',
    currentAction: 'Aguardando encerramento do processo do Dev.',
    skills: ['Threat Modeling'],
    metrics: { tasksCompleted: 9, evidencesGenerated: 18, lastActive: 'Há 12 min' }
  },
  {
    id: 'qa',
    name: 'Margaret (QA)',
    role: 'Resilience & Verification',
    cli: 'agy',
    model: 'gemini-3.8-flash',
    state: 'waiting',
    currentAction: 'Pronta para inspeção final do veredito.',
    skills: ['Strict Assertions', 'Boundary Check'],
    metrics: { tasksCompleted: 27, evidencesGenerated: 62, lastActive: 'Há 8 min' }
  }
]

export function ConceptHybridStudio() {
  const [view, setView] = useState<'dashboard' | 'studio'>('dashboard')
  const [selectedMember, setSelectedMember] = useState<StudioMember>(MEMBERS[1])
  const [panelOpen, setPanelOpen] = useState(true)

  return (
    <div className="proto-hybrid-container">
      {/* Top Banner de Identificação */}
      <div className="proto-concept-banner">
        <div>
          <span className="proto-badge">Conceito C</span>
          <strong>Hybrid Studio</strong>
          <span className="proto-sub"> · O Melhor de Dois Mundos: Dashboard Executivo Sofisticado + Studio Interativo da Equipe</span>
        </div>
        <div className="proto-controls-group">
          {/* Alternador de Visão no Topo */}
          <div className="proto-view-switcher">
            <button
              type="button"
              className={view === 'dashboard' ? 'active' : ''}
              onClick={() => setView('dashboard')}
            >
              📊 Painel Operacional
            </button>
            <button
              type="button"
              className={view === 'studio' ? 'active' : ''}
              onClick={() => setView('studio')}
            >
              👥 Studio da Equipe
            </button>
          </div>
          <span className="proto-mock-pill">DADOS MOCK DE DEMONSTRAÇÃO</span>
        </div>
      </div>

      <div className="proto-hybrid-main">
        {/* VISÃO 1: DASHBOARD OPERACIONAL MODERNO */}
        {view === 'dashboard' && (
          <div className="proto-dash-view">
            {/* Metas & Missão em Destaque */}
            <div className="proto-dash-banner">
              <div className="dash-banner-left">
                <span className="proto-tag-cyan">MISSÃO ATIVA #104</span>
                <h2>Módulo de Cadastro e Cálculo Contábil</h2>
                <p>Repositório descartável: <code>aidw-e2e-etapa8 (git: clean)</code></p>
              </div>
              <div className="dash-banner-right">
                <div className="dash-stat-box">
                  <span className="stat-label">Etapa Atual</span>
                  <span className="stat-val stat-green">2/4 · Desenvolvimento</span>
                </div>
                <div className="dash-stat-box">
                  <span className="stat-label">Evidências Gravadas</span>
                  <span className="stat-val stat-sky">74 eventos (SQLite)</span>
                </div>
              </div>
            </div>

            {/* Grid de 3 Colunas Moderno */}
            <div className="proto-dash-grid">
              {/* Card 1: Equipe em Ação */}
              <div className="proto-dash-card">
                <div className="card-header">
                  <h3>Equipe Convocada</h3>
                  <button type="button" className="btn-link" onClick={() => setView('studio')}>Ver Studio →</button>
                </div>
                <div className="card-members-list">
                  {MEMBERS.map((m) => (
                    <div 
                      key={m.id} 
                      className={`member-row ${selectedMember.id === m.id ? 'is-selected' : ''}`}
                      onClick={() => setSelectedMember(m)}
                    >
                      <div className="member-avatar-mini">
                        <span className={`status-dot dot-${m.state}`} />
                      </div>
                      <div className="member-info">
                        <strong>{m.name}</strong>
                        <small>{m.currentAction}</small>
                      </div>
                      <span className="member-tag">{m.cli}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Card 2: Fluxo de Evidências em Tempo Real */}
              <div className="proto-dash-card">
                <div className="card-header">
                  <h3>Trilha de Evidências</h3>
                  <span className="live-pulse">AO VIVO</span>
                </div>
                <div className="card-evidence-feed">
                  <div className="ev-feed-item ev-observed">
                    <span className="ev-icon">●</span>
                    <div>
                      <strong>Git Change Observado</strong>
                      <p><code>modified: package.json, created: src/estoque.js</code></p>
                      <time>22:42:10</time>
                    </div>
                  </div>
                  <div className="ev-feed-item ev-context">
                    <span className="ev-icon">▲</span>
                    <div>
                      <strong>Skills Injetadas no Prompt</strong>
                      <p>Ponytail v5.3.3 + Caveman Lite injetadas para o Dev</p>
                      <time>22:41:50</time>
                    </div>
                  </div>
                  <div className="ev-feed-item ev-declared">
                    <span className="ev-icon">◆</span>
                    <div>
                      <strong>Testes Declarados</strong>
                      <p>Dev declara 51 testes criados (sujeito à validação do QA)</p>
                      <time>22:41:25</time>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 3: Terminal PTY Compacto & Acessível */}
              <div className="proto-dash-card">
                <div className="card-header">
                  <h3>Terminal da Sessão</h3>
                  <span className="term-pill">codex · default</span>
                </div>
                <div className="card-mini-term">
                  <p className="dim">$ codex exec -p "Implementar classe Estoque com centavos"</p>
                  <p className="cyan">Codex: implementando src/estoque.js...</p>
                  <p className="cyan">Codex: criando test/estoque.test.js...</p>
                  <p className="green">✓ Suíte concluída com 51 asserções</p>
                  <p className="amber">Aguardando auditoria de segurança pós-dev...</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VISÃO 2: STUDIO INTERATIVO DA EQUIPE */}
        {view === 'studio' && (
          <div className="proto-studio-view">
            <div className="proto-studio-canvas">
              <div className="proto-studio-stage">
                {MEMBERS.map((m) => {
                  const isSelected = selectedMember.id === m.id
                  return (
                    <div
                      key={m.id}
                      className={`proto-studio-avatar-card ${isSelected ? 'avatar-active' : ''}`}
                      onClick={() => setSelectedMember(m)}
                    >
                      <div className="avatar-graphic-ring">
                        <div className="avatar-figure">
                          {m.id === 'lead' ? '📐' : m.id === 'dev' ? '⚡' : m.id === 'sec' ? '🛡️' : '🔍'}
                        </div>
                        <span className={`status-beacon beacon-${m.state}`} />
                      </div>
                      <h4>{m.name}</h4>
                      <span className="studio-role-pill">{m.role}</span>
                      <div className="studio-thought-card">
                        <p>{m.currentAction}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Painel Lateral Retrátil de Detalhes do Membro */}
            {panelOpen && (
              <aside className="proto-studio-sidebar">
                <header className="sidebar-head">
                  <h3>{selectedMember.name}</h3>
                  <button type="button" className="btn-close" onClick={() => setPanelOpen(false)}>✕</button>
                </header>
                <div className="sidebar-content">
                  <div className="sidebar-box">
                    <span className="box-title">Especialização & Modelo</span>
                    <p><strong>{selectedMember.cli}</strong> ({selectedMember.model})</p>
                    <p className="dim">{selectedMember.role}</p>
                  </div>

                  <div className="sidebar-box">
                    <span className="box-title">Skills Conectadas</span>
                    <div className="skills-tags">
                      {selectedMember.skills.map(s => (
                        <span key={s} className="tag tag-skill">{s}</span>
                      ))}
                    </div>
                  </div>

                  <div className="sidebar-box">
                    <span className="box-title">Métricas de Performance</span>
                    <ul className="metrics-list">
                      <li>Tarefas concluídas: <strong>{selectedMember.metrics.tasksCompleted}</strong></li>
                      <li>Evidências geradas: <strong>{selectedMember.metrics.evidencesGenerated}</strong></li>
                      <li>Última atividade: <strong>{selectedMember.metrics.lastActive}</strong></li>
                    </ul>
                  </div>

                  <div className="sidebar-actions">
                    <button type="button" className="btn-studio-action primary">Inspecionar Trilha</button>
                    <button type="button" className="btn-studio-action">Abrir Terminal</button>
                  </div>
                </div>
              </aside>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
