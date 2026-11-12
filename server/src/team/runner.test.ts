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
import { HUMAN, MemoryStore } from '../memory/store.ts'
import { ProjectStore } from '../projects/store.ts'
import { TaskStore } from '../tasks/store.ts'
import { MAX_ATTEMPTS, TeamRunner, getStepCliAndArgs } from './runner.ts'

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
  // O esforço já vem no nome do modelo: o agy recusa um --effort divergente.
  assert.ok(!planStep.args.includes('--effort'))
  assert.ok(planStep.args.includes('-p'))

  const mismatched = getStepCliAndArgs('planning', {
    agentId: 'architect',
    provider: 'antigravity',
    model: 'gemini-3.8-flash-high',
    reasoningEffort: 'medium',
    updatedAt: '',
  })
  assert.ok(!mismatched.args.includes('--effort'))

  const noTier = getStepCliAndArgs('planning', {
    agentId: 'architect',
    provider: 'antigravity',
    model: 'default',
    reasoningEffort: 'extra-high',
    updatedAt: '',
  })
  assert.deepEqual(noTier.args, ['--effort', 'xhigh', '-p'])

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
  assert.ok(!devStep.args.includes('extra-high'))
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

function setupCleanGitRepo(prefix: string) {
  const tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp })
  writeFileSync(path.join(tmp, 'init.txt'), 'init')
  execFileSync('git', ['add', '.'], { cwd: tmp })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmp })
  return tmp
}

test('TeamRunner executa missão com equipe personalizada, carrega especializações, instruções seguras e grava teamSnapshot sem credenciais', async () => {
  const tmp = setupCleanGitRepo('aidw-dyn-team-')
  const projects = new ProjectStore(':memory:')
  projects.add(tmp)
  const activeProj = projects.active()!

  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const configs = new AgentConfigStore(projects.db)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))

  const planner = configs.createAgent({
    id: 'lead-custom',
    name: 'Arquiteta Sênior',
    role: 'Arquitetura Distribuída',
    roleCategory: 'planning',
    specializationId: 'tech-lead',
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    reasoningEffort: 'high',
    customInstructions: 'Priorize contratos explícitos. Token sk-secret1234567890abcdefghijklmnop jamais deve vazar.',
  })
  const dev = configs.createAgent({
    id: 'dev-backend',
    name: 'Dev Rust/TS',
    role: 'Engenheiro Backend',
    roleCategory: 'developing',
    specializationId: 'developer',
    provider: 'codex',
    model: 'gpt-5',
    reasoningEffort: 'high',
    customInstructions: 'Escreva código conciso e testável.',
  })
  const qa = configs.createAgent({
    id: 'qa-sec',
    name: 'QA Segurança',
    role: 'Auditor de Qualidade',
    roleCategory: 'reviewing',
    specializationId: 'qa-tester',
    provider: 'antigravity',
    model: 'gemini-4-argon-high',
    reasoningEffort: 'high',
    customInstructions: 'Valide bordas de entrada e regressões.',
  })

  registry.syncFromConfigs(configs.list())
  for (const a of registry.list()) await registry.check(a.id)

  const capturedPrompts: { cli: string; args: string[]; prompt: string }[] = []

  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    git: new GitService(),
    configs,
    launch: (cli, args, options) => {
      const prompt = options.input ?? args.at(-1) ?? ''
      capturedPrompts.push({ cli, args, prompt })
      if (cli === 'codex') {
        writeFileSync(path.join(tmp, 'feature.ts'), 'export const ok = true;\n')
      }
      const isQa = cli === 'agy'
      return {
        done: Promise.resolve({
          code: 0,
          stdout: isQa
            ? 'Auditoria concluída com ressalvas menores.\nVEREDITO: APROVADO COM RESSALVAS'
            : 'Etapa personalizada concluída.',
          stderr: '',
          timedOut: false,
        }),
        kill: () => {},
      }
    },
  })

  const task = tasks.create(activeProj.id, {
    title: 'Implementar feature segura',
    description: 'Módulo de validação de contratos',
    priority: 'high',
    status: 'todo',
    agentId: planner.agentId,
  })

  const mission = await runner.start(task.id, {
    plannerId: planner.agentId,
    devId: dev.agentId,
    qaId: qa.agentId,
  })

  assert.equal(mission.plannerId, 'lead-custom')
  assert.equal(mission.devId, 'dev-backend')
  assert.equal(mission.qaId, 'qa-sec')
  assert.equal(registry.get('lead-custom')?.state, 'planning')

  // Snapshot gravado na missão não contém a chave secreta
  const snapJson = JSON.stringify(mission.teamSnapshot)
  assert.ok(!snapJson.includes('sk-secret1234567890'))
  assert.equal(mission.teamSnapshot?.['lead-custom']?.specializationId, 'tech-lead')
  assert.equal(mission.teamSnapshot?.['dev-backend']?.specializationId, 'developer')
  assert.equal(mission.teamSnapshot?.['qa-sec']?.specializationId, 'qa-tester')

  for (let i = 0; i < 50; i++) {
    if (tasks.getMission(mission.id)!.phase === 'awaiting_approval') break
    await new Promise((r) => setTimeout(r, 20))
  }

  assert.equal(registry.get('lead-custom')?.state, 'approval')

  // Edita a configuração do dev durante awaiting_approval: não deve corromper o snapshot nem a execução da missão em andamento
  configs.updateAgent('dev-backend', { model: 'modelo-alterado-depois', customInstructions: 'Instrução alterada depois' })

  await runner.approve(mission.id)

  for (let i = 0; i < 50; i++) {
    if (tasks.getMission(mission.id)!.phase === 'done') break
    await new Promise((r) => setTimeout(r, 20))
  }

  const finished = tasks.getMission(mission.id)!
  assert.equal(finished.phase, 'done')
  assert.equal(finished.verdict, 'approved')
  assert.equal(finished.verdictDetail, 'APROVADO COM RESSALVAS')
  assert.equal(finished.teamSnapshot?.['dev-backend']?.model, 'gpt-5')

  // Verifica prompts e especializações de cada etapa
  assert.equal(capturedPrompts.length, 3)
  // 1) Planner
  assert.ok(capturedPrompts[0].prompt.includes('Regras obrigatórias de segurança e escopo'))
  assert.ok(capturedPrompts[0].prompt.includes('Arquiteta Sênior'))
  assert.ok(capturedPrompts[0].prompt.includes('Tech Lead'))
  assert.ok(capturedPrompts[0].prompt.includes('Instruções Personalizadas do Agente (subordinadas às regras obrigatórias de segurança acima)'))
  assert.ok(capturedPrompts[0].prompt.includes('Priorize contratos explícitos.'))
  assert.ok(!capturedPrompts[0].prompt.includes('sk-secret1234567890'))
  // 2) Dev (usou o modelo gpt-5 do snapshot, não o alterado depois)
  assert.ok(capturedPrompts[1].args.includes('gpt-5'))
  assert.ok(capturedPrompts[1].prompt.includes('Dev Rust/TS'))
  assert.ok(capturedPrompts[1].prompt.includes('O Programador Pragmático'))
  assert.ok(capturedPrompts[1].prompt.includes('Escreva código conciso e testável.'))
  // 3) QA
  assert.ok(capturedPrompts[2].prompt.includes('QA Segurança'))
  assert.ok(capturedPrompts[2].prompt.includes('O Investigador'))
  assert.ok(capturedPrompts[2].prompt.includes('Valide bordas de entrada e regressões.'))
})

