import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { GUARD_FLAG, GUARD_SCRIPT, ProcessSupervisor, setSupervisor, SUPERVISOR_ENV } from './supervisor.ts'
import { planSpawn, startCli } from './run.ts'

// Só processos criados por este teste, em pastas descartáveis. Nenhum CLI real é chamado.
const dir = mkdtempSync(path.join(tmpdir(), 'aidw-guard-'))
const spawned: ChildProcess[] = []
after(() => {
  for (const p of spawned) if (p.exitCode === null) p.kill('SIGKILL')
  rmSync(dir, { recursive: true, force: true })
})

const HEARTBEAT = path.join(dir, 'heartbeat.mjs')
writeFileSync(
  HEARTBEAT,
  `import { appendFileSync } from 'node:fs'
const file = process.argv[2]
appendFileSync(file, 'start\\n'); console.log('UP')
setInterval(() => appendFileSync(file, Date.now() + '\\n'), 100)
`,
)
const ECHO = path.join(dir, 'echo.mjs')
writeFileSync(ECHO, `let s = ''; process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => { console.log('got:' + s); process.exit(3) })\n`)
const MARK = path.join(dir, 'mark.mjs')
writeFileSync(MARK, `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], 'iniciou')\n`)
// Shim .cmd como os CLIs instalados via npm no Windows (cmd.exe -> node: o CLI é neto).
const SHIM = path.join(dir, 'fakecli.cmd')
writeFileSync(SHIM, `@node "${HEARTBEAT}" %*\r\n`)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const size = (file: string) => (existsSync(file) ? statSync(file).size : 0)
/** O arquivo parou de crescer = o processo que escreve nele morreu. */
async function stopped(file: string) {
  await sleep(1500)
  const a = size(file)
  await sleep(700)
  return size(file) === a
}
async function growing(file: string) {
  const a = size(file)
  await sleep(500)
  return size(file) > a
}
const waitFor = async (cond: () => boolean, label: string, ms = 8000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`tempo esgotado: ${label}`)
    await sleep(50)
  }
}
const MODULE = (f: string) => JSON.stringify(pathToFileURL(path.join(import.meta.dirname, f)).href)

/** "Backend" descartável: instala o supervisor e inicia um CLI guardado (headless ou PTY). */
function fakeBackend(mode: 'headless' | 'pty', executable: string, args: string[]) {
  const script = `
    import { ProcessSupervisor, setSupervisor } from ${MODULE('supervisor.ts')}
    import { planSpawn, startCli } from ${MODULE('run.ts')}
    import { spawnGuardedPty } from ${MODULE('../terminal/spawnPty.ts')}
    setSupervisor(await ProcessSupervisor.start())
    if (${JSON.stringify(mode)} === 'pty') {
      const term = spawnGuardedPty(planSpawn(${JSON.stringify(executable)}, ${JSON.stringify(args)}), ${JSON.stringify(dir)}, 80, 24, 'teste-pty')
      term.onData(() => {})
    } else {
      startCli(${JSON.stringify(executable)}, ${JSON.stringify(args)}, { cwd: ${JSON.stringify(dir)}, label: 'teste' })
    }
    console.log('READY')
    setInterval(() => {}, 1000)
  `
  const proc = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] })
  spawned.push(proc)
  return proc
}

test('guardado: entrada, saída e código de saída chegam como antes', async () => {
  const supervisor = await ProcessSupervisor.start()
  setSupervisor(supervisor)
  try {
    const run = startCli(process.execPath, [ECHO], { cwd: dir, input: 'olá', label: 'eco' })
    assert.equal(run.guarded, true)
    const result = await run.done
    assert.equal(result.code, 3)
    assert.match(result.stdout, /got:olá/)
  } finally {
    setSupervisor(null)
    await supervisor.close()
  }
})

test('cancelamento pelo backend encerra o CLI guardado e o supervisor identifica o processo', async () => {
  const supervisor = await ProcessSupervisor.start()
  setSupervisor(supervisor)
  const beat = path.join(dir, 'cancel.log')
  try {
    const run = startCli(process.execPath, [HEARTBEAT, beat], { cwd: dir, label: 'missão #9 · dev · codex' })
    await waitFor(() => size(beat) > 0, 'CLI iniciou')
    await waitFor(() => supervisor.processes()[0]?.childPid !== null && supervisor.processes().length === 1, 'pid do CLI registrado')
    const [proc] = supervisor.processes()
    assert.equal(proc.label, 'missão #9 · dev · codex')
    assert.ok(proc.guardPid && proc.childPid)
    run.kill()
    await run.done
    assert.ok(await stopped(beat), 'o CLI parou de escrever')
  } finally {
    setSupervisor(null)
    await supervisor.close()
  }
})

for (const mode of ['headless', 'pty'] as const) {
  test(`backend encerrado à força (${mode}): o CLI guardado para; processo alheio continua`, async () => {
    const mine = path.join(dir, `mine-${mode}.log`)
    const foreign = path.join(dir, `foreign-${mode}.log`)
    // Um "CLI do usuário" iniciado fora do app: nada pode encerrá-lo.
    const userCli = spawn(process.execPath, [HEARTBEAT, foreign], { stdio: 'ignore' })
    spawned.push(userCli)
    const backend = fakeBackend(mode, process.execPath, [HEARTBEAT, mine])
    await waitFor(() => size(mine) > 0 && size(foreign) > 0, 'processos rodando')
    assert.ok(await growing(mine))

    backend.kill('SIGKILL') // sem handler de shutdown
    assert.ok(await stopped(mine), 'o CLI do app não ficou órfão escrevendo')
    assert.ok(await growing(foreign), 'o processo alheio não foi encerrado')
    userCli.kill('SIGKILL')
  })
}

if (process.platform === 'win32') {
  for (const mode of ['headless', 'pty'] as const) {
    test(`Windows (${mode}): shim .cmd (cmd.exe -> node) é encerrado inteiro quando o backend cai`, async () => {
      // O shim recebe só tokens simples (planSpawn): o arquivo é relativo à pasta do teste.
      const name = `shim-${mode}.log`
      const backend = fakeBackend(mode, SHIM, [name])
      await waitFor(() => size(path.join(dir, name)) > 0, 'shim rodando')
      backend.kill('SIGKILL')
      assert.ok(await stopped(path.join(dir, name)), 'o neto (node) não sobreviveu ao cmd.exe')
    })
  }
}

test('guardião sem supervisor ou com token desconhecido não inicia o CLI', async () => {
  const run = (env: NodeJS.ProcessEnv, token: string) =>
    new Promise<number | null>((resolve) => {
      const p = spawn(process.execPath, ['--no-warnings', GUARD_SCRIPT, GUARD_FLAG, token], { env: { ...process.env, ...env }, stdio: 'ignore' })
      spawned.push(p)
      p.on('exit', resolve)
    })
  const supervisor = await ProcessSupervisor.start()
  try {
    // Token que o supervisor nunca emitiu: a especificação não é entregue.
    assert.equal(await run({ [SUPERVISOR_ENV]: supervisor.address }, 'token-inventado'), 70)
    const marker = path.join(dir, 'nao-deveria-existir.txt')
    supervisor.register({ ...planSpawn(process.execPath, [MARK, marker]) }, 'x')
    // Sem endereço do supervisor: falha fechada.
    assert.equal(await run({ [SUPERVISOR_ENV]: '' }, 'qualquer'), 70)
    assert.equal(existsSync(marker), false)
  } finally {
    await supervisor.close()
  }
})
