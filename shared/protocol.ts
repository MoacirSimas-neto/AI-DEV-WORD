// Contrato entre backend e frontend. Somente tipos: nada aqui vira código em runtime.

export type CliId = 'codex' | 'gemini' | 'agy'

export type ProviderId = 'codex' | 'gemini' | 'antigravity'
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'extra-high' | 'default'

export type SpecializationId = 'tech-lead' | 'developer' | 'qa-tester' | 'tutor'
export type RoleCategory = 'planning' | 'developing' | 'reviewing' | 'teaching'
export type KnowledgeDocKind = 'agent' | 'principios' | 'dossie' | 'referencias'
export type AvatarPreset =
  | 'architect'
  | 'dev'
  | 'qa'
  | 'tutor'
  | 'designer'
  | 'data'
  | 'security'
  | 'docs'
  | 'specialist'

export interface SpecializationInfo {
  id: SpecializationId
  name: string
  codename: string
  roleCategory: RoleCategory
  description: string
  defaultAgentId: string
  knowledgeDir: string | null
  availableDocs: KnowledgeDocKind[]
}

/** Limite máximo de especialistas opcionais além dos 3 obrigatórios (Arquiteto, Dev, QA). */
export const MAX_MISSION_SPECIALISTS = 3

export type SpecialistRole =
  | 'database'
  | 'security'
  | 'ui'
  | 'docs'
  | 'api'
  | 'testing'
  | 'data'
  | 'custom'

export type SpecialistTiming = 'pre-dev' | 'post-dev'

export interface MissionSpecialistSelection {
  agentId: string
  role: SpecialistRole
  timing: SpecialistTiming
  expectedContribution?: string
}

export interface MissionTeamSelection {
  plannerId: string
  devId: string
  qaId: string
  specialists?: MissionSpecialistSelection[]
}

export type SpecialistExecutionState =
  | 'pending'
  | 'waiting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'

export interface SpecialistResult {
  agentId: string
  role: SpecialistRole
  timing: SpecialistTiming
  status: SpecialistExecutionState
  summary: string
  details: string
  error?: string | null
  startedAt?: string
  finishedAt?: string
}

export interface AgentSnapshotEntry {
  agentId: string
  name: string
  role: string
  provider: ProviderId
  model: string
  reasoningEffort?: ReasoningEffort
  specializationId: SpecializationId
  customInstructions?: string
  /** Skills resolvidas para o agente no início da missão (versão e hash congelados). */
  skills?: SkillRef[]
}

/** context = instruções compostas no prompt; native = exigiria integração nativa do CLI (não feita pelo AI Dev World). */
export type SkillMode = 'context' | 'native'
/**
 * configured = ativa para o agente, ainda não executada; applied = as instruções chegaram ao prompt;
 * disabled = desativada (global ou no agente); incompatible = o modo da skill não é suportado na execução;
 * failed = deveria ser aplicada e não foi (ver `reason`).
 */
export type SkillApplyState = 'configured' | 'applied' | 'disabled' | 'incompatible' | 'failed'

export interface SkillInfo {
  id: string
  name: string
  description: string
  /** De onde veio o conteúdo (repositório, commit, licença) ou 'local'. */
  origin: string
  version: string
  /** SHA-256 do conteúdo. */
  hash: string
  content: string
  /** Ativada para todos os agentes que não tenham ajuste individual. */
  enabled: boolean
  mode: SkillMode
  createdAt: string
  updatedAt: string
}

export interface SkillInput {
  id: string
  name: string
  content: string
  description?: string
  origin?: string
  version?: string
  mode?: SkillMode
  enabled?: boolean
}

/** Ajuste individual; a ausência de ajuste significa herdar a configuração global. */
export interface SkillAgentOverride {
  agentId: string
  skillId: string
  state: 'on' | 'off'
}

export interface SkillRef {
  id: string
  name: string
  version: string
  hash: string
  mode: SkillMode
  state: SkillApplyState
  /** true quando o estado vem de um ajuste individual do agente, não da configuração global. */
  individual?: boolean
  reason?: string
}

/** Uma skill em uma execução de CLI da missão. */
export interface SkillApplication extends SkillRef {
  agentId: string
  stage: string
  at: string
}

export interface AgentConfig {
  agentId: string
  name?: string
  role?: string
  description?: string
  roleCategory?: RoleCategory
  specializationId?: SpecializationId
  provider: ProviderId
  model: string
  reasoningEffort: ReasoningEffort
  customInstructions?: string
  avatarPreset?: AvatarPreset
  active?: boolean
  isBuiltin?: boolean
  createdAt?: string
  updatedAt: string
}

export interface CustomAgentInput {
  id?: string
  name: string
  role: string
  description?: string
  roleCategory: RoleCategory
  specializationId: SpecializationId
  provider: ProviderId
  model?: string
  reasoningEffort?: ReasoningEffort
  customInstructions?: string
  avatarPreset?: AvatarPreset
  active?: boolean
}

