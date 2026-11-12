import { stepRef, teamOf } from '../../../shared/dynamicPlan.ts'
import type {
  ClientMessage,
  DelegationMode,
  DynamicLimits,
  DynamicProposal,
  EvidenceKind,
  MissionEvent,
  MissionInfo,
  MissionPhase,
  PlannedStep,
  ProposalDecision,
  ProposalKind,
  ProposalStatus,
  ResumeAction,
  StepStatus,
} from '../../../shared/protocol.ts'

// Modelo de visão do modo dinâmico: só funções puras sobre o que o backend enviou.
// Nada aqui decide permissões nem estados; a tela apenas mostra o que está gravado.

export const MODE_LABEL: Record<DelegationMode, { label: string; hint: string }> = {
  analyze: { label: 'Análise', hint: 'sem escrita' },
  review: { label: 'Revisão', hint: 'sem escrita' },
  implement: { label: 'Implementação', hint: 'grava arquivos no projeto' },
  verify: { label: 'Verificação', hint: 'sem escrita · emite veredito' },
}

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  approved: 'Aprovado',
  running: 'Em execução',
  completed: 'Concluído',
  failed: 'Falhou',
  interrupted: 'Interrompido',
  cancelled: 'Cancelado',
  superseded: 'Substituído',
}

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  pending: 'Aguardando sua decisão',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  adjust_requested: 'Ajustes pedidos',
  superseded: 'Substituída',
}

export const KIND_LABEL: Record<ProposalKind, string> = {
  plan: 'Plano inicial',
  replan: 'Replanejamento',
  closure: 'Recomendação de encerramento',
}

/** Por que o Tech Lead foi consultado (replan.triggered → data.trigger). */
export const TRIGGER_LABEL: Record<string, string> = {
  start: 'Início da missão',
  verdict_rejected: 'A verificação não aprovou o trabalho',
  step_blocked: 'Um agente relatou bloqueio',
  risk_flagged: 'Um agente apontou um risco',
  step_failed: 'Um passo falhou',
  cli_unavailable: 'CLI indisponível ou sem cota',
  dependency_failed: 'Uma dependência não foi concluída',
  queue_empty: 'Todos os passos aprovados terminaram',
  user_request: 'Pedido do usuário',
  limit_reached: 'Limite da missão atingido',
  adjust_requested: 'Ajustes pedidos pelo usuário',
  invalid_proposal: 'Proposta anterior recusada pelo backend',
  interrupted_execution: 'Execução interrompida pelo fechamento do app',
}

/** Por que a missão parou (mission.blocked → data.reason). */
export const BLOCK_REASON_LABEL: Record<string, string> = {
  interrupted: 'O app foi fechado durante a execução',
  dirty_repo: 'Há alterações no repositório que a missão não registrou',
  limit_reached: 'Um limite da missão foi atingido',
  invalid_proposal: 'O Tech Lead não entregou uma proposta válida',
  proposal_rejected: 'Proposta rejeitada sem passo aprovado para seguir',
  failure: 'Falha de execução',
  error: 'Erro interno',
  agent_unavailable: 'Agente indisponível',
  not_in_team: 'Agente fora da equipe aprovada',
  mode_not_allowed: 'Modo de execução não permitido para o agente',
  not_eligible: 'Passo não elegível',
  dependency_failed: 'Uma dependência não foi concluída',
  queue_empty: 'Fila de passos terminou',
  verdict_rejected: 'A verificação não aprovou o trabalho',
}

export const DYNAMIC_PHASE_LABEL: Partial<Record<MissionPhase, string>> = {
  planning: 'Tech Lead analisando',
  awaiting_clarification: 'Aguardando sua resposta',
  awaiting_approval: 'Proposta aguardando sua decisão',
  executing: 'Executando passos aprovados',
  awaiting_decision: 'Parada · aguardando sua decisão',
  done: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
}

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  observed: 'Observado pelo sistema',
  declared: 'Declarado pelo agente',
  context: 'Incluído no contexto',
  unavailable: 'Não disponível',
}

