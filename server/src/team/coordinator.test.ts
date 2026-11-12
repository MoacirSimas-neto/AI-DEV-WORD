import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DynamicProposal, DynamicProposalInput, MissionPhase, PlannedStep, PlannedStepInput } from '../../../shared/protocol.ts'
import {
  canStepTransition,
  canTransition,
  assertTransition,
  checkDecision,
  checkLimits,
  DEFAULT_LIMITS,
  eligibleSteps,
  LIMIT_CEILING,
  modeAllowed,
  nextAdjustRound,
  nextStep,
  phaseAfterDecision,
  planStatus,
  type PlanContext,
  recoveredPhase,
  resolveLimits,
  teamOf,
  usageOf,
  validateProposal,
  validateSteps,
} from './coordinator.ts'

const AGENTS = [
  { agentId: 'architect', roleCategory: 'planning' as const },
  { agentId: 'dev', roleCategory: 'developing' as const },
  { agentId: 'qa', roleCategory: 'reviewing' as const },
  { agentId: 'dados', roleCategory: 'developing' as const },
  { agentId: 'seguranca', roleCategory: 'reviewing' as const },
  { agentId: 'aposentado', roleCategory: 'developing' as const, active: false },
]

const step = (key: string, agentId: string, mode: PlannedStepInput['mode'], dependsOn: string[] = [], extra: Partial<PlannedStepInput> = {}): PlannedStepInput => ({
  key,
  agentId,
  mode,
  objective: `Objetivo de ${key}`,
  dependsOn,
  inputs: [],
  ...extra,
})

const planned = (input: PlannedStepInput, status: PlannedStep['status'], seq: number, revision = 1): PlannedStep => ({
  ...input,
  id: revision * 100 + seq,
  missionId: 1,
  projectId: 1,
  proposalId: revision,
  revision,
  seq,
  status,
  startedAt: status === 'approved' || status === 'superseded' ? null : '2026-01-01T00:00:00.000Z',
  finishedAt: null,
  result: '',
  error: null,
  correlationId: null,
})

const convene = (agentId: string) => ({ action: 'convene' as const, agentId, reason: 'Competência necessária', task: 'Apoiar a missão', expectedImpact: 'Menos retrabalho', context: 'Plano e tarefa', alternative: 'Seguir sem o agente' })

const proposal = (input: Partial<DynamicProposalInput>): DynamicProposalInput => ({
  kind: 'plan',
  objective: 'Entregar a tarefa.',
  reason: 'A tarefa pede estas competências.',
  missionState: 'Missão recém-criada.',
  alternative: 'Seguir só com o Dev.',
  teamChanges: [],
  steps: [],
  sharedContext: [{ kind: 'plan' }],
  risks: [],
  completionCriteria: ['Testes passando.'],
  ...input,
})

const stored = (input: DynamicProposalInput, revision: number, status: DynamicProposal['status'], adjustRound = 0): DynamicProposal => ({
  ...input,
  id: revision,
  missionId: 1,
  projectId: 1,
  revision,
  status,
  author: 'architect',
  adjustRound,
  createdAt: '2026-01-01T00:00:00.000Z',
  decidedAt: null,
  decidedBy: null,
  feedback: null,
})

const ctx = (extra: Partial<PlanContext> = {}): PlanContext => ({ techLeadId: 'architect', agents: AGENTS, steps: [], proposals: [], limits: DEFAULT_LIMITS, ...extra })

const initialPlan = proposal({
  teamChanges: [convene('dev'), convene('qa')],
  steps: [step('impl', 'dev', 'implement'), step('teste', 'qa', 'verify', ['impl'], { inputs: [{ kind: 'step', key: 'impl' }, { kind: 'git-diff' }] })],
})
const approvedPlan = stored(initialPlan, 1, 'approved')

// ---------- limites ----------

