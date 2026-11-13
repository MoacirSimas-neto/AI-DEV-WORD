import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstRunWizard, loadFirstRunState, saveFirstRunState } from './FirstRunWizard.tsx'

describe('FirstRunWizard (Etapa 14.4.2)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('percorre boas-vindas, diagnóstico de ferramentas e conclui onboarding', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          tools: [
            {
              id: 'git',
              name: 'Git',
              purpose: 'Controle de versão',
              relevance: 'essential',
              status: 'ready',
              executablePath: 'C:\\Git\\git.exe',
              version: 'git version 2.47.0',
              authNote: 'Pronto para uso.',
            },
            {
              id: 'codex',
              name: 'Codex CLI',
              purpose: 'Agente de código',
              relevance: 'optional',
              status: 'not_installed',
              executablePath: null,
              version: null,
              authNote: 'Instale a CLI para configurar depois.',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )

    const onComplete = vi.fn()
    render(
      <FirstRunWizard
        open={true}
        authToken="tok-test"
        projects={[{ id: 1, name: 'meu-app', path: 'C:\\proj\\meu-app' }]}
        activeProjectId={1}
        onSelectProject={vi.fn()}
        onOpenFolderDialog={vi.fn()}
        onComplete={onComplete}
        onDismiss={vi.fn()}
      />
    )

    expect(screen.getByText('Bem-vindo ao AI Dev World')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Verificar ambiente' }))

    await waitFor(() => {
      expect(screen.getByText('Git')).toBeTruthy()
      expect(screen.getByText('Pronto')).toBeTruthy()
      expect(screen.getByText('Não instalado')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(screen.getByText('Configuração Inicial')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Entrar no escritório' }))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('mostra erro amigável quando /api/diagnostics falha e persiste lastStep', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
    saveFirstRunState({ completed: false, lastStep: 1 })
    expect(loadFirstRunState().lastStep).toBe(1)

    render(
      <FirstRunWizard
        open={true}
        initialStep={1}
        authToken={null}
        projects={[]}
        activeProjectId={null}
        onSelectProject={vi.fn()}
        onOpenFolderDialog={vi.fn()}
        onComplete={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
  })
})
