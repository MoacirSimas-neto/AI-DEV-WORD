import type { TaskInfo } from '../../../shared/protocol.ts'

// Os prompts vão pela entrada padrão do CLI. Ficam aqui, separados do fluxo,
// para ser fácil ler e ajustar o que cada agente recebe.

const PRIORITY: Record<TaskInfo['priority'], string> = { low: 'baixa', medium: 'média', high: 'alta' }

function taskBlock(task: TaskInfo) {
  return [
    `Tarefa: ${task.title}`,
    `Prioridade: ${PRIORITY[task.priority]}`,
    'Descrição:',
    task.description || '(sem descrição)',
  ].join('\n')
}

export function planPrompt(task: TaskInfo) {
  return `Você é o Arquiteto de uma equipe de agentes de software.
Analise o projeto no diretório atual e escreva um plano de implementação para a tarefa abaixo.
Nesta etapa você só lê e planeja: não altere nenhum arquivo e não execute comandos.

${taskBlock(task)}

Responda em português do Brasil, em Markdown, com estas seções:
1. Entendimento da tarefa.
2. Arquivos que devem ser criados ou alterados.
3. Passos de implementação, numerados.
4. Como testar.
5. Riscos e pontos que exigem confirmação humana.
Nunca inclua tokens, senhas ou outras credenciais na resposta.
`
}

export function devPrompt(task: TaskInfo, plan: string) {
  return `Você é o Desenvolvedor de uma equipe de agentes de software.
Implemente neste repositório (o diretório atual) o plano aprovado pelo usuário, descrito abaixo.

Regras:
- Altere apenas arquivos dentro deste diretório.
- Não faça commit, push, reset, rebase nem apague histórico do Git. O usuário revisa e faz o commit.
- Não leia, copie nem exiba credenciais, tokens ou arquivos .env.
- Se o projeto tiver testes, rode-os e informe o resultado real.

${taskBlock(task)}

Plano aprovado:
${plan}

Ao terminar, responda em português do Brasil com: o que foi feito, arquivos alterados,
comandos de teste executados com os resultados, e o que ficou pendente.
`
}

export function reviewPrompt(task: TaskInfo, plan: string, devReport: string, files: string[], diff: string) {
  return `Você é o QA de uma equipe de agentes de software.
Revise o trabalho que o Desenvolvedor acabou de fazer neste repositório (o diretório atual).
Nesta etapa você só lê: não altere nenhum arquivo.

${taskBlock(task)}

Plano aprovado:
${plan}

Relatório do Desenvolvedor:
${devReport}

Arquivos alterados: ${files.length ? files.join(', ') : '(nenhum)'}

Diferenças (podem estar cortadas):
\`\`\`diff
${diff || '(sem diferenças de texto)'}
\`\`\`

Avalie, em português do Brasil e em Markdown:
1. Qualidade do código.
2. Requisitos da tarefa atendidos ou não.
3. Possíveis bugs.
4. Resultados dos testes relatados (e se faltam testes).
5. Problemas de segurança.

Termine com uma linha exatamente em um destes formatos:
VEREDITO: APROVADO
VEREDITO: REPROVADO
`
}

/** Lê a última linha de veredito do QA. */
export function parseVerdict(review: string): 'approved' | 'changes' | null {
  const matches = [...review.matchAll(/VEREDITO:\s*\**\s*(APROVADO|REPROVADO)/gi)]
  const last = matches.at(-1)?.[1]?.toUpperCase()
  return last === 'APROVADO' ? 'approved' : last === 'REPROVADO' ? 'changes' : null
}
