import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MissionInfo } from '../../../shared/protocol.ts'
import { agent, fakeServer, mission, proposal, step, task } from '../test/fakeServer.ts'
import { DynamicMissionMonitor } from './DynamicMissionMonitor.tsx'

const AGENTS = [agent('architect'), agent('dev'), agent('qa')]

function setup(m: MissionInfo = mission(), online = true) {
  const server = fakeServer()
  const ui = (mm: MissionInfo, on: boolean) => (
    <DynamicMissionMonitor mission={mm} task={task()} agents={AGENTS} configs={[]} online={on} send={server.send} subscribe={server.subscribe} />
  )
  const view = render(ui(m, online))
  return { server, rerender: (mm: MissionInfo, on = true) => view.rerender(ui(mm, on)) }
}

const plan = (server: ReturnType<typeof fakeServer>, proposals = [proposal()], steps = [step()]) =>
  server.emit({ type: 'mission-plan', projectId: 1, missionId: 3, proposals, steps })

describe('DynamicMissionMonitor', () => {
  it('pede plano e trilha ao montar e mostra carregamento até chegar', () => {
    const { server } = setup()
    expect(server.of('plan-list')).toEqual([{ type: 'plan-list', projectId: 1, missionId: 3 }])
    expect(server.of('events-list')).toEqual([{ type: 'events-list', projectId: 1, missionId: 3 }])
    expect(screen.getByText('Carregando o plano…')).toBeTruthy()
    plan(server, [proposal()], [])
    expect(screen.getByText('Nenhum passo aprovado ainda.')).toBeTruthy()
  })

  it('proposta pendente é decidível só em awaiting_approval', () => {
    const { server, rerender } = setup()
    plan(server, [proposal()], [])
    expect(screen.getByText('Nova proposta pendente')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Aprovar…' })).toBeTruthy()
    rerender(mission({ phase: 'planning' }))
    expect(screen.queryByRole('button', { name: 'Aprovar…' })).toBeNull()
    expect(screen.getByText(/está analisando/)).toBeTruthy()
  })

  it('a equipe acompanha as propostas aprovadas: convocação entra, dispensa aparece como dispensado', () => {
    const { server } = setup(mission({ phase: 'executing' }))
    const convene = proposal({ status: 'approved' })
    plan(server, [convene], [step({ status: 'running', startedAt: '2026-11-01T12:01:00.000Z' })])
    const overview = () => screen.getByText('Criar API de pagamentos').closest('section')!
    expect(within(overview()).getByText('Arquiteto · Tech Lead')).toBeTruthy()
    expect(within(overview()).getByText('Dev')).toBeTruthy()
    expect(screen.getByText('Em execução (1)')).toBeTruthy()

    const release = proposal({
      id: 12,
      revision: 2,
      kind: 'replan',
      status: 'approved',
      steps: [],
      teamChanges: [{ action: 'release', agentId: 'dev', reason: 'Terminou.', task: '', context: '', expectedImpact: 'Menos chamadas.', alternative: 'Fica.' }],
    })
    plan(server, [convene, release], [step({ status: 'completed' })])
    expect(within(overview()).getByText('Dev · dispensado')).toBeTruthy()
    expect(screen.getByText('Concluídos (1)')).toBeTruthy()
  })

  it('plano de outra missão é ignorado', () => {
    const { server } = setup()
    server.emit({ type: 'mission-plan', projectId: 1, missionId: 99, proposals: [proposal({ missionId: 99 })], steps: [] })
    expect(screen.getByText('Carregando o plano…')).toBeTruthy()
  })

  it('reconexão pede o plano e a trilha de novo', () => {
    const { server, rerender } = setup()
    rerender(mission(), false)
    rerender(mission(), true)
    expect(server.of('plan-list')).toHaveLength(2)
    expect(server.of('events-list')).toHaveLength(2)
  })

  it('parada para decisão mostra o painel de recuperação; erro aparece fora dele', () => {
    const { server, rerender } = setup(mission({ phase: 'awaiting_decision', error: 'Interrompida.' }))
    plan(server, [proposal({ status: 'approved' })], [])
    expect(screen.getByText('Consultando o estado da missão…')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    rerender(mission({ phase: 'failed', error: 'CLI saiu com código 1.' }))
    expect(screen.getByRole('alert').textContent).toContain('CLI saiu com código 1.')
  })

  it('cancelar envia a missão certa e some quando a missão fecha', () => {
    const { server, rerender } = setup(mission({ phase: 'executing' }))
    screen.getByRole('button', { name: 'Cancelar missão' }).click()
    expect(server.of('mission-cancel')).toEqual([{ type: 'mission-cancel', missionId: 3 }])
    rerender(mission({ phase: 'cancelled' }))
    expect(screen.queryByRole('button', { name: 'Cancelar missão' })).toBeNull()
  })

  it('desmontar remove os ouvintes do WebSocket', () => {
    const server = fakeServer()
    const view = render(<DynamicMissionMonitor mission={mission()} task={task()} agents={AGENTS} configs={[]} online send={server.send} subscribe={server.subscribe} />)
    expect(server.listenerCount).toBeGreaterThan(0)
    view.unmount()
    expect(server.listenerCount).toBe(0)
  })
})
