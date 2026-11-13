import { fireEvent, render } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { TerminalView } from './TerminalView.tsx'

// xterm falso: guarda o callback de redimensionamento para o teste disparar.
const terms: { cols: number; rows: number; resize: (cols: number, rows: number) => void }[] = []
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    private onSize: (size: { cols: number; rows: number }) => void = () => {}
    constructor() {
      terms.push(this as never)
    }
    loadAddon() {}
    open() {}
    onData() {}
    onResize(cb: (size: { cols: number; rows: number }) => void) {
      this.onSize = cb
    }
    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
      this.onSize({ cols, rows })
    }
    reset() {}
    write() {}
    focus() {}
    dispose() {}
  },
}))

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as never
})

describe('TerminalView: sessão de agente em dois painéis (Etapa 14.6.1)', () => {
  it('só o último painel aberto ou focado redimensiona o PTY; o outro não disputa', () => {
    const send = vi.fn()
    const view = (agentId = 'dev') => (
      <TerminalView agentId={agentId} cliName="codex" sessionActive canStart={false} online send={send} subscribe={() => () => {}} />
    )
    const lateral = render(view())
    const dock = render(view())
    const [a, b] = terms.slice(-2)
    const resizes = () => send.mock.calls.map(([m]) => m).filter((m) => m.type === 'term-resize')

    a.resize(100, 30) // painel antigo: ignorado
    expect(resizes()).toEqual([])
    b.resize(120, 20) // último aberto: é o dono
    expect(resizes()).toEqual([{ type: 'term-resize', agentId: 'dev', cols: 120, rows: 20 }])

    // Foco no painel antigo: ele assume e manda o próprio tamanho; o outro para de mandar.
    fireEvent.focusIn(lateral.container.querySelector('.term-host')!)
    expect(resizes().at(-1)).toEqual({ type: 'term-resize', agentId: 'dev', cols: 100, rows: 30 })
    b.resize(90, 10)
    expect(resizes()).toHaveLength(2)

    // O dono sai da tela: o painel que ficou volta a mandar.
    lateral.unmount()
    b.resize(91, 11)
    expect(resizes().at(-1)).toEqual({ type: 'term-resize', agentId: 'dev', cols: 91, rows: 11 })
    dock.unmount()
  })

  it('sessões diferentes não interferem: cada terminal redimensiona o seu PTY', () => {
    const send = vi.fn()
    const view = (agentId: string) => (
      <TerminalView agentId={agentId} cliName="Shell" sessionActive canStart={false} online send={send} subscribe={() => () => {}} />
    )
    render(view('user:1'))
    render(view('user:2'))
    const [a, b] = terms.slice(-2)
    a.resize(70, 20)
    b.resize(60, 15)
    expect(send).toHaveBeenCalledWith({ type: 'term-resize', agentId: 'user:1', cols: 70, rows: 20 })
    expect(send).toHaveBeenCalledWith({ type: 'term-resize', agentId: 'user:2', cols: 60, rows: 15 })
  })
})
