import { useState, useCallback } from 'react'
import { PhaserGame } from '../game/PhaserGame.tsx'
import { AgentPortrait } from '../ui/AgentPortrait.tsx'
import type { AgentInfo } from '../../../shared/protocol.ts'

interface AgentDetail {
  id: string
  name: string
  role: string
  cli: 'gemini' | 'codex'
  model: string
  state: 'idle' | 'working' | 'waiting' | 'error'
  currentThought: string
  activeFile?: string
  progress: number
  skills: string[]
  metrics: {
    tasksDone: number
    evidences: number
    lastActive: string
  }
  terminalOutput: string[]
}

const AGENTS_LIST: AgentInfo[] = [
  {
    id: 'lead',
    name: 'Arquiteto',
    role: 'Tech Lead & Arquiteto',
    cli: 'gemini',
    state: 'idle',
    checking: false,
    session: false,
    cliVersion: '0.1.0',
    auth: 'ok',
    message: '',
    checkedAt: null
  },
  {
    id: 'dev',
    name: 'Desenvolvedor',
    role: 'Engenheiro de Software',
    cli: 'codex',
    state: 'working',
    checking: false,
    session: true,
    cliVersion: '0.1.0',
    auth: 'ok',
    message: '',
    checkedAt: null
  },
  {
    id: 'sec',
    name: 'Segurança',
    role: 'Auditor de Segurança',
    cli: 'gemini',
    state: 'waiting',
    checking: false,
    session: false,
    cliVersion: '0.1.0',
    auth: 'ok',
    message: '',
    checkedAt: null
  },
  {
    id: 'qa',
    name: 'QA',
    role: 'Engenheira de Qualidade',
    cli: 'gemini',
    state: 'waiting',
    checking: false,
    session: false,
    cliVersion: '0.1.0',
    auth: 'ok',
    message: '',
    checkedAt: null
  }
]

const AGENTS_DETAILS: Record<string, AgentDetail> = {
  lead: {
    id: 'lead',
    name: 'Ada (Arquiteta)',
    role: 'Tech Lead & Arquitetura',
    cli: 'gemini',
    model: 'gemini-3.8-flash',
    state: 'idle',
    currentThought: 'Plano aprovado pelo usuário. Monitorando cumprimento de contratos.',
    progress: 100,
    skills: ['Ponytail v5.3', 'Caveman Lite'],
    metrics: { tasksDone: 14, evidences: 28, lastActive: 'Há 5 min' },
    terminalOutput: [
      '$ agy plan --project aidw-e2e-etapa8',
      '✔ Diretrizes carregadas com sucesso.',
      '✔ Contratos validados: BigInt centavos inteiros.',
      'Plano estruturado e submetido para aprovação humana.',
      'Aguardando conclusão do Dev e QA para veredito final.'
    ]
  },
  dev: {
    id: 'dev',
    name: 'Linus (Desenvolvedor)',
    role: 'Engenheiro de Código',
    cli: 'codex',
    model: 'gpt-4o',
    state: 'working',
    currentThought: 'Escrevendo src/estoque.js com validação de limite monetário e centavos.',
    activeFile: 'src/estoque.js',
    progress: 84,
    skills: ['Ponytail v5.3', 'Caveman Lite'],
    metrics: { tasksDone: 32, evidences: 94, lastActive: 'Agora' },
    terminalOutput: [
      '$ codex exec --task "Módulo de Cadastro e Estoque"',
      'Lendo especificação de arquitetura de Ada...',
      'Criando classe Produto com Map() privado...',
      'Validando precisão de cálculo monetário em centavos...',
      'Executando node --test tests/estoque.test.js...',
      '✔ 51 testes passando em 24ms. Sem dependências externas.',
      'Gerando diff para auditoria de segurança...'
    ]
  },
  sec: {
    id: 'sec',
    name: 'Bruce (Segurança)',
    role: 'Auditoria de Segurança',
    cli: 'gemini',
    model: 'gemini-3.8-flash',
    state: 'waiting',
    currentThought: 'Aguardando submissão do diff do Dev para inspeção SAST.',
    progress: 0,
    skills: ['Threat Modeling', 'Input Validation'],
    metrics: { tasksDone: 9, evidences: 18, lastActive: 'Há 12 min' },
    terminalOutput: [
      '$ agy security-check --project aidw-e2e-etapa8',
      'Regras carregadas: OWASP Top 10 + Input Validation.',
      'Fila de inspeção vazia.',
      'Aguardando sinal do TeamRunner pós-desenvolvimento.'
    ]
  },
  qa: {
    id: 'qa',
    name: 'Margaret (QA)',
    role: 'Engenharia de Qualidade',
    cli: 'gemini',
    model: 'gemini-3.8-flash',
    state: 'waiting',
    currentThought: 'Pronta para execução de testes de ponta a ponta e asserções.',
    progress: 0,
    skills: ['Strict Assertions', 'Boundary Check'],
    metrics: { tasksDone: 27, evidences: 62, lastActive: 'Há 8 min' },
    terminalOutput: [
      '$ agy qa-suite --project aidw-e2e-etapa8',
      'Configuração pronta.',
      'Aguardando entrega do código e parecer de segurança.'
    ]
  }
}

