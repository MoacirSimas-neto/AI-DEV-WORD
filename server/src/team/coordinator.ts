import type {
  ArtifactRef,
  DelegationMode,
  DynamicLimits,
  DynamicMissionState,
  DynamicProposal,
  DynamicProposalInput,
  MissionPhase,
  PlannedStep,
  PlannedStepInput,
  ProposalDecision,
  ProposalStatus,
  RoleCategory,
  StepStatus,
  TeamChange,
} from '../../../shared/protocol.ts'

// Regras do modo dinâmico, sem banco e sem CLI: o que é válido, o que pode rodar e quando parar.
// Tudo que vem do Tech Lead passa por aqui antes de chegar ao usuário ou à execução.

// ---------- limites ----------

export const DEFAULT_LIMITS: DynamicLimits = {
  maxSteps: 12,
  maxTeamChanges: 4,
  maxActiveMembers: 6,
  maxReworkRounds: 3,
  maxCallsPerAgent: 5,
  maxTechLeadTurns: 8,
  maxSameConsult: 2,
  maxAdjustRounds: 2,
}
/** Maior valor aceito numa configuração. Barra erro de digitação; não é regra de produto e pode subir. */
export const LIMIT_CEILING: DynamicLimits = {
  maxSteps: 200,
  maxTeamChanges: 50,
  maxActiveMembers: 50,
  maxReworkRounds: 20,
  maxCallsPerAgent: 50,
  maxTechLeadTurns: 100,
  maxSameConsult: 10,
  maxAdjustRounds: 10,
}
const ZERO_ALLOWED = new Set<keyof DynamicLimits>(['maxTeamChanges', 'maxReworkRounds', 'maxAdjustRounds'])

/** Limites de uma missão: os padrões, com os ajustes pedidos. Lança se algum ajuste for inválido. */
export function resolveLimits(input: unknown = {}): DynamicLimits {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Limites inválidos: esperado um objeto.')
  const limits = { ...DEFAULT_LIMITS }
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key)) throw new Error(`Limite desconhecido: "${key}".`)
    const name = key as keyof DynamicLimits
    const min = ZERO_ALLOWED.has(name) ? 0 : 1
    if (!Number.isInteger(value) || value < min || value > LIMIT_CEILING[name]) {
      throw new Error(`Limite "${name}" inválido: use um inteiro de ${min} a ${LIMIT_CEILING[name]}.`)
    }
    limits[name] = value
  }
  return limits
}

/** Consumo de uma missão. Só contagens reais: os CLIs não informam tokens nem custo. */
export interface Usage {
  steps: number
  teamChanges: number
  activeMembers: number
  reworkRounds: number
  techLeadTurns: number
  adjustRound: number
  callsByAgent: Record<string, number>
  /** Chave: agente + modo + objetivo normalizado. */
  sameConsult: Record<string, number>
}

export interface LimitHit {
  limit: keyof DynamicLimits
  value: number
  max: number
}

const consultKey = (s: Pick<PlannedStepInput, 'agentId' | 'mode' | 'objective'>) =>
  `${s.agentId}:${s.mode}:${s.objective.toLowerCase().replace(/\s+/g, ' ').trim()}`

/** `steps` = os passos que contam (o chamador escolhe: iniciados, ou iniciados + planejados). */
export function usageOf(
  steps: Pick<PlannedStepInput, 'agentId' | 'mode' | 'objective'>[],
  proposals: Pick<DynamicProposal, 'kind' | 'status' | 'teamChanges' | 'revision' | 'adjustRound'>[],
  techLeadId: string,
): Usage {
  const callsByAgent: Record<string, number> = {}
  const sameConsult: Record<string, number> = {}
  for (const s of steps) {
    callsByAgent[s.agentId] = (callsByAgent[s.agentId] ?? 0) + 1
    sameConsult[consultKey(s)] = (sameConsult[consultKey(s)] ?? 0) + 1
  }
  const last = proposals.reduce<(typeof proposals)[number] | null>((a, p) => (!a || p.revision > a.revision ? p : a), null)
  return {
    steps: steps.length,
    // A equipe inicial (proposta `plan`) não é mudança de equipe.
    teamChanges: proposals.filter((p) => p.status === 'approved' && p.kind === 'replan').reduce((n, p) => n + p.teamChanges.length, 0),
    activeMembers: teamOf(techLeadId, proposals).length,
    reworkRounds: Math.max(0, steps.filter((s) => s.mode === 'verify').length - 1),
    techLeadTurns: proposals.length,
    adjustRound: last?.adjustRound ?? 0,
    callsByAgent,
    sameConsult,
  }
}

