import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { isOpenMission } from '../../../../shared/missionPhases.ts'
import { CHAT_LIMITS, type AgentConfig, type AgentInfo, type ChatConversation, type ChatMessage, type ChatMissionLink, type MissionInfo, type TaskInfo } from '../../../../shared/protocol.ts'
import { useChat } from '../../net/useChat.ts'
import { useMissionEvents, usePlan } from '../../net/useMission.ts'
import type { Send, Subscribe } from '../../net/useServer.ts'
import { DynamicMissionMonitor } from '../DynamicMissionMonitor.tsx'
import { chatMissionMilestones, chatMissionState, chatReplanBlocker, currentObjective, pendingProposal, prepareBlocker, STEP_STATUS_LABEL, teamView } from '../dynamicView.ts'
import { Markdown } from './markdown.tsx'
import './chat.css'

interface Props {
  projectId: number | null
  projectName?: string
  agents: AgentInfo[]
  configs: AgentConfig[]
  online: boolean
  send: Send
  subscribe: Subscribe
  onOpenTasks: () => void
  /** Etapa 12.2: missões nascidas das conversas deste projeto. */
  links?: ChatMissionLink[]
  missions?: MissionInfo[]
  tasks?: TaskInfo[]
  /** Conversa a abrir ao montar (vindo de "Voltar ao chat"). */
  initialConversationId?: number | null
  onOpenObservability?: (missionId: number) => void
  onOpenOffice?: () => void
}

