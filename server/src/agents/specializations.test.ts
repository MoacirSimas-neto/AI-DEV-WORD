import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { TaskInfo } from '../../../shared/protocol.ts'
import { devPrompt, parseDetailedVerdict, parseVerdict, planPrompt, reviewPrompt } from '../team/prompts.ts'
import { defaultSpecializations, sanitizeAgentMarkdown, selectRelevantSections } from './specializations.ts'

test('manifesto desktop inclui os documentos usados pela especialização e as skills padrão', () => {
  const root = new URL('../../../', import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL('src-tauri/tauri.conf.json', root), 'utf8'))
  const resources: string[] = manifest.bundle.resources.filter((entry: string) => entry.startsWith('../knowledge/'))
  const expected = ['skills/ponytail.md', 'skills/caveman-lite.md', 'skills/NOTICE.md']
  for (const id of ['tech-lead', 'developer', 'qa-tester'] as const) {
    expected.push(`agents/${id}.md`, ...['principios', 'dossie', 'referencias'].map((doc) => `${id}/${doc}.md`))
  }
  assert.deepEqual([...resources].sort(), expected.map((doc) => `../knowledge/${doc}`).sort())
  for (const file of expected) assert.ok(readFileSync(new URL(`knowledge/${file}`, root), 'utf8').trim(), file)
  assert.equal(defaultSpecializations.resolveForTask('none').promptBlock, '')
})

test('SpecializationRegistry lista as 4 especializações e confirma documentos migrados em knowledge/', () => {
  const list = defaultSpecializations.list()
  assert.equal(list.length, 4)

  const techLead = defaultSpecializations.getInfo('tech-lead')
  assert.equal(techLead.defaultAgentId, 'architect')
  assert.deepEqual(techLead.availableDocs, ['agent', 'principios', 'dossie', 'referencias'])

  const dev = defaultSpecializations.getInfo('developer')
  assert.equal(dev.defaultAgentId, 'dev')
  assert.deepEqual(dev.availableDocs, ['agent', 'principios', 'dossie', 'referencias'])

  const qa = defaultSpecializations.getInfo('qa-tester')
  assert.equal(qa.defaultAgentId, 'qa')
  assert.deepEqual(qa.availableDocs, ['agent', 'principios', 'dossie', 'referencias'])

  const tutor = defaultSpecializations.getInfo('tutor')
  assert.equal(tutor.defaultAgentId, 'tutor')
})

test('sanitizeAgentMarkdown remove frontmatter YAML e ferramentas internas de IDE (invoke_subagent)', () => {
  const raw = [
    '---',
    'name: tech-lead',
    'tools:',
    '  - view_file',
    '  - invoke_subagent',
    '---',
    '# Tech Lead — O Arquiteto',
    'Use invoke_subagent para delegar.',
    'Analise os requisitos com rigor.',
  ].join('\n')

  const clean = sanitizeAgentMarkdown(raw)
  assert.ok(!clean.includes('name: tech-lead'))
  assert.ok(!clean.includes('invoke_subagent'))
  assert.ok(!clean.includes('view_file'))
  assert.ok(clean.includes('# Tech Lead — O Arquiteto'))
  assert.ok(clean.includes('Analise os requisitos com rigor.'))

  // Verifica nos documentos reais migrados
  for (const specId of ['tech-lead', 'developer', 'qa-tester'] as const) {
    const agentDoc = defaultSpecializations.readDocument(specId, 'agent')
    assert.ok(agentDoc && agentDoc.length > 200)
    assert.ok(!agentDoc.includes('invoke_subagent'))
    assert.ok(!agentDoc.startsWith('---'))
  }
})

test('resolveForTask faz carregamento seletivo por tarefa e respeita orçamento de caracteres', () => {
  // Tarefa simples: carrega apenas agent + principios (não carrega dossie nem referencias)
  const simple = defaultSpecializations.resolveForTask('dev', {
    taskContext: 'Ajustar cor do botão primário',
    maxChars: 5000,
  })
  assert.deepEqual(simple.loadedDocs, ['agent', 'principios'])
  assert.ok(simple.promptBlock.length <= 5100)

  // Tarefa arquitetural/concorrência: inclui seletivamente o dossiê
  const archTask = defaultSpecializations.resolveForTask('architect', {
    taskContext: 'Refatorar arquitetura distribuída e concorrência do módulo',
    maxChars: 6000,
  })
  assert.ok(archTask.loadedDocs.includes('dossie'))
  assert.ok(!archTask.loadedDocs.includes('referencias'))

  // Tarefa de estudo/referências: inclui seletivamente as referências
  const studyTask = defaultSpecializations.resolveForTask('qa', {
    taskContext: 'Estudar referências bibliográficas e autores de testes',
    maxChars: 6000,
  })
  assert.ok(studyTask.loadedDocs.includes('referencias'))
})

