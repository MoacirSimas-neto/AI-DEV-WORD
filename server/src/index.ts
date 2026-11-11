import { AgentRegistry, DEFAULT_AGENTS } from './agents/registry.ts'
import { probeCli } from './cli/probe.ts'
import { ALLOWED_ORIGINS, HOST, PORT } from './config.ts'
import { createAppServer } from './server.ts'

const registry = new AgentRegistry(DEFAULT_AGENTS, probeCli)
const server = createAppServer({ registry, allowedOrigins: ALLOWED_ORIGINS })

server.listen(PORT, HOST, () => {
  console.log(`AI Dev World: backend em http://${HOST}:${PORT}`)
  for (const agent of registry.list()) void registry.check(agent.id)
})
