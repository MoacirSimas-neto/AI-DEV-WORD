import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MemoryEntry, MissionInfo, TaskInfo } from '../../../shared/protocol.ts'
import { buildMemoryContext } from './context.ts'

const task = { id: 1, projectId: 1, title: 'Exportar relatório em PDF', description: 'Gerar relatório mensal de vendas', priority: 'medium', status: 'todo', agentId: null } as TaskInfo

let nextId = 1
const mem = (category: MemoryEntry['category'], content: string, scope: MemoryEntry['scope'] = 'team', agentId: string | null = null) =>
  ({ id: nextId++, projectId: 1, scope, agentId, category, content, status: 'approved', sourceMissionId: null, author: 'user', approvedBy: 'user', supersedesId: null, createdAt: '', updatedAt: '' }) as MemoryEntry

test('obrigatórias sempre entram; depois as ligadas à tarefa; aprendizados sem relação ficam de fora', () => {
  const decision = mem('decision', 'Banco: PostgreSQL 16')
  const related = mem('solution', 'Relatório PDF: usar a biblioteca já instalada pdfkit')
  const unrelatedProblem = mem('problem', 'Login expira cedo demais em Safari')
  const unrelatedLearning = mem('learning', 'Cache do CI precisa ser limpo às sextas', 'agent', 'dev')
  const { block, record } = buildMemoryContext({ entries: [unrelatedLearning, unrelatedProblem, related, decision], task, pastMissions: [], stage: 'developing' })

  assert.ok(block.startsWith('## Memória do projeto'))
  const order = record.selected.map((s) => s.id)
  assert.deepEqual(order, [decision.id, related.id, unrelatedProblem.id])
  assert.ok(block.includes('PostgreSQL 16'))
  assert.ok(!block.includes('Cache do CI'))
  assert.deepEqual(record.dropped.map((d) => [d.id, d.reason]), [[unrelatedLearning.id, 'aprendizado sem relação com a tarefa']])
  assert.equal(record.chars > 0, true)
})

test('foco por etapa: o planejador não recebe resultado de QA sem relação com a tarefa', () => {
  const qa = mem('qa_result', 'Testes de login falharam no Firefox')
  const planning = buildMemoryContext({ entries: [qa], task, pastMissions: [], stage: 'planning' })
  const reviewing = buildMemoryContext({ entries: [qa], task, pastMissions: [], stage: 'reviewing' })
  assert.equal(planning.block, '')
  assert.equal(planning.record.dropped[0].reason, 'fora do foco desta etapa')
  assert.ok(reviewing.block.includes('Firefox'))
})

test('memória individual é marcada como do próprio agente', () => {
  const own = mem('learning', 'Relatório de vendas: conferir arredondamento de centavos', 'agent', 'qa')
  const { block } = buildMemoryContext({ entries: [own], task, pastMissions: [] })
  assert.match(block, /sua memória individual\] Relatório de vendas/)
})

test('orçamento: opcionais são cortadas com motivo e obrigatórias que não cabem param a missão', () => {
  const decision = mem('decision', 'D'.repeat(80))
  const big = mem('solution', `Relatório ${'x'.repeat(200)}`)
  const { block, record } = buildMemoryContext({ entries: [decision, big], task, pastMissions: [], budget: 200 })
  assert.ok(block.length > 0)
  assert.ok(block.split('\n').every((l) => !l.includes('x'.repeat(200))))
  assert.deepEqual(record.dropped.map((d) => [d.id, d.reason]), [[big.id, 'sem espaço no orçamento de contexto']])
  assert.ok(record.chars <= 200)

  assert.throws(
    () => buildMemoryContext({ entries: [mem('requirement', 'R'.repeat(300))], task, pastMissions: [], budget: 200 }),
    /não cabem no orçamento de memória/,
  )
})

test('histórico: resultado das missões anteriores da mesma tarefa entra sem copiar a memória', () => {
  const past = { id: 9, phase: 'done', verdictDetail: 'REPROVADO', review: 'Faltou paginação no PDF.\nVEREDITO: REPROVADO', error: null } as MissionInfo
  const { block, record } = buildMemoryContext({ entries: [], task, pastMissions: [past] })
  assert.match(block, /Missão anterior #9 desta mesma tarefa\] Resultado: REPROVADO\. Parecer do QA: Faltou paginação/)
  assert.deepEqual(record.selected, [{ id: null, category: 'qa_result', reason: 'missão #9 anterior da mesma tarefa' }])
})

test('sem memória aprovada o bloco fica vazio (o prompt não muda)', () => {
  assert.deepEqual(buildMemoryContext({ entries: [], task, pastMissions: [] }), { block: '', record: { chars: 0, selected: [], dropped: [] } })
})
