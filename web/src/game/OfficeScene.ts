import Phaser from 'phaser'
import type { AgentInfo } from '../../../shared/protocol.ts'
import { AgentActor } from './AgentActor.ts'
import { drawOffice, type Station } from './officeLayout.ts'
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
    this.bridge.on('selected', this.syncSelection, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.bridge.off('agents', this.syncAgents, this)
      this.bridge.off('selected', this.syncSelection, this)
    })

    this.syncAgents(this.bridge.agents)
  }

  private syncAgents(agents: AgentInfo[]) {
    const alive = new Set(agents.map((a) => a.id))
    for (const [id, actor] of this.actors) {
      if (alive.has(id)) continue
      actor.destroy()
      this.actors.delete(id)
    }
    for (const agent of agents) {
      const actor = this.actors.get(agent.id)
      if (actor) {
        actor.setState(agent.state)
        continue
      }
      const station = this.stations[agent.id]
      if (!station) continue
      this.actors.set(agent.id, new AgentActor(this, agent, station, (id) => this.bridge.emit('select', id)))
    }
    this.syncSelection(this.bridge.selectedId)
  }

  private syncSelection(selectedId: string | null) {
    for (const actor of this.actors.values()) actor.setSelected(actor.id === selectedId)
  }
}
