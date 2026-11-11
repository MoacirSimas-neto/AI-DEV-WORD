import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import type { Send, Subscribe } from '../net/useServer.ts'

interface Props {
  agentId: string
  cliName: string
  /** Há uma sessão viva no backend para este agente. */
  sessionActive: boolean
  canStart: boolean
  online: boolean
  send: Send
  subscribe: Subscribe
}

/**
 * Terminal real do agente. O xterm só desenha: cada tecla vai para o backend
 * (term-input) e tudo que aparece na tela veio do processo (term-data).
 */
export function TerminalView({ agentId, cliName, sessionActive, canStart, online, send, subscribe }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const attached = useRef(false)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#1f1924', foreground: '#f1e6d4', cursor: '#e8c27a' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current!)
    fit.fit()
    termRef.current = term

    term.onData((data) => send({ type: 'term-input', agentId, data }))
    term.onResize(({ cols, rows }) => send({ type: 'term-resize', agentId, cols, rows }))

    const unsubscribe = subscribe((message) => {
      if (!('agentId' in message) || message.agentId !== agentId) return
      if (message.type === 'term-ready') {
        term.reset()
        term.write(message.replay)
        term.focus()
      } else if (message.type === 'term-data') {
        term.write(message.data)
      } else if (message.type === 'term-exit') {
        attached.current = false
        term.write(`\r\n\x1b[33m[sessão encerrada · código ${message.code}]\x1b[0m\r\n`)
      } else if (message.type === 'term-error') {
        attached.current = false
        term.write(`\r\n\x1b[31m${message.message}\x1b[0m\r\n`)
      }
    })

    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(host.current!)

    return () => {
      observer.disconnect()
      unsubscribe()
      term.dispose()
      termRef.current = null
      attached.current = false
    }
  }, [agentId, send, subscribe])

  const open = () => {
    const term = termRef.current
    if (!term) return
    attached.current = true // já pedido: evita reenviar a cada renderização
    send({ type: 'term-open', agentId, cols: term.cols, rows: term.rows })
  }

  // Sessão já existente (página recarregada ou conexão refeita): reconecta sozinho.
  useEffect(() => {
    if (!online) attached.current = false
    else if (sessionActive && !attached.current) open()
  })

  return (
    <section className="term-panel">
      <div className="term-bar">
        <span>Terminal · {cliName}</span>
        {sessionActive ? (
          <button type="button" onClick={() => send({ type: 'term-close', agentId })}>
            Encerrar sessão
          </button>
        ) : (
          <button type="button" disabled={!canStart} onClick={open}>
            Iniciar sessão
          </button>
        )}
      </div>
      <div ref={host} className="term-host" />
    </section>
  )
}
