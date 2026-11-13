import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import type { Send, Subscribe } from '../net/useServer.ts'

interface Props {
  agentId: string
  cliName: string
  /** Há uma sessão viva no backend para este agente. */
  sessionActive: boolean
  canStart: boolean
  /** Inicia a sessão uma única vez ao montar (terminal pessoal). Depois de encerrada, só pelo botão. */
  autoStart?: boolean
  online: boolean
  send: Send
  subscribe: Subscribe
}

// Um PTY tem um tamanho só. Com a mesma sessão em dois painéis (janela do agente e dock), só o
// último que abriu ou recebeu foco manda o tamanho; o outro não disputa.
const sizeOwner = new Map<string, object>()

/**
 * Terminal real do agente. O xterm só desenha: cada tecla vai para o backend
 * (term-input) e tudo que aparece na tela veio do processo (term-data).
 */
export function TerminalView({ agentId, cliName, sessionActive, canStart, autoStart = false, online, send, subscribe }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const attached = useRef(false)
  const autoStarted = useRef(false)
  const [me] = useState(() => ({}))

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#1d1626', foreground: '#f1e6d4', cursor: '#e8c27a' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current!)
    fit.fit()
    termRef.current = term

    term.onData((data) => send({ type: 'term-input', agentId, data }))
    term.onResize(({ cols, rows }) => {
      if (!sizeOwner.has(agentId)) sizeOwner.set(agentId, me) // o dono saiu da tela
      if (sizeOwner.get(agentId) === me) send({ type: 'term-resize', agentId, cols, rows })
    })
    const el = host.current!
    const claimSize = () => {
      if (sizeOwner.get(agentId) === me) return
      sizeOwner.set(agentId, me)
      send({ type: 'term-resize', agentId, cols: term.cols, rows: term.rows })
    }
    el.addEventListener('focusin', claimSize)

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
      el.removeEventListener('focusin', claimSize)
      if (sizeOwner.get(agentId) === me) sizeOwner.delete(agentId)
      unsubscribe()
      term.dispose()
      termRef.current = null
      attached.current = false
    }
  }, [agentId, send, subscribe, me])

  const open = () => {
    const term = termRef.current
    if (!term) return
    attached.current = true // já pedido: evita reenviar a cada renderização
    sizeOwner.set(agentId, me) // term-open leva o tamanho desta tela
    send({ type: 'term-open', agentId, cols: term.cols, rows: term.rows })
  }

  // Sessão já existente (página recarregada ou conexão refeita): reconecta sozinho.
  useEffect(() => {
    if (!online) attached.current = false
    else if (sessionActive && !attached.current) open()
    else if (autoStart && canStart && !autoStarted.current && !attached.current) {
      autoStarted.current = true
      open()
    }
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
