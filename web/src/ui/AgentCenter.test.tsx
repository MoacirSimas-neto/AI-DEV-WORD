import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { AgentCenter } from './AgentCenter.tsx'

vi.mock('./AgentPortrait.tsx', () => ({ AgentPortrait: () => null }))

test('Central distingue conexão, carregamento, reconexão, erro e lista vazia confirmada', () => {
  const props = { agents: [], configs: [], online: true, send: vi.fn(), onClose: vi.fn() }
  const { rerender } = render(<AgentCenter {...props} loadStatus="connecting" />)
  for (const [state, label] of [
    ['connecting', 'Conectando ao backend…'],
    ['loading', 'Carregando agentes…'],
    ['reconnecting', 'Recuperando conexão…'],
    ['error', 'Erro ao carregar agentes. Verifique a conexão ou o pareamento local.'],
  ] as const) {
    rerender(<AgentCenter {...props} loadStatus={state} />)
    expect(screen.getByText(label)).toBeTruthy()
    expect(screen.queryByText('Todas (0)')).toBeNull()
  }
  rerender(<AgentCenter {...props} loadStatus="ready" />)
  expect(screen.getByText('Nenhum agente cadastrado.')).toBeTruthy()
  expect(screen.getByText('Todas (0)')).toBeTruthy()
})
