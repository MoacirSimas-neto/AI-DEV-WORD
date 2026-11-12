import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { MissionEvent, MissionEventType, MissionTeamSelection } from '../../../shared/protocol.ts'
import { AgentConfigStore } from '../agents/configStore.ts'
import { AgentRegistry, DEFAULT_AGENTS } from '../agents/registry.ts'
import { GitService } from '../git/service.ts'
import { HistoryStore } from '../history/store.ts'
import { MemoryStore } from '../memory/store.ts'
import { ProjectStore } from '../projects/store.ts'
import { SkillStore } from '../skills/store.ts'
import { TaskStore } from '../tasks/store.ts'
import { type AgentLauncher, TeamRunner } from '../team/runner.ts'
import { EventStore } from './store.ts'

type Role = 'planner' | 'pre' | 'dev' | 'post' | 'qa'
type Reply = { code?: number; stdout?: string; stderr?: string } | Error | 'hang'

/** Um TeamRunner de verdade com CLIs falsos: `reply` decide a resposta de cada etapa. */
async function world(reply: (role: Role, n: number, tmp: string) => Reply) {
  const tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-trail-')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp })
  writeFileSync(path.join(tmp, 'init.txt'), 'init')
  execFileSync('git', ['add', '.'], { cwd: tmp })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmp })

  const projects = new ProjectStore(':memory:')
  projects.add(tmp)
  const projectId = projects.active()!.id
  const history = new HistoryStore(projects.db)
  const tasks = new TaskStore(projects.db, history)
  const configs = new AgentConfigStore(projects.db)
  configs.createAgent({ id: 'db-expert', name: 'DB Master', role: 'Especialista SQL', roleCategory: 'developing', specializationId: 'developer', provider: 'codex', model: 'gpt-5' })
  configs.createAgent({ id: 'sec-expert', name: 'Security Officer', role: 'Segurança', roleCategory: 'reviewing', specializationId: 'qa-tester', provider: 'gemini', model: 'gemini-2.5-pro' })
  const memory = new MemoryStore(projects.db, history)
  const skills = new SkillStore(projects.db)
  const events = new EventStore(projects.db)
  const registry = new AgentRegistry(DEFAULT_AGENTS, async () => ({ found: true, version: '1.0', auth: 'ok' }))
  registry.syncFromConfigs(configs.list())
  for (const a of registry.list()) await registry.check(a.id)

  const counts: Record<string, number> = {}
  const launch: AgentLauncher = (_cli, args, options) => {
    const prompt = options.input ?? args.at(-1) ?? ''
    const role: Role = prompt.includes('Especialista de Software')
      ? 'pre'
      : prompt.includes('Especialista Revisor')
        ? 'post'
        : prompt.includes('Você é o Desenvolvedor')
          ? 'dev'
          : prompt.includes('Você é o QA Engineer')
            ? 'qa'
            : 'planner'
    counts[role] = (counts[role] ?? 0) + 1
    const answer = reply(role, counts[role], tmp)
    if (answer instanceof Error) throw answer
    if (answer === 'hang') {
      let finish: (r: { code: number; stdout: string; stderr: string; timedOut: boolean }) => void = () => {}
      return { done: new Promise((resolve) => (finish = resolve)), kill: () => finish({ code: 1, stdout: '', stderr: '', timedOut: false }) }
    }
    return { done: Promise.resolve({ code: answer.code ?? 0, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '', timedOut: false }), kill: () => {} }
  }
  const runner = new TeamRunner({ tasks, history, projects, registry, configs, memory, skills, events, git: new GitService(), launch })

  const start = async (team?: Partial<MissionTeamSelection>, description = 'desc') => {
    const task = tasks.create(projectId, { title: 'Criar persistência', description, priority: 'high', status: 'todo', agentId: null })
    return runner.start(task.id, team)
  }
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 250 && !check(); i++) await new Promise((r) => setTimeout(r, 20))
    assert.ok(check(), 'condição não alcançada a tempo')
  }
  const phase = (missionId: number, wanted: string) => until(() => tasks.getMission(missionId)!.phase === wanted)
  const trail = (missionId: number) => events.list({ projectId, missionId })
  return { tmp, projectId, tasks, memory, skills, events, runner, start, until, phase, trail }
}

