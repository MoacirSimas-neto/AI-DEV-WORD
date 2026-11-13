import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { AgentRegistry, DEFAULT_AGENTS } from '../agents/registry.ts'
import { GitService } from '../git/service.ts'
import { type PtyLike, TerminalManager } from './manager.ts'
import { spawnShellPty } from './spawnPty.ts'

// Terminal pessoal (Etapa 14.6): sessões `user:<n>`, independentes dos agentes.

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
    this.exitListener({ exitCode: 0 })
  }
  output(data: string) {
    this.dataListener(data)
  }
}

function setup(cwd: string | null = tmpdir(), withShell = true) {
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: 'v1', auth: 'ok' }))
  const ptys: FakePty[] = []
  const shellCwds: string[] = []
  const sessions: string[][] = []
  const state = { agentSpawns: 0, failShell: false }
  const terminals = new TerminalManager(
    registry,
    () => {
      state.agentSpawns++
      return new FakePty()
    },
    () => cwd,
    withShell
      ? {
          spawnShell: (dir) => {
            if (state.failShell) throw new Error('shell ausente')
            shellCwds.push(dir)
            ptys.push(new FakePty())
            return ptys.at(-1)!
          },
        }
      : {},
  )
  terminals.on('sessions', (ids: string[]) => sessions.push(ids))
  return { registry, terminals, ptys, shellCwds, sessions, state }
}

test('nasce na pasta do projeto ativo, sem CLI de agente e sem comando inicial', () => {
  const { terminals, ptys, shellCwds, sessions, state } = setup()
  assert.equal(terminals.open('user:1', 80, 24), '')
  assert.deepEqual(shellCwds, [tmpdir()])
  assert.equal(state.agentSpawns, 0)
  assert.deepEqual(ptys[0].written, [], 'nada é digitado no shell ao criar a sessão')
  assert.deepEqual(sessions.at(-1), ['user:1'])
  assert.deepEqual(terminals.userShells(), ['user:1'])
})

test('entrada, saída, Ctrl+C, redimensionamento e isolamento entre abas', () => {
  const { terminals, ptys } = setup()
  const seen: string[] = []
  terminals.on('data', (id: string, data: string) => seen.push(`${id}:${data}`))
  terminals.open('user:1', 80, 24)
  terminals.open('user:2', 80, 24)

  terminals.write('user:2', 'git status\r')
  assert.deepEqual(ptys[0].written, [])
  assert.deepEqual(ptys[1].written, ['git status\r'])

  terminals.write('user:1', '\x03')
  assert.deepEqual(ptys[0].written, ['\x03'])

  ptys[0].output('saida-da-aba-1\n')
  assert.deepEqual(seen, ['user:1:saida-da-aba-1\n'])

  terminals.resize('user:1', 120, 30)
  assert.equal(ptys[0].size, '120x30')
  assert.equal(ptys[1].size, '')
})

test('recolher e restaurar reaproveita a sessão e a saída acumulada', () => {
  const { terminals, ptys } = setup()
  terminals.open('user:1', 80, 24)
  ptys[0].output('prompt> \n')
  assert.equal(terminals.open('user:1', 100, 20), 'prompt> \n')
  assert.equal(ptys.length, 1, 'nenhum processo duplicado')
  assert.equal(ptys[0].size, '100x20')
})

test('encerrar mata o processo, avisa a lista antes do exit e não reinicia sozinho', () => {
  const { terminals, ptys, sessions } = setup()
  const order: string[] = []
  terminals.open('user:1', 80, 24)
  terminals.open('user:2', 80, 24)
  terminals.on('sessions', () => order.push('sessions'))
  terminals.on('exit', (id: string) => order.push(`exit:${id}`))

  terminals.close('user:2')
  assert.deepEqual(order, ['sessions', 'exit:user:2'])
  assert.deepEqual(sessions.at(-1), ['user:1'])
  assert.equal(ptys.length, 2, 'nada foi reiniciado')

  terminals.closeAll()
  assert.deepEqual(terminals.userShells(), [])
})

test('sem projeto ativo, pasta inexistente ou backend sem shell: recusado sem criar processo', () => {
  assert.throws(() => setup(null).terminals.open('user:1', 80, 24), /Escolha um projeto/)

  const gone = setup(path.join(tmpdir(), 'aidw-pasta-inexistente-14-6'))
  assert.throws(() => gone.terminals.open('user:1', 80, 24), /existe mais/)
  assert.equal(gone.ptys.length, 0)

  const noShell = setup(tmpdir(), false)
  assert.throws(() => noShell.terminals.open('user:1', 80, 24), /Terminal pessoal indispon/)
  assert.equal(noShell.state.agentSpawns, 0)
})

test('falha ao abrir o shell não deixa sessão fantasma', () => {
  const { terminals, state, sessions } = setup()
  state.failShell = true
  assert.throws(() => terminals.open('user:1', 80, 24), /shell ausente/)
  assert.deepEqual(terminals.userShells(), [])
  assert.deepEqual(sessions, [])
})

