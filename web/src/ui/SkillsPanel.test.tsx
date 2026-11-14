import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { SkillsPanel } from './SkillsPanel.tsx'

test('importa texto desativado e não apaga o rascunho ao rejeitar outro arquivo', async () => {
  const send = vi.fn()
  render(<SkillsPanel skills={[]} overrides={[]} agents={[]} online send={send} />)
  fireEvent.click(screen.getByRole('button', { name: '+ Adicionar Skill' }))
  fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'local-test' } })
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Skill de teste' } })
  const input = screen.getByLabelText('Importar Markdown')
  fireEvent.change(input, { target: { files: [{ name: 'sample.md', size: 12, text: async () => '# Instruções' }] } })
  await waitFor(() => expect((screen.getByLabelText('Instruções') as HTMLTextAreaElement).value).toBe('# Instruções'))
  expect(send).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { files: [{ name: 'sample.exe', size: 12 }] } })
  expect(screen.getByRole('alert').textContent).toContain('Selecione um arquivo')
  fireEvent.click(screen.getByRole('button', { name: 'Salvar skill' }))
  expect(send).toHaveBeenCalledWith({
    type: 'skill-save', createOnly: true,
    skill: { id: 'local-test', name: 'Skill de teste', description: '', origin: 'Arquivo local: sample.md', content: '# Instruções', enabled: false },
  })
})
