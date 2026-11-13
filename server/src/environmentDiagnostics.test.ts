import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { probeTool, runEnvironmentDiagnostics } from './environmentDiagnostics.ts'

test('environmentDiagnostics: detecta Git e CLIs simuladas sem iniciar sessão de IA', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aidw-diag-'))
  try {
    const ext = process.platform === 'win32' ? '.cmd' : ''
    const makeShim = (name: string, out: string) => {
      const p = path.join(dir, `${name}${ext}`)
      const body =
        process.platform === 'win32'
          ? `@echo off\r\necho ${out}\r\n`
          : `#!/bin/sh\necho "${out}"\n`
      writeFileSync(p, body, { mode: 0o755 })
    }

    makeShim('git', 'git version 2.47.0')
    makeShim('codex', 'codex-cli 0.1.0')

    const result = await runEnvironmentDiagnostics({ simulatedDir: dir, timeoutMs: 2500 })
    const byId = Object.fromEntries(result.tools.map((t) => [t.id, t]))

    assert.equal(byId.git.status, 'ready')
    assert.match(byId.git.version ?? '', /2\.47\.0/)
    assert.equal(byId.codex.status, 'needs_auth')
    assert.match(byId.codex.version ?? '', /0\.1\.0/)
    assert.equal(byId.gemini.status, 'not_installed')
    assert.equal(byId.claude.status, 'not_installed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('environmentDiagnostics: trata falha de execução e timeout com segurança', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aidw-diag-err-'))
  try {
    const ext = process.platform === 'win32' ? '.cmd' : ''
    const failPath = path.join(dir, `codex${ext}`)
    writeFileSync(
      failPath,
      process.platform === 'win32' ? '@echo off\r\nexit /b 1\r\n' : '#!/bin/sh\nexit 1\n',
      { mode: 0o755 }
    )

    const failed = await probeTool(
      {
        id: 'codex',
        name: 'Codex CLI',
        command: 'codex',
        purpose: 'Teste',
        relevance: 'optional',
        requiresAuth: true,
      },
      { simulatedDir: dir, timeoutMs: 2000 }
    )
    assert.equal(failed.status, 'error')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
