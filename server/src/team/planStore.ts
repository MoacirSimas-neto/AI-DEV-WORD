import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import type {
  DynamicProposal,
  DynamicProposalInput,
  PlannedStep,
  ProposalDecision,
  StepStatus,
} from '../../../shared/protocol.ts'
import { redact } from '../history/store.ts'
import type { TaskStore } from '../tasks/store.ts'
import { assertTransition, canStepTransition, checkDecision, DECISION_STATUS, nextAdjustRound, nextStep, phaseAfterDecision } from './coordinator.ts'

// Tabelas novas e independentes: bancos antigos as ganham vazias e as missões clássicas nunca as usam.
// Nada aqui é apagado: replanejar marca passos como superseded e cria outra revisão.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS mission_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mission_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    author TEXT NOT NULL,
    reason TEXT NOT NULL,
    mission_state TEXT NOT NULL DEFAULT '',
    alternative TEXT NOT NULL DEFAULT '',
    team_changes TEXT NOT NULL DEFAULT '[]',
    steps TEXT NOT NULL DEFAULT '[]',
    shared_context TEXT NOT NULL DEFAULT '[]',
    adjust_round INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by TEXT,
    feedback TEXT,
    objective TEXT NOT NULL DEFAULT '',
    risks TEXT NOT NULL DEFAULT '[]',
    completion_criteria TEXT NOT NULL DEFAULT '[]'
  );
  CREATE UNIQUE INDEX IF NOT EXISTS mission_proposals_revision ON mission_proposals (mission_id, revision);
  CREATE UNIQUE INDEX IF NOT EXISTS mission_proposals_one_pending ON mission_proposals (mission_id) WHERE status = 'pending';
  CREATE TABLE IF NOT EXISTS mission_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mission_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    proposal_id INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    key TEXT NOT NULL,
    seq INTEGER NOT NULL,
    agent_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    objective TEXT NOT NULL,
    depends_on TEXT NOT NULL DEFAULT '[]',
    inputs TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    result TEXT NOT NULL DEFAULT '',
    error TEXT,
    correlation_id TEXT,
    attempt INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS mission_steps_by_mission ON mission_steps (project_id, mission_id, id);
`

// Colunas acrescentadas depois da primeira versão da tabela (Etapa 10.2).
const EXTRA_PROPOSAL_COLUMNS: [string, string][] = [
  ['objective', "TEXT NOT NULL DEFAULT ''"],
  ['risks', "TEXT NOT NULL DEFAULT '[]'"],
  ['completion_criteria', "TEXT NOT NULL DEFAULT '[]'"],
  // Etapa 10.4.
  ['trigger', "TEXT NOT NULL DEFAULT ''"],
]
const EXTRA_STEP_COLUMNS: [string, string][] = [['attempt', 'INTEGER NOT NULL DEFAULT 1']]
// Uma tentativa por (revisão, chave, attempt): a reexecução autorizada é outra linha, a anterior fica como estava.
const STEP_INDEX = `
  DROP INDEX IF EXISTS mission_steps_key;
  CREATE UNIQUE INDEX IF NOT EXISTS mission_steps_key_attempt ON mission_steps (mission_id, revision, key, attempt);
