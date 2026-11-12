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

test('redact é idempotente: reaplicar não deforma o texto já sanitizado', () => {
  const once = redact('use api_key=sk-test-1234567890abcdefXYZ e token: abcd1234 aqui')
  assert.equal(once, 'use api_key=[SEGREDO REMOVIDO] e token: [SEGREDO REMOVIDO] aqui')
  assert.equal(redact(redact(once)), once)
})

test('redact cobre JWT, tokens npm/Stripe e variáveis de ambiente com prefixo', () => {
  const cases = [
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlZmFrZQ',
    'npm_abcdefghijklmnopqrstuvwxyz0123456789',
    'sk_live_abcdefghijklmnop12345678',
    'rk_test_abcdefghijklmnop12345678',
  ]
  for (const secret of cases) assert.equal(redact(`valor ${secret} fim`), 'valor [SEGREDO REMOVIDO] fim', secret)
  assert.equal(redact('export GOOGLE_API_KEY=AbCdEf123456'), 'export GOOGLE_API_KEY=[SEGREDO REMOVIDO]')
  assert.equal(redact('DB_PASSWORD: "hunter22x"'), 'DB_PASSWORD: [SEGREDO REMOVIDO]')
  // Texto comum com palavras parecidas continua intacto.
  assert.equal(redact('o token expira em 5 minutos; veja a api_key no painel'), 'o token expira em 5 minutos; veja a api_key no painel')
})
