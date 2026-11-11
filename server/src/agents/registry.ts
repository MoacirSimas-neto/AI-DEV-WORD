import { EventEmitter } from 'node:events'
import type { AgentInfo, CliId } from '../../../shared/protocol.ts'
import type { CliProbe } from '../cli/probe.ts'

export interface AgentDefinition {
  id: string
  name: string
  role: string
  cli: CliId
}

// Neste incremento só o Dev existe. Arquiteto, QA e Tutor entram nesta lista.
export const DEFAULT_AGENTS: AgentDefinition[] = [
  { id: 'dev', name: 'Dev', role: 'Desenvolvedor', cli: 'codex' },
]

/**
 * Fonte da verdade do estado dos agentes. Emite 'change' (AgentInfo) a cada
 * mudança; o servidor WebSocket apenas retransmite esses eventos.
 */
export class AgentRegistry extends EventEmitter {
  private readonly agents = new Map<string, AgentInfo>()
  private readonly probe: CliProbe

  constructor(definitions: AgentDefinition[], probe: CliProbe) {
    super()
    this.probe = probe
    for (const def of definitions) {
      this.agents.set(def.id, {
        ...def,
        state: 'offline',
        cliVersion: null,
        auth: 'unknown',
        message: 'Ainda não verificado.',
        checkedAt: null,
      })
    }
  }

  list(): AgentInfo[] {
    return [...this.agents.values()]
  }

  /** Executa o CLI real do agente; ele fica 'working' enquanto o processo roda. */
  async check(agentId: string): Promise<AgentInfo | null> {
    const agent = this.agents.get(agentId)
    if (!agent) return null
    // Com sessão de terminal aberta, quem manda no estado é o processo.
    if (agent.state === 'working' || agent.state === 'waiting') return agent

    this.update(agentId, { state: 'working', message: 'Verificando o CLI…' })
    const checkedAt = new Date().toISOString()
    try {
      const result = await this.probe(agent.cli)
      if (!result.found) {
        return this.update(agentId, {
          state: 'offline',
          cliVersion: null,
          auth: 'unknown',
          checkedAt,
          message: `CLI "${agent.cli}" não encontrado no PATH.`,
        })
      }
      return this.update(agentId, {
        state: 'idle',
        cliVersion: result.version,
        auth: result.auth,
        checkedAt,
        message:
          result.auth === 'missing'
            ? 'CLI instalado, mas sem login. Faça o login oficial do CLI no seu terminal.'
            : 'Pronto para trabalhar.',
      })
    } catch (error) {
      return this.update(agentId, {
        state: 'error',
        checkedAt,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  get(agentId: string): AgentInfo | undefined {
    return this.agents.get(agentId)
  }

  /** Usado pelo gerenciador de terminais para refletir o processo real. */
  setRuntimeState(agentId: string, state: 'idle' | 'waiting' | 'working', message: string) {
    const agent = this.agents.get(agentId)
    if (agent && agent.state !== state) this.update(agentId, { state, message })
  }

  private update(agentId: string, patch: Partial<AgentInfo>): AgentInfo {
    const next = { ...this.agents.get(agentId)!, ...patch }
    this.agents.set(agentId, next)
    this.emit('change', next)
    return next
  }
}
