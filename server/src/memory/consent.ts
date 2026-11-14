import { randomBytes } from 'node:crypto'

export type MemoryConsentAction = 'create' | 'approve' | 'reject' | 'supersede'

export const MEMORY_CONSENT_ACTIONS = new Set<MemoryConsentAction>([
  'create',
  'approve',
  'reject',
  'supersede',
])

export interface MemoryConsentTicket {
  nonce: string
  action: MemoryConsentAction
  targetId: number
  expiresAt: number
}

const DEFAULT_TTL_MS = 60_000

/** Emite e consome nonces de uso único vinculados à ação humana e ao alvo da memória. */
export class MemoryConsentGate {
  private readonly pending = new Map<string, MemoryConsentTicket>()

  issue(action: MemoryConsentAction, targetId: number, ttlMs = DEFAULT_TTL_MS): MemoryConsentTicket {
    const nonce = randomBytes(24).toString('hex')
    const ticket: MemoryConsentTicket = { nonce, action, targetId, expiresAt: Date.now() + ttlMs }
    this.pending.set(nonce, ticket)
    return ticket
  }

  consume(nonce: string | undefined, action: MemoryConsentAction, targetId: number): MemoryConsentTicket {
    if (!nonce) throw new Error('Autorização humana obrigatória para esta operação de memória.')
    const ticket = this.pending.get(nonce)
    if (!ticket) throw new Error('Autorização humana inválida ou já utilizada.')
    if (Date.now() > ticket.expiresAt) {
      this.pending.delete(nonce)
      throw new Error('Autorização humana expirada.')
    }
    if (ticket.action !== action || ticket.targetId !== targetId) {
      throw new Error('Autorização vinculada a outra memória ou operação.')
    }
    this.pending.delete(nonce)
    return ticket
  }
}
