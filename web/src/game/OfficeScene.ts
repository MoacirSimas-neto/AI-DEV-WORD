import Phaser from 'phaser'
import type { AgentInfo } from '../../../shared/protocol.ts'
import { AgentActor } from './AgentActor.ts'
import { computeOfficePlacement, drawOffice, type Station } from './officeLayout.ts'
import type { WorldAction, WorldBridge } from './WorldBridge.ts'

/** Cena única do escritório: cenário interativo + um ator por agente vindo do backend. */
export class OfficeScene extends Phaser.Scene {
  private readonly bridge: WorldBridge
  private readonly actors = new Map<string, AgentActor>()
  private stations: Record<string, Station> = {}

  constructor(bridge: WorldBridge) {
    super('office')
    this.bridge = bridge
  }

  create() {
    this.stations = drawOffice(this, {
      onSelectAgent: (id: string) => this.bridge.emit('select', id),
      onAction: (action: WorldAction) => this.bridge.triggerAction(action),
    })

    this.bridge.on('agents', this.syncAgents, this)
    this.bridge.on('page', this.onPageChange, this)
    this.bridge.on('selected', this.syncSelection, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.bridge.off('agents', this.syncAgents, this)
      this.bridge.off('page', this.onPageChange, this)
      this.bridge.off('selected', this.syncSelection, this)
    })

    this.syncAgents(this.bridge.agents)
  }

  private onPageChange() {
    this.syncAgents(this.bridge.agents)
  }

  private syncAgents(agents: AgentInfo[]) {
    const placement = computeOfficePlacement(agents, this.bridge.specialistPage)
    const alive = new Set(placement.visible.map((p) => p.agent.id))

    for (const [id, actor] of this.actors) {
      if (alive.has(id)) continue
      actor.destroy()
      this.actors.delete(id)
    }

    for (const { agent, stationKey } of placement.visible) {
      const station = this.stations[stationKey]
      if (!station) continue
      const existing = this.actors.get(agent.id)
      if (existing) {
        existing.updateAgent(agent, station)
        continue
      }
      this.actors.set(agent.id, new AgentActor(this, agent, station, (id) => this.bridge.emit('select', id)))
    }
    this.syncSelection(this.bridge.selectedId)
  }

  private syncSelection(selectedId: string | null) {
    for (const actor of this.actors.values()) actor.setSelected(actor.id === selectedId)
  }
}
