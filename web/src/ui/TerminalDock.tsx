import { useEffect, useState } from 'react'
import type { ClientMessage, ServerMessage } from '../../../shared/protocol.ts'
import { TerminalView } from './TerminalView.tsx'

interface TerminalDockProps {
  activeProjectPath: string | null
  online: boolean
  send: (msg: ClientMessage) => void
  subscribe: (fn: (msg: ServerMessage) => void) => () => void
  onOpenFolderDialog: () => void
}

interface TabItem {
  id: string
  label: string
  closable: boolean
}

export function TerminalDock({
  activeProjectPath,
  online,
  send,
  subscribe,
  onOpenFolderDialog,
}: TerminalDockProps) {
  const [open, setOpen] = useState(false)
  const [heightPx, setHeightPx] = useState(240)
  const [tabs, setTabs] = useState<TabItem[]>([
    { id: 'user:1', label: 'Meu Terminal', closable: false },
  ])
  const [activeTabId, setActiveTabId] = useState('user:1')
  const [nextUserIndex, setNextUserIndex] = useState(2)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        const tag = (e.target as HTMLElement | null)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const addPersonalTab = () => {
    const id = `user:${nextUserIndex}`
    setNextUserIndex((n) => n + 1)
    setTabs((prev) => [...prev, { id, label: `Terminal ${nextUserIndex}`, closable: true }])
    setActiveTabId(id)
    setOpen(true)
  }

  const closeTab = (id: string) => {
    send({ type: 'term-close', agentId: id })
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (activeTabId === id && next.length > 0) setActiveTabId(next[0].id)
      return next
    })
  }

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = heightPx
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY
      setHeightPx(Math.max(160, Math.min(window.innerHeight * 0.65, startH + delta)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <section
      aria-label="Terminal Integrado"
      style={{
        borderTop: '1px solid rgba(148, 163, 184, 0.25)',
        background: '#0b1120',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          onMouseDown={startResize}
          style={{ height: 5, cursor: 'ns-resize', background: 'rgba(56, 189, 248, 0.2)' }}
        />
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 10px',
          gap: 8,
          background: '#0f172a',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {tabs.map((tab) => (
            <div key={tab.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button
                type="button"
                onClick={() => {
                  setActiveTabId(tab.id)
                  setOpen(true)
                }}
                style={{
                  fontWeight: activeTabId === tab.id ? 700 : 400,
                  opacity: activeTabId === tab.id ? 1 : 0.75,
                }}
              >
                {tab.label}
              </button>
              {tab.closable && (
                <button
                  type="button"
                  aria-label={`Fechar ${tab.label}`}
                  onClick={() => closeTab(tab.id)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addPersonalTab} aria-label="Nova aba de terminal">
            +
          </button>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)}>
          {open ? 'Recolher Terminal (Ctrl+J)' : 'Abrir Terminal (Ctrl+J)'}
        </button>
      </div>

      <div style={{ display: open ? 'block' : 'none', height: heightPx, overflow: 'hidden' }}>
        {!activeProjectPath ? (
          <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>Selecione um projeto para abrir o terminal na pasta do workspace.</span>
            <button type="button" className="primary" onClick={onOpenFolderDialog}>
              Selecionar pasta...
            </button>
          </div>
        ) : (
          tabs.map((tab) => (
            <div
              key={tab.id}
              style={{ display: activeTabId === tab.id ? 'block' : 'none', height: '100%' }}
            >
              <TerminalView
                agentId={tab.id}
                cliName="Shell"
                sessionActive={true}
                canStart={Boolean(activeProjectPath)}
                online={online}
                send={send}
                subscribe={subscribe}
              />
            </div>
          ))
        )}
      </div>
    </section>
  )
}
