import { Fragment, useEffect, useMemo, useState } from 'react'
import { isOpenMission } from '../../../shared/missionPhases.ts'
import type {
  AgentConfig,
  AgentInfo,
  EvidenceKind,
  MissionEvent,
  MissionEventState,
  MissionInfo,
  SkillAgentOverride,
  SkillInfo,
  Workspace,
} from '../../../shared/protocol.ts'
import { usePlan } from '../net/useMission.ts'
import type { Send, Subscribe } from '../net/useServer.ts'
import { COORDINATION_EVENTS, currentPlanSteps, EVENT_LABEL, MODE_LABEL, STEP_STATUS_LABEL } from './dynamicView.ts'

/** Eventos que mostram quem entregou o quê a quem (aba Fluxo). */
const FLOW_EVENTS = new Set(['task.delegated', 'result.forwarded', 'plan.revised', 'team.joined', 'team.released', 'replan.triggered'])
const COORDINATION_FILTER = '__coordination'

interface Props {
  workspace: Workspace
  missions: MissionInfo[]
  agents: AgentInfo[]
  configs: AgentConfig[]
  skills: SkillInfo[]
  skillOverrides: SkillAgentOverride[]
  online: boolean
  send: Send
  subscribe: Subscribe
  initialMissionId?: number | null
  initialAgentId?: string | null
  onClose?: () => void
  onSelectAgentInOffice?: (agentId: string) => void
}

/** Classificação estrita de evidência para a interface */
const EVIDENCE_META: Record<
  EvidenceKind,
  { label: string; badgeClass: string; tooltip: string; icon: string }
> = {
  observed: {
    label: 'Observado pelo sistema',
    badgeClass: 'ev-badge-observed',
    tooltip: 'Evidência direta constatada pelo backend (Git, filesystem ou saída do processo).',
    icon: '●',
  },
  declared: {
    label: 'Declarado pelo agente',
    badgeClass: 'ev-badge-declared',
    tooltip: 'Informação declarada pela IA no relatório sem verificação independente de execução.',
    icon: '◆',
  },
  context: {
    label: 'Incluído no contexto',
    badgeClass: 'ev-badge-context',
    tooltip: 'Informação injetada no prompt entregue ao CLI/mecanismo de execução.',
    icon: '▲',
  },
  unavailable: {
    label: 'Não disponível',
    badgeClass: 'ev-badge-unavailable',
    tooltip: 'Sem evidência de execução no ambiente.',
    icon: '○',
  },
}

const STATE_LABELS: Record<MissionEventState, { label: string; tone: string }> = {
  started: { label: 'Iniciado', tone: 'sky' },
  completed: { label: 'Concluído', tone: 'green' },
  failed: { label: 'Falhou', tone: 'red' },
  cancelled: { label: 'Cancelado', tone: 'amber' },
  info: { label: 'Registro', tone: 'stone' },
}