test('limites: padrões do planejamento, ajustes válidos e recusa do que é inválido', () => {
  assert.deepEqual(resolveLimits(), DEFAULT_LIMITS)
  assert.deepEqual(resolveLimits({ maxSteps: 30, maxActiveMembers: 20 }), { ...DEFAULT_LIMITS, maxSteps: 30, maxActiveMembers: 20 })
  assert.equal(resolveLimits({ maxReworkRounds: 0 }).maxReworkRounds, 0)
  // Não devolve o objeto padrão: alterar o resultado não contamina as próximas missões.
  resolveLimits().maxSteps = 999
  assert.equal(DEFAULT_LIMITS.maxSteps, 12)

  assert.throws(() => resolveLimits({ maxSteps: 0 }), /maxSteps/)
  assert.throws(() => resolveLimits({ maxSteps: 2.5 }), /maxSteps/)
  assert.throws(() => resolveLimits({ maxSteps: '12' }), /maxSteps/)
  assert.throws(() => resolveLimits({ maxSteps: LIMIT_CEILING.maxSteps + 1 }), /maxSteps/)
  assert.throws(() => resolveLimits({ maxTokens: 1000 }), /desconhecido/)
  assert.throws(() => resolveLimits(JSON.parse('{"__proto__": 1}')), /desconhecido/)
  assert.throws(() => resolveLimits([]), /objeto/)
  assert.throws(() => resolveLimits(null), /objeto/)
})

test('limites: o consumo é contado dos passos e propostas reais e cada excesso é nomeado', () => {
  const steps = [
    step('a', 'dev', 'implement'),
    step('b', 'qa', 'verify'),
    step('c', 'dev', 'implement', [], { objective: '  Objetivo   de A ' }),
    step('d', 'qa', 'verify'),
    step('e', 'dev', 'implement', [], { objective: 'Outro objetivo' }),
  ]
  const replan = stored(proposal({ kind: 'replan', teamChanges: [convene('dados')] }), 2, 'approved')
  const usage = usageOf(steps, [approvedPlan, replan, stored(proposal({ kind: 'replan', teamChanges: [convene('seguranca')] }), 3, 'rejected')], 'architect')
  assert.equal(usage.steps, 5)
  assert.equal(usage.callsByAgent.dev, 3)
  assert.equal(usage.reworkRounds, 1)
  // A equipe inicial não conta; a convocação rejeitada também não.
  assert.equal(usage.teamChanges, 1)
  assert.equal(usage.techLeadTurns, 3)
  assert.equal(usage.activeMembers, 4)
  assert.equal(Math.max(...Object.values(usage.sameConsult)), 2)

  assert.deepEqual(checkLimits(DEFAULT_LIMITS, usage), [])
  const tight = resolveLimits({ maxSteps: 4, maxCallsPerAgent: 2, maxSameConsult: 1, maxReworkRounds: 0, maxTeamChanges: 0, maxActiveMembers: 3, maxTechLeadTurns: 2 })
  assert.deepEqual(
    checkLimits(tight, usage).map((h) => h.limit).sort(),
    ['maxActiveMembers', 'maxCallsPerAgent', 'maxReworkRounds', 'maxSameConsult', 'maxSteps', 'maxTeamChanges', 'maxTechLeadTurns'],
  )
  assert.deepEqual(checkLimits(tight, usage).find((h) => h.limit === 'maxSteps'), { limit: 'maxSteps', value: 5, max: 4 })
})

// ---------- máquina de estados ----------

test('estados: transições permitidas do modo dinâmico', () => {
  const allowed: [MissionPhase, MissionPhase][] = [
    ['planning', 'awaiting_clarification'],
    ['awaiting_clarification', 'planning'],
    ['planning', 'awaiting_approval'],
    ['awaiting_approval', 'executing'],
    ['awaiting_approval', 'planning'],
    ['awaiting_approval', 'done'],
    ['executing', 'planning'],
    ['executing', 'awaiting_decision'],
    ['awaiting_decision', 'executing'],
    ['awaiting_decision', 'planning'],
    ['awaiting_decision', 'done'],
  ]
  for (const [from, to] of allowed) assert.ok(canTransition(from, to), `${from} → ${to}`)
  // Cancelar e falhar valem em qualquer fase aberta.
  for (const from of ['planning', 'awaiting_clarification', 'awaiting_approval', 'executing', 'awaiting_decision'] as const) {
    assert.ok(canTransition(from, 'cancelled'), `${from} → cancelled`)
    assert.ok(canTransition(from, 'failed'), `${from} → failed`)
  }
})

