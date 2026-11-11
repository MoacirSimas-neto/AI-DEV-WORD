import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentInfo } from '../../../shared/protocol.ts'
import type { CliProbe } from '../cli/probe.ts'
import { AgentRegistry, DEFAULT_AGENTS } from './registry.ts'

function statesDuringCheck(probe: CliProbe) {
  const registry = new AgentRegistry(DEFAULT_AGENTS, probe)
  const states: string[] = []
  registry.on('change', (agent: AgentInfo) => states.push(agent.state))
  return { registry, states }
}

test('agente passa por working e termina idle quando o CLI responde', async () => {
  const { registry, states } = statesDuringCheck(async () => ({
    found: true,
    version: 'codex-cli 1.2.3',
    auth: 'ok',
  }))
  const agent = await registry.check('dev')
  assert.deepEqual(states, ['working', 'idle'])
  assert.equal(agent?.cliVersion, 'codex-cli 1.2.3')
  assert.equal(agent?.auth, 'ok')
})

test('agente fica offline quando o CLI não está instalado', async () => {
  const { registry, states } = statesDuringCheck(async () => ({
    found: false,
    version: null,
    auth: 'unknown',
  }))
  await registry.check('dev')
  assert.deepEqual(states, ['working', 'offline'])
})

test('falha na execução vira estado de erro com a mensagem', async () => {
  const { registry } = statesDuringCheck(async () => {
    throw new Error('boom')
  })
  const agent = await registry.check('dev')
  assert.equal(agent?.state, 'error')
  assert.equal(agent?.message, 'boom')
})

test('agente desconhecido devolve null', async () => {
  const { registry } = statesDuringCheck(async () => ({ found: false, version: null, auth: 'unknown' }))
  assert.equal(await registry.check('nao-existe'), null)
})