export interface CustomAgentPatch {
  name?: string
  role?: string
  description?: string
  roleCategory?: RoleCategory
  specializationId?: SpecializationId
  provider?: ProviderId
  model?: string
  reasoningEffort?: ReasoningEffort
  customInstructions?: string
  avatarPreset?: AvatarPreset
  active?: boolean
}

export type AgentProfileId = 'economy' | 'balanced' | 'max_quality'

/**
 * offline   = CLI não encontrado.
 * idle      = CLI pronto, sem sessão de terminal (disponível).
 * waiting   = sessão aberta, sem saída recente (esperando o usuário).
 * working   = sessão aberta produzindo saída, ou implementando no modo equipe.
 * planning  = modo equipe: escrevendo o plano.
 * approval  = modo equipe: plano pronto, esperando a aprovação do usuário.
 * reviewing = modo equipe: revisando o trabalho do Dev.
 * done      = modo equipe: terminou a sua parte da missão.
 */
export type AgentState =
  | 'offline'
  | 'idle'
  | 'waiting'
  | 'working'
  | 'planning'
  | 'approval'
  | 'reviewing'
  | 'done'
  | 'error'

/** O backend só informa SE há login; nunca lê nem repassa tokens. */
export type AuthState = 'ok' | 'missing' | 'unknown'

export interface AgentInfo {
  id: string
  name: string
  role: string
  cli: CliId
  roleCategory?: RoleCategory
  specializationId?: SpecializationId
  avatarPreset?: AvatarPreset
  isBuiltin?: boolean
  state: AgentState
  /** true enquanto o backend consulta versão/login do CLI. */
  checking: boolean
  /** Há uma sessão de terminal aberta para este agente. */
  session: boolean
  cliVersion: string | null
  auth: AuthState
  message: string
  checkedAt: string | null
}

/** Pasta que o usuário autorizou os agentes a usar. */
export interface ProjectInfo {
  id: number
  name: string
  path: string
}

export interface Workspace {
  projects: ProjectInfo[]
  /** Projeto onde as próximas sessões de terminal serão abertas. */
  activeProjectId: number | null
}

/** Um arquivo alterado. Pode estar preparado e ter mudanças não preparadas ao mesmo tempo. */
export interface GitFile {
  path: string
  /** Código XY do `git status` (ex.: 'M ', '??'). */
  code: string
  staged: boolean
  unstaged: boolean
}

export type GitRemoteState = 'configured' | 'none' | 'unknown'

export interface GitStatus {
  isRepo: boolean
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFile[]
  /** true se a lista foi cortada por ter arquivos demais. */
  truncated: boolean
  /** Estado do repositório remoto associado ao projeto local. */
  remoteState?: GitRemoteState
  remoteName?: string | null
  remoteUrl?: string | null
  lastCommit?: string | null
}

/** O que um push faria. `token` autoriza exatamente esse push, uma única vez. */
export interface PushPreview {
  token: string
  branch: string
  target: string
  setsUpstream: boolean
  commits: string[]
}

export type TaskStatus = 'todo' | 'doing' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

/** Campos que o usuário edita numa tarefa. */
export interface TaskInput {
  title: string
  description: string
  priority: TaskPriority
  status: TaskStatus
  /** Agente responsável, ou null. */
  agentId: string | null
}

export interface TaskInfo extends TaskInput {
  id: number
  projectId: number
  createdAt: string
  updatedAt: string
}

/**
 * Modo equipe: planning -> awaiting_approval -> developing -> reviewing -> done.
 * QA reprovou: volta a developing (retrabalho) até o limite de tentativas; sem aprovação termina em failed.
 * failed e cancelled também encerram a missão.
 */
export type MissionPhase =
  | 'planning'
  | 'awaiting_approval'
  /** O planejador precisa de uma resposta do usuário antes de planejar. */
  | 'awaiting_clarification'
  | 'developing'
  | 'reviewing'
  /** Só modo dinâmico: um passo aprovado está em execução. */
  | 'executing'
  /** Só modo dinâmico: parada (falha, limite, interrupção) até uma decisão humana. */
  | 'awaiting_decision'
  | 'done'
  | 'failed'
  | 'cancelled'

/** pipeline = fluxo clássico (padrão, inclusive missões antigas); dynamic = plano em passos coordenado pelo Tech Lead. */
export type MissionMode = 'pipeline' | 'dynamic'
/** Fases que uma missão dinâmica usa. As clássicas developing/reviewing não existem nela. */
export type DynamicMissionState = Exclude<MissionPhase, 'developing' | 'reviewing'>

/**
 * O que o agente faz num passo. O backend traduz o modo em permissões do CLI:
 * só `implement` grava arquivos, e só `verify` emite veredito. Nada vindo do Tech Lead muda isso.
 */
export type DelegationMode = 'analyze' | 'implement' | 'review' | 'verify'