test('TeamRunner valida existência, status ativo, compatibilidade de categoria e disponibilidade de CLI antes de iniciar missão', async () => {
  const tmp = setupCleanGitRepo('aidw-val-team-')
  const projects = new ProjectStore(':memory:')
  projects.add(tmp)
  const activeProj = projects.active()!

  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const configs = new AgentConfigStore(projects.db)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))

  configs.createAgent({
    id: 'inactive-planner',
    name: 'Planejador Inativo',
    role: 'Arquiteto',
    roleCategory: 'planning',
    specializationId: 'tech-lead',
    provider: 'gemini',
    active: false,
  })
  configs.createAgent({
    id: 'offline-dev',
    name: 'Dev Offline',
    role: 'Desenvolvedor',
    roleCategory: 'developing',
    specializationId: 'developer',
    provider: 'codex',
    active: true,
  })

  registry.syncFromConfigs(configs.list())
  // Verifica apenas os 4 agentes padrão; 'offline-dev' permanece offline
  for (const a of DEFAULT_AGENTS) await registry.check(a.id)

  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    git: new GitService(),
    configs,
    launch: () => ({
      done: Promise.resolve({ code: 0, stdout: 'ok', stderr: '', timedOut: false }),
      kill: () => {},
    }),
  })

  const task = tasks.create(activeProj.id, {
    title: 'Validar equipe',
    description: 'Teste de validação',
    priority: 'medium',
    status: 'todo',
    agentId: null,
  })

  // 1. Agente inexistente em plannerId, devId e qaId
  await assert.rejects(
    () => runner.start(task.id, { plannerId: 'nao-existe', devId: 'dev', qaId: 'qa' }),
    /não encontrado/,
  )
  await assert.rejects(
    () => runner.start(task.id, { plannerId: 'architect', devId: 'nao-existe', qaId: 'qa' }),
    /não encontrado/,
  )
  await assert.rejects(
    () => runner.start(task.id, { plannerId: 'architect', devId: 'dev', qaId: 'nao-existe' }),
    /não encontrado/,
  )

  // 2. Agente inativo
  await assert.rejects(
    () => runner.start(task.id, { plannerId: 'inactive-planner', devId: 'dev', qaId: 'qa' }),
    /inativo/,
  )

  // 3. Categoria incompatível (ex.: dev como planner, tutor como qa, qa como dev)
  await assert.rejects(
    () => runner.start(task.id, { plannerId: 'dev', devId: 'dev', qaId: 'qa' }),
    /incompatível com a etapa de planejamento/,
  )
  await assert.rejects(
    () => runner.start(task.id, { plannerId: 'architect', devId: 'qa', qaId: 'qa' }),
    /incompatível com a etapa de desenvolvimento/,
  )
  await assert.rejects(
    () => runner.start(task.id, { plannerId: 'architect', devId: 'dev', qaId: 'tutor' }),
    /incompatível com a etapa de revisão QA/,
  )

  // 4. Agente com CLI indisponível (offline)
  await assert.rejects(
    () => runner.start(task.id, { plannerId: 'architect', devId: 'offline-dev', qaId: 'qa' }),
    /CLI indisponível/,
  )
})

