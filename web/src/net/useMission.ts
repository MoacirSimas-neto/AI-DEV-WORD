import { useEffect, useState } from 'react'
import type { DynamicProposal, MissionEvent, PendingReplanRequest, PlannedStep } from '../../../shared/protocol.ts'
import { mergeEvents } from '../ui/dynamicView.ts'
import type { Send, Subscribe } from './useServer.ts'

export interface PlanState {
  proposals: DynamicProposal[]
  steps: PlannedStep[]
  pendingReplan: PendingReplanRequest | null
  loaded: boolean
}

const EMPTY: PlanState = { proposals: [], steps: [], pendingReplan: null, loaded: false }

/**
 * Propostas e passos de uma missão dinâmica. Pede ao backend ao montar e a cada reconexão
 * (online volta a true), e recebe as mudanças ao vivo (mission-plan).
 */
export function usePlan(send: Send, subscribe: Subscribe, online: boolean, projectId: number | null, missionId: number | null): PlanState {
  const [plan, setPlan] = useState<PlanState & { key: string }>({ ...EMPTY, key: '' })
  const key = `${projectId}:${missionId}`

  useEffect(() => {
    if (!projectId || !missionId) return
    const unsubscribe = subscribe((msg) => {
      if (msg.type === 'mission-plan' && msg.projectId === projectId && msg.missionId === missionId) {
        setPlan({ proposals: msg.proposals, steps: msg.steps, pendingReplan: msg.pendingReplan ?? null, loaded: true, key: `${projectId}:${missionId}` })
      }
    })
    if (online) send({ type: 'plan-list', projectId, missionId })
    return unsubscribe
  }, [send, subscribe, online, projectId, missionId])

  // Trocou de missão: nada da anterior aparece enquanto a nova não chega.
  return plan.key === key ? plan : EMPTY
}

/** Trilha de eventos de uma missão: lista persistida ao montar/reconectar + eventos novos ao vivo. */
export function useMissionEvents(send: Send, subscribe: Subscribe, online: boolean, projectId: number | null, missionId: number | null): MissionEvent[] {
  const [state, setState] = useState<{ key: string; events: MissionEvent[] }>({ key: '', events: [] })
  const key = `${projectId}:${missionId}`

  useEffect(() => {
    if (!projectId || !missionId) return
    const current = `${projectId}:${missionId}`
    const unsubscribe = subscribe((msg) => {
      if (msg.type === 'mission-events' && msg.projectId === projectId && msg.missionId === missionId) {
        setState((prev) => ({ key: current, events: mergeEvents(prev.key === current ? prev.events : [], msg.events) }))
      } else if (msg.type === 'mission-event' && msg.event.projectId === projectId && msg.event.missionId === missionId) {
        setState((prev) => ({ key: current, events: mergeEvents(prev.key === current ? prev.events : [], [msg.event]) }))
      }
    })
    if (online) send({ type: 'events-list', projectId, missionId })
    return unsubscribe
  }, [send, subscribe, online, projectId, missionId])

  return state.key === key ? state.events : []
}