/** Limites ultrapassados; vazio = dentro de todos. */
export function checkLimits(limits: DynamicLimits, usage: Usage): LimitHit[] {
  const pairs: [keyof DynamicLimits, number][] = [
    ['maxSteps', usage.steps],
    ['maxTeamChanges', usage.teamChanges],
    ['maxActiveMembers', usage.activeMembers],
    ['maxReworkRounds', usage.reworkRounds],
    ['maxTechLeadTurns', usage.techLeadTurns],
    ['maxAdjustRounds', usage.adjustRound],
    ['maxCallsPerAgent', Math.max(0, ...Object.values(usage.callsByAgent))],
    ['maxSameConsult', Math.max(0, ...Object.values(usage.sameConsult))],
  ]
  return pairs.filter(([limit, value]) => value > limits[limit]).map(([limit, value]) => ({ limit, value, max: limits[limit] }))
}

// ---------- máquina de estados ----------

// `done` só sai de uma espera humana: encerrar uma missão dinâmica exige confirmação do usuário.
const TRANSITIONS: Record<DynamicMissionState, readonly DynamicMissionState[]> = {
  planning: ['awaiting_clarification', 'awaiting_approval', 'awaiting_decision', 'failed', 'cancelled'],
  awaiting_clarification: ['planning', 'failed', 'cancelled'],
  awaiting_approval: ['executing', 'planning', 'awaiting_decision', 'done', 'failed', 'cancelled'],
  executing: ['planning', 'awaiting_decision', 'failed', 'cancelled'],
  awaiting_decision: ['executing', 'planning', 'done', 'failed', 'cancelled'],
  done: [],
  failed: [],
  cancelled: [],
}

/** Vale só para missões dinâmicas; fases clássicas (developing, reviewing) nunca são aceitas. */
export function canTransition(from: MissionPhase, to: MissionPhase): boolean {
  return Object.hasOwn(TRANSITIONS, from) && (TRANSITIONS[from as DynamicMissionState] as readonly string[]).includes(to)
}

export function assertTransition(from: MissionPhase, to: MissionPhase) {
  if (!canTransition(from, to)) throw new Error(`Transição inválida no modo dinâmico: ${from} → ${to}.`)
}

/** Depois de um reinício: fases com CLI rodando viram espera por decisão humana; nada é relançado sozinho. */
export function recoveredPhase(phase: MissionPhase): MissionPhase {
  return phase === 'planning' || phase === 'executing' ? 'awaiting_decision' : phase
}

const STEP_TRANSITIONS: Record<StepStatus, readonly StepStatus[]> = {
  approved: ['running', 'cancelled', 'superseded'],
  running: ['completed', 'failed', 'interrupted', 'cancelled'],
  completed: [],
  failed: [],
  interrupted: [],
  cancelled: [],
  superseded: [],
}

export const canStepTransition = (from: StepStatus, to: StepStatus) => STEP_TRANSITIONS[from]?.includes(to) ?? false

// ---------- decisões humanas ----------

export const DECISION_STATUS: Record<ProposalDecision, ProposalStatus> = {
  approve: 'approved',
  reject: 'rejected',
  adjust: 'adjust_requested',
}

/**
 * apply = a decisão vale; duplicate = a mesma decisão já foi aplicada (repetição inofensiva);
 * stale = a proposta já não é a que o usuário viu, ou já teve outra decisão.
 */
