import Phaser from 'phaser'
import type { AgentInfo } from '../../../shared/protocol.ts'

export type WorldAction = 'tasks' | 'history' | 'mission' | 'agents'

/**
 * Ponte entre React e Phaser. React escreve (setAgents/setSelected), a cena lê
 * e reage; a cena emite 'select' quando o jogador clica em alguém e 'action'
 * quando interage com objetos funcionais do cenário.
 */
export class WorldBridge extends Phaser.Events.EventEmitter {
  agents: AgentInfo[] = []
  selectedId: string | null = null
  specialistPage = 0

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

  triggerAction(action: WorldAction) {
    this.emit('action', action)
  }
}
