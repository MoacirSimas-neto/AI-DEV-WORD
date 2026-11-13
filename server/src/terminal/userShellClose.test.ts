import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { AgentRegistry, DEFAULT_AGENTS } from '../agents/registry.ts'
import { TerminalManager } from './manager.ts'
import { spawnShellPty } from './spawnPty.ts'

// Fechar uma aba pessoal com comando rodando: shell real, sem CLI de IA.

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('fechar terminal com comando ativo: shell e processo filho morrem, a lista esvazia e nada renasce', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-close-'))
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: 'v1', auth: 'ok' }))
  const noAgent = () => {
    throw new Error('nenhum CLI de agente neste teste')
  }
  const terminals = new TerminalManager(registry, noAgent, () => dir, { spawnShell: spawnShellPty })
  let out = ''
  let exited = false
  const lists: string[][] = []
  terminals.on('data', (_id: string, data: string) => (out += data))
  terminals.on('exit', () => (exited = true))
  terminals.on('sessions', (ids: string[]) => lists.push(ids))
  try {
    terminals.open('user:1', 200, 24)
    terminals.open('user:2', 200, 24)
    for (let i = 0; i < 100 && out === ''; i++) await sleep(100)
    await sleep(1000)

    // Os PIDs só aparecem na saída do comando, não no eco do que foi digitado.
    terminals.write(
      'user:1',
      process.platform === 'win32'
        ? `$p = Start-Process ping -ArgumentList '-n 120 127.0.0.1' -NoNewWindow -PassThru; "PIDS:$($PID):$($p.Id):"; Wait-Process -Id $p.Id\r`
        : `sleep 120 & echo "PIDS:$$:$!:"; wait\r`,
    )
    let pids: number[] = []
    for (let i = 0; i < 150 && pids.length === 0; i++) {
      await sleep(100)
      const found = /PIDS:(\d+):(\d+):/.exec(out)
      if (found) pids = [Number(found[1]), Number(found[2])]
    }
    assert.equal(pids.length, 2, 'o shell real informou o próprio PID e o do comando em execução')
    assert.ok(pids.every(alive), 'shell e comando rodando antes de fechar')

    terminals.close('user:1')
    for (let i = 0; i < 100 && (!exited || pids.some(alive)); i++) await sleep(100)
    assert.equal(exited, true)
    assert.deepEqual(pids.filter(alive), [], 'nenhum processo órfão')
    assert.deepEqual(terminals.userShells(), ['user:2'], 'a outra aba continua viva')
    assert.deepEqual(lists.at(-1), ['user:2'], 'a lista enviada às telas não traz a sessão encerrada')

    terminals.close('user:2')
    for (let i = 0; i < 100 && terminals.userShells().length > 0; i++) await sleep(100)
    await sleep(300)
    assert.deepEqual(terminals.userShells(), [], 'fechar a última não cria outra sessão')
  } finally {
    terminals.closeAll()
    await sleep(300)
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
})
