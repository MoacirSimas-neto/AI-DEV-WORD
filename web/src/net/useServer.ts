import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentInfo, ClientMessage, ServerMessage } from '../../../shared/protocol.ts'

export type ConnectionStatus = 'connecting' | 'online' | 'offline'
export type Send = (message: ClientMessage) => void
export type MessageListener = (message: ServerMessage) => void
export type Subscribe = (listener: MessageListener) => () => void

const RETRY_MS = 2000

/**
 * Mantém o WebSocket com o backend (reconecta sozinho) e o estado dos agentes.
 * `subscribe` entrega as mensagens cruas: o terminal usa isso para receber a
 * saída sem passar pelo estado do React (seria lento re-renderizar a cada byte).
 */
export function useServer() {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const socketRef = useRef<WebSocket | null>(null)
  const listeners = useRef(new Set<MessageListener>())

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
        } else if (message.type === 'agent') {
          setAgents((prev) => prev.map((a) => (a.id === message.agent.id ? message.agent : a)))
        }
        for (const listener of listeners.current) listener(message)
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

  const send = useCallback<Send>((message) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }, [])

  const subscribe = useCallback<Subscribe>((listener) => {
    listeners.current.add(listener)
    return () => listeners.current.delete(listener)
  }, [])

  return { status, agents, send, subscribe }
}
