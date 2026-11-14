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
export type AgentLoadStatus = 'connecting' | 'loading' | 'reconnecting' | 'error' | 'ready'
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
export type MemoryConsentAction = 'create' | 'approve' | 'reject' | 'supersede'
export type MemoryConsentRequester = (
  action: MemoryConsentAction,
  targetId: number,
  details: string,
) => Promise<{ nonce: string | null; error?: string }>

export type MissionConsentAction = 'approve' | 'adjust' | 'reject' | 'close'
export interface MissionConsentRequest {
  action: MissionConsentAction
  missionId: number
  proposalId?: number
  revision?: number
  feedback?: string
  details: string
}
export type MissionConsentRequester = (
  request: MissionConsentRequest,
) => Promise<{ nonce: string | null; error?: string }>

const MEMORY_CONSENT_META: Record<MemoryConsentAction, { title: string; confirmLabel: string }> = {
  create: { title: 'AI Dev World — Confirmar criação de memória', confirmLabel: 'Confirmar criação' },
  approve: { title: 'AI Dev World — Confirmar aprovação de memória', confirmLabel: 'Confirmar aprovação' },
  reject: { title: 'AI Dev World — Confirmar rejeição de memória', confirmLabel: 'Confirmar rejeição' },
  supersede: { title: 'AI Dev World — Confirmar substituição de memória', confirmLabel: 'Confirmar substituição' },
}

const MISSION_CONSENT_META: Record<MissionConsentAction, { title: string; confirmLabel: string }> = {
  approve: { title: 'AI Dev World — Confirmar aprovação de proposta', confirmLabel: 'Confirmar aprovação' },
  adjust: { title: 'AI Dev World — Confirmar pedido de ajustes', confirmLabel: 'Confirmar ajustes' },
  reject: { title: 'AI Dev World — Confirmar rejeição de proposta', confirmLabel: 'Confirmar rejeição' },
  close: { title: 'AI Dev World — Confirmar encerramento de missão', confirmLabel: 'Confirmar encerramento' },
}