test('TeamRunner persiste verdictDetail e verdict corretamente para todas as 7 classificações do QA', async () => {
  const tmp = setupCleanGitRepo('aidw-verdicts-')
  const projects = new ProjectStore(':memory:')
  projects.add(tmp)
  const activeProj = projects.active()!

  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const configs = new AgentConfigStore(projects.db)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))
  for (const a of registry.list()) await registry.check(a.id)

  const cases: { line: string; expectedDetail: string; expectedBinary: 'approved' | 'changes' }[] = [
    { line: 'VEREDITO: APROVADO', expectedDetail: 'APROVADO', expectedBinary: 'approved' },
    { line: 'VEREDITO: APROVADO PARA O ESCOPO', expectedDetail: 'APROVADO PARA O ESCOPO', expectedBinary: 'approved' },
    { line: 'VEREDITO: APROVADO COM RESSALVAS', expectedDetail: 'APROVADO COM RESSALVAS', expectedBinary: 'approved' },
    { line: 'VEREDITO: REPROVADO', expectedDetail: 'REPROVADO', expectedBinary: 'changes' },
    { line: 'VEREDITO: BLOQUEADO', expectedDetail: 'BLOQUEADO', expectedBinary: 'changes' },
    { line: 'VEREDITO: NÃO VERIFICADO', expectedDetail: 'NÃO VERIFICADO', expectedBinary: 'changes' },
    { line: 'VEREDITO: INCONCLUSIVO', expectedDetail: 'INCONCLUSIVO', expectedBinary: 'changes' },
  ]

  let currentVerdictLine = 'VEREDITO: APROVADO'
  let stepCounter = 0

  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    git: new GitService(),
    configs,
    launch: (_cli, args, options) => {
      stepCounter++
      const isQa = (options.input ?? args.at(-1) ?? '').includes('Você é o QA Engineer')
      return {
        done: Promise.resolve({
          code: 0,
          stdout: isQa ? `Relatório QA.\n${currentVerdictLine}` : 'Ok',
          stderr: '',
          timedOut: false,
        }),
        kill: () => {},
      }
    },
  })

  for (const c of cases) {
    currentVerdictLine = c.line
    const t = tasks.create(activeProj.id, {
      title: `Teste ${c.expectedDetail}`,
      description: '',
      priority: 'low',
      status: 'todo',
      agentId: null,
    })
    const m = await runner.start(t.id)
    for (let i = 0; i < 100; i++) {
      if (tasks.getMission(m.id)!.phase === 'awaiting_approval') break
      await new Promise((r) => setTimeout(r, 10))
    }
    await runner.approve(m.id)
    for (let i = 0; i < 200; i++) {
      if (['done', 'failed'].includes(tasks.getMission(m.id)!.phase)) break
      await new Promise((r) => setTimeout(r, 15))
    }
    const done = tasks.getMission(m.id)!
    assert.equal(done.verdictDetail, c.expectedDetail)
    assert.equal(done.verdict, c.expectedBinary)
    // Só o que o QA aprovou é concluído; REPROVADO esgota as tentativas de retrabalho.
    assert.equal(done.phase, c.expectedBinary === 'approved' ? 'done' : 'failed')
    assert.equal(done.attempts!.length, c.expectedDetail === 'REPROVADO' ? MAX_ATTEMPTS : 1)
    assert.equal(tasks.get(t.id)!.status, c.expectedBinary === 'approved' ? 'review' : 'todo')
  }
})

test('TeamRunner cancelamento e recuperação funcionam com equipes personalizadas', async () => {
  const tmp = setupCleanGitRepo('aidw-cancel-rec-')
  const projects = new ProjectStore(':memory:')
  projects.add(tmp)
  const activeProj = projects.active()!

  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const configs = new AgentConfigStore(projects.db)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))

  configs.createAgent({
    id: 'custom-planner',
    name: 'Planejador Custom',
    role: 'Arquiteto',
    roleCategory: 'planning',
    specializationId: 'tech-lead',
    provider: 'gemini',
  })
  registry.syncFromConfigs(configs.list())
  for (const a of registry.list()) await registry.check(a.id)

  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    git: new GitService(),
    configs,
    launch: () => ({
      done: Promise.resolve({ code: 0, stdout: 'Plano pronto', stderr: '', timedOut: false }),
      kill: () => {},
    }),
  })

  const task = tasks.create(activeProj.id, {
    title: 'Tarefa cancelável',
    description: '',
    priority: 'medium',
    status: 'todo',
    agentId: 'custom-planner',
  })

  const m = await runner.start(task.id, { plannerId: 'custom-planner', devId: 'dev', qaId: 'qa' })
  for (let i = 0; i < 50; i++) {
    if (tasks.getMission(m.id)!.phase === 'awaiting_approval') break
    await new Promise((r) => setTimeout(r, 15))
  }
  assert.equal(registry.get('custom-planner')?.state, 'approval')

  // Simula recover() com missão aguardando aprovação de planejador personalizado
  registry.setMissionState('custom-planner', null)
  assert.equal(registry.get('custom-planner')?.state, 'idle')
  runner.recover()
  assert.equal(registry.get('custom-planner')?.state, 'approval')

  // Cancela a missão e verifica que o agente personalizado volta para idle
  runner.cancel(m.id)
  assert.equal(tasks.getMission(m.id)?.phase, 'cancelled')
  assert.equal(registry.get('custom-planner')?.state, 'idle')
})