export function checkDecision(
  proposal: Pick<DynamicProposal, 'revision' | 'status'>,
  revision: number,
  decision: ProposalDecision,
): 'apply' | 'duplicate' | 'stale' {
  if (proposal.revision !== revision) return 'stale'
  if (proposal.status === 'pending') return 'apply'
  return proposal.status === DECISION_STATUS[decision] ? 'duplicate' : 'stale'
}

/** Para onde a missão vai depois da decisão. Rejeitar nunca dispara um CLI novo por conta própria. */
export function phaseAfterDecision(kind: DynamicProposal['kind'], decision: ProposalDecision, hasRunnableSteps: boolean): DynamicMissionState {
  if (decision === 'adjust') return 'planning'
  if (decision === 'approve') return kind === 'closure' ? 'done' : hasRunnableSteps ? 'executing' : 'awaiting_decision'
  return hasRunnableSteps ? 'executing' : 'awaiting_decision'
}

/** Rodada de ajuste da próxima proposta: cresce enquanto o usuário pede ajustes em sequência. */
export function nextAdjustRound(proposals: Pick<DynamicProposal, 'revision' | 'status' | 'adjustRound'>[]): number {
  const last = proposals.reduce<(typeof proposals)[number] | null>((a, p) => (!a || p.revision > a.revision ? p : a), null)
  return last?.status === 'adjust_requested' ? last.adjustRound + 1 : 0
}

// ---------- equipe ----------

/** Equipe ativa: o Tech Lead mais o que as propostas APROVADAS convocaram e não dispensaram. */
export function teamOf(techLeadId: string, proposals: Pick<DynamicProposal, 'status' | 'revision' | 'teamChanges'>[]): string[] {
  const team = new Set([techLeadId])
  for (const p of proposals.filter((p) => p.status === 'approved').sort((a, b) => a.revision - b.revision)) {
    for (const change of p.teamChanges) {
      if (change.action === 'convene') team.add(change.agentId)
      else team.delete(change.agentId)
    }
  }
  return [...team]
}

/** Vezes que uma mudança de equipe rejeitada pode voltar com necessidade nova. Depois disso, não volta nesta missão. */
export const MAX_REJECTED_RETRIES = 1

/** Propostas rejeitadas que traziam a mesma mudança de equipe (mesma ação, mesmo agente). */
export function rejectedBefore<P extends Pick<DynamicProposal, 'status' | 'teamChanges'>>(change: Pick<TeamChange, 'action' | 'agentId'>, proposals: P[]): P[] {
  return proposals.filter((p) => p.status === 'rejected' && p.teamChanges.some((c) => c.action === change.action && c.agentId === change.agentId))
}

const normalized = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
/** O que identifica o pedido: a tarefa (convocação) ou o motivo (dispensa). */
const subject = (c: TeamChange) => normalized(c.action === 'convene' ? c.task : c.reason)

/**
 * Mudança de equipe que o usuário já rejeitou só volta se for outro pedido E algo novo tiver acontecido:
 * objetivo diferente do rejeitado, pelo menos um passo terminado depois da rejeição, e no máximo
 * MAX_REJECTED_RETRIES vezes. A decisão continua sendo humana; isto só impede a insistência.
 */
function repeatProblem(change: TeamChange, ctx: PlanContext): string | null {
  const rejected = rejectedBefore(change, ctx.proposals)
  if (rejected.length === 0) return null
  const id = change.agentId
  if (rejected.length > MAX_REJECTED_RETRIES) {
    return `O usuário já rejeitou esta mudança de equipe para "${id}" ${rejected.length} vezes nesta missão: ela não pode ser proposta de novo.`
  }
  const same = rejected.some((p) => p.teamChanges.some((c) => c.action === change.action && c.agentId === id && subject(c) === subject(change)))
  if (same) return `O usuário já rejeitou esta mudança de equipe para "${id}" com o mesmo objetivo.`
  const since = rejected.reduce((latest, p) => (p.decidedAt && p.decidedAt > latest ? p.decidedAt : latest), '')
  const news = ctx.steps.some((s) => ['completed', 'failed', 'interrupted'].includes(s.status) && s.finishedAt !== null && s.finishedAt > since)
  return news ? null : `O usuário já rejeitou esta mudança de equipe para "${id}" e nenhum passo terminou desde então: não há contexto novo.`
}

