import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, realpathSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { WebSocket } from 'ws'
import type { ClientMessage, DynamicProposalInput, ServerMessage } from '../../../shared/protocol.ts'
import { AgentConfigStore } from '../agents/configStore.ts'
import { AgentRegistry, DEFAULT_AGENTS } from '../agents/registry.ts'
import { GitService } from '../git/service.ts'
import { HistoryStore } from '../history/store.ts'
import { MemoryStore } from '../memory/store.ts'
import { EventStore } from '../observability/store.ts'
import { ProjectStore } from '../projects/store.ts'
import { createAppServer } from '../server.ts'
import { SkillStore } from '../skills/store.ts'
import { TaskStore } from '../tasks/store.ts'
import { TerminalManager } from '../terminal/manager.ts'
import { MissionConsentGate, proposalConsentFingerprint } from './missionConsent.ts'
import { PlanStore } from './planStore.ts'
import { TeamRunner } from './runner.ts'

const ORIGIN = 'http://localhost:5173'
const DESKTOP_SECRET = 'test-desktop-secret-mission-consent'
const prevSecret = process.env.AIDW_DESKTOP_BOOTSTRAP_SECRET
process.env.AIDW_DESKTOP_BOOTSTRAP_SECRET = DESKTOP_SECRET

const projectDir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-mc-')))
const projects = new ProjectStore(':memory:')
const history = new HistoryStore(projects.db)
const tasks = new TaskStore(projects.db, history)
const agentConfigs = new AgentConfigStore(projects.db)
const memory = new MemoryStore(projects.db, history)
const skills = new SkillStore(projects.db)
const events = new EventStore(projects.db)
const plans = new PlanStore(projects.db, tasks)
const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: 'fake 1.0', auth: 'ok' }))
const git = new GitService()
const team = new TeamRunner({
  tasks,
  history,
  projects,
  registry,
  git,
  configs: agentConfigs,
  events,
  plans,
  launch: () => ({
    done: Promise.resolve({ code: 0, stdout: 'ok', stderr: '', timedOut: false }),
    kill: () => {},
  }),
})
const terminals = new TerminalManager(
  registry,
  () => {
    let emit: (data: string) => void = () => {}
    return {
      onData: (l) => (emit = l),
      onExit: () => {},
      write: (d) => emit(d),
      resize: () => {},
      kill: () => {},
    }
  },
  () => projects.active()?.path ?? null,
)

const app = createAppServer({
  registry,
  terminals,
  projects,
  git,
  tasks,
  history,
  team,
  agentConfigs,
  memory,
  skills,
  events,
  plans,
  allowedOrigins: [ORIGIN],
  authToken: 'test-session-token',
})

let baseUrl = ''
let wsUrl = ''
let projectId = 0

before(async () => {
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve))
  const { port } = app.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
  wsUrl = `ws://127.0.0.1:${port}/ws`
  projects.add(projectDir)
  projectId = projects.active()!.id
  await registry.check('dev')
})

after(async () => {
  if (prevSecret === undefined) delete process.env.AIDW_DESKTOP_BOOTSTRAP_SECRET
  else process.env.AIDW_DESKTOP_BOOTSTRAP_SECRET = prevSecret
  await new Promise<void>((resolve) => app.close(() => resolve()))
})

function makeProposalInput(overrides: Partial<DynamicProposalInput> = {}): DynamicProposalInput {
  return {
    kind: 'plan',
    objective: 'Implementar módulo seguro.',
    reason: 'Escopo validado.',
    missionState: 'Início.',
    alternative: 'Nenhuma.',
    teamChanges: [
      {
        action: 'convene',
        agentId: 'dev',
        reason: 'Implementação',
        task: 'Codificar endpoint',
        expectedImpact: 'Entrega',
        context: 'Plano',
        alternative: 'Nenhuma',
      },
    ],
    steps: [
      {
        key: 'impl',
        agentId: 'dev',
        mode: 'implement',
        objective: 'Codificar endpoint.',
        dependsOn: [],
        inputs: [],
      },
    ],
    sharedContext: [{ kind: 'plan' }],
    risks: [],
    completionCriteria: ['Testes passando.'],
    ...overrides,
  }
}

