import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { isOpenMission } from '../../../shared/missionPhases.ts'
import type { AgentConfig, AgentInfo, GitStatus, MissionInfo, TaskInfo } from '../../../shared/protocol.ts'
import type { WorldAction } from '../game/WorldBridge.ts'
import type { Send, Subscribe } from '../net/useServer.ts'
import { LazyPhaserGame } from '../lazyScreens.ts'
import { AgentPortrait } from './AgentPortrait.tsx'
import { AgentWindow } from './AgentWindow.tsx'
import { GitPanel } from './GitPanel.tsx'
import { MissionMonitor } from './MissionMonitor.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { useMissionEvents, usePlan } from '../net/useMission.ts'
import { agentForwards, teamView } from './dynamicView.ts'

interface Props {
  agents: AgentInfo[]
  configs: AgentConfig[]
  selectedAgentId: string | null
  onSelectAgent: (id: string | null) => void
  sidePanelOpen: boolean
  sideTab: 'agent' | 'git' | 'mission'
  onCloseSidePanel: () => void
  onSetSideTab: (tab: 'agent' | 'git' | 'mission') => void
  gitStatus: GitStatus | null
  projectName?: string
  projectPath?: string
  missions: MissionInfo[]
  tasks: TaskInfo[]
  activeProjectId: number | null
  online: boolean
  send: Send
  subscribe: Subscribe
  onAction?: (action: WorldAction) => void
  onOpenTasks: () => void
  onOpenObservability: (missionId?: number | null, agentId?: string | null) => void
}

function formatDockRole(ag: AgentInfo): string {
  const text = `${ag.role || ''} ${ag.name || ''} ${ag.id || ''}`.toLowerCase()
  if (text.includes('dado') || text.includes('data') || text.includes('sql') || text.includes('banco')) {
    return text.includes('2') || text.includes('alt') || ag.id.endsWith('2') ? 'Dados (Alt)' : 'Eng. Dados'
  }
  if (text.includes('seguran') || text.includes('sec') || text.includes('security') || text.includes('audit')) {
    return text.includes('2') || text.includes('alt') || ag.id.endsWith('2') ? 'Segurança (Alt)' : 'Segurança'
  }
  if (text.includes('arquit') || text.includes('architect') || ag.id === 'architect' || ag.id === 'lead') return 'Tech Lead'
  if (text.includes('qa') || text.includes('qualidade') || text.includes('test') || ag.id === 'qa') return 'QA Tester'
  if (text.includes('dev') || text.includes('desenvolv') || ag.id === 'dev') return 'Desenvolvedor'
  if (text.includes('tutor') || text.includes('mentor') || ag.id === 'tutor') return 'Mentor'
  if (text.includes('design') || text.includes('ui') || text.includes('ux')) return 'Designer'
  if (text.includes('doc') || text.includes('texto') || text.includes('manual')) return 'Docs'
  if (text.includes('devops') || text.includes('infra') || text.includes('cloud')) return 'DevOps'
  if (text.includes('mobile') || text.includes('app')) return 'Mobile'
  if (text.includes('ia') || text.includes('ai') || text.includes('pesquis')) return 'Pesquisa IA'
  if (ag.role && ag.role.length <= 16) return ag.role
  if (ag.role) return ag.role.slice(0, 14) + '…'
  return 'Especialista'
}

