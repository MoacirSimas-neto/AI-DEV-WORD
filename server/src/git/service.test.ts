import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { GitService, parseRemotes, parseStatus, sanitizeRemoteUrl } from './service.ts'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
const tempDir = (name: string) => realpathSync.native(mkdtempSync(path.join(tmpdir(), `aidw-${name}-`)))

/** Repositório de verdade numa pasta temporária, com identidade local de teste. */
function makeRepo() {
  const dir = tempDir('git')
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.name', 'Teste')
  git(dir, 'config', 'user.email', 'teste@example.com')
  git(dir, 'config', 'commit.gpgsign', 'false')
  return dir
}

test('parseStatus lê branch, upstream, contadores e arquivos', () => {
  const status = parseStatus(
    ['## main...origin/main [ahead 2, behind 1]', 'M  pronto.ts', ' M mexido.ts', 'MM ambos.ts', '?? novo.ts', 'R  depois.ts', 'antes.ts', ''].join('\0'),
  )
  assert.equal(status.branch, 'main')
  assert.equal(status.upstream, 'origin/main')
  assert.deepEqual([status.ahead, status.behind], [2, 1])
  assert.deepEqual(
    status.files.map((f) => `${f.path}:${f.staged ? 'S' : '-'}${f.unstaged ? 'U' : '-'}`),
    ['pronto.ts:S-', 'mexido.ts:-U', 'ambos.ts:SU', 'novo.ts:-U', 'depois.ts:S-'],
  )
})

test('parseStatus entende repositório sem commits e HEAD destacado', () => {
  assert.equal(parseStatus('## No commits yet on main\0').branch, 'main')
  assert.equal(parseStatus('## HEAD (no branch)\0').branch, null)
})

test('pasta comum não é repositório', async () => {
  assert.equal((await new GitService().status(tempDir('plain'))).isRepo, false)
})

test('fluxo completo: alteração, diff, preparar, tirar, commit', async () => {
  const service = new GitService()
  const repo = makeRepo()
  writeFileSync(path.join(repo, 'ola.txt'), 'primeira linha\n')

  let status = await service.status(repo)
  assert.deepEqual(status.files, [{ path: 'ola.txt', code: '??', staged: false, unstaged: true }])
  assert.match(await service.diff(repo, 'ola.txt', false), /\+primeira linha/)

  await service.stage(repo, ['ola.txt'])
  assert.equal((await service.status(repo)).files[0].staged, true)
  assert.match(await service.diff(repo, 'ola.txt', true), /\+primeira linha/)

  await service.unstage(repo, ['ola.txt']) // antes do primeiro commit
  assert.equal((await service.status(repo)).files[0].staged, false)

  await service.stage(repo, ['ola.txt'])
  assert.match(await service.commit(repo, '  Primeiro commit  '), /^[0-9a-f]+ Primeiro commit$/)
  status = await service.status(repo)
  assert.deepEqual(status.files, [])

  writeFileSync(path.join(repo, 'ola.txt'), 'primeira linha\nsegunda linha\n')
  assert.match(await service.diff(repo, 'ola.txt', false), /\+segunda linha/)
  await service.stage(repo, ['ola.txt'])
  await service.unstage(repo, ['ola.txt']) // depois do primeiro commit
  assert.deepEqual((await service.status(repo)).files, [{ path: 'ola.txt', code: ' M', staged: false, unstaged: true }])
})

test('commit sem mensagem e caminhos fora do projeto são recusados', async () => {
  const service = new GitService()
  const repo = makeRepo()
  await assert.rejects(service.commit(repo, '   '), /mensagem/)
  await assert.rejects(service.stage(repo, ['../fora.txt']), /fora do projeto/)
  await assert.rejects(service.diff(repo, path.join(repo, '..', 'x'), false), /fora do projeto/)
})