test('estados: transições proibidas', () => {
  // Encerrar exige confirmação humana: nunca direto de uma fase em que só o sistema age.
  assert.equal(canTransition('executing', 'done'), false)
  assert.equal(canTransition('planning', 'done'), false)
  // Nada roda sem passar pela aprovação.
  assert.equal(canTransition('planning', 'executing'), false)
  assert.equal(canTransition('awaiting_clarification', 'executing'), false)
  // Fases finais não reabrem.
  for (const from of ['done', 'failed', 'cancelled'] as const) {
    for (const to of ['planning', 'executing', 'awaiting_approval', 'cancelled', 'done'] as const) assert.equal(canTransition(from, to), false, `${from} → ${to}`)
  }
  // As fases do fluxo clássico não existem no modo dinâmico.
  assert.equal(canTransition('developing', 'reviewing'), false)
  assert.equal(canTransition('awaiting_approval', 'developing'), false)
  assert.equal(canTransition('executing', 'reviewing'), false)
  assert.equal(canTransition('constructor' as MissionPhase, 'done'), false)
  assert.throws(() => assertTransition('executing', 'done'), /executing → done/)
  assert.doesNotThrow(() => assertTransition('awaiting_approval', 'executing'))
})

test('estados: reinício do app leva fases com CLI rodando à decisão humana e preserva as demais', () => {
  assert.equal(recoveredPhase('planning'), 'awaiting_decision')
  assert.equal(recoveredPhase('executing'), 'awaiting_decision')
  for (const phase of ['awaiting_approval', 'awaiting_clarification', 'awaiting_decision', 'done', 'failed', 'cancelled'] as const) {
    assert.equal(recoveredPhase(phase), phase)
  }
  assert.ok(canTransition('planning', recoveredPhase('planning')))
  assert.ok(canTransition('executing', recoveredPhase('executing')))
})

test('estados dos passos: só aprovado começa e só rodando termina', () => {
  assert.ok(canStepTransition('approved', 'running'))
  assert.ok(canStepTransition('approved', 'superseded'))
  assert.ok(canStepTransition('running', 'completed'))
  assert.ok(canStepTransition('running', 'interrupted'))
  assert.equal(canStepTransition('approved', 'completed'), false)
  assert.equal(canStepTransition('superseded', 'running'), false)
  assert.equal(canStepTransition('failed', 'running'), false)
  assert.equal(canStepTransition('completed', 'approved'), false)
})

// ---------- decisões ----------

test('decisão: vale para a pendente, repetição é inofensiva e a atrasada é obsoleta', () => {
  assert.equal(checkDecision({ revision: 2, status: 'pending' }, 2, 'approve'), 'apply')
  assert.equal(checkDecision({ revision: 2, status: 'approved' }, 2, 'approve'), 'duplicate')
  assert.equal(checkDecision({ revision: 2, status: 'rejected' }, 2, 'reject'), 'duplicate')
  // Outra decisão sobre a mesma proposta, proposta substituída ou revisão diferente da que o usuário viu.
  assert.equal(checkDecision({ revision: 2, status: 'rejected' }, 2, 'approve'), 'stale')
  assert.equal(checkDecision({ revision: 2, status: 'superseded' }, 2, 'approve'), 'stale')
  assert.equal(checkDecision({ revision: 3, status: 'pending' }, 2, 'approve'), 'stale')
})

test('decisão: próxima fase da missão', () => {
  assert.equal(phaseAfterDecision('plan', 'approve', true), 'executing')
  assert.equal(phaseAfterDecision('replan', 'approve', false), 'awaiting_decision')
  assert.equal(phaseAfterDecision('closure', 'approve', false), 'done')
  assert.equal(phaseAfterDecision('closure', 'approve', true), 'done')
  assert.equal(phaseAfterDecision('replan', 'adjust', true), 'planning')
  // Rejeitar segue o plano vigente; sem plano, espera o usuário em vez de chamar um CLI.
  assert.equal(phaseAfterDecision('replan', 'reject', true), 'executing')
  assert.equal(phaseAfterDecision('closure', 'reject', false), 'awaiting_decision')
  assert.equal(phaseAfterDecision('plan', 'reject', false), 'awaiting_decision')
})

