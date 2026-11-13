import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstRunWizard } from './FirstRunWizard.tsx'
import { loadFirstRunState, saveFirstRunState } from './firstRunState.ts'

describe('FirstRunWizard (Etapa 14.4.3.2)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exibe catálogo, abre confirmação explícita, permite cancelar/instalar e conclui onboarding', async () => {
    const onFetchDiagnostics = vi.fn(async () =>
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

    const onFetchSetupCatalog = vi.fn(async () =>
      new Response(
        JSON.stringify({
          tools: [
            {
              id: 'codex',
              name: 'Codex CLI',
              vendor: 'OpenAI',
              originUrl: 'https://developers.openai.com/codex/cli',
              installMethod: 'npm',
              packageRef: '@openai/codex',
              requiresInternet: true,
              requiresAdmin: false,
              requiresGlobalNode: true,
              systemChanges: 'Instala @openai/codex via npm.',
              accountNote: 'Requer conta OpenAI.',
              authHint: 'Execute codex no terminal.',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )

    const onRequestConsent = vi.fn(async () =>
      new Response(JSON.stringify({ nonce: 'nonce-123' }), { status: 200 })
    )
    const onInstallTool = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'completed', message: 'Codex CLI instalado e verificado.' }), {
        status: 200,
      })
    )

    const onComplete = vi.fn()
    render(
      <FirstRunWizard
        open={true}
        onFetchDiagnostics={onFetchDiagnostics}
        onFetchSetupCatalog={onFetchSetupCatalog}
        onRequestConsent={onRequestConsent}
        onInstallTool={onInstallTool}
        projects={[{ id: 1, name: 'meu-app', path: 'C:\\proj\\meu-app' }]}
        activeProjectId={1}
        onSelectProject={vi.fn()}
        onOpenFolderDialog={vi.fn()}
        onComplete={onComplete}
        onDismiss={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Verificar ambiente' }))

    await waitFor(() => {
      expect(screen.getByText('Codex CLI')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Instalar...' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Instalar...' }))
    expect(screen.getByText('Confirmar instalação: Codex CLI')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar instalação' }))

    await waitFor(() => {
      expect(onRequestConsent).toHaveBeenCalledWith('codex')
      expect(onInstallTool).toHaveBeenCalledWith('codex', 'nonce-123')
      expect(screen.getByText('Codex CLI instalado e verificado.')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Entrar no escritório' }))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('mostra erro amigável quando /api/diagnostics falha e persiste lastStep', async () => {
    const onFetchDiagnostics = vi.fn(async () => new Response('', { status: 500 }))
    const onFetchSetupCatalog = vi.fn(async () => new Response('', { status: 500 }))
    saveFirstRunState({ completed: false, lastStep: 1 })
    expect(loadFirstRunState().lastStep).toBe(1)

    render(
      <FirstRunWizard
        open={true}
        initialStep={1}
        onFetchDiagnostics={onFetchDiagnostics}
        onFetchSetupCatalog={onFetchSetupCatalog}
        onRequestConsent={vi.fn()}
        onInstallTool={vi.fn()}
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
