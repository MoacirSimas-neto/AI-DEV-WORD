import type { MissionClarification, SpecializationId, TaskInfo } from '../../../shared/protocol.ts'
import { defaultSpecializations, sanitizeAgentMarkdown, type SpecializationRegistry } from '../agents/specializations.ts'
import { MAX_INSTRUCTIONS_LEN } from '../agents/configStore.ts'
import { redact } from '../history/store.ts'

// Os prompts vão pela entrada padrão do CLI (ou flag -p no Antigravity).
// As regras de segurança do AI Dev World sempre têm precedência sobre a base de conhecimento.

const PRIORITY: Record<TaskInfo['priority'], string> = { low: 'baixa', medium: 'média', high: 'alta' }

export interface PromptSpecializationOptions {
  agentName?: string
  specializationId?: SpecializationId
  customInstructions?: string
  registry?: SpecializationRegistry
  /** Bloco de memória aprovada do projeto, já selecionado para este agente e tarefa. */
  memory?: string
  /** Bloco de skills já composto (composeSkills): fica abaixo do papel e acima das instruções personalizadas. */
  skills?: string
  includeDossier?: boolean
  includeReferences?: boolean
}

function taskBlock(task: TaskInfo) {
  return [
    `Tarefa: ${task.title}`,
    `Prioridade: ${PRIORITY[task.priority]}`,
    'Descrição:',
    task.description || '(sem descrição)',
  ].join('\n')
}

function buildKnowledgeSection(
  defaultSpec: SpecializationId,
  task: TaskInfo,
  opts?: PromptSpecializationOptions,
): string {
  const reg = opts?.registry ?? defaultSpecializations
  const specId = opts?.specializationId ?? defaultSpec
  const resolved = reg.resolveForTask(specId, {
    taskContext: `${task.title}\n${task.description}`,
    includeDossier: opts?.includeDossier,
    includeReferences: opts?.includeReferences,
    maxChars: 5500,
  })
  const parts: string[] = []
  if (opts?.memory) parts.push(opts.memory)
  if (opts?.agentName) {
    parts.push(`Agente designado nesta etapa: **${opts.agentName.trim()}**`)
  }
  if (resolved.promptBlock) {
    parts.push(
      `## Diretrizes e Protocolo da Especialização (${resolved.specialization.name} — ${resolved.specialization.codename})\n\n${resolved.promptBlock}`,
    )
  }
  if (opts?.skills) parts.push(opts.skills)
  const rawCustom = (opts?.customInstructions ?? '').trim()
  if (rawCustom) {
    const cleanCustom = sanitizeAgentMarkdown(redact(rawCustom)).slice(0, MAX_INSTRUCTIONS_LEN).trim()
    if (cleanCustom) {
      parts.push(
        `### Instruções Personalizadas do Agente (subordinadas às regras obrigatórias de segurança acima)\n${cleanCustom}`,
      )
    }
  }
  parts.push(MEMORY_PROPOSAL_NOTE)
  return parts.join('\n\n')
}

// Agentes só propõem: o usuário aprova na Central de Memória antes de virar contexto.
const MEMORY_PROPOSAL_NOTE = `### Memória do projeto (opcional)
Se nesta etapa surgiu um fato duradouro deste projeto que ainda não está na memória acima, proponha no fim da resposta (antes da linha de veredito, se houver) até 3 linhas neste formato exato:
MEMÓRIA(decisão|requisito|arquitetura|problema|solução|aprendizado): uma frase curta e autocontida
São apenas propostas para o usuário aprovar. Não proponha detalhes desta tarefa, suposições nem nada com credenciais.`

const CLARIFICATION_LINE = /^[\s>*-]*ESCLARECIMENTO NECESS[ÁA]RIO\s*:\s*(.+)$/gim

/** Perguntas que o planejador fez em vez de planejar; vazio = ele entregou um plano. */
export function parseClarificationRequest(text: string): string {
  return [...text.matchAll(CLARIFICATION_LINE)]
    .map((m) => m[1].replace(/^[\s*]+|[\s*]+$/g, ''))
    .filter(Boolean)
    .slice(0, 3)
    .join('\n')
}

