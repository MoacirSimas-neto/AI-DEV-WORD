import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitStatus, ServerMessage } from '../../../shared/protocol.ts'
import { GitPanel } from './GitPanel.tsx'

afterEach(() => cleanup())

function makeStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    isRepo: true,
    branch: 'main',
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    remoteState: 'none',
    remoteName: null,
    remoteUrl: null,
    lastCommit: 'abc1234 initial',
    truncated: false,
    ...overrides,
  }
}

describe('Etapa 12.4.2 — GitPanel & DiffViewer', () => {
  it('exibe repositório limpo e desabilita commit sem arquivos staged', () => {
    const send = vi.fn()
    const subscribe = () => () => {}
    render(<GitPanel status={makeStatus()} projectName="demo" send={send} subscribe={subscribe} />)

    expect(screen.getByText('Limpo')).toBeTruthy()
    expect(screen.getByText(/main/)).toBeTruthy()
    const commitBtn = screen.getByRole('button', { name: /Commit \(0 staged\)/i }) as HTMLButtonElement
    expect(commitBtn.disabled).toBe(true)
  })

  it('separa Staged Changes de Changes, permite stage/unstage e renderiza DiffViewer', () => {
    const send = vi.fn()
    let listener: ((msg: ServerMessage) => void) | null = null
    const subscribe = (cb: (msg: ServerMessage) => void) => {
      listener = cb
      return () => {
        listener = null
      }
    }

    const status = makeStatus({
      files: [
        { path: 'src/a.ts', code: 'M ', staged: true, unstaged: false },
        { path: 'src/b.ts', code: ' M', staged: false, unstaged: true },
      ],
    })

    render(<GitPanel status={status} projectName="demo" send={send} subscribe={subscribe} />)

    expect(screen.getByText('Staged Changes (1)')).toBeTruthy()
    expect(screen.getByText('Changes (1)')).toBeTruthy()

    // Stage individual
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar src/b.ts ao stage' }))
    expect(send).toHaveBeenCalledWith({ type: 'git-stage', paths: ['src/b.ts'] })

    // Unstage individual
    fireEvent.click(screen.getByRole('button', { name: 'Remover src/a.ts do stage' }))
    expect(send).toHaveBeenCalledWith({ type: 'git-unstage', paths: ['src/a.ts'] })

    // Selecionar arquivo e receber diff
    fireEvent.click(screen.getByText('src/b.ts'))
    expect(send).toHaveBeenCalledWith({ type: 'git-diff', path: 'src/b.ts', staged: false })

    listener!({
      type: 'git-diff',
      path: 'src/b.ts',
      staged: false,
      text: '@@ -1,1 +1,2 @@\n const a = 1\n+const b = 2\n',
    })

    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('Unstaged')).toBeTruthy()

    // Commit com mensagem
    const input = screen.getByLabelText('Mensagem do commit')
    fireEvent.change(input, { target: { value: 'feat: add b' } })
    const commitBtn = screen.getByRole('button', { name: /Commit \(1 staged\)/i }) as HTMLButtonElement
    expect(commitBtn.disabled).toBe(false)
    fireEvent.click(commitBtn)
    expect(send).toHaveBeenCalledWith({ type: 'git-commit', message: 'feat: add b' })
  })

  it('consulta histórico e branches na aba secundária', () => {
    const send = vi.fn()
    const subscribe = () => () => {}
    render(<GitPanel status={makeStatus()} projectName="demo" send={send} subscribe={subscribe} />)

    fireEvent.click(screen.getByRole('tab', { name: /Histórico & Branches/i }))
    expect(send).toHaveBeenCalledWith({ type: 'git-log', limit: 30 })
    expect(send).toHaveBeenCalledWith({ type: 'git-branches' })
  })
})