/** Limites de uma missão dinâmica. Atingir um deles pausa a missão para decisão humana. */
export interface DynamicLimits {
  /** Passos delegados (iniciados + planejados). */
  maxSteps: number
  /** Convocações e dispensas depois da equipe inicial. */
  maxTeamChanges: number
  maxActiveMembers: number
  /** Reverificações (`verify`) depois da primeira. */
  maxReworkRounds: number
  maxCallsPerAgent: number
  /** Propostas do Tech Lead (cada proposta é um turno). */
  maxTechLeadTurns: number
  /** Mesmo agente com o mesmo objetivo. */
  maxSameConsult: number
  /** Pedidos de ajuste em sequência sobre a mesma proposta. */
  maxAdjustRounds: number
}

/** Chave de outro passo da mesma revisão que precisa terminar antes. */
export type StepDependency = string

/** O que entra no prompt de um passo. `step` sem `revision` aponta para um passo da mesma revisão. */
export type ArtifactRef =
  | { kind: 'plan' }
  | { kind: 'git-diff' }
  | { kind: 'step'; key: string; revision?: number }

/** Um passo como o Tech Lead o propõe. */
export interface PlannedStepInput {
  /** Identifica o passo dentro da revisão (ex.: 'dados-1'). */
  key: string
  agentId: string
  mode: DelegationMode
  objective: string
  dependsOn: StepDependency[]
  inputs: ArtifactRef[]
}

export type StepStatus = 'approved' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled' | 'superseded'

/** Um passo de um plano aprovado. Só existe depois da aprovação humana da proposta que o trouxe. */
export interface PlannedStep extends PlannedStepInput {
  id: number
  missionId: number
  projectId: number
  /** Revisão do plano (= revisão da proposta aprovada). */
  revision: number
  proposalId: number
  /** Ordem lógica dentro da revisão. */
  seq: number
  status: StepStatus
  startedAt: string | null
  finishedAt: string | null
  /** Resposta do agente (declarada, não verificada). */
  result: string
  error: string | null
  /** Liga o passo aos eventos da execução (mission_events.correlation_id). */
  correlationId: string | null
  /** 1 = primeira execução; maior = reexecução autorizada pelo usuário depois de interrupção ou falha. */
  attempt?: number
}

/** convene = entra na equipe; release = deixa a equipe (o cadastro do agente não muda). */
export interface TeamChange {
  action: 'convene' | 'release'
  agentId: string
  reason: string
  /** Tarefa pretendida para o agente (convene). */
  task: string
  /** O que o agente vai receber para trabalhar (convene). */
  context: string
  expectedImpact: string
  /** Como a missão segue se o usuário rejeitar esta mudança. */
  alternative: string
}

/** plan = plano inicial; replan = mudança de passos e/ou equipe; closure = recomendação de encerrar. */
export type ProposalKind = 'plan' | 'replan' | 'closure'
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'adjust_requested' | 'superseded'
export type ProposalDecision = 'approve' | 'reject' | 'adjust'

/** O que o Tech Lead propõe. Texto do modelo: dado não confiável até o backend validar. */
export interface DynamicProposalInput {
  kind: ProposalKind
  /** Objetivo da missão como o Tech Lead o entendeu. */
  objective: string
  reason: string
  /** Estado atual da missão, nas palavras do Tech Lead. */
  missionState: string
  /** Como seguir sem aprovar esta proposta. */
  alternative: string
  teamChanges: TeamChange[]
  steps: PlannedStepInput[]
  /** O que será compartilhado com os agentes envolvidos. */
  sharedContext: ArtifactRef[]
  risks: string[]
  /** Como saber que a missão terminou. Declarado pelo Tech Lead; o sistema não verifica sozinho. */
  completionCriteria: string[]
}

/**
 * Por que a resposta do Tech Lead não virou proposta:
 * missing/duplicate/too_long = bloco ausente, repetido ou grande demais; invalid_json; unsupported_version;
 * invalid_schema = campo faltando, a mais ou fora do formato; stale_revision = feita sobre um plano que já mudou;
 * duplicate_proposal = igual a uma que o usuário já viu; rejected_by_rules = equipe, permissões, dependências ou limites.
 */
export type ProposalErrorCode =
  | 'missing'
  | 'duplicate'
  | 'too_long'
  | 'invalid_json'
  | 'unsupported_version'
  | 'invalid_schema'
  | 'stale_revision'
  | 'duplicate_proposal'
  | 'rejected_by_rules'

/** Uma resposta recusada inteira: nada dela é aproveitado nem executado. */
export interface ProposalRejection {
  code: ProposalErrorCode
  /** Mensagens prontas para mostrar ao usuário e devolver ao Tech Lead. */
  problems: string[]
}

export interface DynamicProposal extends DynamicProposalInput {
  id: number
  missionId: number
  projectId: number
  /** Crescente por missão. Uma decisão só vale para a revisão que o usuário viu. */
  revision: number
  status: ProposalStatus
  /** Agente que propôs. */
  author: string
  /** Quantos pedidos de ajuste em sequência levaram a esta proposta. */
  adjustRound: number
  createdAt: string
  decidedAt: string | null
  /** Quem decidiu (hoje sempre 'user'). */
  decidedBy: string | null
  /** Texto do usuário ao rejeitar ou pedir ajustes. */
  feedback: string | null
  /** O que fez o Tech Lead ser consultado nesta proposta (ex.: verdict_rejected); vazio em propostas antigas. */
  trigger?: string
  /** Calculado ao enviar: agentes desta proposta cuja mudança de equipe o usuário já rejeitou antes, e em quais revisões. */
  previouslyRejected?: { agentId: string; action: TeamChange['action']; revisions: number[] }[]
}

