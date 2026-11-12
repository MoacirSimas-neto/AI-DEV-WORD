import { useEffect, useRef, useState } from 'react'
import type { DynamicProposal, PlannedStep, ProposalDecision } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'
import { decisionMessage, KIND_LABEL, MODE_LABEL, OpGate, PROPOSAL_STATUS_LABEL, proposalImpact } from './dynamicView.ts'

interface Props {
  proposal: DynamicProposal
  /** Passos já gravados da missão: mostram o que a proposta mantém ou substitui. */
  steps: PlannedStep[]
  nameOf: (agentId: string) => string
  /** true = proposta pendente e missão aguardando aprovação: mostra as ações humanas. */
  decidable: boolean
  online: boolean
  send: Send
  subscribe: Subscribe
}

const refLabel = (ref: DynamicProposal['sharedContext'][number]) =>
  ref.kind === 'plan' ? 'Plano aprovado' : ref.kind === 'git-diff' ? 'Diferenças do Git' : `Resultado de ${ref.key}${ref.revision ? ` (revisão ${ref.revision})` : ''}`

/** Proposta do Tech Lead: o que ela pede, o que muda se for aprovada e as ações humanas. */
export function DynamicProposalCard({ proposal, steps, nameOf, decidable, online, send, subscribe }: Props) {
  const [mode, setMode] = useState<ProposalDecision | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const gate = useRef(new OpGate())
  const impact = proposalImpact(proposal, steps)
  const rejected = new Map((proposal.previouslyRejected ?? []).map((r) => [r.agentId, r.revisions]))

  useEffect(
    () =>
      subscribe((msg) => {
        if (msg.type !== 'proposal-result' || !gate.current.settle(msg.opId)) return
        setBusy(false)
        setResult({ ok: msg.ok, message: msg.message })
        if (msg.ok) setMode(null)
      }),
    [subscribe],
  )
  // Conexão caiu: a resposta não vai chegar. O backend continua protegido pela revisão e pelo opId.
  const [wasOnline, setWasOnline] = useState(online)
  if (online !== wasOnline) {
    setWasOnline(online)
    if (!online) setBusy(false)
  }
  useEffect(() => {
    if (!online) gate.current.reset()
  }, [online])

  const submit = (decision: ProposalDecision) => {
    if (decision === 'adjust' && !text.trim()) return
    const opId = gate.current.begin()
    if (!opId) return
    setBusy(true)
    setResult(null)
    send(decisionMessage(proposal, decision, opId, text))
  }

  return (
    <article className={`dyn-proposal dyn-proposal-${proposal.status}`} aria-label={`Proposta revisão ${proposal.revision}`}>
      <header className="dyn-proposal-head">
        <div>
          <span className="dyn-kicker">
            {KIND_LABEL[proposal.kind]} · revisão {proposal.revision}
          </span>
          <h4>{proposal.objective || 'Objetivo não informado'}</h4>
        </div>
        <span className={`dyn-status dyn-status-${proposal.status}`}>{PROPOSAL_STATUS_LABEL[proposal.status]}</span>
      </header>

      <section className="dyn-block">
        <h5>Justificativa</h5>
        <p>{proposal.reason}</p>
        {proposal.missionState && <p className="dyn-dim">Situação, segundo o Tech Lead: {proposal.missionState}</p>}
      </section>

      {proposal.teamChanges.length > 0 && (
        <section className="dyn-block">
          <h5>Equipe</h5>
          <ul className="dyn-team-changes">
            {proposal.teamChanges.map((c) => (
              <li key={`${c.action}:${c.agentId}`} className={`dyn-change dyn-change-${c.action}`}>
                <div className="dyn-change-head">
                  <span className="dyn-change-tag">{c.action === 'convene' ? 'Convocar' : 'Dispensar'}</span>
                  <strong>{nameOf(c.agentId)}</strong>
                  {rejected.has(c.agentId) && (
                    <span className="dyn-warn-tag" title="O usuário já rejeitou esta mudança de equipe antes nesta missão">
                      já rejeitado na revisão {rejected.get(c.agentId)!.join(', ')}
                    </span>
                  )}
                </div>
                <dl className="dyn-change-details">
                  <dt>Motivo</dt>
                  <dd>{c.reason}</dd>
                  {c.task && (
                    <>
                      <dt>Tarefa</dt>
                      <dd>{c.task}</dd>
                    </>
                  )}
                  {c.context && (
                    <>
                      <dt>Recebe</dt>
                      <dd>{c.context}</dd>
                    </>
                  )}
                  <dt>Impacto</dt>
                  <dd>{c.expectedImpact}</dd>
                  <dt>Sem esta mudança</dt>
                  <dd>{c.alternative}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}

      {proposal.steps.length > 0 && (
        <section className="dyn-block">
          <h5>Plano proposto</h5>
          <ol className="dyn-step-list">
            {proposal.steps.map((s) => (
              <li key={s.key} className="dyn-step">
                <div className="dyn-step-head">
                  <code>{s.key}</code>
                  <strong>{nameOf(s.agentId)}</strong>
                  <span className={`dyn-mode dyn-mode-${s.mode}`} title={MODE_LABEL[s.mode].hint}>
                    {MODE_LABEL[s.mode].label}
                  </span>
                </div>
                <p>{s.objective}</p>
                <p className="dyn-dim">
                  {s.dependsOn.length ? `Depois de: ${s.dependsOn.join(', ')}` : 'Sem dependências'}
                  {s.inputs.length ? ` · Recebe: ${s.inputs.map(refLabel).join(', ')}` : ' · Sem entradas'}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(proposal.sharedContext.length > 0 || proposal.risks.length > 0 || proposal.completionCriteria.length > 0) && (
        <section className="dyn-block dyn-grid">
          {proposal.sharedContext.length > 0 && (
            <div>
              <h5>Contexto compartilhado</h5>
              <ul>{proposal.sharedContext.map((r, i) => <li key={i}>{refLabel(r)}</li>)}</ul>
            </div>
          )}
          {proposal.risks.length > 0 && (
            <div>
              <h5>Riscos</h5>
              <ul>{proposal.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
          {proposal.completionCriteria.length > 0 && (
            <div>
              <h5>Critérios de conclusão</h5>
              <ul>{proposal.completionCriteria.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {proposal.status === 'pending' && (
        <section className="dyn-impact" aria-label="O que muda se você aprovar">
          <h5>Se você aprovar</h5>
          <ul>
            {impact.closes && <li>A missão é encerrada.</li>}
            {impact.joins.map((id) => <li key={`j-${id}`}>{nameOf(id)} entra na equipe (com as skills e a configuração de agora).</li>)}
            {impact.leaves.map((id) => <li key={`l-${id}`}>{nameOf(id)} sai da equipe desta missão; o cadastro e o histórico ficam.</li>)}
            {proposal.steps.length > 0 && <li>{proposal.steps.length} passo(s) novo(s) passam a valer.</li>}
            {impact.replaced.map((s) => <li key={`r-${s.id}`} className="dyn-replaced">Substitui o passo ainda não iniciado {s.key} ({nameOf(s.agentId)}).</li>)}
            {impact.kept.length > 0 && <li>Os {impact.kept.length} passo(s) aprovados que ainda não começaram continuam valendo.</li>}
            {!impact.closes && proposal.steps.length === 0 && proposal.teamChanges.length === 0 && <li>Nada muda no plano.</li>}
          </ul>
          <p className="dyn-dim">Se rejeitar: {proposal.alternative}</p>
        </section>
      )}

      {proposal.feedback && (
        <p className="dyn-feedback">
          <strong>Sua resposta:</strong> {proposal.feedback}
        </p>
      )}

      <details className="dyn-tech">
        <summary>Detalhes técnicos</summary>
        <p className="dyn-dim">
          Gatilho: {proposal.trigger || '—'} · Autor: {nameOf(proposal.author)} · Criada em {new Date(proposal.createdAt).toLocaleString()}
          {proposal.decidedAt ? ` · Decidida em ${new Date(proposal.decidedAt).toLocaleString()} por ${proposal.decidedBy ?? '—'}` : ''}
        </p>
        <pre>{JSON.stringify({ teamChanges: proposal.teamChanges, steps: proposal.steps, sharedContext: proposal.sharedContext }, null, 2)}</pre>
      </details>

      {decidable && proposal.status === 'pending' && (
        <footer className="dyn-actions">
          {mode === null && (
            <>
              <button type="button" disabled={!online || busy} onClick={() => setMode('approve')}>
                Aprovar…
              </button>
              <button type="button" className="btn-quiet" disabled={!online || busy} onClick={() => setMode('adjust')}>
                Pedir ajustes…
              </button>
              <button type="button" className="btn-quiet" disabled={!online || busy} onClick={() => setMode('reject')}>
                Rejeitar…
              </button>
            </>
          )}
          {mode === 'approve' && (
            <div className="dyn-confirm">
              <p>
                Confirmar a revisão {proposal.revision}? As mudanças listadas em "Se você aprovar" serão aplicadas pelo backend
                {proposal.steps.length ? ' e os passos começam a rodar em seguida' : ''}.
              </p>
              <div className="dyn-confirm-actions">
                <button type="button" disabled={!online || busy} onClick={() => submit('approve')}>
                  {busy ? 'Enviando…' : 'Confirmar aprovação'}
                </button>
                <button type="button" className="btn-quiet" disabled={busy} onClick={() => setMode(null)}>
                  Voltar
                </button>
              </div>
            </div>
          )}
          {(mode === 'reject' || mode === 'adjust') && (
            <div className="dyn-confirm">
              <label htmlFor={`dyn-text-${proposal.id}`}>
                {mode === 'adjust' ? 'O que o Tech Lead deve mudar? (obrigatório)' : 'Motivo da rejeição (opcional)'}
              </label>
              <textarea
                id={`dyn-text-${proposal.id}`}
                rows={3}
                maxLength={5000}
                value={text}
                placeholder={mode === 'adjust' ? 'Ex.: Não quero Segurança agora. Consulte Dados primeiro.' : 'Ex.: O escopo está grande demais.'}
                onChange={(e) => setText(e.target.value)}
              />
              <p className="dyn-dim">
                {mode === 'adjust'
                  ? 'O Tech Lead faz uma nova proposta com o seu pedido; nada desta é executado.'
                  : 'A proposta fica no histórico. Se já houver passos aprovados, eles continuam; senão, a missão espera a sua decisão.'}
              </p>
              <div className="dyn-confirm-actions">
                <button type="button" disabled={!online || busy || (mode === 'adjust' && !text.trim())} onClick={() => submit(mode)}>
                  {busy ? 'Enviando…' : mode === 'adjust' ? 'Enviar pedido de ajustes' : 'Confirmar rejeição'}
                </button>
                <button type="button" className="btn-quiet" disabled={busy} onClick={() => setMode(null)}>
                  Voltar
                </button>
              </div>
            </div>
          )}
        </footer>
      )}
      {result && (
        <p className={result.ok ? 'dyn-result-ok' : 'dyn-result-error'} role="status">
          {result.message}
        </p>
      )}
    </article>
  )
}
