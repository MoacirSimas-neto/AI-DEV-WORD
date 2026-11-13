import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TerminalDock } from './TerminalDock.tsx'

describe('TerminalDock (Etapa 14.6)', () => {
  it('abre e recolhe com botão e Ctrl+J, e pede pasta quando não há projeto ativo', () => {
    const onOpenFolderDialog = vi.fn()
    render(
      <TerminalDock
        activeProjectPath={null}
        online={true}
        send={vi.fn()}
        subscribe={() => () => {}}
        onOpenFolderDialog={onOpenFolderDialog}
      />
    )

    expect(screen.getByText('Meu Terminal')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Terminal (Ctrl+J)' }))
    expect(screen.getByRole('button', { name: 'Recolher Terminal (Ctrl+J)' })).toBeTruthy()
    expect(screen.getByText('Selecionar pasta...')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Selecionar pasta...' }))
    expect(onOpenFolderDialog).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    expect(screen.getByRole('button', { name: 'Abrir Terminal (Ctrl+J)' })).toBeTruthy()
  })

  it('cria e fecha nova aba pessoal enviando terminal-close', () => {
    const send = vi.fn()
    render(
      <TerminalDock
        activeProjectPath={null}
        online={true}
        send={send}
        subscribe={() => () => {}}
        onOpenFolderDialog={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Nova aba de terminal' }))
    expect(screen.getByText('Terminal 2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Fechar Terminal 2' }))
    expect(send).toHaveBeenCalledWith({ type: 'term-close', agentId: 'user:2' })
    expect(screen.queryByText('Terminal 2')).toBeNull()
  })
})
