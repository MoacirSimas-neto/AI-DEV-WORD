import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { computeMissionProgress } from '../../../shared/missionProgress.ts'
import type { MissionInfo } from '../../../shared/protocol.ts'
import { AgentConfigStore } from '../agents/configStore.ts'
import { AgentRegistry, DEFAULT_AGENTS } from '../agents/registry.ts'
import { GitService } from '../git/service.ts'
import { HistoryStore } from '../history/store.ts'
import { ProjectStore } from '../projects/store.ts'
import { TaskStore } from '../tasks/store.ts'
import { TeamRunner, getStepCliAndArgs } from './runner.ts'

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

test('TeamRunner aplica configurações dinâmicas de provedor/modelo/esforço e emite git-change pós-dev', async () => {
  const tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-team-cfg-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp })
  writeFileSync(path.join(tmp, 'base.txt'), 'base')
  execFileSync('git', ['add', '.'], { cwd: tmp })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmp })

  const projects = new ProjectStore(':memory:')
  projects.add(tmp)
  const activeProj = projects.active()!

  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const configs = new AgentConfigStore(projects.db)
  configs.set('architect', { provider: 'gemini', model: 'gemini-2.5-pro', reasoningEffort: 'default' })
  configs.set('dev', { provider: 'codex', model: 'gpt-5', reasoningEffort: 'extra-high' })
  configs.set('qa', { provider: 'gemini', model: 'gemini-3.5-flash', reasoningEffort: 'default' })

  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))
  for (const a of registry.list()) await registry.check(a.id)

  const callArgs: { cli: string; args: string[] }[] = []
  let gitChangeEvent: { agentId?: string; files: string[]; summary: string } | null = null

  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    git: new GitService(),
    configs,
    launch: (cli, args, _options) => {
      callArgs.push({ cli, args })
      if (cli === 'codex') {
        writeFileSync(path.join(tmp, 'result.txt'), 'done')
      }
      const isQa = callArgs.filter((c) => c.cli === 'gemini').length === 2
      return {
        done: Promise.resolve({
          code: 0,
          stdout: isQa ? 'Revisão final.\nVEREDITO: APROVADO' : 'Etapa ok',
          stderr: '',
          timedOut: false,
        }),
        kill: () => {},
      }
    },
  })

  runner.on('git-change', (e) => {
    gitChangeEvent = e
  })

  const task = tasks.create(activeProj.id, {
    title: 'Tarefa com modelo dinamico',
    description: 'Teste',
    priority: 'medium',
    status: 'todo',
    agentId: 'architect',
  })

  const mission = await runner.start(task.id)

  for (let i = 0; i < 50; i++) {
    const m = tasks.getMission(mission.id)!
    if (m.phase === 'awaiting_approval') break
    await new Promise((r) => setTimeout(r, 20))
  }

  // Verifica que arquiteto recebeu gemini-2.5-pro
  assert.equal(callArgs[0].cli, 'gemini')
  assert.ok(callArgs[0].args.includes('-m'))
  assert.ok(callArgs[0].args.includes('gemini-2.5-pro'))

  await runner.approve(mission.id)

  for (let i = 0; i < 50; i++) {
    const m = tasks.getMission(mission.id)!
    if (m.phase === 'done') break
    await new Promise((r) => setTimeout(r, 20))
  }

  // Verifica que dev recebeu codex com gpt-5 e model_reasoning_effort=extra-high
  assert.equal(callArgs[1].cli, 'codex')
  assert.ok(callArgs[1].args.includes('-m'))
  assert.ok(callArgs[1].args.includes('gpt-5'))
  assert.ok(callArgs[1].args.includes('-c'))
  assert.ok(callArgs[1].args.includes('model_reasoning_effort=extra-high'))

  // Verifica evento git-change emitido
  const ev = gitChangeEvent as { agentId?: string; files: string[]; summary: string } | null
  assert.ok(ev !== null)
  assert.equal(ev.agentId, 'dev')
  assert.deepEqual(ev.files, ['result.txt'])
  assert.ok(ev.summary.includes('Codex concluiu a implementação'))

  // Verifica que QA recebeu gemini-3.5-flash
  assert.equal(callArgs[2].cli, 'gemini')
  assert.ok(callArgs[2].args.includes('-m'))
  assert.ok(callArgs[2].args.includes('gemini-3.5-flash'))
})

test('getStepCliAndArgs configura Antigravity CLI com --model, --effort e modo correto', () => {
  const planStep = getStepCliAndArgs('planning', {
    agentId: 'architect',
    provider: 'antigravity',
    model: 'gemini-4-argon-high',
    reasoningEffort: 'high',
    updatedAt: '',
  })
  assert.equal(planStep.cli, 'agy')
  assert.equal(planStep.passPromptAsArg, true)
  assert.ok(planStep.args.includes('--model'))
  assert.ok(planStep.args.includes('gemini-4-argon-high'))
  assert.ok(planStep.args.includes('--effort'))
  assert.ok(planStep.args.includes('high'))
  assert.ok(planStep.args.includes('-p'))

  const devStep = getStepCliAndArgs('developing', {
    agentId: 'dev',
    provider: 'antigravity',
    model: 'claude-opus-5-5-high',
    reasoningEffort: 'extra-high',
    updatedAt: '',
  })
  assert.equal(devStep.cli, 'agy')
  assert.ok(devStep.args.includes('--mode'))
  assert.ok(devStep.args.includes('accept-edits'))
  assert.ok(devStep.args.includes('-p'))
})

test('computeMissionProgress calcula 0%, 33%, 67%, 100% apenas por etapas verificadas e nunca 100% em falha', () => {
  const baseMission = (overrides: Partial<MissionInfo>): MissionInfo => ({
    id: 1,
    projectId: 1,
    taskId: 1,
    phase: 'planning',
    plan: '',
    devReport: '',
    review: '',
    verdict: null,
    files: [],
    error: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  })

  const planning = computeMissionProgress(baseMission({ phase: 'planning' }))
  assert.equal(planning.percent, 0)
  assert.equal(planning.completedSteps, 0)
  assert.equal(planning.isRunning, true)

  const awaiting = computeMissionProgress(baseMission({ phase: 'awaiting_approval', plan: 'Plano pronto' }))
  assert.equal(awaiting.percent, 33)
  assert.equal(awaiting.completedSteps, 1)
  assert.equal(awaiting.needsApproval, true)

  const developing = computeMissionProgress(baseMission({ phase: 'developing', plan: 'Plano pronto' }))
  assert.equal(developing.percent, 33)
  assert.equal(developing.completedSteps, 1)
  assert.equal(developing.isRunning, true)

  const reviewing = computeMissionProgress(
    baseMission({ phase: 'reviewing', plan: 'Plano pronto', devReport: 'Código implementado' }),
  )
  assert.equal(reviewing.percent, 67)
  assert.equal(reviewing.completedSteps, 2)
  assert.equal(reviewing.isRunning, true)

  const done = computeMissionProgress(
    baseMission({ phase: 'done', plan: 'Plano', devReport: 'Dev', review: 'QA ok', verdict: 'approved' }),
  )
  assert.equal(done.percent, 100)
  assert.equal(done.completedSteps, 3)

  const failedDuringDev = computeMissionProgress(
    baseMission({ phase: 'failed', plan: 'Plano', error: 'Falha no CLI' }),
  )
  assert.equal(failedDuringDev.percent, 33)
  assert.equal(failedDuringDev.isInterrupted, true)
  assert.notEqual(failedDuringDev.percent, 100)
})

