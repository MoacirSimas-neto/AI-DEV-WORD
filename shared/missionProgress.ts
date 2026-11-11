import type { MissionInfo, MissionPhase } from './protocol.ts'

export type StageStatus = 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled'

export interface MissionStageInfo {
  id: 'planning' | 'pre-dev-specialists' | 'developing' | 'post-dev-specialists' | 'reviewing' | 'delivery'
  label: string
  agentId: string | null
  agentRole: string
  status: StageStatus
  summary: string
}

export interface MissionProgressInfo {
  missionId: number
  phase: MissionPhase
  completedSteps: 0 | 1 | 2 | 3
  totalSteps: 3
  percent: 0 | 33 | 67 | 100
  isRunning: boolean
  needsApproval: boolean
  isInterrupted: boolean
  activeAgentId: string | null
  statusLabel: string
  stages: MissionStageInfo[]
}

const STEP_PERCENTS: Record<0 | 1 | 2 | 3, 0 | 33 | 67 | 100> = {
  0: 0,
  1: 33,
  2: 67,
  3: 100,
}

/**
 * Calcula o progresso real verificável de uma missão com base exclusivamente
 * nas etapas efetivamente concluídas (0/3 = 0%, 1/3 = 33%, 2/3 = 67%, 3/3 = 100%).
 * Nunca utiliza temporizadores ou estimativas fictícias de tempo.
 */
