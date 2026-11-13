import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { executeGuidedInstall, issueSetupConsent, TOOL_SETUP_CATALOG } from './toolSetupCatalog.ts'

test('toolSetupCatalog: catálogo usa winget Anthropic.ClaudeCode para Claude Code', () => {
  assert.equal(TOOL_SETUP_CATALOG.claude.installMethod, 'winget')
  assert.equal(TOOL_SETUP_CATALOG.claude.packageRef, 'Anthropic.ClaudeCode')
  assert.equal(TOOL_SETUP_CATALOG.git.packageRef, 'Git.Git')
})

test('toolSetupCatalog: recusa ferramenta desconhecida, consentimento ausente e replay de nonce', async () => {
  const unknown = await executeGuidedInstall('rm -rf /', { consentNonce: 'abc' })
  assert.equal(unknown.httpStatus, 400)

  const missing = await executeGuidedInstall('codex', {})
  assert.equal(missing.httpStatus, 403)
  assert.equal(missing.result.status, 'cancelled')

  const wrongToolConsent = issueSetupConsent('git')!
  const wrongTool = await executeGuidedInstall('codex', { consentNonce: wrongToolConsent.nonce })
  assert.equal(wrongTool.httpStatus, 403)
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
    const consent = issueSetupConsent('git')!
    const res = await executeGuidedInstall('git', { consentNonce: consent.nonce, simulatedDir: dir })
    assert.equal(res.httpStatus, 200)
    assert.equal(res.result.status, 'already_installed')

    const replay = await executeGuidedInstall('git', { consentNonce: consent.nonce, simulatedDir: dir })
    assert.equal(replay.httpStatus, 403)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('toolSetupCatalog: instala ferramenta simulada com nonce de uso único e reverifica', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aidw-setup-ok-'))
  try {
    const ext = process.platform === 'win32' ? '.cmd' : ''
    const consent = issueSetupConsent('codex')!
    const res = await executeGuidedInstall('codex', {
      consentNonce: consent.nonce,
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