test('TeamRunner avisa o Antigravity headless que não há comandos e explica a etapa vazia por permissão negada', async () => {
  const tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-team-agy-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp })
  writeFileSync(path.join(tmp, 'init.txt'), 'init')
  execFileSync('git', ['add', '.'], { cwd: tmp })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmp })

  const projects = new ProjectStore(':memory:')
  projects.add(tmp)
  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const configs = new AgentConfigStore(projects.db) // padrão: Arquiteto no Antigravity (agy)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))
  registry.syncFromConfigs(configs.list())
  for (const a of registry.list()) await registry.check(a.id)

  const prompts: string[] = []
  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    git: new GitService(),
    configs,
    launch: (cli, args) => {
      assert.equal(cli, 'agy')
      prompts.push(args.at(-1)!)
      return {
        done: Promise.resolve({
          code: 0,
          stdout: '',
          stderr:
            'jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.',
          timedOut: false,
        }),
        kill: () => {},
      }
    },
  })

  const task = tasks.create(projects.active()!.id, {
    title: 'Tarefa',
    description: 'Teste',
    priority: 'low',
    status: 'todo',
    agentId: null,
  })
  const mission = await runner.start(task.id)
  for (let i = 0; i < 50 && tasks.getMission(mission.id)!.phase === 'planning'; i++) {
    await new Promise((r) => setTimeout(r, 20))
  }

  assert.match(prompts[0], /NÃO pode executar comandos de terminal/)
  const failed = tasks.getMission(mission.id)!
  assert.equal(failed.phase, 'failed')
  assert.match(failed.error ?? '', /negou uma ferramenta de comando/)
})

test('TeamRunner devolve ao Dev o parecer completo do QA reprovado e conclui só após a aprovação', async () => {
  const tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-team-rework-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp })
  writeFileSync(path.join(tmp, 'init.txt'), 'init')
  execFileSync('git', ['add', '.'], { cwd: tmp })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmp })

  const projects = new ProjectStore(':memory:')
  projects.add(tmp)
  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))
  for (const a of registry.list()) await registry.check(a.id)

  const PARECER = 'Defeito por análise estática: soma() subtrai em vez de somar (linha 2).\nVEREDITO: REPROVADO'
  const devPrompts: string[] = []
  const qaPrompts: string[] = []
  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    git: new GitService(),
    launch: (cli, _args, options) => {
      const prompt = options.input ?? ''
      let stdout = 'Plano'
      if (cli === 'codex') {
        devPrompts.push(prompt)
        writeFileSync(path.join(tmp, 'soma.js'), `// versão ${devPrompts.length}`)
        stdout = `Relatório do Dev ${devPrompts.length}`
      } else if (prompt.includes('Você é o QA Engineer')) {
        qaPrompts.push(prompt)
        stdout = qaPrompts.length === 1 ? PARECER : 'Corrigido.\nVEREDITO: APROVADO'
      }
      return { done: Promise.resolve({ code: 0, stdout, stderr: '', timedOut: false }), kill: () => {} }
    },
  })

  const task = tasks.create(projects.active()!.id, { title: 'Somar', description: 'soma(a, b)', priority: 'low', status: 'todo', agentId: null })
  const mission = await runner.start(task.id)
  for (let i = 0; i < 50 && tasks.getMission(mission.id)!.phase !== 'awaiting_approval'; i++) await new Promise((r) => setTimeout(r, 20))
  await runner.approve(mission.id)
  for (let i = 0; i < 100 && tasks.getMission(mission.id)!.phase !== 'done'; i++) await new Promise((r) => setTimeout(r, 20))

  const done = tasks.getMission(mission.id)!
  assert.equal(done.phase, 'done')
  assert.equal(done.verdict, 'approved')
  // O Dev trabalhou duas vezes; só a segunda recebeu o parecer, e por inteiro.
  assert.equal(devPrompts.length, 2)
  assert.ok(!devPrompts[0].includes('RETRABALHO'))
  assert.ok(devPrompts[1].includes('RETRABALHO — tentativa 2 de 3'))
  assert.ok(devPrompts[1].includes(PARECER))
  // O QA reavaliou a nova implementação sabendo o que tinha reprovado.
  assert.equal(qaPrompts.length, 2)
  assert.ok(qaPrompts[1].includes('Relatório do Dev 2'))
  assert.ok(qaPrompts[1].includes(PARECER))
  // Histórico das tentativas preservado.
  assert.deepEqual(done.attempts!.map((a) => [a.attempt, a.devReport, a.verdictDetail]), [
    [1, 'Relatório do Dev 1', 'REPROVADO'],
    [2, 'Relatório do Dev 2', 'APROVADO'],
  ])
  assert.ok(history.list().some((h) => h.message.includes('devolvida a')))
})