// ---------- validação de propostas ----------

/** O que o coordenador precisa saber de um agente do cadastro (AgentConfig serve). */
export interface KnownAgent {
  agentId: string
  roleCategory?: RoleCategory
  active?: boolean
}

// Quem grava e quem dá veredito é decidido aqui, pela categoria do agente no cadastro.
const MODE_CATEGORIES: Record<DelegationMode, readonly RoleCategory[] | null> = {
  analyze: null,
  review: null,
  implement: ['developing'],
  verify: ['reviewing'],
}

export function modeAllowed(mode: DelegationMode, category: RoleCategory | undefined): boolean {
  if (!Object.hasOwn(MODE_CATEGORIES, mode)) return false
  const allowed = MODE_CATEGORIES[mode]
  return allowed === null || (category !== undefined && allowed.includes(category))
}

export interface PlanContext {
  techLeadId: string
  /** Cadastro de agentes. */
  agents: KnownAgent[]
  /** Passos e propostas que a missão já tem. */
  steps: PlannedStep[]
  proposals: DynamicProposal[]
  limits: DynamicLimits
}

export const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/
const MAX_OBJECTIVE = 1000
const MAX_TEXT = 2000
const text = (value: unknown, max = MAX_TEXT) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const usable = (agents: KnownAgent[], id: string) => agents.find((a) => a.agentId === id && a.active !== false)

/** Problemas dos passos, em texto para o Tech Lead corrigir; vazio = válidos. `team` = equipe que vai executá-los. */
export function validateSteps(steps: PlannedStepInput[], agents: KnownAgent[], team: string[], existing: PlannedStep[] = []): string[] {
  const problems: string[] = []
  const keys = new Set<string>()
  for (const step of steps) {
    const at = `Passo "${String(step.key)}"`
    if (typeof step.key !== 'string' || !KEY_PATTERN.test(step.key)) problems.push(`${at}: chave inválida (use letras minúsculas, números, - e _).`)
    else if (keys.has(step.key)) problems.push(`${at}: chave repetida.`)
    keys.add(step.key)
    const agent = typeof step.agentId === 'string' ? usable(agents, step.agentId) : undefined
    if (!agent) problems.push(`${at}: o agente "${String(step.agentId)}" não existe ou está inativo.`)
    else if (!team.includes(agent.agentId)) problems.push(`${at}: o agente "${agent.agentId}" não faz parte da equipe (proponha a convocação).`)
    if (!Object.hasOwn(MODE_CATEGORIES, step.mode)) problems.push(`${at}: modo "${String(step.mode)}" desconhecido.`)
    else if (agent && !modeAllowed(step.mode, agent.roleCategory)) {
      problems.push(`${at}: o modo "${step.mode}" não é permitido para o agente "${agent.agentId}" (categoria ${agent.roleCategory ?? 'indefinida'}).`)
    }
    if (!text(step.objective, MAX_OBJECTIVE)) problems.push(`${at}: objetivo vazio ou maior que ${MAX_OBJECTIVE} caracteres.`)
    if (!Array.isArray(step.dependsOn) || !Array.isArray(step.inputs)) problems.push(`${at}: dependências e entradas precisam ser listas.`)
  }
  if (problems.length) return problems

  for (const step of steps) {
    const at = `Passo "${step.key}"`
    for (const dep of step.dependsOn) {
      if (dep === step.key) problems.push(`${at}: depende de si mesmo.`)
      else if (!keys.has(dep)) problems.push(`${at}: depende de "${String(dep)}", que não existe nesta proposta.`)
    }
    for (const ref of step.inputs) problems.push(...inputProblems(ref, step, existing).map((p) => `${at}: ${p}`))
  }
  if (problems.length) return problems

  // Ciclos: remove quem não tem dependência pendente até não sobrar ninguém removível.
  const pending = new Map(steps.map((s) => [s.key, new Set(s.dependsOn)]))
  for (let removed = true; removed; ) {
    removed = false
    for (const [key, deps] of pending) {
      if (deps.size > 0) continue
      pending.delete(key)
      for (const other of pending.values()) other.delete(key)
      removed = true
    }
  }
  if (pending.size > 0) problems.push(`Dependência circular entre os passos: ${[...pending.keys()].join(', ')}.`)
  return problems
}

