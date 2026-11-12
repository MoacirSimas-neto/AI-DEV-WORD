import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AgentConfig, ChatConversation, ChatMessage } from '../../../../shared/protocol.ts'
import { agent, fakeServer } from '../../test/fakeServer.ts'
import { ChatView } from './ChatView.tsx'
import { Markdown } from './markdown.tsx'

const NOW = '2026-11-12T12:00:00.000Z'
const cfg = (agentId: string, roleCategory: AgentConfig['roleCategory']): AgentConfig => ({ agentId, name: { architect: 'Ada', dev: 'Dev', qa: 'QA' }[agentId], roleCategory, provider: 'gemini', model: 'default', reasoningEffort: 'default', active: true, updatedAt: NOW })
const CONFIGS = [cfg('architect', 'planning'), cfg('dev', 'developing'), cfg('qa', 'reviewing')]
const conv = (extra: Partial<ChatConversation> = {}): ChatConversation => ({ id: 5, projectId: 1, title: 'Autenticação', agentId: 'architect', createdAt: NOW, updatedAt: NOW, messageCount: 2, ...extra })
const msg = (extra: Partial<ChatMessage>): ChatMessage => ({
  id: 1,
  conversationId: 5,
  projectId: 1,
  role: 'user',
  author: 'user',
  agentId: null,
  cli: null,
  content: '',
  status: 'complete',
  opId: null,
  replyTo: null,
  error: null,
  context: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
})

function setup({ online = true, projectId = 1 as number | null, architect = agent('architect') } = {}) {
  const server = fakeServer()
  const user = userEvent.setup()
  const ui = (on: boolean, pid: number | null) => (
    <ChatView projectId={pid} projectName="loja" agents={[architect, agent('dev'), agent('qa')]} configs={CONFIGS} online={on} send={server.send} subscribe={server.subscribe} onOpenTasks={() => {}} />
  )
  const view = render(ui(online, projectId))
  return { server, user, rerender: (on: boolean, pid: number | null) => view.rerender(ui(on, pid)) }
}

async function openConversation(s: ReturnType<typeof setup>, messages: ChatMessage[] = []) {
  s.server.emit({ type: 'chat-conversations', projectId: 1, conversations: [conv()] })
  await s.user.click(screen.getByRole('button', { name: /^Autenticação/ }))
  s.server.emit({ type: 'chat-messages', projectId: 1, conversationId: 5, messages, hasMore: false, beforeId: null })
}

