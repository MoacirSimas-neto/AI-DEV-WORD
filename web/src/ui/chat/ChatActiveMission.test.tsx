import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AgentConfig, ChatConversation, ChatMessage, ChatMissionLink, MissionEvent, MissionInfo, PlannedStep } from '../../../../shared/protocol.ts'
import { agent, fakeServer, mission, proposal, task } from '../../test/fakeServer.ts'
import { chatMissionMilestones, chatReplanBlocker } from '../dynamicView.ts'
import { ChatView } from './ChatView.tsx'

const NOW = '2026-11-12T12:00:00.000Z'
const CONFIGS: AgentConfig[] = [{ agentId: 'architect', name: 'Ada', roleCategory: 'planning', provider: 'gemini', model: 'default', reasoningEffort: 'default', active: true, updatedAt: NOW }]
const conv = (): ChatConversation => ({ id: 5, projectId: 1, title: 'Auth JWT', agentId: 'architect', createdAt: NOW, updatedAt: NOW, messageCount: 2 })
const msg = (content = 'Quero implementar autenticação.'): ChatMessage => ({
  id: 1,
  conversationId: 5,
  projectId: 1,
  role: 'user',
  author: 'user',
  agentId: null,
  cli: null,
  content,
  status: 'complete',
  opId: null,
  replyTo: null,
  error: null,
  context: null,
  createdAt: NOW,
  updatedAt: NOW,
})
const link = (): ChatMissionLink => ({
  projectId: 1,
  conversationId: 5,
  missionId: 3,
  taskId: 7,
  opId: 'op-1',
  context: { sentMessages: 2, omittedMessages: 0 },
  createdAt: NOW,
})
const step = (extra: Partial<PlannedStep> = {}): PlannedStep => ({
  id: 10,
  missionId: 3,
  projectId: 1,
  proposalId: 1,
  revision: 1,
  seq: 1,
  key: 'impl',
  agentId: 'dev',
  mode: 'implement',
  objective: 'Implementar rotas.',
  dependsOn: [],
  inputs: [{ kind: 'plan' }],
  status: 'running',
  result: '',
  error: null,
  correlationId: '',
  attempt: 1,
  startedAt: NOW,
  finishedAt: null,
  ...extra,
})
const ev = (id: number, type: MissionEvent['type'], data: Record<string, unknown> = {}, state: MissionEvent['state'] = 'completed'): MissionEvent => ({
  id,
  projectId: 1,
  missionId: 3,
  taskId: 7,
  agentId: 'dev',
  type,
  at: NOW,
  state,
  evidence: 'observed',
  summary: `Evento ${type}`,
  data,
  correlationId: '',
})

function setup(m: MissionInfo) {
  const server = fakeServer()
  const user = userEvent.setup()
  const onOffice = vi.fn()
  const onObs = vi.fn()
  render(
    <ChatView
      projectId={1}
      projectName="loja"
      agents={[agent('architect'), agent('dev'), agent('qa')]}
      configs={CONFIGS}
      online
      send={server.send}
      subscribe={server.subscribe}
      onOpenTasks={vi.fn()}
      links={[link()]}
      missions={[m]}
      tasks={[task()]}
      onOpenObservability={onObs}
      onOpenOffice={onOffice}
    />,
  )
  return { server, user, onOffice, onObs }
}

async function openConv(s: ReturnType<typeof setup>, messageText?: string) {
  s.server.emit({ type: 'chat-conversations', projectId: 1, conversations: [conv()] })
  await s.user.click(screen.getByRole('button', { name: /^Auth JWT/ }))
  s.server.emit({ type: 'chat-messages', projectId: 1, conversationId: 5, messages: [msg(messageText)], hasMore: false, beforeId: null })
}

