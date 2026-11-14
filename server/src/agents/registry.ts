import { EventEmitter } from 'node:events'
import type {
  AgentConfig,
  AgentInfo,
  AvatarPreset,
  CliId,
  RoleCategory,
  SpecializationId,
} from '../../../shared/protocol.ts'
import type { CliProbe } from '../cli/probe.ts'

export interface AgentDefinition {
  id: string
  name: string
  role: string
  cli: CliId
  roleCategory?: RoleCategory
  specializationId?: SpecializationId
  avatarPreset?: AvatarPreset
  isBuiltin?: boolean
}

// Os ids também identificam a mesa e a aparência no frontend (officeLayout.ts).
export const DEFAULT_AGENTS: AgentDefinition[] = [
  {
    id: 'architect',
    name: 'Arquiteto',
    role: 'Planeja a solução',
    cli: 'gemini',
    roleCategory: 'planning',
    specializationId: 'tech-lead',
    avatarPreset: 'architect',
    isBuiltin: true,
  },
  {
    id: 'dev',
    name: 'Dev',
    role: 'Implementa o código',
    cli: 'codex',
    roleCategory: 'developing',
    specializationId: 'developer',
    avatarPreset: 'dev',
    isBuiltin: true,
  },
  {
    id: 'qa',
    name: 'QA',
    role: 'Revisa e testa',
    cli: 'gemini',
    roleCategory: 'reviewing',
    specializationId: 'qa-tester',
    avatarPreset: 'qa',
    isBuiltin: true,
  },
  {
    id: 'tutor',
    name: 'Tutor',
    role: 'Explica e ensina',
    cli: 'gemini',
    roleCategory: 'teaching',
    specializationId: 'tutor',
    avatarPreset: 'tutor',
    isBuiltin: true,
  },
]


/**
 * Fonte da verdade do estado dos agentes. Emite 'change' (AgentInfo) a cada
 * mudança; o servidor WebSocket apenas retransmite esses eventos.
 *
 * Três coisas alteram um agente: a verificação do CLI (check), a sessão de
 * terminal (setRuntimeState) e o modo equipe (setMissionState). A missão tem
 * prioridade sobre o terminal, e os dois têm prioridade sobre a verificação.
 */
export class AgentRegistry extends EventEmitter {
  private readonly agents = new Map<string, AgentInfo>()
  private readonly inSession = new Set<string>()
  private readonly inMission = new Set<string>()
  /** Agentes mostrando 'done'/'error' de uma missão já encerrada. */
  private readonly missionResult = new Set<string>()
  private readonly probe: CliProbe