test('prompts de missão integram especializações preservando regras de segurança e vereditos do QA', () => {
  const sampleTask: TaskInfo = {
    id: 10,
    projectId: 1,
    title: 'Implementar validação de entrada',
    description: 'Validar campos obrigatórios no backend',
    priority: 'high',
    status: 'todo',
    agentId: 'architect',
    createdAt: '',
    updatedAt: '',
  }

  const pPrompt = planPrompt(sampleTask)
  assert.ok(pPrompt.includes('Tech Lead'))
  assert.ok(pPrompt.includes('não altere nenhum arquivo'))
  assert.ok(!pPrompt.includes('  - invoke_subagent'))

  const dPrompt = devPrompt(sampleTask, '1. Editar validator.ts')
  assert.ok(dPrompt.includes('O Programador Pragmático'))
  assert.ok(dPrompt.includes('Não faça commit, push'))

  const rPrompt = reviewPrompt(sampleTask, 'Plano', 'Relatório Dev', ['validator.ts'], '+const ok = true')
  assert.ok(rPrompt.includes('O Investigador'))
  assert.ok(rPrompt.includes('VEREDITO: APROVADO PARA O ESCOPO'))

  // Vereditos clássicos e granulares do QA
  assert.equal(parseVerdict('Tudo certo.\nVEREDITO: APROVADO'), 'approved')
  assert.equal(parseVerdict('Ok no escopo.\nVEREDITO: APROVADO PARA O ESCOPO'), 'approved')
  assert.equal(parseVerdict('Com ressalvas.\nVEREDITO: APROVADO COM RESSALVAS'), 'approved')
  assert.equal(parseVerdict('Falha crítica.\nVEREDITO: REPROVADO'), 'changes')
  assert.equal(parseVerdict('Sem ambiente.\nVEREDITO: BLOQUEADO'), 'changes')
  assert.equal(parseVerdict('Faltou rodar.\nVEREDITO: NÃO VERIFICADO'), 'changes')
  assert.equal(parseVerdict('Sem dados.\nVEREDITO: INCONCLUSIVO'), 'changes')
  assert.equal(parseDetailedVerdict('Parecer final\nVEREDITO: APROVADO COM RESSALVAS'), 'APROVADO COM RESSALVAS')
})

test('conhecimento: sem referências a arquivos inexistentes, seções relevantes à tarefa e instruções sem corte a 2000', () => {
  // A definição do papel não manda mais ler knowledge/*.md (não existe na pasta do projeto da missão).
  for (const id of ['architect', 'dev', 'qa']) {
    const block = defaultSpecializations.resolveForTask(id, { taskContext: 'Qualquer tarefa', maxChars: 5500 }).promptBlock
    assert.ok(!block.includes('knowledge/'), id)
    assert.ok(block.length <= 5600, id)
  }

  // A seção que trata do tema da tarefa entra mesmo estando no fim do documento.
  const doc = ['## 1. Nomes', 'Use nomes claros.', '## 2. Desempenho', 'Meça antes de otimizar.', '## 3. Concorrência', 'Evite estado compartilhado.'].join('\n')
  const picked = selectRelevantSections(doc, 'Corrigir condição de corrida por concorrência', '', 60)
  assert.ok(picked.includes('## 3. Concorrência'))
  assert.ok(!picked.includes('## 1. Nomes'))

  const longInstructions = 'regra '.repeat(600).trim() // 3599 caracteres
  const prompt = devPrompt({ id: 1, projectId: 1, title: 'T', description: '', priority: 'low', status: 'todo', agentId: null, createdAt: '', updatedAt: '' }, 'plano', { customInstructions: longInstructions })
  assert.ok(prompt.includes(longInstructions))
})
