import Phaser from 'phaser'
import type { AgentInfo } from '../../../shared/protocol.ts'

/**
 * Ponte entre React e Phaser. React escreve (setAgents/setSelected), a cena lê
 * e reage; a cena emite 'select' quando o jogador clica em alguém.
 * Guarda o último valor para a cena poder ler ao nascer.
 */
export class WorldBridge extends Phaser.Events.EventEmitter {
  agents: AgentInfo[] = []
  selectedId: string | null = null

  setAgents(agents: AgentInfo[]) {
    this.agents = agents
    this.emit('agents', agents)
  }

  setSelected(id: string | null) {
    this.selectedId = id
    this.emit('selected', id)
  }
}