test('TeamRunner: prompt do Antigravity perto do limite do Windows cede o diff e, se não couber, falha com erro claro', async () => {
  const setup = (planChars: number) => {
    const tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-team-arg-')))
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp })
    writeFileSync(path.join(tmp, 'init.txt'), 'init')
    execFileSync('git', ['add', '.'], { cwd: tmp })
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmp })
    const projects = new ProjectStore(':memory:')
    projects.add(tmp)
    const history = new HistoryStore(projects.db)
    const tasks = new TaskStore(projects.db, history)
    const configs = new AgentConfigStore(projects.db) // padrão: QA no Antigravity (prompt como argumento)
    const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))
    registry.syncFromConfigs(configs.list())
    const qaArgs: string[] = []
    const runner = new TeamRunner({
      tasks,
      history,
      projects,
      registry,
      git: new GitService(),
      configs,
      launch: (cli, args, options) => {
        const prompt = options.input ?? args.at(-1)!
        let stdout = 'p'.repeat(planChars)
        if (cli === 'codex') {
          writeFileSync(path.join(tmp, 'grande.txt'), 'linha\n'.repeat(8000)) // diff de ~56 mil caracteres
          stdout = 'feito'
        } else if (prompt.includes('Você é o QA Engineer')) {
          qaArgs.push(prompt)
          stdout = 'ok\nVEREDITO: APROVADO'
        }
        return { done: Promise.resolve({ code: 0, stdout, stderr: '', timedOut: false }), kill: () => {} }
      },
    })
    return { tasks, projects, registry, runner, qaArgs }
  }
  const run = async (planChars: number) => {
    const s = setup(planChars)
    for (const a of s.registry.list()) await s.registry.check(a.id)
    const task = s.tasks.create(s.projects.active()!.id, { title: 'T', description: '', priority: 'low', status: 'todo', agentId: null })
    const mission = await s.runner.start(task.id)
    for (let i = 0; i < 100 && s.tasks.getMission(mission.id)!.phase !== 'awaiting_approval'; i++) await new Promise((r) => setTimeout(r, 20))
    await s.runner.approve(mission.id)
    for (let i = 0; i < 200 && !['done', 'failed'].includes(s.tasks.getMission(mission.id)!.phase); i++) await new Promise((r) => setTimeout(r, 20))
    return { mission: s.tasks.getMission(mission.id)!, qaArgs: s.qaArgs }
  }

  // Plano médio + diff enorme: o diff é cortado e o argumento fica abaixo do limite.
  const fits = await run(8000)
  assert.equal(fits.mission.phase, 'done')
  assert.ok(fits.qaArgs[0].length <= 30_000, `argumento com ${fits.qaArgs[0].length} caracteres`)
  assert.ok(fits.qaArgs[0].includes('diferenças cortadas'))

  // Plano que sozinho já não cabe: o CLI nem é chamado e a missão explica o motivo.
  const tooBig = await run(31_000)
  assert.equal(tooBig.mission.phase, 'failed')
  assert.match(tooBig.mission.error ?? '', /não cabe na linha de comando/)
  assert.equal(tooBig.qaArgs.length, 0)
})


test('TeamRunner com memória: pergunta ao usuário, retoma com a resposta e Dev/QA recebem a memória aprovada', async () => {
  const tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-team-mem-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp })
  writeFileSync(path.join(tmp, 'init.txt'), 'init')
  execFileSync('git', ['add', '.'], { cwd: tmp })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmp })

  const projects = new ProjectStore(':memory:')
  projects.add(tmp)
  const projectId = projects.active()!.id
  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const memory = new MemoryStore(projects.db, history)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))
  for (const a of registry.list()) await registry.check(a.id)

  const old = memory.createApproved({ projectId, scope: 'team', category: 'decision', content: 'Moeda: sempre em centavos inteiros (int)' })
  memory.supersede(old.id, 'Moeda: sempre em centavos inteiros (bigint)', HUMAN)
  memory.createApproved({ projectId, scope: 'agent', agentId: 'qa', category: 'learning', content: 'Desconto: conferir arredondamento de centavos' })
  memory.propose({ projectId, scope: 'team', category: 'decision', content: 'Proposta pendente que não pode vazar', author: 'dev' })

  const plans: string[] = []
  const devPrompts: string[] = []
  const qaPrompts: string[] = []
  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    memory,
    git: new GitService(),
    launch: (cli, _args, options) => {
      const prompt = options.input ?? ''
      let stdout: string
      if (cli === 'codex') {
        devPrompts.push(prompt)
        writeFileSync(path.join(tmp, 'desconto.js'), `// versão ${devPrompts.length}`)
        stdout = `Relatório ${devPrompts.length}\nMEMÓRIA(solução): Desconto calculado em centavos antes de formatar`
      } else if (prompt.includes('Você é o QA Engineer')) {
        qaPrompts.push(prompt)
        stdout = qaPrompts.length === 1 ? 'Arredondamento errado.\nVEREDITO: REPROVADO' : 'Ok.\nVEREDITO: APROVADO'
      } else {
        plans.push(prompt)
        stdout = plans.length === 1
          ? 'ESCLARECIMENTO NECESSÁRIO: O desconto vale para frete também?'
          : 'Plano com a resposta.\nMEMÓRIA(requisito): Desconto não se aplica ao frete'
      }
      return { done: Promise.resolve({ code: 0, stdout, stderr: '', timedOut: false }), kill: () => {} }
    },
  })
  const wait = async (phase: string) => {
    for (let i = 0; i < 150 && tasks.getMission(mission.id)!.phase !== phase; i++) await new Promise((r) => setTimeout(r, 20))
    assert.equal(tasks.getMission(mission.id)!.phase, phase)
  }

  const task = tasks.create(projectId, { title: 'Aplicar desconto', description: 'Desconto de 10% no carrinho', priority: 'high', status: 'todo', agentId: null })
  const mission = await runner.start(task.id)
  await wait('awaiting_clarification')

  // Só memória aprovada e atual chega ao planejador; a individual do QA não.
  assert.ok(plans[0].includes('centavos inteiros (bigint)'))
  assert.ok(!plans[0].includes('(int)'))
  assert.ok(!plans[0].includes('Proposta pendente'))
  assert.ok(!plans[0].includes('arredondamento de centavos'))
  assert.equal(tasks.getMission(mission.id)!.clarifications![0].question, 'O desconto vale para frete também?')
  // A espera sobrevive a um reinício do app.
  runner.recover()
  assert.equal(tasks.getMission(mission.id)!.phase, 'awaiting_clarification')
  await assert.rejects(runner.approve(mission.id), /não está aguardando aprovação/)

  await runner.clarify(mission.id, 'Não, só nos produtos.')
  await wait('awaiting_approval')
  assert.ok(plans[1].includes('Resposta do usuário: Não, só nos produtos.'))
  const planned = tasks.getMission(mission.id)!
  assert.deepEqual(planned.clarifications!.map((c) => c.answer), ['Não, só nos produtos.'])
  assert.ok(planned.memoryContext!.planning.selected.length >= 1)
  // A proposta do plano espera aprovação humana e ainda não vale.
  const proposal = memory.list(projectId, { status: 'proposed', category: 'requirement' })[0]
  assert.equal(proposal.sourceMissionId, mission.id)
  memory.approve(proposal.id, HUMAN)

  await runner.approve(mission.id)
  await wait('done')
  // Dev e QA trabalharam com a decisão atual e o requisito recém-aprovado.
  for (const p of [...devPrompts, ...qaPrompts]) {
    assert.ok(p.includes('centavos inteiros (bigint)'))
    assert.ok(p.includes('Desconto não se aplica ao frete'))
  }
  // Memória individual: só o QA recebe.
  assert.ok(qaPrompts.every((p) => p.includes('sua memória individual] Desconto: conferir arredondamento')))
  assert.ok(devPrompts.every((p) => !p.includes('conferir arredondamento')))
  // Retrabalho Dev -> QA aconteceu com a memória presente nas duas rodadas.
  assert.equal(devPrompts.length, 2)
  const done = tasks.getMission(mission.id)!
  assert.deepEqual(Object.keys(done.memoryContext!).sort(), ['developing', 'planning', 'reviewing'])
  assert.equal(memory.list(projectId, { status: 'proposed', category: 'solution' }).length, 1)
})

