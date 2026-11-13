import { useCallback, useEffect, useState } from 'react'
import { saveFirstRunState } from './firstRunState.ts'

export interface ToolDiagnosticItem {
  id: string
  name: string
  purpose: string
  relevance: 'essential' | 'optional'
  status: 'ready' | 'not_installed' | 'needs_config' | 'needs_auth' | 'incompatible' | 'unavailable' | 'error'
  executablePath: string | null
  version: string | null
  authNote: string
}

export interface ToolCatalogItem {
  id: string
  name: string
  vendor: string
  originUrl: string
  installMethod: 'winget' | 'npm' | 'manual'
  packageRef: string
  requiresInternet: boolean
  requiresAdmin: boolean
  requiresGlobalNode: boolean
  systemChanges: string
  accountNote: string
  authHint: string
}

const STATUS_LABELS: Record<ToolDiagnosticItem['status'], string> = {
  ready: 'Pronto',
  not_installed: 'Não instalado',
  needs_config: 'Requer configuração',
  needs_auth: 'Requer autenticação',
  incompatible: 'Incompatível',
  unavailable: 'Indisponível',
  error: 'Erro',
}

interface FirstRunWizardProps {
  open: boolean
  initialStep?: number
  onFetchDiagnostics: () => Promise<Response>
  onFetchSetupCatalog: () => Promise<Response>
  onRequestConsent: (toolId: string) => Promise<Response>
  onInstallTool: (toolId: string, consentNonce: string) => Promise<Response>
  projects: Array<{ id: number; name: string; path: string }>
  activeProjectId: number | null
  onSelectProject: (id: number) => void
  onOpenFolderDialog: () => void
  onComplete: () => void
  onDismiss: (step: number) => void
}

