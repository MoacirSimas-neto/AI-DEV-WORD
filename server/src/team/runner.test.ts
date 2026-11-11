import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { AgentRegistry, DEFAULT_AGENTS } from '../agents/registry.ts'
import { GitService } from '../git/service.ts'
import { HistoryStore } from '../history/store.ts'
import { ProjectStore } from '../projects/store.ts'
import { TaskStore } from '../tasks/store.ts'
import { TeamRunner } from './runner.ts'

test('TeamRunner fluxo completo: planejar -> aprovar -> desenvolver -> revisar', async () => {
  const tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-team-test-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp })
  writeFileSync(path.join(tmp, 'init.txt'), 'init')
  execFileSync('git', ['add', '.'], { cwd: tmp })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmp })

  const projects = new ProjectStore(':memory:')
  projects.add(tmp)
  const activeProj = projects.active()!

  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))
  for (const a of registry.list()) await registry.check(a.id)

  const calls: string[] = []
  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    git: new GitService(),
    launch: (cli, _args, _options) => {
      calls.push(cli)
      if (cli === 'codex') {
        // Simula o dev alterando um arquivo
        writeFileSync(path.join(tmp, 'app.ts'), 'export const x = 1;')
      }
      const isQa = calls.filter((c) => c === 'gemini').length === 2
      return {
        done: Promise.resolve({
          code: 0,
          stdout: isQa ? 'Revisão feita.\nVEREDITO: APROVADO' : 'Etapa concluída',
          stderr: '',
          timedOut: false,
        }),
        kill: () => {},
      }
    },
  })

  const task = tasks.create(activeProj.id, {
    title: 'Criar app.ts',
    description: 'Modulo principal',
    priority: 'high',
    status: 'todo',
    agentId: 'architect',
  })

  const mission = await runner.start(task.id)
  assert.equal(mission.phase, 'planning')

  // Espera a fase de planejamento terminar (assincrona)
  for (let i = 0; i < 50; i++) {
    const m = tasks.getMission(mission.id)!
    if (m.phase === 'awaiting_approval') break
    await new Promise((r) => setTimeout(r, 20))
  }

  const awaiting = tasks.getMission(mission.id)!
  assert.equal(awaiting.phase, 'awaiting_approval')
  assert.ok(awaiting.plan.includes('Etapa concluída'))

  // Aprova o plano
  await runner.approve(mission.id)

  // Espera desenvolvimento e revisao
  for (let i = 0; i < 50; i++) {
    const m = tasks.getMission(mission.id)!
    if (m.phase === 'done') break
    await new Promise((r) => setTimeout(r, 20))
  }

  const finished = tasks.getMission(mission.id)!
  assert.equal(finished.phase, 'done')
  assert.equal(finished.verdict, 'approved')
  assert.deepEqual(finished.files, ['app.ts'])

  // Chamadas ocorreram na ordem exata: gemini (arquiteto) -> codex (dev) -> gemini (qa)
  assert.deepEqual(calls, ['gemini', 'codex', 'gemini'])
})