test('decisão: a rodada de ajuste cresce só enquanto os pedidos são seguidos', () => {
  assert.equal(nextAdjustRound([]), 0)
  assert.equal(nextAdjustRound([{ revision: 1, status: 'adjust_requested', adjustRound: 0 }]), 1)
  assert.equal(nextAdjustRound([{ revision: 2, status: 'adjust_requested', adjustRound: 1 }, { revision: 1, status: 'adjust_requested', adjustRound: 0 }]), 2)
  assert.equal(nextAdjustRound([{ revision: 1, status: 'adjust_requested', adjustRound: 0 }, { revision: 2, status: 'approved', adjustRound: 1 }]), 0)
})

// ---------- equipe e permissões ----------

test('equipe: só propostas aprovadas mudam a composição, em ordem de revisão', () => {
  assert.deepEqual(teamOf('architect', []), ['architect'])
  const release = stored(proposal({ kind: 'replan', teamChanges: [{ ...convene('qa'), action: 'release' }, convene('dados')] }), 2, 'approved')
  const pending = stored(proposal({ kind: 'replan', teamChanges: [convene('seguranca')] }), 3, 'pending')
  assert.deepEqual(teamOf('architect', [pending, release, approvedPlan]).sort(), ['architect', 'dados', 'dev'])
})

test('permissões: só categoria developing implementa e só reviewing dá veredito', () => {
  assert.ok(modeAllowed('implement', 'developing'))
  assert.equal(modeAllowed('implement', 'reviewing'), false)
  assert.equal(modeAllowed('implement', 'planning'), false)
  assert.equal(modeAllowed('implement', undefined), false)
  assert.ok(modeAllowed('verify', 'reviewing'))
  assert.equal(modeAllowed('verify', 'developing'), false)
  for (const category of ['planning', 'developing', 'reviewing', 'teaching'] as const) {
    assert.ok(modeAllowed('analyze', category))
    assert.ok(modeAllowed('review', category))
  }
  assert.equal(modeAllowed('sudo' as never, 'developing'), false)
})

// ---------- passos ----------

test('passos: agente inexistente, inativo ou fora da equipe é recusado', () => {
  const team = ['architect', 'dev']
  assert.deepEqual(validateSteps([step('a', 'dev', 'implement')], AGENTS, team), [])
  assert.match(validateSteps([step('a', 'fantasma', 'analyze')], AGENTS, team)[0], /"fantasma" não existe/)
  assert.match(validateSteps([step('a', 'aposentado', 'analyze')], AGENTS, team)[0], /não existe ou está inativo/)
  assert.match(validateSteps([step('a', 'qa', 'verify')], AGENTS, team)[0], /não faz parte da equipe/)
})

test('passos: modo incompatível com a categoria do agente é recusado, venha o que vier no passo', () => {
  const team = ['architect', 'dev', 'qa']
  assert.match(validateSteps([step('a', 'qa', 'implement')], AGENTS, team)[0], /"implement" não é permitido para o agente "qa"/)
  assert.match(validateSteps([step('a', 'architect', 'implement')], AGENTS, team)[0], /não é permitido/)
  assert.match(validateSteps([step('a', 'dev', 'verify')], AGENTS, team)[0], /não é permitido/)
  assert.match(validateSteps([step('a', 'dev', 'root' as never)], AGENTS, team)[0], /desconhecido/)
  // Campos extras vindos do modelo não viram permissão: o passo continua sendo julgado só pelo modo e pela categoria.
  const sneaky = { ...step('a', 'qa', 'implement'), sandbox: 'workspace-write', roleCategory: 'developing' } as PlannedStepInput
  assert.match(validateSteps([sneaky], AGENTS, team)[0], /não é permitido/)
})

test('passos: chaves, objetivo e dependências inexistentes', () => {
  const team = ['architect', 'dev', 'qa']
  assert.match(validateSteps([step('Passo 1', 'dev', 'implement')], AGENTS, team)[0], /chave inválida/)
  assert.match(validateSteps([step('a', 'dev', 'implement'), step('a', 'qa', 'verify')], AGENTS, team)[0], /repetida/)
  assert.match(validateSteps([step('a', 'dev', 'implement', [], { objective: '  ' })], AGENTS, team)[0], /objetivo/)
  assert.match(validateSteps([step('a', 'dev', 'implement', ['nada'])], AGENTS, team)[0], /depende de "nada", que não existe/)
  assert.match(validateSteps([step('a', 'dev', 'implement', ['a'])], AGENTS, team)[0], /depende de si mesmo/)
})

