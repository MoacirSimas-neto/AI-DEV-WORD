import { render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AgentConfig, ChatConversation, ChatMessage, ChatMissionLink, MissionInfo } from '../../../../shared/protocol.ts'
import { useChatLinks } from '../../net/useChatLinks.ts'
import { agent, fakeServer, mission, proposal, task } from '../../test/fakeServer.ts'
import { DynamicMissionMonitor } from '../DynamicMissionMonitor.tsx'
import { chatMissionState, prepareBlocker } from '../dynamicView.ts'
import { ChatView } from './ChatView.tsx'

const NOW = '2026-11-12T12:00:00.000Z'
const CONFIGS: AgentConfig[] = [{ agentId: 'architect', name: 'Ada', roleCategory: 'planning', provider: 'gemini', model: 'default', reasoningEffort: 'default', active: true, updatedAt: NOW }]
const conv = (extra: Partial<ChatConversation> = {}): ChatConversation => ({ id: 5, projectId: 1, title: 'Pagamentos', agentId: 'architect', createdAt: NOW, updatedAt: NOW, messageCount: 2, ...extra })
const msg = (extra: Partial<ChatMessage>): ChatMessage => ({
  id: 1,
  conversationId: 5,
  projectId: 1,
  role: 'user',
  author: 'user',
  agentId: null,
  cli: null,
  content: 'Quero uma API de pagamentos.',
  status: 'complete',
  opId: null,
  replyTo: null,
  error: null,
  context: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
})
const link = (extra: Partial<ChatMissionLink> = {}): ChatMissionLink => ({
  projectId: 1,
  conversationId: 5,
  missionId: 3,
  taskId: 7,
  opId: 'op-1',
  context: { sentMessages: 2, omittedMessages: 0 },
  createdAt: NOW,
  ...extra,
})

function setup(opts: { links?: ChatMissionLink[]; missions?: MissionInfo[]; initialConversationId?: number | null } = {}) {
  const server = fakeServer()
  const user = userEvent.setup()
  const onObs = vi.fn()
  const onTasks = vi.fn()
  const ui = (o: typeof opts) => (
    <ChatView
      projectId={1}
      projectName="loja"
      agents={[agent('architect'), agent('dev')]}
      configs={CONFIGS}
      online
      send={server.send}
      subscribe={server.subscribe}
      onOpenTasks={onTasks}
      links={o.links ?? []}
      missions={o.missions ?? []}
      tasks={[task()]}
      initialConversationId={o.initialConversationId}
      onOpenObservability={onObs}
    />
  )
  const view = render(ui(opts))
  return { server, user, onObs, onTasks, rerender: (o: typeof opts) => view.rerender(ui(o)) }
}

async function open(s: ReturnType<typeof setup>, messages: ChatMessage[] = [msg({})]) {
  s.server.emit({ type: 'chat-conversations', projectId: 1, conversations: [conv()] })
  await s.user.click(screen.getByRole('button', { name: /^Pagamentos/ }))
  s.server.emit({ type: 'chat-messages', projectId: 1, conversationId: 5, messages, hasMore: false, beforeId: null })
}

