import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentInfo } from '../../../shared/protocol.ts'
import { CloseConfirmModal } from './CloseConfirmModal.tsx'
import { TerminalDock } from './TerminalDock.tsx'

// O xterm precisa de canvas real; aqui só interessa quando o terminal é montado e com que props.
vi.mock('./TerminalView.tsx', () => ({
  TerminalView: (p: { agentId: string; sessionActive: boolean; autoStart?: boolean; canStart: boolean }) => (
    <div data-testid={`term-${p.agentId}`} data-live={String(p.sessionActive)} data-auto={String(!!p.autoStart)} data-can={String(p.canStart)} />
  ),
}))

const dock = (props: Partial<ComponentProps<typeof TerminalDock>> = {}) => {
  const send = vi.fn()
  const view = render(
    <TerminalDock
      activeProjectPath="C:\\projetos\\demo"
      online={true}
      shellIds={[]}
      agents={[]}
      send={send}
      subscribe={() => () => {}}
      onOpenFolderDialog={vi.fn()}
      {...props}
    />,
  )
  return { send, ...view }
}
const agent = (id: string, name: string, session: boolean) => ({ id, name, cli: 'codex', session }) as unknown as AgentInfo

describe('TerminalDock (Etapa 14.6)', () => {
  it('não inicia terminal ao abrir o aplicativo: só monta depois que o usuário abre o dock', () => {
    dock()
    expect(screen.getByText('Meu Terminal')).toBeTruthy()
    expect(screen.queryByTestId('term-user:1')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir Terminal (Ctrl+J)' }))
    const term = screen.getByTestId('term-user:1')
    expect(term.dataset.auto).toBe('true')
    expect(term.dataset.can).toBe('true')
  })

  it('recolher e restaurar (botão e Ctrl+J) mantém o terminal montado: a sessão não é recriada', () => {
    dock()
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    const term = screen.getByTestId('term-user:1')

    fireEvent.click(screen.getByRole('button', { name: 'Recolher Terminal (Ctrl+J)' }))
    expect(screen.getByRole('button', { name: 'Abrir Terminal (Ctrl+J)' })).toBeTruthy()
    expect(screen.getByTestId('term-user:1')).toBe(term)

    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    expect(screen.getByTestId('term-user:1')).toBe(term)
  })

  it('Ctrl+J não atrapalha a digitação em campos do app, e não age com o dock oculto', () => {
    const { rerender } = dock()
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'j', ctrlKey: true })
    expect(screen.getByRole('button', { name: 'Abrir Terminal (Ctrl+J)' })).toBeTruthy()
    input.remove()

    rerender(
      <TerminalDock activeProjectPath="C:\\p" online shellIds={[]} agents={[]} hidden send={vi.fn()} subscribe={() => () => {}} onOpenFolderDialog={vi.fn()} />,
    )
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    expect(screen.queryByTestId('term-user:1')).toBeNull()
  })

  it('sem projeto: pede a pasta em vez de abrir um shell', () => {
    const onOpenFolderDialog = vi.fn()
    dock({ activeProjectPath: null, onOpenFolderDialog })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Terminal (Ctrl+J)' }))
    expect(screen.queryByTestId('term-user:1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar pasta...' }))
    expect(onOpenFolderDialog).toHaveBeenCalledTimes(1)
  })

  it('múltiplas abas: cria, alterna e encerra enviando term-close só da aba fechada', () => {
    const { send } = dock()
    fireEvent.click(screen.getByRole('button', { name: 'Nova aba de terminal' }))
    expect(screen.getByRole('tab', { name: 'Terminal 2' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('term-user:2')).toBeTruthy()
    expect(screen.queryByTestId('term-user:1')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Meu Terminal' }))
    expect(screen.getByTestId('term-user:1')).toBeTruthy()
    expect(screen.getByTestId('term-user:2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Fechar Terminal 2' }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'term-close', agentId: 'user:2' })
    expect(screen.queryByText('Terminal 2')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Meu Terminal' }).getAttribute('aria-selected')).toBe('true')
  })

  it('sessões vivas no backend viram abas (recarga) e reconectam sem criar outra', () => {
    dock({ shellIds: ['user:1', 'user:3'] })
    fireEvent.click(screen.getByRole('tab', { name: 'Terminal 3' }))
    expect(screen.getByTestId('term-user:3').dataset.live).toBe('true')
  })

  it('aba de agente só existe com sessão real e nunca pode iniciar processo pelo dock', () => {
    dock({ agents: [agent('dev', 'Developer', true), agent('qa', 'QA', false)] })
    expect(screen.queryByRole('tab', { name: 'QA' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Developer' }))
    const term = screen.getByTestId('term-dev')
    expect(term.dataset.live).toBe('true')
    expect(term.dataset.auto).toBe('false')
    expect(term.dataset.can).toBe('false')
  })
})

describe('TerminalDock: fechar abas pessoais', () => {
  const closes = (send: ReturnType<typeof vi.fn>) => send.mock.calls.map(([m]) => m).filter((m) => m.type === 'term-close')
  const props = (shellIds: string[], send = vi.fn()) => ({
    activeProjectPath: 'C:\\p',
    online: true,
    shellIds,
    agents: [] as AgentInfo[],
    send,
    subscribe: () => () => {},
    onOpenFolderDialog: vi.fn(),
  })

  it('a primeira aba (e única) fecha: fica o estado vazio e nenhuma sessão nasce sozinha, nem com Ctrl+J', () => {
    const { send } = dock()
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Fechar Meu Terminal' }))
    expect(closes(send)).toEqual([{ type: 'term-close', agentId: 'user:1' }])
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByTestId('term-user:1')).toBeNull()
    expect(screen.getByText('Nenhum terminal aberto.')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    expect(screen.queryByTestId('term-user:1')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Novo terminal' }))
    expect(screen.getByTestId('term-user:1').dataset.auto).toBe('true')
  })

  it('sessão viva pede confirmação: cancelar mantém, confirmar encerra só aquela aba', () => {
    const send = vi.fn()
    const view = render(<TerminalDock {...props(['user:1', 'user:2', 'user:3'], send)} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Terminal 2' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Terminal 3' }))

    fireEvent.click(screen.getByRole('button', { name: 'Fechar Terminal 2' }))
    expect(closes(send)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(closes(send)).toEqual([])
    expect(screen.getByTestId('term-user:2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Fechar Terminal 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar terminal' }))
    expect(closes(send)).toEqual([{ type: 'term-close', agentId: 'user:2' }])
    expect(screen.getByTestId('term-user:3')).toBeTruthy()

    // O backend confirma o fim: a aba some, as vizinhas ficam.
    view.rerender(<TerminalDock {...props(['user:1', 'user:3'], send)} />)
    expect(screen.queryByRole('tab', { name: 'Terminal 2' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Meu Terminal' })).toBeTruthy()
    expect(screen.getByTestId('term-user:3')).toBeTruthy()
  })

  it('fechar a primeira e a última entre várias: a seleção vai para uma aba que sobrou', () => {
    const send = vi.fn()
    const view = render(<TerminalDock {...props(['user:1', 'user:2', 'user:3'], send)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar Meu Terminal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar terminal' }))
    view.rerender(<TerminalDock {...props(['user:2', 'user:3'], send)} />)
    expect(screen.queryByRole('tab', { name: 'Meu Terminal' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Terminal 2' }).getAttribute('aria-selected')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Fechar Terminal 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar terminal' }))
    view.rerender(<TerminalDock {...props(['user:2'], send)} />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Terminal 2'])
    expect(closes(send).map((m) => m.agentId)).toEqual(['user:1', 'user:3'])
  })

  it('reconexão não ressuscita aba encerrada', () => {
    const send = vi.fn()
    const view = render(<TerminalDock {...props(['user:1'], send)} />)
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Fechar Meu Terminal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar terminal' }))
    view.rerender(<TerminalDock {...props([], send)} />)
    view.rerender(<TerminalDock {...props([], send)} online={false} />)
    view.rerender(<TerminalDock {...props([], send)} />)
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByTestId('term-user:1')).toBeNull()
    expect(send.mock.calls.some(([m]) => m.type === 'term-open')).toBe(false)
  })

  it('aba de agente não tem botão de fechar e segue lá depois de fechar todos os pessoais', () => {
    const { send } = dock({ agents: [agent('dev', 'Developer', true)] })
    expect(screen.queryByRole('button', { name: /Fechar Developer/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar Meu Terminal' }))
    expect(screen.getByRole('tab', { name: 'Developer' })).toBeTruthy()
    expect(closes(send)).toEqual([{ type: 'term-close', agentId: 'user:1' }])
  })
})

describe('CloseConfirmModal com terminais abertos (Etapa 14.6)', () => {
  it('avisa do terminal ativo, exige confirmação para encerrar e permite cancelar', () => {
    const onQuit = vi.fn()
    const onCancel = vi.fn()
    render(<CloseConfirmModal open activeMissionsCount={0} activeTerminalsCount={2} onMinimize={vi.fn()} onQuit={onQuit} onCancel={onCancel} />)
    expect(screen.getByText(/2 terminal\(is\) aberto\(s\)/)).toBeTruthy()

    fireEvent.click(screen.getByText('Encerrar completamente'))
    expect(onQuit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Cancelar'))
    expect(onCancel).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Encerrar completamente'))
    fireEvent.click(screen.getByText('Confirmar encerramento completo'))
    expect(onQuit).toHaveBeenCalledTimes(1)
  })
})
