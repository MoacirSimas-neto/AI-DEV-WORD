import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { AgentRegistry, DEFAULT_AGENTS } from '../agents/registry.ts'
import { type PtyLike, TerminalManager } from './manager.ts'

/** Pseudo-terminal falso: o teste controla a saída e o encerramento. */
class FakePty implements PtyLike {
  written: string[] = []
  size = ''
  private dataListener: (data: string) => void = () => {}
  private exitListener: (event: { exitCode: number }) => void = () => {}
  onData(listener: (data: string) => void) {
    this.dataListener = listener
  }
  onExit(listener: (event: { exitCode: number }) => void) {
    this.exitListener = listener
  }
  write(data: string) {
    this.written.push(data)
  }
  resize(cols: number, rows: number) {
    this.size = `${cols}x${rows}`
  }
  kill() {
    this.exitListener({ exitCode: 1 })
  }
  output(data: string) {
    this.dataListener(data)
  }
}

async function setup() {
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: 'v1', auth: 'ok' }))
  await registry.check('dev')
  const pty = new FakePty()
  let spawned = 0
  let cwd: string | null = '/projetos/demo'
  const terminals = new TerminalManager(
    registry,
    () => {
      spawned++
      return pty
    },
    () => cwd,
    { quietMs: 20, echoMs: 0 },
  )
  return { registry, terminals, pty, spawnCount: () => spawned, setCwd: (value: string | null) => (cwd = value) }
}

test('saída do processo deixa o agente working e o silêncio o deixa waiting', async () => {
  const { registry, terminals, pty } = await setup()
  terminals.open('dev', 80, 24)
  assert.equal(registry.get('dev')?.state, 'waiting')

  await sleep(2)
  pty.output('compilando...')
  assert.equal(registry.get('dev')?.state, 'working')

  await sleep(60)
  assert.equal(registry.get('dev')?.state, 'waiting')
  terminals.closeAll()
})

test('reabrir reaproveita a sessão e devolve a saída acumulada', async () => {
  const { terminals, pty, spawnCount } = await setup()
  terminals.open('dev', 80, 24)
  pty.output('linha 1\r\n')
  pty.output('linha 2\r\n')

  const replay = terminals.open('dev', 100, 30)
  assert.equal(replay, 'linha 1\r\nlinha 2\r\n')
  assert.equal(spawnCount(), 1)
  assert.equal(pty.size, '100x30')
  terminals.closeAll()
})

test('entrada vai para o processo e o encerramento devolve o agente a idle', async () => {
  const { registry, terminals, pty } = await setup()
  const exits: number[] = []
  terminals.on('exit', (_id: string, code: number) => exits.push(code))

  terminals.open('dev', 80, 24)
  terminals.write('dev', 'oi\r')
  assert.deepEqual(pty.written, ['oi\r'])

  terminals.close('dev')
  assert.deepEqual(exits, [1])
  assert.equal(registry.get('dev')?.state, 'idle')
})

test('não abre terminal para agente sem CLI', async () => {
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: false, version: null, auth: 'unknown' }))
  await registry.check('dev')
  const terminals = new TerminalManager(registry, () => new FakePty(), () => '/projetos/demo')
  assert.throws(() => terminals.open('dev', 80, 24), /não está disponível/)
})

test('não abre terminal sem um projeto ativo', async () => {
  const { terminals, setCwd, spawnCount } = await setup()
  setCwd(null)
  assert.throws(() => terminals.open('dev', 80, 24), /Escolha um projeto/)
  assert.equal(spawnCount(), 0)
})

test('o processo nasce na pasta do projeto ativo', async () => {
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: 'v1', auth: 'ok' }))
  await registry.check('qa')
  const calls: string[] = []
  const terminals = new TerminalManager(
    registry,
    (cli, cwd) => {
      calls.push(`${cli} em ${cwd}`)
      return new FakePty()
    },
    () => '/projetos/loja',
  )
  terminals.open('qa', 80, 24)
  assert.deepEqual(calls, ['gemini em /projetos/loja'])
  assert.match(registry.get('qa')!.message, /\/projetos\/loja/)
})