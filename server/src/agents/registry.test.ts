import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentInfo } from '../../../shared/protocol.ts'
import type { CliProbe, ProbeResult } from '../cli/probe.ts'
import { AgentRegistry, DEFAULT_AGENTS } from './registry.ts'

const FOUND: ProbeResult = { found: true, version: 'codex-cli 1.2.3', auth: 'ok' }

function setup(probe: CliProbe) {
  const registry = new AgentRegistry(DEFAULT_AGENTS, probe)
  const changes: AgentInfo[] = []
  registry.on('change', (agent: AgentInfo) => changes.push(agent))
  return { registry, changes }
}

test('existem os quatro agentes, com o Dev no Codex e os demais no Gemini', () => {
  const { registry } = setup(async () => FOUND)
  assert.deepEqual(
    registry.list().map((a) => `${a.id}:${a.cli}`),
    ['architect:gemini', 'dev:codex', 'qa:gemini', 'tutor:gemini'],
  )
})

test('verificação marca checking e termina idle com os dados do CLI', async () => {
  const { registry, changes } = setup(async () => FOUND)
  const agent = await registry.check('dev')
  assert.deepEqual(
    changes.map((a) => [a.checking, a.state]),
    [
      [true, 'offline'],
      [false, 'idle'],
    ],
  )
  assert.equal(agent?.cliVersion, 'codex-cli 1.2.3')
  assert.equal(agent?.auth, 'ok')
})

test('agente fica offline quando o CLI não está instalado', async () => {
  const { registry } = setup(async () => ({ found: false, version: null, auth: 'unknown' }))
  assert.equal((await registry.check('dev'))?.state, 'offline')
})

test('falha na execução vira estado de erro com a mensagem', async () => {
  const { registry } = setup(async () => {
    throw new Error('boom')
  })
  const agent = await registry.check('dev')
  assert.equal(agent?.state, 'error')
  assert.equal(agent?.message, 'boom')
  assert.equal(agent?.checking, false)
})

test('agente desconhecido devolve null', async () => {
  const { registry } = setup(async () => FOUND)
  assert.equal(await registry.check('nao-existe'), null)
})

test('sessão iniciada durante a verificação não tem o estado sobrescrito', async () => {
  let finishProbe: (result: ProbeResult) => void = () => {}
  const { registry } = setup(() => new Promise((resolve) => (finishProbe = resolve)))

  const checking = registry.check('dev')
  registry.setRuntimeState('dev', 'working', 'Trabalhando')
  finishProbe(FOUND)
  const agent = await checking

  assert.equal(agent?.state, 'working')
  assert.equal(agent?.message, 'Trabalhando')
  assert.equal(agent?.cliVersion, 'codex-cli 1.2.3')
})