function inputProblems(ref: ArtifactRef, step: PlannedStepInput, existing: PlannedStep[]): string[] {
  if (ref?.kind === 'plan' || ref?.kind === 'git-diff') return []
  if (ref?.kind !== 'step' || typeof ref.key !== 'string') return ['entrada desconhecida.']
  if (ref.revision === undefined) {
    // O resultado só existe se o passo de origem terminar antes.
    return step.dependsOn.includes(ref.key) ? [] : [`usa o resultado de "${ref.key}" sem depender dele.`]
  }
  const source = existing.find((s) => s.revision === ref.revision && s.key === ref.key)
  return source?.status === 'completed' ? [] : [`usa o resultado de "${ref.key}" (revisão ${ref.revision}), que não existe ou não foi concluído.`]
}

/** Problemas de uma proposta do Tech Lead; vazio = pode ir para a aprovação humana. */
export function validateProposal(input: DynamicProposalInput, ctx: PlanContext): string[] {
  const problems: string[] = []
  if (!['plan', 'replan', 'closure'].includes(input?.kind)) return ['Tipo de proposta desconhecido.']
  if (!Array.isArray(input.teamChanges) || !Array.isArray(input.steps) || !Array.isArray(input.sharedContext)) {
    return ['Mudanças de equipe, passos e contexto compartilhado precisam ser listas.']
  }
  if (!text(input.reason)) problems.push('Falta a justificativa da proposta.')
  if (!text(input.missionState)) problems.push('Falta o estado atual da missão.')
  if (!text(input.alternative)) problems.push('Falta a alternativa de seguir sem esta proposta.')

  const hasPlan = ctx.proposals.some((p) => p.kind === 'plan' && p.status === 'approved')
  if (input.kind === 'plan' && hasPlan) problems.push('A missão já tem um plano aprovado: proponha um replanejamento.')
  if (input.kind !== 'plan' && !hasPlan) problems.push('Ainda não há plano aprovado: a primeira proposta precisa ser o plano.')
  if (input.kind === 'closure') {
    if (input.steps.length || input.teamChanges.length) problems.push('Uma recomendação de encerramento não traz passos nem mudanças de equipe.')
    return problems
  }
  if (!input.steps.length && !input.teamChanges.length) problems.push('A proposta não muda nada: inclua passos ou mudanças de equipe.')

  const team = new Set(teamOf(ctx.techLeadId, ctx.proposals))
  const changed = new Set<string>()
  for (const change of input.teamChanges) {
    const id = String(change?.agentId)
    if (change?.action !== 'convene' && change?.action !== 'release') {
      problems.push(`Mudança de equipe desconhecida para "${id}".`)
      continue
    }
    if (changed.has(id)) problems.push(`O agente "${id}" aparece em mais de uma mudança de equipe.`)
    changed.add(id)
    if (!text(change.reason)) problems.push(`Falta o motivo da mudança de equipe de "${id}".`)
    const repeated = repeatProblem(change, ctx)
    if (repeated) problems.push(repeated)
    if (change.action === 'convene') {
      if (!usable(ctx.agents, id)) problems.push(`O agente "${id}" não existe ou está inativo.`)
      else if (team.has(id)) problems.push(`O agente "${id}" já faz parte da equipe.`)
      if (!text(change.task)) problems.push(`Falta a tarefa pretendida para "${id}".`)
      team.add(id)
    } else {
      if (id === ctx.techLeadId) problems.push('O Tech Lead não pode ser dispensado da missão.')
      else if (!team.has(id)) problems.push(`O agente "${id}" não faz parte da equipe.`)
      team.delete(id)
    }
  }

  problems.push(...validateSteps(input.steps, ctx.agents, [...team], ctx.steps))
  if (problems.length) return problems

  // Projeção: o que já rodou + o que esta proposta traz. Passos aprovados e não iniciados só
  // continuam valendo se a proposta não trouxer passos (ver PlanStore.decide).
  const counted = [...ctx.steps.filter((s) => s.startedAt !== null || (!input.steps.length && s.status === 'approved')), ...input.steps]
  const projected = [
    ...ctx.proposals,
    { kind: input.kind, status: 'approved' as const, teamChanges: input.teamChanges, revision: Infinity, adjustRound: nextAdjustRound(ctx.proposals) },
  ]
  for (const hit of checkLimits(ctx.limits, usageOf(counted, projected, ctx.techLeadId))) {
    problems.push(`Limite da missão ultrapassado: ${hit.limit} = ${hit.value} (máximo ${hit.max}).`)
  }
  return problems
}

