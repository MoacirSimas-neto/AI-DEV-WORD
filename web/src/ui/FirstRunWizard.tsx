import { useCallback, useEffect, useState } from 'react'

export type FirstRunState = {
  completed: boolean
  lastStep: number
}

const STORAGE_KEY = 'aidw.firstRun.v1'

export function loadFirstRunState(): FirstRunState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { completed: false, lastStep: 0 }
    const parsed = JSON.parse(raw) as Partial<FirstRunState>
    return {
      completed: Boolean(parsed.completed),
      lastStep: typeof parsed.lastStep === 'number' ? parsed.lastStep : 0,
    }
  } catch {
    return { completed: false, lastStep: 0 }
  }
}

export function saveFirstRunState(state: FirstRunState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore storage errors
  }
}

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
  authToken: string | null
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
  authToken,
  projects,
  activeProjectId,
  onSelectProject,
  onOpenFolderDialog,
  onComplete,
  onDismiss,
}: FirstRunWizardProps) {
  const [step, setStep] = useState(initialStep)
  const [tools, setTools] = useState<ToolDiagnosticItem[]>([])
  const [loading, setLoading] = useState(false)
  const [diagError, setDiagError] = useState<string | null>(null)

  useEffect(() => {
    if (open) setStep(initialStep)
  }, [open, initialStep])

  const runCheck = useCallback(async () => {
    setLoading(true)
    setDiagError(null)
    try {
      const headers: Record<string, string> = {}
      if (authToken) headers.Authorization = `Bearer ${authToken}`
      const res = await fetch('/api/diagnostics', { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { tools?: ToolDiagnosticItem[] }
      setTools(Array.isArray(data.tools) ? data.tools : [])
    } catch {
      setDiagError('Não foi possível verificar as ferramentas locais agora.')
    } finally {
      setLoading(false)
    }
  }, [authToken])

  useEffect(() => {
    if (open && step === 1 && tools.length === 0 && !loading) {
      void runCheck()
    }
  }, [open, step, tools.length, loading, runCheck])

  if (!open) return null

  const goTo = (next: number) => {
    setStep(next)
    saveFirstRunState({ completed: false, lastStep: next })
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Assistente de Primeira Execução">
      <div className="modal-card" style={{ maxWidth: 560, width: '92vw' }}>
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
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0', display: 'grid', gap: 8 }}>
              {tools.map((tool) => (
                <li
                  key={tool.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
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
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{STATUS_LABELS[tool.status]}</span>
                </li>
              ))}
            </ul>
            <div className="modal-actions" style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 16 }}>
              <button type="button" onClick={() => void runCheck()} disabled={loading}>
                Reverificar
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => goTo(0)}>
                  Voltar
                </button>
                <button type="button" className="primary" onClick={() => goTo(2)}>
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
