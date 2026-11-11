import { mkdirSync } from 'node:fs'
import { AgentRegistry, DEFAULT_AGENTS } from './agents/registry.ts'
import { probeCli } from './cli/probe.ts'
import { ALLOWED_ORIGINS, DATA_DIR, DATABASE_FILE, HOST, PORT } from './config.ts'
import { ProjectStore } from './projects/store.ts'
import { createAppServer } from './server.ts'
import { TerminalManager } from './terminal/manager.ts'
import { spawnCliPty } from './terminal/spawnPty.ts'

mkdirSync(DATA_DIR, { recursive: true })
const projects = new ProjectStore(DATABASE_FILE)
const registry = new AgentRegistry(DEFAULT_AGENTS, probeCli)
const terminals = new TerminalManager(registry, spawnCliPty, () => projects.active()?.path ?? null)
const server = createAppServer({ registry, terminals, projects, allowedOrigins: ALLOWED_ORIGINS })

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
    terminals.closeAll()
    projects.close()
    process.exit(0)
  })
}