test('TeamRunner limita as perguntas: depois de 2 rodadas o planejador precisa planejar com suposições', async () => {
  const tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-team-ask-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp })
  writeFileSync(path.join(tmp, 'init.txt'), 'init')
  execFileSync('git', ['add', '.'], { cwd: tmp })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmp })
  const projects = new ProjectStore(':memory:')
  projects.add(tmp)
  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))
  for (const a of registry.list()) await registry.check(a.id)
  const plans: string[] = []
  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    git: new GitService(),
    launch: (_cli, _args, options) => {
      plans.push(options.input ?? '')
      return { done: Promise.resolve({ code: 0, stdout: 'ESCLARECIMENTO NECESSÁRIO: e agora?', stderr: '', timedOut: false }), kill: () => {} }
    },
  })
  const task = tasks.create(projects.active()!.id, { title: 'T', description: '', priority: 'low', status: 'todo', agentId: null })
  const mission = await runner.start(task.id)
  const until = async (phase: string) => {
    for (let i = 0; i < 100 && tasks.getMission(mission.id)!.phase !== phase; i++) await new Promise((r) => setTimeout(r, 20))
  }
  await until('awaiting_clarification')
  await assert.rejects(runner.clarify(mission.id, '   '), /Escreva a resposta/)
  await runner.clarify(mission.id, 'resposta 1')
  await new Promise((r) => setTimeout(r, 20))
  await until('awaiting_clarification')
  await runner.clarify(mission.id, 'resposta 2')
  await until('awaiting_approval')

  assert.equal(plans.length, 3)
  assert.match(plans[2], /Não peça mais esclarecimentos/)
  const m = tasks.getMission(mission.id)!
  assert.equal(m.phase, 'awaiting_approval')
  assert.equal(m.clarifications!.length, 2)
  assert.equal(m.plan, 'ESCLARECIMENTO NECESSÁRIO: e agora?')
})