const of = (events: MissionEvent[], type: MissionEventType) => events.filter((e) => e.type === type)
const one = (events: MissionEvent[], type: MissionEventType, where: (e: MissionEvent) => boolean = () => true) => {
  const found = of(events, type).filter(where)
  assert.equal(found.length, 1, `esperava 1 evento ${type}, havia ${found.length}`)
  return found[0]
}

test('trilha: cadeia Tech Lead → Especialista SQL → Dev → Segurança → QA com skills, memória, CLI, arquivos e testes', async () => {
  const w = await world((role, _n, tmp) => {
    if (role === 'pre') return { stdout: 'ANÁLISE DB: usar UUID v4 e índices nas chaves estrangeiras.' }
    if (role === 'dev') {
      writeFileSync(path.join(tmp, 'schema.ts'), 'export const schema = {}')
      return { stdout: 'Implementado conforme o especialista. Rodei npm test e 12 testes passaram.' }
    }
    if (role === 'post') return { stdout: 'PARECER SEGURANÇA: nenhuma injeção SQL identificada.' }
    if (role === 'qa') return { stdout: 'Revisão concluída.\nVEREDITO: APROVADO' }
    return { stdout: '## Plano\n1. Criar schema\n2. Validar segurança' }
  })
  const fact = w.memory.createApproved({ projectId: w.projectId, scope: 'team', category: 'decision', content: 'MEMORIA-PRIVADA: ids sempre em UUID' })
  const ponytail = w.skills.get('ponytail')!

  const mission = await w.start(
    {
      specialists: [
        { agentId: 'db-expert', role: 'database', timing: 'pre-dev', expectedContribution: 'Modelagem SQL' },
        { agentId: 'sec-expert', role: 'security', timing: 'post-dev', expectedContribution: 'Auditoria OWASP' },
      ],
    },
    'MARCADOR-PRIVADO-DA-TAREFA',
  )
  await w.phase(mission.id, 'awaiting_approval')
  await w.runner.approve(mission.id)
  await w.phase(mission.id, 'done')
  const events = w.trail(mission.id)
  const finished = w.tasks.getMission(mission.id)!

  // Ordem estável e escopo: ids crescentes, tudo deste projeto e desta missão.
  assert.ok(events.every((e, i) => i === 0 || e.id > events[i - 1].id))
  assert.ok(events.every((e) => e.projectId === w.projectId && e.missionId === mission.id && e.taskId === mission.taskId))
  assert.equal(events[0].type, 'mission.started')
  assert.equal(events.at(-1)!.type, 'mission.completed')

  // Quem pediu e quem recebeu, na ordem real, com o objetivo transmitido.
  const delegations = of(events, 'task.delegated')
  assert.deepEqual(
    delegations.map((e) => `${e.data.from}>${e.data.to}`),
    ['user>architect', 'architect>db-expert', 'architect>dev', 'dev>sec-expert', 'dev>qa'],
  )
  assert.equal(delegations[1].data.objective, 'Modelagem SQL')
  assert.ok(delegations.every((e) => e.evidence === 'observed' && e.correlationId))
  assert.equal(new Set(delegations.map((e) => e.correlationId)).size, 5)
  assert.equal(of(events, 'agent.selected').length, 5)

  // Cada etapa tem início/fim do agente e do CLI, ligados pela mesma correlação.
  for (const [i, role] of (['planner', 'specialist', 'dev', 'specialist', 'qa'] as const).entries()) {
    const step = events.filter((e) => e.correlationId === delegations[i].correlationId)
    const types = step.map((e) => e.type)
    for (const type of [`${role}.started`, 'cli.started', 'cli.finished', `${role}.finished`]) assert.ok(types.includes(type as MissionEventType), `${role}: falta ${type}`)
    assert.ok(types.indexOf('cli.started') < types.indexOf('cli.finished'))
    const cli = one(step, 'cli.finished')
    assert.equal(cli.evidence, 'observed')
    assert.equal(cli.data.exitCode, 0)
    const started = one(step, 'cli.started')
    assert.equal((started.data.prompt as { sha256: string }).sha256.length, 16)
    assert.ok((started.data.prompt as { chars: number }).chars > 100)
  }
  assert.equal(one(events, 'cli.started', (e) => e.agentId === 'dev').data.cli, 'codex')

  // Encadeamento: a análise do especialista entrou no contexto do Dev, com a origem preservada.
  const analysis = one(events, 'result.declared', (e) => e.agentId === 'db-expert')
  const toDev = one(events, 'result.forwarded', (e) => e.data.to === 'dev' && e.data.artifact === 'specialist-analysis')
  assert.equal(toDev.evidence, 'context')
  assert.equal(toDev.data.from, 'db-expert')
  assert.equal(toDev.data.sourceCorrelationId, analysis.correlationId)
  assert.equal(toDev.data.sha256, analysis.data.sha256)
  // Estar no prompt não é ter sido seguido: a ligação com a implementação é só a evidência observável da mesma execução.
  assert.equal(toDev.data.followed, 'unverified')
  const files = one(events, 'files.changed')
  assert.equal(files.correlationId, toDev.correlationId)
  assert.equal(files.evidence, 'observed')
  assert.deepEqual(files.data.files, [{ path: 'schema.ts', code: '??' }])
  assert.deepEqual(files.data.newInAttempt, ['schema.ts'])
  assert.equal((files.data.before as { clean: boolean }).clean, true)
  assert.equal(files.data.headChanged, false)
  assert.equal(files.data.attribution, 'mission-window')
  assert.equal((files.data.diff as { available: boolean }).available, true)

  const toQa = of(events, 'result.forwarded').filter((e) => e.data.to === 'qa').map((e) => `${e.data.artifact}<${e.data.from}`)
  assert.deepEqual(toQa, ['plan<architect', 'dev-report<dev', 'git-diff<system', 'specialist-review<sec-expert'])
  const plan = one(events, 'plan.produced')
  assert.equal(one(events, 'result.forwarded', (e) => e.data.to === 'dev' && e.data.artifact === 'plan').data.sourceCorrelationId, plan.correlationId)
  // A aprovação humana aponta para o texto exato do plano produzido.
  assert.equal(one(events, 'approval.received').data.sha256, plan.data.sha256)
  assert.equal(one(events, 'approval.received').data.actor, 'user')
  assert.ok(one(events, 'approval.requested').id < one(events, 'approval.received').id)

  // Declarado x observado: o Dev disse que testou; o sistema não executou teste nenhum.
  const declared = one(events, 'tests.declared')
  assert.equal(declared.evidence, 'declared')
  assert.equal(declared.agentId, 'dev')
  assert.equal(declared.data.executedBySystem, false)
  assert.equal(one(events, 'tests.executed').evidence, 'unavailable')
  assert.ok(!events.some((e) => e.type.startsWith('tests.') && e.evidence === 'observed'))
  for (const type of ['plan.produced', 'result.declared', 'verdict.declared'] as const) assert.ok(of(events, type).every((e) => e.evidence === 'declared'))
  assert.equal(one(events, 'verdict.declared').data.verdictDetail, 'APROVADO')
  assert.equal(one(events, 'mission.completed').data.basedOn, 'verdict.declared')

  // Skills: configuradas (snapshot) x incluídas no prompt, com versão, hash, modo, agente e etapa.
  assert.equal(of(events, 'skills.configured').length, 5)
  const included = of(events, 'skill.included')
  const applied = finished.skillApplications!.filter((a) => a.state === 'applied')
  assert.equal(included.length, applied.length)
  assert.ok(included.length >= 5)
  const devSkill = one(included, 'skill.included', (e) => e.agentId === 'dev' && e.data.skillId === 'ponytail')
  assert.equal(devSkill.evidence, 'context')
  assert.equal(devSkill.data.stage, 'developing')
  assert.equal(devSkill.data.version, ponytail.version)
  assert.equal(devSkill.data.hash, ponytail.hash.slice(0, 16))
  assert.equal(devSkill.data.mode, 'context')
  assert.equal(devSkill.data.nativeInstall, false)
  assert.equal(devSkill.data.usedByModel, 'unverified')
  assert.equal(devSkill.data.snapshotRef, 'missions.teamSnapshot.dev.skills')
  const appIndex = Number(/\[(\d+)\]/.exec(String(devSkill.data.ref))![1])
  assert.equal(finished.skillApplications![appIndex].agentId, 'dev')
  assert.equal(finished.skillApplications![appIndex].id, 'ponytail')

  // Memória: só ids e motivos.
  const mem = one(events, 'memory.included', (e) => e.agentId === 'dev')
  assert.equal(mem.evidence, 'context')
  assert.deepEqual((mem.data.selected as { id: number }[]).map((s) => s.id), [fact.id])
  assert.equal(of(events, 'memory.included').length, 5)

  // Nada de prompt, conteúdo de skill, memória ou respostas dos agentes dentro dos eventos.
  const raw = JSON.stringify(events)
  for (const secret of ['MARCADOR-PRIVADO-DA-TAREFA', 'MEMORIA-PRIVADA', ponytail.content.slice(0, 80), 'UUID v4', 'npm test', 'injeção SQL', 'Criar schema']) {
    assert.ok(!raw.includes(secret), `conteúdo indevido na trilha: ${secret}`)
  }

  // Snapshot histórico: editar a skill depois não reescreve a trilha.
  w.skills.save({ id: 'ponytail', name: 'Ponytail', content: 'Conteúdo novo da skill.', version: '9.9.9' })
  assert.deepEqual(w.trail(mission.id), events)
  assert.notEqual(w.skills.get('ponytail')!.hash.slice(0, 16), devSkill.data.hash)
})

