import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeServer, proposal, step } from '../test/fakeServer.ts'
import { DynamicProposalCard } from './DynamicProposalCard.tsx'

const nameOf = (id: string) => ({ dev: 'Dev', qa: 'QA', architect: 'Arquiteto' })[id] ?? id

function setup(props: Partial<Parameters<typeof DynamicProposalCard>[0]> = {}) {
  const server = fakeServer()
  const user = userEvent.setup()
  const view = render(
    <DynamicProposalCard
      proposal={proposal()}
      steps={[]}
      nameOf={nameOf}
      decidable
      online
      send={server.send}
      subscribe={server.subscribe}
      onRequestMissionConsent={async () => ({ nonce: 'test-consent-nonce' })}
      {...props}
    />,
  )
  return { server, user, view }
}

describe('DynamicProposalCard', () => {
  it('mostra o que a proposta pede e o que muda se for aprovada', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'API de pagamentos com testes' })).toBeTruthy()
    expect(screen.getByText('Plano inicial · revisão 1')).toBeTruthy()
    expect(screen.getByText('Convocar')).toBeTruthy()
    const impact = screen.getByLabelText('O que muda se você aprovar')
    expect(within(impact).getByText(/Dev entra na equipe/)).toBeTruthy()
    expect(within(impact).getByText('1 passo(s) novo(s) passam a valer.')).toBeTruthy()
    expect(within(impact).getByText('Se rejeitar: A missão fica parada.')).toBeTruthy()
  })

  it('replanejamento mostra o passo ainda não iniciado que será substituído', () => {
    setup({
      proposal: proposal({ kind: 'replan', revision: 2, teamChanges: [] }),
      steps: [step({ id: 5, key: 'antigo', status: 'approved' })],
    })
    expect(screen.getByText('Replanejamento · revisão 2')).toBeTruthy()
    expect(screen.getByText(/Substitui o passo ainda não iniciado antigo \(Dev\)/)).toBeTruthy()
  })

  it('aprovação pede confirmação e envia a revisão que o usuário viu', async () => {
    const { server, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Aprovar…' }))
    expect(server.of('proposal-decide')).toHaveLength(0)
    expect(screen.getByText(/Confirmar a revisão 1\?/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Confirmar aprovação' }))
    const [msg] = server.of('proposal-decide')
    expect(msg).toMatchObject({ missionId: 3, proposalId: 11, revision: 1, decision: 'approve' })
    expect(msg.opId).toBeTruthy()
  })

  it('cliques repetidos enquanto espera a resposta não reenviam a decisão', async () => {
    const { server, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Aprovar…' }))
    const confirm = screen.getByRole('button', { name: 'Confirmar aprovação' })
    await user.click(confirm)
    expect(screen.getByRole('button', { name: 'Enviando…' })).toHaveProperty('disabled', true)
    // Clique direto no elemento desabilitado e um segundo envio programático são ignorados.
    await user.click(screen.getByRole('button', { name: 'Enviando…' }))
    expect(server.of('proposal-decide')).toHaveLength(1)
  })

  it('resposta de outra operação é ignorada; a resposta certa libera e mostra a mensagem', async () => {
    const { server, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Aprovar…' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar aprovação' }))
    const opId = server.of('proposal-decide')[0].opId
    server.emit({ type: 'proposal-result', opId: 'outra-aba', missionId: 3, proposalId: 11, ok: true, applied: true, status: 'approved', message: 'De outra aba.' })
    expect(screen.queryByText('De outra aba.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeTruthy()
    server.emit({ type: 'proposal-result', opId, missionId: 3, proposalId: 11, ok: true, applied: true, status: 'approved', message: 'Proposta aprovada.' })
    expect(screen.getByRole('status').textContent).toBe('Proposta aprovada.')
  })

  it('revisão obsoleta: o erro do backend aparece e o usuário pode decidir de novo', async () => {
    const { server, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Aprovar…' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar aprovação' }))
    const opId = server.of('proposal-decide')[0].opId
    server.emit({ type: 'proposal-result', opId, missionId: 3, proposalId: 11, ok: false, applied: false, status: 'superseded', message: 'Esta revisão já não é a vigente.' })
    expect(screen.getByRole('status').textContent).toBe('Esta revisão já não é a vigente.')
    expect(screen.getByRole('button', { name: 'Confirmar aprovação' })).toHaveProperty('disabled', false)
  })

  it('pedir ajustes exige texto e envia o pedido como feedback', async () => {
    const { server, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Pedir ajustes…' }))
    const sendButton = screen.getByRole('button', { name: 'Enviar pedido de ajustes' })
    expect(sendButton).toHaveProperty('disabled', true)
    await user.type(screen.getByLabelText('O que o Tech Lead deve mudar? (obrigatório)'), '  Sem QA agora.  ')
    await user.click(sendButton)
    expect(server.of('proposal-decide')[0]).toMatchObject({ decision: 'adjust', feedback: 'Sem QA agora.' })
  })

  it('rejeição com motivo opcional', async () => {
    const { server, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Rejeitar…' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar rejeição' }))
    const [msg] = server.of('proposal-decide')
    expect(msg.decision).toBe('reject')
    expect('feedback' in msg).toBe(false)
  })

  it('proposta já decidida ou fora de awaiting_approval não oferece ações', () => {
    setup({ proposal: proposal({ status: 'superseded' }) })
    expect(screen.queryByRole('button', { name: 'Aprovar…' })).toBeNull()
    expect(screen.getByText('Substituída')).toBeTruthy()
    cleanupAndRender({ decidable: false })
    expect(screen.queryByRole('button', { name: 'Aprovar…' })).toBeNull()
  })

  it('sem conexão os botões ficam desabilitados; a queda libera uma operação pendente', async () => {
    const { server, user, view } = setup()
    await user.click(screen.getByRole('button', { name: 'Aprovar…' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar aprovação' }))
    const rerender = (online: boolean) =>
      view.rerender(<DynamicProposalCard proposal={proposal()} steps={[]} nameOf={nameOf} decidable online={online} send={server.send} subscribe={server.subscribe} onRequestMissionConsent={async () => ({ nonce: 'test-consent-nonce' })} />)
    rerender(false)
    expect(screen.getByRole('button', { name: 'Confirmar aprovação' })).toHaveProperty('disabled', true)
    rerender(true)
    await user.click(screen.getByRole('button', { name: 'Confirmar aprovação' }))
    expect(server.of('proposal-decide')).toHaveLength(2)
    expect(server.of('proposal-decide')[1].opId).not.toBe(server.of('proposal-decide')[0].opId)
  })

  it('avisa quando a mesma mudança de equipe já foi rejeitada antes', () => {
    setup({ proposal: proposal({ previouslyRejected: [{ agentId: 'dev', action: 'convene', revisions: [1] }], revision: 2 }) })
    expect(screen.getByText('já rejeitado na revisão 1')).toBeTruthy()
  })

  it('não envia proposal-decide se o consentimento nativo for cancelado', async () => {
    const { server, user } = setup({ onRequestMissionConsent: async () => ({ nonce: null }) })
    await user.click(screen.getByRole('button', { name: 'Aprovar…' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar aprovação' }))
    expect(server.of('proposal-decide')).toHaveLength(0)
  })
})

function cleanupAndRender(props: Partial<Parameters<typeof DynamicProposalCard>[0]>) {
  cleanup()
  setup(props)
}
