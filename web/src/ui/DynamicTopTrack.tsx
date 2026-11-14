import type { MissionInfo } from '../../../shared/protocol.ts'
import { usePlan } from '../net/useMission.ts'
import type { Send, Subscribe } from '../net/useServer.ts'
import { currentPlanSteps, DYNAMIC_PHASE_LABEL, MODE_LABEL, pendingProposal, STEP_STATUS_LABEL } from './dynamicView.ts'

interface Props {
  mission: MissionInfo
  title: string
  online: boolean
  send: Send
  subscribe: Subscribe
  onSelectAgent: (agentId: string) => void
}

const MAX_SHOWN = 5
const ICON: Record<string, string> = { completed: '✓', running: '⚡', blocked: '!', failed: '✕', interrupted: '⏸', cancelled: '–', approved: '•' }

/** Esteira da barra superior para missão dinâmica: os passos reais aprovados, não uma sequência fixa. */
export function DynamicTopTrack({ mission, title, online, send, subscribe, onSelectAgent }: Props) {
  const plan = usePlan(send, subscribe, online, mission.projectId, mission.id)
  const steps = currentPlanSteps(plan.steps)
  const shown = steps.slice(-MAX_SHOWN)
  const nameOf = (id: string) => mission.teamSnapshot?.[id]?.name ?? id
  const pending = pendingProposal(plan.proposals)

  return (
    <div className="pipeline-container">
      <div className="pipeline-meta-row">
        <span className="pipeline-title" title={`#${mission.id} ${title}`}>
          <strong className="mission-id">#{mission.id}</strong>{title}
        </span>
        <span className="pipeline-progress-badge">
          {DYNAMIC_PHASE_LABEL[mission.phase] ?? mission.phase}
          {pending ? ` · revisão ${pending.revision}` : ''}
        </span>
      </div>
      <div className="pipeline-track">
        {steps.length > shown.length && <span className="pipeline-more">+{steps.length - shown.length}</span>}
        {shown.length === 0 ? (
          <span className="pipeline-empty">{pending ? 'Proposta aguardando sua decisão' : 'Sem passos aprovados ainda'}</span>
        ) : (
          shown.map((s, i) => (
            <span key={s.id} className="pipeline-step-wrap">
              {i > 0 && <span className={`pipeline-connector ${s.status === 'approved' ? 'conn-pending' : 'conn-done'}`} />}
              <button
                type="button"
                className={`pipeline-step ${s.status === 'running' ? 'step-active' : s.status === 'completed' ? 'step-done' : 'step-waiting'}`}
                onClick={() => onSelectAgent(s.agentId)}
                title={`${s.key}: ${s.objective} (${STEP_STATUS_LABEL[s.status]})`}
              >
                <span className="step-circle">{ICON[s.status] ?? '•'}</span>
                <div className="step-texts">
                  <strong>{MODE_LABEL[s.mode].label}</strong>
                  <span>{nameOf(s.agentId)}</span>
                </div>
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  )
}