test('passos: dependências circulares são recusadas', () => {
  const team = ['architect', 'dev', 'qa']
  const direct = validateSteps([step('a', 'dev', 'implement', ['b']), step('b', 'qa', 'verify', ['a'])], AGENTS, team)
  assert.match(direct[0], /circular.*a, b/)
  const long = validateSteps(
    [step('inicio', 'dev', 'analyze'), step('a', 'dev', 'implement', ['inicio', 'c']), step('b', 'qa', 'review', ['a']), step('c', 'qa', 'verify', ['b'])],
    AGENTS,
    team,
  )
  assert.match(long[0], /circular/)
  assert.doesNotMatch(long[0], /inicio/)
  // Um losango não é ciclo.
  assert.deepEqual(
    validateSteps([step('a', 'dev', 'analyze'), step('b', 'dev', 'implement', ['a']), step('c', 'qa', 'review', ['a']), step('d', 'qa', 'verify', ['b', 'c'])], AGENTS, team),
    [],
  )
})

test('passos: uma entrada só pode usar resultado que vai existir', () => {
  const team = ['architect', 'dev', 'qa']
  const usesWithoutDep = step('b', 'qa', 'verify', [], { inputs: [{ kind: 'step', key: 'a' }] })
  assert.match(validateSteps([step('a', 'dev', 'implement'), usesWithoutDep], AGENTS, team)[0], /sem depender dele/)
  const old = planned(step('analise', 'dev', 'analyze'), 'completed', 0, 1)
  const failed = planned(step('quebrou', 'dev', 'analyze'), 'failed', 1, 1)
  const fromOld = (key: string) => step('b', 'qa', 'review', [], { inputs: [{ kind: 'step', key, revision: 1 }] })
  assert.deepEqual(validateSteps([fromOld('analise')], AGENTS, team, [old, failed]), [])
  assert.match(validateSteps([fromOld('quebrou')], AGENTS, team, [old, failed])[0], /não foi concluído/)
  assert.match(validateSteps([fromOld('sumiu')], AGENTS, team, [old, failed])[0], /não existe/)
  assert.match(validateSteps([step('b', 'qa', 'review', [], { inputs: [{ kind: 'shell' } as never] })], AGENTS, team)[0], /entrada desconhecida/)
})

test('execução: a ordem segue as dependências, um passo por vez', () => {
  const a = planned(step('a', 'dados', 'analyze'), 'approved', 2)
  const b = planned(step('b', 'dev', 'implement', ['a']), 'approved', 0)
  const c = planned(step('c', 'qa', 'verify', ['b']), 'approved', 1)
  const run = (steps: PlannedStep[]) => eligibleSteps(steps).map((s) => s.key)

  // A ordem lógica (seq) não fura a dependência: `a` vem primeiro mesmo sendo o último da lista.
  assert.deepEqual(run([b, c, a]), ['a'])
  assert.equal(planStatus([a, b, c]), 'ready')
  // Enquanto um passo roda, nenhum outro é elegível.
  assert.deepEqual(run([{ ...a, status: 'running' }, b, c]), [])
  assert.equal(planStatus([{ ...a, status: 'running' }, b, c]), 'running')
  assert.deepEqual(run([{ ...a, status: 'completed' }, b, c]), ['b'])
  assert.deepEqual(run([{ ...a, status: 'completed' }, { ...b, status: 'completed' }, c]), ['c'])
  assert.equal(nextStep([{ ...a, status: 'completed' }, { ...b, status: 'completed' }, { ...c, status: 'completed' }]), null)
  assert.equal(planStatus([{ ...a, status: 'completed' }, { ...b, status: 'completed' }, { ...c, status: 'completed' }]), 'empty')
  // Independentes saem na ordem lógica.
  const x = planned(step('x', 'dev', 'analyze'), 'approved', 1)
  const y = planned(step('y', 'qa', 'review'), 'approved', 0)
  assert.deepEqual(run([x, y]), ['y', 'x'])
})