function createPendingProposal(title: string, input: Partial<DynamicProposalInput> = {}) {
  const task = tasks.create(projectId, { title, description: '', priority: 'high', status: 'todo', agentId: null })
  const mission = tasks.createMission(task.id, projectId, { mode: 'dynamic' })
  const proposal = plans.propose(mission.id, 'architect', makeProposalInput(input), 'initial_plan')
  return { task, mission: tasks.getMission(mission.id)!, proposal }
}

async function openAuthedWs() {
  const ws = new WebSocket(wsUrl, {
    origin: ORIGIN,
    headers: { Authorization: 'Bearer test-session-token' },
  })
  await once(ws, 'open')
  const messages: ServerMessage[] = []
  ws.on('message', (raw) => messages.push(JSON.parse(raw.toString()) as ServerMessage))
  const sendAndWait = async <T extends ServerMessage['type']>(
    msg: ClientMessage,
    type: T,
    match: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> => {
    const startIdx = messages.length
    ws.send(JSON.stringify(msg))
    for (let i = 0; i < 60; i++) {
      for (let j = startIdx; j < messages.length; j++) {
        const m = messages[j]
        if (m.type === type && match(m as Extract<ServerMessage, { type: T }>)) {
          return m as Extract<ServerMessage, { type: T }>
        }
      }
      await new Promise((r) => setTimeout(r, 15))
    }
    throw new Error(`Timeout waiting for ${type}`)
  }
  return { ws, sendAndWait }
}

async function issueMissionConsent(body: Record<string, unknown>, secret = DESKTOP_SECRET) {
  const res = await fetch(`${baseUrl}/api/mission/consent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-aidw-desktop-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as { nonce?: string; error?: string }
  return { status: res.status, data }
}

test('MissionConsentGate: expiração, reutilização, troca de missão/revisão/decisão e mudança de proposta/feedback', async () => {
  const gate = new MissionConsentGate()
  const p = makeProposalInput()
  const fp = proposalConsentFingerprint({ ...p, status: 'pending' })

  const expired = gate.issue(
    { action: 'approve', missionId: 1, missionPhase: 'awaiting_approval', proposalId: 10, revision: 1, proposalFingerprint: fp },
    1,
  )
  await new Promise((r) => setTimeout(r, 10))
  assert.throws(
    () => gate.consume(expired.nonce, { action: 'approve', missionId: 1, missionPhase: 'awaiting_approval', proposalId: 10, revision: 1, proposalFingerprint: fp }),
    /expirada/,
  )

  const ticket = gate.issue({
    action: 'adjust',
    missionId: 1,
    missionPhase: 'awaiting_approval',
    proposalId: 10,
    revision: 1,
    proposalFingerprint: fp,
    feedback: 'Ajustar testes',
  })

  // Outra missão / decisão / revisão / feedback adulterado / proposta alterada
  assert.throws(
    () => gate.consume(ticket.nonce, { action: 'adjust', missionId: 2, missionPhase: 'awaiting_approval', proposalId: 10, revision: 1, proposalFingerprint: fp, feedback: 'Ajustar testes' }),
    /outra missão/,
  )
  assert.throws(
    () => gate.consume(ticket.nonce, { action: 'approve', missionId: 1, missionPhase: 'awaiting_approval', proposalId: 10, revision: 1, proposalFingerprint: fp, feedback: 'Ajustar testes' }),
    /outra missão ou decisão/,
  )
  assert.throws(
    () => gate.consume(ticket.nonce, { action: 'adjust', missionId: 1, missionPhase: 'awaiting_approval', proposalId: 10, revision: 2, proposalFingerprint: fp, feedback: 'Ajustar testes' }),
    /outra proposta ou revisão/,
  )
  assert.throws(
    () => gate.consume(ticket.nonce, { action: 'adjust', missionId: 1, missionPhase: 'awaiting_approval', proposalId: 10, revision: 1, proposalFingerprint: fp, feedback: 'Mudar tudo' }),
    /não corresponde/,
  )

  // Consumo válido e tentativa de reuso
  gate.consume(ticket.nonce, { action: 'adjust', missionId: 1, missionPhase: 'awaiting_approval', proposalId: 10, revision: 1, proposalFingerprint: fp, feedback: 'Ajustar testes' })
  assert.throws(
    () => gate.consume(ticket.nonce, { action: 'adjust', missionId: 1, missionPhase: 'awaiting_approval', proposalId: 10, revision: 1, proposalFingerprint: fp, feedback: 'Ajustar testes' }),
    /já utilizada/,
  )
})

test('1 e 3: cliente autenticado sem consentimento (ou após cancelamento) não aprova proposta', async () => {
  const { mission, proposal } = createPendingProposal('Teste sem consentimento')
  const { ws, sendAndWait } = await openAuthedWs()
  try {
    // Sem segredo desktop, endpoint /api/mission/consent recusa (simula web/headless sem diálogo nativo)
    const noSecret = await issueMissionConsent({ action: 'approve', missionId: mission.id, proposalId: proposal.id, revision: proposal.revision }, '')
    assert.equal(noSecret.status, 403)

    // Cliente WS autenticado tenta aprovar sem nonce (ou como se tivesse cancelado)
    const res = await sendAndWait(
      { type: 'proposal-decide', missionId: mission.id, proposalId: proposal.id, revision: proposal.revision, decision: 'approve', opId: 'op-no-consent-1' },
      'proposal-result',
      (m) => m.opId === 'op-no-consent-1',
    )
    assert.equal(res.ok, false)
    assert.match(res.message, /Autorização humana obrigatória/)
    assert.equal(plans.getProposal(proposal.id)?.status, 'pending')
  } finally {
    ws.close()
  }
})

test('2 e 4: aprovação válida com confirmação nativa e rejeição de reuso do nonce', async () => {
  const { mission, proposal } = createPendingProposal('Teste aprovação válida')
  const { ws, sendAndWait } = await openAuthedWs()
  try {
    const consent = await issueMissionConsent({
      action: 'approve',
      missionId: mission.id,
      proposalId: proposal.id,
      revision: proposal.revision,
    })
    assert.equal(consent.status, 200)
    assert.ok(consent.data.nonce)

    const okRes = await sendAndWait(
      { type: 'proposal-decide', missionId: mission.id, proposalId: proposal.id, revision: proposal.revision, decision: 'approve', opId: 'op-approve-ok', consentNonce: consent.data.nonce },
      'proposal-result',
      (m) => m.opId === 'op-approve-ok',
    )
    assert.equal(okRes.ok, true, okRes.message)
    assert.equal(plans.getProposal(proposal.id)?.status, 'approved')
    await new Promise((r) => setTimeout(r, 40))

    // Reuso do mesmo nonce (mesmo com outro opId) falha
    const reuseRes = await sendAndWait(
      { type: 'proposal-decide', missionId: mission.id, proposalId: proposal.id, revision: proposal.revision, decision: 'approve', opId: 'op-approve-reuse', consentNonce: consent.data.nonce },
      'proposal-result',
      (m) => m.opId === 'op-approve-reuse',
    )
    assert.equal(reuseRes.ok, false)
    assert.match(reuseRes.message, /já utilizada/)
    try { team.cancel(mission.id) } catch {}
  } finally {
    ws.close()
  }
})

test('5 e 6: nonce vinculado a outra missão, revisão ou decisão é rejeitado', async () => {
  const m1 = createPendingProposal('Missão 1')
  const m2 = createPendingProposal('Missão 2')
  const { ws, sendAndWait } = await openAuthedWs()
  try {
    const consentM1 = await issueMissionConsent({
      action: 'approve',
      missionId: m1.mission.id,
      proposalId: m1.proposal.id,
      revision: m1.proposal.revision,
    })
    assert.equal(consentM1.status, 200)

    // Tenta usar nonce da missão 1 na missão 2
    const wrongMission = await sendAndWait(
      { type: 'proposal-decide', missionId: m2.mission.id, proposalId: m2.proposal.id, revision: m2.proposal.revision, decision: 'approve', opId: 'op-wrong-m', consentNonce: consentM1.data.nonce },
      'proposal-result',
      (m) => m.opId === 'op-wrong-m',
    )
    assert.equal(wrongMission.ok, false)
    assert.equal(plans.getProposal(m2.proposal.id)?.status, 'pending')

    // Tenta usar nonce de approve como reject na missão 1
    const wrongDecision = await sendAndWait(
      { type: 'proposal-decide', missionId: m1.mission.id, proposalId: m1.proposal.id, revision: m1.proposal.revision, decision: 'reject', opId: 'op-wrong-d', consentNonce: consentM1.data.nonce },
      'proposal-result',
      (m) => m.opId === 'op-wrong-d',
    )
    assert.equal(wrongDecision.ok, false)
    assert.equal(plans.getProposal(m1.proposal.id)?.status, 'pending')
  } finally {
    ws.close()
  }
})

test('7: mudança de proposta/estado enquanto consentimento está pendente invalida o nonce', async () => {
  const { mission, proposal } = createPendingProposal('Proposta mutável')
  const { ws, sendAndWait } = await openAuthedWs()
  try {
    const consent = await issueMissionConsent({
      action: 'approve',
      missionId: mission.id,
      proposalId: proposal.id,
      revision: proposal.revision,
    })
    assert.equal(consent.status, 200)

    // Simula alteração da proposta no banco enquanto diálogo estava aberto
    projects.db.prepare('UPDATE mission_proposals SET objective = ? WHERE id = ?').run('Objetivo alterado maliciosamente', proposal.id)

    const res = await sendAndWait(
      { type: 'proposal-decide', missionId: mission.id, proposalId: proposal.id, revision: proposal.revision, decision: 'approve', opId: 'op-mutated', consentNonce: consent.data.nonce },
      'proposal-result',
      (m) => m.opId === 'op-mutated',
    )
    assert.equal(res.ok, false)
    assert.match(res.message, /mudou enquanto o diálogo estava aberto/)
    assert.equal(plans.getProposal(proposal.id)?.status, 'pending')
  } finally {
    ws.close()
  }
})

test('8 e 9: pedido de ajustes autorizado e rejeição autorizada', async () => {
  const adj = createPendingProposal('Pedido de ajustes')
  const rej = createPendingProposal('Rejeição')
  const { ws, sendAndWait } = await openAuthedWs()
  try {
    const consentRej = await issueMissionConsent({
      action: 'reject',
      missionId: rej.mission.id,
      proposalId: rej.proposal.id,
      revision: rej.proposal.revision,
    })
    assert.equal(consentRej.status, 200)

    const okRej = await sendAndWait(
      { type: 'proposal-decide', missionId: rej.mission.id, proposalId: rej.proposal.id, revision: rej.proposal.revision, decision: 'reject', opId: 'op-rej-ok', consentNonce: consentRej.data.nonce },
      'proposal-result',
      (m) => m.opId === 'op-rej-ok',
    )
    assert.equal(okRej.ok, true, okRej.message)
    assert.equal(plans.getProposal(rej.proposal.id)?.status, 'rejected')

    const consentAdj = await issueMissionConsent({
      action: 'adjust',
      missionId: adj.mission.id,
      proposalId: adj.proposal.id,
      revision: adj.proposal.revision,
      feedback: 'Adicionar passo de QA.',
    })
    assert.equal(consentAdj.status, 200)

    // Adulterar feedback falha
    const tampered = await sendAndWait(
      { type: 'proposal-decide', missionId: adj.mission.id, proposalId: adj.proposal.id, revision: adj.proposal.revision, decision: 'adjust', feedback: 'Feedback adulterado', opId: 'op-adj-bad', consentNonce: consentAdj.data.nonce },
      'proposal-result',
      (m) => m.opId === 'op-adj-bad',
    )
    assert.equal(tampered.ok, false)

    // Feedback exato passa
    const okAdj = await sendAndWait(
      { type: 'proposal-decide', missionId: adj.mission.id, proposalId: adj.proposal.id, revision: adj.proposal.revision, decision: 'adjust', feedback: 'Adicionar passo de QA.', opId: 'op-adj-ok', consentNonce: consentAdj.data.nonce },
      'proposal-result',
      (m) => m.opId === 'op-adj-ok',
    )
    assert.equal(okAdj.ok, true, okAdj.message)
    assert.equal(plans.getProposal(adj.proposal.id)?.status, 'adjust_requested')
    try { team.cancel(adj.mission.id) } catch {}
  } finally {
    ws.close()
  }
})

test('10, 11 e 12: encerramento sem/com autorização e preservação de replanejamento e histórico', async () => {
  const { mission, proposal } = createPendingProposal('Replan e encerramento')
  const { ws, sendAndWait } = await openAuthedWs()
  try {
    // Replanejamento (kind: 'replan') autorizado após plano inicial aprovado
    plans.decide(proposal.id, proposal.revision, 'approve', { feedback: '' })
    tasks.updateMission(mission.id, { phase: 'planning' })
    const replan = plans.propose(mission.id, 'architect', makeProposalInput({ kind: 'replan', objective: 'Plano revisado.', teamChanges: [], steps: [{ key: 'impl2', agentId: 'dev', mode: 'implement', objective: 'Revisar endpoint.', dependsOn: [], inputs: [] }] }), 'adjust_requested')
    const replanConsent = await issueMissionConsent({
      action: 'approve',
      missionId: mission.id,
      proposalId: replan.id,
      revision: replan.revision,
    })
    assert.equal(replanConsent.status, 200)
    const replanRes = await sendAndWait(
      { type: 'proposal-decide', missionId: mission.id, proposalId: replan.id, revision: replan.revision, decision: 'approve', opId: 'op-replan-ok', consentNonce: replanConsent.data.nonce },
      'proposal-result',
      (m) => m.opId === 'op-replan-ok',
    )
    assert.equal(replanRes.ok, true, replanRes.message)
    try { team.cancel(mission.id) } catch {}

    // Coloca missão em awaiting_decision para testar mission-close
    tasks.updateMission(mission.id, { phase: 'awaiting_decision' })

    // 11: encerramento sem autorização falha
    const closeDenied = await sendAndWait({ type: 'mission-close', missionId: mission.id }, 'notice')
    assert.match(closeDenied.message, /Autorização humana obrigatória/)
    assert.equal(tasks.getMission(mission.id)?.phase, 'awaiting_decision')

    // 10: encerramento com autorização nativa passa
    const closeConsent = await issueMissionConsent({ action: 'close', missionId: mission.id })
    assert.equal(closeConsent.status, 200)
    ws.send(JSON.stringify({ type: 'mission-close', missionId: mission.id, consentNonce: closeConsent.data.nonce }))
    for (let i = 0; i < 40 && tasks.getMission(mission.id)?.phase !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 15))
    }
    assert.equal(tasks.getMission(mission.id)?.phase, 'done')

    // 12: histórico/observabilidade preservado e sem segredos/nonces
    const recorded = events.list({ projectId, missionId: mission.id })
    assert.ok(recorded.some((e) => e.type === 'approval.received'))
    assert.ok(recorded.some((e) => e.type === 'plan.revised'))
    assert.ok(recorded.some((e) => e.type === 'mission.completed'))
    const serialized = JSON.stringify(recorded)
    assert.equal(serialized.includes(DESKTOP_SECRET), false)
    assert.equal(serialized.includes(replanConsent.data.nonce!), false)
    assert.equal(serialized.includes(closeConsent.data.nonce!), false)
  } finally {
    ws.close()
  }
})