export function computeMissionProgress(mission: MissionInfo | null | undefined): MissionProgressInfo {
  if (!mission) {
    return {
      missionId: 0,
      phase: 'planning',
      completedSteps: 0,
      totalSteps: 3,
      percent: 0,
      isRunning: false,
      needsApproval: false,
      isInterrupted: false,
      activeAgentId: null,
      statusLabel: 'Nenhuma missão ativa',
      stages: [
        { id: 'planning', label: 'Planejamento', agentId: 'architect', agentRole: 'Arquiteto', status: 'pending', summary: 'Aguardando início.' },
        { id: 'developing', label: 'Desenvolvimento', agentId: 'dev', agentRole: 'Desenvolvedor', status: 'pending', summary: 'Aguardando aprovação.' },
        { id: 'reviewing', label: 'Revisão QA', agentId: 'qa', agentRole: 'QA Reviewer', status: 'pending', summary: 'Aguardando desenvolvimento.' },
        { id: 'delivery', label: 'Entrega', agentId: null, agentRole: 'Operador Humano', status: 'pending', summary: 'Aguardando conclusão.' },
      ],
    }
  }

  const { phase } = mission
  const plannerId = mission.plannerId || 'architect'
  const devId = mission.devId || 'dev'
  const qaId = mission.qaId || 'qa'
  const snap = mission.teamSnapshot ?? {}
  const plannerRole = snap[plannerId]?.name || 'Arquiteto'
  const devRole = snap[devId]?.name || 'Desenvolvedor'
  const qaRole = snap[qaId]?.name || 'QA Reviewer'

  const hasPlan = Boolean(mission.plan && mission.plan.trim().length > 0)
  const hasDev = Boolean(mission.devReport && mission.devReport.trim().length > 0)

  let completedSteps: 0 | 1 | 2 | 3 = 0
  let planningStatus: StageStatus = 'pending'
  let devStatus: StageStatus = 'pending'
  let qaStatus: StageStatus = 'pending'
  let deliveryStatus: StageStatus = 'pending'
  let activeAgentId: string | null = null
  let statusLabel = ''

  switch (phase) {
    case 'planning':
      completedSteps = 0
      planningStatus = 'running'
      activeAgentId = plannerId
      statusLabel = `Etapa 1/3 · ${plannerRole} elaborando plano`
      break
    case 'awaiting_approval':
      completedSteps = 1
      planningStatus = 'awaiting_approval'
      activeAgentId = plannerId
      statusLabel = 'Aguardando aprovação humana do plano (1/3 concluída)'
      break
    case 'awaiting_clarification':
      completedSteps = 0
      planningStatus = 'awaiting_approval'
      activeAgentId = plannerId
      statusLabel = `Aguardando esclarecimento: ${plannerRole} precisa da sua resposta`
      break
    case 'developing':
      completedSteps = 1
      planningStatus = 'completed'
      devStatus = 'running'
      activeAgentId = devId
      statusLabel = `Etapa 2/3 · ${devRole} implementando código`
      break
    case 'reviewing':
      completedSteps = 2
      planningStatus = 'completed'
      devStatus = 'completed'
      qaStatus = 'running'
      activeAgentId = qaId
      statusLabel = `Etapa 3/3 · ${qaRole} revisando alterações e testes`
      break
    case 'done':
      completedSteps = 3
      planningStatus = 'completed'
      devStatus = 'completed'
      qaStatus = 'completed'
      deliveryStatus = 'completed'
      activeAgentId = null
      statusLabel = 'Missão concluída (3/3 etapas verificadas)'
      break
    case 'failed':
    case 'cancelled': {
      const terminal: StageStatus = phase === 'failed' ? 'failed' : 'cancelled'
      if (hasDev) {
        completedSteps = 2
        planningStatus = 'completed'
        devStatus = 'completed'
        qaStatus = terminal
      } else if (hasPlan) {
        completedSteps = 1
        planningStatus = 'completed'
        devStatus = terminal
      } else {
        completedSteps = 0
        planningStatus = terminal
      }
      activeAgentId = null
      statusLabel =
        phase === 'failed'
          ? `Interrompida por falha (${completedSteps}/3 etapas concluídas)`
          : `Cancelada pelo usuário (${completedSteps}/3 etapas concluídas)`
      break
    }
  }

  const stages: MissionStageInfo[] = [
    {
      id: 'planning',
      label: 'Planejamento',
      agentId: plannerId,
      agentRole: plannerRole,
      status: planningStatus,
      summary:
        planningStatus === 'running'
          ? 'Inspecionando repositório e definindo arquitetura...'
          : planningStatus === 'awaiting_approval'
            ? 'Plano concluído — aguardando sua aprovação para liberar o Dev.'
            : planningStatus === 'completed'
              ? 'Plano técnico aprovado.'
              : planningStatus === 'failed'
                ? 'Falha ao gerar o plano.'
                : 'Cancelado durante o planejamento.',
    },
  ]

  // Estágio Especialistas Pré-Dev (se houver)
  const preDevSpecs = (mission.specialists ?? []).filter((s) => s.timing === 'pre-dev')
  if (preDevSpecs.length > 0) {
    const preDevResults = (mission.specialistResults ?? []).filter((r) => r.timing === 'pre-dev')
    const allDone = preDevResults.length === preDevSpecs.length && preDevResults.every((r) => r.status === 'completed')
    const anyFailed = preDevResults.some((r) => r.status === 'failed')
    const isRunningPre = phase === 'developing' && !allDone && !anyFailed

    stages.push({
      id: 'pre-dev-specialists',
      label: `Análise Especializada (${preDevSpecs.map((s) => s.role).join(', ')})`,
      agentId: preDevSpecs[0].agentId,
      agentRole: preDevSpecs.map((s) => snap[s.agentId]?.name || s.agentId).join(', '),
      status: anyFailed ? 'failed' : allDone ? 'completed' : isRunningPre ? 'running' : 'pending',
      summary: allDone
        ? `${preDevResults.length} análise(s) técnica(s) entregue(s) ao Desenvolvedor.`
        : isRunningPre
          ? 'Especialistas analisando requisitos antes da implementação...'
          : 'Aguardando aprovação do plano.',
    })
  }

  stages.push({
    id: 'developing',
    label: 'Desenvolvimento',
    agentId: devId,
    agentRole: devRole,
    status: devStatus,
    summary:
      devStatus === 'running'
        ? 'Aplicando código no repositório local...'
        : devStatus === 'completed'
          ? mission.files.length > 0
            ? `Implementado (${mission.files.length} arquivo(s) tocado(s)).`
            : 'Etapa executada sem arquivos alterados.'
          : devStatus === 'failed'
            ? 'Falha na etapa de implementação.'
            : devStatus === 'cancelled'
              ? 'Cancelado antes de concluir o desenvolvimento.'
              : 'Aguardando aprovação do plano.',
  })

  // Estágio Especialistas Pós-Dev (se houver)
  const postDevSpecs = (mission.specialists ?? []).filter((s) => s.timing === 'post-dev')
  if (postDevSpecs.length > 0) {
    const postDevResults = (mission.specialistResults ?? []).filter((r) => r.timing === 'post-dev')
    const allDone = postDevResults.length === postDevSpecs.length && postDevResults.every((r) => r.status === 'completed')
    const anyFailed = postDevResults.some((r) => r.status === 'failed')
    const isRunningPost = phase === 'reviewing' && !allDone && !anyFailed

    stages.push({
      id: 'post-dev-specialists',
      label: `Revisão Especializada (${postDevSpecs.map((s) => s.role).join(', ')})`,
      agentId: postDevSpecs[0].agentId,
      agentRole: postDevSpecs.map((s) => snap[s.agentId]?.name || s.agentId).join(', '),
      status: anyFailed ? 'failed' : allDone ? 'completed' : isRunningPost ? 'running' : 'pending',
      summary: allDone
        ? `${postDevResults.length} parecer(es) especializado(s) entregue(s) ao QA.`
        : isRunningPost
          ? 'Especialistas auditando o código implementado...'
          : 'Aguardando implementação pelo Desenvolvedor.',
    })
  }

  stages.push(
    {
      id: 'reviewing',
      label: 'Revisão QA',
      agentId: qaId,
      agentRole: qaRole,
      status: qaStatus,
      summary:
        qaStatus === 'running'
          ? 'Auditando diff, requisitos, segurança e testes...'
          : qaStatus === 'completed'
            ? mission.verdictDetail
              ? `Veredito QA: ${mission.verdictDetail}.`
              : mission.verdict === 'approved'
                ? 'Veredito QA: APROVADO.'
                : mission.verdict === 'changes'
                  ? 'Veredito QA: REPROVADO (requer ajustes).'
                  : 'Parecer técnico concluído.'
            : qaStatus === 'failed'
              ? 'Falha durante a revisão de QA.'
              : qaStatus === 'cancelled'
                ? 'Cancelado antes da revisão.'
                : 'Aguardando término do desenvolvimento.',
    },
    {
      id: 'delivery',
      label: 'Entrega',
      agentId: null,
      agentRole: 'Operador Humano',
      status: deliveryStatus,
      summary:
        deliveryStatus === 'completed'
          ? 'Relatório final pronto. Revise o diff no Git Control para fazer commit.'
          : 'Disponibilizada após conclusão das etapas.',
    },
  )

  return {
    missionId: mission.id,
    phase,
    completedSteps,
    totalSteps: 3,
    percent: STEP_PERCENTS[completedSteps],
    isRunning: phase === 'planning' || phase === 'developing' || phase === 'reviewing',
    needsApproval: phase === 'awaiting_approval' || phase === 'awaiting_clarification',
    isInterrupted: phase === 'failed' || phase === 'cancelled',
    activeAgentId,
    statusLabel,
    stages,
  }
}
