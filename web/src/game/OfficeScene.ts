import Phaser from 'phaser'
import type { AgentInfo } from '../../../shared/protocol.ts'
import { AgentActor } from './AgentActor.ts'
import { drawOffice } from './officeLayout.ts'
import type { WorldBridge } from './WorldBridge.ts'

/** Cena única do escritório: cenário estático + um ator por agente vindo do backend. */
export class OfficeScene extends Phaser.Scene {
  private readonly bridge: WorldBridge
  private readonly actors = new Map<string, AgentActor>()

  constructor(bridge: WorldBridge) {
    super('office')
    this.bridge = bridge
  }

  create() {
    drawOffice(this)

    this.bridge.on('agents', this.syncAgents, this)
    this.bridge.on('selected', this.syncSelection, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.bridge.off('agents', this.syncAgents, this)
      this.bridge.off('selected', this.syncSelection, this)
    })

    // Clique no vazio desfaz a seleção.
    this.input.on('pointerdown', (_pointer: Phaser.Input.Pointer, over: unknown[]) => {
      if (over.length === 0) this.bridge.emit('select', null)
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
      if (actor) actor.setState(agent.state)
      else this.actors.set(agent.id, new AgentActor(this, agent, (id) => this.bridge.emit('select', id)))
    }
    this.syncSelection(this.bridge.selectedId)
  }

  private syncSelection(selectedId: string | null) {
    for (const actor of this.actors.values()) actor.setSelected(actor.id === selectedId)
  }
}