test('TeamRunner com especialistas: executa pré-dev, passa contexto ao Dev, executa pós-dev e entrega ao QA', async () => {
  const tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-team-specialists-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp })
  writeFileSync(path.join(tmp, 'init.txt'), 'init')
  execFileSync('git', ['add', '.'], { cwd: tmp })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmp })

  const projects = new ProjectStore(':memory:')
  projects.add(tmp)
  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const configs = new AgentConfigStore(projects.db)

  // Cria 2 agentes especialistas personalizados
  configs.createAgent({
    id: 'db-expert',
    name: 'DB Master',
    role: 'Especialista em Banco de Dados',
    roleCategory: 'developing',
    specializationId: 'developer',
    provider: 'codex',
    model: 'gpt-5',
  })
  configs.createAgent({
    id: 'sec-expert',
    name: 'Security Officer',
    role: 'Auditor de Segurança',
    roleCategory: 'reviewing',
    specializationId: 'qa-tester',
    provider: 'antigravity',
    model: 'gemini-4-argon-high',
  })

  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))
  registry.syncFromConfigs(configs.list())
  for (const a of registry.list()) await registry.check(a.id)

  const callLog: { cli: string; input?: string; args: string[] }[] = []
  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    configs,
    git: new GitService(),
    launch: (cli, args, options) => {
      callLog.push({ cli, input: options.input, args })
      const lastArg = args.at(-1) || ''
      const prompt = options.input || lastArg
      if (cli === 'codex' && prompt.includes('Especialista de Software')) {
        return {
          done: Promise.resolve({
            code: 0,
            stdout: 'ANÁLISE DB: Utilizar schema normalizado com UUID v4 e índices nas chaves estrangeiras.',
            stderr: '',
            timedOut: false,
          }),
          kill: () => {},
        }
      }
      if (cli === 'codex' && prompt.includes('Desenvolvedor')) {
        writeFileSync(path.join(tmp, 'schema.ts'), 'export const schema = {};')
        return {
          done: Promise.resolve({
            code: 0,
            stdout: 'Implementação realizada conforme orientações do especialista em DB.',
            stderr: '',
            timedOut: false,
          }),
          kill: () => {},
        }
      }
      if (cli === 'agy' && prompt.includes('Especialista Revisor')) {
        return {
          done: Promise.resolve({
            code: 0,
            stdout: 'PARECER SEGURANÇA: Nenhuma injeção SQL identificada. Conformidade aprovada.',
            stderr: '',
            timedOut: false,
          }),
          kill: () => {},
        }
      }
      if (prompt.includes('Investigador') || prompt.includes('QA') || prompt.includes('Revisão')) {
        return {
          done: Promise.resolve({
            code: 0,
            stdout: 'Revisão concluída com sucesso.\n\nVEREDITO: APROVADO',
            stderr: '',
            timedOut: false,
          }),
          kill: () => {},
        }
      }
      // Planejador default (architect)
      return {
        done: Promise.resolve({
          code: 0,
          stdout: '## Plano de Teste com Especialistas\n1. Criar banco\n2. Validar segurança.',
          stderr: '',
          timedOut: false,
        }),
        kill: () => {},
      }
    },
  })

  const task = tasks.create(projects.active()!.id, {
    title: 'Criar persistência e auditoria',
    description: 'Com especialistas pré e pós-dev',
    priority: 'high',
    status: 'todo',
    agentId: null,
  })

  const mission = await runner.start(task.id, {
    plannerId: 'architect',
    devId: 'dev',
    qaId: 'qa',
    specialists: [
      { agentId: 'db-expert', role: 'database', timing: 'pre-dev', expectedContribution: 'Modelagem SQL' },
      { agentId: 'sec-expert', role: 'security', timing: 'post-dev', expectedContribution: 'Auditoria OWASP' },
    ],
  })

  // Aguarda fim do planejamento
  for (let i = 0; i < 50 && tasks.getMission(mission.id)!.phase !== 'awaiting_approval'; i++) {
    await new Promise((r) => setTimeout(r, 20))
  }
  const awaiting = tasks.getMission(mission.id)!
  assert.equal(awaiting.phase, 'awaiting_approval')
  assert.equal(awaiting.specialists?.length, 2)

  // Aprova o plano
  await runner.approve(mission.id)

  // Aguarda conclusão total
  for (let i = 0; i < 50 && tasks.getMission(mission.id)!.phase !== 'done' && tasks.getMission(mission.id)!.phase !== 'failed'; i++) {
    await new Promise((r) => setTimeout(r, 20))
  }

  const finished = tasks.getMission(mission.id)!
  if (finished.phase === 'failed') {
    assert.fail(`Missão falhou: ${finished.error}`)
  }
  assert.equal(finished.phase, 'done')
  assert.equal(finished.verdict, 'approved')
  assert.equal(finished.specialistResults?.length, 2)

  const preRes = finished.specialistResults?.find((r) => r.agentId === 'db-expert')!
  assert.equal(preRes.status, 'completed')
  assert.equal(preRes.timing, 'pre-dev')
  assert.match(preRes.details, /UUID v4/)

  const postRes = finished.specialistResults?.find((r) => r.agentId === 'sec-expert')!
  assert.equal(postRes.status, 'completed')
  assert.equal(postRes.timing, 'post-dev')
  assert.match(postRes.details, /PARECER SEGURANÇA/)

  // Confirma que o prompt do Dev recebeu a análise do especialista em DB
  const devCall = callLog.find((c) => c.input?.includes('Desenvolvedor (O Programador Pragmático)'))
  assert.ok(devCall)
  assert.match(devCall.input!, /ANÁLISE DB: Utilizar schema normalizado/)

  // Confirma que o prompt do QA recebeu o parecer do especialista em segurança
  const qaCall = callLog.find((c) => (c.input || c.args.at(-1) || '').includes('QA Engineer (O Investigador)'))
  assert.ok(qaCall)
  assert.match(qaCall.input || qaCall.args.at(-1)!, /PARECER SEGURANÇA: Nenhuma injeção SQL/)
})