export function StudioOfficeView({
  agents,
  configs,
  selectedAgentId,
  onSelectAgent,
  sidePanelOpen,
  sideTab,
  onCloseSidePanel,
  onSetSideTab,
  gitStatus,
  projectName,
  projectPath,
  missions,
  tasks,
  activeProjectId,
  online,
  send,
  subscribe,
  onAction,
  onOpenTasks,
  onOpenObservability,
}: Props) {
  const [zoom, setZoom] = useState<number>(1.0)

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null
  const selectedAgentConfig = selectedAgent ? configs.find((c) => c.agentId === selectedAgent.id) : undefined
  const activeMission = missions.find((m) =>
    isOpenMission(m),
  )

  // Equipe da missão dinâmica aberta: derivada das propostas aprovadas que o backend gravou.
  const dynamicMission = activeMission?.mode === 'dynamic' ? activeMission : null
  const plan = usePlan(send, subscribe, online, dynamicMission?.projectId ?? null, dynamicMission?.id ?? null)
  const events = useMissionEvents(send, subscribe, online, dynamicMission?.projectId ?? null, dynamicMission?.id ?? null)
  const team = dynamicMission && plan.loaded ? teamView(dynamicMission.plannerId || 'architect', plan.proposals) : { active: [], released: [] }
  const lastForward = agentForwards(events).at(-1) ?? null
  const seenForward = useRef<{ mission: number | null; id: number | null }>({ mission: null, id: null })
  const [forward, setForward] = useState<typeof lastForward>(null)
  useEffect(() => {
    const seen = seenForward.current
    const missionId = dynamicMission?.id ?? null
    if (seen.mission !== missionId) {
      // Outra missão: o histórico já carregado não vira animação.
      seenForward.current = { mission: missionId, id: events.length ? (lastForward?.id ?? 0) : null }
      return
    }
    if (seen.id === null) {
      if (events.length) seen.id = lastForward?.id ?? 0
      return
    }
    if (lastForward && lastForward.id > seen.id) {
      seen.id = lastForward.id
      setForward(lastForward)
    }
  }, [dynamicMission?.id, events.length, lastForward])

  const handleSelectAgent = useCallback(
    (id: string) => {
      onSelectAgent(id)
      onSetSideTab('agent')
    },
    [onSelectAgent, onSetSideTab],
  )

  return (
    <main className="proto-office-stage-layout">
      {/* 1. VISUALIZAÇÃO DO ESCRITÓRIO 2D PHASER */}
      <div
        className="office-world-viewport"
        style={{ '--office-zoom': zoom } as React.CSSProperties}
      >
        {/* Barra Flutuante de Controle de Zoom */}
        <div className="office-zoom-toolbar">
          <button
            type="button"
            className="zoom-tool-btn"
            onClick={() => {
              setZoom((prev) => {
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
              setZoom((prev) => {
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

        {/* Jogo Phaser com agentes ao vivo */}
        <ErrorBoundary fallbackTitle="Falha no mundo do escritório">
          <Suspense fallback={<div className="world-wrapper"><p className="world-loading">Carregando o escritório…</p></div>}>
            <LazyPhaserGame
              agents={agents}
              selectedId={selectedAgentId}
              onSelect={handleSelectAgent}
              onAction={onAction}
              team={team.active}
              forward={forward}
            />
          </Suspense>
        </ErrorBoundary>

        {/* Dock Flutuante Inferior Slim & Escalável (Mostra Nome + Função de cada Agente) */}
        <div className="office-bottom-dock">
          <div className="dock-cards">
            {agents.map((ag) => {
              const isSelected = selectedAgentId === ag.id
              const roleDisplay = formatDockRole(ag)
              const inTeam = team.active.includes(ag.id)
              const released = team.released.includes(ag.id)

              return (
                <button
                  key={ag.id}
                  type="button"
                  className={`dock-agent-pill ${isSelected ? 'is-selected' : ''} state-${ag.state} ${inTeam ? 'is-team' : ''} ${released ? 'is-released' : ''}`}
                  onClick={() => handleSelectAgent(ag.id)}
                  title={`${ag.name} · ${ag.role || roleDisplay}${inTeam ? ' · na equipe da missão' : released ? ' · dispensado da missão' : ''} (Clique para abrir terminal)`}
                >
                  <div className="dock-mini-portrait">
                    <AgentPortrait
                      agentId={ag.id}
                      preset={ag.avatarPreset}
                      roleOrName={ag.role ? `${ag.name} ${ag.role}` : ag.name}
                      fullBody={false}
                      animMode="idle"
                    />
                    <span className={`status-mini-dot state-${ag.state}`} />
                  </div>
                  <div className="dock-pill-info">
                    <div className="pill-name-row">
                      <strong className="dock-pill-name">{ag.name}</strong>
                      {ag.state === 'working' && <span className="dock-sparkle">⚡</span>}
                    </div>
                    <span className="dock-pill-role">
                      {roleDisplay}
                      {inTeam && <span className="dock-team-tag">equipe</span>}
                      {released && <span className="dock-team-tag dock-team-released">dispensado</span>}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 2. PAINEL LATERAL INTEGRADO: AGENTE, MISSÃO OU GIT CONTROL */}
      {sidePanelOpen && (
        <aside className="office-side-panel">
          {/* Cabeçalho com Abas Limpas */}
          <div className="panel-tab-bar">
            <button
              type="button"
              className={`panel-tab-btn ${sideTab === 'agent' ? 'is-active' : ''}`}
              onClick={() => onSetSideTab('agent')}
            >
              👤 Agente {selectedAgent ? `(${selectedAgent.name})` : ''}
            </button>
            {activeMission && (
              <button
                type="button"
                className={`panel-tab-btn ${sideTab === 'mission' ? 'is-active' : ''}`}
                onClick={() => onSetSideTab('mission')}
              >
                🚀 Missão (#{activeMission.id})
              </button>
            )}
            <button
              type="button"
              className={`panel-tab-btn ${sideTab === 'git' ? 'is-active' : ''}`}
              onClick={() => onSetSideTab('git')}
            >
              🌿 Git {gitStatus?.isRepo && gitStatus.files.length > 0 ? `(${gitStatus.files.length})` : ''}
            </button>
            <button
              type="button"
              className="btn-panel-close"
              onClick={onCloseSidePanel}
              title="Fechar painel e maximizar escritório"
            >
              ✕
            </button>
          </div>

          {/* Conteúdo da Aba 1: Agente & Terminal PTY Real */}
          {sideTab === 'agent' && (
            <div className="studio-panel-body">
              {selectedAgent ? (
                <ErrorBoundary fallbackTitle="Falha na janela do agente">
                  <AgentWindow
                    agent={selectedAgent}
                    config={selectedAgentConfig}
                    online={online}
                    hasProject={activeProjectId !== null}
                    send={send}
                    subscribe={subscribe}
                    onClose={() => onSelectAgent(null)}
                    onOpenObservability={(agId) => onOpenObservability(null, agId)}
                  />
                </ErrorBoundary>
              ) : (
                <div className="empty-panel-prompt">
                  <div className="prompt-icon">👤</div>
                  <strong>Nenhum Agente Selecionado</strong>
                  <p>Clique em qualquer agente no escritório ou na barra inferior para abrir o terminal PTY e ver o que ele está fazendo.</p>
                </div>
              )}
            </div>
          )}

          {/* Conteúdo da Aba 2: Monitor de Missão Real */}
          {sideTab === 'mission' && (
            <div className="studio-panel-body">
              <ErrorBoundary fallbackTitle="Falha no Monitor de Missão">
                <MissionMonitor
                  missions={missions}
                  tasks={tasks}
                  agents={agents}
                  configs={Object.values(configs)}
                  activeProjectId={activeProjectId}
                  projectName={projectName}
                  online={online}
                  send={send}
                  subscribe={subscribe}
                  collapsed={false}
                  onToggleCollapse={() => {}}
                  onOpenTasks={onOpenTasks}
                  onOpenObservability={(mId) => onOpenObservability(mId, null)}
                />
              </ErrorBoundary>
            </div>
          )}

          {/* Conteúdo da Aba 3: Git Control Real */}
          {sideTab === 'git' && (
            <div className="studio-panel-body">
              <ErrorBoundary fallbackTitle="Falha no painel Git">
                <GitPanel
                  status={gitStatus}
                  projectName={projectName}
                  projectPath={projectPath}
                  send={send}
                  subscribe={subscribe}
                  collapsed={false}
                />
              </ErrorBoundary>
            </div>
          )}
        </aside>
      )}
    </main>
  )
}
