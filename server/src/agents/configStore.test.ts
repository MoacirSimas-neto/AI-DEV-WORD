import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { AgentConfigStore, DEFAULT_CONFIGS } from './configStore.ts'

test('AgentConfigStore inicializa com padrões e lista configurações', () => {
  const db = new DatabaseSync(':memory:')
  const store = new AgentConfigStore(db)

  const list = store.list()
  assert.equal(list.length, 4)
  assert.equal(store.get('architect').model, DEFAULT_CONFIGS.architect.model)
  assert.equal(store.get('architect').specializationId, 'tech-lead')
  assert.equal(store.get('dev').reasoningEffort, 'high')
  assert.equal(store.get('dev').specializationId, 'developer')
  assert.equal(store.get('qa').specializationId, 'qa-tester')
  assert.equal(store.get('tutor').specializationId, 'tutor')
})

test('AgentConfigStore atualiza configuração de agente individual', () => {
  const db = new DatabaseSync(':memory:')
  const store = new AgentConfigStore(db)

  const updated = store.set('architect', {
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    reasoningEffort: 'default',
  })

  assert.equal(updated.model, 'gemini-3.5-flash')
  assert.equal(store.get('architect').model, 'gemini-3.5-flash')
  // outros agentes intactos
  assert.equal(store.get('dev').provider, 'codex')
})

test('AgentConfigStore aplica perfis e restaura padrões', () => {
  const db = new DatabaseSync(':memory:')
  const store = new AgentConfigStore(db)

  store.applyProfile('economy')
  assert.equal(store.get('dev').reasoningEffort, 'low')
  assert.equal(store.get('architect').model, 'gemini-3.8-flash-low')
  assert.equal(store.get('architect').provider, 'antigravity')

  store.applyProfile('max_quality')
  assert.equal(store.get('dev').reasoningEffort, 'high')
  assert.equal(store.get('architect').model, 'gemini-4-argon-high')

  store.resetDefaults()
  assert.equal(store.get('dev').reasoningEffort, 'high')
  assert.equal(store.get('architect').provider, 'antigravity')
  assert.equal(store.get('architect').model, 'gemini-4-argon-high')
})

test('AgentConfigStore: criação, atualização, ativação/desativação e consulta de especialização', () => {
  const db = new DatabaseSync(':memory:')
  const store = new AgentConfigStore(db)

  const created = store.createAgent({
    name: 'QA Segurança',
    role: 'Auditoria e Pentest Estático',
    description: 'Especialista em revisão de vulnerabilidades OWASP.',
    roleCategory: 'reviewing',
    specializationId: 'qa-tester',
    provider: 'antigravity',
    model: 'gemini-4-argon-high',
    reasoningEffort: 'high',
    customInstructions: 'Verifique injeção de comandos e vazamento de tokens sk-secret1234567890abcdef.',
    avatarPreset: 'qa',
  })

  assert.equal(created.agentId, 'qa-seguranca')
  assert.equal(created.name, 'QA Segurança')
  assert.equal(created.isBuiltin, false)
  assert.equal(created.active, true)
  // Credenciais nas instruções personalizadas devem passar por redact
  assert.ok(!created.customInstructions?.includes('sk-secret1234567890abcdef'))

  const spec = store.getSpecialization('qa-seguranca')
  assert.equal(spec.id, 'qa-tester')
  assert.equal(spec.codename, 'O Investigador')

  // Atualização de perfil
  const updated = store.updateAgent('qa-seguranca', {
    name: 'QA AppSec Sênior',
    provider: 'codex',
    model: 'o3',
    reasoningEffort: 'extra-high',
  })
  assert.equal(updated.name, 'QA AppSec Sênior')
  assert.equal(updated.provider, 'codex')
  assert.equal(updated.model, 'o3')
  assert.equal(updated.reasoningEffort, 'extra-high')

  // Desativação preserva registro no banco, mas oculta da listagem ativa padrão
  store.setAgentActive('qa-seguranca', false)
  assert.equal(store.list().length, 4)
  assert.equal(store.list({ includeInactive: true }).length, 5)
  assert.equal(store.find('qa-seguranca')?.active, false)

  // Reativação
  store.setAgentActive('qa-seguranca', true)
  assert.equal(store.list().length, 5)
  assert.equal(store.find('qa-seguranca')?.active, true)
})

