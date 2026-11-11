import type { MemoryCategory, MemoryContextRecord, MemoryEntry, MissionInfo, TaskInfo } from '../../../shared/protocol.ts'
import { stems } from '../agents/specializations.ts'
import { CATEGORY_LABEL } from './store.ts'

/**
 * Teto de caracteres de memória por prompt. Pequeno de propósito: o prompt do
 * Antigravity vai na linha de comando (limite de ~30 mil no Windows) e já
 * carrega plano, parecer e conhecimento.
 */
export const MEMORY_BUDGET = 3000
// Valem para o projeto inteiro: nunca são cortadas para dar lugar ao resto.
const MANDATORY = new Set<MemoryCategory>(['decision', 'requirement', 'architecture'])
const MAX_PAST_MISSIONS = 2
const PAST_REVIEW_CHARS = 300
// Sem ligação com a tarefa, cada etapa só recebe o que serve à sua função.
const STAGE_FOCUS: Record<MemoryStage, Set<MemoryCategory>> = {
  planning: new Set(['problem', 'solution']),
  developing: new Set(['problem', 'solution', 'qa_result']),
  reviewing: new Set(['problem', 'solution', 'qa_result']),
}

export type MemoryStage = 'planning' | 'developing' | 'reviewing'

export interface MemoryContextInput {
  /** Memórias aprovadas que este agente pode ver (MemoryStore.currentFor). */
  entries: MemoryEntry[]
  task: TaskInfo
  /** Missões anteriores e já encerradas da mesma tarefa, mais recentes primeiro. */
  pastMissions: MissionInfo[]
  /** Etapa do agente; sem ela, problemas, soluções e QA entram para qualquer um. */
  stage?: MemoryStage
  budget?: number
}

/**
 * Escolhe o que este agente precisa lembrar nesta tarefa, por prioridade:
 * 1. decisões, requisitos e arquitetura do projeto (obrigatórias);
 * 2. memórias que citam termos da tarefa;
 * 3. resultado das últimas missões da mesma tarefa (lido de `missions`);
 * 4. problemas, soluções e resultados de QA;
 * 5. aprendizados só quando ligados à tarefa.
 * Devolve o bloco para o prompt e o registro do que entrou, do que ficou de fora e por quê.
 */
export function buildMemoryContext(input: MemoryContextInput): { block: string; record: MemoryContextRecord } {
  const budget = input.budget ?? MEMORY_BUDGET
  const taskStems = stems(`${input.task.title}\n${input.task.description}`)
  const record: MemoryContextRecord = { chars: 0, selected: [], dropped: [] }
  const lines: string[] = []
  let used = 0

  const line = (m: MemoryEntry) => `- [${CATEGORY_LABEL[m.category]} #${m.id}${m.scope === 'agent' ? ', sua memória individual' : ''}] ${m.content}`
  const relevance = (m: MemoryEntry) => {
    const own = stems(m.content)
    let hits = 0
    for (const s of taskStems) if (own.has(s)) hits++
    return hits
  }
  const take = (text: string, id: number | null, category: MemoryCategory, reason: string) => {
    lines.push(text)
    used += text.length + 1
    record.selected.push({ id, category, reason })
  }

  // 1. Obrigatórias: se não couberem, a missão para com erro em vez de trabalhar sem elas.
  const mandatory = input.entries.filter((m) => m.scope === 'team' && MANDATORY.has(m.category))
  const mandatoryChars = mandatory.reduce((sum, m) => sum + line(m).length + 1, 0)
  if (mandatoryChars > budget) {
    throw new Error(
      `As decisões, requisitos e arquitetura aprovados deste projeto somam ${mandatoryChars} caracteres e não cabem no orçamento de memória do prompt (${budget}). Condense ou substitua memórias na Central de Memória antes de iniciar a missão.`,
    )
  }
  for (const m of mandatory) take(line(m), m.id, m.category, 'obrigatória do projeto')

  const optional = input.entries
    .filter((m) => !mandatory.includes(m))
    .map((m) => ({ m, hits: relevance(m) }))
    .sort((a, b) => b.hits - a.hits || b.m.id - a.m.id)
  const tryTake = (m: MemoryEntry, reason: string) => {
    const text = line(m)
    if (used + text.length + 1 > budget) {
      record.dropped.push({ id: m.id, category: m.category, reason: 'sem espaço no orçamento de contexto' })
      return
    }
    take(text, m.id, m.category, reason)
  }

  // 2. Ligadas à tarefa.
  for (const { m, hits } of optional) if (hits > 0) tryTake(m, `cita ${hits} termo(s) da tarefa`)

  // 3. Histórico recente da mesma tarefa, direto de `missions` (sem cópia).
  for (const past of input.pastMissions.slice(0, MAX_PAST_MISSIONS)) {
    const outcome = past.verdictDetail ?? (past.phase === 'cancelled' ? 'cancelada' : 'sem veredito')
    const excerpt = past.review ? ` Parecer do QA: ${past.review.replace(/\s+/g, ' ').slice(0, PAST_REVIEW_CHARS)}…` : ''
    const text = `- [Missão anterior #${past.id} desta mesma tarefa] Resultado: ${outcome}.${past.error ? ` ${past.error.split('\n')[0]}` : ''}${excerpt}`
    if (used + text.length + 1 <= budget) take(text, null, 'qa_result', `missão #${past.id} anterior da mesma tarefa`)
    else record.dropped.push({ id: null, category: 'qa_result', reason: `missão #${past.id} anterior: sem espaço no orçamento de contexto` })
  }

  // 4 e 5. Sem ligação direta com a tarefa: só o foco da etapa, se sobrar espaço; aprendizados não.
  const focus = input.stage ? STAGE_FOCUS[input.stage] : STAGE_FOCUS.developing
  for (const { m, hits } of optional) {
    if (hits > 0) continue
    if (m.category === 'learning') record.dropped.push({ id: m.id, category: m.category, reason: 'aprendizado sem relação com a tarefa' })
    else if (!focus.has(m.category)) record.dropped.push({ id: m.id, category: m.category, reason: 'fora do foco desta etapa' })
    else tryTake(m, 'problema/solução conhecido do projeto')
  }

  record.chars = used
  if (lines.length === 0) return { block: '', record }
  const block = [
    '## Memória do projeto (aprovada pelo usuário)',
    'Estes registros são a versão atual e prevalecem sobre suposições suas. Não contrarie uma decisão listada; se ela impedir a tarefa, diga isso no relatório.',
    ...lines,
  ].join('\n')
  return { block, record }
}