test('execução: passo não aprovado nunca é elegível e dependência que falhou bloqueia o plano', () => {
  const a = planned(step('a', 'dev', 'implement'), 'approved', 0)
  for (const status of ['superseded', 'cancelled', 'failed', 'interrupted', 'completed', 'running'] as const) {
    assert.deepEqual(eligibleSteps([{ ...a, status }]), [], status)
  }
  const b = planned(step('b', 'qa', 'verify', ['a']), 'approved', 1)
  assert.deepEqual(eligibleSteps([{ ...a, status: 'failed' }, b]), [])
  assert.equal(planStatus([{ ...a, status: 'failed' }, b]), 'blocked')
  // Um passo concluído com a mesma chave em outra revisão não libera a dependência desta.
  const oldA = planned(step('a', 'dev', 'implement'), 'completed', 0, 1)
  const newA = planned(step('a', 'dev', 'implement'), 'failed', 0, 2)
  const newB = planned(step('b', 'qa', 'verify', ['a']), 'approved', 1, 2)
  assert.deepEqual(eligibleSteps([oldA, newA, newB]), [])
})

// ---------- propostas ----------

test('proposta: plano inicial válido passa; campos obrigatórios e tipo são exigidos', () => {
  assert.deepEqual(validateProposal(initialPlan, ctx()), [])
  assert.match(validateProposal(proposal({ ...initialPlan, alternative: '' }), ctx())[0], /alternativa/)
  assert.match(validateProposal(proposal({ ...initialPlan, reason: ' ' }), ctx())[0], /justificativa/)
  assert.deepEqual(validateProposal({ ...initialPlan, kind: 'deploy' as never }, ctx()), ['Tipo de proposta desconhecido.'])
  assert.match(validateProposal({ ...initialPlan, steps: 'tudo' as never }, ctx())[0], /precisam ser listas/)
  assert.match(validateProposal(proposal({}), ctx())[0], /não muda nada/)
  // Sem plano aprovado não há replanejamento nem encerramento; com plano, não há segundo plano inicial.
  assert.match(validateProposal(proposal({ ...initialPlan, kind: 'replan' }), ctx())[0], /primeira proposta precisa ser o plano/)
  assert.match(validateProposal(proposal({ kind: 'closure' }), ctx())[0], /primeira proposta/)
  assert.match(validateProposal(initialPlan, ctx({ proposals: [approvedPlan] }))[0], /já tem um plano aprovado/)
})

test('proposta: mudanças de equipe são conferidas contra o cadastro e a equipe atual', () => {
  const base = ctx({ proposals: [approvedPlan] })
  const replan = (teamChanges: DynamicProposalInput['teamChanges'], steps: PlannedStepInput[] = []) => proposal({ kind: 'replan', teamChanges, steps })
  assert.deepEqual(validateProposal(replan([convene('dados')], [step('modelo', 'dados', 'analyze')]), base), [])
  // Passo para quem não está na equipe e não foi convocado nesta proposta.
  assert.match(validateProposal(replan([], [step('modelo', 'dados', 'analyze')]), base)[0], /não faz parte da equipe/)
  assert.match(validateProposal(replan([convene('fantasma')]), base)[0], /não existe ou está inativo/)
  assert.match(validateProposal(replan([convene('aposentado')]), base)[0], /inativo/)
  assert.match(validateProposal(replan([convene('dev')]), base)[0], /já faz parte/)
  assert.match(validateProposal(replan([{ ...convene('dados'), action: 'release' }]), base)[0], /não faz parte da equipe/)
  assert.match(validateProposal(replan([{ ...convene('architect'), action: 'release' }]), base)[0], /Tech Lead não pode ser dispensado/)
  assert.match(validateProposal(replan([convene('dados'), { ...convene('dados'), action: 'release' }]), base)[0], /mais de uma mudança/)
  assert.match(validateProposal(replan([{ ...convene('dados'), reason: '' }]), base)[0], /motivo/)
  assert.match(validateProposal(replan([{ ...convene('dados'), task: '' }]), base)[0], /tarefa pretendida/)
  assert.match(validateProposal(replan([{ ...convene('dados'), action: 'promote' as never }]), base)[0], /desconhecida/)
  // Quem é dispensado na proposta não recebe passo nela.
  assert.match(validateProposal(replan([{ ...convene('qa'), action: 'release' }], [step('t', 'qa', 'verify')]), base)[0], /não faz parte da equipe/)
})