test('AgentConfigStore: valida IDs duplicados, especializações inexistentes, dados inválidos e protege agentes padrão', () => {
  const db = new DatabaseSync(':memory:')
  const store = new AgentConfigStore(db)

  // Impede sobrescrever ID de agente padrão
  assert.throws(
    () =>
      store.createAgent({
        id: 'architect',
        name: 'Outro Arquiteto',
        role: 'Arquiteto',
        roleCategory: 'planning',
        specializationId: 'tech-lead',
        provider: 'gemini',
      }),
    /Já existe um agente cadastrado/,
  )

  store.createAgent({
    id: 'dev-python',
    name: 'Dev Python',
    role: 'Backend Python',
    roleCategory: 'developing',
    specializationId: 'developer',
    provider: 'codex',
  })

  // Impede ID duplicado de agente customizado
  assert.throws(
    () =>
      store.createAgent({
        id: 'dev-python',
        name: 'Dev Python 2',
        role: 'Backend',
        roleCategory: 'developing',
        specializationId: 'developer',
        provider: 'codex',
      }),
    /Já existe um agente cadastrado/,
  )

  // Especialização inexistente
  assert.throws(
    () =>
      store.createAgent({
        name: 'Agente Inválido',
        role: 'Teste',
        roleCategory: 'developing',
        specializationId: 'especializacao-fantasma' as never,
        provider: 'gemini',
      }),
    /Especialização desconhecida/,
  )

  // Dados inválidos (nome vazio, provedor inválido)
  assert.throws(
    () =>
      store.createAgent({
        name: '   ',
        role: 'Teste',
        roleCategory: 'developing',
        specializationId: 'developer',
        provider: 'gemini',
      }),
    /nome válido/,
  )
  assert.throws(
    () =>
      store.createAgent({
        name: 'Agente X',
        role: 'Teste',
        roleCategory: 'developing',
        specializationId: 'developer',
        provider: 'claude-paid-api' as never,
      }),
    /Provedor CLI inválido/,
  )

  // Proteção dos 4 agentes originais contra desativação ou troca de categoria
  for (const builtinId of ['architect', 'dev', 'qa', 'tutor']) {
    assert.throws(() => store.setAgentActive(builtinId, false), /Agentes padrão não podem ser desativados/)
  }
  assert.throws(
    () => store.updateAgent('architect', { roleCategory: 'developing' }),
    /categoria principal de um agente padrão não pode ser alterada/,
  )
})

test('AgentConfigStore: migração de banco legado, migração repetida idempotente e persistência após reinício', () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'aidw-cfg-mig-'))
  const dbFile = path.join(tmpDir, 'legacy.sqlite')

  try {
    // 1. Simula banco legado (apenas as 5 colunas originais da v1)
    const legacyDb = new DatabaseSync(dbFile)
    legacyDb.exec(`
      CREATE TABLE agent_configs (
        agent_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO agent_configs VALUES ('architect', 'gemini', 'gemini-2.5-pro', 'default', '2026-01-01T00:00:00.000Z');
      INSERT INTO agent_configs VALUES ('dev', 'codex', 'o3', 'extra-high', '2026-01-01T00:00:00.000Z');
    `)
    legacyDb.close()

    // 2. Abre com AgentConfigStore (executa migração incremental)
    const db1 = new DatabaseSync(dbFile)
    const store1 = new AgentConfigStore(db1)

    // Configurações customizadas anteriores foram 100% preservadas
    const arch = store1.get('architect')
    assert.equal(arch.provider, 'gemini')
    assert.equal(arch.model, 'gemini-2.5-pro')
    assert.equal(arch.specializationId, 'tech-lead')
    assert.equal(arch.isBuiltin, true)

    const dev = store1.get('dev')
    assert.equal(dev.provider, 'codex')
    assert.equal(dev.model, 'o3')
    assert.equal(dev.reasoningEffort, 'extra-high')
    assert.equal(dev.specializationId, 'developer')

    // Cadastra agente customizado e fecha o banco
    store1.createAgent({
      id: 'arquiteto-cloud',
      name: 'Arquiteto Cloud',
      role: 'Infraestrutura e Resiliência',
      roleCategory: 'planning',
      specializationId: 'tech-lead',
      provider: 'antigravity',
      model: 'gemini-4-argon-high',
      reasoningEffort: 'high',
    })
    db1.close()

    // 3. Reabre o banco e instancia AgentConfigStore duas vezes seguidas (idempotência e persistência pós-reinício)
    const db2 = new DatabaseSync(dbFile)
    new AgentConfigStore(db2)
    const store2 = new AgentConfigStore(db2)

    assert.equal(store2.list().length, 5)
    const cloud = store2.find('arquiteto-cloud')
    assert.ok(cloud)
    assert.equal(cloud.name, 'Arquiteto Cloud')
    assert.equal(cloud.specializationId, 'tech-lead')
    assert.equal(store2.get('dev').model, 'o3')
    db2.close()
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})
