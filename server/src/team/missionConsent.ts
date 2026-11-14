import { createHash, randomBytes } from 'node:crypto'
import type { DynamicProposal } from '../../../shared/protocol.ts'
import { redact } from '../security/redact.ts'

export type MissionConsentAction = 'approve' | 'adjust' | 'reject' | 'close'

export const MISSION_CONSENT_ACTIONS = new Set<MissionConsentAction>([
  'approve',
  'adjust',
  'reject',
  'close',
])

export interface MissionConsentTicket {
  nonce: string
  action: MissionConsentAction
  missionId: number
  missionPhase: string
  proposalId: number | null
  revision: number | null
  proposalFingerprint: string | null
  feedbackHash: string
  expiresAt: number
}

export interface MissionConsentExpectation {
  action: MissionConsentAction
  missionId: number
  missionPhase: string
  proposalId?: number | null
  revision?: number | null
  proposalFingerprint?: string | null
  feedback?: string
}

const DEFAULT_TTL_MS = 60_000

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function proposalConsentFingerprint(
  proposal: Pick<DynamicProposal, 'kind' | 'objective' | 'reason' | 'teamChanges' | 'steps' | 'status'>,
): string {
  return sha256(
    JSON.stringify([
      proposal.kind,
      proposal.objective,
      proposal.reason,
      proposal.teamChanges,
      proposal.steps,
      proposal.status,
    ]),
  )
}

export function feedbackConsentHash(feedback?: string): string {
  return sha256(redact((feedback ?? '').trim()).slice(0, 5000))
}

/** Emite e consome nonces de uso único vinculados à missão, proposta/revisão, estado e conteúdo da decisão. */
export class MissionConsentGate {
  private readonly pending = new Map<string, MissionConsentTicket>()

  issue(input: MissionConsentExpectation, ttlMs = DEFAULT_TTL_MS): MissionConsentTicket {
    const nonce = randomBytes(24).toString('hex')
    const ticket: MissionConsentTicket = {
      nonce,
      action: input.action,
      missionId: input.missionId,
      missionPhase: input.missionPhase,
      proposalId: input.proposalId ?? null,
      revision: input.revision ?? null,
      proposalFingerprint: input.proposalFingerprint ?? null,
      feedbackHash: feedbackConsentHash(input.feedback),
      expiresAt: Date.now() + ttlMs,
    }
    this.pending.set(nonce, ticket)
    return ticket
  }

  consume(nonce: string | undefined, expected: MissionConsentExpectation): MissionConsentTicket {
    if (!nonce) throw new Error('Autorização humana obrigatória para esta decisão da missão.')
    const ticket = this.pending.get(nonce)
    if (!ticket) throw new Error('Autorização humana inválida ou já utilizada.')
    if (Date.now() > ticket.expiresAt) {
      this.pending.delete(nonce)
      throw new Error('Autorização humana expirada.')
    }
    if (ticket.action !== expected.action || ticket.missionId !== expected.missionId) {
      throw new Error('Autorização vinculada a outra missão ou decisão.')
    }
    if (ticket.proposalId !== (expected.proposalId ?? null) || ticket.revision !== (expected.revision ?? null)) {
      throw new Error('Autorização vinculada a outra proposta ou revisão.')
    }
    if (
      ticket.missionPhase !== expected.missionPhase ||
      ticket.proposalFingerprint !== (expected.proposalFingerprint ?? null)
    ) {
      this.pending.delete(nonce)
      throw new Error('O estado da missão ou da proposta mudou enquanto o diálogo estava aberto. Revise e confirme novamente.')
    }
    if (ticket.feedbackHash !== feedbackConsentHash(expected.feedback)) {
      throw new Error('O conteúdo da decisão não corresponde ao que foi confirmado.')
    }
    this.pending.delete(nonce)
    return ticket
  }
}
