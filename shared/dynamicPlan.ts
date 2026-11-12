import type { DynamicProposal, PlannedStep } from './protocol.ts'

// Regras puras da coordenação dinâmica usadas pelo backend (coordinator.ts) e pela interface.
// Sem dependências de runtime: o que a tela mostra é o mesmo cálculo que o backend aplica.

/** Equipe ativa: o Tech Lead mais o que as propostas APROVADAS convocaram e não dispensaram. */
export function teamOf(techLeadId: string, proposals: Pick<DynamicProposal, 'status' | 'revision' | 'teamChanges'>[]): string[] {
  const team = new Set([techLeadId])
  for (const p of proposals.filter((p) => p.status === 'approved').sort((a, b) => a.revision - b.revision)) {
    for (const change of p.teamChanges) {
      if (change.action === 'convene') team.add(change.agentId)
      else team.delete(change.agentId)
    }
  }
  return [...team]
}

export const stepRef = (revision: number, key: string) => `${revision}:${key}`

/**
 * Passos que podem começar agora, em ordem: aprovados e com todas as dependências concluídas.
 * Vazio enquanto houver um passo rodando: a execução é um passo por vez.
 */
export function eligibleSteps(steps: PlannedStep[]): PlannedStep[] {
  if (steps.some((s) => s.status === 'running')) return []
  const done = new Set(steps.filter((s) => s.status === 'completed').map((s) => stepRef(s.revision, s.key)))
  return steps
    .filter((s) => s.status === 'approved' && s.dependsOn.every((dep) => done.has(stepRef(s.revision, dep))))
    .sort((a, b) => a.revision - b.revision || a.seq - b.seq)
}

export const nextStep = (steps: PlannedStep[]): PlannedStep | null => eligibleSteps(steps)[0] ?? null

/**
 * running = há um passo em execução; ready = há passo elegível; blocked = restam passos aprovados
 * mas nenhum pode rodar (uma dependência falhou); empty = não resta nada aprovado.
 */
export function planStatus(steps: PlannedStep[]): 'running' | 'ready' | 'blocked' | 'empty' {
  if (steps.some((s) => s.status === 'running')) return 'running'
  if (eligibleSteps(steps).length) return 'ready'
  return steps.some((s) => s.status === 'approved') ? 'blocked' : 'empty'
}

