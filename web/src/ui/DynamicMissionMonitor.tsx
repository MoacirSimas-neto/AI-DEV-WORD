import { useCallback } from 'react'
import type { AgentConfig, AgentInfo, MissionInfo, PlannedStep, TaskInfo } from '../../../shared/protocol.ts'
import { isOpenMission } from '../../../shared/missionPhases.ts'
import { useMissionEvents, usePlan } from '../net/useMission.ts'
import type { Send, Subscribe } from '../net/useServer.ts'
import { ClarificationBox } from './ClarificationBox.tsx'
import { DynamicProposalCard } from './DynamicProposalCard.tsx'
import {
  currentObjective,
  DYNAMIC_PHASE_LABEL,
  EVIDENCE_LABEL,
  groupSteps,
  latestTrigger,
  limitRows,
  MODE_LABEL,
  pendingProposal,
  STEP_STATUS_LABEL,
  teamView,
  TRIGGER_LABEL,
} from './dynamicView.ts'
import { RecoveryPanel } from './RecoveryPanel.tsx'

interface Props {
  mission: MissionInfo
  task: TaskInfo | null
  agents: AgentInfo[]
  configs: AgentConfig[]
  online: boolean
  send: Send
  subscribe: Subscribe
  liveOutput?: string
  onOpenObservability?: () => void
  /** Missão nascida de uma conversa (Etapa 12.2). */
  origin?: { conversationId: number; title?: string } | null
  /** Volta para a conversa de origem (omitido quando o monitor já está dentro do chat). */
  onOpenChat?: (conversationId: number) => void
}