test('push exige a prévia, vale uma vez e é invalidado se o repositório mudar', async () => {
  const service = new GitService()
  const remote = tempDir('remote')
  git(remote, 'init', '-q', '--bare', '-b', 'main')
  const repo = makeRepo()
  git(repo, 'remote', 'add', 'origin', remote)
  writeFileSync(path.join(repo, 'a.txt'), 'a\n')
  await service.stage(repo, ['a.txt'])
  await service.commit(repo, 'Commit A')

  await assert.rejects(service.push(repo, 'token-inventado'), /expirou ou o repositório mudou/)

  // Prévia feita, mas um commit novo entra antes da confirmação: token deixa de valer.
  const stale = await service.previewPush(repo)
  assert.equal(stale.target, 'origin/main')
  assert.equal(stale.setsUpstream, true)
  assert.equal(stale.commits.length, 1)
  writeFileSync(path.join(repo, 'b.txt'), 'b\n')
  await service.stage(repo, ['b.txt'])
  await service.commit(repo, 'Commit B')
  await assert.rejects(service.push(repo, stale.token), /expirou ou o repositório mudou/)
  assert.equal(git(remote, 'branch', '--list').trim(), '') // nada chegou ao remoto

  const preview = await service.previewPush(repo)
  assert.equal(preview.commits.length, 2)
  await service.push(repo, preview.token)
  assert.match(git(remote, 'log', '--format=%s', 'main'), /Commit B\nCommit A/)

  await assert.rejects(service.push(repo, preview.token), /expirou/) // uso único
  await assert.rejects(service.previewPush(repo), /Nada para enviar/)
})

test('parseRemotes distingue configurado, sem remote e sanitiza credenciais na URL', () => {
  assert.deepEqual(parseRemotes({ code: 0, stdout: '' }), {
    remoteState: 'none',
    remoteName: null,
    remoteUrl: null,
  })

  assert.deepEqual(parseRemotes({ code: 128, stdout: '' }), {
    remoteState: 'unknown',
    remoteName: null,
    remoteUrl: null,
  })

  const configured = parseRemotes({
    code: 0,
    stdout:
      'origin\thttps://user:ghp_secretToken123@github.com/org/repo.git (fetch)\norigin\thttps://user:ghp_secretToken123@github.com/org/repo.git (push)\n',
  })
  assert.equal(configured.remoteState, 'configured')
  assert.equal(configured.remoteName, 'origin')
  assert.equal(configured.remoteUrl, 'https://github.com/org/repo.git')
  assert.ok(!configured.remoteUrl?.includes('ghp_secretToken123'))

  assert.equal(sanitizeRemoteUrl('git@github.com:org/repo.git'), 'git@github.com:org/repo.git')
})


test('log, branches, commitDetail e proteção contra hash inválido', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidw-git-hist-'))
  try {
    const git = new GitService()
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })

    assert.deepEqual(await git.log(dir), [])
    writeFileSync(path.join(dir, 'a.txt'), 'hello\n')
    await git.stage(dir, ['a.txt'])
    await git.commit(dir, 'feat: initial commit')

    const entries = await git.log(dir, 10)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].subject, 'feat: initial commit')

    const branches = await git.branches(dir)
    assert.equal(branches.length, 1)
    assert.equal(branches[0].name, 'main')
    assert.equal(branches[0].current, true)

    const detail = await git.commitDetail(dir, entries[0].hash)
    assert.deepEqual(detail.files, ['a.txt'])
    assert.match(detail.diff, /\+hello/)

    await assert.rejects(() => git.commitDetail(dir, '--exec=evil'), /Hash de commit inválido/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('diff detecta arquivo binário sem renderizar bytes crus', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidw-git-bin-'))
  try {
    const git = new GitService()
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    writeFileSync(path.join(dir, 'img.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff]))
    await git.stage(dir, ['img.bin'])
    const diff = await git.diff(dir, 'img.bin', true)
    assert.match(diff, /Arquivo binário/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
