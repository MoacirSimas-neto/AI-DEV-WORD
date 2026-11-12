import type {
  ArtifactRef,
  DynamicProposal,
  DynamicProposalInput,
  PlannedStepInput,
  ProposalErrorCode,
  ProposalRejection,
  TeamChange,
} from '../../../shared/protocol.ts'
import { KEY_PATTERN as STEP_KEY, type PlanContext, validateProposal } from './coordinator.ts'

// Leitura da resposta do Tech Lead. O texto do modelo é dado não confiável: só vira proposta o que
// estiver no bloco, no formato exato. Nada aqui grava, aprova ou executa.

export const PROPOSAL_SCHEMA_VERSION = 1
export const PROPOSAL_OPEN = '<<<PROPOSTA'
export const PROPOSAL_CLOSE = 'PROPOSTA>>>'
export const MAX_PROPOSAL_CHARS = 20_000
/** Respostas inválidas seguidas que o Tech Lead pode corrigir antes de a missão esperar o usuário. */
export const MAX_INVALID_PROPOSALS = 1

const BLOCK = /<<<PROPOSTA([\s\S]*?)PROPOSTA>>>/g
const MARKER = /<<<PROPOSTA|PROPOSTA>>>/g
const AGENT_ID = /^[\w.:-]{1,80}$/
const MAX_PROBLEMS = 20
const MAX = { text: 2000, objective: 1000, item: 500, steps: 50, teamChanges: 20, items: 10, refs: 20 }

/** Tira os delimitadores de um texto alheio: um resultado de agente não pode se passar por proposta. */
export const stripProposalMarkers = (text: string) => text.replace(MARKER, '')

export type ProposalReading =
  | { ok: true; input: DynamicProposalInput; /** Revisão do plano sobre a qual o Tech Lead trabalhou. */ baseRevision: number }
  | ({ ok: false } & ProposalRejection)

const reject = (code: ProposalErrorCode, ...problems: string[]): ProposalReading => ({ ok: false, code, problems })

