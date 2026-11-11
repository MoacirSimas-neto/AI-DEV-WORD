import { useState } from 'react'
import type { MissionInfo } from '../../../shared/protocol.ts'
import type { Send } from '../net/useServer.ts'

interface Props {
  mission: MissionInfo
  online: boolean
  send: Send
}

/** Pergunta pendente do planejador: o usuário responde e a missão volta a planejar. */
export function ClarificationBox({ mission, online, send }: Props) {
  const [answer, setAnswer] = useState('')
  const pending = mission.clarifications?.at(-1)
  if (mission.phase !== 'awaiting_clarification' || !pending || pending.answer !== null) return null
  const planner = mission.teamSnapshot?.[pending.agentId]?.name ?? pending.agentId

  return (
    <section className="mission-approval-box" aria-label="Esclarecimento solicitado">
      <div className="mission-approval-head">
        <strong>❓ {planner} precisa de uma resposta para planejar</strong>
      </div>
      <pre className="mission-plan-text">{pending.question}</pre>
      <textarea
        className="clarify-input"
        rows={3}
        maxLength={5000}
        placeholder="Sua resposta (vira requisito desta missão)"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
      />
      <div className="mission-actions">
        <button
          type="button"
          disabled={!online || !answer.trim()}
          onClick={() => {
            send({ type: 'mission-clarify', missionId: mission.id, answer: answer.trim() })
            setAnswer('')
          }}
        >
          Responder e retomar
        </button>
        <button
          type="button"
          className="btn-quiet"
          disabled={!online}
          onClick={() => send({ type: 'mission-cancel', missionId: mission.id })}
        >
          Cancelar missão
        </button>
      </div>
    </section>
  )
}
