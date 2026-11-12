import { useState, useEffect } from 'react'
import { DynamicTopTrack } from './DynamicTopTrack.tsx'
import { isOpenMission } from '../../../shared/missionPhases.ts'
import type { AgentInfo, GitStatus, MissionInfo, TaskInfo, Workspace, ProjectInfo } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'

export type StudioTab = 'office' | 'tasks' | 'history' | 'agents' | 'memory' | 'observability'

interface Props {
  workspace: Workspace
  activeProject: { id: number; name: string; path: string } | null
  gitStatus: GitStatus | null
  activeTab: StudioTab
  onSelectTab: (tab: StudioTab) => void
  tasksCount: number
  activeMissionsCount: number
  missions: MissionInfo[]
  tasks: TaskInfo[]
  agents: AgentInfo[]
  onSelectAgent: (agentId: string) => void
  sidePanelOpen: boolean
  sideTab: 'agent' | 'git' | 'mission'
  onToggleSidePanel: (tab?: 'agent' | 'git' | 'mission') => void
  send: Send
  subscribe: Subscribe
  online: boolean
}

export function StudioTopBar({
  workspace,
  activeProject,
  gitStatus,
  activeTab,
  onSelectTab,
  tasksCount,
  activeMissionsCount,
  missions,
  tasks,
  onSelectAgent,
  sidePanelOpen,
  sideTab,
  onToggleSidePanel,
  send,
  subscribe,
  online,
}: Props) {
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [projectSearch, setProjectSearch] = useState('')

  // Escuta seleção de pasta nativa do Windows Explorer
  useEffect(() => {
    return subscribe((message) => {
      if (message.type === 'dialog-folder-selected') {
        if (message.path) {
          send({ type: 'project-add', path: message.path })
          setProjectModalOpen(false)
        }
      }
    })
  }, [send, subscribe])

  const handleBrowseNativeFolder = () => {
    send({ type: 'dialog-open-folder' })
  }

  // Identifica missão ativa para exibir na esteira
  const activeMission = missions.find((m) =>
    isOpenMission(m),
  )
  const activeTask = activeMission ? tasks.find((t) => t.id === activeMission.taskId) : null

  const filteredProjects = (workspace.projects ?? []).filter((p: ProjectInfo) =>
    p.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
    p.path.toLowerCase().includes(projectSearch.toLowerCase()),
  )

  const gitChangesCount = gitStatus?.isRepo ? gitStatus.files.length : 0

  return (
    <header className="proto-office-topbar">
      {/* 1. Lado Esquerdo: Marca Studio e Seletor Spotlight de Pastas */}
      <div className="topbar-left">
        <div
          className="brand-badge studio-brand-badge"
          onClick={() => onSelectTab('office')}
          role="button"
          tabIndex={0}
          title="AI Dev World Studio 2D"
        >
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
            title="Clique para trocar de pasta ou procurar no computador"
          >
            <span className="pill-icon">📁</span>
            <strong className="pill-name">{activeProject?.name ?? 'Selecionar Pasta'}</strong>
            <span className="branch-tag">{gitStatus?.branch ?? 'local'}</span>
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
                    placeholder="Buscar ou digite qualquer caminho (Enter para abrir)..."
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && projectSearch.trim()) {
                        send({ type: 'project-add', path: projectSearch.trim() })
                        setProjectModalOpen(false)
                        setProjectSearch('')
                      }
                    }}
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
                  disabled={!online}
                >
                  <span className="browse-icon">📂</span>
                  <div className="browse-text">
                    <strong>Procurar Pasta no Computador...</strong>
                    <span>Abre o seletor nativo do sistema operacional (Explorer / Zenity)</span>
                  </div>
                  <span className="browse-arrow">➔</span>
                </button>
              </div>

              {/* Projetos Recentes / Atalhos Rápidos */}
              <div className="popover-shortcuts">
                <span className="shortcuts-lbl">Atalhos Rápidos:</span>
                <div className="shortcuts-list">
                  {(workspace.projects ?? []).slice(0, 3).map((p: ProjectInfo) => (
                    <button
                      key={p.id}
                      type="button"
                      className="shortcut-tag"
                      onClick={() => {
                        send({ type: 'project-select', projectId: p.id })
                        setProjectModalOpen(false)
                      }}
                      title={p.path}
                    >
                      📁 {p.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="shortcut-tag"
                    onClick={() => {
                      send({ type: 'project-add', path: '.' })
                      setProjectModalOpen(false)
                    }}
                    title="Adicionar pasta do repositório atual"
                  >
                    🏠 Pasta Atual (.)
                  </button>
                </div>
              </div>

              {/* Lista de Projetos Autorizados */}
              <div className="popover-recent-list">
                <span className="recent-lbl">Projetos no Sistema:</span>
                {filteredProjects.length === 0 ? (
                  <p className="no-projects-hint">Nenhum projeto encontrado. Procure uma pasta acima.</p>
                ) : (
                  filteredProjects.map((p: ProjectInfo) => {
                    const isCurrent = activeProject?.id === p.id
                    return (
                      <div
                        key={p.id}
                        className={`recent-project-row ${isCurrent ? 'is-current' : ''}`}
                        onClick={() => {
                          send({ type: 'project-select', projectId: p.id })
                          setProjectModalOpen(false)
                        }}
                      >
                        <span className="row-icon">📁</span>
                        <div className="row-info">
                          <strong>{p.name}</strong>
                          <span className="row-path">{p.path}</span>
                        </div>
                        {isCurrent && <span className="row-branch">Ativo</span>}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Centro: Esteira Visual de Missão / CI-CD */}
      <div className="topbar-center">
        {activeMission?.mode === 'dynamic' ? (
          <DynamicTopTrack
            mission={activeMission}
            title={activeTask?.title ?? 'Missão dinâmica'}
            online={online}
            send={send}
            subscribe={subscribe}
            onSelectAgent={onSelectAgent}
          />
        ) : activeMission ? (
          <div className="pipeline-container">
            <div className="pipeline-meta-row">
              <span className="pipeline-title" title={`#${activeMission.id} ${activeTask?.title ?? 'Missão em execução'}`}>
                <strong className="mission-id">#{activeMission.id}</strong>{activeTask?.title ?? 'Missão em execução'}
              </span>
              <span className="pipeline-progress-badge">
                {activeMission.phase === 'planning' && 'Etapa 1 de 4 · Planejamento'}
                {activeMission.phase === 'awaiting_approval' && 'Aguardando Aprovação Humana'}
                {activeMission.phase === 'awaiting_clarification' && 'Aguardando Resposta'}
                {activeMission.phase === 'developing' && 'Etapa 2 de 4 · Desenvolvimento'}
                {activeMission.phase === 'reviewing' && 'Etapa 4 de 4 · Revisão QA'}
              </span>
            </div>

            <div className="pipeline-track">
              {/* Etapa 1: Planejamento */}
              <button
                type="button"
                className={`pipeline-step ${activeMission.phase === 'planning' ? 'step-active' : 'step-done'}`}
                onClick={() => onSelectAgent('lead')}
                title="Planejamento de Arquitetura (Ada Lovelace)"
              >
                <span className="step-circle">{activeMission.phase === 'planning' ? '⚡' : '✓'}</span>
                <div className="step-texts">
                  <strong>Planejamento</strong>
                  <span>Ada</span>
                </div>
              </button>

              <span className={`pipeline-connector ${activeMission.phase !== 'planning' ? 'conn-done' : 'conn-pending'}`} />

              {/* Etapa 2: Dev */}
              <button
                type="button"
                className={`pipeline-step ${
                  activeMission.phase === 'developing' ? 'step-active' : activeMission.phase === 'reviewing' ? 'step-done' : 'step-waiting'
                }`}
                onClick={() => onSelectAgent('dev')}
                title="Desenvolvimento de Código (Linus Torvalds)"
              >
                <span className="step-circle">{activeMission.phase === 'developing' ? '⚡' : activeMission.phase === 'reviewing' ? '✓' : '⚙'}</span>
                <div className="step-texts">
                  <strong>Desenvolvimento</strong>
                  <span>Linus</span>
                </div>
              </button>

              <span className={`pipeline-connector ${activeMission.phase === 'reviewing' ? 'conn-done' : 'conn-pending'}`} />

              {/* Etapa 3: Segurança */}
              <button
                type="button"
                className="pipeline-step step-waiting"
                onClick={() => onSelectAgent('sec')}
                title="Auditoria de Segurança (Bruce Schneier)"
              >
                <span className="step-circle">🛡️</span>
                <div className="step-texts">
                  <strong>Segurança</strong>
                  <span>Bruce</span>
                </div>
              </button>

              <span className="pipeline-connector conn-pending" />

              {/* Etapa 4: QA */}
              <button
                type="button"
                className={`pipeline-step ${activeMission.phase === 'reviewing' ? 'step-active' : 'step-waiting'}`}
                onClick={() => onSelectAgent('qa')}
                title="Qualidade e Testes (Margaret Hamilton)"
              >
                <span className="step-circle">🔍</span>
                <div className="step-texts">
                  <strong>Qualidade</strong>
                  <span>Margaret</span>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <div className="pipeline-idle-pill" onClick={() => onSelectTab('tasks')} role="button" tabIndex={0}>
            <span className="pipeline-idle-dot" />
            <span className="pipeline-idle-text">Nenhuma missão ativa · Clique para ver Tarefas</span>
            <span className="pipeline-idle-arrow">➔</span>
          </div>
        )}
      </div>

      {/* 3. Lado Direito: Abas de Navegação e Botões de Controle */}
      <div className="topbar-right">
        {/* Navegação Global para Painéis */}
        <nav className="studio-nav-tabs">
          <button
            type="button"
            className={`btn-studio-nav ${activeTab === 'office' ? 'active' : ''}`}
            onClick={() => onSelectTab('office')}
          >
            🏠 Escritório
          </button>
          <button
            type="button"
            className={`btn-studio-nav ${activeTab === 'tasks' ? 'active' : ''}`}
            onClick={() => onSelectTab('tasks')}
          >
            📋 Tarefas {tasksCount > 0 && <span className="nav-badge">{tasksCount}</span>}
          </button>
          <button
            type="button"
            className={`btn-studio-nav ${activeTab === 'agents' ? 'active' : ''}`}
            onClick={() => onSelectTab('agents')}
          >
            👥 Agentes
          </button>
          <button
            type="button"
            className={`btn-studio-nav ${activeTab === 'memory' ? 'active' : ''}`}
            onClick={() => onSelectTab('memory')}
          >
            🧠 Memória
          </button>
          <button
            type="button"
            className={`btn-studio-nav ${activeTab === 'observability' ? 'active' : ''}`}
            onClick={() => onSelectTab('observability')}
          >
            📊 Observabilidade
          </button>
        </nav>

        <div className="topbar-actions-sep" />

        {/* Gavetas Rápidas: Missão, Git e Agente */}
        {activeMission && (
          <button
            type="button"
            className={`btn-topbar-tab ${sidePanelOpen && sideTab === 'mission' ? 'active' : ''}`}
            onClick={() => onToggleSidePanel('mission')}
            title="Alternar painel de missão ativa"
          >
            🚀 Missão {activeMissionsCount > 0 && <span className="nav-badge cyan">{activeMissionsCount}</span>}
          </button>
        )}
        <button
          type="button"
          className={`btn-topbar-tab ${sidePanelOpen && sideTab === 'git' ? 'active' : ''}`}
          onClick={() => onToggleSidePanel('git')}
          title="Alternar painel Git Control"
        >
          🌿 Git {gitChangesCount > 0 && <span className="nav-badge cyan">{gitChangesCount}</span>}
        </button>
        <button
          type="button"
          className={`btn-topbar-tab ${sidePanelOpen && sideTab === 'agent' ? 'active' : ''}`}
          onClick={() => onToggleSidePanel('agent')}
          title="Alternar terminal do agente ativo"
        >
          👤 Agente
        </button>
        <button
          type="button"
          className="btn-topbar-toggle"
          onClick={() => onToggleSidePanel()}
          title="Alternar painel lateral para maximizar o escritório"
        >
          {sidePanelOpen ? '⛶ Maximizar' : '☰ Painel'}
        </button>
      </div>
    </header>
  )
}
