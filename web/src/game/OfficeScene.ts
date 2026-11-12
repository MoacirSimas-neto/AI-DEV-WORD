import Phaser from 'phaser'
import type { AgentInfo } from '../../../shared/protocol.ts'
import { AgentActor } from './AgentActor.ts'
import { computeOfficePlacement, drawOffice, type Station } from './officeLayout.ts'
import type { WorldAction, WorldBridge } from './WorldBridge.ts'

/** Cena única do escritório: cenário interativo + um ator por agente vindo do backend. */
const DEBUG_LAYOUT = false

export class OfficeScene extends Phaser.Scene {
  private readonly bridge: WorldBridge
  private readonly actors = new Map<string, AgentActor>()
  private stations: Record<string, Station> = {}
  private debugGraphics?: Phaser.GameObjects.Graphics

  constructor(bridge: WorldBridge) {
    super('office')
    this.bridge = bridge
  }

  create() {
    this.stations = drawOffice(this, {
      onSelectAgent: (id: string) => this.bridge.emit('select', id),
      onAction: (action: WorldAction) => this.bridge.triggerAction(action),
    })

    if (DEBUG_LAYOUT) {
      this.debugGraphics = this.add.graphics().setDepth(20_000)
    }

    this.bridge.on('agents', this.syncAgents, this)
    this.bridge.on('page', this.onPageChange, this)
    this.bridge.on('selected', this.syncSelection, this)
    this.bridge.on('team', this.syncTeam, this)
    this.bridge.on('forward', this.showForward, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.bridge.off('agents', this.syncAgents, this)
      this.bridge.off('page', this.onPageChange, this)
      this.bridge.off('selected', this.syncSelection, this)
      this.bridge.off('team', this.syncTeam, this)
      this.bridge.off('forward', this.showForward, this)
    })

    this.syncAgents(this.bridge.agents)
  }

  private onPageChange() {
    this.syncAgents(this.bridge.agents)
  }

  private syncAgents(agents: AgentInfo[]) {
    const placement = computeOfficePlacement(agents, this.bridge.specialistPage)
    const alive = new Set(placement.visible.map((p) => p.agent.id))
    const visibleAgents = placement.visible.map((p) => p.agent)

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
        existing.updateAgent(agent, station, visibleAgents)
        continue
      }
      const actor = new AgentActor(this, agent, station, (id) => this.bridge.emit('select', id))
      actor.syncPlate(visibleAgents)
      this.actors.set(agent.id, actor)
    }
    this.syncSelection(this.bridge.selectedId)
    this.syncTeam(this.bridge.team)
    this.renderDebug(placement)
  }

  private syncTeam(team: string[]) {
    for (const actor of this.actors.values()) actor.setTeamMember(team.includes(actor.id))
  }

  /** Linha breve entre quem entregou e quem recebeu um resultado; some sozinha. Agentes fora da página não aparecem. */
  private showForward(from: string, to: string) {
    const a = this.actors.get(from)
    const b = this.actors.get(to)
    if (!a || !b) return
    const line = this.add.graphics().setDepth(10_400)
    line.lineStyle(3, 0x38bdf8, 0.9).lineBetween(a.position.x, a.position.y - 30, b.position.x, b.position.y - 30)
    line.fillStyle(0x38bdf8, 1).fillCircle(b.position.x, b.position.y - 30, 5)
    this.tweens.add({ targets: line, alpha: 0, delay: 700, duration: 900, onComplete: () => line.destroy() })
  }

  private renderDebug(placement: ReturnType<typeof computeOfficePlacement>) {
    if (!DEBUG_LAYOUT || !this.debugGraphics) return
    this.debugGraphics.clear()
    for (const { seat } of placement.visible) {
      this.debugGraphics.lineStyle(2, 0xef4444, 0.8)
      this.debugGraphics.strokeCircle(seat.x, seat.y, 8)
      this.debugGraphics.fillStyle(0x38bdf8, 1)
      this.debugGraphics.fillPoint(seat.x, seat.y, 4)
    }
  }

  private syncSelection(selectedId: string | null) {
    for (const actor of this.actors.values()) actor.setSelected(actor.id === selectedId)
  }
}
