import { mkdirSync } from 'node:fs'
import { AgentConfigStore } from './agents/configStore.ts'
import { AgentRegistry, DEFAULT_AGENTS } from './agents/registry.ts'
import { findCli, probeCli } from './cli/probe.ts'
import { startCli } from './cli/run.ts'
import { ALLOWED_ORIGINS, DATA_DIR, DATABASE_FILE, HOST, PORT } from './config.ts'
import { GitService } from './git/service.ts'
import { HistoryStore } from './history/store.ts'
import { MemoryStore } from './memory/store.ts'
import { ProjectStore } from './projects/store.ts'
import { createAppServer } from './server.ts'
import { SkillStore } from './skills/store.ts'
import { TaskStore } from './tasks/store.ts'
import { agyEffortArgs, TeamRunner } from './team/runner.ts'
import { TerminalManager } from './terminal/manager.ts'
import { spawnCliPty } from './terminal/spawnPty.ts'

mkdirSync(DATA_DIR, { recursive: true })
const projects = new ProjectStore(DATABASE_FILE)
const history = new HistoryStore(projects.db)
const tasks = new TaskStore(projects.db, history)
const agentConfigs = new AgentConfigStore(projects.db)
const memory = new MemoryStore(projects.db, history)
const skills = new SkillStore(projects.db)
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
const team = new TeamRunner({
  tasks,
  history,
  projects,
  registry,
  git,
  configs: agentConfigs,
  memory,
  skills,
  launch: (cli, args, options) => {
    const executable = findCli(cli)
    if (!executable) throw new Error(`CLI "${cli}" não encontrado no PATH.`)
    return startCli(executable, args, options)
  },
})

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
  console.log(`Dados locais: ${DATABASE_FILE}`)
  for (const agent of registry.list()) void registry.check(agent.id)
})

// Não deixar CLIs órfãos quando o backend é encerrado.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    team.shutdown()
    terminals.closeAll()
    projects.close()
    process.exit(0)
  })
}
