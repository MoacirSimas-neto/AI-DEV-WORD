import { type FormEvent, useEffect, useState } from 'react'
import type {
  AgentConfig,
  AgentInfo,
  AgentProfileId,
  AvatarPreset,
  CustomAgentInput,
  ProviderId,
  ReasoningEffort,
  RoleCategory,
  SkillAgentOverride,
  SkillInfo,
  SpecializationId,
  SpecializationInfo,
} from '../../../shared/protocol.ts'
import { AVATAR_PRESET_OPTIONS } from '../game/agentLooks.ts'
import type { Send, Subscribe } from '../net/useServer.ts'
import { AgentPortrait } from './AgentPortrait.tsx'
import { SkillsPanel } from './SkillsPanel.tsx'

type PortraitAnimMode = 'static' | 'idle' | 'walk' | 'work'

interface Props {
  agents: AgentInfo[]
  configs: AgentConfig[]
  allConfigs?: AgentConfig[]
  specializations?: SpecializationInfo[]
  skills?: SkillInfo[]
  skillOverrides?: SkillAgentOverride[]
  online: boolean
  send: Send
  subscribe?: Subscribe
  onClose: () => void
}

const EFFORT_OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: 'default', label: 'Padrão do modelo' },
  { value: 'low', label: 'Baixo' },
  { value: 'medium', label: 'Médio' },
  { value: 'high', label: 'Alto' },
  { value: 'extra-high', label: 'Extra alto' },
]

const CATEGORY_LABELS: Record<RoleCategory, string> = {
  planning: 'Planejamento',
  developing: 'Desenvolvimento',
  reviewing: 'Revisão / QA',
  teaching: 'Ensino / Tutoria',
}

const DEFAULT_SPECIALIZATIONS: SpecializationInfo[] = [
  {
    id: 'tech-lead',
    name: 'Tech Lead & Arquiteto',
    codename: 'Arquiteto',
    roleCategory: 'planning',
    description: 'Planejamento técnico estruturado, análise de impacto e decomposição enxuta.',
    defaultAgentId: 'architect',
    knowledgeDir: 'tech-lead',
    availableDocs: ['agent', 'principios', 'dossie', 'referencias'],
  },
  {
    id: 'developer',
    name: 'Desenvolvedor Pragmático',
    codename: 'Dev',
    roleCategory: 'developing',
    description: 'Implementação cirúrgica, código limpo, validação em fronteiras e testes.',
    defaultAgentId: 'dev',
    knowledgeDir: 'developer',
    availableDocs: ['agent', 'principios', 'dossie', 'referencias'],
  },
  {
    id: 'qa-tester',
    name: 'QA & Revisor Técnico',
    codename: 'QA',
    roleCategory: 'reviewing',
    description: 'Auditoria de regressões, segurança, casos de borda e veredito objetivo.',
    defaultAgentId: 'qa',
    knowledgeDir: 'qa-tester',
    availableDocs: ['agent', 'principios', 'dossie', 'referencias'],
  },
  {
    id: 'tutor',
    name: 'Tutor Didático',
    codename: 'Tutor',
    roleCategory: 'teaching',
    description: 'Explicação passo a passo da arquitetura, decisões técnicas e código.',
    defaultAgentId: 'tutor',
    knowledgeDir: null,
    availableDocs: ['agent'],
  },
]

const GEMINI_MODELS = [
  { id: 'auto', label: 'Auto (gerenciado pelo CLI)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
]

const CODEX_MODELS = [
  { id: 'default', label: 'Padrão do CLI (~/.codex/config.toml)' },
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'o3', label: 'o3' },
  { id: 'o3-mini', label: 'o3-mini' },
  { id: 'o1', label: 'o1' },
]