describe('chatMissionState / prepareBlocker', () => {
  it('cada fase vira um chip legível; aprovação e decisões pedem o usuário', () => {
    expect(chatMissionState(undefined).tone).toBe('off')
    expect(chatMissionState({ phase: 'planning' })).toEqual({ label: 'Tech Lead preparando a proposta', tone: 'wait' })
    expect(chatMissionState({ phase: 'awaiting_approval' }).tone).toBe('decide')
    expect(chatMissionState({ phase: 'awaiting_clarification' }).tone).toBe('decide')
    expect(chatMissionState({ phase: 'awaiting_decision' }).tone).toBe('decide')
    expect(chatMissionState({ phase: 'executing' }).tone).toBe('run')
    expect(chatMissionState({ phase: 'done' }).tone).toBe('done')
    expect(chatMissionState({ phase: 'failed' }).tone).toBe('fail')
    expect(chatMissionState({ phase: 'cancelled' }).label).toBe('Cancelada')
  })

  it('explica por que não dá para preparar, na ordem que importa', () => {
    const ok = { online: true, conversationId: 5, hasUserMessage: true, responding: false, preparing: false, agentAvailable: true, openMissionId: null }
    expect(prepareBlocker(ok)).toBeNull()
    expect(prepareBlocker({ ...ok, online: false })).toMatch(/conexão/)
    expect(prepareBlocker({ ...ok, conversationId: null })).toMatch(/nasce de uma conversa/)
    expect(prepareBlocker({ ...ok, openMissionId: 3 })).toMatch(/#3 em andamento/)
    expect(prepareBlocker({ ...ok, responding: true })).toMatch(/resposta/)
    expect(prepareBlocker({ ...ok, hasUserMessage: false })).toMatch(/o que você quer/)
    expect(prepareBlocker({ ...ok, agentAvailable: false })).toMatch(/indisponível/)
  })
})

describe('ChatView → missão', () => {
  it('conversa sem mensagem do usuário não prepara missão', async () => {
    const s = setup()
    await open(s, [])
    const btn = screen.getByRole('button', { name: /Preparar missão/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.title).toMatch(/o que você quer/)
  })

  it('pede confirmação, envia um único pedido com opId e mostra a resposta do backend', async () => {
    const s = setup()
    await open(s)
    await s.user.click(screen.getByRole('button', { name: /Preparar missão/ }))
    expect(s.server.of('chat-prepare-mission')).toHaveLength(0) // só depois de confirmar
    const dialog = screen.getByRole('alertdialog', { name: 'Preparar missão' })
    expect(dialog.textContent).toMatch(/nada é executado antes disso/)
    await s.user.click(within(dialog).getByRole('button', { name: 'Confirmar' }))
    const sent = s.server.of('chat-prepare-mission')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ projectId: 1, conversationId: 5 })
    expect(sent[0].opId).toBeTruthy()
    // Enquanto o backend não responde, o botão fica preso em "Preparando…".
    const busy = screen.getByRole('button', { name: 'Preparando…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    s.server.emit({ type: 'chat-result', action: 'prepare-mission', opId: sent[0].opId, ok: true, message: 'Missão #3 criada.', conversationId: 5 })
    expect(screen.getByRole('status').textContent).toContain('Missão #3 criada.')
  })

  it('recusa do backend aparece como erro e libera o botão', async () => {
    const s = setup()
    await open(s)
    await s.user.click(screen.getByRole('button', { name: /Preparar missão/ }))
    await s.user.click(screen.getByRole('button', { name: 'Confirmar' }))
    const { opId } = s.server.of('chat-prepare-mission')[0]
    s.server.emit({ type: 'chat-result', action: 'prepare-mission', opId, ok: false, message: 'Há alterações no repositório.', conversationId: 5 })
    expect(screen.getByRole('alert').textContent).toContain('Há alterações no repositório.')
    expect((screen.getByRole('button', { name: /Preparar missão/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('missão aberta: card com chip, monitor com a proposta decidível e botão de preparar bloqueado', async () => {
    const s = setup({ links: [link()], missions: [mission({ phase: 'awaiting_approval' })] })
    await open(s)
    const card = screen.getByRole('article', { name: 'Missão #3' })
    expect(within(card).getByText('Aguardando sua aprovação')).toBeTruthy()
    s.server.emit({ type: 'mission-plan', projectId: 1, missionId: 3, proposals: [proposal()], steps: [] })
    expect(within(card).getByRole('button', { name: 'Aprovar…' })).toBeTruthy()
    const btn = screen.getByRole('button', { name: /Preparar missão/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.title).toMatch(/#3 em andamento/)
    await s.user.click(within(card).getByRole('button', { name: 'Trilha de eventos' }))
    expect(s.onObs).toHaveBeenCalledWith(3)
    await s.user.click(within(card).getByRole('button', { name: 'Abrir em Tarefas' }))
    expect(s.onTasks).toHaveBeenCalled()
  })

  it('missões encerradas ficam como histórico compacto e permitem preparar outra', async () => {
    const s = setup({ links: [link(), link({ missionId: 2, opId: 'op-0' })], missions: [mission({ phase: 'done' }), mission({ id: 2, phase: 'cancelled' })] })
    await open(s)
    const cards = screen.getAllByRole('article', { name: /^Missão #/ })
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Missão #3', 'Missão #2'])
    expect(within(cards[0]).getByText('Concluída')).toBeTruthy()
    expect(within(cards[0]).queryByRole('button', { name: 'Abrir em Tarefas' })).toBeNull()
    expect(s.server.of('plan-list')).toHaveLength(0) // sem monitor para missão fechada
    expect((screen.getByRole('button', { name: /Preparar missão/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('vínculos de outra conversa não aparecem', async () => {
    const s = setup({ links: [link({ conversationId: 99 })], missions: [mission()] })
    await open(s)
    expect(screen.queryByRole('article', { name: 'Missão #3' })).toBeNull()
  })

  it('"Voltar ao chat" abre a conversa de origem', () => {
    const s = setup({ initialConversationId: 5 })
    expect(s.server.of('chat-open')).toEqual([{ type: 'chat-open', projectId: 1, conversationId: 5 }])
  })
})

describe('origem da missão no monitor', () => {
  it('mostra a conversa de origem e volta ao chat', async () => {
    const server = fakeServer()
    const onOpenChat = vi.fn()
    render(<DynamicMissionMonitor mission={mission()} task={task()} agents={[agent('architect')]} configs={[]} online send={server.send} subscribe={server.subscribe} origin={link()} onOpenChat={onOpenChat} />)
    expect(screen.getByText('Origem: conversa #5')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: '← Voltar ao chat' }))
    expect(onOpenChat).toHaveBeenCalledWith(5)
  })
})

describe('useChatLinks', () => {
  it('pede a lista do projeto e ignora a de outro projeto', () => {
    const server = fakeServer()
    const { result, rerender } = renderHook(({ pid }) => useChatLinks(server.send, server.subscribe, true, pid), { initialProps: { pid: 1 as number | null } })
    expect(server.of('chat-links')).toEqual([{ type: 'chat-links', projectId: 1 }])
    server.emit({ type: 'chat-links', projectId: 2, links: [link({ projectId: 2 })] })
    expect(result.current).toEqual([])
    server.emit({ type: 'chat-links', projectId: 1, links: [link()] })
    expect(result.current).toHaveLength(1)
    rerender({ pid: 2 })
    expect(result.current).toEqual([]) // nada do projeto anterior
  })
})
