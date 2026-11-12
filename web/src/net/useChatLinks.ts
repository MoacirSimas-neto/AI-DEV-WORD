import { useEffect, useState } from 'react'
import type { ChatMissionLink } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from './useServer.ts'

/**
 * Missões nascidas de conversas do projeto (Etapa 12.2). O backend envia a lista inteira
 * a cada vínculo novo; ao reconectar ou trocar de projeto, a tela pede de novo.
 */
export function useChatLinks(send: Send, subscribe: Subscribe, online: boolean, projectId: number | null): ChatMissionLink[] {
  const [state, setState] = useState<{ projectId: number | null; links: ChatMissionLink[] }>({ projectId: null, links: [] })

  useEffect(() => {
    if (!projectId) return
    const unsubscribe = subscribe((msg) => {
      if (msg.type === 'chat-links' && msg.projectId === projectId) setState({ projectId, links: Array.isArray(msg.links) ? msg.links : [] })
    })
    if (online) send({ type: 'chat-links', projectId })
    return unsubscribe
  }, [send, subscribe, online, projectId])

  // Nada de outro projeto aparece enquanto a lista nova não chega.
  return state.projectId === projectId ? state.links : []
}
