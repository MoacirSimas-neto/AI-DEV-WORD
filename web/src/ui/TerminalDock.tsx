import { useEffect, useState } from 'react'
import type { AgentInfo } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from '../net/useServer.ts'
import { TerminalView } from './TerminalView.tsx'

interface TerminalDockProps {
  activeProjectPath: string | null
  online: boolean
  /** Terminais pessoais vivos no backend (`user:<n>`). */
  shellIds: string[]
  agents: AgentInfo[]
  /** Fora do escritório o dock some da tela, mas continua montado: as abas e sessões ficam. */
  hidden?: boolean
  send: Send
  subscribe: Subscribe
  onOpenFolderDialog: () => void
}

const MAIN = 'user:1'
const MIN_HEIGHT = 140
/** Espaço mínimo que sobra para a barra superior e o escritório. */
const OFFICE_RESERVE = 260
const shellNumber = (id: string) => Number(id.slice(5))
const shellLabel = (id: string) => (id === MAIN ? 'Meu Terminal' : `Terminal ${shellNumber(id)}`)

export function TerminalDock({ activeProjectPath, online, shellIds, agents, hidden = false, send, subscribe, onOpenFolderDialog }: TerminalDockProps) {
  const [open, setOpen] = useState(false)
  const [heightPx, setHeightPx] = useState(() => Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.3)))
  const [created, setCreated] = useState<string[]>([MAIN])
  const [activeId, setActiveId] = useState(MAIN)
  // Só monta (e portanto só inicia) o terminal de uma aba que o usuário realmente abriu.
  const [seen, setSeen] = useState<string[]>([])

  // As abas pessoais são as criadas aqui mais as que já vivem no backend (página recarregada).
  const shells = [...new Set([...created, ...shellIds])].sort((a, b) => shellNumber(a) - shellNumber(b))
  // Abas de agente só existem enquanto houver sessão real no backend: nada é criado para exibir.
  const agentTabs = agents.filter((a) => a.session)
  const current = shells.includes(activeId) || agentTabs.some((a) => a.id === activeId) ? activeId : MAIN

  const show = (id: string) => {
    setActiveId(id)
    setOpen(true)
    setSeen((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }
  const toggle = () => (open ? setOpen(false) : show(current))

  useEffect(() => {
    if (hidden) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'j') return
      const target = e.target instanceof Element ? e.target : null
      // Campos de texto do app ficam com a tecla; dentro do próprio terminal o atalho recolhe o dock.
      const typing = target?.closest('input, textarea, [contenteditable="true"]') && !target.closest('.terminal-dock')
      if (typing) return
      e.preventDefault()
      e.stopPropagation() // captura: o xterm não chega a mandar a tecla para o shell
      toggle()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  })

  const addShell = () => {
    const id = `user:${Math.max(...shells.map(shellNumber)) + 1}`
    setCreated((prev) => [...prev, id])
    show(id)
  }

  const closeShell = (id: string) => {
    send({ type: 'term-close', agentId: id })
    setCreated((prev) => prev.filter((t) => t !== id))
    setSeen((prev) => prev.filter((t) => t !== id))
  }

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = heightPx
    const onMove = (ev: MouseEvent) =>
      setHeightPx(Math.max(MIN_HEIGHT, Math.min(window.innerHeight - OFFICE_RESERVE, startH + startY - ev.clientY)))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const tab = (id: string, label: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={current === id}
      className={`terminal-dock-tab${current === id ? ' active' : ''}`}
      onClick={() => show(id)}
    >
      {label}
    </button>
  )

  const pane = (id: string, cliName: string, sessionActive: boolean, isShell: boolean) =>
    seen.includes(id) && (
      <div key={id} style={{ display: current === id ? 'block' : 'none', height: '100%' }}>
        <TerminalView
          agentId={id}
          cliName={cliName}
          sessionActive={sessionActive}
          canStart={online && isShell && !!activeProjectPath}
          autoStart={isShell}
          online={online}
          send={send}
          subscribe={subscribe}
        />
      </div>
    )

  return (
    <section className="terminal-dock" aria-label="Terminal Integrado" style={hidden ? { display: 'none' } : undefined}>
      {open && <div role="separator" aria-orientation="horizontal" className="terminal-dock-resize" onMouseDown={startResize} />}
      <div className="terminal-dock-bar">
        <div className="terminal-dock-tabs" role="tablist">
          {shells.map((id) => (
            <span key={id} className="terminal-dock-tabwrap">
              {tab(id, shellLabel(id))}
              {id !== MAIN && (
                <button type="button" className="terminal-dock-x" aria-label={`Fechar ${shellLabel(id)}`} onClick={() => closeShell(id)}>
                  ×
                </button>
              )}
            </span>
          ))}
          <button type="button" className="terminal-dock-x" onClick={addShell} aria-label="Nova aba de terminal">
            +
          </button>
          {agentTabs.map((a) => tab(a.id, a.name))}
        </div>
        <button type="button" className="terminal-dock-tab" onClick={toggle}>
          {open ? 'Recolher Terminal (Ctrl+J)' : 'Abrir Terminal (Ctrl+J)'}
        </button>
      </div>

      <div className="terminal-dock-body" style={{ display: open ? 'block' : 'none', height: heightPx }}>
        {!activeProjectPath && shellIds.length === 0 && agentTabs.length === 0 ? (
          <div className="terminal-dock-empty">
            <span>Selecione um projeto para abrir o terminal na pasta do workspace.</span>
            <button type="button" className="primary" onClick={onOpenFolderDialog}>
              Selecionar pasta...
            </button>
          </div>
        ) : (
          <>
            {shells.map((id) => pane(id, 'Shell', shellIds.includes(id), true))}
            {agentTabs.map((a) => pane(a.id, a.cli, true, false))}
          </>
        )}
      </div>
    </section>
  )
}