`

const PROPOSAL_COLUMNS = `id, mission_id AS missionId, project_id AS projectId, revision, kind, status, author, reason,
  mission_state AS missionState, alternative, team_changes AS teamChanges, steps, shared_context AS sharedContext,
  adjust_round AS adjustRound, created_at AS createdAt, decided_at AS decidedAt, decided_by AS decidedBy, feedback,
  objective, risks, completion_criteria AS completionCriteria, "trigger" AS "trigger"`
const STEP_COLUMNS = `id, mission_id AS missionId, project_id AS projectId, proposal_id AS proposalId, revision, key, seq,
  agent_id AS agentId, mode, objective, depends_on AS dependsOn, inputs, status, started_at AS startedAt,
  finished_at AS finishedAt, result, error, correlation_id AS correlationId, attempt`

const MAX_RESULT = 100_000

function list<T>(raw: unknown): T[] {
  try {
    const value: unknown = JSON.parse(String(raw))
    return Array.isArray(value) ? (value as T[]) : []
  } catch {
    return []
  }
}

const toProposal = (row: Record<string, unknown>) =>
  ({
    ...row,
    teamChanges: list(row.teamChanges),
    steps: list(row.steps),
    sharedContext: list(row.sharedContext),
    risks: list(row.risks),
    completionCriteria: list(row.completionCriteria),
  }) as unknown as DynamicProposal
const toStep = (row: Record<string, unknown>) => ({ ...row, dependsOn: list(row.dependsOn), inputs: list(row.inputs) }) as unknown as PlannedStep

export interface PlanQuery {
  /** Obrigatório: nenhuma consulta atravessa projetos. */
  projectId: number
  missionId: number
}

/**
 * Propostas do Tech Lead e passos dos planos aprovados das missões dinâmicas.
 * Só guarda e aplica: a validação do conteúdo é do coordenador (validateProposal), antes de `propose`.
 * Emite 'change' (missionId) quando propostas ou passos de uma missão mudam.
 */
export class PlanStore extends EventEmitter {
  private readonly db: DatabaseSync
  private readonly tasks: TaskStore

  constructor(db: DatabaseSync, tasks: TaskStore) {
    super()
    this.db = db
    this.tasks = tasks
    this.db.exec(SCHEMA)
    for (const [table, columns] of [['mission_proposals', EXTRA_PROPOSAL_COLUMNS], ['mission_steps', EXTRA_STEP_COLUMNS]] as const) {
      const existing = new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name))
      for (const [column, definition] of columns) {
        if (!existing.has(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN "${column}" ${definition}`)
      }
    }
    this.db.exec(STEP_INDEX)
  }

  /** Em ordem de revisão. */
  listProposals(query: PlanQuery): DynamicProposal[] {
    return this.db
      .prepare(`SELECT ${PROPOSAL_COLUMNS} FROM mission_proposals WHERE project_id = ? AND mission_id = ? ORDER BY revision`)
      .all(query.projectId, query.missionId)
      .map(toProposal)
  }

  getProposal(proposalId: number): DynamicProposal | null {
    const row = this.db.prepare(`SELECT ${PROPOSAL_COLUMNS} FROM mission_proposals WHERE id = ?`).get(proposalId)
    return row ? toProposal(row) : null
  }

  /** Todas as revisões, em ordem de revisão e de ordem lógica. */
  listSteps(query: PlanQuery): PlannedStep[] {
    return this.db
      .prepare(`SELECT ${STEP_COLUMNS} FROM mission_steps WHERE project_id = ? AND mission_id = ? ORDER BY revision, seq, attempt`)
      .all(query.projectId, query.missionId)
      .map(toStep)
  }

  getStep(stepId: number): PlannedStep | null {
    const row = this.db.prepare(`SELECT ${STEP_COLUMNS} FROM mission_steps WHERE id = ?`).get(stepId)
    return row ? toStep(row) : null
  }

  /**
   * Registra a proposta (já validada) como a única pendente da missão e põe a missão à espera do usuário.
   * Uma proposta pendente anterior vira superseded: uma aprovação atrasada dela não vale mais.
   */
  propose(missionId: number, author: string, input: DynamicProposalInput, trigger = ''): DynamicProposal {
    return this.changed(missionId, this.proposeTx(missionId, author, input, trigger))
  }

  private proposeTx(missionId: number, author: string, input: DynamicProposalInput, trigger: string): DynamicProposal {
    return this.tx(() => {
      const mission = this.dynamicMission(missionId)
      if (mission.phase !== 'awaiting_approval') assertTransition(mission.phase, 'awaiting_approval')
      const now = new Date().toISOString()
      this.db.prepare(`UPDATE mission_proposals SET status = 'superseded', decided_at = ? WHERE mission_id = ? AND status = 'pending'`).run(now, missionId)
      const previous = this.listProposals({ projectId: mission.projectId, missionId })
      const result = this.db
        .prepare(
          `INSERT INTO mission_proposals
             (mission_id, project_id, revision, kind, status, author, reason, mission_state, alternative, team_changes, steps, shared_context, adjust_round, created_at,
              objective, risks, completion_criteria, "trigger")
           VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          missionId,
          mission.projectId,
          (previous.at(-1)?.revision ?? 0) + 1,
          input.kind,
          author,
          redact(input.reason),
          redact(input.missionState),
          redact(input.alternative),
          // Segredos saem campo a campo: remover no JSON inteiro poderia quebrá-lo.
          JSON.stringify(input.teamChanges.map((c) => ({ ...c, reason: redact(c.reason), task: redact(c.task ?? ''), context: redact(c.context ?? ''), expectedImpact: redact(c.expectedImpact ?? ''), alternative: redact(c.alternative ?? '') }))),
          JSON.stringify(input.steps.map((step) => ({ ...step, objective: redact(step.objective) }))),
          JSON.stringify(input.sharedContext),
          nextAdjustRound(previous),
          now,
          redact(input.objective ?? ''),
          JSON.stringify((input.risks ?? []).map(redact)),
          JSON.stringify((input.completionCriteria ?? []).map(redact)),
          trigger.slice(0, 40),
        )
      if (mission.phase !== 'awaiting_approval') this.tasks.updateMission(missionId, { phase: 'awaiting_approval' })
      return this.getProposal(Number(result.lastInsertRowid))!
    })
  }

  /** Avisa quem exibe o plano. Fora da transação: quem ouve lê o estado já gravado. */
  private changed<T>(missionId: number, value: T): T {
    this.emit('change', missionId)
    return value
  }

  /**
   * Aplica a decisão humana de uma vez: estado da proposta, passos do plano e fase da missão.
   * `applied: false` = a mesma decisão já tinha sido aplicada (repetição). Lança se a decisão é
   * obsoleta: outra revisão, proposta já decidida de outro jeito, substituída ou missão fora da espera.
   */
  decide(
    proposalId: number,
    revision: number,
    decision: ProposalDecision,
    options: { decidedBy?: string; feedback?: string; /** Roda dentro da transação, só quando a decisão é aplicada. */ apply?: () => void } = {},
  ): { proposal: DynamicProposal; applied: boolean } {
    const result = this.decideTx(proposalId, revision, decision, options)
    return result.applied ? this.changed(result.proposal.missionId, result) : result
  }

  private decideTx(
    proposalId: number,
    revision: number,
    decision: ProposalDecision,
    options: { decidedBy?: string; feedback?: string; apply?: () => void },
  ): { proposal: DynamicProposal; applied: boolean } {
    return this.tx(() => {
      const proposal = this.getProposal(proposalId)
      if (!proposal) throw new Error('Proposta não encontrada.')
      const check = checkDecision(proposal, revision, decision)
      if (check === 'duplicate') return { proposal, applied: false }
      const mission = this.dynamicMission(proposal.missionId)
      if (check === 'stale' || mission.phase !== 'awaiting_approval') {
        throw new Error(`A proposta (revisão ${proposal.revision}) não está mais aguardando decisão: nada foi alterado.`)
      }

      const now = new Date().toISOString()
      const updated = this.db
        .prepare(`UPDATE mission_proposals SET status = ?, decided_at = ?, decided_by = ?, feedback = ? WHERE id = ? AND status = 'pending'`)
        .run(DECISION_STATUS[decision], now, options.decidedBy ?? 'user', options.feedback ? redact(options.feedback).slice(0, 5000) : null, proposalId)
      if (updated.changes !== 1) throw new Error('A proposta não está mais pendente.')

      if (decision === 'approve' && proposal.steps.length > 0) {
        // O plano novo substitui o que ainda não começou; o que já rodou fica como está.
        this.db
          .prepare(`UPDATE mission_steps SET status = 'superseded', finished_at = ? WHERE mission_id = ? AND status = 'approved'`)
          .run(now, proposal.missionId)
        const insert = this.db.prepare(
          `INSERT INTO mission_steps (mission_id, project_id, proposal_id, revision, key, seq, agent_id, mode, objective, depends_on, inputs, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
        )
        proposal.steps.forEach((step, seq) =>
          insert.run(proposal.missionId, proposal.projectId, proposal.id, proposal.revision, step.key, seq, step.agentId, step.mode, step.objective, JSON.stringify(step.dependsOn), JSON.stringify(step.inputs)),
        )
      }
      options.apply?.()
      const next = phaseAfterDecision(proposal.kind, decision, nextStep(this.listSteps({ projectId: mission.projectId, missionId: mission.id })) !== null)
      assertTransition(mission.phase, next)
      this.tasks.updateMission(mission.id, { phase: next })
      return { proposal: this.getProposal(proposalId)!, applied: true }
    })
  }

  /**
   * O usuário autorizou executar de novo um passo interrompido ou que falhou: cria outra tentativa aprovada
   * com o mesmo objetivo e as mesmas permissões; a anterior fica registrada como estava.
   * `applied: false` = já existe uma tentativa aprovada, rodando ou concluída (repetição do pedido).
   */
  retryStep(stepId: number): { step: PlannedStep; applied: boolean } {
    const result = this.tx(() => {
      const step = this.getStep(stepId)
      if (!step) throw new Error('Passo não encontrado.')
      const mission = this.dynamicMission(step.missionId)
      const siblings = this.listSteps({ projectId: mission.projectId, missionId: mission.id }).filter((s) => s.revision === step.revision && s.key === step.key)
      const live = siblings.find((s) => s.status === 'approved' || s.status === 'running' || s.status === 'completed')
      if (live) return { step: live, applied: false }
      if (mission.phase !== 'awaiting_decision') throw new Error('A missão não está aguardando a sua decisão.')
      if (step.status !== 'interrupted' && step.status !== 'failed') throw new Error('Só um passo interrompido ou que falhou pode ser executado de novo.')
      const attempt = Math.max(...siblings.map((s) => s.attempt ?? 1)) + 1
      const inserted = this.db
        .prepare(
          `INSERT INTO mission_steps (mission_id, project_id, proposal_id, revision, key, seq, agent_id, mode, objective, depends_on, inputs, status, attempt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)`,
        )
        .run(step.missionId, step.projectId, step.proposalId, step.revision, step.key, step.seq, step.agentId, step.mode, step.objective, JSON.stringify(step.dependsOn), JSON.stringify(step.inputs), attempt)
      return { step: this.getStep(Number(inserted.lastInsertRowid))!, applied: true }
    })
    return result.applied ? this.changed(result.step.missionId, result) : result
  }

  /** Só um passo aprovado começa; `correlationId` liga o passo aos eventos da execução. */
  startStep(stepId: number, correlationId: string): PlannedStep {
    const updated = this.db
      .prepare(`UPDATE mission_steps SET status = 'running', started_at = ?, correlation_id = ? WHERE id = ? AND status = 'approved'`)
      .run(new Date().toISOString(), correlationId, stepId)
    if (updated.changes !== 1) throw new Error('Este passo não está aprovado para execução.')
    const step = this.getStep(stepId)!
    return this.changed(step.missionId, step)
  }

  finishStep(stepId: number, status: 'completed' | 'failed' | 'interrupted' | 'cancelled', outcome: { result?: string; error?: string } = {}): PlannedStep {
    const step = this.getStep(stepId)
    if (!step || step.status !== 'running' || !canStepTransition(step.status, status)) throw new Error('Este passo não está em execução.')
    this.db
      .prepare(`UPDATE mission_steps SET status = ?, finished_at = ?, result = ?, error = ? WHERE id = ? AND status = 'running'`)
      .run(status, new Date().toISOString(), redact(outcome.result ?? '').slice(0, MAX_RESULT), outcome.error ? redact(outcome.error) : null, stepId)
    return this.changed(step.missionId, this.getStep(stepId)!)
  }

  /** Na inicialização: passos que tinham um CLI rodando morreram com o app anterior. Nenhum é relançado. */
  interruptRunning(): PlannedStep[] {
    const lost = this.db.prepare(`SELECT ${STEP_COLUMNS} FROM mission_steps WHERE status = 'running'`).all().map(toStep)
    this.setSteps(`status = 'running'`, 'interrupted', 'Interrompido: o app foi fechado durante a execução.')
    for (const missionId of new Set(lost.map((s) => s.missionId))) this.emit('change', missionId)
    return lost.map((s) => this.getStep(s.id)!)
  }

  /** Missão encerrada ou cancelada: nada pendente pode ser aprovado nem executado depois. */
  closeMission(missionId: number) {
    this.tx(() => {
      const now = new Date().toISOString()
      this.db.prepare(`UPDATE mission_proposals SET status = 'superseded', decided_at = ? WHERE mission_id = ? AND status = 'pending'`).run(now, missionId)
      this.setSteps(`status IN ('approved', 'running') AND mission_id = ${Number(missionId)}`, 'cancelled', null)
    })
    this.emit('change', missionId)
  }

  private setSteps(where: string, status: StepStatus, error: string | null) {
    this.db
      .prepare(`UPDATE mission_steps SET status = ?, finished_at = ?, error = COALESCE(?, error) WHERE ${where}`)
      .run(status, new Date().toISOString(), error)
  }

  private dynamicMission(missionId: number) {
    const mission = this.tasks.getMission(missionId)
    if (!mission) throw new Error('Missão não encontrada.')
    if (mission.mode !== 'dynamic') throw new Error('Esta missão usa o fluxo clássico: não tem propostas nem passos.')
    return mission
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