/** Rótulo legível de cada tipo de evento da trilha. */
export const EVENT_LABEL: Record<string, string> = {
  'mission.started': 'Missão iniciada',
  'mission.completed': 'Missão encerrada',
  'mission.cancelled': 'Missão cancelada',
  'mission.failed': 'Missão falhou',
  'mission.blocked': 'Missão parada para decisão',
  'mission.resumed': 'Decisão de retomada',
  'agent.selected': 'Agente selecionado',
  'skills.configured': 'Skills configuradas',
  'skill.included': 'Skill incluída no prompt',
  'skill.failed': 'Skill não aplicada',
  'memory.included': 'Memória incluída',
  'task.delegated': 'Passo delegado',
  'result.forwarded': 'Resultado encaminhado',
  'result.declared': 'Resultado declarado',
  'plan.produced': 'Plano produzido',
  'verdict.declared': 'Veredito declarado',
  'tests.declared': 'Testes declarados',
  'tests.executed': 'Testes executados pelo sistema',
  'files.changed': 'Arquivos alterados',
  'cli.started': 'CLI iniciado',
  'cli.finished': 'CLI terminou',
  'approval.requested': 'Aprovação solicitada',
  'approval.received': 'Decisão humana',
  'clarification.requested': 'Esclarecimento solicitado',
  'clarification.received': 'Esclarecimento respondido',
  'proposal.declared': 'Proposta do Tech Lead',
  'proposal.invalid': 'Proposta recusada pelo backend',
  'team.joined': 'Agente convocado',
  'team.released': 'Agente dispensado',
  'plan.revised': 'Plano revisado',
  'step.started': 'Passo iniciado',
  'step.finished': 'Passo terminou',
  'step.interrupted': 'Passo interrompido',
  'replan.triggered': 'Replanejamento',
  'limit.reached': 'Limite atingido',
  'closure.recommended': 'Encerramento recomendado',
  'log.truncated': 'Trilha cortada',
}

/** Tipos da coordenação dinâmica, para o filtro da observabilidade. */
export const COORDINATION_EVENTS = new Set([
  'proposal.declared',
  'proposal.invalid',
  'approval.requested',
  'approval.received',
  'team.joined',
  'team.released',
  'plan.revised',
  'task.delegated',
  'step.started',
  'step.finished',
  'step.interrupted',
  'cli.started',
  'result.forwarded',
  'replan.triggered',
  'mission.blocked',
  'mission.resumed',
  'limit.reached',
  'closure.recommended',
  'mission.completed',
])

// ---------- plano ----------

export interface StepGroups {
  running: PlannedStep[]
  /** Aprovados com dependências concluídas. */
  ready: PlannedStep[]
  /** Aprovados esperando dependências que ainda podem terminar. */
  waiting: PlannedStep[]
  /** Aprovados que dependem de um passo que falhou, foi interrompido ou cancelado. */
  blocked: PlannedStep[]
  completed: PlannedStep[]
  /** Falhou, interrompido ou cancelado (a última tentativa de cada passo). */
  stopped: PlannedStep[]
  /** Substituídos por um replanejamento: só histórico. */
  superseded: PlannedStep[]
}

export function groupSteps(steps: PlannedStep[]): StepGroups {
  // Um passo pode ter várias tentativas: vale a mais recente de cada (revisão, chave).
  const latest = new Map<string, PlannedStep>()
  for (const s of steps) {
    const current = latest.get(stepRef(s.revision, s.key))
    if (!current || (s.attempt ?? 1) >= (current.attempt ?? 1)) latest.set(stepRef(s.revision, s.key), s)
  }
  const last = [...latest.values()]
  const statusOf = (revision: number, key: string) => latest.get(stepRef(revision, key))?.status
  const groups: StepGroups = { running: [], ready: [], waiting: [], blocked: [], completed: [], stopped: [], superseded: [] }
  for (const s of last) {
    if (s.status === 'running') groups.running.push(s)
    else if (s.status === 'completed') groups.completed.push(s)
    else if (s.status === 'superseded') groups.superseded.push(s)
    else if (s.status !== 'approved') groups.stopped.push(s)
    else {
      const deps = s.dependsOn.map((d) => statusOf(s.revision, d))
      if (deps.every((d) => d === 'completed')) groups.ready.push(s)
      else if (deps.some((d) => d === 'failed' || d === 'interrupted' || d === 'cancelled')) groups.blocked.push(s)
      else groups.waiting.push(s)
    }
  }
  return groups
}