  constructor(definitions: AgentDefinition[], probe: CliProbe) {
    super()
    this.probe = probe
    for (const def of definitions) {
      this.agents.set(def.id, {
        ...def,
        state: 'offline',
        checking: false,
        session: false,
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

  /** Registra ou atualiza os metadados de um agente sem iniciar processos CLI automaticamente. */
  registerAgent(def: AgentDefinition): AgentInfo {
    const existing = this.agents.get(def.id)
    if (existing) {
      const cliChanged = existing.cli !== def.cli
      const patch: Partial<AgentInfo> = {
        name: def.name,
        role: def.role,
        cli: def.cli,
        ...(def.roleCategory !== undefined ? { roleCategory: def.roleCategory } : {}),
        ...(def.specializationId !== undefined ? { specializationId: def.specializationId } : {}),
        ...(def.avatarPreset !== undefined ? { avatarPreset: def.avatarPreset } : {}),
        ...(def.isBuiltin !== undefined ? { isBuiltin: def.isBuiltin } : {}),
        ...(cliChanged ? {
          cliVersion: null, auth: 'unknown', checkedAt: null, checking: false,
          message: 'CLI não verificado.',
          ...(this.isBusy(def.id) ? {} : { state: 'offline' }),
        } : {}),
      }
      const updated = this.update(def.id, patch)
      this.emit('list', this.list())
      return updated
    }

    const created: AgentInfo = {
      ...def,
      state: 'offline',
      checking: false,
      session: false,
      cliVersion: null,
      auth: 'unknown',
      message: 'Ainda não verificado.',
      checkedAt: null,
    }
    this.agents.set(def.id, created)
    this.emit('change', created)
    this.emit('list', this.list())
    return created
  }

  /** Remove um agente do registro ativo sem interromper uma sessão ou missão. */
  unregisterAgent(agentId: string): boolean {
    if (!this.agents.has(agentId) || this.isBusy(agentId)) return false
    this.agents.delete(agentId)
    this.inSession.delete(agentId)
    this.inMission.delete(agentId)
    this.missionResult.delete(agentId)
    this.emit('list', this.list())
    return true
  }

  /** Sincroniza os agentes ativos do banco de configurações sem disparar processos em segundo plano. */
  syncFromConfigs(configs: AgentConfig[]) {
    const activeIds = new Set<string>()
    for (const cfg of configs) {
      if (cfg.active === false) continue
      activeIds.add(cfg.agentId)
      const cli: CliId = cfg.provider === 'antigravity' ? 'agy' : cfg.provider
      this.registerAgent({
        id: cfg.agentId,
        name: cfg.name || cfg.agentId,
        role: cfg.role || 'Agente personalizado',
        cli,
        roleCategory: cfg.roleCategory,
        specializationId: cfg.specializationId,
        avatarPreset: cfg.avatarPreset,
        isBuiltin: cfg.isBuiltin,
      })
    }
    for (const id of [...this.agents.keys()]) {
      if (!activeIds.has(id)) {
        this.unregisterAgent(id)
      }
    }
  }

  /** Atualiza o CLI do agente caso o usuário mude o provedor na Central de Agentes. */
  setCli(agentId: string, cli: CliId) {
    const agent = this.agents.get(agentId)
    if (!agent || agent.cli === cli) return
    this.update(agentId, { cli, cliVersion: null, auth: 'unknown', message: 'Configuração atualizada.' })
    void this.check(agentId)
  }

  /** Consulta o CLI real do agente (existe? versão? login?). */
  async check(agentId: string): Promise<AgentInfo | null> {
    const agent = this.agents.get(agentId)
    if (!agent) return null
    if (agent.checking || this.isBusy(agentId)) return agent

    this.update(agentId, { checking: true })
    const done = { checking: false, checkedAt: new Date().toISOString() }
    try {
      const result = await this.probe(agent.cli)
      if (this.agents.get(agentId)?.cli !== agent.cli) return this.get(agentId) ?? null
      // Uma sessão ou missão pode ter começado durante a consulta: nesse caso só
      // os dados do CLI são atualizados, sem mexer em estado/mensagem.
      const busy = this.isBusy(agentId)
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
          ? 'CLI instalado, mas não consegue executar (sem login ou conta sem acesso). Teste o CLI no seu terminal.'
          : 'Pronto para trabalhar.'
      return this.update(agentId, {
        ...done,
        cliVersion: result.version,
        auth: result.auth,
        // Sem login o agente não está pronto: não pode aparecer como disponível.
        ...(busy ? {} : { state: result.auth === 'missing' ? 'error' : 'idle', message }),
      })
    } catch (error) {
      if (this.agents.get(agentId)?.cli !== agent.cli) return this.get(agentId) ?? null
      const message = error instanceof Error ? error.message : String(error)
      return this.update(agentId, { ...done, ...(this.isBusy(agentId) ? {} : { state: 'error', message }) })
    }
  }

  /** Usado pelo gerenciador de terminais para refletir o processo real. */
  setRuntimeState(agentId: string, state: 'idle' | 'waiting' | 'working', message: string) {
    const agent = this.agents.get(agentId)
    if (!agent) return
    if (state === 'idle') this.inSession.delete(agentId)
    else this.inSession.add(agentId)
    const session = state !== 'idle'
    // Durante uma missão o personagem mostra a missão; o terminal só atualiza `session`.
    const inMission = this.inMission.has(agentId)
    if (!inMission) this.missionResult.delete(agentId)
    const patch = inMission ? { session } : { state, message, session }
    if (Object.entries(patch).some(([key, value]) => agent[key as keyof AgentInfo] !== value)) {
      this.update(agentId, patch)
    }
  }

  /**
   * Usado pelo modo equipe. Estados de trabalho prendem o agente na missão;
   * 'done' e 'error' encerram a participação mas ficam visíveis até a próxima
   * mudança; null devolve o agente ao estado do terminal.
   */
  setMissionState(agentId: string, state: 'planning' | 'working' | 'reviewing' | 'approval' | 'done' | 'error' | null, message = '') {
    const agent = this.agents.get(agentId)
    if (!agent) return
    if (state === null) {
      const hadMissionState = this.inMission.delete(agentId) || this.missionResult.delete(agentId)
      if (!hadMissionState) return
      const session = this.inSession.has(agentId)
      this.update(agentId, { state: session ? 'waiting' : 'idle', message: session ? 'Sessão de terminal aberta.' : 'Pronto para trabalhar.' })
      return
    }
    if (state === 'done' || state === 'error') {
      this.inMission.delete(agentId)
      this.missionResult.add(agentId)
    } else {
      this.inMission.add(agentId)
      this.missionResult.delete(agentId)
    }
    this.update(agentId, { state, message })
  }

  private isBusy(agentId: string) {
    return this.inSession.has(agentId) || this.inMission.has(agentId)
  }

  private update(agentId: string, patch: Partial<AgentInfo>): AgentInfo {
    const next = { ...this.agents.get(agentId)!, ...patch }
    this.agents.set(agentId, next)
    this.emit('change', next)
    return next
  }
}