// ---------- execução (sequencial) ----------

/** Papel de execução de cada modo (getStepCliAndArgs): é daqui que saem as permissões do CLI, nunca da proposta. */
export const MODE_STEP_ROLE = { analyze: 'analyzing', implement: 'developing', review: 'reviewing', verify: 'reviewing' } as const

export interface StepBlocker {
  reason: 'not_eligible' | 'agent_unavailable' | 'not_in_team' | 'mode_not_allowed' | 'limit_reached'
  message: string
}

/** Conferência feita na hora de executar: o mundo pode ter mudado desde a aprovação. null = pode rodar. */
export function stepBlocker(step: PlannedStep, ctx: PlanContext): StepBlocker | null {
  if (!eligibleSteps(ctx.steps).some((s) => s.id === step.id)) {
    return { reason: 'not_eligible', message: 'o passo não está aprovado ou depende de passos que não terminaram.' }
  }
  const agent = usable(ctx.agents, step.agentId)
  if (!agent) return { reason: 'agent_unavailable', message: `o agente "${step.agentId}" está inativo ou com o CLI indisponível.` }
  if (!teamOf(ctx.techLeadId, ctx.proposals).includes(step.agentId)) {
    return { reason: 'not_in_team', message: `o agente "${step.agentId}" não faz parte da equipe aprovada.` }
  }
  if (!modeAllowed(step.mode, agent.roleCategory)) {
    return { reason: 'mode_not_allowed', message: `o modo "${step.mode}" não é permitido para o agente "${step.agentId}" (categoria ${agent.roleCategory ?? 'indefinida'}).` }
  }
  const started = ctx.steps.filter((s) => s.startedAt !== null)
  const hits = checkLimits(ctx.limits, usageOf([...started, step], ctx.proposals, ctx.techLeadId))
  if (hits.length) return { reason: 'limit_reached', message: `limite da missão atingido: ${hits.map((h) => `${h.limit} = ${h.value} (máximo ${h.max})`).join(', ')}.` }
  return null
}

const stepRef = (revision: number, key: string) => `${revision}:${key}`

/**
 * Passos que podem começar agora, em ordem: aprovados e com todas as dependências concluídas.
 * Vazio enquanto houver um passo rodando: a execução é um passo por vez.
 */
export function eligibleSteps(steps: PlannedStep[]): PlannedStep[] {
  if (steps.some((s) => s.status === 'running')) return []
  const done = new Set(steps.filter((s) => s.status === 'completed').map((s) => stepRef(s.revision, s.key)))
  return steps
    .filter((s) => s.status === 'approved' && s.dependsOn.every((dep) => done.has(stepRef(s.revision, dep))))
    .sort((a, b) => a.revision - b.revision || a.seq - b.seq)
}

export const nextStep = (steps: PlannedStep[]): PlannedStep | null => eligibleSteps(steps)[0] ?? null

/**
 * running = há um passo em execução; ready = há passo elegível; blocked = restam passos aprovados
 * mas nenhum pode rodar (uma dependência falhou); empty = não resta nada aprovado.
 */
export function planStatus(steps: PlannedStep[]): 'running' | 'ready' | 'blocked' | 'empty' {
  if (steps.some((s) => s.status === 'running')) return 'running'
  if (eligibleSteps(steps).length) return 'ready'
  return steps.some((s) => s.status === 'approved') ? 'blocked' : 'empty'
}
