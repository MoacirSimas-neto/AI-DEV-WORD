import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DynamicProposal, MissionEvent, PlannedStep } from '../../../shared/protocol.ts'
import { isOpenMission, OPEN_PHASES } from '../../../shared/missionPhases.ts'
import {
  agentForwards,
  currentObjective,
  currentPlanSteps,
  decisionMessage,
  groupSteps,
  latestTrigger,
  limitRows,
  mergeEvents,
  OpGate,
  proposalImpact,
  resumeMessage,
  startMessage,
  teamView,
} from '../../../web/src/ui/dynamicView.ts'
import { parseClientMessage } from '../server.ts'
import { OPEN_PHASES as SERVER_OPEN_PHASES } from '../tasks/store.ts'

// Lógica da interface do modo dinâmico (web/src/ui/dynamicView.ts), testada sem navegador.

const step = (key: string, status: PlannedStep['status'], extra: Partial<PlannedStep> = {}): PlannedStep => ({
  id: Math.floor(Math.random() * 1e9),
  missionId: 1,
  projectId: 1,
  proposalId: 1,
  revision: 1,
  seq: 0,
  key,
  agentId: 'dev',
  mode: 'implement',
  objective: key,
  dependsOn: [],
  inputs: [],
  status,
  startedAt: status === 'approved' || status === 'superseded' ? null : '2026-01-01',
  finishedAt: null,
  result: '',
  error: null,
  correlationId: null,
  ...extra,
})

const change = (action: 'convene' | 'release', agentId: string) => ({ action, agentId, reason: 'r', task: 't', context: 'c', expectedImpact: 'i', alternative: 'a' })
const proposal = (revision: number, status: DynamicProposal['status'], extra: Partial<DynamicProposal> = {}): DynamicProposal => ({
  id: revision,
  missionId: 1,
  projectId: 1,
  revision,
  status,
  kind: 'plan',
  objective: `Objetivo ${revision}`,
  reason: 'r',
  missionState: 's',
  alternative: 'a',
  teamChanges: [],
  steps: [],
  sharedContext: [],
  risks: [],
  completionCriteria: [],
  author: 'architect',
  adjustRound: 0,
  createdAt: '2026-01-01',
  decidedAt: null,
  decidedBy: null,
  feedback: null,
  ...extra,
})
const event = (id: number, type: string, data: Record<string, unknown> = {}): MissionEvent => ({
  id,
  projectId: 1,
  missionId: 1,
  taskId: 1,
  agentId: null,
  type: type as MissionEvent['type'],
  at: '2026-01-01',
  state: 'info',
  evidence: 'observed',
  summary: type,
  data,
  correlationId: null,
})

test('interface: as mensagens construídas pela tela são aceitas pelo protocolo real', () => {
  // Seleção do modo.
  assert.deepEqual(parseClientMessage(JSON.stringify(startMessage(7, 'dynamic', 'architect'))), { type: 'mission-start', taskId: 7, mode: 'dynamic', team: { plannerId: 'architect' } })
  assert.deepEqual(parseClientMessage(JSON.stringify(startMessage(7, 'pipeline', 'architect'))), { type: 'mission-start', taskId: 7 })
  // Decisões.
  const p = proposal(3, 'pending')
  for (const decision of ['approve', 'reject', 'adjust'] as const) {
    const msg = decisionMessage(p, decision, 'op-1', decision === 'approve' ? '' : '  Consulte Dados primeiro.  ')
    assert.deepEqual(parseClientMessage(JSON.stringify(msg)), msg, decision)
  }
  assert.equal((decisionMessage(p, 'adjust', 'op-1', '  Sem QA. ') as { feedback?: string }).feedback, 'Sem QA.')
  assert.equal('feedback' in decisionMessage(p, 'approve', 'op-1', '   '), false)
  // Retomada: acceptChanges só vai quando o usuário marcou.
  const plain = resumeMessage(1, 'continue', 'op-2')
  assert.deepEqual(parseClientMessage(JSON.stringify(plain)), { type: 'mission-resume', missionId: 1, action: 'continue', opId: 'op-2' })
  assert.equal('acceptChanges' in resumeMessage(1, 'continue', 'op-2', { acceptChanges: false }), false)
  const retry = resumeMessage(1, 'retry_step', 'op-3', { stepId: 9, acceptChanges: true, detail: ' ' })
  assert.deepEqual(parseClientMessage(JSON.stringify(retry)), { type: 'mission-resume', missionId: 1, action: 'retry_step', opId: 'op-3', stepId: 9, acceptChanges: true })
})

test('interface: clique duplicado não envia duas decisões', () => {
  const gate = new OpGate()
  const first = gate.begin()
  assert.ok(first)
  assert.equal(gate.begin(), null, 'segundo clique antes da resposta')
  assert.equal(gate.busy, true)
  assert.equal(gate.settle('outro-op'), false, 'resposta de outra operação não libera')
  assert.equal(gate.settle(first!), true)
  assert.notEqual(gate.begin(), null)
  gate.reset()
  assert.equal(gate.busy, false)
  assert.match(first!, /^[\w-]{1,80}$/, 'o opId passa na validação do backend')
})

