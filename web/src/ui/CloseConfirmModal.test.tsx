import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CloseConfirmModal } from './CloseConfirmModal.tsx'
import { loadCloseBehavior, saveCloseBehavior } from './closeBehavior.ts'

describe('CloseConfirmModal & closeBehavior', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('usa ask como padrão e ignora valores inválidos', () => {
    expect(loadCloseBehavior()).toBe('ask')
    saveCloseBehavior('minimize')
    expect(loadCloseBehavior()).toBe('minimize')
    localStorage.setItem('aidw.closeBehavior', 'invalid-value')
    expect(loadCloseBehavior()).toBe('ask')
  })

  it('permite cancelar, minimizar com preferência e encerrar sem missões ativas', () => {
    const onMinimize = vi.fn()
    const onQuit = vi.fn()
    const onCancel = vi.fn()

    render(
      <CloseConfirmModal
        open={true}
        activeMissionsCount={0}
        onMinimize={onMinimize}
        onQuit={onQuit}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByText('Cancelar'))
    expect(onCancel).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Minimizar para a bandeja'))
    expect(onMinimize).toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByText('Encerrar completamente'))
    expect(onQuit).toHaveBeenCalledWith(true)
  })

  it('exige segunda confirmação ao encerrar com missões ativas', () => {
    const onQuit = vi.fn()

    render(
      <CloseConfirmModal
        open={true}
        activeMissionsCount={2}
        onMinimize={vi.fn()}
        onQuit={onQuit}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText(/Há 2 missão\(ões\) ativa\(s\)/)).toBeTruthy()
    fireEvent.click(screen.getByText('Encerrar completamente'))
    expect(onQuit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Confirmar encerramento completo'))
    expect(onQuit).toHaveBeenCalledWith(false)
  })
})
