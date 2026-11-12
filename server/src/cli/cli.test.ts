import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveCommand } from './resolve.ts'
import { planSpawn } from './run.ts'

test('resolveCommand acha o shim .cmd no PATH do Windows', () => {
  const found = resolveCommand('codex', {
    platform: 'win32',
    env: { Path: 'C:\\Windows;C:\\Users\\eu\\npm' },
    isExecutable: (file) => file === 'C:\\Users\\eu\\npm\\codex.cmd',
  })
  assert.equal(found, 'C:\\Users\\eu\\npm\\codex.cmd')
})

test('resolveCommand acha agy no diretorio padrão do Antigravity no Windows', () => {
  const found = resolveCommand('agy', {
    platform: 'win32',
    env: { Path: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\eu\\AppData\\Local' },
    isExecutable: (file) => file === 'C:\\Users\\eu\\AppData\\Local\\agy\\bin\\agy.exe',
  })
  assert.equal(found, 'C:\\Users\\eu\\AppData\\Local\\agy\\bin\\agy.exe')
})

test('resolveCommand acha o binário no PATH do Linux', () => {
  const found = resolveCommand('gemini', {
    platform: 'linux',
    env: { PATH: '/usr/bin:/home/eu/.local/bin' },
    isExecutable: (file) => file === '/home/eu/.local/bin/gemini',
  })
  assert.equal(found, '/home/eu/.local/bin/gemini')
})

test('resolveCommand devolve null quando o CLI não existe', () => {
  const found = resolveCommand('gemini', {
    platform: 'linux',
    env: { PATH: '/usr/bin' },
    isExecutable: () => false,
  })
  assert.equal(found, null)
})

test('planSpawn embrulha .cmd em cmd.exe no Windows', () => {
  const plan = planSpawn('C:\\Program Files\\npm\\codex.cmd', ['login', 'status'], 'win32', 'cmd.exe')
  assert.deepEqual(plan, {
    file: 'cmd.exe',
    args: ['/d', '/s', '/c', '""C:\\Program Files\\npm\\codex.cmd" login status"'],
    verbatim: true,
  })
})

test('planSpawn executa direto no Linux', () => {
  const plan = planSpawn('/usr/bin/codex', ['--version'], 'linux')
  assert.deepEqual(plan, { file: '/usr/bin/codex', args: ['--version'], verbatim: false })
})

test('planSpawn recusa argumentos com metacaracteres de shell', () => {
  assert.throws(
    () => planSpawn('C:\\npm\\codex.cmd', ['--version & calc segredo-ficticio'], 'win32'),
    { message: 'O shim do CLI não aceita um dos argumentos.' },
  )
})

test('planSpawn executa agy.exe direto no Windows sem cmd.exe', () => {
  const plan = planSpawn('C:\\Users\\eu\\AppData\\Local\\agy\\bin\\agy.exe', ['-p', 'olá mundo'], 'win32')
  assert.deepEqual(plan, {
    file: 'C:\\Users\\eu\\AppData\\Local\\agy\\bin\\agy.exe',
    args: ['-p', 'olá mundo'],
    verbatim: false,
  })
})
