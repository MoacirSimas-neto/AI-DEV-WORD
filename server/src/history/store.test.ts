import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { cleanOutput, HistoryStore, redact } from './store.ts'

test('redact remove padroes de chaves e senhas', () => {
  const secretKey = 'sk-abcdef1234567890abcdef1234567890'
  const gitKey = 'ghp_12345678901234567890123456789012'
  const text = `Chave OpenAI: ${secretKey}, GitHub: ${gitKey}, url: https://user:pass123@api.com, senha="super_secret"`
  const sanitized = redact(text)

  assert.ok(!sanitized.includes(secretKey))
  assert.ok(!sanitized.includes(gitKey))
  assert.ok(!sanitized.includes('pass123'))
  assert.ok(!sanitized.includes('super_secret'))
  assert.ok(sanitized.includes('[SEGREDO REMOVIDO]'))
})

test('cleanOutput remove ANSI e segredos', () => {
  const ansiText = '\u001b[31mTexto Vermelho\u001b[0m com sk-12345678901234567890'
  const cleaned = cleanOutput(ansiText)
  assert.equal(cleaned, 'Texto Vermelho com [SEGREDO REMOVIDO]')
})

test('HistoryStore registra e lista entradas com limite e ordem correta', () => {
  const db = new DatabaseSync(':memory:')
  const history = new HistoryStore(db)

  const created = history.add({
    kind: 'task',
    message: 'Tarefa criada com sk-12345678901234567890',
    projectId: 1,
    taskId: 2,
  })

  assert.equal(created.id, 1)
  assert.ok(!created.message.includes('sk-12345678901234567890'))
  assert.ok(created.message.includes('[SEGREDO REMOVIDO]'))

  history.add({ kind: 'mission', message: 'Segunda entrada' })
  const list = history.list()
  assert.equal(list.length, 2)
  assert.equal(list[0].id, 2) // mais recente primeiro
  assert.equal(list[1].id, 1)
})