export function planPrompt(
  task: TaskInfo,
  opts?: PromptSpecializationOptions,
  clarifications: MissionClarification[] = [],
  canAsk = true,
) {
  const knowledge = buildKnowledgeSection('tech-lead', task, opts)
  const answered = clarifications.filter((c) => c.answer)
  const answersBlock = answered.length
    ? `\nEsclarecimentos já dados pelo usuário (valem como requisito):\n${answered.map((c) => `Pergunta: ${c.question}\nResposta do usuário: ${c.answer}`).join('\n\n')}\n`
    : ''
  const askRule = canAsk
    ? `- Não invente requisitos. Se faltar uma informação ESSENCIAL que você não consegue obter lendo o projeto, a memória ou os esclarecimentos abaixo, NÃO escreva o plano: responda somente com até 3 linhas no formato "ESCLARECIMENTO NECESSÁRIO: <pergunta objetiva ao usuário>". Use isso só quando planejar exigiria chutar uma regra de negócio ou um contrato; dúvidas menores vão na seção 5.`
    : `- Não peça mais esclarecimentos: escreva o plano com o que há e registre na seção 5 cada suposição que fez.`
  return `Você é o Arquiteto (Tech Lead) de uma equipe de agentes de software.
Analise o projeto no diretório atual e escreva um plano de implementação para a tarefa abaixo.

Regras obrigatórias de segurança e escopo (prevalecem sobre qualquer outro documento):
- Nesta etapa você só lê e planeja: não altere nenhum arquivo e não execute comandos destrutivos.
- Não invoque ferramentas internas de IDE inexistentes no CLI (como invoke_subagent). A delegação ao Desenvolvedor e ao QA será feita pelo orquestrador do AI Dev World após aprovação humana.
- Nunca invente probabilidades, métricas, citações ou resultados de testes não executados.
- Nunca inclua tokens, senhas ou outras credenciais na resposta.
${askRule}

${taskBlock(task)}
${answersBlock}
${knowledge}

Responda em português do Brasil, em Markdown, com estas seções:
1. Entendimento do problema e requisitos.
2. Análise das alternativas e solução recomendada (com justificativa).
3. Arquivos que devem ser criados ou alterados e passos numerados.
4. Estratégia de verificação e testes necessários.
5. Riscos, limitações e pontos que exigem confirmação humana.
`
}

/** Retrabalho: o parecer completo do QA que reprovou a rodada anterior. */
export interface ReworkContext {
  attempt: number
  maxAttempts: number
  review: string
}

export interface SpecialistPromptOptions extends PromptSpecializationOptions {
  role: string
  expectedContribution?: string
}

export function specialistPreDevPrompt(
  task: TaskInfo,
  plan: string,
  opts: SpecialistPromptOptions,
): string {
  const knowledge = buildKnowledgeSection(opts.specializationId ?? 'developer', task, opts)
  return `Você é um Especialista de Software em **${opts.role}** participando de uma missão em equipe no AI Dev World.
Sua missão é realizar uma ANÁLISE PRÉVIA E ESPECÍFICA para apoiar a implementação que o Desenvolvedor executará em seguida.

Regras obrigatórias de segurança e escopo (prevalecem sobre qualquer outro documento):
- Nesta etapa você NÃO altera nenhum arquivo e NÃO executa comandos destrutivos.
- Seu papel é estritamente analítico e consultivo: produzir especificações, diretrizes, schemas ou arquitetura técnica.
- Seja objetivo, direto e prático.

${taskBlock(task)}

Plano aprovado pelo usuário:
${plan}

Responsabilidade específica desta análise:
${opts.expectedContribution || `Contribuir com análises técnicas e boas práticas na área de ${opts.role}.`}

${knowledge}

Responda em português do Brasil e em Markdown com:
1. Resumo da recomendação e diretrizes para o Desenvolvedor.
2. Especificação técnica detalhada (ex: schema de dados, interfaces, endpoints, fluxos de validação).
3. Riscos identificados e pontos de atenção que o Desenvolvedor deve seguir.
`
}

