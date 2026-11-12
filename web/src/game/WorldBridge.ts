import type { AgentInfo } from '../../../shared/protocol.ts'

export type WorldAction = 'tasks' | 'history' | 'mission' | 'agents'

type Listener = (...args: never[]) => void
type Entry = { fn: Listener; ctx: unknown }

/** Emissor mínimo (on/off/emit com contexto), sem depender do Phaser em tempo de execução. */
class Emitter {
  private readonly map = new Map<string, Entry[]>()

  on(event: string, fn: Listener, ctx?: unknown) {
    this.map.set(event, [...(this.map.get(event) ?? []), { fn, ctx }])
    return this
  }

  off(event: string, fn?: Listener, ctx?: unknown) {
    const list = this.map.get(event)
    if (!list) return this
    const kept = fn ? list.filter((e) => e.fn !== fn || (ctx !== undefined && e.ctx !== ctx)) : []
    if (kept.length) this.map.set(event, kept)
    else this.map.delete(event)
    return this
  }

  emit(event: string, ...args: unknown[]) {
    const list = this.map.get(event)
    if (!list) return false
    for (const e of [...list]) (e.fn as (...a: unknown[]) => void).apply(e.ctx, args)
    return true
  }

  removeAllListeners() {
    this.map.clear()
    return this
  }

  listenerCount(event: string) {
    return this.map.get(event)?.length ?? 0
  }
}

/**
 * Ponte entre React e Phaser. React escreve (setAgents/setSelected), a cena lê
 * e reage; a cena emite 'select' quando o jogador clica em alguém e 'action'
 * quando interage com objetos funcionais do cenário.
 */
export class WorldBridge extends Emitter {
  agents: AgentInfo[] = []
  selectedId: string | null = null
  specialistPage = 0
  /** Participantes da missão dinâmica aberta (vazio = nenhuma missão dinâmica). */
  team: string[] = []

  setAgents(agents: AgentInfo[]) {
    this.agents = agents
    this.emit('agents', agents)
  }

  setSelected(id: string | null) {
    this.selectedId = id
    this.emit('selected', id)
  }

  setSpecialistPage(page: number) {
    this.specialistPage = page
    this.emit('page', page)
  }

  setTeam(team: string[]) {
    this.team = team
    this.emit('team', team)
  }

  /** Um resultado real foi encaminhado de um agente para outro (evento result.forwarded). */
  pulse(from: string, to: string) {
    this.emit('forward', from, to)
  }

  triggerAction(action: WorldAction) {
    this.emit('action', action)
  }
}
