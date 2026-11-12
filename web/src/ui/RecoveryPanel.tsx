import { useEffect, useRef, useState } from 'react'
import type { MissionInfo, RecoveryState, ResumeAction } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'
import { BLOCK_REASON_LABEL, MODE_LABEL, OpGate, resumeMessage, STEP_STATUS_LABEL } from './dynamicView.ts'

interface Props {
  mission: MissionInfo
  nameOf: (agentId: string) => string
  online: boolean
  send: Send
  subscribe: Subscribe
}

/**
 * Missão dinâmica parada (awaiting_decision): o estado vem do backend (mission-recovery) e só as
 * ações que ele permite aparecem. Nada é descartado no repositório.
 */
export function RecoveryPanel({ mission, nameOf, online, send, subscribe }: Props) {
  const [state, setState] = useState<RecoveryState | null>(null)
  const [accept, setAccept] = useState(false)
  const [detail, setDetail] = useState('')
  const [confirm, setConfirm] = useState<'close' | 'cancel' | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const gate = useRef(new OpGate())

  useEffect(() => {
    const unsubscribe = subscribe((msg) => {
      if (msg.type === 'mission-recovery' && msg.state.missionId === mission.id) setState(msg.state)
      if (msg.type === 'mission-resume-result' && gate.current.settle(msg.opId)) {
        setBusy(false)
        setResult({ ok: msg.ok, message: msg.message })
        send({ type: 'mission-recovery', projectId: mission.projectId, missionId: mission.id })
      }
    })
    if (online) send({ type: 'mission-recovery', projectId: mission.projectId, missionId: mission.id })
    return unsubscribe
    // updatedAt: a missão mudou (outro passo, outra parada) e a fotografia precisa ser refeita.
  }, [send, subscribe, online, mission.id, mission.projectId, mission.updatedAt])

  // Conexão caiu: a resposta não vai chegar. O backend continua protegido pelo opId.
  const [wasOnline, setWasOnline] = useState(online)
  if (online !== wasOnline) {
    setWasOnline(online)
    if (!online) setBusy(false)
  }
  useEffect(() => {
    if (!online) gate.current.reset()
  }, [online])

  const resume = (action: ResumeAction, stepId?: number) => {
    const opId = gate.current.begin()
    if (!opId) return
    setBusy(true)
    setResult(null)
    send(
      resumeMessage(mission.id, action, opId, {
        stepId,
        detail: action === 'replan' ? detail : undefined,
        acceptChanges: accept && (state?.files.unknown.length ?? 0) > 0,
        acceptFiles: state?.files.unknown,
      }),
    )
  }

  // A lista de alterações mudou: a confirmação anterior não cobre a lista nova.
  const unknownKey = state?.files.unknown.join('\n') ?? ''
  const [acceptedKey, setAcceptedKey] = useState(unknownKey)
  if (unknownKey !== acceptedKey) {
    setAcceptedKey(unknownKey)
    setAccept(false)
  }

  if (!state) return <section className="dyn-recovery dyn-dim">Consultando o estado da missão…</section>
  const can = (action: RecoveryState['actions'][number]) => state.actions.includes(action)
  const unknown = state.files.unknown

  return (
    <section className="dyn-recovery" aria-label="Missão aguardando sua decisão">
      <header>
        <h5>Missão parada · decisão necessária</h5>
        <p>{state.reason ? (BLOCK_REASON_LABEL[state.reason] ?? state.reason) : 'A missão aguarda a sua decisão.'}</p>
        {state.error && <p className="dyn-dim">{state.error}</p>}
      </header>

      {state.retryable.length > 0 && (
        <div className="dyn-recovery-block">
          <h6>Passos que não terminaram</h6>
          <ul>
            {state.retryable.map((s) => (
              <li key={s.id}>
                <span>
                  <code>
                    r{s.revision}/{s.key}
                  </code>{' '}
                  {nameOf(s.agentId)} · {MODE_LABEL[s.mode].label} · {STEP_STATUS_LABEL[s.status]}
                  {(s.attempt ?? 1) > 1 ? ` · tentativa ${s.attempt}` : ''}
                  {s.mode === 'implement' && s.status === 'interrupted' && <em> · pode ter deixado alterações parciais</em>}
                </span>
                {can('retry_step') && (
                  <button type="button" className="btn-xs" disabled={!online || busy} onClick={() => resume('retry_step', s.id)}>
                    Executar de novo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="dyn-recovery-block">
        <h6>Repositório</h6>
        {!state.files.available ? (
          <p className="dyn-dim">Não foi possível ler o Git agora. A retomada confere de novo antes de qualquer escrita.</p>
        ) : unknown.length === 0 && state.files.known.length === 0 ? (
          <p className="dyn-dim">Sem alterações pendentes.</p>
        ) : (
          <>
            {state.files.known.length > 0 && (
              <p>
                <strong>Registradas pela missão:</strong> {state.files.known.join(', ')}
              </p>
            )}
            {unknown.length > 0 && (
              <div className="dyn-unknown">
                <p>
                  <strong>Alterações que a missão não registrou:</strong> {unknown.join(', ')}
                </p>
                <p className="dyn-dim">
                  Podem ser suas, de um passo interrompido ou de outro programa: não dá para saber a autoria. Nada será desfeito.
                  Para escrever por cima delas, um passo de implementação precisa da sua confirmação abaixo; você também pode fazer o
                  commit ou desfazê-las por conta própria antes de continuar.
                </p>
                <label className="dyn-accept">
                  <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                  <span>Aceito seguir com essas alterações no repositório (isto não comprova quem as fez).</span>
                </label>
              </div>
            )}
          </>
        )}
      </div>

      {can('replan') && (
        <div className="dyn-recovery-block">
          <label htmlFor={`replan-${mission.id}`}>Pedido ao Tech Lead (opcional)</label>
          <textarea
            id={`replan-${mission.id}`}
            rows={2}
            maxLength={2000}
            value={detail}
            placeholder="Ex.: Refaça o plano sem o QA; consulte Dados antes do Dev."
            onChange={(e) => setDetail(e.target.value)}
          />
        </div>
      )}

      <footer className="dyn-actions">
        {can('continue') && (
          <button type="button" disabled={!online || busy} onClick={() => resume('continue')}>
            Continuar passos aprovados
          </button>
        )}
        {can('replan') && (
          <button type="button" className="btn-quiet" disabled={!online || busy} onClick={() => resume('replan')}>
            Pedir replanejamento
          </button>
        )}
        {can('close') && confirm !== 'close' && (
          <button type="button" className="btn-quiet" disabled={!online || busy} onClick={() => setConfirm('close')}>
            Encerrar missão…
          </button>
        )}
        {can('cancel') && confirm !== 'cancel' && (
          <button type="button" className="btn-quiet" disabled={!online || busy} onClick={() => setConfirm('cancel')}>
            Cancelar missão…
          </button>
        )}
      </footer>
      {confirm && (
        <div className="dyn-confirm">
          <p>
            {confirm === 'close'
              ? 'Encerrar como concluída? Os passos não executados deixam de valer; as alterações no repositório ficam para você revisar.'
              : 'Cancelar a missão? Nada é desfeito no repositório.'}
          </p>
          <div className="dyn-confirm-actions">
            <button
              type="button"
              disabled={!online}
              onClick={() => {
                send(confirm === 'close' ? { type: 'mission-close', missionId: mission.id } : { type: 'mission-cancel', missionId: mission.id })
                setConfirm(null)
              }}
            >
              {confirm === 'close' ? 'Confirmar encerramento' : 'Confirmar cancelamento'}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setConfirm(null)}>
              Voltar
            </button>
          </div>
        </div>
      )}
      {result && (
        <p className={result.ok ? 'dyn-result-ok' : 'dyn-result-error'} role="status">
          {result.message}
        </p>
      )}
    </section>
  )
}
