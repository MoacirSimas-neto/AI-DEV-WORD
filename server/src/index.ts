import { mkdirSync } from 'node:fs'
import { AgentConfigStore } from './agents/configStore.ts'
import { AgentRegistry, DEFAULT_AGENTS } from './agents/registry.ts'
import { cliMode, requireSimulatedClis } from './cli/mode.ts'
import { findCli, launchAgentCli, probeCli } from './cli/probe.ts'
import { ProcessSupervisor, setSupervisor } from './cli/supervisor.ts'
import { ALLOWED_ORIGINS, DATA_DIR, DATABASE_FILE, HOST, LOCK_FILE, PORT } from './config.ts'
import { acquireInstanceLock, type InstanceLock } from './db/database.ts'
import { ChatService } from './chat/service.ts'
import { ChatStore } from './chat/store.ts'
import { GitService } from './git/service.ts'
import { HistoryStore } from './history/store.ts'
import { MemoryStore } from './memory/store.ts'
import { EventStore } from './observability/store.ts'
import { ProjectStore } from './projects/store.ts'
import { createAppServer } from './server.ts'
import { SkillStore } from './skills/store.ts'
import { TaskStore } from './tasks/store.ts'
import { PlanStore } from './team/planStore.ts'
import { agyEffortArgs, TeamRunner } from './team/runner.ts'
import { TerminalManager } from './terminal/manager.ts'
import { spawnCliPty } from './terminal/spawnPty.ts'

mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
// A trava vem antes de abrir o banco: uma segunda instância não pode migrar o
// esquema nem rodar a recuperação de missões sobre os dados da primeira.
let instanceLock: InstanceLock
try {
  instanceLock = acquireInstanceLock(LOCK_FILE)
} catch (error) {
  console.error(`Não foi possível iniciar o backend: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
process.on('exit', () => instanceLock.release())

// Qual executável cada CLI usa (só o caminho; nada de conta ou credencial).
try {
  const mode = cliMode()
  if (mode.kind === 'simulated') {
    const files = requireSimulatedClis(mode.dir)
    console.log(`CLIs SIMULADOS (${mode.dir}): ${Object.entries(files).map(([cli, file]) => `${cli} -> ${file}`).join('; ')}`)
  } else {
    console.log(`CLIs: ${(['codex', 'gemini', 'agy'] as const).map((cli) => `${cli} -> ${findCli(cli) ?? 'não encontrado'}`).join('; ')}`)
  }
} catch (error) {
  console.error(`Não foi possível iniciar o backend: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

// Todo CLI (missão ou terminal) roda sob um guardião ligado a este supervisor: se o backend
// morrer, inclusive à força, o canal fecha e o guardião encerra a árvore do CLI.
try {
  setSupervisor(await ProcessSupervisor.start())
} catch (error) {
  console.error(`Não foi possível iniciar o supervisor de processos: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
const projects = new ProjectStore(DATABASE_FILE)
const history = new HistoryStore(projects.db)
const tasks = new TaskStore(projects.db, history)
const agentConfigs = new AgentConfigStore(projects.db)
const memory = new MemoryStore(projects.db, history)
const skills = new SkillStore(projects.db)
const events = new EventStore(projects.db)
const plans = new PlanStore(projects.db, tasks)
const registry = new AgentRegistry(DEFAULT_AGENTS, probeCli)

// Sincroniza agentes personalizados e o CLI de cada agente conforme a configuração persistida
registry.syncFromConfigs(agentConfigs.list())
for (const cfg of agentConfigs.list()) {
  const cli = cfg.provider === 'antigravity' ? 'agy' : cfg.provider
  registry.setCli(cfg.agentId, cli)
}

const terminals = new TerminalManager(
  registry,
  spawnCliPty,
  () => projects.active()?.path ?? null,
  {
    getArgs: (agentId) => {
      const cfg = agentConfigs.get(agentId)
      const cli: 'codex' | 'gemini' | 'agy' = cfg.provider === 'antigravity' ? 'agy' : cfg.provider
      const args: string[] = []
      if (cli === 'gemini') {
        if (cfg.model && cfg.model !== 'auto' && cfg.model !== 'default') {
          args.push('-m', cfg.model)
        }
      } else if (cli === 'agy') {
        if (cfg.model && cfg.model !== 'default') {
          args.push('--model', cfg.model)
        }
        args.push(...agyEffortArgs(cfg.model, cfg.reasoningEffort))
      } else {
        if (cfg.model && cfg.model !== 'default') {
          args.push('-m', cfg.model)
        }
        if (cfg.reasoningEffort && cfg.reasoningEffort !== 'default') {
          args.push('-c', `model_reasoning_effort=${cfg.reasoningEffort}`)
        }
      }
      return { cli, args }
    },
  },
)

const git = new GitService()
// Um só lançador para missões e chat: todo CLI passa pelo supervisor de processos.
const launch = launchAgentCli
const chatStore = new ChatStore(projects.db)
// Respostas que estavam chegando quando o app fechou: ficam interrompidas (nada é relançado).
chatStore.interruptStreaming()
const team = new TeamRunner({
  tasks,
  history,
  projects,
  registry,
  git,
  configs: agentConfigs,
  memory,
  skills,
  events,
  plans,
  pendingReplans: chatStore,
  launch,
})

const chat = new ChatService({ store: chatStore, projects, registry, configs: agentConfigs, launch, git, tasks, plans, team, events })

team.recover()

const server = createAppServer({
  registry,
  terminals,
  projects,
  git,
  tasks,
  history,
  team,
  agentConfigs,
  memory,
  skills,
  events,
  plans,
  chat: { store: chatStore, service: chat },
  allowedOrigins: ALLOWED_ORIGINS,
})

server.on('error', (error: NodeJS.ErrnoException) => {
  const reason =
    error.code === 'EADDRINUSE' ? `a porta ${PORT} já está em uso (outra cópia do app aberta?)` : error.message
  console.error(`Não foi possível iniciar o backend: ${reason}`)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`AI Dev World: backend em http://${HOST}:${PORT}`)
  console.log(`Código de pareamento local: ${server.pairingCode}`)
  console.log(`Dados locais: ${DATABASE_FILE}`)
  for (const agent of registry.list()) void registry.check(agent.id)
})

// Não deixar CLIs órfãos quando o backend é encerrado.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    team.shutdown()
    chat.shutdown()
    terminals.closeAll()
    projects.close()
    process.exit(0)
  })
}
