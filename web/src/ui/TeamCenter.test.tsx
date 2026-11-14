import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamCenter } from './TeamCenter.tsx'

afterEach(cleanup)

describe('TeamCenter (Central Unificada da Equipe)', () => {
  it('navega entre Agentes, Skills e Memória e exibe + Adicionar Skill', () => {
    const send = vi.fn()
    render(
      <TeamCenter
        loadStatus="ready"
        agents={[]}
        configs={[]}
        specializations={[]}
        skills={[]}
        skillOverrides={[]}
        projectId={1}
        projectName="Projeto Teste"
        online={true}
        send={send}
        subscribe={() => () => {}}
        onClose={() => {}}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Central da Equipe' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Agentes' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Skills' }))
    const addSkillBtn = screen.getByRole('button', { name: '+ Adicionar Skill' })
    expect(addSkillBtn).toBeTruthy()
    fireEvent.click(addSkillBtn)
    expect(screen.getByRole('button', { name: 'Salvar skill' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Memória' }))
    expect(screen.getByRole('button', { name: 'Memória' }).getAttribute('aria-pressed')).toBe('true')
  })
})