test('saída ao vivo da missão: segredo fictício em pedaços não chega à tela; o plano gravado também sai redigido', async () => {
  const tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-team-secret-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp })
  writeFileSync(path.join(tmp, 'init.txt'), 'init')
  execFileSync('git', ['add', '.'], { cwd: tmp })
  execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-qm', 'i'], { cwd: tmp })
  const projects = new ProjectStore(':memory:')
  projects.add(tmp)
  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))
  for (const a of registry.list()) await registry.check(a.id)
  const fake = 'sk-proj-ficticio0123456789abcdefXYZ'
  const plan = `## Plano\nUse a chave ${fake} no .env\n`
  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    git: new GitService(),
    launch: (_cli, _args, options) => {
      // O CLI imprime o plano em pedaços pequenos, partindo a chave.
      for (const piece of plan.match(/[\s\S]{1,4}/g)!) options.onOutput?.(piece)
      return { done: Promise.resolve({ code: 0, stdout: plan, stderr: '', timedOut: false }), kill: () => {} }
    },
  })
  const shown: string[] = []
  runner.on('output', (_id: number, data: string) => shown.push(data))
  const task = tasks.create(projects.active()!.id, { title: 'Configurar', description: '', priority: 'low', status: 'todo', agentId: null })
  const mission = await runner.start(task.id)
  for (let i = 0; i < 100 && tasks.getMission(mission.id)!.phase !== 'awaiting_approval'; i++) await new Promise((r) => setTimeout(r, 20))
  const all = shown.join('')
  assert.ok(all.includes('Use a chave'), all)
  assert.ok(!all.includes('0123456789abcdef'), all)
  assert.ok(!tasks.getMission(mission.id)!.plan.includes('0123456789abcdef'))
  runner.cancel(mission.id)
})

test('modo clássico: o planejador (sem permissão de escrita) que grava arquivo encerra a missão sem chegar ao Dev', async () => {
  const tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-team-ro-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp })
  writeFileSync(path.join(tmp, 'init.txt'), 'init')
  execFileSync('git', ['add', '.'], { cwd: tmp })
  execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-qm', 'i'], { cwd: tmp })
  const projects = new ProjectStore(':memory:')
  projects.add(tmp)
  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))
  for (const a of registry.list()) await registry.check(a.id)
  const roles: string[] = []
  const runner = new TeamRunner({
    tasks,
    history,
    projects,
    registry,
    git: new GitService(),
    launch: (cli, args) => {
      roles.push(`${cli}:${args.join(' ')}`)
      writeFileSync(path.join(tmp, 'plano-gravado.md'), 'o planejador não podia gravar\n')
      return { done: Promise.resolve({ code: 0, stdout: '## Plano\nFeito.', stderr: '', timedOut: false }), kill: () => {} }
    },
  })
  const task = tasks.create(projects.active()!.id, { title: 'T', description: '', priority: 'low', status: 'todo', agentId: null })
  const mission = await runner.start(task.id)
  for (let i = 0; i < 100 && tasks.getMission(mission.id)!.phase === 'planning'; i++) await new Promise((r) => setTimeout(r, 20))
  const m = tasks.getMission(mission.id)!
  assert.equal(m.phase, 'failed')
  assert.match(m.error!, /não tinha permissão de escrita.*plano-gravado\.md/)
  assert.equal(roles.length, 1, 'nenhuma outra etapa rodou')
  assert.ok(!/workspace-write|auto_edit|accept-edits/.test(roles[0]), 'o planejador recebeu opções sem escrita')
})

test('cancelar a missão com CLI ativo encerra o processo real (guardado) e registra o cancelamento', async () => {
  const { ProcessSupervisor, setSupervisor } = await import('../cli/supervisor.ts')
  const { startCli } = await import('../cli/run.ts')
  const { statSync } = await import('node:fs')
  const tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-team-cancel-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp })
  writeFileSync(path.join(tmp, 'init.txt'), 'init')
  execFileSync('git', ['add', '.'], { cwd: tmp })
  execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-qm', 'i'], { cwd: tmp })
  // "CLI" de teste: grava um batimento fora do repositório até ser encerrado.
  const beatDir = mkdtempSync(path.join(tmpdir(), 'aidw-beat-'))
  const beat = path.join(beatDir, 'beat.log')
  const script = path.join(beatDir, 'cli.mjs')
  writeFileSync(script, `import { appendFileSync } from 'node:fs'\nsetInterval(() => appendFileSync(${JSON.stringify(beat)}, 'x'), 50)\n`)
  const supervisor = await ProcessSupervisor.start()
  setSupervisor(supervisor)
  try {
    const projects = new ProjectStore(':memory:')
    projects.add(tmp)
    const history = new HistoryStore(projects.db)
    const tasks = new TaskStore(projects.db, history)
    const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))
    for (const a of registry.list()) await registry.check(a.id)
    const runner = new TeamRunner({ tasks, history, projects, registry, git: new GitService(), launch: (_cli, _args, options) => startCli(process.execPath, [script], options) })
    const task = tasks.create(projects.active()!.id, { title: 'Cancelar', description: '', priority: 'low', status: 'todo', agentId: null })
    const mission = await runner.start(task.id)
    const size = () => { try { return statSync(beat).size } catch { return 0 } }
    for (let i = 0; i < 100 && size() === 0; i++) await new Promise((r) => setTimeout(r, 20))
    assert.ok(size() > 0, 'CLI rodando')
    assert.equal(supervisor.processes().length, 1)
    assert.match(supervisor.processes()[0].label, new RegExp(`missão #${mission.id} · architect`))
    runner.cancel(mission.id)
    for (let i = 0; i < 100 && supervisor.processes().length > 0; i++) await new Promise((r) => setTimeout(r, 20))
    const a = size()
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(size(), a, 'o CLI parou de escrever')
    assert.equal(tasks.getMission(mission.id)!.phase, 'cancelled')
  } finally {
    setSupervisor(null)
    await supervisor.close()
  }
})