/** Extrai e confere o bloco de proposta. Qualquer desvio do formato recusa a resposta inteira. */
export function parseProposal(response: string): ProposalReading {
  if (typeof response !== 'string') return reject('missing', 'A resposta não é um texto.')
  const blocks = [...response.matchAll(BLOCK)]
  const opened = response.split(PROPOSAL_OPEN).length - 1
  if (blocks.length === 0) {
    return reject('missing', opened > 0 ? 'O bloco de proposta não foi fechado: a resposta parece incompleta.' : 'A resposta não traz o bloco de proposta.')
  }
  if (blocks.length > 1 || opened > 1) return reject('duplicate', 'A resposta traz mais de um bloco de proposta: não dá para saber qual vale.')
  const body = blocks[0][1].trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  if (body.length > MAX_PROPOSAL_CHARS) return reject('too_long', `A proposta tem ${body.length} caracteres (máximo ${MAX_PROPOSAL_CHARS}).`)

  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch (error) {
    return reject('invalid_json', `O bloco de proposta não é um JSON válido: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300))
  }
  if (!isObject(raw)) return reject('invalid_schema', 'A proposta precisa ser um objeto JSON.')
  if (raw.schemaVersion !== PROPOSAL_SCHEMA_VERSION) {
    return reject('unsupported_version', `Versão do formato não suportada: ${JSON.stringify(raw.schemaVersion) ?? 'ausente'} (esperado ${PROPOSAL_SCHEMA_VERSION}).`)
  }

  const problems: string[] = []
  const root = fields(raw, 'proposta', ROOT_FIELDS, problems)
  const kind = oneOf(root.kind, 'kind', ['plan', 'replan', 'closure'] as const, problems)
  const baseRevision = Number.isInteger(root.baseRevision) && (root.baseRevision as number) >= 0 ? (root.baseRevision as number) : null
  if (baseRevision === null) problems.push('"baseRevision" precisa ser um inteiro maior ou igual a zero.')

  const input: DynamicProposalInput = {
    kind: kind ?? 'plan',
    objective: text(root.objective, 'objective', MAX.objective, problems),
    reason: text(root.reason, 'reason', MAX.text, problems),
    missionState: text(root.missionState, 'missionState', MAX.text, problems),
    alternative: text(root.alternative, 'alternative', MAX.text, problems),
    teamChanges: list(root.teamChanges, 'teamChanges', MAX.teamChanges, problems).map((item, i) => teamChange(item, `teamChanges[${i}]`, problems)),
    steps: list(root.steps, 'steps', MAX.steps, problems).map((item, i) => step(item, `steps[${i}]`, problems)),
    sharedContext: list(root.sharedContext, 'sharedContext', MAX.refs, problems).map((item, i) => artifact(item, `sharedContext[${i}]`, problems)),
    risks: list(root.risks, 'risks', MAX.items, problems).map((item, i) => text(item, `risks[${i}]`, MAX.item, problems)),
    completionCriteria: list(root.completionCriteria, 'completionCriteria', MAX.items, problems).map((item, i) => text(item, `completionCriteria[${i}]`, MAX.item, problems)),
  }
  if (kind === 'plan' && input.completionCriteria.length === 0) problems.push('O plano inicial precisa de pelo menos um critério de conclusão em "completionCriteria".')

  if (problems.length) return reject('invalid_schema', ...problems.slice(0, MAX_PROBLEMS))
  return { ok: true, input, baseRevision: baseRevision! }
}

/**
 * Lê a resposta e a confere contra a missão: revisão vigente, propostas já vistas pelo usuário,
 * equipe, permissões, dependências e limites. Só o que passa aqui pode ser mostrado para aprovação.
 */
export function interpretProposal(response: string, ctx: PlanContext): ProposalReading {
  const reading = parseProposal(response)
  if (!reading.ok) return reading
  const current = ctx.proposals.reduce((max, p) => Math.max(max, p.revision), 0)
  if (reading.baseRevision !== current) {
    return reject('stale_revision', `A proposta foi feita sobre a revisão ${reading.baseRevision}, mas a missão está na revisão ${current}.`)
  }
  const signature = proposalSignature(reading.input)
  const seen = ctx.proposals.find((p) => SEEN.has(p.status) && proposalSignature(p) === signature)
  if (seen) {
    return reject('duplicate_proposal', `Esta proposta é igual à da revisão ${seen.revision}, que o usuário já recebeu (${seen.status}).`)
  }
  const problems = validateProposal(reading.input, ctx)
  return problems.length ? reject('rejected_by_rules', ...problems.slice(0, MAX_PROBLEMS)) : reading
}

const SEEN = new Set<DynamicProposal['status']>(['pending', 'rejected', 'adjust_requested'])

/** O que a proposta faz, sem os textos explicativos: reescrever a justificativa não a torna outra proposta. */
function proposalSignature(p: Pick<DynamicProposalInput, 'kind' | 'teamChanges' | 'steps'>): string {
  return JSON.stringify([
    p.kind,
    p.teamChanges.map((c) => [c.action, c.agentId]).sort(),
    p.steps.map((s) => [s.key, s.agentId, s.mode, s.objective.toLowerCase().replace(/\s+/g, ' ').trim(), [...s.dependsOn].sort()]),
  ])
}

// ---------- formato (schemaVersion 1) ----------
// Cada objeto é reconstruído campo a campo: nada que o modelo escreveu além destes nomes segue adiante.

const ROOT_FIELDS = ['schemaVersion', 'kind', 'baseRevision', 'objective', 'reason', 'missionState', 'alternative', 'teamChanges', 'steps', 'sharedContext', 'risks', 'completionCriteria']
const TEAM_CHANGE_FIELDS = ['action', 'agentId', 'reason', 'task', 'context', 'expectedImpact', 'alternative']
const STEP_FIELDS = ['key', 'agentId', 'mode', 'objective', 'dependsOn', 'inputs']

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Confere que é um objeto só com os campos do formato, todos presentes. */
function fields(value: unknown, at: string, allowed: string[], problems: string[], optional: string[] = []): Record<string, unknown> {
  if (!isObject(value)) {
    problems.push(`"${at}" precisa ser um objeto.`)
    return {}
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) problems.push(`Campo não permitido em "${at}": "${key.slice(0, 60)}". Permissões, limites e aprovações não fazem parte da proposta.`)
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key) && !optional.includes(key)) problems.push(`Falta o campo "${key}" em "${at}".`)
  }
  return value
}

function text(value: unknown, at: string, max: number, problems: string[], required = true): string {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string') {
    problems.push(`"${at}" precisa ser um texto.`)
    return ''
  }
  const clean = value.trim()
  if (required && !clean) problems.push(`"${at}" não pode ficar vazio.`)
  if (clean.length > max) problems.push(`"${at}" tem ${clean.length} caracteres (máximo ${max}).`)
  return clean.slice(0, max)
}

function list(value: unknown, at: string, max: number, problems: string[]): unknown[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) problems.push(`"${at}" precisa ser uma lista.`)
    return []
  }
  if (value.length > max) problems.push(`"${at}" tem ${value.length} itens (máximo ${max}).`)
  return value.slice(0, max)
}

function oneOf<T extends string>(value: unknown, at: string, options: readonly T[], problems: string[]): T | null {
  if (typeof value === 'string' && (options as readonly string[]).includes(value)) return value as T
  problems.push(`"${at}" precisa ser um destes: ${options.join(', ')}.`)
  return null
}

function id(value: unknown, at: string, pattern: RegExp, problems: string[]): string {
  if (typeof value === 'string' && pattern.test(value)) return value
  problems.push(`"${at}" não é um identificador válido.`)
  return ''
}

function teamChange(value: unknown, at: string, problems: string[]): TeamChange {
  const raw = fields(value, at, TEAM_CHANGE_FIELDS, problems, ['task', 'context'])
  const action = oneOf(raw.action, `${at}.action`, ['convene', 'release'] as const, problems) ?? 'convene'
  const convening = action === 'convene'
  return {
    action,
    agentId: id(raw.agentId, `${at}.agentId`, AGENT_ID, problems),
    reason: text(raw.reason, `${at}.reason`, MAX.text, problems),
    task: text(raw.task, `${at}.task`, MAX.objective, problems, convening),
    context: text(raw.context, `${at}.context`, MAX.objective, problems, convening),
    expectedImpact: text(raw.expectedImpact, `${at}.expectedImpact`, MAX.objective, problems),
    alternative: text(raw.alternative, `${at}.alternative`, MAX.objective, problems),
  }
}

function step(value: unknown, at: string, problems: string[]): PlannedStepInput {
  const raw = fields(value, at, STEP_FIELDS, problems)
  return {
    key: id(raw.key, `${at}.key`, STEP_KEY, problems),
    agentId: id(raw.agentId, `${at}.agentId`, AGENT_ID, problems),
    mode: oneOf(raw.mode, `${at}.mode`, ['analyze', 'implement', 'review', 'verify'] as const, problems) ?? 'analyze',
    objective: text(raw.objective, `${at}.objective`, MAX.objective, problems),
    dependsOn: list(raw.dependsOn, `${at}.dependsOn`, MAX.refs, problems).map((dep, i) => id(dep, `${at}.dependsOn[${i}]`, STEP_KEY, problems)),
    inputs: list(raw.inputs, `${at}.inputs`, MAX.refs, problems).map((ref, i) => artifact(ref, `${at}.inputs[${i}]`, problems)),
  }
}

function artifact(value: unknown, at: string, problems: string[]): ArtifactRef {
  const kind = isObject(value) ? value.kind : undefined
  if (kind === 'plan' || kind === 'git-diff') {
    fields(value, at, ['kind'], problems)
    return { kind }
  }
  if (kind !== 'step') {
    problems.push(`"${at}.kind" precisa ser um destes: plan, git-diff, step.`)
    return { kind: 'plan' }
  }
  const raw = fields(value, at, ['kind', 'key', 'revision'], problems, ['revision'])
  const key = id(raw.key, `${at}.key`, STEP_KEY, problems)
  if (raw.revision === undefined) return { kind: 'step', key }
  if (!Number.isInteger(raw.revision) || (raw.revision as number) < 1) problems.push(`"${at}.revision" precisa ser um inteiro maior que zero.`)
  return { kind: 'step', key, revision: raw.revision as number }
}