export function ConceptOfficeStudio() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>('dev')
  const [bottomRosterCollapsed, setBottomRosterCollapsed] = useState(false)

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedAgentId(prev => (prev === id ? null : id))
  }, [])

  const selectedDetail = selectedAgentId ? AGENTS_DETAILS[selectedAgentId] : null

  return (
    <div className="proto-office-studio-shell">
      {/* 1. TOP BAR SLIM & MODERNA */}
      <header className="proto-office-topbar">
        <div className="topbar-left">
          <div className="brand-badge">
            <span className="brand-dot" />
            <strong>AI DEV WORLD</strong>
            <span className="brand-tag">STUDIO 2D</span>
          </div>

          <div className="project-pill" title="Repositório ativo">
            <span className="pill-icon">📁</span>
            <span>aidw-e2e-etapa8</span>
            <span className="branch-tag">main</span>
          </div>
        </div>

        {/* Stepper Central da Missão */}
        <div className="mission-stepper-center">
          <span className="stepper-mission-name">Missão #104: Módulo de Cadastro e Estoque</span>
          <div className="stepper-pills">
            <span className="st-step st-done">✓ Planejamento</span>
            <span className="st-sep">→</span>
            <span className="st-step st-active">⚡ Dev (Linus)</span>
            <span className="st-sep">→</span>
            <span className="st-step st-waiting">🛡️ Segurança</span>
            <span className="st-sep">→</span>
            <span className="st-step st-waiting">🔍 QA</span>
          </div>
        </div>

        <div className="topbar-right">
          <div className="skills-badge" title="Skills Globais Ativas">
            <span className="skill-dot" />
            <span>Ponytail v5.3 + Caveman Lite</span>
          </div>
          <span className="tag-live-status">● Sistema Ativo</span>
        </div>
      </header>

      {/* 2. PALCO PRINCIPAL COM O ESCRITÓRIO 2D PHASER E DRAWER RETRÁTIL */}
      <main className="proto-office-stage-layout">
        {/* Visualização Central do Escritório 2D */}
        <div className="office-world-viewport">
          <PhaserGame
            agents={AGENTS_LIST}
            selectedId={selectedAgentId}
            onSelect={handleSelectAgent}
          />

          {/* Dica de interação sutil */}
          <div className="office-canvas-hint">
            <span>💡 Clique em qualquer agente dentro do escritório para inspecionar</span>
          </div>

          {/* Dock Flutuante Inferior (Roster dos Agentes) */}
          <div className={`office-bottom-dock ${bottomRosterCollapsed ? 'is-collapsed' : ''}`}>
            <div className="dock-header">
              <span className="dock-title">Equipe no Escritório ({AGENTS_LIST.length})</span>
              <button
                type="button"
                className="btn-dock-toggle"
                onClick={() => setBottomRosterCollapsed(!bottomRosterCollapsed)}
              >
                {bottomRosterCollapsed ? '▲ Expandir' : '▼ Ocultar'}
              </button>
            </div>

            {!bottomRosterCollapsed && (
              <div className="dock-cards">
                {AGENTS_LIST.map((ag) => {
                  const isSelected = selectedAgentId === ag.id
                  const detail = AGENTS_DETAILS[ag.id]
                  return (
                    <div
                      key={ag.id}
                      className={`dock-agent-card ${isSelected ? 'is-selected' : ''} state-${ag.state}`}
                      onClick={() => handleSelectAgent(ag.id)}
                    >
                      <div className="dock-portrait">
                        <AgentPortrait agentId={ag.id} fullBody={false} animMode="idle" />
                        <span className={`status-indicator state-${ag.state}`} />
                      </div>
                      <div className="dock-meta">
                        <strong>{detail?.name ?? ag.name}</strong>
                        <span>{ag.role}</span>
                      </div>
                      {ag.state === 'working' && (
                        <div className="dock-activity-pulse" title="Trabalhando agora">
                          ⚡
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* 3. GAVETA LATERAL DO AGENTE (Abre ao clicar no agente) */}
        {selectedDetail && (
          <aside className="office-agent-drawer">
            <header className="drawer-head">
              <div className="drawer-agent-hero">
                <div className="drawer-avatar">
                  <AgentPortrait agentId={selectedDetail.id} fullBody animMode="idle" />
                </div>
                <div>
                  <h3>{selectedDetail.name}</h3>
                  <p>{selectedDetail.role}</p>
                  <div className="drawer-tags">
                    <span className={`badge-state state-${selectedDetail.state}`}>
                      {selectedDetail.state.toUpperCase()}
                    </span>
                    <span className="badge-cli">
                      {selectedDetail.cli} ({selectedDetail.model})
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn-drawer-close"
                onClick={() => setSelectedAgentId(null)}
                title="Fechar painel"
              >
                ✕
              </button>
            </header>

            <div className="drawer-body">
              {/* Atividade Atual */}
              <div className="drawer-section">
                <span className="section-eyebrow">Atividade em Andamento</span>
                <p className="thought-text">{selectedDetail.currentThought}</p>
                {selectedDetail.progress > 0 && (
                  <div className="drawer-progress">
                    <div className="progress-labels">
                      <span>Progresso da Tarefa:</span>
                      <strong>{selectedDetail.progress}%</strong>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${selectedDetail.progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Terminal PTY do Agente */}
              <div className="drawer-section">
                <div className="section-head-split">
                  <span className="section-eyebrow">Terminal PTY ao Vivo</span>
                  <span className="session-status">Sessão Interativa</span>
                </div>
                <div className="drawer-terminal-box">
                  <div className="terminal-log-content">
                    {selectedDetail.terminalOutput.map((line, idx) => (
                      <div key={idx} className="terminal-line">
                        {line}
                      </div>
                    ))}
                  </div>
                  <div className="terminal-input-row">
                    <span className="term-prompt">&gt;</span>
                    <input
                      type="text"
                      className="term-input"
                      placeholder="Enviar comando para o CLI..."
                      disabled
                    />
                  </div>
                </div>
              </div>

              {/* Skills Injetadas */}
              <div className="drawer-section">
                <span className="section-eyebrow">Skills Aplicadas no Prompt</span>
                <div className="skills-pill-group">
                  {selectedDetail.skills.map(s => (
                    <span key={s} className="skill-pill">
                      ✦ {s}
                    </span>
                  ))}
                </div>
              </div>

              {/* Métricas e Observabilidade */}
              <div className="drawer-section">
                <span className="section-eyebrow">Observabilidade</span>
                <div className="metrics-grid">
                  <div className="metric-box">
                    <span className="metric-num">{selectedDetail.metrics.tasksDone}</span>
                    <span className="metric-lbl">Tarefas Feitas</span>
                  </div>
                  <div className="metric-box">
                    <span className="metric-num">{selectedDetail.metrics.evidences}</span>
                    <span className="metric-lbl">Evidências</span>
                  </div>
                  <div className="metric-box">
                    <span className="metric-num">{selectedDetail.metrics.lastActive}</span>
                    <span className="metric-lbl">Última Atividade</span>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        )}
      </main>
    </div>
  )
}
