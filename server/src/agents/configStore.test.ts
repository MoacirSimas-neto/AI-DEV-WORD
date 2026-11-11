import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { AgentConfigStore, DEFAULT_CONFIGS } from './configStore.ts'

test('AgentConfigStore inicializa com padrões e lista configurações', () => {
  const db = new DatabaseSync(':memory:')
  const store = new AgentConfigStore(db)

  const list = store.list()
  assert.equal(list.length, 4)
  assert.equal(store.get('architect').model, DEFAULT_CONFIGS.architect.model)
  assert.equal(store.get('dev').reasoningEffort, 'high')
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