const AVAILABILITY: Record<string, { label: string; tone: 'ok' | 'warn' | 'off' }> = {
  offline: { label: 'CLI indisponível', tone: 'off' },
  error: { label: 'CLI sem login', tone: 'off' },
}
function availability(agent: AgentInfo | undefined) {
  if (!agent) return { label: 'Agente não encontrado', tone: 'off' as const }
  if (agent.checking) return { label: 'Verificando CLI…', tone: 'warn' as const }
  return AVAILABILITY[agent.state] ?? { label: `Disponível · ${agent.cli}`, tone: 'ok' as const }
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Uma mensagem do histórico. Memorizada: lotes de streaming não re-renderizam as anteriores. */
const MessageItem = memo(function MessageItem({ message, name, live }: { message: ChatMessage; name: string; live?: string }) {
  const mine = message.role === 'user'
  const text = live ?? message.content
  return (
    <article className={`chat-msg ${mine ? 'chat-msg-user' : 'chat-msg-agent'} chat-msg-${message.status}`} aria-label={mine ? 'Sua mensagem' : `Resposta de ${name}`}>
      <header className="chat-msg-head">
        <span className="chat-msg-author">{mine ? 'Você' : name}</span>
        <time dateTime={message.createdAt}>{timeOf(message.createdAt)}</time>
        {message.status === 'interrupted' && <span className="chat-chip chat-chip-warn">interrompida</span>}
        {message.status === 'error' && <span className="chat-chip chat-chip-error">erro</span>}
      </header>
      {mine ? <p className="chat-msg-plain">{text}</p> : text ? <Markdown text={text} /> : null}
      {message.status === 'streaming' && (
        <p className="chat-typing" role="status">
          <span className="chat-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {text ? 'escrevendo…' : `${name} está pensando…`}
        </p>
      )}
      {message.error && (
        <p className="chat-msg-error" role="alert">
          {message.error}
        </p>
      )}
      {!mine && message.context && message.context.omittedMessages > 0 && (
        <p className="chat-context-note">
          {message.context.omittedMessages} mensagem(ns) mais antiga(s) desta conversa não foram enviadas ao agente nesta resposta (limite de contexto).
        </p>
      )}
    </article>
  )
})

export function ChatView({ projectId, projectName, agents, configs, online, send, subscribe, onOpenTasks, links = [], missions = [], tasks = [], initialConversationId, onOpenObservability, onOpenOffice }: Props) {
  const chat = useChat(send, subscribe, online, projectId)
  const { state } = chat
  const planners = agents.filter((a) => {
    const cfg = configs.find((c) => c.agentId === a.id)
    return (cfg?.roleCategory ?? a.roleCategory) === 'planning' && cfg?.active !== false
  })
  const [newAgentId, setNewAgentId] = useState('architect')
  const conversation = state.conversations.find((c) => c.id === state.selectedId) ?? null
  const agentId = conversation?.agentId ?? (planners.some((p) => p.id === newAgentId) ? newAgentId : planners[0]?.id ?? 'architect')
  const agent = agents.find((a) => a.id === agentId)
  const avail = availability(agent)
  const agentName = conversation ? (configs.find((c) => c.agentId === conversation.agentId)?.name ?? agent?.name ?? conversation.agentId) : (agent?.name ?? 'Tech Lead')
  const streaming = state.streaming
  const responding = state.messages.some((m) => m.status === 'streaming')

  // ---------- missões nascidas desta conversa (mais recente primeiro) ----------
  const convLinks = conversation ? links.filter((l) => l.conversationId === conversation.id).sort((a, b) => b.missionId - a.missionId) : []
  const missionOf = (id: number) => missions.find((m) => m.id === id)
  const openLink = convLinks.find((l) => {
    const m = missionOf(l.missionId)
    return m && isOpenMission(m)
  })
  const [confirmPrepare, setConfirmPrepare] = useState(false)

  // "Voltar ao chat": abre a conversa de origem da missão.
  useEffect(() => {
    if (initialConversationId && projectId) chat.select(initialConversationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId, projectId])
  useEffect(() => setConfirmPrepare(false), [state.selectedId])

  // ---------- altura: o chat ocupa o resto da janela (composer sempre visível) ----------
  const shell = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const fit = () => {
      const el = shell.current
      if (el) setHeight(Math.max(360, Math.floor(window.innerHeight - el.getBoundingClientRect().top)))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [online, projectId])

  // ---------- rolagem: acompanha o fim só se o usuário já estava no fim ----------
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atBottom.current) setShowJump(false)
  }
  const toBottom = () => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
    atBottom.current = true
    setShowJump(false)
  }
  useLayoutEffect(() => {
    if (atBottom.current) toBottom()
    else setShowJump(true)
  }, [state.messages.length, streaming?.text.length])
  useEffect(() => {
    atBottom.current = true
  }, [state.selectedId])

  // ---------- composer ----------
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draftKey = String(state.selectedId ?? 'new')
  const draft = drafts[draftKey] ?? ''
  const setDraft = (text: string) => setDrafts((d) => ({ ...d, [draftKey]: text }))
  const input = useRef<HTMLTextAreaElement>(null)
  const lastSent = useRef<{ key: string; text: string } | null>(null)
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [draft])
  // Envio confirmado: limpa o rascunho; erro: o texto fica para corrigir e reenviar.
  useEffect(() => {
    if (!state.sending && lastSent.current && !state.error) {
      const { key, text } = lastSent.current
      setDrafts((d) => (d[key] === text ? { ...d, [key]: '' } : d))
      lastSent.current = null
    }
    if (state.error) lastSent.current = null
  }, [state.sending, state.error])

  const canWrite = online && !!projectId && avail.tone !== 'off' && !agent?.checking
  const blocker = prepareBlocker({
    online,
    conversationId: conversation?.id ?? null,
    hasUserMessage: state.hasMore || state.messages.some((m) => m.role === 'user'),
    responding,
    preparing: state.preparing,
    agentAvailable: avail.tone !== 'off' && !agent?.checking,
    openMissionId: openLink?.missionId ?? null,
  })
  const tooLong = draft.length > CHAT_LIMITS.maxMessageChars
  const canSend = canWrite && !state.sending && !responding && !!draft.trim() && !tooLong
  const submit = () => {
    if (!canSend) return
    const text = draft.trim()
    lastSent.current = { key: draftKey, text: draft }
    if (state.selectedId) chat.sendText(text)
    else chat.create(agentId, text)
    toBottom()
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  // ---------- título / exclusão ----------
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const saveTitle = () => {
    if (!editing) return
    if (conversation && title.trim() && title.trim() !== conversation.title) chat.rename(conversation.id, title)
    setEditing(false)
  }

  if (!projectId) {
    return (
      <section className="chat-empty-project">
        <h2>Converse com o Tech Lead</h2>
        <p>Escolha ou adicione um projeto na barra superior para começar uma conversa.</p>
      </section>
    )
  }

  return (
    <div className="chat-shell" ref={shell} style={height ? { height } : undefined}>
      <aside className="chat-sidebar" aria-label="Conversas">
        <div className="chat-sidebar-head">
          <button
            type="button"
            className="chat-new"
            onClick={() => {
              chat.startNew()
              setConfirmDelete(null)
            }}
            disabled={!state.selectedId}
            title="Começar uma conversa nova (ela é criada ao enviar a primeira mensagem)"
          >
            + Nova conversa
          </button>
        </div>
        <p className="chat-sidebar-project" title={projectName}>
          {projectName}
        </p>
        {!state.listed ? (
          <p className="chat-sidebar-note">{online ? 'Carregando conversas…' : 'Sem conexão com o backend.'}</p>
        ) : state.conversations.length === 0 ? (
          <p className="chat-sidebar-note">Nenhuma conversa neste projeto ainda.</p>
        ) : (
          <ul className="chat-list">
            {state.conversations.map((c: ChatConversation) => (
              <li key={c.id} className={c.id === state.selectedId ? 'is-active' : ''}>
                {confirmDelete === c.id ? (
                  <div className="chat-confirm" role="alertdialog" aria-label={`Excluir ${c.title}`}>
                    <span>Excluir definitivamente "{c.title}"?</span>
                    <div>
                      <button
                        type="button"
                        className="chat-danger"
                        onClick={() => {
                          chat.remove(c.id)
                          setConfirmDelete(null)
                        }}
                      >
                        Excluir
                      </button>
                      <button type="button" className="btn-quiet" onClick={() => setConfirmDelete(null)}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button type="button" className="chat-list-item" onClick={() => chat.select(c.id)} title={c.title}>
                      <span className="chat-list-title">{c.title}</span>
                      <span className="chat-list-meta">
                        {c.messageCount} msg · {new Date(c.updatedAt).toLocaleDateString()}
                      </span>
                    </button>
                    <button type="button" className="chat-list-del" aria-label={`Excluir conversa ${c.title}`} title="Excluir…" onClick={() => setConfirmDelete(c.id)}>
                      ×
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="chat-main" aria-label="Conversa">
        <header className="chat-header">
          <div className="chat-title-area">
            {conversation && editing ? (
              <input
                className="chat-title-input"
                aria-label="Título da conversa"
                value={title}
                maxLength={CHAT_LIMITS.maxTitleChars}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle()
                  if (e.key === 'Escape') setEditing(false)
                }}
              />
            ) : (
              <h2 className="chat-title">
                {conversation?.title ?? 'Nova conversa'}
                {conversation && (
                  <button
                    type="button"
                    className="chat-rename"
                    aria-label="Renomear conversa"
                    title="Renomear"
                    onClick={() => {
                      setTitle(conversation.title)
                      setEditing(true)
                    }}
                  >
                    ✎
                  </button>
                )}
              </h2>
            )}
          </div>
          <div className="chat-agent">
            {!conversation && planners.length > 1 ? (
              <label className="chat-agent-select">
                <span>Conversar com</span>
                <select value={agentId} onChange={(e) => setNewAgentId(e.target.value)}>
                  {planners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {configs.find((c) => c.agentId === p.id)?.name ?? p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="chat-agent-name">{agentName}</span>
            )}
            <span className={`chat-avail chat-avail-${avail.tone}`}>{avail.label}</span>
            {conversation && (
              <button
                type="button"
                className="chat-prepare"
                disabled={!!blocker || confirmPrepare}
                title={blocker ?? 'O Tech Lead lê esta conversa e propõe equipe e passos. Nada é executado sem a sua aprovação.'}
                onClick={() => setConfirmPrepare(true)}
              >
                {state.preparing ? 'Preparando…' : '▶ Preparar missão'}
              </button>
            )}
            {avail.tone === 'off' && agent && (
              <button type="button" className="btn-quiet btn-xs" disabled={!online} onClick={() => send({ type: 'check-cli', agentId: agent.id })}>
                Verificar CLI
              </button>
            )}
          </div>
        </header>

        <div className="chat-thread" ref={scroller} onScroll={onScroll}>
          {state.hasMore && (
            <button type="button" className="chat-older" onClick={chat.loadOlder}>
              Carregar mensagens anteriores
            </button>
          )}
          {state.selectedId && state.loadingMessages && state.messages.length === 0 ? (
            <p className="chat-thread-note">Carregando a conversa…</p>
          ) : state.messages.length === 0 ? (
            <div className="chat-welcome">
              <h3>O que vamos pensar hoje?</h3>
              <p>
                Converse com {agentName} sobre ideias, requisitos, arquitetura e planejamento do projeto <strong>{projectName}</strong>. O agente só lê o
                projeto: <strong>conversar não executa nada</strong>.
              </p>
              <p className="chat-welcome-hint">
                Para implementar, crie uma missão em{' '}
                <button type="button" className="chat-link" onClick={onOpenTasks}>
                  Tarefas
                </button>{' '}
                (modos clássico e dinâmico, com sua aprovação).
              </p>
            </div>
          ) : (
            state.messages.map((m) => <MessageItem key={m.id} message={m} name={agentName} live={streaming?.messageId === m.id ? streaming.text : undefined} />)
          )}
          {convLinks.length > 0 && (
            <section className="chat-missions" aria-label="Missões desta conversa">
              {convLinks.map((l) => {
                const m = missionOf(l.missionId)
                const lastUserMsg = [...state.messages].reverse().find((msg) => msg.role === 'user')?.content ?? ''
                return (
                  <ChatMissionCard
                    key={l.missionId}
                    link={l}
                    mission={m}
                    task={m ? (tasks.find((t) => t.id === m.taskId) ?? null) : null}
                    agents={agents}
                    configs={configs}
                    online={online}
                    send={send}
                    subscribe={subscribe}
                    onOpenTasks={onOpenTasks}
                    onOpenObservability={onOpenObservability}
                    onOpenOffice={onOpenOffice}
                    requestingReplan={state.requestingReplan}
                    onRequestReplan={(missionId, detail) => chat.requestReplan(missionId, detail)}
                    lastUserMessage={lastUserMsg}
                  />
                )
              })}
            </section>
          )}
        </div>
        {showJump && (
          <button type="button" className="chat-jump" onClick={toBottom}>
            ↓ Novas mensagens
          </button>
        )}

        <footer className="chat-composer">
          {state.error && (
            <div className="chat-error" role="alert">
              <span>{state.error}</span>
              <button type="button" className="btn-quiet btn-xs" aria-label="Fechar aviso" onClick={chat.dismissError}>
                ×
              </button>
            </div>
          )}
          {state.notice && (
            <div className="chat-notice" role="status">
              <span>{state.notice}</span>
              <button type="button" className="btn-quiet btn-xs" aria-label="Fechar aviso" onClick={chat.dismissNotice}>
                ×
              </button>
            </div>
          )}
          {confirmPrepare && (
            <div className="chat-prepare-confirm" role="alertdialog" aria-label="Preparar missão">
              <p>
                <strong>Preparar missão a partir desta conversa?</strong> {agentName} lê as últimas mensagens e propõe equipe e passos. A proposta aparece
                aqui para você aprovar, ajustar ou rejeitar: <strong>nada é executado antes disso</strong>.
              </p>
              <div>
                <button
                  type="button"
                  className="chat-send"
                  disabled={!!blocker}
                  onClick={() => {
                    chat.prepareMission()
                    setConfirmPrepare(false)
                  }}
                >
                  Confirmar
                </button>
                <button type="button" className="btn-quiet" onClick={() => setConfirmPrepare(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {!canWrite && (
            <p className="chat-composer-note">
              {!online
                ? 'Sem conexão com o backend: as conversas abertas continuam visíveis.'
                : `${agentName}: ${avail.label.toLowerCase()}. Você pode consultar as conversas; para enviar, o CLI precisa estar disponível.`}
            </p>
          )}
          <div className="chat-input-row">
            <textarea
              ref={input}
              className="chat-input"
              rows={1}
              value={draft}
              placeholder={canWrite ? `Escreva para ${agentName}… (Enter envia, Shift+Enter quebra linha)` : 'Envio indisponível agora'}
              aria-label="Mensagem para o Tech Lead"
              disabled={!canWrite}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
            />
            {responding ? (
              <button type="button" className="chat-stop" onClick={chat.cancel} disabled={!online}>
                ■ Interromper
              </button>
            ) : (
              <button type="button" className="chat-send" onClick={submit} disabled={!canSend}>
                {state.sending ? 'Enviando…' : 'Enviar'}
              </button>
            )}
          </div>
          {draft.length > CHAT_LIMITS.maxMessageChars * 0.8 && (
            <p className={`chat-counter ${tooLong ? 'is-over' : ''}`}>
              {draft.length}/{CHAT_LIMITS.maxMessageChars}
            </p>
          )}
        </footer>
      </section>
    </div>
  )
}

function ChatMissionCard({
  link,
  mission,
  task,
  agents,
  configs,
  online,
  send,
  subscribe,
  onOpenTasks,
  onOpenObservability,
  onOpenOffice,
  requestingReplan,
  onRequestReplan,
  lastUserMessage,
}: {
  link: ChatMissionLink
  mission: MissionInfo | undefined
  task: TaskInfo | null
  agents: AgentInfo[]
  configs: AgentConfig[]
  online: boolean
  send: Send
  subscribe: Subscribe
  onOpenTasks: () => void
  onOpenObservability?: (missionId: number) => void
  onOpenOffice?: () => void
  requestingReplan: boolean
  onRequestReplan: (missionId: number, detail: string) => void
  lastUserMessage: string
}) {
  const st = chatMissionState(mission)
  const open = !!mission && isOpenMission(mission)
  const plan = usePlan(send, subscribe, online, open ? mission.projectId : null, open ? mission.id : null)
  const events = useMissionEvents(send, subscribe, online, open ? mission.projectId : null, open ? mission.id : null)
  const nameOf = (id: string) => mission?.teamSnapshot?.[id]?.name ?? configs.find((c) => c.agentId === id)?.name ?? agents.find((a) => a.id === id)?.name ?? id

  const objective = currentObjective(plan.proposals)
  const pending = pendingProposal(plan.proposals)
  const activeSteps = plan.steps.filter((s) => s.status !== 'superseded')
  const runningStep = activeSteps.find((s) => s.status === 'running')
  const nextStep = activeSteps.find((s) => s.status === 'approved')
  const team = mission ? teamView(mission.plannerId || 'architect', plan.proposals) : { active: [], released: [] }
  const milestones = chatMissionMilestones(events, nameOf)
  const replanBlocker = chatReplanBlocker({
    online,
    mission,
    hasPendingReplan: !!plan.pendingReplan,
    requesting: requestingReplan,
  })

  const [replanOpen, setReplanOpen] = useState(false)
  const [replanText, setReplanText] = useState('')
  const needsHumanAction = !!mission && ['awaiting_approval', 'awaiting_decision', 'awaiting_clarification'].includes(mission.phase)
  const [showDetails, setShowDetails] = useState(false)
  const expanded = needsHumanAction || showDetails

  return (
    <article className={`chat-mission chat-mission-${st.tone}`} aria-label={`Missão #${link.missionId}`}>
      <header className="chat-mission-head">
        <strong>Missão #{link.missionId}</strong>
        <span className={`chat-mission-chip chat-mission-chip-${st.tone}`}>{st.label}</span>
        <span className="chat-mission-meta">
          {link.context.sentMessages} msg da conversa no contexto
          {link.context.omittedMessages > 0 ? ` · ${link.context.omittedMessages} mais antiga(s) de fora` : ''}
        </span>
        <span className="chat-mission-actions">
          {open && mission && (
            <button
              type="button"
              className="chat-replan-btn"
              disabled={!!replanBlocker}
              title={replanBlocker ?? 'Enviar pedido formal de alteração do plano ao Tech Lead'}
              onClick={() => {
                if (!replanText.trim() && lastUserMessage) setReplanText(lastUserMessage.slice(0, 1000))
                setReplanOpen((v) => !v)
              }}
            >
              Solicitar alteração
            </button>
          )}
          {onOpenOffice && (
            <button type="button" className="chat-link" onClick={onOpenOffice}>
              Escritório
            </button>
          )}
          {open && (
            <button type="button" className="chat-link" onClick={onOpenTasks}>
              Abrir em Tarefas
            </button>
          )}
          {onOpenObservability && (
            <button type="button" className="chat-link" onClick={() => onOpenObservability(link.missionId)}>
              Trilha de eventos
            </button>
          )}
        </span>
      </header>

      {mission && (
        <div className="chat-mission-summary">
          {objective && <p className="chat-mission-objective">{objective}</p>}
          <div className="chat-mission-facts">
            {team.active.length > 0 && <span>Equipe: {team.active.map(nameOf).join(', ')}</span>}
            {runningStep && (
              <span>
                Em andamento: <code>r{runningStep.revision}/{runningStep.key}</code> ({nameOf(runningStep.agentId)})
              </span>
            )}
            {!runningStep && nextStep && (
              <span>
                Próximo passo: <code>r{nextStep.revision}/{nextStep.key}</code> ({nameOf(nextStep.agentId)} · {STEP_STATUS_LABEL[nextStep.status]})
              </span>
            )}
            {pending && <span>Proposta pendente: Revisão {pending.revision}</span>}
          </div>
          {plan.pendingReplan && (
            <p className="chat-mission-queued" role="status">
              <strong>Alteração na fila (ponto seguro):</strong> {plan.pendingReplan.detail}
            </p>
          )}
          {mission.error && (
            <p className="chat-mission-blocker" role="alert">
              <strong>Bloqueio:</strong> {mission.error}
            </p>
          )}
          {milestones.length > 0 && (
            <ul className="chat-milestones" aria-label="Atualizações da missão">
              {milestones.map((ev) => (
                <li key={ev.id} className={`chat-milestone chat-milestone-${ev.tone}`}>
                  <time dateTime={ev.at}>{timeOf(ev.at)}</time>
                  <span>{ev.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {replanOpen && mission && open && (
        <div className="chat-replan-box" role="region" aria-label="Solicitar alteração da missão">
          <label className="chat-replan-label" htmlFor={`replan-input-${mission.id}`}>
            Revise o pedido antes de enviar ao replanejamento do Tech Lead (a aprovação final continua separada):
          </label>
          <textarea
            id={`replan-input-${mission.id}`}
            className="chat-replan-input"
            rows={2}
            value={replanText}
            maxLength={2000}
            placeholder="Descreva o que deseja alterar no plano…"
            onChange={(e) => setReplanText(e.target.value)}
          />
          <div className="chat-replan-actions">
            <button
              type="button"
              className="chat-send"
              disabled={!replanText.trim() || requestingReplan || !!replanBlocker}
              onClick={() => {
                onRequestReplan(mission.id, replanText.trim())
                setReplanOpen(false)
                setReplanText('')
              }}
            >
              {requestingReplan ? 'Enviando…' : 'Enviar solicitação'}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setReplanOpen(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {open && mission && !needsHumanAction && (
        <div className="chat-mission-toggle">
          <button type="button" className="chat-link" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? 'Ocultar detalhes do plano' : 'Ver detalhes do plano e revisões'}
          </button>
        </div>
      )}

      {open && mission && expanded && (
        <DynamicMissionMonitor
          mission={mission}
          task={task}
          agents={agents}
          configs={configs}
          online={online}
          send={send}
          subscribe={subscribe}
        />
      )}
    </article>
  )
}