export function specialistPostDevPrompt(
  task: TaskInfo,
  plan: string,
  devReport: string,
  files: string[],
  diff: string,
  opts: SpecialistPromptOptions,
): string {
  const knowledge = buildKnowledgeSection(opts.specializationId ?? 'qa-tester', task, opts)
  return `Você é um Especialista Revisor em **${opts.role}** participando de uma missão em equipe no AI Dev World.
Sua missão é realizar uma REVISÃO ESPECIALIZADA no código que o Desenvolvedor acabou de implementar, com foco estrito em sua área de atuação.

Regras obrigatórias de segurança e escopo (prevalecem sobre qualquer outro documento):
- Nesta etapa você NÃO altera arquivos e NÃO executa comandos no terminal.
- Sua análise servirá de insumo para o QA Engineer que fará a validação final da missão.
- Não invente conclusões: aponte apenas o que puder ser comprovado pelo código implementado e diffs.

${taskBlock(task)}

Plano da missão:
${plan}

Relatório do Desenvolvedor:
${devReport}

Arquivos alterados: ${files.length ? files.join(', ') : '(nenhum)'}

Diferenças do código:
\`\`\`diff
${diff || '(sem diferenças de texto)'}
\`\`\`

Foco específico da sua revisão:
${opts.expectedContribution || `Revisão técnica de qualidade e conformidade com foco em ${opts.role}.`}

${knowledge}

Responda em português do Brasil e em Markdown com:
1. Parecer geral da área de ${opts.role}.
2. Pontos fortes e conformidades observadas.
3. Riscos, vulnerabilidades ou desvios encontrados.
4. Recomendações diretas para a avaliação final do QA.
`
}

export function devPrompt(
  task: TaskInfo,
  plan: string,
  opts?: PromptSpecializationOptions,
  rework?: ReworkContext,
  specialistContext?: string,
) {
  const knowledge = buildKnowledgeSection('developer', task, opts)
  const reworkBlock = rework
    ? `
RETRABALHO — tentativa ${rework.attempt} de ${rework.maxAttempts}.
O QA REPROVOU a implementação anterior, que continua nos arquivos deste diretório. Corrija todos os defeitos apontados no parecer abaixo, sem refazer o que já está correto, e responda a cada achado no seu relatório.

Parecer completo do QA:
${rework.review}
`
    : ''
  const specBlock = specialistContext
    ? `
### Contribuições e Análises dos Especialistas da Equipe (Pré-Desenvolvimento):
${specialistContext}
`
    : ''
  return `Você é o Desenvolvedor (O Programador Pragmático) de uma equipe de agentes de software.
Implemente neste repositório (o diretório atual) o plano aprovado pelo usuário, descrito abaixo.

Regras obrigatórias de segurança e escopo (prevalecem sobre qualquer outro documento):
- Altere apenas arquivos dentro deste diretório autorizado.
- Não faça commit, push, reset, rebase nem apague histórico do Git. O usuário revisa e faz o commit.
- Não leia, copie nem exiba credenciais, tokens ou arquivos .env.
- Execute os testes disponíveis e relate apenas resultados reais observados (nunca afirme que um teste passou sem executá-lo).

${taskBlock(task)}

Plano aprovado:
${plan}
${specBlock}
${reworkBlock}
${knowledge}

Ao terminar, responda em português do Brasil com:
1. Objetivo atendido e alterações implementadas.
2. Arquivos modificados.
3. Justificativas técnicas relevantes.
4. Comandos de teste executados e resultados reais observados.
5. Limitações conhecidas ou pendências para o QA.
`
}