const ANTIGRAVITY_MODELS = [
  { id: 'default', label: 'Padrão do Antigravity CLI' },
  { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
  { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
  { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)' },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
  { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
  { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)' },
  { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
]

function modelsForProvider(provider: ProviderId) {
  if (provider === 'gemini') return GEMINI_MODELS
  if (provider === 'codex') return CODEX_MODELS
  return ANTIGRAVITY_MODELS
}

function defaultModelForProvider(provider: ProviderId): string {
  if (provider === 'gemini') return 'auto'
  if (provider === 'antigravity') return 'gemini-4-argon-high'
  return 'default'
}

export function AgentCenter({
  agents,
  configs,
  allConfigs,
  specializations,
  skills = [],
  skillOverrides = [],
  online,
  send,
  subscribe,
  onClose,
}: Props) {
  const [profilePreview, setProfilePreview] = useState<AgentProfileId | null>(null)
  const [savingNotice, setSavingNotice] = useState<string | null>(null)
  const [errorNotice, setErrorNotice] = useState<string | null>(null)

  // Filtros
  const [categoryFilter, setCategoryFilter] = useState<'all' | RoleCategory>('all')
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | 'inactive'>('all')

  // Diagnóstico aberto por agentId
  const [diagOpenIds, setDiagOpenIds] = useState<Record<string, boolean>>({})

  // Estado do Criador / Editor de Agente
  const [formOpen, setFormOpen] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [editingIsBuiltin, setEditingIsBuiltin] = useState(false)
  const [customId, setCustomId] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [description, setDescription] = useState('')
  const [roleCategory, setRoleCategory] = useState<RoleCategory>('developing')
  const [specializationId, setSpecializationId] = useState<SpecializationId>('developer')
  const [provider, setProvider] = useState<ProviderId>('gemini')
  const [model, setModel] = useState<string>('auto')
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('default')
  const [customInstructions, setCustomInstructions] = useState('')
  const [avatarPreset, setAvatarPreset] = useState<AvatarPreset>('specialist')
  const [active, setActive] = useState(true)
  const [previewAnim, setPreviewAnim] = useState<PortraitAnimMode>('idle')

  const specList = specializations && specializations.length > 0 ? specializations : DEFAULT_SPECIALIZATIONS
  const mergedConfigs: AgentConfig[] =
    allConfigs && allConfigs.length > 0 ? allConfigs : configs

  useEffect(() => {
    if (!subscribe) return
    return subscribe((msg) => {
      if (msg.type === 'notice') {
        setErrorNotice(msg.message)
      }
    })
  }, [subscribe])

  const showSaved = (text: string) => {
    setErrorNotice(null)
    setSavingNotice(text)
    setTimeout(() => setSavingNotice(null), 4000)
  }

  const openCreateForm = () => {
    setEditingAgentId(null)
    setEditingIsBuiltin(false)
    setCustomId('')
    setName('')
    setRole('Especialista Técnico')
    setDescription('')
    setRoleCategory('developing')
    setSpecializationId('developer')
    setProvider('gemini')
    setModel('auto')
    setReasoningEffort('default')
    setCustomInstructions('')
    setAvatarPreset('specialist')
    setActive(true)
    setPreviewAnim('idle')
    setErrorNotice(null)
    setFormOpen(true)
  }

  const openEditForm = (cfg: AgentConfig) => {
    setEditingAgentId(cfg.agentId)
    setEditingIsBuiltin(Boolean(cfg.isBuiltin))
    setCustomId(cfg.agentId)
    setName(cfg.name ?? cfg.agentId)
    setRole(cfg.role ?? '')
    setDescription(cfg.description ?? '')
    setRoleCategory(cfg.roleCategory ?? 'developing')
    setSpecializationId(cfg.specializationId ?? 'developer')
    setProvider(cfg.provider)
    setModel(cfg.model)
    setReasoningEffort(cfg.reasoningEffort)
    setCustomInstructions(cfg.customInstructions ?? '')
    setAvatarPreset(cfg.avatarPreset ?? 'specialist')
    setActive(cfg.active !== false)
    setPreviewAnim('idle')
    setErrorNotice(null)
    setFormOpen(true)
  }

  const handleSubmitForm = (e: FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setErrorNotice('Informe o nome do agente.')
      return
    }
    if (trimmedName.length > 60) {
      setErrorNotice('O nome do agente deve ter no máximo 60 caracteres.')
      return
    }
    if (customInstructions.length > 4000) {
      setErrorNotice('As instruções personalizadas devem ter no máximo 4000 caracteres.')
      return
    }

    const payload: CustomAgentInput = {
      id: customId.trim() || undefined,
      name: trimmedName,
      role: role.trim() || CATEGORY_LABELS[roleCategory],
      description: description.trim(),
      roleCategory,
      specializationId,
      provider,
      model: model.trim() || defaultModelForProvider(provider),
      reasoningEffort,
      customInstructions: customInstructions.trim(),
      avatarPreset,
      active,
    }

    if (editingAgentId) {
      send({
        type: 'agent-update',
        agentId: editingAgentId,
        patch: payload,
      })
      showSaved(`Agente "${trimmedName}" atualizado com sucesso.`)
    } else {
      send({
        type: 'agent-create',
        agent: payload,
      })
      showSaved(`Agente "${trimmedName}" criado e adicionado ao escritório!`)
    }
    setFormOpen(false)
  }

  const handleConfigChange = (
    agentId: string,
    patch: { provider: ProviderId; model: string; reasoningEffort: ReasoningEffort },
  ) => {
    send({
      type: 'agent-config-set',
      config: {
        agentId,
        provider: patch.provider,
        model: patch.model,
        reasoningEffort: patch.reasoningEffort,
      },
    })
    showSaved(`Configuração salva para ${agentId}. Será aplicada na próxima execução.`)
  }

  const handleToggleActive = (cfg: AgentConfig) => {
    if (cfg.isBuiltin) return
    const nextActive = !cfg.active
    send({ type: 'agent-set-active', agentId: cfg.agentId, active: nextActive })
    showSaved(
      nextActive
        ? `Agente "${cfg.name}" ativado e posicionado no escritório 2D.`
        : `Agente "${cfg.name}" desativado e removido do escritório 2D.`,
    )
  }

  const handleDiagnoseAgent = (agentId: string, isActive: boolean) => {
    setDiagOpenIds((prev) => ({ ...prev, [agentId]: true }))
    if (online && isActive) {
      send({ type: 'check-cli', agentId })
    }
  }

  const applyProfile = (profile: AgentProfileId) => {
    send({ type: 'agent-config-profile', profile })
    setProfilePreview(null)
    showSaved(`Perfil ${profile} aplicado com sucesso.`)
  }

  const resetDefaults = () => {
    send({ type: 'agent-config-reset' })
    showSaved('Configurações restauradas para o padrão oficial.')
  }

  const filteredConfigs = mergedConfigs.filter((cfg) => {
    const cat = cfg.roleCategory ?? 'developing'
    const isAct = cfg.active !== false
    if (categoryFilter !== 'all' && cat !== categoryFilter) return false
    if (statusFilter === 'active' && !isAct) return false
    if (statusFilter === 'inactive' && isAct) return false
    return true
  })

  const selectedSpecInfo = specList.find((s) => s.id === specializationId)

  return (
    <aside className="window agent-center-window">
      <header className="window-head">
        <div className="window-id">
          <h2>Central de Agentes & Especializações</h2>
          <p>
            Crie agentes personalizados, escolha especializações do AI Dev Team, configure provedores CLI e visualize os
            personagens em pixel art
          </p>
        </div>
        <div className="agent-center-head-actions">
          <button
            type="button"
            className="btn-primary-glow"
            disabled={!online}
            onClick={openCreateForm}
          >
            + Criar Agente
          </button>
          <button type="button" className="btn-quiet window-close" aria-label="Fechar Central" onClick={onClose}>
            ×
          </button>
        </div>
      </header>

      {savingNotice && <p className="git-result git-result-ok">{savingNotice}</p>}
      {errorNotice && (
        <div className="git-notice-banner" role="alert">
          <span>⚠ {errorNotice}</span>
          <button type="button" className="btn-quiet notice-dismiss" onClick={() => setErrorNotice(null)}>
            ×
          </button>
        </div>
      )}

      <SkillsPanel skills={skills} overrides={skillOverrides} agents={allConfigs ?? configs} online={online} send={send} />

      {/* Barra de Perfis e Filtros */}
      <div className="agent-toolbar-row">
        <section className="agent-profiles-bar">
          <span className="agent-profiles-title">Perfis rápidos:</span>
          <button
            type="button"
            className="btn-quiet"
            disabled={!online}
            onClick={() => applyProfile('economy')}
            title="Modelos rápidos e econômicos (Flash / Flash-Lite / Low effort)"
          >
            Economia
          </button>
          <button
            type="button"
            className="btn-quiet"
            disabled={!online}
            onClick={() => applyProfile('balanced')}
            title="Equilíbrio entre velocidade e precisão (Auto / Medium effort)"
          >
            Equilibrado
          </button>
          <button
            type="button"
            className="btn-quiet"
            disabled={!online}
            onClick={() => applyProfile('max_quality')}
            title="Máxima capacidade analítica (Gemini Pro / High effort)"
          >
            Máxima qualidade
          </button>
          <button
            type="button"
            className="btn-quiet"
            disabled={!online}
            onClick={resetDefaults}
            title="Restaurar parâmetros padrão de fábrica"
          >
            Restaurar padrões
          </button>
        </section>

        <section className="agent-filters-bar" aria-label="Filtros de agentes">
          <label>
            Categoria:
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as 'all' | RoleCategory)}
            >
              <option value="all">Todas ({mergedConfigs.length})</option>
              <option value="planning">Planejamento</option>
              <option value="developing">Desenvolvimento</option>
              <option value="reviewing">Revisão / QA</option>
              <option value="teaching">Ensino / Tutoria</option>
            </select>
          </label>
          <label>
            Status:
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'active' | 'all' | 'inactive')}
            >
              <option value="all">Ativos e Inativos</option>
              <option value="active">Somente Ativos</option>
              <option value="inactive">Somente Inativos</option>
            </select>
          </label>
        </section>
      </div>

      {profilePreview && (
        <div className="agent-profile-preview">
          <p>Aplicar perfil alterará os modelos dos agentes ativos. Deseja continuar?</p>
          <div className="git-confirm-actions">
            <button type="button" onClick={() => applyProfile(profilePreview)}>
              Confirmar
            </button>
            <button type="button" className="btn-quiet" onClick={() => setProfilePreview(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Formulário Integrado de Criação / Edição de Agente com Pré-visualização Animada */}
      {formOpen && (
        <form className="agent-creator-panel" onSubmit={handleSubmitForm}>
          <div className="agent-creator-head">
            <div>
              <h3>{editingAgentId ? `Editar Agente: ${name || editingAgentId}` : 'Novo Agente Personalizado'}</h3>
              <p>
                {editingIsBuiltin
                  ? 'Agente padrão do sistema — você pode personalizar nome, visual, modelo, especialização e instruções.'
                  : 'Configure a especialização, provedor CLI, instruções e aparência no escritório 2D.'}
              </p>
            </div>
            <button type="button" className="btn-quiet" onClick={() => setFormOpen(false)}>
              Fechar editor
            </button>
          </div>

          <div className="agent-creator-layout">
            {/* Coluna Esquerda: Campos de Configuração */}
            <div className="agent-creator-fields">
              <div className="agent-creator-row">
                <div className="agent-config-field">
                  <label htmlFor="creator-name">Nome do Agente *</label>
                  <input
                    id="creator-name"
                    placeholder="Ex.: Guardião de Segurança, Revisor SQL..."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    required
                  />
                </div>
                <div className="agent-config-field">
                  <label htmlFor="creator-role">Função / Cargo exibido *</label>
                  <input
                    id="creator-role"
                    placeholder="Ex.: Especialista em Segurança, Tech Lead..."
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    maxLength={80}
                    required
                  />
                </div>
                {!editingAgentId && (
                  <div className="agent-config-field">
                    <label htmlFor="creator-id">ID único (opcional)</label>
                    <input
                      id="creator-id"
                      placeholder="Auto-gerado pelo nome"
                      value={customId}
                      onChange={(e) => setCustomId(e.target.value)}
                      maxLength={40}
                    />
                  </div>
                )}
              </div>

              <div className="agent-config-field">
                <label htmlFor="creator-desc">Descrição da atuação</label>
                <input
                  id="creator-desc"
                  placeholder="Resumo do que este agente faz na equipe..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={240}
                />
              </div>

              <div className="agent-creator-row">
                <div className="agent-config-field">
                  <label htmlFor="creator-category">Categoria no Modo Equipe</label>
                  <select
                    id="creator-category"
                    value={roleCategory}
                    disabled={editingIsBuiltin}
                    onChange={(e) => {
                      const nextCat = e.target.value as RoleCategory
                      setRoleCategory(nextCat)
                      if (nextCat === 'planning') setSpecializationId('tech-lead')
                      else if (nextCat === 'developing') setSpecializationId('developer')
                      else if (nextCat === 'reviewing') setSpecializationId('qa-tester')
                      else if (nextCat === 'teaching') setSpecializationId('tutor')
                    }}
                  >
                    <option value="planning">Planejamento (Etapa 1 da Missão)</option>
                    <option value="developing">Desenvolvimento (Etapa 2 da Missão)</option>
                    <option value="reviewing">Revisão / QA (Etapa 3 da Missão)</option>
                    <option value="teaching">Ensino / Tutoria (Individual)</option>
                  </select>
                </div>

                <div className="agent-config-field">
                  <label htmlFor="creator-spec">Especialização (Base de Conhecimento)</label>
                  <select
                    id="creator-spec"
                    value={specializationId}
                    onChange={(e) => setSpecializationId(e.target.value as SpecializationId)}
                  >
                    {specList.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.name} ({sp.id})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedSpecInfo && (
                <div className="agent-spec-info-box">
                  <strong>Base de conhecimento ({selectedSpecInfo.id}):</strong> {selectedSpecInfo.description}
                  <span className="agent-spec-files">
                    Documentos: {selectedSpecInfo.availableDocs.join(', ')}
                  </span>
                </div>
              )}

              <div className="agent-creator-row">
                <div className="agent-config-field">
                  <label htmlFor="creator-provider">Provedor CLI</label>
                  <select
                    id="creator-provider"
                    value={provider}
                    onChange={(e) => {
                      const nextProv = e.target.value as ProviderId
                      setProvider(nextProv)
                      setModel(defaultModelForProvider(nextProv))
                      setReasoningEffort('default')
                    }}
                  >
                    <option value="antigravity">Antigravity CLI (agy)</option>
                    <option value="gemini">Gemini CLI</option>
                    <option value="codex">Codex CLI</option>
                  </select>
                </div>

                <div className="agent-config-field">
                  <label htmlFor="creator-model">Modelo</label>
                  <select
                    id="creator-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    {modelsForProvider(provider).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                    {!modelsForProvider(provider).some((m) => m.id === model) && (
                      <option value={model}>{model} (personalizado)</option>
                    )}
                  </select>
                </div>

                <div className="agent-config-field">
                  <label htmlFor="creator-effort">Esforço de raciocínio</label>
                  {provider === 'codex' || provider === 'antigravity' ? (
                    <select
                      id="creator-effort"
                      value={reasoningEffort}
                      onChange={(e) => setReasoningEffort(e.target.value as ReasoningEffort)}
                    >
                      {EFFORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="agent-effort-auto">Automático pelo Gemini CLI</span>
                  )}
                </div>
              </div>

              <div className="agent-config-field">
                <label htmlFor="creator-instructions">
                  Instruções personalizadas (injetadas no prompt do agente — {customInstructions.length}/4000)
                </label>
                <textarea
                  id="creator-instructions"
                  rows={3}
                  placeholder="Ex.: Priorize testes de regressão em rotas de autenticação, verifique SQL injection e mantenha zero dependências extras..."
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  maxLength={4000}
                />
              </div>

              {!editingIsBuiltin && (
                <label className="team-default-toggle">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  <span>Agente ativo (exibir personagem no escritório 2D e habilitar para equipes)</span>
                </label>
              )}
            </div>

            {/* Coluna Direita: Pré-visualização Animada do Personagem 2D + Seletor de Preset */}
            <div className="agent-creator-preview-col">
              <div className="agent-live-preview-box">
                <span className="preview-eyebrow">PRÉ-VISUALIZAÇÃO PIXEL ART 2D</span>
                <div className="preview-stage">
                  <AgentPortrait
                    agentId={editingAgentId ?? 'specialist'}
                    preset={avatarPreset}
                    fullBody
                    animMode={previewAnim}
                    className="portrait-fullbody"
                  />
                  <div className="preview-stage-meta">
                    <strong>{name.trim() || 'Novo Agente'}</strong>
                    <span>{role.trim() || CATEGORY_LABELS[roleCategory]}</span>
                    <span className="cc-spec-pill">
                      {specializationId} · {provider}
                    </span>
                  </div>
                </div>
                <div className="preview-anim-controls" role="group" aria-label="Modo de animação do personagem">
                  <button
                    type="button"
                    className={`btn-quiet btn-xs ${previewAnim === 'idle' ? 'anim-btn-active' : ''}`}
                    onClick={() => setPreviewAnim('idle')}
                  >
                    Parado (Idle)
                  </button>
                  <button
                    type="button"
                    className={`btn-quiet btn-xs ${previewAnim === 'walk' ? 'anim-btn-active' : ''}`}
                    onClick={() => setPreviewAnim('walk')}
                  >
                    Caminhando
                  </button>
                  <button
                    type="button"
                    className={`btn-quiet btn-xs ${previewAnim === 'work' ? 'anim-btn-active' : ''}`}
                    onClick={() => setPreviewAnim('work')}
                  >
                    Trabalhando
                  </button>
                </div>
              </div>

              <div className="agent-preset-picker">
                <label>Aparência / Sprite do Personagem:</label>
                <div className="agent-preset-grid">
                  {AVATAR_PRESET_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`preset-option-btn ${avatarPreset === opt.id ? 'preset-selected' : ''}`}
                      onClick={() => setAvatarPreset(opt.id)}
                    >
                      <AgentPortrait agentId={opt.id} preset={opt.id} />
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="agent-creator-actions">
            <button type="submit" disabled={!online || !name.trim()}>
              {editingAgentId ? 'Salvar Alterações do Agente' : 'Criar Agente e Adicionar ao Escritório'}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setFormOpen(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Grid de Cards de Todos os Agentes (Padrão + Personalizados) */}
      <div className="agent-cards-grid">
        {filteredConfigs.map((cfg) => {
          const liveAgent = agents.find((a) => a.id === cfg.agentId)
          const isAct = cfg.active !== false
          const cat = cfg.roleCategory ?? 'developing'
          const isGemini = cfg.provider === 'gemini'
          const isCodex = cfg.provider === 'codex'
          const isAntigravity = cfg.provider === 'antigravity'
          const isDiagOpen = Boolean(diagOpenIds[cfg.agentId])
          const cliCommand =
            cfg.provider === 'codex' ? 'codex' : cfg.provider === 'antigravity' ? 'agy' : 'gemini'

          return (
            <div
              key={cfg.agentId}
              className={`agent-config-card ${!isAct ? 'agent-card-inactive' : ''}`}
            >
              <div className="agent-card-top">
                <AgentPortrait
                  agentId={cfg.agentId}
                  preset={cfg.avatarPreset}
                  dimmed={!isAct || liveAgent?.state === 'offline'}
                />
                <div className="agent-card-title-col">
                  <div className="agent-card-header">
                    <strong>{cfg.name ?? cfg.agentId}</strong>
                    {liveAgent ? (
                      <span className={`lamp lamp-${liveAgent.checking ? 'checking' : liveAgent.state}`}>
                        {liveAgent.checking ? 'Verificando…' : liveAgent.state}
                      </span>
                    ) : (
                      <span className="lamp lamp-offline">Inativo</span>
                    )}
                  </div>
                  <span className="agent-card-role">{cfg.role}</span>
                  <div className="agent-card-badges">
                    <span className={`agent-badge ${cfg.isBuiltin ? 'badge-builtin' : 'badge-custom'}`}>
                      {cfg.isBuiltin ? 'Padrão' : 'Personalizado'}
                    </span>
                    <span className="agent-badge">{CATEGORY_LABELS[cat]}</span>
                    <span className="agent-badge">Spec: {cfg.specializationId ?? 'developer'}</span>
                  </div>
                </div>
              </div>

              {cfg.description && <p className="agent-card-desc">{cfg.description}</p>}

              <div className="agent-config-field">
                <label htmlFor={`provider-${cfg.agentId}`}>Provedor:</label>
                <select
                  id={`provider-${cfg.agentId}`}
                  value={cfg.provider}
                  disabled={!online}
                  onChange={(e) => {
                    const nextProvider = e.target.value as ProviderId
                    handleConfigChange(cfg.agentId, {
                      provider: nextProvider,
                      model: defaultModelForProvider(nextProvider),
                      reasoningEffort: 'default',
                    })
                  }}
                >
                  <option value="antigravity">Antigravity CLI (agy)</option>
                  <option value="gemini">Gemini CLI</option>
                  <option value="codex">Codex CLI</option>
                </select>
              </div>

              <div className="agent-config-field">
                <label htmlFor={`model-${cfg.agentId}`}>Modelo:</label>
                {isGemini && (
                  <select
                    id={`model-${cfg.agentId}`}
                    value={cfg.model}
                    disabled={!online}
                    onChange={(e) =>
                      handleConfigChange(cfg.agentId, {
                        provider: cfg.provider,
                        model: e.target.value,
                        reasoningEffort: cfg.reasoningEffort,
                      })
                    }
                  >
                    {GEMINI_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                    {!GEMINI_MODELS.some((m) => m.id === cfg.model) && (
                      <option value={cfg.model}>{cfg.model} (personalizado)</option>
                    )}
                  </select>
                )}

                {isCodex && (
                  <select
                    id={`model-${cfg.agentId}`}
                    value={cfg.model}
                    disabled={!online}
                    onChange={(e) =>
                      handleConfigChange(cfg.agentId, {
                        provider: cfg.provider,
                        model: e.target.value,
                        reasoningEffort: cfg.reasoningEffort,
                      })
                    }
                  >
                    {CODEX_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                    {!CODEX_MODELS.some((m) => m.id === cfg.model) && (
                      <option value={cfg.model}>{cfg.model} (personalizado)</option>
                    )}
                  </select>
                )}

                {isAntigravity && (
                  <select
                    id={`model-${cfg.agentId}`}
                    value={cfg.model}
                    disabled={!online}
                    onChange={(e) =>
                      handleConfigChange(cfg.agentId, {
                        provider: cfg.provider,
                        model: e.target.value,
                        reasoningEffort: cfg.reasoningEffort,
                      })
                    }
                  >
                    {ANTIGRAVITY_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                    {!ANTIGRAVITY_MODELS.some((m) => m.id === cfg.model) && (
                      <option value={cfg.model}>{cfg.model} (personalizado)</option>
                    )}
                  </select>
                )}
              </div>

              <div className="agent-config-field">
                <label htmlFor={`effort-${cfg.agentId}`}>Esforço de raciocínio:</label>
                {isCodex || isAntigravity ? (
                  <select
                    id={`effort-${cfg.agentId}`}
                    value={cfg.reasoningEffort}
                    disabled={!online}
                    onChange={(e) =>
                      handleConfigChange(cfg.agentId, {
                        provider: cfg.provider,
                        model: cfg.model,
                        reasoningEffort: e.target.value as ReasoningEffort,
                      })
                    }
                  >
                    {EFFORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="agent-effort-auto">Esforço gerenciado automaticamente pelo modelo.</span>
                )}
              </div>

              {/* Complemento 2 — Painel de Diagnóstico do Agente ("Verificar agente") */}
              {isDiagOpen && (
                <div className="agent-diagnostic-box" role="region" aria-label={`Diagnóstico de ${cfg.name}`}>
                  <div className="agent-diag-head">
                    <strong>Diagnóstico do Agente</strong>
                    <button
                      type="button"
                      className="btn-quiet btn-xs"
                      onClick={() => setDiagOpenIds((prev) => ({ ...prev, [cfg.agentId]: false }))}
                    >
                      Fechar
                    </button>
                  </div>
                  <ul className="agent-diag-list">
                    <li>
                      <span>Binário CLI ({cliCommand}):</span>{' '}
                      <strong className={liveAgent?.cliVersion ? 'diag-ok' : 'diag-warn'}>
                        {!cfg.active
                          ? 'Agente desativado'
                          : liveAgent?.checking
                            ? 'Verificando instalação...'
                            : liveAgent?.cliVersion
                              ? `Instalado (${liveAgent.cliVersion})`
                              : liveAgent?.state === 'offline'
                                ? `Não encontrado no PATH (${cliCommand})`
                                : 'Pronto'}
                      </strong>
                    </li>
                    <li>
                      <span>Provedor & Modelo:</span>{' '}
                      <strong>
                        {cfg.provider} · {cfg.model}
                      </strong>
                    </li>
                    <li>
                      <span>Autenticação CLI:</span>{' '}
                      <strong
                        className={
                          liveAgent?.auth === 'ok'
                            ? 'diag-ok'
                            : liveAgent?.auth === 'missing'
                              ? 'diag-warn'
                              : ''
                        }
                      >
                        {liveAgent?.auth === 'ok'
                          ? 'Credencial / sessão detectada'
                          : liveAgent?.auth === 'missing'
                            ? 'Credencial de ambiente ausente (verifique login no CLI)'
                            : 'Verificação sob demanda'}
                      </strong>
                    </li>
                    <li>
                      <span>Sessão PTY no Escritório:</span>{' '}
                      <strong>{liveAgent?.session ? 'Ativa (terminal aberto)' : 'Nenhuma sessão aberta'}</strong>
                    </li>
                    <li>
                      <span>Base de Conhecimento:</span>{' '}
                      <strong>
                        {cfg.specializationId}
                        {cfg.customInstructions ? ` (+${cfg.customInstructions.length} chars custom)` : ''}
                      </strong>
                    </li>
                    <li>
                      <span>Disponibilidade p/ Missão:</span>{' '}
                      <strong
                        className={
                          isAct && liveAgent && liveAgent.state !== 'offline' ? 'diag-ok' : 'diag-warn'
                        }
                      >
                        {isAct && liveAgent && liveAgent.state !== 'offline'
                          ? `Apto para ${CATEGORY_LABELS[cat]}`
                          : !isAct
                            ? 'Inativo (ative o agente para usar em missões)'
                            : `Indisponível (instale ou autentique ${cliCommand})`}
                      </strong>
                    </li>
                  </ul>
                </div>
              )}

              <div className="agent-card-footer">
                <span className="agent-cli-version">
                  {liveAgent?.cliVersion
                    ? `${liveAgent.cli}: ${liveAgent.cliVersion}`
                    : `${cliCommand}: ${liveAgent?.state === 'offline' ? 'indisponível' : 'configurado'}`}
                </span>
                <div className="agent-card-actions">
                  <button
                    type="button"
                    className="btn-quiet btn-xs"
                    disabled={liveAgent?.checking || !online}
                    onClick={() => handleDiagnoseAgent(cfg.agentId, isAct)}
                  >
                    Verificar agente
                  </button>
                  <button
                    type="button"
                    className="btn-quiet btn-xs"
                    disabled={!online}
                    onClick={() => openEditForm(cfg)}
                  >
                    Editar
                  </button>
                  {!cfg.isBuiltin && (
                    <button
                      type="button"
                      className="btn-quiet btn-xs"
                      disabled={!online}
                      onClick={() => handleToggleActive(cfg)}
                    >
                      {isAct ? 'Desativar' : 'Ativar'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
