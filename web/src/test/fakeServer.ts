import { act } from '@testing-library/react'
import type {
  AgentInfo,
  ClientMessage,
  DynamicProposal,
  MissionInfo,
  PlannedStep,
  RecoveryState,
  ServerMessage,
  TaskInfo,
} from '../../../shared/protocol.ts'
import type { MessageListener, Send, Subscribe } from '../net/useServer.ts'

/**
 * Backend falso para testes de componente: guarda o que a tela enviou e
 * entrega mensagens como se viessem do WebSocket.
 */
export function fakeServer() {
  const sent: ClientMessage[] = []
  const listeners = new Set<MessageListener>()
  const send: Send = (message) => {
    sent.push(message)
  }
  const subscribe: Subscribe = (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return {
    send,
    subscribe,
    sent,
    /** Mensagens enviadas de um tipo. */
    of<T extends ClientMessage['type']>(type: T) {
      return sent.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type)
    },
    emit(message: ServerMessage) {
      act(() => {
        for (const listener of [...listeners]) listener(message)
      })
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

const NOW = '2026-11-01T12:00:00.000Z'

export const agent = (id: string, extra: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  name: { architect: 'Arquiteto', dev: 'Dev', qa: 'QA' }[id] ?? id,
  role: id,
  cli: id === 'dev' ? 'codex' : 'gemini',
  roleCategory: id === 'dev' ? 'developing' : id === 'qa' ? 'reviewing' : 'planning',
  state: 'idle',
  checking: false,
  session: false,
  cliVersion: '1.0.0',
  auth: 'ok',
  message: '',
  checkedAt: NOW,
  ...extra,
})

export const task = (extra: Partial<TaskInfo> = {}): TaskInfo => ({
  id: 7,
  projectId: 1,
  title: 'Criar API de pagamentos',
  description: 'Com testes.',
  priority: 'medium',
  status: 'todo',
  agentId: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
})

export const mission = (extra: Partial<MissionInfo> = {}): MissionInfo => ({
  id: 3,
  taskId: 7,
  projectId: 1,
  phase: 'awaiting_approval',
  mode: 'dynamic',
  limits: { maxSteps: 12, maxTeamChanges: 4, maxActiveMembers: 6, maxReworkRounds: 2, maxCallsPerAgent: 6, maxTechLeadTurns: 8, maxSameConsult: 2, maxAdjustRounds: 3 },
  leadTurns: 1,
  plannerId: 'architect',
  plan: '',
  devReport: '',
  review: '',
  verdict: null,
  files: [],
  error: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
})

export const proposal = (extra: Partial<DynamicProposal> = {}): DynamicProposal => ({
  id: 11,
  missionId: 3,
  projectId: 1,
  revision: 1,
  status: 'pending',
  author: 'architect',
  adjustRound: 0,
  createdAt: NOW,
  decidedAt: null,
  decidedBy: null,
  feedback: null,
  kind: 'plan',
  objective: 'API de pagamentos com testes',
  reason: 'Precisa de implementação e verificação.',
  missionState: 'Nada feito ainda.',
  alternative: 'A missão fica parada.',
  teamChanges: [
    { action: 'convene', agentId: 'dev', reason: 'Implementar.', task: 'Escrever a API.', context: 'Plano aprovado.', expectedImpact: 'Código pronto.', alternative: 'Sem implementação.' },
  ],
  steps: [{ key: 'impl', agentId: 'dev', mode: 'implement', objective: 'Implementar a API.', dependsOn: [], inputs: [{ kind: 'plan' }] }],
  sharedContext: [{ kind: 'plan' }],
  risks: ['Arredondamento indefinido.'],
  completionCriteria: ['QA aprova.'],
  ...extra,
})

export const step = (extra: Partial<PlannedStep> = {}): PlannedStep => ({
  id: 21,
  missionId: 3,
  projectId: 1,
  revision: 1,
  proposalId: 11,
  seq: 0,
  key: 'impl',
  agentId: 'dev',
  mode: 'implement',
  objective: 'Implementar a API.',
  dependsOn: [],
  inputs: [{ kind: 'plan' }],
  status: 'approved',
  startedAt: null,
  finishedAt: null,
  result: '',
  error: null,
  correlationId: null,
  ...extra,
})

export const recovery = (extra: Partial<RecoveryState> = {}): RecoveryState => ({
  projectId: 1,
  missionId: 3,
  phase: 'awaiting_decision',
  reason: 'interrupted',
  error: null,
  retryable: [],
  eligible: [],
  files: { available: true, known: [], unknown: [] },
  actions: ['continue', 'replan', 'close', 'cancel'],
  ...extra,
})
