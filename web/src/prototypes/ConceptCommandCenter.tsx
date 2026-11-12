import { useState } from 'react'

interface MockAgent {
  id: string
  name: string
  role: string
  provider: string
  model: string
  status: 'idle' | 'working' | 'waiting' | 'error'
  currentActivity: string
  avatarColor: string
  icon: string
  specialty: string
  activeTask?: string
}

const MOCK_AGENTS: MockAgent[] = [
  {
    id: 'architect',
    name: 'Ada Lovelace',
    role: 'Tech Lead & Arquiteto',
    provider: 'Antigravity',
    model: 'gemini-3.8-flash',
    status: 'working',
    currentActivity: 'Analisando contrato de API e requisitos de persistência',
    avatarColor: '#38bdf8',
    icon: '📐',
    specialty: 'Arquitetura Limpa & Planejamento',
    activeTask: 'Decomposição em microtarefas e mitigação de riscos'
  },
  {
    id: 'dev',
    name: 'Linus Torvalds',
    role: 'Engenheiro de Software',
    provider: 'Codex',
    model: 'gpt-4o',
    status: 'working',
    currentActivity: 'Codificando módulo de produtos com aritmética de centavos',
    avatarColor: '#10b981',
    icon: '⚡',
    specialty: 'Algoritmos & ESM Nativo',
    activeTask: 'Implementando src/estoque.js com Map privado'
  },
  {
    id: 'sec',
    name: 'Bruce Schneier',
    role: 'Auditor de Segurança',
    provider: 'Antigravity',
    model: 'gemini-3.8-flash',
    status: 'waiting',
    currentActivity: 'Aguardando diff do Dev para auditoria estática',
    avatarColor: '#a855f7',
    icon: '🛡️',
    specialty: 'Sanitização & Threat Modeling',
  },
  {
    id: 'qa',
    name: 'Margaret Hamilton',
    role: 'Engenheira de Qualidade',
    provider: 'Antigravity',
    model: 'gemini-3.8-flash',
    status: 'waiting',
    currentActivity: 'Preparando matriz de casos de borda e regressão',
    avatarColor: '#f59e0b',
    icon: '🔍',
    specialty: 'Asserções Estritas & Resiliência',
  }
]

