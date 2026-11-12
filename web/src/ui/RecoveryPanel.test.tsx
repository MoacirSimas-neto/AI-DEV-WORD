import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeServer, mission, recovery, step } from '../test/fakeServer.ts'
import { RecoveryPanel } from './RecoveryPanel.tsx'

const nameOf = (id: string) => ({ dev: 'Dev' })[id] ?? id
const stopped = mission({ phase: 'awaiting_decision' })

function setup(online = true) {
  const server = fakeServer()
  const user = userEvent.setup()
  const view = render(<RecoveryPanel mission={stopped} nameOf={nameOf} online={online} send={server.send} subscribe={server.subscribe} />)
  return { server, user, view }
}

describe('RecoveryPanel', () => {
  it('pede o estado ao backend e mostra carregamento até a resposta', () => {
    const { server } = setup()
    expect(server.of('mission-recovery')).toEqual([{ type: 'mission-recovery', projectId: 1, missionId: 3 }])
    expect(screen.getByText('Consultando o estado da missão…')).toBeTruthy()
    server.emit({ type: 'mission-recovery', state: recovery() })
    expect(screen.getByText('O app foi fechado durante a execução')).toBeTruthy()
    expect(screen.getByText('Sem alterações pendentes.')).toBeTruthy()
  })

  it('estado de outra missão não é usado', () => {
    const { server } = setup()
    server.emit({ type: 'mission-recovery', state: recovery({ missionId: 99 }) })
    expect(screen.getByText('Consultando o estado da missão…')).toBeTruthy()
  })

  it('só mostra as ações que o backend permite', () => {
    const { server } = setup()
    server.emit({ type: 'mission-recovery', state: recovery({ actions: ['replan', 'cancel'] }) })
    expect(screen.queryByRole('button', { name: 'Continuar passos aprovados' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Encerrar missão…' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Pedir replanejamento' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelar missão…' })).toBeTruthy()
  })

  it('reexecutar um passo interrompido avisa sobre alterações parciais e envia o stepId', async () => {
    const { server, user } = setup()
    server.emit({
      type: 'mission-recovery',
      state: recovery({ retryable: [step({ id: 21, status: 'interrupted' })], actions: ['retry_step', 'replan', 'cancel'] }),
    })
    expect(screen.getByText(/pode ter deixado alterações parciais/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Executar de novo' }))
    expect(server.of('mission-resume')[0]).toMatchObject({ missionId: 3, action: 'retry_step', stepId: 21 })
    expect('acceptChanges' in server.of('mission-resume')[0]).toBe(false)
  })

  it('aceite de alterações desconhecidas envia a lista exibida; sem marcar, nada é aceito', async () => {
    const { server, user } = setup()
    server.emit({ type: 'mission-recovery', state: recovery({ files: { available: true, known: ['a.ts'], unknown: ['b.ts', 'c.ts'] } }) })
    expect(screen.getByText(/Alterações que a missão não registrou/).parentElement!.textContent).toContain('b.ts, c.ts')

    await user.click(screen.getByRole('button', { name: 'Continuar passos aprovados' }))
    expect('acceptChanges' in server.of('mission-resume')[0]).toBe(false)
    const first = server.of('mission-resume')[0]
    server.emit({ type: 'mission-resume-result', opId: first.opId, missionId: 3, ok: false, applied: false, message: 'Bloqueado por alterações.' })

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Continuar passos aprovados' }))
    expect(server.of('mission-resume')[1]).toMatchObject({ action: 'continue', acceptChanges: true, acceptFiles: ['b.ts', 'c.ts'] })
  })

  it('se a lista de alterações muda, a confirmação anterior é desmarcada', async () => {
    const { server, user } = setup()
    server.emit({ type: 'mission-recovery', state: recovery({ files: { available: true, known: [], unknown: ['b.ts'] } }) })
    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', true)
    server.emit({ type: 'mission-recovery', state: recovery({ files: { available: true, known: [], unknown: ['b.ts', 'novo.ts'] } }) })
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
  })

  it('replanejamento leva o pedido ao Tech Lead; um clique só, e a resposta atualiza o estado', async () => {
    const { server, user } = setup()
    server.emit({ type: 'mission-recovery', state: recovery() })
    await user.type(screen.getByLabelText('Pedido ao Tech Lead (opcional)'), 'Sem o QA.')
    const replan = screen.getByRole('button', { name: 'Pedir replanejamento' })
    await user.click(replan)
    await user.click(replan)
    expect(server.of('mission-resume')).toHaveLength(1)
    expect(server.of('mission-resume')[0]).toMatchObject({ action: 'replan', detail: 'Sem o QA.' })
    expect(replan).toHaveProperty('disabled', true)

    const { opId } = server.of('mission-resume')[0]
    server.emit({ type: 'mission-resume-result', opId, missionId: 3, ok: true, applied: true, message: 'O Tech Lead foi consultado.' })
    expect(screen.getByRole('status').textContent).toBe('O Tech Lead foi consultado.')
    // Depois da resposta a tela pede a fotografia atualizada.
    expect(server.of('mission-recovery')).toHaveLength(2)
  })

  it('erro da retomada aparece e libera os botões', async () => {
    const { server, user } = setup()
    server.emit({ type: 'mission-recovery', state: recovery() })
    await user.click(screen.getByRole('button', { name: 'Continuar passos aprovados' }))
    const { opId } = server.of('mission-resume')[0]
    server.emit({ type: 'mission-resume-result', opId, missionId: 3, ok: false, applied: false, message: 'Há alterações que você não viu ao confirmar (x.ts).' })
    expect(screen.getByRole('status').textContent).toMatch(/não viu ao confirmar/)
    expect(screen.getByRole('button', { name: 'Continuar passos aprovados' })).toHaveProperty('disabled', false)
  })

  it('encerrar e cancelar pedem confirmação antes de enviar', async () => {
    const { server, user } = setup()
    server.emit({ type: 'mission-recovery', state: recovery() })
    await user.click(screen.getByRole('button', { name: 'Cancelar missão…' }))
    expect(server.of('mission-cancel')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    await user.click(screen.getByRole('button', { name: 'Encerrar missão…' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar encerramento' }))
    expect(server.of('mission-close')).toEqual([{ type: 'mission-close', missionId: 3 }])
    expect(server.of('mission-cancel')).toHaveLength(0)
  })

  it('offline: não pede estado e desabilita as ações; ao reconectar, pede de novo', () => {
    const { server, view } = setup(false)
    expect(server.of('mission-recovery')).toHaveLength(0)
    view.rerender(<RecoveryPanel mission={stopped} nameOf={nameOf} online send={server.send} subscribe={server.subscribe} />)
    expect(server.of('mission-recovery')).toHaveLength(1)
    server.emit({ type: 'mission-recovery', state: recovery() })
    view.rerender(<RecoveryPanel mission={stopped} nameOf={nameOf} online={false} send={server.send} subscribe={server.subscribe} />)
    expect(screen.getByRole('button', { name: 'Continuar passos aprovados' })).toHaveProperty('disabled', true)
  })
})
