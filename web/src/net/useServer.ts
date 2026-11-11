import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentInfo, ClientMessage, ServerMessage } from '../../../shared/protocol.ts'

export type ConnectionStatus = 'connecting' | 'online' | 'offline'

const RETRY_MS = 2000

/** Mantém o WebSocket com o backend (reconecta sozinho) e o estado dos agentes. */
export function useServer() {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let disposed = false
    let retry: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      const socket = new WebSocket(`ws://${location.host}/ws`)
      socketRef.current = socket
      socket.onopen = () => setStatus('online')
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage
        if (message.type === 'snapshot') {
          setAgents(message.agents)
        } else {
          setAgents((prev) => prev.map((a) => (a.id === message.agent.id ? message.agent : a)))
        }
      }
      socket.onclose = () => {
        if (disposed) return
        setStatus('offline')
        retry = setTimeout(connect, RETRY_MS)
      }
    }
    connect()

    return () => {
      disposed = true
      clearTimeout(retry)
      socketRef.current?.close()
    }
  }, [])

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }, [])

  return { status, agents, send }
}
