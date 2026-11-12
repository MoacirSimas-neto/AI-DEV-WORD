import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatConversation, ChatMessage } from '../../../shared/protocol.ts'
import { newOpId } from '../ui/dynamicView.ts'
import type { Send, Subscribe } from './useServer.ts'

export interface ChatState {
  conversations: ChatConversation[]
  /** false até a primeira lista chegar. */
  listed: boolean
  selectedId: number | null
  messages: ChatMessage[]
  hasMore: boolean
  loadingMessages: boolean
  /** Texto da resposta em andamento (atualizado a cada lote, sem re-renderizar o histórico). */
  streaming: { messageId: number; text: string } | null
  /** Envio aguardando a confirmação do backend. */
  sending: boolean
  error: string | null
}

const EMPTY: ChatState = { conversations: [], listed: false, selectedId: null, messages: [], hasMore: false, loadingMessages: false, streaming: null, sending: false, error: null }

/**
 * Estado do chat de um projeto. Tudo vem do backend (fonte da verdade): a tela pede a lista,
 * abre conversas e envia operações com opId; ao reconectar, pede tudo de novo.
 */
export function useChat(send: Send, subscribe: Subscribe, online: boolean, projectId: number | null) {
  const [state, setState] = useState<ChatState>(EMPTY)
  const selectedRef = useRef<number | null>(null)
  const pending = useRef(new Map<string, { action: string; afterCreate?: string }>())
  const projectRef = useRef(projectId)
  projectRef.current = projectId

  const patch = (p: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => setState((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }))

  // Troca de projeto: nada da conversa anterior fica na tela.
  useEffect(() => {
    selectedRef.current = null
    setState(EMPTY)
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    const unsubscribe = subscribe((msg) => {
      if (msg.type === 'chat-conversations' && msg.projectId === projectRef.current) {
        patch({ conversations: msg.conversations, listed: true })
      } else if (msg.type === 'chat-messages' && msg.projectId === projectRef.current && msg.conversationId === selectedRef.current) {
        patch((s) => {
          const messages = msg.beforeId ? [...msg.messages, ...s.messages] : msg.messages
          const live = messages.findLast((m) => m.status === 'streaming')
          return {
            messages,
            hasMore: msg.hasMore,
            loadingMessages: false,
            // Reabrindo no meio de uma resposta: o texto gravado é a base; os lotes seguintes completam.
            streaming: live ? { messageId: live.id, text: s.streaming?.messageId === live.id ? s.streaming.text : live.content } : null,
          }
        })
      } else if (msg.type === 'chat-message' && msg.message.projectId === projectRef.current && msg.message.conversationId === selectedRef.current) {
        const m = msg.message
        patch((s) => {
          const exists = s.messages.some((x) => x.id === m.id)
          const messages = exists ? s.messages.map((x) => (x.id === m.id ? m : x)) : [...s.messages, m]
          const streaming = m.status === 'streaming' ? { messageId: m.id, text: s.streaming?.messageId === m.id ? s.streaming.text : m.content } : s.streaming?.messageId === m.id ? null : s.streaming
          return { messages, streaming }
        })
      } else if (msg.type === 'chat-delta' && msg.projectId === projectRef.current && msg.conversationId === selectedRef.current) {
        patch((s) => ({ streaming: { messageId: msg.messageId, text: (s.streaming?.messageId === msg.messageId ? s.streaming.text : '') + msg.text } }))
      } else if (msg.type === 'chat-deleted' && msg.projectId === projectRef.current && msg.conversationId === selectedRef.current) {
        selectedRef.current = null
        patch({ selectedId: null, messages: [], streaming: null, hasMore: false })
      } else if (msg.type === 'chat-result') {
        const op = msg.opId ? pending.current.get(msg.opId) : undefined
        if (msg.opId && !op) return // resposta de outra aba
        if (msg.opId) pending.current.delete(msg.opId)
        if (msg.action === 'send') patch({ sending: false })
        if (!msg.ok) {
          patch({ error: msg.message, sending: false })
          return
        }
        if (msg.action === 'create' && msg.conversationId) {
          select(msg.conversationId)
          // Primeira mensagem digitada sem conversa aberta: segue para a conversa recém-criada.
          if (op?.afterCreate) sendText(op.afterCreate, msg.conversationId)
        }
      }
    })
    if (online) send({ type: 'chat-list', projectId })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, subscribe, online, projectId])

  // Reconexão: reabre a conversa aberta (o que chegou enquanto estava offline vem do banco).
  useEffect(() => {
    if (online && projectId && selectedRef.current) {
      patch({ loadingMessages: true })
      send({ type: 'chat-open', projectId, conversationId: selectedRef.current })
    }
    if (!online) {
      pending.current.clear()
      patch({ sending: false })
    }
  }, [online, projectId, send])

  const select = useCallback(
    (conversationId: number) => {
      if (!projectRef.current) return
      selectedRef.current = conversationId
      setState((s) => ({ ...s, selectedId: conversationId, messages: [], streaming: null, hasMore: false, loadingMessages: true, error: null }))
      send({ type: 'chat-open', projectId: projectRef.current, conversationId })
    },
    [send],
  )

  const op = (action: string, extra: { afterCreate?: string } = {}) => {
    const id = newOpId()
    pending.current.set(id, { action, ...extra })
    return id
  }

  const sendText = useCallback(
    (content: string, conversationId = selectedRef.current) => {
      const projectId = projectRef.current
      if (!projectId || !conversationId) return false
      patch({ sending: true, error: null })
      send({ type: 'chat-send', projectId, conversationId, content, opId: op('send') })
      return true
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [send],
  )

  return {
    state,
    select,
    /** Cria conversa; com `firstMessage`, envia assim que ela existir. */
    create(agentId: string, firstMessage?: string) {
      if (!projectRef.current) return
      if (firstMessage) patch({ sending: true, error: null })
      send({ type: 'chat-create', projectId: projectRef.current, agentId, opId: op('create', { afterCreate: firstMessage }) })
    },
    sendText,
    cancel() {
      if (projectRef.current && selectedRef.current) send({ type: 'chat-cancel', projectId: projectRef.current, conversationId: selectedRef.current, opId: op('cancel') })
    },
    rename(conversationId: number, title: string) {
      if (projectRef.current) send({ type: 'chat-rename', projectId: projectRef.current, conversationId, title, opId: op('rename') })
    },
    remove(conversationId: number) {
      if (projectRef.current) send({ type: 'chat-delete', projectId: projectRef.current, conversationId, opId: op('delete') })
    },
    loadOlder() {
      const first = state.messages[0]
      if (projectRef.current && selectedRef.current && first) send({ type: 'chat-open', projectId: projectRef.current, conversationId: selectedRef.current, beforeId: first.id })
    },
    /** Tela de conversa nova: a conversa só é criada no primeiro envio. */
    startNew() {
      selectedRef.current = null
      patch({ selectedId: null, messages: [], streaming: null, hasMore: false, loadingMessages: false, error: null })
    },
    dismissError: () => patch({ error: null }),
  }
}
