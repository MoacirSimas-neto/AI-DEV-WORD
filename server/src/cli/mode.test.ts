import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { cliMode, findSimulatedCli, requireSimulatedClis, SIMULATED_MARKER } from './mode.ts'
import { findCli } from './probe.ts'

const dirs: string[] = []
const temp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'aidw-mode-'))
  dirs.push(d)
  return d
}
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
const EXT = process.platform === 'win32' ? '.cmd' : ''
const shim = (dir: string, name: string, marked: boolean) =>
  writeFileSync(path.join(dir, name + EXT), `${process.platform === 'win32' ? '@REM' : '#'} ${marked ? SIMULATED_MARKER : 'cli qualquer'}\n`)

test('testes automatizados rodam em modo simulado: nenhum CLI real é encontrado mesmo instalado no PATH', () => {
  assert.equal(process.env.AIDW_CLI_MODE, 'simulated')
  for (const cli of ['codex', 'gemini', 'agy'] as const) assert.equal(findCli(cli), null, cli)
})

test('modo simulado: só executável marcado da pasta indicada; nunca o PATH', () => {
  const real = temp()
  const sim = temp()
  shim(real, 'codex', false) // "CLI real" no PATH
  shim(sim, 'gemini', true)
  shim(sim, 'codex', false) // presente mas sem marcador: não vale
  const env = { AIDW_CLI_MODE: 'simulated', AIDW_SIMULATED_CLI_DIR: sim }
  assert.deepEqual(cliMode(env), { kind: 'simulated', dir: sim })
  assert.equal(findSimulatedCli('codex', sim), null)
  assert.equal(findSimulatedCli('gemini', sim), path.join(sim, 'gemini' + EXT))
  assert.throws(() => requireSimulatedClis(sim), /ausente ou sem o marcador.*codex, agy.*Nenhum CLI real/)
})

test('configuração inválida falha em vez de cair no modo real', () => {
  assert.deepEqual(cliMode({}), { kind: 'real' })
  assert.throws(() => cliMode({ AIDW_CLI_MODE: 'simulado' }), /inválido/)
  assert.throws(() => cliMode({ AIDW_CLI_MODE: 'simulated' }), /exige AIDW_SIMULATED_CLI_DIR/)
  assert.throws(() => cliMode({ AIDW_CLI_MODE: 'simulated', AIDW_SIMULATED_CLI_DIR: 'relativo/bin' }), /caminho absoluto/)
})

test('PATH incorreto na validação (erro da 11.2): o backend se recusa a iniciar e não chama CLI nenhum', () => {
  const data = temp()
  const sim = temp() // pasta de simulados vazia, como num PATH montado errado
  const real = temp()
  shim(real, 'gemini', false)
  const result = spawnSync(process.execPath, ['--no-warnings', path.join(import.meta.dirname, '..', 'index.ts')], {
    env: { ...process.env, AIDW_CLI_MODE: 'simulated', AIDW_SIMULATED_CLI_DIR: sim, AIDW_DATA_DIR: data, AIDW_PORT: '0', PATH: `${real}${path.delimiter}${process.env.PATH}` },
    encoding: 'utf8',
    timeout: 20_000,
  })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /CLI simulado ausente.*codex, gemini, agy.*Nenhum CLI real foi usado/)
  assert.doesNotMatch(result.stdout, /backend em/)
})