test('interface: passos agrupados pelo estado real, com a tentativa mais recente', () => {
  const steps = [
    step('impl', 'completed'),
    step('teste', 'approved', { dependsOn: ['impl'] }),
    step('doc', 'approved', { dependsOn: ['revisao'] }),
    step('revisao', 'approved', { dependsOn: ['impl'] }),
    step('sql', 'interrupted', { attempt: 1 }),
    step('sql', 'running', { attempt: 2 }),
    step('quebrado', 'failed'),
    step('depois', 'approved', { dependsOn: ['quebrado'] }),
    step('velho', 'superseded'),
  ]
  const g = groupSteps(steps)
  assert.deepEqual(g.completed.map((s) => s.key), ['impl'])
  assert.deepEqual(g.ready.map((s) => s.key).sort(), ['revisao', 'teste'])
  assert.deepEqual(g.waiting.map((s) => s.key), ['doc'])
  assert.deepEqual(g.blocked.map((s) => s.key), ['depois'])
  assert.deepEqual(g.running.map((s) => [s.key, s.attempt]), [['sql', 2]], 'a tentativa interrompida não aparece como atual')
  assert.deepEqual(g.stopped.map((s) => s.key), ['quebrado'])
  assert.deepEqual(g.superseded.map((s) => s.key), ['velho'])
  assert.ok(!currentPlanSteps(steps).some((s) => s.status === 'superseded'))
})

test('interface: impacto da proposta segue a regra do backend (substitui o que não começou só quando traz passos)', () => {
  const steps = [step('feito', 'completed'), step('pendente', 'approved'), step('rodando', 'running')]
  const withSteps = proposalImpact({ kind: 'replan', teamChanges: [change('convene', 'dados'), change('release', 'qa')], steps: [{ key: 'novo', agentId: 'dados', mode: 'analyze', objective: 'o', dependsOn: [], inputs: [] }] }, steps)
  assert.deepEqual(withSteps.joins, ['dados'])
  assert.deepEqual(withSteps.leaves, ['qa'])
  assert.deepEqual(withSteps.replaced.map((s) => s.key), ['pendente'])
  assert.deepEqual(withSteps.kept, [])
  const teamOnly = proposalImpact({ kind: 'replan', teamChanges: [change('convene', 'dados')], steps: [] }, steps)
  assert.deepEqual(teamOnly.replaced, [])
  assert.deepEqual(teamOnly.kept.map((s) => s.key), ['pendente'])
  assert.equal(proposalImpact({ kind: 'closure', teamChanges: [], steps: [] }, steps).closes, true)
})

test('interface: equipe ativa e dispensados vêm só das propostas aprovadas', () => {
  const proposals = [
    proposal(1, 'approved', { teamChanges: [change('convene', 'dev'), change('convene', 'qa')] }),
    proposal(2, 'rejected', { kind: 'replan', teamChanges: [change('convene', 'seguranca')] }),
    proposal(3, 'approved', { kind: 'replan', teamChanges: [change('release', 'qa'), change('convene', 'dados')] }),
    proposal(4, 'pending', { kind: 'replan', teamChanges: [change('convene', 'docs')] }),
  ]
  const team = teamView('architect', proposals)
  assert.deepEqual(team.active.sort(), ['architect', 'dados', 'dev'])
  assert.deepEqual(team.released, ['qa'])
  assert.equal(currentObjective(proposals), 'Objetivo 3')
  assert.equal(currentObjective([proposal(1, 'pending')]), 'Objetivo 1')
  // Limites: contagens do que está gravado, nunca custo.
  const rows = limitRows({ leadTurns: 5, plannerId: 'architect', limits: { maxSteps: 12, maxTeamChanges: 4, maxActiveMembers: 6, maxReworkRounds: 3, maxCallsPerAgent: 5, maxTechLeadTurns: 8, maxSameConsult: 2, maxAdjustRounds: 2 } }, [step('a', 'completed'), step('b', 'approved'), step('c', 'superseded')], proposals)
  assert.deepEqual(rows.map((r) => [r.key, r.used, r.max]), [
    ['maxTechLeadTurns', 5, 8],
    ['maxSteps', 2, 12],
    ['maxReworkRounds', 0, 3],
    ['maxTeamChanges', 2, 4],
    ['maxActiveMembers', 3, 6],
  ])
})

test('interface: gatilho atual, encaminhamentos entre agentes e eventos sem repetição', () => {
  const events = [event(1, 'mission.started'), event(2, 'replan.triggered', { trigger: 'queue_empty' }), event(3, 'result.forwarded', { from: 'dev', to: 'qa' }), event(4, 'result.forwarded', { from: 'system', to: 'qa' }), event(5, 'result.forwarded', { from: 'qa', to: 'qa' }), event(6, 'replan.triggered', { trigger: 'verdict_rejected' })]
  assert.equal(latestTrigger(events)!.data.trigger, 'verdict_rejected')
  assert.deepEqual(agentForwards(events), [{ id: 3, from: 'dev', to: 'qa' }], 'diff do sistema e auto-encaminhamento não viram animação')
  const merged = mergeEvents(events.slice(0, 3), [event(3, 'result.forwarded', { from: 'dev', to: 'qa' }), event(7, 'mission.blocked'), event(2, 'replan.triggered')])
  assert.deepEqual(merged.map((e) => e.id), [1, 2, 3, 7])
})

test('interface: missões dinâmicas abertas aparecem como ativas em todas as telas (uma lista só)', () => {
  assert.deepEqual(SERVER_OPEN_PHASES, OPEN_PHASES)
  for (const phase of ['executing', 'awaiting_decision', 'planning', 'developing'] as const) assert.ok(isOpenMission({ phase }), phase)
  for (const phase of ['done', 'failed', 'cancelled'] as const) assert.equal(isOpenMission({ phase }), false, phase)
})