export function useServer() {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [agentLoadStatus, setAgentLoadStatus] = useState<AgentLoadStatus>('connecting')
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
  const desktopTokenRef = useRef<string | null>(null)
  const apiBaseRef = useRef('')
  const listeners = useRef(new Set<MessageListener>())

  useEffect(() => {
    let disposed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    let snapshotTimer: ReturnType<typeof setTimeout> | undefined
    let receivedSnapshot = false
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
    const invokeTauri = async <T,>(cmd: string): Promise<T> => {
      const tauri = (window as unknown as { __TAURI_INTERNALS__: { invoke: <R>(c: string) => Promise<R> } })
        .__TAURI_INTERNALS__
      return tauri.invoke<T>(cmd)
    }

    const connect = async () => {
      let wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
      let apiBase = ''
      if (isTauri) {
        try {
          const st = await invokeTauri<{ status: string; port: number }>('get_backend_status')
          if (disposed) return
          if (st.status !== 'ready') {
            if (st.status === 'error') setAgentLoadStatus('error')
            retry = setTimeout(() => void connect(), 300)
            return
          }
          apiBase = `http://127.0.0.1:${st.port}`
          apiBaseRef.current = apiBase
          wsUrl = `ws://127.0.0.1:${st.port}/ws`
          const authHeaders: Record<string, string> = desktopTokenRef.current
            ? { authorization: `Bearer ${desktopTokenRef.current}` }
            : {}
          const sess = await fetch(`${apiBase}/api/session`, { credentials: 'include', headers: authHeaders })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null) as { authenticated?: boolean } | null
          if (disposed) return
          if (!sess?.authenticated) {
            desktopTokenRef.current = null
            const boot = await invokeTauri<{ port: number; code: string }>('desktop_bootstrap')
            if (disposed) return
            const pairRes = await fetch(`http://127.0.0.1:${boot.port}/api/pair`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ code: boot.code }),
            })
            if (pairRes.ok) {
              const pairData = (await pairRes.json().catch(() => null)) as { token?: string } | null
              if (disposed) return
              if (pairData?.token) desktopTokenRef.current = pairData.token
            }
            if (!desktopTokenRef.current) throw new Error('Falha no pareamento desktop')
          }
        } catch {
          if (!disposed) {
            setAgentLoadStatus('error')
            retry = setTimeout(() => void connect(), RETRY_MS)
          }
          return
        }
      }
      if (disposed) return

      const socket = desktopTokenRef.current
        ? new WebSocket(wsUrl, ['aidw-auth', desktopTokenRef.current])
        : new WebSocket(wsUrl)
      socketRef.current = socket
      let snapshotFailed = false
      socket.onopen = () => {
        if (disposed) return
        setStatus('online')
        setAuthRequired(false)
        setAgentLoadStatus('loading')
        snapshotTimer = setTimeout(() => setAgentLoadStatus('error'), 5000)
      }
      socket.onmessage = (event) => {
        if (disposed) return
        let message: ServerMessage
        try {
          message = JSON.parse(String(event.data)) as ServerMessage
        } catch {
          return
        }
        if (!message || typeof message.type !== 'string') return
        if (message.type === 'snapshot-error') {
          clearTimeout(snapshotTimer)
          snapshotFailed = true
          setAgentLoadStatus('error')
        } else if (message.type === 'snapshot') {
          clearTimeout(snapshotTimer)
          if (!Array.isArray(message.agents) || !Array.isArray(message.configs) ||
              (message.allConfigs !== undefined && !Array.isArray(message.allConfigs))) {
            setAgentLoadStatus('error')
            return
          }
          receivedSnapshot = true
          setAgents(message.agents)
          setAgentLoadStatus('ready')
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
        clearTimeout(snapshotTimer)
        setStatus('offline')
        setAgentLoadStatus(receivedSnapshot && !snapshotFailed ? 'reconnecting' : 'error')
        if (!isTauri) {
          void fetch(`${apiBase}/api/session`, { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { authenticated?: boolean } | null) => {
              if (!disposed && socketRef.current === socket && socket.readyState === WebSocket.CLOSED && data?.authenticated === false) {
                setAuthRequired(true)
              }
            })
            .catch(() => {})
        }
        retry = setTimeout(() => void connect(), RETRY_MS)
      }
    }
    void connect()

    return () => {
      disposed = true
      clearTimeout(retry)
      clearTimeout(snapshotTimer)
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

  const fetchDiagnostics = useCallback(async () => {
    const headers: Record<string, string> = desktopTokenRef.current
      ? { authorization: `Bearer ${desktopTokenRef.current}` }
      : {}
    return fetch(`${apiBaseRef.current}/api/diagnostics`, { credentials: 'include', headers })
  }, [])

  const fetchSetupCatalog = useCallback(async () => {
    const headers: Record<string, string> = desktopTokenRef.current
      ? { authorization: `Bearer ${desktopTokenRef.current}` }
      : {}
    return fetch(`${apiBaseRef.current}/api/setup/catalog`, { credentials: 'include', headers })
  }, [])

  const requestSetupConsent = useCallback(async (toolId: string) => {
    const tauriInvoke = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__?.invoke
    if (tauriInvoke) {
      const nonce = await tauriInvoke<string | null>('confirm_tool_install', {
        toolId,
        title: 'AI Dev World — Confirmar instalação',
        details: `Deseja autorizar a instalação única de "${toolId}" no seu sistema?`,
      })
      if (!nonce) {
        return new Response(JSON.stringify({ cancelled: true }), { status: 403 })
      }
      return new Response(JSON.stringify({ nonce }), { status: 200 })
    }
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(desktopTokenRef.current ? { authorization: `Bearer ${desktopTokenRef.current}` } : {}),
    }
    return fetch(`${apiBaseRef.current}/api/setup/consent`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ toolId }),
    })
  }, [])

  const installSetupTool = useCallback(async (toolId: string, consentNonce: string) => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(desktopTokenRef.current ? { authorization: `Bearer ${desktopTokenRef.current}` } : {}),
    }
    return fetch(`${apiBaseRef.current}/api/setup/install`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ toolId, consentNonce }),
    })
  }, [])

  const requestMemoryConsent = useCallback<MemoryConsentRequester>(async (action, targetId, details) => {
    const meta = MEMORY_CONSENT_META[action]
    const tauriInvoke = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__?.invoke
    if (tauriInvoke) {
      try {
        const nonce = await tauriInvoke<string | null>('confirm_memory_action', {
          action,
          targetId,
          title: meta.title,
          details,
          confirmLabel: meta.confirmLabel,
        })
        return { nonce: nonce ?? null }
      } catch (err) {
        return { nonce: null, error: err instanceof Error ? err.message : String(err) }
      }
    }
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(desktopTokenRef.current ? { authorization: `Bearer ${desktopTokenRef.current}` } : {}),
    }
    try {
      const res = await fetch(`${apiBaseRef.current}/api/memory/consent`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ action, targetId }),
      })
      const data = (await res.json().catch(() => ({}))) as { nonce?: string; error?: string }
      if (!res.ok || !data.nonce) {
        return { nonce: null, error: data.error || 'Confirmação nativa indisponível no modo web/headless.' }
      }
      return { nonce: data.nonce }
    } catch {
      return { nonce: null, error: 'Falha ao solicitar autorização de memória ao backend.' }
    }
  }, [])

  const requestMissionConsent = useCallback<MissionConsentRequester>(async (request) => {
    const meta = MISSION_CONSENT_META[request.action]
    const tauriInvoke = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__?.invoke
    if (tauriInvoke) {
      try {
        const nonce = await tauriInvoke<string | null>('confirm_mission_action', {
          action: request.action,
          missionId: request.missionId,
          proposalId: request.proposalId ?? null,
          revision: request.revision ?? null,
          feedback: request.feedback ?? null,
          title: meta.title,
          details: request.details,
          confirmLabel: meta.confirmLabel,
        })
        return { nonce: nonce ?? null }
      } catch (err) {
        return { nonce: null, error: err instanceof Error ? err.message : String(err) }
      }
    }
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(desktopTokenRef.current ? { authorization: `Bearer ${desktopTokenRef.current}` } : {}),
    }
    try {
      const res = await fetch(`${apiBaseRef.current}/api/mission/consent`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          action: request.action,
          missionId: request.missionId,
          proposalId: request.proposalId,
          revision: request.revision,
          feedback: request.feedback,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { nonce?: string; error?: string }
      if (!res.ok || !data.nonce) {
        return { nonce: null, error: data.error || 'Confirmação nativa indisponível no modo web/headless.' }
      }
      return { nonce: data.nonce }
    } catch {
      return { nonce: null, error: 'Falha ao solicitar autorização da missão ao backend.' }
    }
  }, [])

  return {
    status,
    agentLoadStatus,
    authRequired,
    pair,
    agents,
    workspace,
    tasks,
    missions,
    history,
    configs,
    allConfigs,
    specializations,
    skills,
    skillOverrides,
    send,
    subscribe,
    fetchDiagnostics,
    fetchSetupCatalog,
    requestSetupConsent,
    installSetupTool,
    requestMemoryConsent,
    requestMissionConsent,
  }
}
