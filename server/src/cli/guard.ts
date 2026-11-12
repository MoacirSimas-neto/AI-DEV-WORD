// Guardião de um CLI. Uso: node guard.ts --aidw-guard <token>  (com AIDW_SUPERVISOR no ambiente)
//
// 1. Conecta ao supervisor do backend ANTES de iniciar qualquer coisa (sem supervisor, não inicia).
// 2. Recebe a especificação do comando pelo canal (o prompt não aparece na linha de comando dele).
// 3. Inicia o CLI herdando a entrada/saída (pipes no modo headless, o terminal no modo PTY).
// 4. Se o canal cair (backend encerrado, mesmo à força), encerra a árvore do CLI e sai.
//    Só encerra os processos que ele mesmo criou: nunca procura processos por nome.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import net from 'node:net'

const CONNECT_TIMEOUT_MS = 5000
const EXIT_NO_SUPERVISOR = 70
const EXIT_SUPERVISOR_LOST = 137

const token = process.argv[process.argv.indexOf('--aidw-guard') + 1]
const address = process.env.AIDW_SUPERVISOR
let child: ChildProcess | null = null
let finished = false

const fail = (message: string, code: number) => {
  process.stderr.write(`[AI Dev World] ${message}\n`)
  process.exit(code)
}

function killTree() {
  if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    // /T segue a árvore a partir do PID do próprio filho (cmd.exe -> node -> ...).
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    // O guardião lidera o próprio grupo de processos (iniciado com detached ou pelo PTY).
    try {
      process.kill(-process.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

const supervisorLost = () => {
  if (finished) return
  finished = true
  killTree()
  process.exit(EXIT_SUPERVISOR_LOST)
}

// Ctrl+C no terminal é para o CLI, não para o guardião (sem isto ele sairia e deixaria o CLI sem guarda).
process.on('SIGINT', () => {})
for (const signal of ['SIGTERM', 'SIGHUP'] as const) process.on(signal, supervisorLost)

if (!token || !address) fail('guardião sem supervisor: o CLI não foi iniciado.', EXIT_NO_SUPERVISOR)

const socket = net.connect(address!)
const timer = setTimeout(() => {
  socket.destroy()
  fail('supervisor indisponível: o CLI não foi iniciado.', EXIT_NO_SUPERVISOR)
}, CONNECT_TIMEOUT_MS)
socket.setEncoding('utf8')
socket.on('error', () => (child ? supervisorLost() : fail('supervisor indisponível: o CLI não foi iniciado.', EXIT_NO_SUPERVISOR)))
socket.on('close', () => (child ? supervisorLost() : fail('supervisor recusou a execução: o CLI não foi iniciado.', EXIT_NO_SUPERVISOR)))
socket.on('connect', () => socket.write(JSON.stringify({ token, pid: process.pid }) + '\n'))

let buffer = ''
socket.on('data', (chunk: string) => {
  if (child) return
  buffer += chunk
  const nl = buffer.indexOf('\n')
  if (nl < 0) return
  clearTimeout(timer)
  const spec = JSON.parse(buffer.slice(0, nl)) as { file: string; args: string[]; verbatim: boolean }
  // O CLI não precisa saber onde está o supervisor.
  const env = { ...process.env }
  delete env.AIDW_SUPERVISOR
  child = spawn(spec.file, spec.args, {
    env,
    stdio: 'inherit',
    windowsHide: true,
    windowsVerbatimArguments: spec.verbatim,
  })
  child.on('error', (error) => fail(`não foi possível iniciar o CLI: ${error.message}`, 127))
  child.on('exit', (code, signal) => {
    finished = true
    socket.end()
    process.exit(code ?? (signal ? 1 : 0))
  })
  socket.write(JSON.stringify({ childPid: child.pid }) + '\n')
})