describe('Etapa 12.3 — chat durante missão ativa', () => {
  it('mapeia apenas eventos-marco discretos e explica bloqueios de replanejamento', () => {
    const ms = chatMissionMilestones(
      [
        ev(1, 'cli.started'),
        ev(2, 'proposal.declared', { revision: 1 }),
        ev(3, 'approval.received', { decision: 'approved', revision: 1 }),
        ev(4, 'step.started', { key: 'impl' }, 'started'),
        ev(5, 'mission.completed'),
      ],
      (id) => id.toUpperCase(),
    )
    expect(ms.map((x) => x.text)).toEqual([
      'DEV preparou a proposta (revisão 1).',
      'Você aprovou a revisão 1.',
      'DEV iniciou o passo (impl).',
      'A missão foi concluída.',
    ])
    expect(chatReplanBlocker({ online: true, mission: { mode: 'dynamic', phase: 'awaiting_approval' }, hasPendingReplan: false, requesting: false })).toMatch(/Pedir ajustes/)
    expect(chatReplanBlocker({ online: true, mission: { mode: 'dynamic', phase: 'executing' }, hasPendingReplan: true, requesting: false })).toMatch(/ponto seguro/)
    expect(chatReplanBlocker({ online: true, mission: { mode: 'pipeline', phase: 'executing' }, hasPendingReplan: false, requesting: false })).toMatch(/clássica/)
    expect(chatReplanBlocker({ online: true, mission: { mode: 'dynamic', phase: 'executing' }, hasPendingReplan: false, requesting: false })).toBeNull()
  })

  it('mostra passo em andamento, marcos, links e envia solicitação explícita de alteração pelo chat', async () => {
    const s = setup(mission({ id: 3, mode: 'dynamic', phase: 'executing' }))
    await openConv(s, 'Prefiro usar JWT.')
    s.server.emit({
      type: 'mission-plan',
      projectId: 1,
      missionId: 3,
      proposals: [proposal({ id: 1, revision: 1, status: 'approved', objective: 'API Auth' })],
      steps: [step()],
      pendingReplan: null,
    })
    s.server.emit({
      type: 'mission-events',
      projectId: 1,
      missionId: 3,
      events: [ev(1, 'approval.received', { decision: 'approved', revision: 1 }), ev(2, 'step.started', { key: 'impl' }, 'started')],
    })

    const card = screen.getByRole('article', { name: 'Missão #3' })
    expect(within(card).getByText('API Auth')).toBeTruthy()
    expect(within(card).getByText(/Em andamento:/)).toBeTruthy()
    expect(within(card).getByText('Você aprovou a revisão 1.')).toBeTruthy()

    await s.user.click(within(card).getByRole('button', { name: 'Escritório' }))
    expect(s.onOffice).toHaveBeenCalledTimes(1)

    await s.user.click(within(card).getByRole('button', { name: 'Solicitar alteração' }))
    const box = within(card).getByRole('region', { name: 'Solicitar alteração da missão' })
    const input = within(box).getByRole('textbox') as HTMLTextAreaElement
    expect(input.value).toBe('Prefiro usar JWT.')
    await s.user.clear(input)
    await s.user.type(input, 'Trocar sessão por JWT.')
    await s.user.click(within(box).getByRole('button', { name: 'Enviar solicitação' }))

    const sent = s.server.sent.find((m) => m.type === 'chat-request-replan') as Extract<(typeof s.server.sent)[number], { type: 'chat-request-replan' }>
    expect(sent).toBeTruthy()
    expect(sent.missionId).toBe(3)
    expect(sent.detail).toBe('Trocar sessão por JWT.')

    // Backend confirma que foi enfileirado para o ponto seguro
    s.server.emit({ type: 'chat-result', action: 'request-replan', opId: sent.opId, ok: true, message: 'Aguardando ponto seguro.', conversationId: 5 })
    s.server.emit({
      type: 'mission-plan',
      projectId: 1,
      missionId: 3,
      proposals: [proposal({ id: 1, revision: 1, status: 'approved', objective: 'API Auth' })],
      steps: [step()],
      pendingReplan: { missionId: 3, conversationId: 5, opId: sent.opId, detail: 'Trocar sessão por JWT.', requestedAt: NOW },
    })

    expect(screen.getByText('Aguardando ponto seguro.')).toBeTruthy()
    expect(within(card).getByText(/Alteração na fila \(ponto seguro\):/)).toBeTruthy()
    expect((within(card).getByRole('button', { name: 'Solicitar alteração' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('desabilita Solicitar alteração quando há proposta pendente e exibe o monitor para aprovação', async () => {
    const s = setup(mission({ id: 3, mode: 'dynamic', phase: 'awaiting_approval' }))
    await openConv(s)
    s.server.emit({
      type: 'mission-plan',
      projectId: 1,
      missionId: 3,
      proposals: [proposal({ id: 2, revision: 2, status: 'pending', objective: 'API Auth com JWT' })],
      steps: [],
      pendingReplan: null,
    })

    const card = screen.getByRole('article', { name: 'Missão #3' })
    expect((within(card).getByRole('button', { name: 'Solicitar alteração' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(card).getByText('Nova proposta pendente')).toBeTruthy()
  })
})