/** Passos do plano vigente (sem os substituídos), na ordem lógica. */
export const currentPlanSteps = (steps: PlannedStep[]) => {
  const g = groupSteps(steps)
  return [...g.completed, ...g.running, ...g.ready, ...g.waiting, ...g.blocked, ...g.stopped].sort((a, b) => a.revision - b.revision || a.seq - b.seq)
}

export function teamView(techLeadId: string, proposals: DynamicProposal[]): { active: string[]; released: string[] } {
  const active = teamOf(techLeadId, proposals)
  const released = new Set<string>()
  for (const p of proposals.filter((p) => p.status === 'approved')) {
    for (const c of p.teamChanges) if (c.action === 'release' && !active.includes(c.agentId)) released.add(c.agentId)
  }
  return { active, released: [...released] }
}

export interface ProposalImpact {
  joins: string[]
  leaves: string[]
  /** Passos aprovados que ainda não começaram e deixam de valer se a proposta for aprovada. */
  replaced: PlannedStep[]
  /** Passos aprovados que continuam valendo. */
  kept: PlannedStep[]
  closes: boolean
}

/** O que muda se o usuário aprovar. Segue a regra do backend (PlanStore.decide). */
export function proposalImpact(proposal: Pick<DynamicProposal, 'kind' | 'teamChanges' | 'steps'>, steps: PlannedStep[]): ProposalImpact {
  const notStarted = steps.filter((s) => s.status === 'approved')
  const replaces = proposal.steps.length > 0
  return {
    joins: proposal.teamChanges.filter((c) => c.action === 'convene').map((c) => c.agentId),
    leaves: proposal.teamChanges.filter((c) => c.action === 'release').map((c) => c.agentId),
    replaced: replaces ? notStarted : [],
    kept: replaces ? [] : notStarted,
    closes: proposal.kind === 'closure',
  }
}

export const pendingProposal = (proposals: DynamicProposal[]) => proposals.find((p) => p.status === 'pending') ?? null

/** Objetivo vigente: o da última proposta aprovada; sem ela, o da pendente. */
export function currentObjective(proposals: DynamicProposal[]): string {
  const approved = proposals.filter((p) => p.status === 'approved' && p.kind !== 'closure').at(-1)
  return approved?.objective || pendingProposal(proposals)?.objective || ''
}

export interface LimitRow {
  key: keyof DynamicLimits
  label: string
  used: number
  max: number
}

/** Uso real contado do que está gravado. Sem custo nem tokens: os CLIs não informam. */
export function limitRows(mission: Pick<MissionInfo, 'leadTurns' | 'limits' | 'plannerId'>, steps: PlannedStep[], proposals: DynamicProposal[]): LimitRow[] {
  const limits = mission.limits
  if (!limits) return []
  const counted = steps.filter((s) => s.startedAt !== null || s.status === 'approved').length
  const rework = proposals.filter((p) => p.status === 'approved' && p.kind === 'replan' && p.trigger === 'verdict_rejected').length
  const changes = proposals.filter((p) => p.status === 'approved' && p.kind === 'replan').reduce((n, p) => n + p.teamChanges.length, 0)
  const members = teamOf(mission.plannerId || 'architect', proposals).length
  return [
    { key: 'maxTechLeadTurns', label: 'Turnos do Tech Lead', used: Math.max(mission.leadTurns ?? 0, proposals.length), max: limits.maxTechLeadTurns },
    { key: 'maxSteps', label: 'Passos delegados', used: counted, max: limits.maxSteps },
    { key: 'maxReworkRounds', label: 'Rodadas de retrabalho', used: rework, max: limits.maxReworkRounds },
    { key: 'maxTeamChanges', label: 'Mudanças de equipe', used: changes, max: limits.maxTeamChanges },
    { key: 'maxActiveMembers', label: 'Membros ativos', used: members, max: limits.maxActiveMembers },
  ]
}