export function FirstRunWizard({
  open,
  initialStep = 0,
  onFetchDiagnostics,
  onFetchSetupCatalog,
  onRequestConsent,
  onInstallTool,
  projects,
  activeProjectId,
  onSelectProject,
  onOpenFolderDialog,
  onComplete,
  onDismiss,
}: FirstRunWizardProps) {
  const [step, setStep] = useState(initialStep)
  const [tools, setTools] = useState<ToolDiagnosticItem[]>([])
  const [catalog, setCatalog] = useState<Record<string, ToolCatalogItem>>({})
  const [loading, setLoading] = useState(false)
  const [diagError, setDiagError] = useState<string | null>(null)
  const [confirmToolId, setConfirmToolId] = useState<string | null>(null)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [installFeedback, setInstallFeedback] = useState<string | null>(null)

  const runCheck = useCallback(async () => {
    setLoading(true)
    setDiagError(null)
    try {
      const [diagRes, catRes] = await Promise.all([onFetchDiagnostics(), onFetchSetupCatalog()])
      if (!diagRes.ok) throw new Error(`HTTP ${diagRes.status}`)
      const data = (await diagRes.json()) as { tools?: ToolDiagnosticItem[] }
      setTools(Array.isArray(data.tools) ? data.tools : [])
      if (catRes.ok) {
        const catData = (await catRes.json()) as { tools?: ToolCatalogItem[] }
        const map: Record<string, ToolCatalogItem> = {}
        for (const item of catData.tools ?? []) map[item.id] = item
        setCatalog(map)
      }
    } catch {
      setDiagError('Não foi possível verificar as ferramentas locais agora.')
    } finally {
      setLoading(false)
    }
  }, [onFetchDiagnostics, onFetchSetupCatalog])

  useEffect(() => {
    if (!open || step !== 1) return
    let cancelled = false
    Promise.all([onFetchDiagnostics(), onFetchSetupCatalog()])
      .then(async ([diagRes, catRes]) => {
        if (!diagRes.ok) throw new Error(`HTTP ${diagRes.status}`)
        const data = (await diagRes.json()) as { tools?: ToolDiagnosticItem[] }
        if (!cancelled) {
          setDiagError(null)
          setTools(Array.isArray(data.tools) ? data.tools : [])
        }
        if (catRes.ok) {
          const catData = (await catRes.json()) as { tools?: ToolCatalogItem[] }
          if (!cancelled) {
            const map: Record<string, ToolCatalogItem> = {}
            for (const item of catData.tools ?? []) map[item.id] = item
            setCatalog(map)
          }
        }
      })
      .catch(() => {
        if (!cancelled) setDiagError('Não foi possível verificar as ferramentas locais agora.')
      })
    return () => {
      cancelled = true
    }
  }, [open, step, onFetchDiagnostics, onFetchSetupCatalog])

  if (!open) return null

  const goTo = (next: number) => {
    setStep(next)
    setConfirmToolId(null)
    saveFirstRunState({ completed: false, lastStep: next })
  }

  const handleConfirmInstall = async (toolId: string) => {
    setInstallingId(toolId)
    setInstallFeedback(`Instalando ${catalog[toolId]?.name ?? toolId}...`)
    try {
      const consentRes = await onRequestConsent(toolId)
      if (!consentRes.ok) {
        setInstallFeedback('Não foi possível obter autorização para instalar.')
        return
      }
      const consent = (await consentRes.json()) as { nonce?: string }
      if (!consent.nonce) {
        setInstallFeedback('Autorização inválida.')
        return
      }
      const installRes = await onInstallTool(toolId, consent.nonce)
      const outcome = (await installRes.json()) as { status?: string; message?: string }
      setInstallFeedback(outcome.message ?? (installRes.ok ? 'Operação concluída.' : 'Falha na instalação.'))
      setConfirmToolId(null)
      await runCheck()
    } catch {
      setInstallFeedback('Erro de comunicação durante a instalação.')
    } finally {
      setInstallingId(null)
    }
  }

  const confirmSpec = confirmToolId ? catalog[confirmToolId] : undefined

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Assistente de Primeira Execução">
      <div className="modal-card" style={{ maxWidth: 600, width: '92vw' }}>
        {step === 0 && (
          <div>
            <h2>Bem-vindo ao AI Dev World</h2>
            <p>Seu ambiente de desenvolvimento com agentes de IA trabalhando em equipe.</p>
            <p style={{ opacity: 0.85, fontSize: '0.9rem' }}>
              Você pode integrar ferramentas locais (Git e CLIs de IA) mantendo controle total sobre cada operação.
            </p>
            <div className="modal-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={() => onDismiss(0)}>
                Configurar depois
              </button>
              <button type="button" className="primary" onClick={() => goTo(1)}>
                Verificar ambiente
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2>Diagnóstico do Ambiente</h2>
            <p style={{ opacity: 0.85, fontSize: '0.9rem' }}>
              Verificação local de Git e CLIs opcionais. O AI Dev World funciona mesmo sem todas as ferramentas.
            </p>
            {loading && <p>Verificando ferramentas...</p>}
            {diagError && <p role="alert">{diagError}</p>}
            {installFeedback && <p role="status">{installFeedback}</p>}

            {confirmSpec && (
              <div
                role="region"
                aria-label={`Confirmar instalação de ${confirmSpec.name}`}
                style={{
                  padding: '10px 12px',
                  margin: '10px 0',
                  borderRadius: 8,
                  background: 'rgba(2, 132, 199, 0.14)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                }}
              >
                <strong>Confirmar instalação: {confirmSpec.name}</strong>
                <div style={{ fontSize: '0.82rem', marginTop: 4 }}>
                  <div>Fornecedor: {confirmSpec.vendor} · Método: {confirmSpec.installMethod} ({confirmSpec.packageRef})</div>
                  <div>Alterações: {confirmSpec.systemChanges}</div>
                  {confirmSpec.requiresGlobalNode && <div>Pré-requisito: Node.js/npm global instalado.</div>}
                  <div>{confirmSpec.accountNote}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                  <button type="button" onClick={() => setConfirmToolId(null)} disabled={installingId !== null}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={installingId !== null}
                    onClick={() => void handleConfirmInstall(confirmSpec.id)}
                  >
                    {installingId === confirmSpec.id ? 'Instalando...' : 'Confirmar instalação'}
                  </button>
                </div>
              </div>
            )}

            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0', display: 'grid', gap: 8 }}>
              {tools.map((tool) => {
                const spec = catalog[tool.id]
                return (
                  <li
                    key={tool.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: 'rgba(15, 23, 42, 0.55)',
                      border: '1px solid rgba(148, 163, 184, 0.2)',
                    }}
                  >
                    <div>
                      <strong>{tool.name}</strong>
                      <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>{tool.purpose}</div>
                      <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                        {tool.version ? `${tool.version} · ` : ''}
                        {tool.authNote}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{STATUS_LABELS[tool.status]}</span>
                      {tool.status === 'not_installed' && spec && (
                        <button
                          type="button"
                          disabled={installingId !== null}
                          onClick={() => setConfirmToolId(tool.id)}
                        >
                          Instalar...
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            <div className="modal-actions" style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 16 }}>
              <button type="button" onClick={() => void runCheck()} disabled={loading || installingId !== null}>
                Reverificar
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => goTo(0)} disabled={installingId !== null}>
                  Voltar
                </button>
                <button type="button" className="primary" onClick={() => goTo(2)} disabled={installingId !== null}>
                  Continuar
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2>Configuração Inicial</h2>
            <p style={{ opacity: 0.85, fontSize: '0.9rem' }}>
              Escolha um projeto para começar ou entre direto no escritório 2D.
            </p>
            <div style={{ display: 'grid', gap: 8, margin: '12px 0' }}>
              <button type="button" onClick={onOpenFolderDialog}>
                Selecionar pasta do computador...
              </button>
              {projects.length > 0 && (
                <select
                  aria-label="Projeto ativo"
                  value={activeProjectId ?? ''}
                  onChange={(e) => {
                    const id = Number(e.target.value)
                    if (id) onSelectProject(id)
                  }}
                >
                  <option value="">Sem projeto selecionado</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.path})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="modal-actions" style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 16 }}>
              <button type="button" onClick={() => goTo(1)}>
                Voltar
              </button>
              <button type="button" className="primary" onClick={onComplete}>
                Entrar no escritório
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