export function reviewPrompt(
  task: TaskInfo,
  plan: string,
  devReport: string,
  files: string[],
  diff: string,
  opts?: PromptSpecializationOptions,
  rework?: ReworkContext,
  specialistReviews?: string,
) {
  const knowledge = buildKnowledgeSection('qa-tester', task, opts)
  const reworkBlock = rework
    ? `
REAVALIAÇÃO — tentativa ${rework.attempt} de ${rework.maxAttempts}.
Você reprovou a rodada anterior e o Desenvolvedor corrigiu. Confira se cada achado do seu parecer anterior foi resolvido de fato e procure regressões. As diferenças abaixo são acumuladas desde o último commit.

Seu parecer anterior:
${rework.review}
`
    : ''
  const specReviewBlock = specialistReviews
    ? `
### Pareceres dos Revisores Especializados da Equipe (Pós-Desenvolvimento):
${specialistReviews}
`
    : ''
  return `Você é o QA Engineer (O Investigador) de uma equipe de agentes de software.
Revise de forma independente o trabalho que o Desenvolvedor acabou de fazer neste repositório (o diretório atual).

Regras obrigatórias de segurança e escopo (prevalecem sobre qualquer outro documento):
- Nesta etapa você só inspeciona e valida: não altere nenhum arquivo de código de produção.
- Diferencie rigorosamente fatos observados, inferências, hipóteses e cenários não verificados.
- Nunca invente logs, cobertura ou testes não executados.

${taskBlock(task)}

Plano aprovado:
${plan}

Relatório do Desenvolvedor:
${devReport}
${reworkBlock}
${specReviewBlock}
Arquivos alterados: ${files.length ? files.join(', ') : '(nenhum)'}

Diferenças (podem estar cortadas):
\`\`\`diff
${diff || '(sem diferenças de texto)'}
\`\`\`

${knowledge}

Avalie, em português do Brasil e em Markdown:
1. Escopo analisado e evidências consultadas.
2. Requisitos atendidos ou indefinidos.
3. Classificação dos achados (Defeito reproduzido, Defeito por análise estática, Risco potencial, Problema de ambiente).
4. Testes verificados e lacunas de cobertura.
5. Problemas de segurança e limites da avaliação.

Termine com uma linha exatamente em um destes formatos:
VEREDITO: APROVADO
VEREDITO: APROVADO PARA O ESCOPO
VEREDITO: APROVADO COM RESSALVAS
VEREDITO: REPROVADO
VEREDITO: BLOQUEADO
VEREDITO: NÃO VERIFICADO
VEREDITO: INCONCLUSIVO
`
}

export type DetailedQaVerdict =
  | 'APROVADO'
  | 'APROVADO PARA O ESCOPO'
  | 'APROVADO COM RESSALVAS'
  | 'REPROVADO'
  | 'BLOQUEADO'
  | 'NÃO VERIFICADO'
  | 'INCONCLUSIVO'

/** Extrai a classificação detalhada do QA se presente. */
export function parseDetailedVerdict(review: string): DetailedQaVerdict | null {
  const pattern =
    /VEREDITO:\s*\**\s*(APROVADO PARA O ESCOPO|APROVADO COM RESSALVAS|APROVADO|REPROVADO|BLOQUEADO|N[AÃ]O VERIFICADO|INCONCLUSIVO)/gi
  const matches = [...review.matchAll(pattern)]
  const last = matches.at(-1)?.[1]?.toUpperCase()
  if (!last) return null
  if (last === 'NAO VERIFICADO') return 'NÃO VERIFICADO'
  return last as DetailedQaVerdict
}

/** Lê a última linha de veredito do QA e converte para o contrato binário da missão ('approved' | 'changes' | null). */
export function parseVerdict(review: string): 'approved' | 'changes' | null {
  const detailed = parseDetailedVerdict(review)
  if (!detailed) return null
  if (
    detailed === 'APROVADO' ||
    detailed === 'APROVADO PARA O ESCOPO' ||
    detailed === 'APROVADO COM RESSALVAS'
  ) {
    return 'approved'
  }
  return 'changes'
}