/** Uma rodada Dev -> QA da missão. A lista preserva o histórico do retrabalho. */
export interface MissionAttempt {
  attempt: number
  devReport: string
  files: string[]
  review: string
  verdictDetail: string | null
}

/** Uma pergunta do planejador ao usuário e a resposta dada (null enquanto espera). */
export interface MissionClarification {
  agentId: string
  question: string
  answer: string | null
  askedAt: string
  answeredAt: string | null
}

/** O que foi lembrado a um agente numa etapa: ids e motivos, sem copiar o conteúdo. */
export interface MemoryContextRecord {
  agentId?: string
  chars: number
  selected: { id: number | null; category: MemoryCategory; reason: string }[]
  dropped: { id: number | null; category: MemoryCategory; reason: string }[]
}

export interface MissionInfo {
  id: number
  taskId: number
  projectId: number
  phase: MissionPhase
  /** Ausente = 'pipeline'. */
  mode?: MissionMode
  /** Só em missões dinâmicas. */
  limits?: DynamicLimits
  /** Só em missões dinâmicas: turnos do Tech Lead já usados (inclui respostas recusadas). */
  leadTurns?: number
  /** Agente responsável pelo planejamento (padrão: 'architect'). */
  plannerId?: string
  /** Agente responsável pela implementação (padrão: 'dev'). */
  devId?: string
  /** Agente responsável pela revisão QA (padrão: 'qa'). */
  qaId?: string
  /** Plano do Arquiteto (Gemini). */
  plan: string
  /** Resposta final do Dev (Codex). */
  devReport: string
  /** Revisão do QA (Gemini). */
  review: string
  /** Veredito do QA; null se ele não deu um. */
  verdict: 'approved' | 'changes' | null
  /** Classificação detalhada do QA (ex.: 'APROVADO COM RESSALVAS'). */
  verdictDetail?: string | null
  /** Especialistas opcionais selecionados para a missão (máximo 3). */
  specialists?: MissionSpecialistSelection[]
  /** Resultados e análises dos especialistas (pré-dev e pós-dev). */
  specialistResults?: SpecialistResult[]
  /** Rodadas Dev -> QA já encerradas, da mais antiga para a mais recente. */
  attempts?: MissionAttempt[]
  /** Perguntas do planejador e respostas do usuário, em ordem. */
  clarifications?: MissionClarification[]
  /** Memórias entregues a cada etapa (planning, developing, reviewing) na última execução dela. */
  memoryContext?: Record<string, MemoryContextRecord>
  /** Skills de cada execução de CLI desta missão, em ordem. Nunca muda com edições posteriores da skill. */
  skillApplications?: SkillApplication[]
  /** Snapshot sem credenciais dos agentes participantes no momento da missão. */
  teamSnapshot?: Record<string, AgentSnapshotEntry>
  /** Arquivos com alterações depois que o Dev terminou. */
  files: string[]
  /** Missão dinâmica: impressão do conteúdo de cada arquivo de `files` quando a missão o registrou (detecta edição de fora). */
  fileHashes?: Record<string, string>
  error: string | null
  createdAt: string
  updatedAt: string
}

export type ResumeAction = 'continue' | 'retry_step' | 'replan'

/** Fotografia de uma missão dinâmica para decidir como seguir. Lida do banco e do Git agora; nada é executado. */
export interface RecoveryState {
  projectId: number
  missionId: number
  phase: MissionPhase
  /** Motivo da última parada (mission.blocked), quando a trilha existe. */
  reason: string | null
  error: string | null
  /** Passos interrompidos ou que falharam e ainda não têm outra tentativa. */
  retryable: PlannedStep[]
  /** Chaves dos passos aprovados que podem rodar agora. */
  eligible: string[]
  /** known = arquivos com alterações que a missão registrou; unknown = alterações de origem não registrada. */
  files: { available: boolean; known: string[]; unknown: string[] }
  actions: (ResumeAction | 'close' | 'cancel')[]
}

/** Missão no modo dinâmico: o plano vive em propostas (DynamicProposal) e passos (PlannedStep). */
export type DynamicMission = MissionInfo & { mode: 'dynamic'; phase: DynamicMissionState; limits: DynamicLimits }

export type ActivityKind ='task' | 'status' | 'mission' | 'agent' | 'review' | 'files' | 'commit' | 'push' | 'error' | 'memory'

/** agent = só o agente dono recebe; team = toda a equipe do projeto recebe. */
export type MemoryScope = 'agent' | 'team'
export type MemoryCategory = 'decision' | 'requirement' | 'architecture' | 'problem' | 'solution' | 'qa_result' | 'learning'
/** Só 'approved' entra nos prompts. 'superseded' = trocada por uma versão mais nova. */
export type MemoryStatus = 'proposed' | 'approved' | 'rejected' | 'superseded'