describe('Markdown seguro', () => {
  it('HTML vira texto; links só http(s) são clicáveis', () => {
    const { container } = render(<Markdown text={'<script>alert(1)</script> **forte** e `código`\n\n[ok](https://exemplo.dev) [mau](javascript:alert(1)) <img src=x onerror=alert(1)>'} />)
    expect(container.querySelector('script, img')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
    expect(container.querySelector('strong')!.textContent).toBe('forte')
    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('https://exemplo.dev')
    expect(links[0].getAttribute('rel')).toContain('noopener')
    expect(container.textContent).toContain('[mau](javascript:alert(1))')
  })

  it('títulos, listas, citação e bloco de código', () => {
    const { container } = render(<Markdown text={'## Plano\n- um\n- dois\n1. a\n2. b\n> nota\n```ts\nconst x = "<b>"\n```'} />)
    expect(container.querySelector('h4')!.textContent).toBe('Plano')
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
    expect(container.querySelectorAll('ol li')).toHaveLength(2)
    expect(container.querySelector('blockquote')!.textContent).toBe('nota')
    expect(container.querySelector('pre code')!.textContent).toBe('const x = "<b>"')
  })
})

describe('ChatView', () => {
  it('sem projeto pede para escolher um', () => {
    setup({ projectId: null })
    expect(screen.getByText(/Escolha ou adicione um projeto/)).toBeTruthy()
  })

  it('lista as conversas do projeto e cria a conversa no primeiro envio (Enter)', async () => {
    const s = setup()
    expect(s.server.of('chat-list')).toEqual([{ type: 'chat-list', projectId: 1 }])
    s.server.emit({ type: 'chat-conversations', projectId: 1, conversations: [] })
    expect(screen.getByText('Nenhuma conversa neste projeto ainda.')).toBeTruthy()
    expect(screen.getByText(/conversar não executa nada/)).toBeTruthy()
    await s.user.type(screen.getByLabelText('Mensagem para o Tech Lead'), 'Vamos planejar o login?{Enter}')
    const [create] = s.server.of('chat-create')
    expect(create).toMatchObject({ projectId: 1, agentId: 'architect' })
    expect(s.server.of('chat-send')).toHaveLength(0)
    s.server.emit({ type: 'chat-result', action: 'create', opId: create.opId, ok: true, message: 'Conversa criada.', conversationId: 9 })
    expect(s.server.of('chat-open').at(-1)).toMatchObject({ conversationId: 9 })
    expect(s.server.of('chat-send')[0]).toMatchObject({ projectId: 1, conversationId: 9, content: 'Vamos planejar o login?' })
  })

  it('Shift+Enter quebra linha; envio pendente não é repetido; confirmação limpa o rascunho', async () => {
    const s = setup()
    await openConversation(s)
    const box = screen.getByLabelText('Mensagem para o Tech Lead') as HTMLTextAreaElement
    await s.user.type(box, 'linha 1{Shift>}{Enter}{/Shift}linha 2')
    expect(box.value).toBe('linha 1\nlinha 2')
    expect(s.server.of('chat-send')).toHaveLength(0)
    await s.user.type(box, '{Enter}')
    await s.user.type(box, '{Enter}')
    expect(s.server.of('chat-send')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Enviando…' })).toHaveProperty('disabled', true)
    s.server.emit({ type: 'chat-result', action: 'send', opId: s.server.of('chat-send')[0].opId, ok: true, message: 'ok', conversationId: 5 })
    expect(box.value).toBe('')
  })

  it('erro no envio aparece e o texto fica para reenviar', async () => {
    const s = setup()
    await openConversation(s)
    const box = screen.getByLabelText('Mensagem para o Tech Lead') as HTMLTextAreaElement
    await s.user.type(box, 'pergunta{Enter}')
    s.server.emit({ type: 'chat-result', action: 'send', opId: s.server.of('chat-send')[0].opId, ok: false, message: 'O Tech Lead está respondendo em outra conversa.', conversationId: 5 })
    expect(screen.getByRole('alert').textContent).toContain('respondendo em outra conversa')
    expect(box.value).toBe('pergunta')
  })

  it('resposta em andamento: texto em lotes, indicador, interrupção e estado final', async () => {
    const s = setup()
    await openConversation(s, [msg({ id: 1, content: 'Oi' })])
    s.server.emit({ type: 'chat-message', message: msg({ id: 2, role: 'assistant', author: 'architect', agentId: 'architect', status: 'streaming' }) })
    expect(screen.getByText('Ada está pensando…')).toBeTruthy()
    s.server.emit({ type: 'chat-delta', projectId: 1, conversationId: 5, messageId: 2, text: 'Olá! ' })
    s.server.emit({ type: 'chat-delta', projectId: 1, conversationId: 5, messageId: 2, text: 'Vamos **planejar**.' })
    const reply = screen.getByLabelText('Resposta de Ada')
    expect(reply.textContent).toContain('Olá! Vamos planejar.')
    expect(within(reply).getByText('planejar').tagName).toBe('STRONG')
    expect(screen.getByLabelText('Mensagem para o Tech Lead')).toHaveProperty('disabled', false)
    await s.user.click(screen.getByRole('button', { name: '■ Interromper' }))
    expect(s.server.of('chat-cancel')[0]).toMatchObject({ projectId: 1, conversationId: 5 })
    s.server.emit({ type: 'chat-message', message: msg({ id: 2, role: 'assistant', author: 'architect', content: 'Olá! Vamos **planejar**.', status: 'interrupted' }) })
    expect(screen.queryByText(/escrevendo…/)).toBeNull()
    expect(screen.getByText('interrompida')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeTruthy()
  })

  it('erro do CLI e janela de contexto aparecem na resposta; conteúdo malicioso é texto', async () => {
    const s = setup()
    await openConversation(s, [
      msg({ id: 1, content: '<img src=x onerror=alert(1)>' }),
      msg({ id: 2, role: 'assistant', author: 'architect', status: 'error', error: 'O gemini atingiu um limite de uso.', context: { sentMessages: 20, omittedMessages: 7 } }),
    ])
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy()
    expect(screen.getByText('O gemini atingiu um limite de uso.')).toBeTruthy()
    expect(screen.getByText(/7 mensagem\(ns\) mais antiga\(s\)/)).toBeTruthy()
  })

  it('CLI indisponível: conversas continuam consultáveis, envio fica bloqueado com explicação', async () => {
    const s = setup({ architect: agent('architect', { state: 'offline' }) })
    await openConversation(s, [msg({ id: 1, content: 'pergunta antiga' })])
    expect(screen.getByText('pergunta antiga')).toBeTruthy()
    expect(screen.getByText('CLI indisponível')).toBeTruthy()
    expect(screen.getByLabelText('Mensagem para o Tech Lead')).toHaveProperty('disabled', true)
    await s.user.click(screen.getByRole('button', { name: 'Verificar CLI' }))
    expect(s.server.of('check-cli')).toEqual([{ type: 'check-cli', agentId: 'architect' }])
  })

  it('reconexão pede a lista e reabre a conversa aberta', async () => {
    const s = setup()
    await openConversation(s)
    s.rerender(false, 1)
    expect(screen.getByText(/Sem conexão com o backend/)).toBeTruthy()
    s.rerender(true, 1)
    expect(s.server.of('chat-list')).toHaveLength(2)
    expect(s.server.of('chat-open').at(-1)).toMatchObject({ conversationId: 5 })
  })

  it('troca de projeto limpa a conversa e ignora mensagens do projeto anterior', async () => {
    const s = setup()
    await openConversation(s, [msg({ id: 1, content: 'do projeto 1' })])
    s.rerender(true, 2)
    expect(screen.queryByText('do projeto 1')).toBeNull()
    expect(s.server.of('chat-list').at(-1)).toEqual({ type: 'chat-list', projectId: 2 })
    s.server.emit({ type: 'chat-conversations', projectId: 1, conversations: [conv()] })
    expect(screen.queryByRole('button', { name: /^Autenticação/ })).toBeNull()
  })

  it('renomear pelo título e excluir só depois de confirmar', async () => {
    const s = setup()
    await openConversation(s)
    await s.user.click(screen.getByRole('button', { name: 'Renomear conversa' }))
    const input = screen.getByLabelText('Título da conversa')
    await s.user.clear(input)
    await s.user.type(input, 'Login com SSO{Enter}')
    expect(s.server.of('chat-rename')[0]).toMatchObject({ conversationId: 5, title: 'Login com SSO' })
    await s.user.click(screen.getByRole('button', { name: 'Excluir conversa Autenticação' }))
    expect(s.server.of('chat-delete')).toHaveLength(0)
    await s.user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await s.user.click(screen.getByRole('button', { name: 'Excluir conversa Autenticação' }))
    await s.user.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(s.server.of('chat-delete')[0]).toMatchObject({ projectId: 1, conversationId: 5 })
  })
})
