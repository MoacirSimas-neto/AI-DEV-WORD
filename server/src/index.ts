import { AgentRegistry, DEFAULT_AGENTS } from './agents/registry.ts'
import { probeCli } from './cli/probe.ts'
import { ALLOWED_ORIGINS, HOST, PORT, WORKDIR } from './config.ts'
import { createAppServer } from './server.ts'
import { TerminalManager } from './terminal/manager.ts'
import { createPtySpawner } from './terminal/spawnPty.ts'

const registry = new AgentRegistry(DEFAULT_AGENTS, probeCli)
const terminals = new TerminalManager(registry, createPtySpawner(WORKDIR))
const server = createAppServer({ registry, terminals, allowedOrigins: ALLOWED_ORIGINS })

server.listen(PORT, HOST, () => {
  console.log(`AI Dev World: backend em http://${HOST}:${PORT}`)
  console.log(`Pasta de trabalho dos agentes: ${WORKDIR}`)
  for (const agent of registry.list()) void registry.check(agent.id)
})

// Não deixar CLIs órfãos quando o backend é encerrado.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    terminals.closeAll()
    process.exit(0)
  })
}