/** Um fato lembrado de um projeto. Nunca é editado nem apagado: substituir cria outro registro. */
export interface MemoryEntry {
  id: number
  projectId: number
  scope: MemoryScope
  /** Dono (escopo agent) ou agente que originou o registro (escopo team). */
  agentId: string | null
  category: MemoryCategory
  content: string
  status: MemoryStatus
  sourceMissionId: number | null
  /** 'user' ou o id do agente que propôs. */
  author: string
  approvedBy: string | null
  /** Versão anterior que este registro substituiu. */
  supersedesId: number | null
  createdAt: string
  updatedAt: string
}

export interface MemoryFilter {
  scope?: MemoryScope
  agentId?: string
  category?: MemoryCategory
  status?: MemoryStatus
  /** Datas AAAA-MM-DD (inclusive). */
  from?: string
  to?: string
  /** Busca textual simples no conteúdo. */
  q?: string
}

export interface MemoryInput {
  scope: MemoryScope
  agentId: string | null
  category: MemoryCategory
  content: string
}

/** Uma linha do histórico. O texto passa por remoção de segredos antes de ser gravado. */
export interface ActivityEntry {
  id: number
  at: string
  kind: ActivityKind
  message: string
  projectId: number | null
  taskId: number | null
  missionId: number | null
  agentId: string | null
}

/**
 * De onde vem a informação de um evento:
 * observed    = registrada diretamente pelo backend ou por um processo que ele executou;
 * declared    = está na resposta do modelo, sem comprovação independente;
 * context     = foi entregue ao mecanismo de execução (prompt). Não prova que o modelo usou ou seguiu;
 * unavailable = a ferramenta não oferece a informação.
 */
export type EvidenceKind = 'observed' | 'declared' | 'context' | 'unavailable'
export type MissionEventState = 'started' | 'completed' | 'failed' | 'cancelled' | 'info'

export type MissionEventType =
  | 'mission.started'
  | 'mission.completed'
  | 'mission.cancelled'
  /** Falha registrada (inclui missão interrompida pelo fechamento do app). */
  | 'mission.failed'
  | 'agent.selected'
  /** Skills resolvidas para o agente no início da missão (ainda não entregues a nenhum CLI). */
  | 'skills.configured'
  /** data: from, to, stage, objective. O correlationId identifica a execução delegada. */
  | 'task.delegated'
  /** context: o texto da skill entrou no prompt. Nunca significa instalação nativa nem uso pelo modelo. */
  | 'skill.included'
  | 'skill.failed'
  | 'memory.included'
  /** context: resultado de um agente incluído no prompt de outro (data: from, to, artifact, ref). */
  | 'result.forwarded'
  | 'planner.started'
  | 'planner.finished'
  | 'specialist.started'
  | 'specialist.finished'
  | 'dev.started'
  | 'dev.finished'
  | 'qa.started'
  | 'qa.finished'
  | 'cli.started'
  | 'cli.finished'
  /** declared: o agente respondeu. O texto fica na missão (data.ref); aqui só tamanho e hash. */
  | 'plan.produced'
  | 'result.declared'
  | 'verdict.declared'
  | 'clarification.requested'
  | 'clarification.received'
  | 'approval.requested'
  | 'approval.received'
  /** observed: estado do Git antes/depois da etapa do Dev. */
  | 'files.changed'
  /** declared: a resposta do agente menciona testes. O sistema não os executou. */
  | 'tests.declared'
  /** observed quando o backend executa o comando (data: command, exitCode); unavailable quando não executou nenhum. */
  | 'tests.executed'
  /** A missão atingiu o limite de eventos: os seguintes não foram gravados. */
  | 'log.truncated'
  // ----- modo dinâmico -----
  /** declared: o Tech Lead respondeu com uma proposta. Não é decisão nem execução. */
  | 'proposal.declared'
  /** observed: o backend recusou a resposta do Tech Lead (data: code, problems). */
  | 'proposal.invalid'
  /** observed: o backend aplicou uma entrada ou saída de agente que o usuário aprovou. */
  | 'team.joined'
  | 'team.released'
  /** observed: os passos de uma proposta aprovada viraram o plano vigente. */
  | 'plan.revised'
  | 'step.started'
  | 'step.finished'
  /** observed: a missão parou à espera de decisão humana (data: reason). */
  | 'mission.blocked'
  /** Um novo turno do Tech Lead foi pedido (data: trigger, origem). declared quando o gatilho veio da resposta de um agente. */
  | 'replan.triggered'
  /** observed: o app foi fechado com este passo rodando; ele não é relançado sozinho. */
  | 'step.interrupted'
  /** observed: o usuário decidiu como seguir uma missão parada (data: action, opId). */
  | 'mission.resumed'
  /** observed: um limite da missão foi atingido e a missão parou. */
  | 'limit.reached'
  /** declared: o Tech Lead recomendou encerrar. Só a aprovação humana encerra. */
  | 'closure.recommended'
  // ----- chat → missão (Etapa 12.2) -----
  /** observed: o usuário pediu, no chat, para preparar uma missão (data: conversationId, opId, tamanho do contexto). */
  | 'chat.mission_requested'
  /** observed: a missão ficou vinculada à conversa de origem. */
  | 'chat.mission_linked'
  /** observed: o usuário pediu alteração da missão pelo chat (Etapa 12.3). */
  | 'chat.replan_requested'

