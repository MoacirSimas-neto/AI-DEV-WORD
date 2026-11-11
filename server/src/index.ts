import { mkdirSync } from 'node:fs'
import { AgentRegistry, DEFAULT_AGENTS } from './agents/registry.ts'
import { findCli, probeCli } from './cli/probe.ts'
import { startCli } from './cli/run.ts'
import { ALLOWED_ORIGINS, DATA_DIR, DATABASE_FILE, HOST, PORT } from './config.ts'
import { GitService } from './git/service.ts'
import { HistoryStore } from './history/store.ts'
import { ProjectStore } from './projects/store.ts'
import { createAppServer } from './server.ts'
import { TaskStore } from './tasks/store.ts'
import { TeamRunner } from './team/runner.ts'
import { TerminalManager } from './terminal/manager.ts'
import { spawnCliPty } from './terminal/spawnPty.ts'

mkdirSync(DATA_DIR, { recursive: true })
const projects = new ProjectStore(DATABASE_FILE)
const history = new HistoryStore(projects.db)
const tasks = new TaskStore(projects.db, history)
const registry = new AgentRegistry(DEFAULT_AGENTS, probeCli)
const terminals = new TerminalManager(registry, spawnCliPty, () => projects.active()?.path ?? null)
const git = new GitService()
const team = new TeamRunner({
  tasks,
  history,
  projects,
  registry,
  git,
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