test('trilha: esclarecimento, retrabalho após reprovação e skill que não pôde ser aplicada', async () => {
  const w = await world((role, n, tmp) => {
    if (role === 'planner') return { stdout: n === 1 ? 'ESCLARECIMENTO NECESSÁRIO: Vale para frete?' : 'Plano com a resposta.' }
    if (role === 'dev') {
      writeFileSync(path.join(tmp, `v${n}.js`), `// ${n}`)
      return { stdout: `Relatório ${n}` }
    }
    return { stdout: n === 1 ? 'Arredondamento errado.\nVEREDITO: REPROVADO' : 'Ok.\nVEREDITO: APROVADO' }
  })
  w.skills.save({ id: 'nativa', name: 'Skill Nativa', content: 'Use a integração nativa.', mode: 'native', enabled: true })

  const mission = await w.start()
  await w.phase(mission.id, 'awaiting_clarification')
  await w.runner.clarify(mission.id, 'RESPOSTA-PRIVADA: não vale para frete')
  await w.phase(mission.id, 'awaiting_approval')
  await w.runner.approve(mission.id)
  await w.phase(mission.id, 'done')
  const events = w.trail(mission.id)

  // Intervenções humanas, em ordem.
  const human = events.filter((e) => ['clarification.requested', 'clarification.received', 'approval.requested', 'approval.received'].includes(e.type))
  assert.deepEqual(human.map((e) => e.type), ['clarification.requested', 'clarification.received', 'approval.requested', 'approval.received'])
  assert.ok(human.every((e) => e.evidence === 'observed'))
  assert.ok(!JSON.stringify(events).includes('RESPOSTA-PRIVADA'))
  one(events, 'result.forwarded', (e) => e.data.artifact === 'clarification-answers' && e.data.from === 'user' && e.data.to === 'architect')
  // A primeira rodada do planejador não produziu plano.
  assert.equal(of(events, 'plan.produced').length, 1)

  // Retrabalho: o QA devolve ao Dev e o parecer reprovado entra no contexto da tentativa seguinte.
  assert.deepEqual(
    of(events, 'task.delegated').map((e) => `${e.data.from}>${e.data.to}`),
    ['user>architect', 'user>architect', 'architect>dev', 'dev>qa', 'qa>dev', 'dev>qa'],
  )
  const reviews = of(events, 'result.declared').filter((e) => e.data.artifact === 'qa-review')
  const back = one(events, 'result.forwarded', (e) => e.data.to === 'dev' && e.data.artifact === 'qa-review')
  assert.equal(back.data.from, 'qa')
  assert.equal(back.data.sourceCorrelationId, reviews[0].correlationId)
  assert.equal(back.data.ref, 'missions.attempts[0].review')
  assert.deepEqual(of(events, 'verdict.declared').map((e) => e.data.verdictDetail), ['REPROVADO', 'APROVADO'])
  const changes = of(events, 'files.changed')
  assert.deepEqual(changes.map((e) => e.data.attempt), [1, 2])
  assert.deepEqual(changes[1].data.newInAttempt, ['v2.js'])
  assert.equal((changes[1].data.before as { clean: boolean }).clean, false)
  assert.equal(of(events, 'tests.declared').length, 0)

  // Skill em modo nativo: falha registrada, nunca "incluída" nem "instalada".
  const failed = of(events, 'skill.failed')
  assert.ok(failed.length >= 4)
  assert.ok(failed.every((e) => e.data.skillId === 'nativa' && e.data.applyState === 'incompatible' && e.state === 'failed' && e.evidence === 'observed'))
  assert.ok(!of(events, 'skill.included').some((e) => e.data.skillId === 'nativa'))
})

