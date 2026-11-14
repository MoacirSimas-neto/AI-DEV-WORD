import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AgentInfo, MissionInfo } from '../../../shared/protocol.ts'
import { agent, fakeServer, mission, task } from '../test/fakeServer.ts'
import { Markdown } from './chat/markdown.tsx'
import { MemoryCenter } from './MemoryCenter.tsx'
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

  it('descrição longa inicia recolhida, alterna Ver mais / Ver menos e renderiza Markdown seguro', async () => {
    const server = fakeServer()
    const user = userEvent.setup()
    const longDesc = '## Requisitos\n- Item 1\n- Item 2\n- Item 3\n- Item 4\n- Item 5 <script>alert(1)</script> ' + 'x'.repeat(240)
    const { container } = render(
      <TaskPanel
        tasks={[task({ description: longDesc })]}
        missions={[]}
        agents={TEAM as AgentInfo[]}
        configs={[]}
        activeProjectId={1}
        online
        send={server.send}
        subscribe={server.subscribe}
        onClose={() => {}}
      />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('.task-desc-markdown')?.classList.contains('is-collapsed')).toBe(true)
    const toggle = screen.getByRole('button', { name: 'Ver mais' })
    await user.click(toggle)
    expect(container.querySelector('.task-desc-markdown')?.classList.contains('is-collapsed')).toBe(false)
    expect(screen.getByRole('button', { name: 'Ver menos' })).toBeTruthy()
  })

  it('tarefa em revisão com missão concluída oferece acesso direto ao histórico na Observabilidade', async () => {
    const server = fakeServer()
    const user = userEvent.setup()
    const onOpenObservability = vi.fn()
    render(
      <TaskPanel
        tasks={[task({ id: 7, status: 'review' })]}
        missions={[mission({ id: 12, taskId: 7, phase: 'done' })]}
        agents={TEAM as AgentInfo[]}
        configs={[]}
        activeProjectId={1}
        online
        send={server.send}
        subscribe={server.subscribe}
        onClose={() => {}}
        onOpenObservability={onOpenObservability}
      />,
    )
    expect(screen.getByText('Em revisão')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Histórico da Missão #12' }))
    expect(onOpenObservability).toHaveBeenCalledWith(12)
  })

  it('MemoryCenter converte timestamp UTC para horário local do usuário', () => {
    const server = fakeServer()
    const iso = '2026-11-14T02:17:00.000Z'
    const expected = new Date(iso).toLocaleString([], {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    render(
      <MemoryCenter
        projectId={1}
        agents={TEAM as AgentInfo[]}
        online
        send={server.send}
        subscribe={server.subscribe}
        onClose={() => {}}
      />,
    )
    server.emit({
      type: 'memory-entries',
      projectId: 1,
      entries: [
        {
          id: 1,
          projectId: 1,
          scope: 'team',
          category: 'decision',
          content: 'Usar UTC no banco e exibir local.',
          status: 'approved',
          author: 'user',
          agentId: null,
          sourceMissionId: null,
          approvedBy: null,
          supersedesId: null,
          createdAt: iso,
          updatedAt: iso,
        },
      ],
    })
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('Markdown renderiza --- como hr, ### com recuo como título e preserva numeração de listas', () => {
    const md = [
      'Intro',
      '---',
      '  ### Seção',
      '1. Analise',
      '- detalhe',
      '2. Inspecione',
      '',
      '3. Proponha',
    ].join('\n')
    const { container } = render(<Markdown text={md} />)
    expect(container.querySelector('hr')).toBeTruthy()
    const heading = screen.getByRole('heading', { name: 'Seção' })
    expect(heading.textContent).toBe('Seção')
    const ols = container.querySelectorAll('ol')
    expect(ols.length).toBe(2)
    expect(ols[1].getAttribute('start')).toBe('2')
    expect(ols[1].querySelectorAll('li').length).toBe(2)
  })

  it('TaskPanel mostra indicação inline quando tarefa está Em revisão com missão concluída', () => {
    const server = fakeServer()
    const reviewTask = task({ id: 5, status: 'review', title: 'Revisar entrega' })
    const closedMission = mission({ id: 9, taskId: 5, phase: 'done' })
    render(
      <TaskPanel
        tasks={[reviewTask]}
        missions={[closedMission]}
        agents={TEAM as AgentInfo[]}
        configs={[]}
        activeProjectId={1}
        online
        send={server.send}
        subscribe={server.subscribe}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('Missão #9 concluída · aguardando revisão humana')).toBeTruthy()
  })

  it('Markdown converte título após prefixo de agente sem transformar # inline arbitrário', () => {
    const md = '[Tech Lead (sugestão na conversa)]: ### 1. Análise\nVeja item #3 e C# normalmente.'
    render(<Markdown text={md} />)
    expect(screen.getByText('[Tech Lead (sugestão na conversa)]:')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '1. Análise' }).textContent).toBe('1. Análise')
    expect(screen.getByText('Veja item #3 e C# normalmente.')).toBeTruthy()
  })

  it('TaskPanel posiciona ações antes da descrição quando tarefa longa está expandida', async () => {
    const server = fakeServer()
    const user = userEvent.setup()
    const longDesc = 'Linha longa de descrição.\n'.repeat(20)
    const longTask = task({ id: 7, title: 'Missão longa', description: longDesc })
    const { container } = render(
      <TaskPanel
        tasks={[longTask]}
        missions={[]}
        agents={TEAM as AgentInfo[]}
        configs={[]}
        activeProjectId={1}
        online
        send={server.send}
        subscribe={server.subscribe}
        onClose={() => {}}
      />,
    )
    const item = container.querySelector('.task-item')!
    const childrenBefore = Array.from(item.children).map((el) => el.className)
    expect(childrenBefore.indexOf('task-desc task-desc-markdown is-collapsed')).toBeLessThan(
      childrenBefore.indexOf('task-footer'),
    )
    await user.click(screen.getByRole('button', { name: 'Ver mais' }))
    const childrenAfter = Array.from(item.children).map((el) => el.className)
    expect(childrenAfter.indexOf('task-footer')).toBeLessThan(
      childrenAfter.indexOf('task-desc task-desc-markdown '),
    )
  })
})