/** Missão dinâmica: só o que o backend gravou — passos aprovados, propostas, gatilhos e decisões. */
export function DynamicMissionMonitor({ mission, task, agents, configs, online, send, subscribe, liveOutput, onOpenObservability, origin, onOpenChat }: Props) {
  const plan = usePlan(send, subscribe, online, mission.projectId, mission.id)
  const events = useMissionEvents(send, subscribe, online, mission.projectId, mission.id)
  const nameOf = useCallback(
    (id: string) => mission.teamSnapshot?.[id]?.name ?? configs.find((c) => c.agentId === id)?.name ?? agents.find((a) => a.id === id)?.name ?? id,
    [mission.teamSnapshot, configs, agents],
  )
  const techLeadId = mission.plannerId || 'architect'
  const pending = pendingProposal(plan.proposals)
  const history = plan.proposals.filter((p) => p.status !== 'pending').reverse()
  const groups = groupSteps(plan.steps)
  const team = teamView(techLeadId, plan.proposals)
  const objective = currentObjective(plan.proposals)
  const trigger = latestTrigger(events)
  const lastDecision = events.findLast((e) => e.type === 'approval.received')
  // O gatilho só é "atual" se veio depois da última decisão humana.
  const showTrigger = trigger && (!lastDecision || trigger.id > lastDecision.id) && (mission.phase === 'planning' || mission.phase === 'awaiting_approval')
  const open = isOpenMission(mission)

  const stepRow = (s: PlannedStep) => (
    <li key={s.id} className={`dyn-plan-step dyn-step-${s.status}`}>
      <div className="dyn-step-head">
        <code>
          r{s.revision}/{s.key}
        </code>
        <strong>{nameOf(s.agentId)}</strong>
        <span className={`dyn-mode dyn-mode-${s.mode}`} title={MODE_LABEL[s.mode].hint}>
          {MODE_LABEL[s.mode].label}
        </span>
        <span className={`dyn-step-status dyn-step-status-${s.status}`}>{STEP_STATUS_LABEL[s.status]}</span>
        {(s.attempt ?? 1) > 1 && <span className="dyn-dim">tentativa {s.attempt}</span>}
      </div>
      <p>{s.objective}</p>
      {s.dependsOn.length > 0 && <p className="dyn-dim">Depois de: {s.dependsOn.join(', ')}</p>}
      {s.error && <p className="dyn-step-error">{s.error}</p>}
      {s.result && (
        <details>
          <summary>Resultado declarado pelo agente</summary>
          <pre>{s.result}</pre>
        </details>
      )}
    </li>
  )

  return (
    <div className="dyn-monitor">
      <section className="dyn-overview">
        <div className="dyn-overview-top">
          <span className="mission-id-badge">Missão #{mission.id} · dinâmica</span>
          <span className={`dyn-phase dyn-phase-${mission.phase}`}>{DYNAMIC_PHASE_LABEL[mission.phase] ?? mission.phase}</span>
          {onOpenObservability && (
            <button type="button" className="btn-quiet btn-xs" onClick={onOpenObservability} title="Abrir a trilha de eventos desta missão">
              🔍 Trilha de eventos
            </button>
          )}
        </div>
        <h3>{task?.title ?? `Tarefa #${mission.taskId}`}</h3>
        {origin && (
          <p className="dyn-origin">
            <span>
              Origem: conversa {origin.title ? `“${origin.title}”` : `#${origin.conversationId}`}
            </span>
            {onOpenChat && (
              <button type="button" className="btn-quiet btn-xs" onClick={() => onOpenChat(origin.conversationId)}>
                ← Voltar ao chat
              </button>
            )}
          </p>
        )}
        {objective && <p className="dyn-objective">{objective}</p>}
        <div className="dyn-team">
          {team.active.map((id) => (
            <span key={id} className="dyn-member">
              {nameOf(id)}
              {id === techLeadId ? ' · Tech Lead' : ''}
            </span>
          ))}
          {team.released.map((id) => (
            <span key={id} className="dyn-member dyn-member-released" title="Dispensado desta missão; o cadastro e o histórico continuam">
              {nameOf(id)} · dispensado
            </span>
          ))}
        </div>
      </section>

      {showTrigger && trigger && (
        <section className="dyn-trigger" aria-label="Por que o Tech Lead foi consultado">
          <h5>Por que o Tech Lead foi consultado</h5>
          <p>
            <strong>{TRIGGER_LABEL[String(trigger.data.trigger)] ?? String(trigger.data.trigger)}</strong>
            {typeof trigger.data.stepKey === 'string' ? ` no passo ${trigger.data.stepKey}` : ''}
            {trigger.agentId ? ` · origem: ${nameOf(trigger.agentId)}` : ''}
          </p>
          <span className={`obs-evidence-badge ev-badge-${trigger.evidence}`}>{EVIDENCE_LABEL[trigger.evidence]}</span>
          {trigger.evidence === 'declared' && <p className="dyn-dim">O gatilho veio da resposta de um agente; não foi comprovado pelo sistema.</p>}
        </section>
      )}

      {mission.phase === 'planning' && (
        <p className="dyn-dim dyn-waiting">{nameOf(techLeadId)} está analisando. A proposta aparece aqui para a sua decisão; nada é executado antes.</p>
      )}

      {plan.pendingReplan && (
        <section className="dyn-trigger" role="status" aria-label="Alteração aguardando ponto seguro">
          <h5>Alteração solicitada pelo chat</h5>
          <p>{plan.pendingReplan.detail}</p>
          <p className="dyn-dim">A equipe está concluindo o passo atual. O Tech Lead será consultado assim que o passo terminar (ponto seguro).</p>
        </section>
      )}

      <ClarificationBox mission={mission} online={online} send={send} />

      {pending && (
        <section className="dyn-pending">
          <h4 className="dyn-section-title">Nova proposta pendente</h4>
          <DynamicProposalCard
            proposal={pending}
            steps={plan.steps}
            nameOf={nameOf}
            decidable={mission.phase === 'awaiting_approval'}
            online={online}
            send={send}
            subscribe={subscribe}
          />
        </section>
      )}

      {mission.phase === 'awaiting_decision' && <RecoveryPanel mission={mission} nameOf={nameOf} online={online} send={send} subscribe={subscribe} />}

      <section className="dyn-current">
        <h4 className="dyn-section-title">Plano atual aprovado</h4>
        {!plan.loaded ? (
          <p className="dyn-dim">Carregando o plano…</p>
        ) : plan.steps.length === 0 ? (
          <p className="dyn-dim">Nenhum passo aprovado ainda.</p>
        ) : (
          <>
            {[
              ['Em execução', groups.running],
              ['Prontos para rodar', groups.ready],
              ['Aguardando dependências', groups.waiting],
              ['Bloqueados', groups.blocked],
              ['Não terminaram', groups.stopped],
              ['Concluídos', groups.completed],
            ].map(([label, list]) =>
              (list as PlannedStep[]).length ? (
                <div key={label as string} className="dyn-step-group">
                  <h6>
                    {label as string} ({(list as PlannedStep[]).length})
                  </h6>
                  <ul>{(list as PlannedStep[]).map(stepRow)}</ul>
                </div>
              ) : null,
            )}
          </>
        )}
      </section>

      {mission.limits && (
        <section className="dyn-limits" aria-label="Limites da missão">
          <h6>Limites da missão</h6>
          <ul>
            {limitRows(mission, plan.steps, plan.proposals).map((r) => (
              <li key={r.key} className={r.used >= r.max ? 'dyn-limit-hit' : ''}>
                <span>{r.label}</span>
                <strong>
                  {r.used}/{r.max}
                </strong>
              </li>
            ))}
          </ul>
          <p className="dyn-dim">Contagens reais do que foi gravado. Os CLIs não informam custo nem tokens.</p>
        </section>
      )}

      {liveOutput && (mission.phase === 'executing' || mission.phase === 'planning') && (
        <section className="mission-live-box">
          <strong>Saída em tempo real</strong>
          <pre className="mission-live-output">{liveOutput}</pre>
        </section>
      )}

      {(history.length > 0 || groups.superseded.length > 0) && (
        <section className="dyn-history">
          <h4 className="dyn-section-title">Histórico</h4>
          {history.map((p) => (
            <details key={p.id}>
              <summary>
                Revisão {p.revision} · {p.kind === 'closure' ? 'encerramento' : p.kind === 'plan' ? 'plano inicial' : 'replanejamento'} ·{' '}
                <span className={`dyn-status dyn-status-${p.status}`}>{p.status === 'approved' ? 'aprovada' : p.status === 'rejected' ? 'rejeitada' : p.status === 'adjust_requested' ? 'ajustes pedidos' : 'substituída'}</span>
              </summary>
              <DynamicProposalCard proposal={p} steps={plan.steps} nameOf={nameOf} decidable={false} online={online} send={send} subscribe={subscribe} />
            </details>
          ))}
          {groups.superseded.length > 0 && (
            <details>
              <summary>Passos substituídos por replanejamento ({groups.superseded.length})</summary>
              <ul>{groups.superseded.map(stepRow)}</ul>
            </details>
          )}
        </section>
      )}

      {mission.error && mission.phase !== 'awaiting_decision' && (
        <section className="mission-error-box" role="alert">
          <strong>Erro registrado:</strong>
          <p>{mission.error}</p>
        </section>
      )}

      {open && mission.phase !== 'awaiting_decision' && (
        <div className="dyn-actions">
          <button type="button" className="btn-quiet" disabled={!online} onClick={() => send({ type: 'mission-cancel', missionId: mission.id })}>
            Cancelar missão
          </button>
        </div>
      )}
    </div>
  )
}