/** Um fato da trilha de execução de uma missão. Textos passam por remoção de segredos; nunca traz prompts nem conteúdo de arquivos. */
export interface MissionEvent {
  /** Único e crescente: a ordem dos ids é a ordem dos fatos. */
  id: number
  projectId: number
  missionId: number
  taskId: number | null
  agentId: string | null
  type: MissionEventType
  at: string
  state: MissionEventState
  evidence: EvidenceKind
  summary: string
  /** Metadados e referências às evidências (ex.: ref 'missions.plan', sha256, código de saída). */
  data: Record<string, unknown>
  /** Liga os eventos de uma mesma execução delegada (da delegação ao resultado). */
  correlationId: string | null
}


// ---------- Chat com o Tech Lead (Etapa 12.1) ----------
// Conversar não executa nada: o agente roda com o papel de planejamento (somente leitura) e
// nenhuma resposta vira proposta, aprovação ou missão nesta etapa.

export type ChatRole = 'user' | 'assistant'
/** streaming = resposta chegando; interrupted = parada pelo usuário ou pelo fechamento do app. */
export type ChatMessageStatus = 'complete' | 'streaming' | 'interrupted' | 'error'

export interface ChatConversation {
  id: number
  projectId: number
  title: string
  /** Agente que responde nesta conversa (um planejador cadastrado). */
  agentId: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

/** O que foi enviado ao modelo nesta resposta: as mensagens antigas ficam fora da janela. */
export interface ChatContextInfo {
  sentMessages: number
  omittedMessages: number
}

export interface ChatMessage {
  id: number
  conversationId: number
  projectId: number
  role: ChatRole
  /** 'user' ou o id do agente que respondeu. */
  author: string
  agentId: string | null
  cli: CliId | null
  content: string
  status: ChatMessageStatus
  /** Operação do usuário que gerou a mensagem (envio repetido com o mesmo opId não duplica). */
  opId: string | null
  /** Resposta: id da mensagem do usuário respondida. */
  replyTo: number | null
  error: string | null
  context: ChatContextInfo | null
  createdAt: string
  updatedAt: string
}

/** Limites do chat (o backend é a autoridade; a interface só os mostra). */
export const CHAT_LIMITS = {
  maxMessageChars: 8000,
  maxTitleChars: 120,
  /** Janela de contexto: no máximo estas mensagens anteriores... */
  contextMessages: 20,
  /** ...e no máximo estes caracteres de histórico no prompt. */
  contextChars: 16_000,
  pageSize: 100,
  /** Máximo de chamadas ao modelo no chat enquanto uma missão vinculada está aberta. */
  maxMissionChatCalls: 20,
} as const

export type ChatAction = 'create' | 'send' | 'rename' | 'delete' | 'cancel' | 'prepare-mission' | 'request-replan'

export interface PendingReplanRequest {
  missionId: number
  conversationId: number
  opId: string
  detail: string
  requestedAt: string
}

/**
 * Missão nascida de uma conversa (Etapa 12.2). Uma conversa pode originar várias missões;
 * cada missão tem no máximo uma conversa de origem. Sempre do mesmo projeto.
 */
export interface ChatMissionLink {
  projectId: number
  conversationId: number
  missionId: number
  taskId: number
  /** Operação do usuário (botão "Preparar missão"). */
  opId: string
  /** Quantas mensagens da conversa entraram no contexto da missão e quantas ficaram de fora. */
  context: ChatContextInfo
  createdAt: string
}

/** Contexto de conversa que vira a descrição da tarefa da missão (o backend é a autoridade). */
export const CHAT_MISSION_CONTEXT = { messages: 12, chars: 6000, perMessage: 1500 } as const

export type ServerMessage =
  | { type: 'chat-conversations'; projectId: number; conversations: ChatConversation[] }
  /** Página de mensagens (mais antigas primeiro). hasMore = há mensagens antes da primeira. */
  | { type: 'chat-messages'; projectId: number; conversationId: number; messages: ChatMessage[]; hasMore: boolean; beforeId: number | null }
  /** Mensagem nova ou atualizada (inclusive o fim de uma resposta). */
  | { type: 'chat-message'; message: ChatMessage }
  /** Pedaço de resposta em andamento, já redigido. */
  | { type: 'chat-delta'; projectId: number; conversationId: number; messageId: number; text: string }
  | { type: 'chat-deleted'; projectId: number; conversationId: number }
  | { type: 'chat-result'; action: ChatAction; opId: string | null; ok: boolean; message: string; conversationId: number | null }
  /** Missões nascidas de conversas do projeto (resposta a chat-links e aviso a cada vínculo novo). */
  | { type: 'chat-links'; projectId: number; links: ChatMissionLink[] }
  /** Resposta a events-list: em ordem de id. */
  | { type: 'mission-events'; projectId: number; missionId: number | null; events: MissionEvent[] }
  /** Evento novo, ao vivo. */
  | { type: 'mission-event'; event: MissionEvent }
  /** Resposta a plan-list e aviso a cada mudança: todas as revisões, em ordem. */
  | { type: 'mission-plan'; projectId: number; missionId: number; proposals: DynamicProposal[]; steps: PlannedStep[]; pendingReplan?: PendingReplanRequest | null }
  | { type: 'mission-recovery'; state: RecoveryState }
  | { type: 'mission-resume-result'; opId: string; missionId: number; ok: boolean; applied: boolean; message: string }
  /** Resultado de proposal-decide para quem pediu. applied=false com ok=true = a decisão já estava registrada. */
  | { type: 'proposal-result'; opId: string; missionId: number; proposalId: number; ok: boolean; applied: boolean; status: ProposalStatus | null; message: string }
  | {
      type: 'snapshot'
      agents: AgentInfo[]
      workspace: Workspace
      tasks: TaskInfo[]
      missions: MissionInfo[]
      history: ActivityEntry[]
      configs: AgentConfig[]
      allConfigs?: AgentConfig[]
      specializations?: SpecializationInfo[]
      skills?: SkillInfo[]
      skillOverrides?: SkillAgentOverride[]
    }
  | { type: 'skills'; skills: SkillInfo[]; overrides: SkillAgentOverride[] }
  | { type: 'agent'; agent: AgentInfo }
  | { type: 'agents'; agents: AgentInfo[] }
  | { type: 'workspace'; workspace: Workspace }
  /** Erro de uma ação pedida por este cliente (ex.: pasta inválida). */
  | { type: 'notice'; message: string }
  /** Resposta a term-open: `replay` é a saída acumulada da sessão até agora. */
  | { type: 'term-ready'; agentId: string; replay: string }
  | { type: 'term-data'; agentId: string; data: string }
  | { type: 'term-exit'; agentId: string; code: number }
  | { type: 'term-error'; agentId: string; message: string }
  /** Estado Git do projeto ativo; null quando não há projeto. */
  | { type: 'git-status'; status: GitStatus | null }
  | { type: 'git-diff'; path: string; staged: boolean; text: string }
  | { type: 'git-push-preview'; preview: PushPreview }
  | { type: 'git-result'; ok: boolean; message: string }
  /** Notificação de atividade/alterações detectadas no Git */
  | { type: 'git-activity'; summary: string; files: string[]; agentId?: string }
  /** Listas completas, reenviadas a cada mudança (são pequenas). */
  | { type: 'tasks'; tasks: TaskInfo[] }
  | { type: 'missions'; missions: MissionInfo[] }
  | { type: 'history'; entries: ActivityEntry[] }
  | { type: 'agent-configs'; configs: AgentConfig[]; allConfigs?: AgentConfig[] }
  | { type: 'specializations'; specializations: SpecializationInfo[] }
  /** Saída ao vivo do CLI que está trabalhando na missão. */
  | { type: 'mission-output'; missionId: number; data: string }
  | {
      type: 'project-validate-result'
      path: string
      valid: boolean
      exists: boolean
      isDirectory: boolean
      isRepo: boolean
      branch: string | null
      error?: string
    }
  | { type: 'dialog-folder-selected'; path: string | null }
  /** Resposta a memory-list. */
  | { type: 'memory-entries'; projectId: number; entries: MemoryEntry[] }
  /** Resposta a memory-versions: da versão mais antiga para a atual. */
  | { type: 'memory-versions'; id: number; versions: MemoryEntry[] }
  /** A memória de um projeto mudou: quem estiver exibindo deve pedir a lista de novo. */
  | { type: 'memory-changed'; projectId: number }

export type ClientMessage =
  | { type: 'chat-list'; projectId: number }
  | { type: 'chat-create'; projectId: number; agentId: string; opId: string }
  | { type: 'chat-rename'; projectId: number; conversationId: number; title: string; opId: string }
  /** Exclusão definitiva: a interface pede confirmação antes de enviar. */
  | { type: 'chat-delete'; projectId: number; conversationId: number; opId: string }
  | { type: 'chat-open'; projectId: number; conversationId: number; beforeId?: number }
  | { type: 'chat-send'; projectId: number; conversationId: number; content: string; opId: string }
  | { type: 'chat-cancel'; projectId: number; conversationId: number; opId: string }
  /** Transforma a conversa numa missão dinâmica: o Tech Lead propõe, nada roda sem aprovação. */
  | { type: 'chat-prepare-mission'; projectId: number; conversationId: number; opId: string }
  /** Solicita alteração da missão vinculada (ponto seguro / replanejamento explícito). */
  | { type: 'chat-request-replan'; projectId: number; conversationId: number; missionId: number; detail: string; opId: string }
  | { type: 'chat-links'; projectId: number }
  | { type: 'check-cli'; agentId: string }
  | { type: 'dialog-open-folder' }
  | { type: 'project-validate'; path: string }
  /** Inicia a sessão do agente ou se reconecta a uma já existente. */
  | { type: 'term-open'; agentId: string; cols: number; rows: number }
  | { type: 'term-input'; agentId: string; data: string }
  | { type: 'term-resize'; agentId: string; cols: number; rows: number }
  | { type: 'term-close'; agentId: string }
  | { type: 'project-add'; path: string }
  | { type: 'project-select'; projectId: number }
  | { type: 'project-remove'; projectId: number }
  | { type: 'git-status' }
  | { type: 'git-diff'; path: string; staged: boolean }
  | { type: 'git-stage'; paths: string[] }
  | { type: 'git-unstage'; paths: string[] }
  | { type: 'git-commit'; message: string }
  /** Pede a prévia; o push em si exige o token devolvido por ela. */
  | { type: 'git-push-preview' }
  | { type: 'git-push'; token: string }
  | { type: 'task-create'; projectId: number; task: TaskInput }
  | { type: 'task-update'; taskId: number; task: TaskInput }
  | { type: 'task-delete'; taskId: number }
  /** Modo equipe: o planejador começa a planejar a tarefa (com equipe padrão ou personalizada). */
  | { type: 'mission-start'; taskId: number; team?: Partial<MissionTeamSelection>; mode?: MissionMode; limits?: Partial<DynamicLimits> }
  /**
   * Decisão humana sobre uma proposta de missão dinâmica. `revision` é a que o usuário viu;
   * `opId` identifica o clique: o reenvio da mesma decisão não executa nada de novo.
   */
  | { type: 'proposal-decide'; missionId: number; proposalId: number; revision: number; decision: ProposalDecision; feedback?: string; opId: string }
  /** O usuário confirma o encerramento de uma missão dinâmica que aguarda decisão. */
  | { type: 'mission-close'; missionId: number }
  /** Estado de uma missão dinâmica parada: passos interrompidos, alterações no Git e ações possíveis. */
  | { type: 'mission-recovery'; projectId: number; missionId: number }
  /**
   * Decisão humana sobre uma missão dinâmica parada. continue = rodar os passos aprovados elegíveis;
   * retry_step = executar de novo um passo interrompido ou que falhou (stepId); replan = consultar o Tech Lead.
   * acceptChanges = seguir preservando alterações no repositório que a missão não registrou.
   * acceptFiles = a lista exata que o usuário viu ao confirmar (obrigatória com acceptChanges): o backend
   * recusa se surgiu alteração fora dela, para o aceite não cobrir o que ninguém viu.
   */
  | { type: 'mission-resume'; missionId: number; action: ResumeAction; stepId?: number; detail?: string; acceptChanges?: boolean; acceptFiles?: string[]; opId: string }
  /** Propostas (com as decisões) e passos de uma missão dinâmica. Também serve para retomar depois de reconectar. */
  | { type: 'plan-list'; projectId: number; missionId: number }
  /** Aprova o plano e libera o Dev. */
  | { type: 'mission-approve'; missionId: number }
  /** Rejeita o plano ou interrompe a missão. */
  | { type: 'mission-cancel'; missionId: number }
  /** Responde à pergunta do planejador e retoma o planejamento. */
  | { type: 'mission-clarify'; missionId: number; answer: string }
  /** Memória: toda aprovação, rejeição e substituição é uma ação humana vinda daqui. */
  | { type: 'memory-list'; projectId: number; filter?: MemoryFilter }
  | { type: 'memory-create'; projectId: number; entry: MemoryInput }
  | { type: 'memory-approve'; id: number }
  | { type: 'memory-reject'; id: number }
  | { type: 'memory-supersede'; id: number; content: string }
  | { type: 'memory-versions'; id: number }
  /** Central de Agentes: configuração individual, perfis, restauração e agentes personalizados */
  | {
      type: 'agent-config-set'
      config: {
        agentId: string
        provider: ProviderId
        model: string
        reasoningEffort: ReasoningEffort
      }
    }
  | { type: 'agent-config-profile'; profile: AgentProfileId }
  | { type: 'agent-config-reset' }
  | { type: 'agent-create'; agent: CustomAgentInput }
  | { type: 'agent-update'; agentId: string; patch: CustomAgentPatch }
  | { type: 'agent-set-active'; agentId: string; active: boolean }
  | { type: 'agents-list' }
  | { type: 'specializations-list' }
  /** Skills globais: registro, ativação para todos e ajuste por agente. */
  | { type: 'skills-list' }
  | { type: 'skill-save'; skill: SkillInput }
  | { type: 'skill-set-enabled'; id: string; enabled: boolean }
  | { type: 'skill-set-agent'; agentId: string; skillId: string; state: 'inherit' | 'on' | 'off' }
  /** Trilha de eventos de um projeto (ou de uma missão dele). afterId pagina: só eventos com id maior. */
  | { type: 'events-list'; projectId: number; missionId?: number; afterId?: number }
