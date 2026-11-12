import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { agent, fakeServer, task } from '../test/fakeServer.ts'
import { StudioTopBar } from './StudioTopBar.tsx'
import { TaskPanel } from './TaskPanel.tsx'
import { ChatView } from './chat/ChatView.tsx'

describe('Etapa 12.4.1 — Simplificação UX e navegação responsiva', () => {
  it('TaskPanel destaca Conversar com Tech Lead e recolhe formulário manual e configurações avançadas', async () => {
    const server = fakeServer()
    const user = userEvent.setup()
    const onOpenChatNew = vi.fn()

    render(
      <TaskPanel
        tasks={[task()]}
        missions={[]}
        agents={[agent('architect'), agent('dev'), agent('qa')]}
        configs={[]}
        activeProjectId={1}
        online
        send={server.send}
        subscribe={server.subscribe}
        onClose={vi.fn()}
        onOpenChatNew={onOpenChatNew}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Conversar com Tech Lead/ }))
    expect(onOpenChatNew).toHaveBeenCalledTimes(1)

    // Formulário manual começa oculto e abre ao clicar em + Nova tarefa manual
    expect(screen.queryByPlaceholderText('Título da tarefa')).toBeNull()
    await user.click(screen.getByRole('button', { name: '+ Nova tarefa manual' }))
    expect(screen.getByPlaceholderText('Título da tarefa')).toBeTruthy()
  })

  it('StudioTopBar abre menu compacto de navegação secundária', async () => {
    const server = fakeServer()
    const user = userEvent.setup()
    const onSelectTab = vi.fn()

    render(
      <StudioTopBar
        workspace={{ projects: [{ id: 1, name: 'proj', path: '/tmp/proj' }], activeProjectId: 1 }}
        activeProject={{ id: 1, name: 'proj', path: '/tmp/proj' }}
        gitStatus={null}
        activeTab="chat"
        onSelectTab={onSelectTab}
        tasksCount={1}
        activeMissionsCount={0}
        missions={[]}
        tasks={[]}
        agents={[]}
        onSelectAgent={vi.fn()}
        sidePanelOpen={false}
        sideTab="agent"
        onToggleSidePanel={vi.fn()}
        send={server.send}
        subscribe={server.subscribe}
        online
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Mais opções de navegação' }))
    const menu = screen.getByRole('menu', { name: 'Navegação secundária' })
    await user.click(within(menu).getByRole('menuitem', { name: /Observabilidade/ }))
    expect(onSelectTab).toHaveBeenCalledWith('observability')
  })

  it('ChatView oferece botão para alternar lista de conversas em telas estreitas', async () => {
    const server = fakeServer()
    const user = userEvent.setup()
    render(
      <ChatView
        projectId={1}
        projectName="proj"
        agents={[agent('architect')]}
        configs={[]}
        online
        send={server.send}
        subscribe={server.subscribe}
        onOpenTasks={vi.fn()}
      />,
    )

    const toggle = screen.getByRole('button', { name: 'Alternar lista de conversas' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })
})
