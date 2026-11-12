import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AgentInfo, MissionInfo } from '../../../shared/protocol.ts'
import { agent, fakeServer, mission, task } from '../test/fakeServer.ts'
import { TaskPanel } from './TaskPanel.tsx'

const TEAM = [agent('architect'), agent('dev'), agent('qa')]

function setup({ agents = TEAM, missions = [] as MissionInfo[], online = true } = {}) {
  const server = fakeServer()
  const user = userEvent.setup()
  render(
    <TaskPanel
      tasks={[task()]}
      missions={missions}
      agents={agents as AgentInfo[]}
      configs={[]}
      activeProjectId={1}
      online={online}
      send={server.send}
      subscribe={server.subscribe}
      onClose={() => {}}
    />,
  )
  return { server, user }
}

describe('TaskPanel · modo da missão', () => {
  it('começa no clássico e inicia a missão com a equipe padrão', async () => {
    const { server, user } = setup()
    expect(screen.getByRole('radio', { name: /Clássico/ })).toHaveProperty('checked', true)
    expect(screen.getByLabelText('Equipe responsável pela missão')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Modo Equipe' }))
    expect(server.of('mission-start')).toEqual([{ type: 'mission-start', taskId: 7, team: undefined }])
  })

  it('no dinâmico escolhe o Tech Lead e envia mode=dynamic', async () => {
    const { server, user } = setup()
    await user.click(screen.getByRole('radio', { name: /Dinâmico/ }))
    expect(screen.queryByLabelText('Equipe responsável pela missão')).toBeNull()
    expect(screen.getByLabelText('Tech Lead')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Missão dinâmica' }))
    expect(server.of('mission-start')).toEqual([{ type: 'mission-start', taskId: 7, mode: 'dynamic', team: { plannerId: 'architect' } }])
  })

  it('Tech Lead com CLI offline: não deixa iniciar e oferece verificar o CLI', async () => {
    const { server, user } = setup({ agents: [agent('architect', { state: 'offline' }), agent('dev'), agent('qa')] })
    await user.click(screen.getByRole('radio', { name: /Dinâmico/ }))
    expect(screen.getByRole('button', { name: 'Missão dinâmica' })).toHaveProperty('disabled', true)
    await user.click(screen.getByRole('button', { name: 'Verificar CLI' }))
    expect(server.of('check-cli')).toEqual([{ type: 'check-cli', agentId: 'architect' }])
  })

  it('sem conexão o início fica desabilitado', () => {
    setup({ online: false })
    expect(screen.getByRole('button', { name: 'Modo Equipe' })).toHaveProperty('disabled', true)
  })

  it('com missão aberta não há seletor de modo nem novo início', () => {
    setup({ missions: [mission({ phase: 'executing' })] })
    expect(screen.queryByLabelText('Modo da missão')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Modo Equipe' })).toBeNull()
  })

  it('aviso do backend (ex.: recusa ao iniciar) aparece na tela', async () => {
    const { server } = setup()
    server.emit({ type: 'notice', message: 'Já existe uma missão aberta neste projeto.' })
    expect(screen.getByRole('alert').textContent).toContain('Já existe uma missão aberta neste projeto.')
  })
})
