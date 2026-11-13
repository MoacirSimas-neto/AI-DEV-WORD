import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { executeGuidedInstall } from './toolSetupCatalog.ts'

test('toolSetupCatalog: recusa ferramenta desconhecida e instalação sem consentimento', async () => {
  const unknown = await executeGuidedInstall('rm -rf /', { confirmed: true })
  assert.equal(unknown.httpStatus, 400)
  assert.equal(unknown.result.status, 'failed')

  const unconfirmed = await executeGuidedInstall('codex', { confirmed: false })
  assert.equal(unconfirmed.httpStatus, 400)
  assert.equal(unconfirmed.result.status, 'cancelled')
})

test('toolSetupCatalog: recusa sobrescrever ferramenta já instalada', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aidw-setup-exists-'))
  try {
    const ext = process.platform === 'win32' ? '.cmd' : ''
    writeFileSync(
      path.join(dir, `git${ext}`),
      process.platform === 'win32' ? '@echo off\r\necho git version 2.47.0\r\n' : '#!/bin/sh\necho "git version 2.47.0"\n',
      { mode: 0o755 }
    )
    const res = await executeGuidedInstall('git', { confirmed: true, simulatedDir: dir })
    assert.equal(res.httpStatus, 200)
    assert.equal(res.result.status, 'already_installed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('toolSetupCatalog: instala ferramenta simulada com argumentos fixos e reverifica', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aidw-setup-ok-'))
  try {
    const ext = process.platform === 'win32' ? '.cmd' : ''
    const res = await executeGuidedInstall('codex', {
      confirmed: true,
      simulatedDir: dir,
      runner: async (_cmd, args) => {
        assert.ok(args.includes('@openai/codex'))
        writeFileSync(
          path.join(dir, `codex${ext}`),
          process.platform === 'win32' ? '@echo off\r\necho codex-cli 0.1.0\r\n' : '#!/bin/sh\necho "codex-cli 0.1.0"\n',
          { mode: 0o755 }
        )
        return { stdout: 'ok', stderr: '' }
      },
    })
    assert.equal(res.httpStatus, 200)
    assert.equal(res.result.status, 'completed')
    assert.equal(res.result.diagnostic?.status, 'needs_auth')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
