import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LiveRedactor, liveRedaction, redact, SECRET_MARK } from './redact.ts'

// Todos os segredos aqui são fictícios.
const KEY = 'sk-proj-ficticio0123456789abcdefXYZ'
const GH = 'ghp_ficticio0123456789abcdefghijkl'
const ESC = '\x1b'

/** Passa o texto em pedaços e devolve o que foi liberado (com flush no fim). */
function stream(chunks: string[]) {
  const r = new LiveRedactor()
  let out = ''
  for (const c of chunks) out += r.push(c)
  return out + r.flush()
}

test('texto comum passa intacto e sem atraso quando o pedaço termina em espaço ou quebra de linha', () => {
  const r = new LiveRedactor()
  assert.equal(r.push('compilando 3 arquivos...\n'), 'compilando 3 arquivos...\n')
  assert.equal(r.holdMs(), null)
  assert.equal(r.push(`${ESC}[32mok${ESC}[0m\r\n`), `${ESC}[32mok${ESC}[0m\r\n`)
})

test('segredo partido em qualquer posição entre dois pedaços nunca aparece inteiro', () => {
  const line = `token do serviço: ${KEY} fim\n`
  for (let i = 1; i < line.length; i++) {
    const out = stream([line.slice(0, i), line.slice(i)])
    assert.ok(!out.includes(KEY), `vazou com corte em ${i}: ${out}`)
    assert.ok(out.includes(SECRET_MARK), `corte em ${i}`)
    assert.ok(out.endsWith(' fim\n'))
  }
})

test('saída em pedaços de 1 a 3 caracteres (streaming de modelo) não vaza o segredo', () => {
  const line = `use ${GH} e Authorization: Bearer abcdefghijklmnop123 agora\n`
  for (const size of [1, 2, 3]) {
    const chunks = line.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'))!
    const out = stream(chunks)
    assert.ok(!out.includes(GH) && !out.includes('abcdefghijklmnop123'), out)
    assert.match(out, /agora\n$/)
  }
})

test('ANSI: cor em volta do segredo é preservada; escape no meio do segredo não esconde o segredo', () => {
  const colored = `${ESC}[31m${KEY}${ESC}[0m pronto\n`
  assert.equal(stream([colored]), `${ESC}[31m${SECRET_MARK}${ESC}[0m pronto\n`)
  const split = `chave sk-proj-${ESC}[1mficticio0123456789abcdef${ESC}[0m\n`
  const out = stream([split])
  assert.ok(!out.replace(/\x1b\[[0-9;]*m/g, '').includes('ficticio0123456789'), out)
})

test('escape ANSI partido entre pedaços não é corrompido', () => {
  const out = stream([`linha ${ESC}[3`, `2mverde${ESC}[0m\n`])
  assert.equal(out, `linha ${ESC}[32mverde${ESC}[0m\n`)
})

test('chave privada em vários pedaços é removida por inteiro', () => {
  const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIfakefakefake\nfakefakefake\n-----END RSA PRIVATE KEY-----'
  const out = stream([`chave:\n${key.slice(0, 40)}`, key.slice(40, 70), `${key.slice(70)}\nok\n`])
  assert.equal(out, `chave:\n${SECRET_MARK}\nok\n`)
})

test('pausa longa no meio do segredo: só o início já liberado aparece; a continuação é redigida', () => {
  const r = new LiveRedactor()
  let out = r.push('valor sk-proj-fic')
  assert.equal(r.holdMs(), 1500, 'final suspeito fica retido por mais tempo')
  out += r.flush() // tempo esgotado
  out += r.push('ticio0123456789abcdef depois\n')
  assert.equal(out, `valor sk-proj-fic${SECRET_MARK} depois\n`)
})

test('digitação no terminal: um caractere por vez é liberado em no máximo 60 ms', () => {
  const r = new LiveRedactor()
  assert.equal(r.push('l'), '')
  assert.equal(r.holdMs(), 60)
  assert.equal(r.flush(), 'l')
  assert.equal(r.push('s '), 's ')
})

test('nada fica retido além do limite: um bloco suspeito enorme sai redigido', () => {
  const r = new LiveRedactor()
  const out = r.push('-----BEGIN PRIVATE KEY-----\n' + 'A'.repeat(9000))
  assert.ok(out.length > 0)
  assert.ok(!out.includes('AAAAAAAAAA'))
})

test('liveRedaction libera o retido pelo temporizador e no fim', async () => {
  const got: string[] = []
  const live = liveRedaction((s) => got.push(s))
  live.write('abc')
  assert.deepEqual(got, [])
  await new Promise((r) => setTimeout(r, 120))
  assert.deepEqual(got, ['abc'])
  live.write(`x ${KEY.slice(0, 10)}`)
  live.end()
  live.write('') // nada depois do fim
  assert.equal(got.join(''), 'abcx sk-proj-fi')
})

test('redact de texto completo segue o formato anterior', () => {
  assert.equal(redact('Authorization: Bearer abcdefghijklmnop'), `Authorization: Bearer ${SECRET_MARK}`)
  assert.equal(redact('git clone https://user:ficticia@host/repo'), `git clone https://${SECRET_MARK}@host/repo`)
})