// ---------- eventos ----------

/** O gatilho mais recente que levou o Tech Lead a ser consultado, se for posterior à última decisão. */
export function latestTrigger(events: MissionEvent[]): MissionEvent | null {
  return events.findLast((e) => e.type === 'replan.triggered') ?? null
}

/** Encaminhamentos de contexto entre dois agentes (para o indicador no escritório). */
export function agentForwards(events: MissionEvent[]): { id: number; from: string; to: string }[] {
  return events
    .filter((e) => e.type === 'result.forwarded' && typeof e.data.from === 'string' && typeof e.data.to === 'string' && e.data.from !== 'system' && e.data.from !== e.data.to)
    .map((e) => ({ id: e.id, from: e.data.from as string, to: e.data.to as string }))
}

/** Junta eventos vindos da lista e ao vivo, sem repetir e na ordem dos ids. */
export function mergeEvents(current: MissionEvent[], incoming: MissionEvent[]): MissionEvent[] {
  const byId = new Map(current.map((e) => [e.id, e]))
  for (const e of incoming) byId.set(e.id, e)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

// ---------- mensagens (protocolo real de shared/protocol.ts) ----------

export const newOpId = () => (globalThis.crypto?.randomUUID?.() ?? `op-${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, '')

export const startMessage = (taskId: number, mode: 'pipeline' | 'dynamic', plannerId?: string): ClientMessage =>
  mode === 'dynamic' ? { type: 'mission-start', taskId, mode: 'dynamic', ...(plannerId ? { team: { plannerId } } : {}) } : { type: 'mission-start', taskId }

export function decisionMessage(proposal: Pick<DynamicProposal, 'id' | 'missionId' | 'revision'>, decision: ProposalDecision, opId: string, feedback?: string): ClientMessage {
  const text = feedback?.trim()
  return { type: 'proposal-decide', missionId: proposal.missionId, proposalId: proposal.id, revision: proposal.revision, decision, opId, ...(text ? { feedback: text.slice(0, 5000) } : {}) }
}

export function resumeMessage(
  missionId: number,
  action: ResumeAction,
  opId: string,
  options: { stepId?: number; detail?: string; acceptChanges?: boolean; acceptFiles?: string[] } = {},
): ClientMessage {
  const detail = options.detail?.trim()
  return {
    type: 'mission-resume',
    missionId,
    action,
    opId,
    ...(options.stepId !== undefined ? { stepId: options.stepId } : {}),
    ...(detail ? { detail: detail.slice(0, 2000) } : {}),
    // O aceite sempre leva a lista que o usuário viu; o backend recusa o que estiver fora dela.
    ...(options.acceptChanges ? { acceptChanges: true, acceptFiles: [...(options.acceptFiles ?? [])] } : {}),
  }
}

/**
 * Uma operação por vez: enquanto o backend não responde ao opId pendente, novos cliques não enviam nada.
 * O backend também é idempotente; isto só evita envios repetidos.
 */
export class OpGate {
  private pending: string | null = null

  get busy() {
    return this.pending !== null
  }

  /** opId novo, ou null se já há uma operação esperando resposta. */
  begin(): string | null {
    if (this.pending) return null
    this.pending = newOpId()
    return this.pending
  }

  /** true se a resposta é da operação pendente (e a libera). */
  settle(opId: string): boolean {
    if (opId !== this.pending) return false
    this.pending = null
    return true
  }

  /** Libera sem resposta (ex.: conexão caiu): o backend continua protegido pelo opId e pela revisão. */
  reset() {
    this.pending = null
  }
}