test('proposta: convocação que o usuário já rejeitou não volta', () => {
  const rejected = stored(proposal({ kind: 'replan', teamChanges: [convene('seguranca')] }), 2, 'rejected')
  const again = proposal({ kind: 'replan', teamChanges: [convene('seguranca')] })
  assert.match(validateProposal(again, ctx({ proposals: [approvedPlan, rejected] }))[0], /já rejeitou/)
  // Uma proposta apenas substituída não bloqueia.
  assert.deepEqual(validateProposal(again, ctx({ proposals: [approvedPlan, { ...rejected, status: 'superseded' }] })), [])
})

test('proposta: encerramento não traz passos nem mudanças', () => {
  const base = ctx({ proposals: [approvedPlan] })
  assert.deepEqual(validateProposal(proposal({ kind: 'closure' }), base), [])
  assert.match(validateProposal(proposal({ kind: 'closure', steps: [step('a', 'dev', 'implement')] }), base)[0], /não traz passos/)
})

test('proposta: limites configuráveis valem na projeção do plano', () => {
  const many = Array.from({ length: 5 }, (_, i) => step(`s${i}`, 'dev', 'analyze', [], { objective: `Analisar módulo ${i}` }))
  const plan = proposal({ teamChanges: [convene('dev')], steps: many })
  assert.deepEqual(validateProposal(plan, ctx()), [])
  assert.match(validateProposal(plan, ctx({ limits: resolveLimits({ maxSteps: 4 }) }))[0], /maxSteps = 5 \(máximo 4\)/)
  assert.match(validateProposal(plan, ctx({ limits: resolveLimits({ maxCallsPerAgent: 4 }) }))[0], /maxCallsPerAgent/)
  // Equipes maiores são configuração, não mudança de código.
  const bigTeam = proposal({ teamChanges: ['dev', 'qa', 'dados', 'seguranca'].map(convene), steps: [step('a', 'dev', 'implement')] })
  assert.match(validateProposal(bigTeam, ctx({ limits: resolveLimits({ maxActiveMembers: 4 }) }))[0], /maxActiveMembers = 5/)
  assert.deepEqual(validateProposal(bigTeam, ctx({ limits: resolveLimits({ maxActiveMembers: 5 }) })), [])

  // O que já rodou conta; o que estava aprovado e será substituído, não.
  const ran = [planned(step('a', 'dev', 'implement'), 'completed', 0), planned(step('b', 'dev', 'analyze'), 'approved', 1)]
  const replan = proposal({ kind: 'replan', steps: [step('c', 'dev', 'implement', [], { objective: 'Corrigir' })] })
  const two = ctx({ proposals: [approvedPlan], steps: ran, limits: resolveLimits({ maxSteps: 2 }) })
  assert.deepEqual(validateProposal(replan, two), [])
  assert.match(validateProposal(replan, { ...two, limits: resolveLimits({ maxSteps: 1 }) })[0], /maxSteps = 2/)
  // Mudanças de equipe depois do plano inicial têm limite próprio.
  const convocation = proposal({ kind: 'replan', teamChanges: [convene('dados')] })
  assert.match(validateProposal(convocation, ctx({ proposals: [approvedPlan], limits: resolveLimits({ maxTeamChanges: 0 }) }))[0], /maxTeamChanges = 1/)
  // Ajustes em sequência e turnos do Tech Lead também.
  const adjusted = [stored(initialPlan, 1, 'adjust_requested', 0), stored(initialPlan, 2, 'adjust_requested', 1)]
  assert.deepEqual(validateProposal(initialPlan, ctx({ proposals: adjusted })), [])
  assert.match(validateProposal(initialPlan, ctx({ proposals: adjusted, limits: resolveLimits({ maxAdjustRounds: 1 }) }))[0], /maxAdjustRounds = 2/)
  assert.match(validateProposal(initialPlan, ctx({ proposals: adjusted, limits: resolveLimits({ maxTechLeadTurns: 2 }) }))[0], /maxTechLeadTurns = 3/)
})
