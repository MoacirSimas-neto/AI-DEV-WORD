import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ActivityEntry,
  AgentConfig,
  AgentInfo,
  ClientMessage,
  MissionInfo,
  ServerMessage,
  SkillAgentOverride,
  SkillInfo,
  SpecializationInfo,
  TaskInfo,
  Workspace,
} from '../../../shared/protocol.ts'

export type ConnectionStatus = 'connecting' | 'online' | 'offline'
export type Send = (message: ClientMessage) => void
export type MessageListener = (message: ServerMessage) => void
export type Subscribe = (listener: MessageListener) => () => void

const RETRY_MS = 2000
const EMPTY_WORKSPACE: Workspace = { projects: [], activeProjectId: null }

/**
 * Mantém o WebSocket com o backend (reconecta sozinho) e espelha o estado dele.
 * `subscribe` entrega as mensagens cruas: o terminal usa isso para receber a
 * saída sem passar pelo estado do React (seria lento re-renderizar a cada byte).
 */
export function useServer() {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE)
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [missions, setMissions] = useState<MissionInfo[]>([])
  const [history, setHistory] = useState<ActivityEntry[]>([])
  const [configs, setConfigs] = useState<AgentConfig[]>([])
  const [allConfigs, setAllConfigs] = useState<AgentConfig[]>([])
  const [specializations, setSpecializations] = useState<SpecializationInfo[]>([])
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [skillOverrides, setSkillOverrides] = useState<SkillAgentOverride[]>([])
  const [authRequired, setAuthRequired] = useState(false)
  const [reconnectTick, setReconnectTick] = useState(0)
  const socketRef = useRef<WebSocket | null>(null)
  const listeners = useRef(new Set<MessageListener>())

  useEffect(() => {
    let disposed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
    const invokeTauri = async <T,>(cmd: string): Promise<T> => {
      const tauri = (window as unknown as { __TAURI_INTERNALS__: { invoke: <R>(c: string) => Promise<R> } })
        .__TAURI_INTERNALS__
      return tauri.invoke<T>(cmd)
    }

    const connect = async () => {
      let wsUrl = `ws://${location.host}/ws`
      let apiBase = ''
      if (isTauri) {
        try {
          const st = await invokeTauri<{ status: string; port: number }>('get_backend_status')
          if (disposed) return
          if (st.status !== 'ready') {
            retry = setTimeout(() => void connect(), 300)
            return
          }
          apiBase = `http://127.0.0.1:${st.port}`
          wsUrl = `ws://127.0.0.1:${st.port}/ws`
          const sess = await fetch(`${apiBase}/api/session`, { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null) as { authenticated?: boolean } | null
          if (disposed) return
          if (!sess?.authenticated) {
            const boot = await invokeTauri<{ port: number; code: string }>('desktop_bootstrap')
            if (disposed) return
            await fetch(`http://127.0.0.1:${boot.port}/api/pair`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ code: boot.code }),
            })
          }
        } catch {
          if (!disposed) retry = setTimeout(() => void connect(), RETRY_MS)
          return
        }
      }
      if (disposed) return

      const socket = new WebSocket(wsUrl)
      socketRef.current = socket
      socket.onopen = () => {
        setStatus('online')
        setAuthRequired(false)
      }
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage
        if (message.type === 'snapshot') {
          setAgents(Array.isArray(message.agents) ? message.agents : [])
          setWorkspace(message.workspace ?? EMPTY_WORKSPACE)
          setTasks(Array.isArray(message.tasks) ? message.tasks : [])
          setMissions(Array.isArray(message.missions) ? message.missions : [])
          setHistory(Array.isArray(message.history) ? message.history : [])
          setConfigs(Array.isArray(message.configs) ? message.configs : [])
          setAllConfigs(Array.isArray(message.allConfigs) ? message.allConfigs : Array.isArray(message.configs) ? message.configs : [])
          if (Array.isArray(message.specializations)) setSpecializations(message.specializations)
          setSkills(Array.isArray(message.skills) ? message.skills : [])
          setSkillOverrides(Array.isArray(message.skillOverrides) ? message.skillOverrides : [])
        } else if (message.type === 'skills') {
          setSkills(Array.isArray(message.skills) ? message.skills : [])
          setSkillOverrides(Array.isArray(message.overrides) ? message.overrides : [])
        } else if (message.type === 'agent') {
          setAgents((prev) =>
            prev.some((a) => a.id === message.agent.id)
              ? prev.map((a) => (a.id === message.agent.id ? message.agent : a))
              : [...prev, message.agent],
          )
        } else if (message.type === 'agents') {
          setAgents(Array.isArray(message.agents) ? message.agents : [])
        } else if (message.type === 'workspace') {
          setWorkspace(message.workspace ?? EMPTY_WORKSPACE)
        } else if (message.type === 'tasks') {
          setTasks(Array.isArray(message.tasks) ? message.tasks : [])
        } else if (message.type === 'missions') {
          setMissions(Array.isArray(message.missions) ? message.missions : [])
        } else if (message.type === 'history') {
          setHistory(Array.isArray(message.entries) ? message.entries : [])
        } else if (message.type === 'agent-configs') {
          setConfigs(Array.isArray(message.configs) ? message.configs : [])
          setAllConfigs(Array.isArray(message.allConfigs) ? message.allConfigs : Array.isArray(message.configs) ? message.configs : [])
        } else if (message.type === 'specializations') {
          setSpecializations(Array.isArray(message.specializations) ? message.specializations : [])
        }
        for (const listener of listeners.current) listener(message)
      }
      socket.onclose = () => {
        if (disposed) return
        setStatus('offline')
        void fetch(`${apiBase}/api/session`, { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { authenticated?: boolean } | null) => {
            if (!disposed && data && data.authenticated === false) {
              setAuthRequired(true)
            }
          })
          .catch(() => {})
        retry = setTimeout(() => void connect(), RETRY_MS)
      }
    }
    void connect()

    return () => {
      disposed = true
      clearTimeout(retry)
      socketRef.current?.close()
    }
  }, [reconnectTick])

  const pair = useCallback(async (code: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      if (res.ok) {
        setAuthRequired(false)
        setReconnectTick((n) => n + 1)
        return null
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      return data?.error ?? `Falha no pareamento (${res.status})`
    } catch {
      return 'Não foi possível contactar o backend local'
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

  return { status, authRequired, pair, agents, workspace, tasks, missions, history, configs, allConfigs, specializations, skills, skillOverrides, send, subscribe }
}