export function ConceptCommandCenter() {
  const [selectedAgent, setSelectedAgent] = useState<MockAgent>(MOCK_AGENTS[0])
  const [activeTab, setActiveTab] = useState<'overview' | 'terminal' | 'timeline'>('overview')
  const [filter, setFilter] = useState<'all' | 'working' | 'waiting'>('all')

  const filteredAgents = MOCK_AGENTS.filter(a => {
    if (filter === 'all') return true
    return a.status === filter
  })

  return (
    <div className="proto-cmd-container">
      {/* Top Banner de Identificação */}
      <div className="proto-concept-banner">
        <div>
          <span className="proto-badge">Conceito A</span>
          <strong>AI Command Center</strong>
          <span className="proto-sub"> · Foco Operacional Extremo, Densidade Alta e Hierarquia Profissional</span>
        </div>
        <span className="proto-mock-pill">DADOS MOCK DE DEMONSTRAÇÃO</span>
      </div>

      <div className="proto-cmd-layout">
        {/* Coluna 1: Roster de Agentes Interativos */}
        <section className="proto-cmd-roster">
          <div className="proto-section-header">
            <h3>Equipe Ativa ({MOCK_AGENTS.length})</h3>
            <div className="proto-filter-pills">
              <button 
                type="button" 
                className={filter === 'all' ? 'active' : ''} 
                onClick={() => setFilter('all')}
              >
                Todos
              </button>
              <button 
                type="button" 
                className={filter === 'working' ? 'active' : ''} 
                onClick={() => setFilter('working')}
              >
                Executando (2)
              </button>
            </div>
          </div>

          <div className="proto-agent-cards-grid">
            {filteredAgents.map((ag) => {
              const isSelected = selectedAgent.id === ag.id
              return (
                <div
                  key={ag.id}
                  className={`proto-agent-card ${isSelected ? 'is-selected' : ''} status-${ag.status}`}
                  onClick={() => setSelectedAgent(ag)}
                >
                  <div className="proto-card-top">
                    <div className="proto-avatar-orb" style={{ borderColor: ag.avatarColor, boxShadow: `0 0 12px ${ag.avatarColor}33` }}>
                      <span>{ag.icon}</span>
                      <span className={`proto-status-dot dot-${ag.status}`} />
                    </div>
                    <div className="proto-card-meta">
                      <h4>{ag.name}</h4>
                      <p>{ag.role}</p>
                    </div>
                    <span className="proto-provider-badge">{ag.provider}</span>
                  </div>

                  <div className="proto-card-activity">
                    <span className="proto-pulse-indicator" />
                    <p>{ag.currentActivity}</p>
                  </div>

                  <div className="proto-card-footer">
                    <span>{ag.model}</span>
                    <span className="proto-specialty-tag">{ag.specialty}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Coluna 2: Estação Central de Trabalho & Missão */}
        <section className="proto-cmd-workbench">
          {/* Status da Missão Atual */}
          <div className="proto-mission-hero">
            <div className="proto-mission-top">
              <div className="proto-mission-title">
                <span className="proto-mission-id">MISSÃO #104</span>
                <h2>Módulo de Cadastro e Cálculo Contábil</h2>
              </div>
              <span className="proto-phase-tag phase-active">Fase 2: Implementação Dev</span>
            </div>

            {/* Stepper Linear de Orquestração */}
            <div className="proto-stepper">
              <div className="proto-step step-done">
                <span className="step-num">✓</span>
                <span className="step-label">1. Planejamento (Ada)</span>
              </div>
              <div className="proto-step-line line-done" />
              <div className="proto-step step-active">
                <span className="step-num">2</span>
                <span className="step-label">2. Desenvolvimento (Linus)</span>
              </div>
              <div className="proto-step-line" />
              <div className="proto-step step-pending">
                <span className="step-num">3</span>
                <span className="step-label">3. Auditoria Segurança (Bruce)</span>
              </div>
              <div className="proto-step-line" />
              <div className="proto-step step-pending">
                <span className="step-num">4</span>
                <span className="step-label">4. Validação QA (Margaret)</span>
              </div>
            </div>
          </div>

          {/* Workbench Tabs */}
          <div className="proto-tabs-header">
            <button
              type="button"
              className={activeTab === 'overview' ? 'tab-active' : ''}
              onClick={() => setActiveTab('overview')}
            >
              Foco do Agente: {selectedAgent.name}
            </button>
            <button
              type="button"
              className={activeTab === 'terminal' ? 'tab-active' : ''}
              onClick={() => setActiveTab('terminal')}
            >
              Terminal Headless PTY
            </button>
            <button
              type="button"
              className={activeTab === 'timeline' ? 'tab-active' : ''}
              onClick={() => setActiveTab('timeline')}
            >
              Trilha de Observabilidade
            </button>
          </div>

          <div className="proto-tab-body">
            {activeTab === 'overview' && (
              <div className="proto-overview-pane">
                <div className="proto-info-banner">
                  <div className="proto-agent-hero-avatar" style={{ background: `${selectedAgent.avatarColor}22`, borderColor: selectedAgent.avatarColor }}>
                    <span style={{ fontSize: '32px' }}>{selectedAgent.icon}</span>
                  </div>
                  <div className="proto-agent-hero-text">
                    <h3>{selectedAgent.name}</h3>
                    <p>{selectedAgent.role} · <strong>{selectedAgent.provider}</strong> ({selectedAgent.model})</p>
                    <span className="proto-chip">Skills Aplicadas: Ponytail v5.3 + Caveman Lite</span>
                  </div>
                </div>

                <div className="proto-context-feed">
                  <h4>Contexto & Atividade Atual</h4>
                  <div className="proto-feed-item">
                    <span className="feed-time">22:40:15</span>
                    <span className="feed-tag tag-context">▲ Incluído no contexto</span>
                    <p>Recomendações do Arquiteto injetadas: "Tratar preços com aritmética de inteiros (centavos) para neutralizar resíduos binários IEEE 754."</p>
                  </div>
                  <div className="proto-feed-item">
                    <span className="feed-time">22:41:02</span>
                    <span className="feed-tag tag-observed">● Observado pelo sistema</span>
                    <p>Arquivo modificado detectado pelo Git: <code>src/estoque.js (+68 linhas, -0)</code>.</p>
                  </div>
                  <div className="proto-feed-item">
                    <span className="feed-time">22:41:45</span>
                    <span className="feed-tag tag-declared">◆ Declarado pelo agente</span>
                    <p>"51 testes unitários estruturados com node:test sem dependências externas."</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'terminal' && (
              <div className="proto-terminal-pane">
                <div className="proto-terminal-header">
                  <span>bash — codex exec (PID: 38412)</span>
                  <span className="proto-term-status">● CONECTADO</span>
                </div>
                <div className="proto-terminal-output">
                  <p className="term-dim">$ codex exec --model default -p "Implementar src/estoque.js"</p>
                  <p className="term-green">✓ Análise de requisitos concluída</p>
                  <p className="term-cyan">ℹ Escrevendo src/estoque.js...</p>
                  <p className="term-cyan">ℹ Escrevendo test/estoque.test.js...</p>
                  <p className="term-yellow">▶ node --test</p>
                  <p className="term-dim">  ✔ validarProduto (8.2ms)</p>
                  <p className="term-dim">  ✔ Estoque (1.6ms)</p>
                  <p className="term-dim">  ✔ limites de precisão (0.6ms)</p>
                  <p className="term-green">ℹ tests 51, pass 51, fail 0 (133ms)</p>
                  <p className="term-glow">Codex: Aguardando verificação da auditoria de segurança...</p>
                </div>
              </div>
            )}

            {activeTab === 'timeline' && (
              <div className="proto-timeline-pane">
                <div className="proto-timeline-item">
                  <span className="tl-badge badge-observed">● Observado</span>
                  <div>
                    <strong>Plano aprovado pelo usuário no navegador</strong>
                    <p className="tl-sub">Usuário confirmou o plano proposto pelo Arquiteto para prosseguir ao Dev.</p>
                  </div>
                </div>
                <div className="proto-timeline-item">
                  <span className="tl-badge badge-context">▲ Contexto</span>
                  <div>
                    <strong>Diretrizes do Especialista em Dados encaminhadas ao Dev</strong>
                    <p className="tl-sub">Contrato estrito de normalização e validação de finitude repassado via prompt.</p>
                  </div>
                </div>
                <div className="proto-timeline-item">
                  <span className="tl-badge badge-declared">◆ Declarado</span>
                  <div>
                    <strong>Relatório de implementação produzido pelo Dev</strong>
                    <p className="tl-sub">Dev alega conformidade com o plano e 51 testes criados (sujeito a QA).</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
