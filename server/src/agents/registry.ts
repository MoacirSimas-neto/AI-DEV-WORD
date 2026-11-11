import { EventEmitter } from 'node:events'
import type { AgentInfo, CliId } from '../../../shared/protocol.ts'
import type { CliProbe } from '../cli/probe.ts'

export interface AgentDefinition {
  id: string
  name: string
  role: string
  cli: CliId
}

// Os ids também identificam a mesa e a aparência no frontend (officeLayout.ts).
export const DEFAULT_AGENTS: AgentDefinition[] = [
  { id: 'architect', name: 'Arquiteto', role: 'Planeja a solução', cli: 'gemini' },
  { id: 'dev', name: 'Dev', role: 'Implementa o código', cli: 'codex' },
  { id: 'qa', name: 'QA', role: 'Revisa e testa', cli: 'gemini' },
  { id: 'tutor', name: 'Tutor', role: 'Explica e ensina', cli: 'gemini' },
]

/**
 * Fonte da verdade do estado dos agentes. Emite 'change' (AgentInfo) a cada
 * mudança; o servidor WebSocket apenas retransmite esses eventos.
 *
 * Duas coisas independentes alteram um agente: a verificação do CLI (check)
 * e a sessão de terminal (setRuntimeState). Enquanto há sessão, o estado é do
 * processo e a verificação não o sobrescreve.
 */
export class AgentRegistry extends EventEmitter {
  private readonly agents = new Map<string, AgentInfo>()
  private readonly inSession = new Set<string>()
  private readonly probe: CliProbe

  constructor(definitions: AgentDefinition[], probe: CliProbe) {
    super()
    this.probe = probe
    for (const def of definitions) {
      this.agents.set(def.id, {
        ...def,
        state: 'offline',
        checking: false,
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

  get(agentId: string): AgentInfo | undefined {
    return this.agents.get(agentId)
  }

  /** Consulta o CLI real do agente (existe? versão? login?). */
  async check(agentId: string): Promise<AgentInfo | null> {
    const agent = this.agents.get(agentId)
    if (!agent) return null
    if (agent.checking || this.inSession.has(agentId)) return agent

    this.update(agentId, { checking: true })
    const done = { checking: false, checkedAt: new Date().toISOString() }
    try {
      const result = await this.probe(agent.cli)
      // Uma sessão pode ter começado durante a consulta: nesse caso só os
      // dados do CLI são atualizados, sem mexer em estado/mensagem.
      const busy = this.inSession.has(agentId)
      if (!result.found) {
        return this.update(agentId, {
          ...done,
          cliVersion: null,
          auth: 'unknown',
          ...(busy ? {} : { state: 'offline', message: `CLI "${agent.cli}" não encontrado no PATH.` }),
        })
      }
      const message =
        result.auth === 'missing'
          ? 'CLI instalado, mas sem login. Faça o login oficial do CLI no seu terminal.'
          : 'Pronto para trabalhar.'
      return this.update(agentId, {
        ...done,
        cliVersion: result.version,
        auth: result.auth,
        ...(busy ? {} : { state: 'idle', message }),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.update(agentId, { ...done, ...(this.inSession.has(agentId) ? {} : { state: 'error', message }) })
    }
  }

  /** Usado pelo gerenciador de terminais para refletir o processo real. */
  setRuntimeState(agentId: string, state: 'idle' | 'waiting' | 'working', message: string) {
    const agent = this.agents.get(agentId)
    if (!agent) return
    if (state === 'idle') this.inSession.delete(agentId)
    else this.inSession.add(agentId)
    if (agent.state !== state || agent.message !== message) this.update(agentId, { state, message })
  }

  private update(agentId: string, patch: Partial<AgentInfo>): AgentInfo {
    const next = { ...this.agents.get(agentId)!, ...patch }
    this.agents.set(agentId, next)
    this.emit('change', next)
    return next
  }
}