test('trilha: cancelamento encerra o CLI e registra a intervenção sem marcar falha', async () => {
  const w = await world(() => 'hang')
  const mission = await w.start()
  await w.until(() => of(w.trail(mission.id), 'cli.started').length === 1)
  w.runner.cancel(mission.id)
  await w.until(() => of(w.trail(mission.id), 'planner.finished').length === 1)
  const events = w.trail(mission.id)

  const cancelled = one(events, 'mission.cancelled')
  assert.equal(cancelled.evidence, 'observed')
  assert.equal(cancelled.state, 'cancelled')
  assert.deepEqual(cancelled.data, { actor: 'user', phase: 'planning' })
  assert.equal(one(events, 'cli.finished').state, 'cancelled')
  assert.equal(one(events, 'planner.finished').state, 'cancelled')
  assert.equal(of(events, 'mission.failed').length, 0)
  assert.equal(of(events, 'plan.produced').length, 0)
})

test('trilha: falhas de CLI ficam registradas com código de saída, sem credenciais e sem vazar entre missões', async () => {
  let mode: 'exit' | 'throw' = 'exit'
  const context = 'instrução-interna-ficticia token=abcdef123456'
  const w = await world(() => (mode === 'exit' ? { code: 3, stdout: context, stderr: context } : new Error(context)))
  const output: string[] = []
  w.runner.on('output', (_id: number, text: string) => output.push(text))

  const first = await w.start()
  await w.phase(first.id, 'failed')
  const a = w.trail(first.id)
  const exit = one(a, 'cli.finished')
  assert.equal(exit.state, 'failed')
  assert.equal(exit.evidence, 'observed')
  assert.equal(exit.data.exitCode, 3)
  assert.equal(one(a, 'planner.finished').state, 'failed')
  const failure = one(a, 'mission.failed')
  assert.equal(failure.correlationId, exit.correlationId)
  assert.equal(failure.data.phase, 'planning')
  assert.doesNotMatch(JSON.stringify(a), /abcdef123456|instrução-interna-ficticia/)
  assert.equal(of(a, 'plan.produced').length, 0)

  mode = 'throw'
  const second = await w.start()
  await w.phase(second.id, 'failed')
  const b = w.trail(second.id)
  assert.equal(of(b, 'cli.started').length, 0)
  const notStarted = one(b, 'cli.finished')
  assert.equal(notStarted.data.launched, false)
  assert.equal(notStarted.state, 'failed')
  one(b, 'mission.failed')
  assert.doesNotMatch(JSON.stringify(b), /abcdef123456|instrução-interna-ficticia/)
  assert.doesNotMatch(w.tasks.getMission(second.id)!.error!, /instrução-interna-ficticia/)
  assert.deepEqual(output, [])

  // Cada missão só enxerga a própria trilha.
  assert.ok(a.every((e) => e.missionId === first.id) && b.every((e) => e.missionId === second.id))
  const correlations = (events: MissionEvent[]) => new Set(events.map((e) => e.correlationId).filter(Boolean))
  assert.equal([...correlations(a)].filter((id) => correlations(b).has(id)).length, 0)
  assert.equal(w.events.list({ projectId: w.projectId + 1 }).length, 0)
})

test('trilha: missão interrompida pelo fechamento do app vira falha observada na recuperação', async () => {
  const w = await world(() => 'hang')
  const mission = await w.start()
  await w.until(() => of(w.trail(mission.id), 'cli.started').length === 1)
  // "Novo processo" sobre o mesmo banco: recover() fecha o que ficou aberto.
  w.runner.recover()
  w.runner.recover()
  const failure = one(w.trail(mission.id), 'mission.failed')
  assert.equal(failure.data.reason, 'interrupted')
  assert.equal(w.tasks.getMission(mission.id)!.phase, 'failed')
  w.runner.shutdown()
})