export function ObservabilityCenter({
  workspace,
  missions,
  agents,
  configs,
  skills,
  skillOverrides,
  online,
  send,
  subscribe,
  initialMissionId,
  initialAgentId,
  onClose,
  onSelectAgentInOffice,
}: Props) {
  // 1. Filtros de Seleção (estado local com fallback ao workspace)
  const [userProjectId, setUserProjectId] = useState<number | null>(null)
  const selectedProjectId = userProjectId ?? workspace.activeProjectId ?? workspace.projects[0]?.id ?? null

  const projectMissions = useMemo(() => {
    if (!selectedProjectId) return []
    return missions.filter((m) => m.projectId === selectedProjectId)
  }, [missions, selectedProjectId])

  const defaultMissionId = useMemo(() => {
    if (initialMissionId) return initialMissionId
    const running = projectMissions.find((m) =>
      isOpenMission(m),
    )
    return running?.id ?? projectMissions[0]?.id ?? null
  }, [initialMissionId, projectMissions])

  const [userMissionId, setUserMissionId] = useState<number | null>(null)
  const selectedMissionId = userMissionId !== null && projectMissions.some((m) => m.id === userMissionId)
    ? userMissionId
    : defaultMissionId

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(initialAgentId ?? null)
  const [selectedEvidenceFilter, setSelectedEvidenceFilter] = useState<EvidenceKind | 'all'>('all')
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // 2. Eventos persistidos da missão selecionada
  const [events, setEvents] = useState<MissionEvent[]>([])
  const [expandedEventIds, setExpandedEventIds] = useState<Record<number, boolean>>({})
  const [activeTab, setActiveTab] = useState<'timeline' | 'agents' | 'flow' | 'skills'>('timeline')

  // Carregar eventos ao trocar projeto ou missão via WebSocket
  useEffect(() => {
    if (!online || !selectedProjectId) {
      return
    }

    send({
      type: 'events-list',
      projectId: selectedProjectId,
      ...(selectedMissionId ? { missionId: selectedMissionId } : {}),
    })
  }, [online, selectedProjectId, selectedMissionId, send])

  // Assinar novos eventos e atualizações via WebSocket
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'mission-events') {
        if (msg.projectId === selectedProjectId) {
          if (!selectedMissionId || msg.missionId === selectedMissionId || msg.missionId === null) {
            setEvents(msg.events)
          }
        }
      } else if (msg.type === 'mission-event') {
        const ev = msg.event
        if (ev.projectId === selectedProjectId) {
          if (!selectedMissionId || ev.missionId === selectedMissionId) {
            setEvents((prev) => {
              if (prev.some((e) => e.id === ev.id)) return prev
              return [...prev, ev].sort((a, b) => a.id - b.id)
            })
          }
        }
      }
    })
  }, [subscribe, selectedProjectId, selectedMissionId])

  // Missão atualmente selecionada
  const currentMission = useMemo(() => {
    return projectMissions.find((m) => m.id === selectedMissionId) ?? null
  }, [projectMissions, selectedMissionId])
  // Passos reais da missão dinâmica (a aba Fluxo não usa sequência fixa para ela).
  const plan = usePlan(send, subscribe, online, selectedProjectId, currentMission?.mode === 'dynamic' ? currentMission.id : null)

  // Lista de Agentes participantes da missão atual
  const participatingAgentIds = useMemo(() => {
    if (!currentMission) return []
    const ids = new Set<string>()
    if (currentMission.plannerId) ids.add(currentMission.plannerId)
    if (currentMission.devId) ids.add(currentMission.devId)
    if (currentMission.qaId) ids.add(currentMission.qaId)
    if (currentMission.specialists) {
      for (const s of currentMission.specialists) ids.add(s.agentId)
    }
    // Inclui quem entrou durante uma missão dinâmica.
    for (const id of Object.keys(currentMission.teamSnapshot ?? {})) ids.add(id)
    // Eventos podem ter agentes que participaram
    for (const e of events) {
      if (e.agentId) ids.add(e.agentId)
    }
    return Array.from(ids)
  }, [currentMission, events])

  // Alternar expansão de detalhes de evento
  const toggleExpandEvent = (id: number) => {
    setExpandedEventIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  // Filtragem da Timeline
  const filteredEvents = useMemo(() => {
    const list = !selectedProjectId ? [] : events
    return list.filter((ev) => {
      if (selectedAgentId && ev.agentId !== selectedAgentId) return false
      if (selectedEvidenceFilter !== 'all' && ev.evidence !== selectedEvidenceFilter) return false
      if (selectedTypeFilter === COORDINATION_FILTER) {
        if (!COORDINATION_EVENTS.has(ev.type)) return false
      } else if (selectedTypeFilter !== 'all' && ev.type !== selectedTypeFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchSummary = ev.summary.toLowerCase().includes(q)
        const matchAgent = ev.agentId?.toLowerCase().includes(q) ?? false
        const matchType = ev.type.toLowerCase().includes(q)
        if (!matchSummary && !matchAgent && !matchType) return false
      }
      return true
    })
  }, [events, selectedProjectId, selectedAgentId, selectedEvidenceFilter, selectedTypeFilter, searchQuery])

  // Tipos únicos de eventos disponíveis na trilha
  const availableEventTypes = useMemo(() => {
    return Array.from(new Set(events.map((e) => e.type))).sort()
  }, [events])

  return (
    <section className="obs-center-view" aria-label="Central de Observabilidade">
      {/* 1. Barra de Cabeçalho e Seleção */}
      <header className="obs-header">
        <div className="obs-header-left">
          <div className="obs-title-group">
            <h2 className="obs-heading">Central de Observabilidade</h2>
            <span className="obs-badge-tag">Auditoria & Rastreabilidade Real</span>
          </div>

          <div className="obs-selectors">
            {/* Seletor de Projeto */}
            <div className="obs-select-wrapper">
              <label htmlFor="obs-proj-select">Projeto:</label>
              <select
                id="obs-proj-select"
                value={selectedProjectId ?? ''}
                onChange={(e) => {
                  const pId = Number(e.target.value) || null
                  setUserProjectId(pId)
                  setUserMissionId(null)
                  if (pId && pId !== workspace.activeProjectId) {
                    send({ type: 'project-select', projectId: pId })
                  }
                }}
              >
                {workspace.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Seletor de Missão */}
            <div className="obs-select-wrapper">
              <label htmlFor="obs-mission-select">Missão:</label>
              <select
                id="obs-mission-select"
                value={selectedMissionId ?? ''}
                disabled={projectMissions.length === 0}
                onChange={(e) => setUserMissionId(Number(e.target.value) || null)}
              >
                {projectMissions.length === 0 && <option value="">Nenhuma missão registrada</option>}
                {projectMissions.map((m) => (
                  <option key={m.id} value={m.id}>
                    #{m.id} · {m.phase} ({new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="obs-header-right">
          <nav className="obs-tabs" aria-label="Visualizações de Observabilidade">
            <button
              type="button"
              className={`obs-tab-btn ${activeTab === 'timeline' ? 'obs-tab-active' : ''}`}
              onClick={() => setActiveTab('timeline')}
            >
              Linha do Tempo
            </button>
            <button
              type="button"
              className={`obs-tab-btn ${activeTab === 'agents' ? 'obs-tab-active' : ''}`}
              onClick={() => setActiveTab('agents')}
            >
              Participantes ({participatingAgentIds.length})
            </button>
            <button
              type="button"
              className={`obs-tab-btn ${activeTab === 'flow' ? 'obs-tab-active' : ''}`}
              onClick={() => setActiveTab('flow')}
            >
              Fluxo Delegado
            </button>
            <button
              type="button"
              className={`obs-tab-btn ${activeTab === 'skills' ? 'obs-tab-active' : ''}`}
              onClick={() => setActiveTab('skills')}
            >
              Skills & Prompt
            </button>
          </nav>

          {onClose && (
            <button type="button" className="btn-quiet obs-close-btn" onClick={onClose} title="Fechar Observabilidade">
              ✕
            </button>
          )}
        </div>
      </header>

      {/* 2. Resumo da Missão Selecionada */}
      {currentMission ? (
        <section className="obs-summary-card">
          <div className="obs-summary-grid">
            <div className="obs-sum-item">
              <span className="obs-sum-label">Missão & Fase</span>
              <span className="obs-sum-val">
                <strong>#{currentMission.id}</strong> · <span className="tag">{currentMission.phase}</span>
              </span>
            </div>
            <div className="obs-sum-item">
              <span className="obs-sum-label">Início / Término</span>
              <span className="obs-sum-val">
                {new Date(currentMission.createdAt).toLocaleTimeString()}
                {currentMission.updatedAt ? ` → ${new Date(currentMission.updatedAt).toLocaleTimeString()}` : ''}
              </span>
            </div>
            <div className="obs-sum-item">
              <span className="obs-sum-label">Equipe ({participatingAgentIds.length})</span>
              <div className="obs-team-chips">
                {participatingAgentIds.map((aId) => {
                  const cfg = configs.find((c) => c.agentId === aId)
                  return (
                    <span
                      key={aId}
                      className={`obs-agent-chip ${selectedAgentId === aId ? 'obs-chip-active' : ''}`}
                      onClick={() => setSelectedAgentId(selectedAgentId === aId ? null : aId)}
                      title="Filtrar por este agente"
                    >
                      {cfg?.name || aId}
                    </span>
                  )
                })}
              </div>
            </div>
            <div className="obs-sum-item">
              <span className="obs-sum-label">Veredito / Resultado</span>
              <span className="obs-sum-val">
                {currentMission.verdict ? (
                  <span className={`tag ${currentMission.verdict === 'approved' ? 'tag-green' : 'tag-amber'}`}>
                    {currentMission.verdictDetail || currentMission.verdict}
                  </span>
                ) : (
                  <span className="obs-dim">Em andamento / Sem veredito</span>
                )}
              </span>
            </div>
            <div className="obs-sum-item">
              <span className="obs-sum-label">Arquivos Modificados</span>
              <span className="obs-sum-val">
                {currentMission.files && currentMission.files.length > 0 ? (
                  <span className="obs-files-list">{currentMission.files.join(', ')}</span>
                ) : (
                  <span className="obs-dim">Nenhum arquivo modificado</span>
                )}
              </span>
            </div>
          </div>
        </section>
      ) : (
        <div className="obs-empty-banner">
          Nenhuma missão selecionada. Escolha um projeto com histórico de missões para inspecionar.
        </div>
      )}

      {/* 3. CONTEÚDO PRINCIPAL (TABS) */}

      {/* TAB 1: LINHA DO TEMPO VERTICAL */}
      {activeTab === 'timeline' && (
        <div className="obs-timeline-view">
          {/* Barra de Filtros da Timeline */}
          <div className="obs-filter-toolbar">
            <div className="obs-filter-group">
              <label>Agente:</label>
              <select
                value={selectedAgentId ?? ''}
                onChange={(e) => setSelectedAgentId(e.target.value || null)}
              >
                <option value="">Todos os agentes</option>
                {participatingAgentIds.map((aId) => {
                  const cfg = configs.find((c) => c.agentId === aId)
                  return (
                    <option key={aId} value={aId}>
                      {cfg?.name || aId}
                    </option>
                  )
                })}
              </select>
            </div>

            <div className="obs-filter-group">
              <label>Evidência:</label>
              <select
                value={selectedEvidenceFilter}
                onChange={(e) => setSelectedEvidenceFilter(e.target.value as EvidenceKind | 'all')}
              >
                <option value="all">Todas as evidências</option>
                <option value="observed">● Observado pelo sistema</option>
                <option value="declared">◆ Declarado pelo agente</option>
                <option value="context">▲ Incluído no contexto</option>
                <option value="unavailable">○ Não disponível</option>
              </select>
            </div>

            <div className="obs-filter-group">
              <label>Tipo de Evento:</label>
              <select
                value={selectedTypeFilter}
                onChange={(e) => setSelectedTypeFilter(e.target.value)}
              >
                <option value="all">Todos os tipos ({availableEventTypes.length})</option>
                <option value={COORDINATION_FILTER}>Coordenação dinâmica (propostas, decisões, equipe, passos)</option>
                {availableEventTypes.map((t) => (
                  <option key={t} value={t}>
                    {EVENT_LABEL[t] ? `${EVENT_LABEL[t]} · ${t}` : t}
                  </option>
                ))}
              </select>
            </div>

            <div className="obs-search-group">
              <input
                type="text"
                placeholder="Buscar eventos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button type="button" className="btn-quiet" onClick={() => setSearchQuery('')}>
                  ✕
                </button>
              )}
            </div>

            {(selectedAgentId || selectedEvidenceFilter !== 'all' || selectedTypeFilter !== 'all' || searchQuery) && (
              <button
                type="button"
                className="obs-clear-filters-btn"
                onClick={() => {
                  setSelectedAgentId(null)
                  setSelectedEvidenceFilter('all')
                  setSelectedTypeFilter('all')
                  setSearchQuery('')
                }}
              >
                Limpar Filtros
              </button>
            )}
          </div>

          {/* Timeline Vertical */}
          <div className="obs-timeline-container">
            {filteredEvents.length === 0 ? (
              <div className="obs-timeline-empty">
                {events.length === 0
                  ? 'Nenhum evento registrado nesta missão.'
                  : 'Nenhum evento corresponde aos filtros aplicados.'}
              </div>
            ) : (
              <ol className="obs-timeline-list">
                {filteredEvents.map((ev, index) => {
                  const evMeta = EVIDENCE_META[ev.evidence] || EVIDENCE_META.unavailable
                  const stLabel = STATE_LABELS[ev.state] || { label: ev.state, tone: 'stone' }
                  const isExpanded = !!expandedEventIds[ev.id]
                  const agentCfg = configs.find((c) => c.agentId === ev.agentId)
                  const timeStr = new Date(ev.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

                  return (
                    <li key={ev.id} className={`obs-event-row obs-ev-${ev.evidence}`}>
                      {/* Coluna da Esquerda: Horário e Linha */}
                      <div className="obs-event-time-col">
                        <time className="obs-event-time">{timeStr}</time>
                        <span className="obs-event-node" title={evMeta.label}>
                          {evMeta.icon}
                        </span>
                        {index < filteredEvents.length - 1 && <span className="obs-event-connector" />}
                      </div>

                      {/* Coluna Principal: Conteúdo do Evento */}
                      <div className="obs-event-content-box">
                        <div className="obs-event-header" onClick={() => toggleExpandEvent(ev.id)}>
                          <div className="obs-event-meta-line">
                            {ev.agentId && (
                              <span className="obs-agent-badge" title={`Agente: ${ev.agentId}`}>
                                {agentCfg?.name || ev.agentId}
                              </span>
                            )}
                            <span className="obs-type-tag" title={ev.type}>
                              {EVENT_LABEL[ev.type] ?? ev.type}
                            </span>
                            <span className={`tag tag-${stLabel.tone}`}>{stLabel.label}</span>
                            <span
                              className={`obs-evidence-badge ${evMeta.badgeClass}`}
                              title={evMeta.tooltip}
                            >
                              {evMeta.label}
                            </span>
                          </div>

                          <div className="obs-event-summary">
                            <span>{ev.summary}</span>
                            <button
                              type="button"
                              className="obs-expand-toggle-btn"
                              aria-expanded={isExpanded}
                              title={isExpanded ? 'Ocultar detalhes' : 'Expandir detalhes'}
                            >
                              {isExpanded ? '▲' : '▼'}
                            </button>
                          </div>
                        </div>

                        {/* Detalhes Expansíveis sem Poluição */}
                        {isExpanded && (
                          <div className="obs-event-expanded-details">
                            <div className="obs-details-meta">
                              <div>
                                <strong>ID do Evento:</strong> #{ev.id}
                              </div>
                              {ev.correlationId && (
                                <div>
                                  <strong>Correlation ID:</strong> <code>{ev.correlationId}</code>
                                </div>
                              )}
                              <div>
                                <strong>Horário ISO:</strong> {ev.at}
                              </div>
                            </div>

                            {ev.data && Object.keys(ev.data).length > 0 && (
                              <div className="obs-details-data">
                                <strong>Metadados & Evidências:</strong>
                                <pre className="obs-code-block">{JSON.stringify(ev.data, null, 2)}</pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: DETALHES POR AGENTE PARTICIPANTE */}
      {activeTab === 'agents' && (
        <div className="obs-agents-view">
          <div className="obs-agents-list-col">
            <h3>Participantes da Missão</h3>
            <div className="obs-agents-menu">
              {participatingAgentIds.map((aId) => {
                const cfg = configs.find((c) => c.agentId === aId)
                const isSelected = selectedAgentId === aId
                return (
                  <button
                    key={aId}
                    type="button"
                    className={`obs-agent-nav-item ${isSelected ? 'obs-agent-nav-active' : ''}`}
                    onClick={() => setSelectedAgentId(aId)}
                  >
                    <strong>{cfg?.name || aId}</strong>
                    <small>{cfg?.role || 'Agente'}</small>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="obs-agent-details-col">
            {selectedAgentId ? (
              (() => {
                const cfg = configs.find((c) => c.agentId === selectedAgentId)
                const liveAgent = agents.find((a) => a.id === selectedAgentId)
                const agentEvents = events.filter((e) => e.agentId === selectedAgentId)
                const testsExecutedObserved = agentEvents.find((e) => e.type === 'tests.executed' && e.evidence === 'observed')
                const testsExecutedUnavailable = agentEvents.find((e) => e.type === 'tests.executed' && e.evidence === 'unavailable')
                const testsDeclared = agentEvents.find((e) => e.type === 'tests.declared')
                const cliFinished = agentEvents.find((e) => e.type === 'cli.finished')

                // Skills efetivas aplicadas ao agente na missão (do snapshot da equipe)
                const missionSkills = currentMission?.teamSnapshot?.[selectedAgentId]?.skills ?? []

                return (
                  <div className="obs-agent-detail-card">
                    <header className="obs-card-head">
                      <div>
                        <h4>{cfg?.name || selectedAgentId}</h4>
                        <p className="obs-dim">{cfg?.description || cfg?.role}</p>
                      </div>
                      {onSelectAgentInOffice && (
                        <button
                          type="button"
                          className="btn-quiet"
                          onClick={() => onSelectAgentInOffice(selectedAgentId)}
                          title="Abrir no Escritório 2D"
                        >
                          Ver no Escritório 2D
                        </button>
                      )}
                    </header>

                    <div className="obs-sections-grid">
                      {/* Identidade & Configuração */}
                      <section className="obs-section-box">
                        <h5>Identidade & Execução</h5>
                        <ul>
                          <li>
                            <strong>Papel:</strong> {cfg?.role || 'Não disponível'}
                          </li>
                          <li>
                            <strong>Especialização:</strong> {cfg?.specializationId || 'Nenhuma'}
                          </li>
                          <li>
                            <strong>Provedor / Modelo:</strong> {cfg?.provider} · {cfg?.model} ({cfg?.reasoningEffort})
                          </li>
                          <li>
                            <strong>CLI Utilizado:</strong> {liveAgent?.cli || cfg?.provider || 'Não disponível'}
                          </li>
                          <li>
                            <strong>Código de Saída:</strong>{' '}
                            {cliFinished?.data?.exitCode !== undefined ? (
                              <code>{String(cliFinished.data.exitCode)}</code>
                            ) : (
                              'Não disponível'
                            )}
                          </li>
                        </ul>
                      </section>

                      {/* Evidências de Testes */}
                      <section className="obs-section-box">
                        <h5>Evidência de Testes</h5>
                        {testsExecutedObserved ? (
                          <div className="obs-ev-box ev-box-observed">
                            <span className="obs-badge-icon">●</span>
                            <div>
                              <strong>Testes observados pelo sistema</strong>
                              <p>{testsExecutedObserved.summary}</p>
                              {Boolean(testsExecutedObserved.data?.command) && (
                                <small>Comando: <code>{String(testsExecutedObserved.data?.command)}</code></small>
                              )}
                            </div>
                          </div>
                        ) : testsDeclared ? (
                          <div className="obs-ev-box ev-box-declared">
                            <span className="obs-badge-icon">◆</span>
                            <div>
                              <strong>Testes declarados pelo agente — execução não verificada</strong>
                              <p>{testsDeclared.summary}</p>
                            </div>
                          </div>
                        ) : testsExecutedUnavailable ? (
                          <div className="obs-ev-box ev-box-unavailable">
                            <span className="obs-badge-icon">○</span>
                            <div>
                              <strong>Inspeção estática — testes não executados pelo sistema</strong>
                              <p>{testsExecutedUnavailable.summary}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="obs-ev-box ev-box-unavailable">
                            <span className="obs-badge-icon">○</span>
                            <div>
                              <strong>Nenhum teste verificado</strong>
                              <p>Não há evidência observada de execução de testes por este participante.</p>
                            </div>
                          </div>
                        )}
                      </section>

                      {/* Skills no Prompt */}
                      <section className="obs-section-box">
                        <h5>Skills Incluídas no Prompt</h5>
                        {missionSkills.length > 0 ? (
                          <ul className="obs-skills-list">
                            {missionSkills.map((sk) => (
                              <li key={sk.id}>
                                <strong>{sk.name}</strong> (v{sk.version}) —{' '}
                                <span className="tag">{sk.state}</span>
                                {sk.individual && <small> (ajuste individual)</small>}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="obs-dim">Nenhuma skill injetada para este agente.</p>
                        )}
                      </section>

                      {/* Memórias no Contexto */}
                      <section className="obs-section-box">
                        <h5>Memórias no Contexto</h5>
                        {currentMission?.memoryContext ? (
                          <p className="obs-dim">
                            Memórias entregues na etapa correspondente (isoladas por projeto).
                          </p>
                        ) : (
                          <p className="obs-dim">Não disponível</p>
                        )}
                      </section>
                    </div>
                  </div>
                )
              })()
            ) : (
              <div className="obs-empty-banner">Selecione um agente ao lado para inspecionar os detalhes.</div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: FLUXO DELEGADO ENTRE AGENTES */}
      {activeTab === 'flow' && (
        <div className="obs-flow-view">
          <h3>Fluxo de Coordenação & Delegações Reais</h3>
          <p className="obs-dim">
            Sequência verificada de participantes, correlação de tarefas e encaminhamento de contexto.
          </p>

          {currentMission?.mode === 'dynamic' ? (
            <div className="obs-flow-track">
              {currentPlanSteps(plan.steps).map((st, i) => (
                <Fragment key={st.id}>
                  {i > 0 && <div className="obs-flow-arrow">→</div>}
                  <div className="obs-flow-node">
                    <div className="obs-node-badge">
                      r{st.revision}/{st.key} · {MODE_LABEL[st.mode].label}
                    </div>
                    <h4>{currentMission.teamSnapshot?.[st.agentId]?.name ?? st.agentId}</h4>
                    <p>{st.objective}</p>
                    <span className="tag">{STEP_STATUS_LABEL[st.status]}</span>
                  </div>
                </Fragment>
              ))}
              {plan.steps.length === 0 && <p className="obs-dim">Nenhum passo aprovado nesta missão.</p>}
            </div>
          ) : (
            <div className="obs-flow-track">
              {/* Arquiteto */}
              <div className="obs-flow-node">
                <div className="obs-node-badge">1. Planejamento</div>
                <h4>{currentMission?.plannerId || 'Arquiteto'}</h4>
                <p>Elaboração do plano & critérios</p>
                <span className="tag">
                  {currentMission?.plan ? 'Plano Produzido' : 'Pendente'}
                </span>
              </div>

              <div className="obs-flow-arrow" title="Encaminhado após aprovação">→</div>

              {/* Especialistas Pré-Dev */}
              {currentMission?.specialists?.filter((s) => s.timing === 'pre-dev').map((s) => (
                <div key={s.agentId} className="obs-flow-node obs-node-specialist">
                  <div className="obs-node-badge">Pré-Dev Especialista</div>
                  <h4>{s.agentId}</h4>
                  <p>{s.expectedContribution || s.role}</p>
                  <span className="tag tag-sky">Análise Injetada no Dev</span>
                </div>
              ))}

              {currentMission?.specialists?.some((s) => s.timing === 'pre-dev') && (
                <div className="obs-flow-arrow">→</div>
              )}

              {/* Dev */}
              <div className="obs-flow-node">
                <div className="obs-node-badge">2. Implementação</div>
                <h4>{currentMission?.devId || 'Dev'}</h4>
                <p>Código & Testes automatizados</p>
                <span className="tag">
                  {currentMission?.devReport ? 'Implementado' : 'Pendente'}
                </span>
              </div>

              <div className="obs-flow-arrow">→</div>

              {/* Especialistas Pós-Dev */}
              {currentMission?.specialists?.filter((s) => s.timing === 'post-dev').map((s) => (
                <div key={s.agentId} className="obs-flow-node obs-node-specialist">
                  <div className="obs-node-badge">Pós-Dev Auditoria</div>
                  <h4>{s.agentId}</h4>
                  <p>{s.expectedContribution || s.role}</p>
                  <span className="tag tag-purple">Revisão Injetada no QA</span>
                </div>
              ))}

              {currentMission?.specialists?.some((s) => s.timing === 'post-dev') && (
                <div className="obs-flow-arrow">→</div>
              )}

              {/* QA */}
              <div className="obs-flow-node">
                <div className="obs-node-badge">3. Revisão QA</div>
                <h4>{currentMission?.qaId || 'QA'}</h4>
                <p>Inspeção independente & Veredito</p>
                <span className="tag">
                  {currentMission?.verdict || 'Aguardando'}
                </span>
              </div>
            </div>
          )}

          <div className="obs-delegation-evidence-box">
            <h4>Evidências de Encaminhamento de Contexto</h4>
            <ul>
              {events
                .filter((e) => FLOW_EVENTS.has(e.type))
                .map((e) => (
                  <li key={e.id}>
                    <span className="obs-dim">[{new Date(e.at).toLocaleTimeString()}]</span>{' '}
                    <strong>{e.type}:</strong> {e.summary}{' '}
                    <span className={`obs-evidence-badge ev-badge-${e.evidence}`}>
                      {EVIDENCE_META[e.evidence]?.label || e.evidence}
                    </span>
                  </li>
                ))}
              {events.filter((e) => FLOW_EVENTS.has(e.type)).length === 0 && (
                <li className="obs-dim">Sem registros específicos de delegação nesta missão.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* TAB 4: CENTRAL DE SKILLS & PROMPT (INTEGRAÇÃO 8.1) */}
      {activeTab === 'skills' && (
        <div className="obs-skills-view">
          <h3>Skills Globais & Atribuição</h3>
          <p className="obs-dim">
            Ponytail e Caveman Lite com rastreamento de integridade e método de aplicação (contexto no prompt).
          </p>

          <div className="obs-skills-cards-grid">
            {skills.map((skill) => (
              <div key={skill.id} className="obs-skill-card">
                <header className="obs-skill-card-head">
                  <div>
                    <h4>{skill.name}</h4>
                    <span className="tag">{skill.mode === 'context' ? 'Injeção de Contexto' : 'Nativo'}</span>
                  </div>
                  <span className={`tag ${skill.enabled ? 'tag-green' : 'tag-amber'}`}>
                    {skill.enabled ? 'Ativa Globalmente' : 'Desativada'}
                  </span>
                </header>

                <p className="obs-skill-desc">{skill.description}</p>

                <div className="obs-skill-meta-table">
                  <div>
                    <strong>Versão:</strong> {skill.version}
                  </div>
                  <div>
                    <strong>Origem:</strong> {skill.origin}
                  </div>
                  <div>
                    <strong>SHA-256:</strong> <code>{skill.hash.slice(0, 16)}...</code>
                  </div>
                </div>

                <div className="obs-skill-overrides-section">
                  <strong>Ajustes Individuais por Agente:</strong>
                  <ul>
                    {configs.map((ag) => {
                      const override = skillOverrides.find((o) => o.agentId === ag.agentId && o.skillId === skill.id)
                      const isInherited = !override
                      const isEffective = isInherited ? skill.enabled : override.state === 'on'

                      return (
                        <li key={ag.agentId}>
                          <span>{ag.name || ag.agentId}:</span>
                          <span className={`obs-override-tag ${isEffective ? 'ov-on' : 'ov-off'}`}>
                            {isEffective ? 'Ativa' : 'Inativa'} {isInherited ? '(herda global)' : '(ajuste próprio)'}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
