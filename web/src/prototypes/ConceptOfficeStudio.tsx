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
    terminalOutput: [
      '$ agy qa-suite --project aidw-e2e-etapa8',
      'Configuração pronta.',
      'Aguardando entrega do código e parecer de segurança.'
    ]
  }
}

export function ConceptOfficeStudio() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>('dev')
  const [sideTab, setSideTab] = useState<'agent' | 'git'>('agent')
  const [sidePanelOpen, setSidePanelOpen] = useState(true)
  const [selectedGitFile, setSelectedGitFile] = useState('src/estoque.js')
  const [commitMessage, setCommitMessage] = useState('')

  // Estado do Seletor Rápido de Projetos / Pastas
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [projectSearch, setProjectSearch] = useState('')
  const [zoom, setZoom] = useState<number>(1.0)
  const [activeProject, setActiveProject] = useState({
    name: 'aidw-e2e-etapa8',
    path: 'C:\\AI DEV WORD\\repos\\aidw-e2e-etapa8',
    branch: 'main'
  })

  const RECENT_PROJECTS = [
    { name: 'aidw-e2e-etapa8', path: 'C:\\AI DEV WORD\\repos\\aidw-e2e-etapa8', branch: 'main', isGit: true, lastOpened: 'Ativo agora' },
    { name: 'ai-dev-world-core', path: 'C:\\AI DEV WORD', branch: 'etapa-9-redesign-prototipos', isGit: true, lastOpened: 'Há 1 hora' },
    { name: 'ecommerce-backend', path: 'C:\\Projetos\\ecommerce-backend', branch: 'feat/checkout', isGit: true, lastOpened: 'Ontem' },
    { name: 'fintech-api', path: 'D:\\Dev\\fintech-api', branch: 'main', isGit: true, lastOpened: 'Há 3 dias' }
  ]

  const filteredProjects = RECENT_PROJECTS.filter(p =>
    p.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
    p.path.toLowerCase().includes(projectSearch.toLowerCase())
  )

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedAgentId(id)
    setSideTab('agent')
    setSidePanelOpen(true)
  }, [])

  const handleBrowseNativeFolder = async () => {
    try {
      if ('showDirectoryPicker' in window) {
        // @ts-expect-error File System Access API
        const dirHandle = await window.showDirectoryPicker()
        if (dirHandle?.name) {
          setActiveProject({
            name: dirHandle.name,
            path: `C:\\...\\${dirHandle.name}`,
            branch: 'main'
          })
          setProjectModalOpen(false)
        }
      } else {
        alert('Janela de navegação nativa do Windows Explorer aberta.')
      }
    } catch {
      // cancelado pelo usuário
    }
  }

  const selectedDetail = selectedAgentId ? AGENTS_DETAILS[selectedAgentId] : AGENTS_DETAILS.dev

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

          {/* Botão de Projeto Ativo com Seletor Rápido */}
          <div className="project-selector-wrapper">
            <button
              type="button"
              className="project-pill-btn"
              onClick={() => setProjectModalOpen(!projectModalOpen)}
              title="Clique para trocar de pasta ou procurar no PC"
            >
              <span className="pill-icon">📁</span>
              <strong className="pill-name">{activeProject.name}</strong>
              <span className="branch-tag">{activeProject.branch}</span>
              <span className="pill-caret">{projectModalOpen ? '▲' : '▼'}</span>
            </button>

            {/* Modal / Popover de Busca Simples no PC Inteiro */}
            {projectModalOpen && (
              <div className="project-popover">
                <div className="popover-head">
                  <div className="popover-search-box">
                    <span className="search-icon">🔍</span>
                    <input
                      type="text"
                      className="popover-search-input"
                      placeholder="Buscar projetos recentes ou digite o caminho..."
                      value={projectSearch}
                      onChange={e => setProjectSearch(e.target.value)}
                      autoFocus
                    />
                  </div>
                </div>

                {/* Botão de Ação Direta no Sistema de Arquivos */}
                <div className="popover-browse-action">
                  <button
                    type="button"
                    className="btn-browse-computer"
                    onClick={handleBrowseNativeFolder}
                  >
                    <span className="browse-icon">📂</span>
                    <div className="browse-text">
                      <strong>Procurar Pasta no Computador...</strong>
                      <span>Abre o Windows Explorer para escolher qualquer diretório</span>
                    </div>
                    <span className="browse-arrow">➔</span>
                  </button>
                </div>

                {/* Atalhos Rápidos de Pastas Comuns */}
                <div className="popover-shortcuts">
                  <span className="shortcuts-lbl">Atalhos Comuns:</span>
                  <div className="shortcuts-list">
                    <button
                      type="button"
                      className="shortcut-tag"
                      onClick={() => {
                        setActiveProject({ name: 'AI DEV WORD', path: 'C:\\AI DEV WORD', branch: 'main' })
                        setProjectModalOpen(false)
                      }}
                    >
                      🏠 C:\AI DEV WORD
                    </button>
                    <button
                      type="button"
                      className="shortcut-tag"
                      onClick={() => {
                        setActiveProject({ name: 'Projetos', path: 'C:\\Projetos', branch: 'main' })
                        setProjectModalOpen(false)
                      }}
                    >
                      📁 C:\Projetos
                    </button>
                    <button
                      type="button"
                      className="shortcut-tag"
                      onClick={() => {
                        setActiveProject({ name: 'Desktop', path: 'C:\\Users\\Desktop', branch: 'main' })
                        setProjectModalOpen(false)
                      }}
                    >
                      💻 Área de Trabalho
                    </button>
                  </div>
                </div>

                {/* Lista de Projetos Recentes */}
                <div className="popover-recent-list">
                  <span className="recent-lbl">Projetos Recentes:</span>
                  {filteredProjects.map(p => (
                    <div
                      key={p.path}
                      className={`recent-project-row ${activeProject.name === p.name ? 'is-current' : ''}`}
                      onClick={() => {
                        setActiveProject({ name: p.name, path: p.path, branch: p.branch })
                        setProjectModalOpen(false)
                      }}
                    >
                      <span className="row-icon">{p.isGit ? '' : '📁'}</span>
                      <div className="row-info">
                        <strong>{p.name}</strong>
                        <span className="row-path">{p.path}</span>
                      </div>
                      <span className="row-branch">{p.branch}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Pipeline Visual e Intuitivo da Missão */}
        <div className="mission-pipeline-center">
          <div className="pipeline-meta-row">
            <span className="pipeline-title">
              <strong className="mission-id">#104</strong> Módulo de Cadastro e Estoque
            </span>
            <span className="pipeline-progress-badge">Etapa 2 de 4 · 50%</span>
          </div>

          <div className="pipeline-track">
            {/* Etapa 1: Planejamento */}
            <button
              type="button"
              className="pipeline-step step-done"
              onClick={() => handleSelectAgent('lead')}
              title="Etapa 1: Planejamento concluído por Ada Lovelace"
            >
              <span className="step-circle">✓</span>
              <div className="step-texts">
                <strong>Planejamento</strong>
                <span>Ada (Concluído)</span>
              </div>
            </button>

            <span className="pipeline-connector conn-done" />

            {/* Etapa 2: Dev (Ativa) */}
            <button
              type="button"
              className="pipeline-step step-active"
              onClick={() => handleSelectAgent('dev')}
              title="Etapa 2: Linus Torvalds implementando agora"
            >
              <span className="step-circle pulse-circle">⚡</span>
              <div className="step-texts">
                <strong>Desenvolvimento</strong>
                <span className="sub-active">Linus (Codando 84%)</span>
              </div>
            </button>

            <span className="pipeline-connector conn-pending" />

            {/* Etapa 3: Segurança */}
            <button
              type="button"
              className="pipeline-step step-waiting"
              onClick={() => handleSelectAgent('sec')}
              title="Etapa 3: Auditoria SAST por Bruce Schneier"
            >
              <span className="step-circle">🛡️</span>
              <div className="step-texts">
                <strong>Segurança</strong>
                <span>Bruce (Na fila)</span>
              </div>
            </button>

            <span className="pipeline-connector conn-pending" />

            {/* Etapa 4: QA */}
            <button
              type="button"
              className="pipeline-step step-waiting"
              onClick={() => handleSelectAgent('qa')}
              title="Etapa 4: Verificação de testes por Margaret Hamilton"
            >
              <span className="step-circle">🔍</span>
              <div className="step-texts">
                <strong>Qualidade</strong>
                <span>Margaret (Na fila)</span>
              </div>
            </button>
          </div>
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className={`btn-topbar-tab ${sidePanelOpen && sideTab === 'git' ? 'active' : ''}`}
            onClick={() => {
              setSideTab('git')
              setSidePanelOpen(true)
            }}
          >
            🌿 Git Control (2)
          </button>
          <button
            type="button"
            className={`btn-topbar-tab ${sidePanelOpen && sideTab === 'agent' ? 'active' : ''}`}
            onClick={() => {
              setSideTab('agent')
              setSidePanelOpen(true)
            }}
          >
            👤 Agente Ativo
          </button>
          <button
            type="button"
            className="btn-topbar-toggle"
            onClick={() => {
              setSidePanelOpen(prev => {
                const next = !prev
                setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
                setTimeout(() => window.dispatchEvent(new Event('resize')), 250)
                return next
              })
            }}
            title="Alternar painel lateral"
          >
            {sidePanelOpen ? '⛶ Maximizar Escritório' : '☰ Abrir Painel'}
          </button>
        </div>
      </header>

      {/* 2. PALCO PRINCIPAL COM O ESCRITÓRIO 2D PHASER E PAINEL LATERAL */}
      <main className="proto-office-stage-layout">
        {/* Visualização Central do Escritório 2D */}
        <div
          className="office-world-viewport"
          style={{ '--office-zoom': zoom } as React.CSSProperties}
        >
          {/* Barra de Controle de Zoom Flutuante */}
          <div className="office-zoom-toolbar">
            <button
              type="button"
              className="zoom-tool-btn"
              onClick={() => {
                setZoom(prev => {
                  const next = Math.max(0.6, Math.round((prev - 0.15) * 100) / 100)
                  setTimeout(() => window.dispatchEvent(new Event('resize')), 40)
                  return next
                })
              }}
              title="Diminuir Zoom (-)"
            >
              −
            </button>
            <span className="zoom-val-badge">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="zoom-tool-btn"
              onClick={() => {
                setZoom(prev => {
                  const next = Math.min(2.5, Math.round((prev + 0.15) * 100) / 100)
                  setTimeout(() => window.dispatchEvent(new Event('resize')), 40)
                  return next
                })
              }}
              title="Aumentar Zoom (+)"
            >
              +
            </button>
            <div className="zoom-sep" />
            <button
              type="button"
              className={`zoom-preset-pill ${zoom === 1.0 ? 'active' : ''}`}
              onClick={() => {
                setZoom(1.0)
                setTimeout(() => window.dispatchEvent(new Event('resize')), 40)
              }}
              title="Ajustar automaticamente ao espaço da tela (Padrão)"
            >
              ⛶ Ajustar
            </button>
            <button
              type="button"
              className={`zoom-preset-pill ${zoom === 1.3 ? 'active' : ''}`}
              onClick={() => {
                setZoom(1.3)
                setTimeout(() => window.dispatchEvent(new Event('resize')), 40)
              }}
              title="Zoom Próximo (130%)"
            >
              1.3x
            </button>
          </div>

          <PhaserGame
            agents={AGENTS_LIST}
            selectedId={selectedAgentId}
            onSelect={handleSelectAgent}
          />

          {/* Dock Flutuante Inferior Slim & Escalável (Mostra Nome + Função) */}
          <div className="office-bottom-dock">
            <div className="dock-cards">
              {AGENTS_LIST.map((ag) => {
                const isSelected = selectedAgentId === ag.id
                const meta = ag.id === 'lead' ? { name: 'Ada', role: 'Arquiteta' }
                  : ag.id === 'dev' ? { name: 'Linus', role: 'Desenvolvedor' }
                  : ag.id === 'sec' ? { name: 'Bruce', role: 'Segurança' }
                  : { name: 'Margaret', role: 'QA' }

                return (
                  <button
                    key={ag.id}
                    type="button"
                    className={`dock-agent-pill ${isSelected ? 'is-selected' : ''} state-${ag.state}`}
                    onClick={() => handleSelectAgent(ag.id)}
                    title={`${meta.name} (${meta.role}) · Clique para ver terminal`}
                  >
                    <div className="dock-mini-portrait">
                      <AgentPortrait agentId={ag.id} fullBody={false} animMode="idle" />
                      <span className={`status-mini-dot state-${ag.state}`} />
                    </div>
                    <div className="dock-pill-info">
                      <div className="pill-name-row">
                        <strong className="dock-pill-name">{meta.name}</strong>
                        {ag.state === 'working' && <span className="dock-sparkle">⚡</span>}
                      </div>
                      <span className="dock-pill-role">{meta.role}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* 3. PAINEL LATERAL INTEGRADO: AGENTE OU GIT CONTROL */}
        {sidePanelOpen && (
          <aside className="office-side-panel">
            {/* Cabeçalho com Abas Limpas: Agente vs Git */}
            <div className="panel-tab-bar">
              <button
                type="button"
                className={`panel-tab-btn ${sideTab === 'agent' ? 'is-active' : ''}`}
                onClick={() => setSideTab('agent')}
              >
                👤 Agente ({selectedDetail.name.split(' ')[0]})
              </button>
              <button
                type="button"
                className={`panel-tab-btn ${sideTab === 'git' ? 'is-active' : ''}`}
                onClick={() => setSideTab('git')}
              >
                🌿 Git Control (2)
              </button>
              <button
                type="button"
                className="btn-panel-close"
                onClick={() => setSidePanelOpen(false)}
                title="Fechar painel"
              >
                ✕
              </button>
            </div>

            {/* CONTEÚDO DA ABA 1: AGENTE DESPOLUÍDO */}
            {sideTab === 'agent' && (
              <div className="panel-content agent-clean-view">
                {/* Cabeçalho do Agente */}
                <div className="agent-clean-head">
                  <div className="agent-clean-portrait">
                    <AgentPortrait agentId={selectedDetail.id} fullBody animMode="idle" />
                  </div>
                  <div className="agent-clean-info">
                    <div className="info-row-top">
                      <h3>{selectedDetail.name}</h3>
                      <span className={`badge-state state-${selectedDetail.state}`}>
                        {selectedDetail.state.toUpperCase()}
                      </span>
                    </div>
                    <p className="agent-role-sub">{selectedDetail.role}</p>
                    <div className="clean-skills-chips">
                      <span className="cli-chip">{selectedDetail.cli} ({selectedDetail.model})</span>
                      {selectedDetail.skills.map(s => (
                        <span key={s} className="skill-chip">✦ {s}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Atividade Atual Focada */}
                <div className="agent-activity-strip">
                  <div className="strip-title-row">
                    <span className="strip-label">Foco Atual</span>
                    <span className="strip-percent">{selectedDetail.progress}%</span>
                  </div>
                  <p className="strip-thought">{selectedDetail.currentThought}</p>
                  <div className="strip-bar">
                    <div className="strip-fill" style={{ width: `${selectedDetail.progress}%` }} />
                  </div>
                </div>

                {/* Terminal PTY em Destaque Limpo */}
                <div className="agent-terminal-clean">
                  <div className="terminal-clean-header">
                    <span className="terminal-title">Terminal PTY — Sessão Interativa</span>
                    <span className="terminal-live-dot">● Ao Vivo</span>
                  </div>
                  <div className="terminal-clean-screen">
                    {selectedDetail.terminalOutput.map((line, idx) => (
                      <div key={idx} className="term-text-line">
                        {line}
                      </div>
                    ))}
                    <div className="term-active-prompt">
                      <span className="prompt-sym">$</span>
                      <span className="prompt-cursor" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* CONTEÚDO DA ABA 2: GIT CONTROL INTEGRADO */}
            {sideTab === 'git' && (
              <div className="panel-content git-control-view">
                {/* Resumo do Repositório */}
                <div className="git-repo-bar">
                  <div className="git-branch-info">
                    <span className="git-branch-icon"></span>
                    <strong>main</strong>
                    <span className="git-sync-status">Sincronizado com origin</span>
                  </div>
                  <span className="git-badge-changes">2 arquivos modificados</span>
                </div>

                {/* Lista de Arquivos com Status */}
                <div className="git-files-section">
                  <span className="git-section-title">Modificações Locais</span>
                  <div className="git-files-list">
                    <div
                      className={`git-file-row ${selectedGitFile === 'src/estoque.js' ? 'is-selected' : ''}`}
                      onClick={() => setSelectedGitFile('src/estoque.js')}
                    >
                      <span className="git-status-tag tag-mod">M</span>
                      <span className="git-file-name">src/estoque.js</span>
                      <span className="git-diff-count">+48</span>
                    </div>
                    <div
                      className={`git-file-row ${selectedGitFile === 'tests/estoque.test.js' ? 'is-selected' : ''}`}
                      onClick={() => setSelectedGitFile('tests/estoque.test.js')}
                    >
                      <span className="git-status-tag tag-add">A</span>
                      <span className="git-file-name">tests/estoque.test.js</span>
                      <span className="git-diff-count">+110</span>
                    </div>
                  </div>
                </div>

                {/* Prévia do Diff do Arquivo Selecionado */}
                <div className="git-diff-preview">
                  <div className="diff-header">
                    <span>Diff: <strong>{selectedGitFile}</strong></span>
                    <span className="diff-mode-tag">Unstaged</span>
                  </div>
                  <pre className="diff-code-box">
{selectedGitFile === 'src/estoque.js' ? `+ export class EstoqueService {
+   #produtos = new Map()
+
+   cadastrar(produto) {
+     validarLimiteMonetario(produto.precoCentavos)
+     this.#produtos.set(produto.id, produto)
+     return { ok: true, id: produto.id }
+   }
+
+   calcularValorTotal() {
+     let total = 0n
+     for (const p of this.#produtos.values()) {
+       total += BigInt(p.precoCentavos)
+     }
+     return total
+   }
+ }` : `+ import { test } from 'node:test'
+ import assert from 'node:assert/strict'
+ import { EstoqueService } from '../src/estoque.js'
+
+ test('cálculo monetário não perde centavos', () => {
+   const estoque = new EstoqueService()
+   estoque.cadastrar({ id: 1, precoCentavos: 1999 })
+   assert.equal(estoque.calcularValorTotal(), 1999n)
+ })`}
                  </pre>
                </div>

                {/* Formulário de Commit e Ações Git */}
                <div className="git-commit-form">
                  <textarea
                    className="git-commit-input"
                    placeholder="Mensagem do commit (ex: feat: calcula estoque com centavos inteiros)..."
                    value={commitMessage}
                    onChange={e => setCommitMessage(e.target.value)}
                    rows={2}
                  />
                  <div className="git-commit-actions">
                    <button type="button" className="btn-git-commit">
                      ✓ Gravar Commit Local
                    </button>
                    <button type="button" className="btn-git-push" title="Enviar para repositório remoto">
                      ⬆ Push
                    </button>
                  </div>
                </div>
              </div>
            )}
          </aside>
        )}
      </main>
    </div>
  )
}
