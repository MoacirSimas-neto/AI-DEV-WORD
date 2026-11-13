import { useState } from 'react'

interface CloseConfirmModalProps {
  open: boolean
  activeMissionsCount: number
  /** Terminais (pessoais e de agentes) com processo vivo no backend. */
  activeTerminalsCount?: number
  onMinimize: (remember: boolean) => void
  onQuit: (remember: boolean) => void
  onCancel: () => void
}

export function CloseConfirmModal({
  open,
  activeMissionsCount,
  activeTerminalsCount = 0,
  onMinimize,
  onQuit,
  onCancel,
}: CloseConfirmModalProps) {
  const [remember, setRemember] = useState(false)
  const [confirmingQuit, setConfirmingQuit] = useState(false)

  if (!open) return null

  const handleQuitClick = () => {
    if (activeMissionsCount + activeTerminalsCount > 0 && !confirmingQuit) {
      setConfirmingQuit(true)
      return
    }
    setConfirmingQuit(false)
    onQuit(remember)
  }

  const handleCancel = () => {
    setConfirmingQuit(false)
    onCancel()
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-dialog-title"
      style={{ zIndex: 1200 }}
    >
      <div className="modal-card" style={{ maxWidth: 460 }}>
        <h2 id="close-dialog-title" style={{ margin: '0 0 8px', fontSize: '1.15rem' }}>
          Fechar AI Dev World
        </h2>
        <p style={{ margin: '0 0 14px', opacity: 0.85, fontSize: '0.92rem' }}>
          Como você deseja sair? Seus agentes podem continuar trabalhando em segundo plano.
        </p>

        {activeMissionsCount > 0 && (
          <div
            className="banner"
            style={{
              marginBottom: 14,
              background: '#f59e0b22',
              borderColor: '#f59e0b',
              fontSize: '0.88rem',
            }}
          >
            {confirmingQuit
              ? `Confirma encerrar completamente? ${activeMissionsCount} missão(ões) ativa(s) serão interrompidas.`
              : `Há ${activeMissionsCount} missão(ões) ativa(s) em andamento.`}
          </div>
        )}

        {activeTerminalsCount > 0 && (
          <div className="banner" style={{ marginBottom: 14, background: '#f59e0b22', borderColor: '#f59e0b', fontSize: '0.88rem' }}>
            {confirmingQuit
              ? `Confirma encerrar completamente? ${activeTerminalsCount} terminal(is) aberto(s) e seus processos serão encerrados.`
              : `Há ${activeTerminalsCount} terminal(is) aberto(s): encerrar o aplicativo encerra os processos deles.`}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onMinimize(remember)}
            style={{ textAlign: 'left', padding: '10px 12px' }}
          >
            <div style={{ fontWeight: 600 }}>Minimizar para a bandeja</div>
            <div style={{ fontSize: '0.8rem', opacity: 0.85 }}>
              Oculta a janela e mantém os agentes e o backend funcionando.
            </div>
          </button>

          <button
            type="button"
            className="btn-danger"
            onClick={handleQuitClick}
            style={{ textAlign: 'left', padding: '10px 12px' }}
          >
            <div style={{ fontWeight: 600 }}>
              {confirmingQuit ? 'Confirmar encerramento completo' : 'Encerrar completamente'}
            </div>
            <div style={{ fontSize: '0.8rem', opacity: 0.85 }}>
              Encerra o aplicativo e interrompe as atividades de forma controlada.
            </div>
          </button>

          <button
            type="button"
            className="btn-ghost"
            onClick={handleCancel}
            style={{ textAlign: 'left', padding: '10px 12px' }}
          >
            <div style={{ fontWeight: 600 }}>Cancelar</div>
            <div style={{ fontSize: '0.8rem', opacity: 0.75 }}>Volta ao aplicativo.</div>
          </button>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.86rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>Lembrar minha escolha e não perguntar novamente.</span>
        </label>
      </div>
    </div>
  )
}