test('ids fora do formato não viram shell, e há limite de abas', () => {
  const { terminals, ptys } = setup()
  for (const id of ['user:', 'user:0', 'user:abc', 'user:1; calc', 'user:1234', 'USER:1', 'user:../x']) {
    assert.throws(() => terminals.open(id, 80, 24), /Agente desconhecido/, id)
  }
  assert.equal(ptys.length, 0)
  for (let n = 1; n <= 8; n++) terminals.open(`user:${n}`, 80, 24)
  assert.throws(() => terminals.open('user:9', 80, 24), /Limite de 8/)
})

test('não mexe no estado dos agentes; sessão de agente continua exigindo agente conhecido', async () => {
  const { registry, terminals, ptys } = setup()
  await registry.check('dev')
  const before = JSON.stringify(registry.list())
  terminals.open('user:1', 80, 24)
  ptys[0].output('trabalhando')
  terminals.close('user:1')
  assert.equal(JSON.stringify(registry.list()), before)
  assert.throws(() => terminals.open('agente-de-outro-contexto', 80, 24), /Agente desconhecido/)
})

// Shell de verdade numa pasta temporária: prova que o terminal é real (não simulado) e que o
// Git Control passa a ver o repositório depois de um `git init` digitado pelo usuário.
test('shell real: nasce na pasta, executa o git init digitado e o Git Control enxerga', { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidw-shell-'))
  const git = new GitService()
  assert.equal((await git.status(dir)).isRepo, false)
  const term = spawnShellPty(dir, 80, 24)
  let output = ''
  try {
    term.onData((data) => (output += data))
    const until = async (done: () => boolean, what: string) => {
      for (let i = 0; i < 400 && !done(); i++) await sleep(100)
      assert.ok(done(), `${what}\n--- saída ---\n${output}`)
    }
    await until(() => output.length > 0, 'o shell não escreveu nada')
    await sleep(1500)
    assert.equal(existsSync(path.join(dir, '.git')), false, 'nada roda sozinho ao abrir a sessão')

    term.write('git init\r')
    await until(() => existsSync(path.join(dir, '.git', 'HEAD')), 'git init não criou o repositório na pasta inicial')
    assert.equal((await git.status(dir)).isRepo, true)
  } finally {
    term.kill()
    await sleep(800)
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  }
})

// Etapa 14.6.1: controle de fluxo PTY -> clientes.

class PausablePty extends FakePty {
  paused = false
  pauses = 0
  pause() {
    this.paused = true
    this.pauses++
  }
  resume() {
    this.paused = false
  }
}

test('controle de fluxo: fila do cliente cheia pausa o PTY uma vez e ele volta quando a fila baixa', async () => {
  const { registry } = setup()
  const pty = new PausablePty()
  const terminals = new TerminalManager(registry, () => new FakePty(), () => tmpdir(), { spawnShell: () => pty })
  let queued = 0
  terminals.backlog = () => queued
  terminals.open('user:1', 80, 24)

  pty.output('normal\n')
  assert.equal(pty.paused, false, 'fila vazia: nada é pausado')

  queued = 5_000_000
  pty.output('enxurrada\n')
  pty.output('mais\n')
  assert.equal(pty.paused, true)
  assert.equal(pty.pauses, 1)
  await sleep(120)
  assert.equal(pty.paused, true, 'fila ainda cheia: continua pausado')

  queued = 0
  await sleep(120)
  assert.equal(pty.paused, false)
  terminals.closeAll()
})

test('controle de fluxo: encerrar uma sessão pausada libera o PTY e não deixa temporizador', () => {
  const { registry } = setup()
  const pty = new PausablePty()
  const terminals = new TerminalManager(registry, () => new FakePty(), () => tmpdir(), { spawnShell: () => pty })
  terminals.backlog = () => 5_000_000
  terminals.open('user:1', 80, 24)
  pty.output('x')
  assert.equal(pty.paused, true)
  terminals.close('user:1')
  assert.equal(pty.paused, false)
  assert.deepEqual(terminals.userShells(), [])
  // Se sobrasse um setInterval, o processo de teste não terminaria.
})

test('controle de fluxo com shell real: pausado não perde o fim da sessão', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-flow-'))
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: 'v1', auth: 'ok' }))
  const terminals = new TerminalManager(registry, () => new FakePty(), () => dir, { spawnShell: spawnShellPty })
  let exited = false
  let chars = 0
  terminals.on('exit', () => (exited = true))
  terminals.on('data', (_id: string, data: string) => (chars += data.length))
  try {
    terminals.open('user:1', 80, 24)
    for (let i = 0; i < 100 && chars === 0; i++) await sleep(100)
    assert.ok(chars > 0, 'o shell real respondeu')

    terminals.backlog = () => 5_000_000 // cliente travado
    terminals.write('user:1', 'echo pausa\r')
    await sleep(1500)
    const frozen = chars
    await sleep(500)
    assert.equal(chars, frozen, 'PTY real pausado: nenhuma saída nova chega')

    terminals.close('user:1')
    for (let i = 0; i < 100 && !exited; i++) await sleep(100)
    assert.equal(exited, true)
  } finally {
    terminals.closeAll()
    await sleep(300)
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
})
