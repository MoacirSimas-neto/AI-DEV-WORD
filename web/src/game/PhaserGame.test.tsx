import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agent } from '../test/fakeServer.ts'
import { WorldBridge } from './WorldBridge.ts'

// WebGL não existe em jsdom: o Phaser é trocado por um jogo falso que repete o que o
// Game.start() real faz com o document/window (VisibilityHandler do Phaser 3.90).
const games: FakeGame[] = []
class FakeGame {
  config: { parent: HTMLElement; callbacks?: { postBoot?: (g: unknown) => void }; scene: { bridge: WorldBridge } }
  destroyed = false
  canvas = document.createElement('canvas')
  constructor(config: FakeGame['config']) {
    this.config = config
    games.push(this)
    config.parent.appendChild(this.canvas)
    queueMicrotask(() => {
      config.callbacks?.postBoot?.(this)
      document.addEventListener('visibilitychange', () => {}, false)
      window.onblur = () => {}
      window.onfocus = () => {}
    })
  }
  destroy(removeCanvas: boolean) {
    this.destroyed = true
    if (removeCanvas) this.canvas.remove()
  }
}
vi.mock('phaser', () => ({ default: { Game: FakeGame, AUTO: 0, Scale: { FIT: 3, CENTER_BOTH: 1 } } }))
vi.mock('./OfficeScene.ts', () => ({
  OfficeScene: class {
    bridge: WorldBridge
    constructor(bridge: WorldBridge) {
      this.bridge = bridge
    }
  },
}))

const { PhaserGame } = await import('./PhaserGame.tsx')

let added: string[] = []
let removed: string[] = []
beforeEach(() => {
  games.length = 0
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load: () => Promise.resolve([]) } })
  added = []
  removed = []
  const add = document.addEventListener.bind(document)
  const remove = document.removeEventListener.bind(document)
  vi.spyOn(document, 'addEventListener').mockImplementation((type, fn, opt) => {
    added.push(type)
    add(type, fn, opt)
  })
  vi.spyOn(document, 'removeEventListener').mockImplementation((type, fn, opt) => {
    removed.push(type)
    remove(type, fn, opt)
  })
})

afterEach(() => vi.restoreAllMocks())

const booted = () => waitFor(() => expect(added).toContain('visibilitychange'))

describe('PhaserGame (adaptador React ↔ Phaser)', () => {
  it('cria um único jogo e repassa as props à cena pela WorldBridge', async () => {
    const onSelect = vi.fn()
    const view = render(<PhaserGame agents={[agent('dev')]} selectedId={null} onSelect={onSelect} team={['dev']} />)
    await booted()
    expect(games).toHaveLength(1)
    const bridge = games[0].config.scene.bridge
    expect(bridge.agents.map((a) => a.id)).toEqual(['dev'])
    expect(bridge.team).toEqual(['dev'])

    const seen = vi.fn()
    bridge.on('selected', seen)
    view.rerender(<PhaserGame agents={[agent('dev')]} selectedId="dev" onSelect={onSelect} team={['dev']} />)
    expect(seen).toHaveBeenCalledWith('dev')
    // Clique na cena chega ao React.
    bridge.emit('select', 'qa')
    expect(onSelect).toHaveBeenCalledWith('qa')
    // Re-render não recria o jogo.
    expect(games).toHaveLength(1)
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1)
  })

  it('desmontar destrói o jogo, remove o canvas e o ouvinte global que o Phaser deixava', async () => {
    const view = render(<PhaserGame agents={[]} selectedId={null} onSelect={() => {}} />)
    await booted()
    const bridge = games[0].config.scene.bridge
    view.unmount()
    expect(games[0].destroyed).toBe(true)
    expect(document.querySelectorAll('canvas')).toHaveLength(0)
    expect(removed).toContain('visibilitychange')
    expect(window.onblur).toBeNull()
    expect(window.onfocus).toBeNull()
    expect(bridge.listenerCount('select')).toBe(0)
  })

  it('montar e desmontar várias vezes não acumula ouvintes nem canvases', async () => {
    for (let i = 0; i < 5; i++) {
      const view = render(<PhaserGame agents={[]} selectedId={null} onSelect={() => {}} />)
      await waitFor(() => expect(added.filter((t) => t === 'visibilitychange')).toHaveLength(i + 1))
      view.unmount()
    }
    expect(removed.filter((t) => t === 'visibilitychange')).toHaveLength(5)
    expect(document.querySelectorAll('canvas')).toHaveLength(0)
  })

  it('desmontar antes das fontes carregarem não cria jogo nenhum', async () => {
    let resolveFonts!: () => void
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: () => new Promise<void>((r) => (resolveFonts = r)) } })
    const view = render(<PhaserGame agents={[]} selectedId={null} onSelect={() => {}} />)
    view.unmount()
    resolveFonts()
    await new Promise((r) => setTimeout(r, 10))
    expect(games).toHaveLength(0)
  })
})

describe('WorldBridge', () => {
  it('entrega eventos com contexto e off remove só o par certo', () => {
    const bridge = new WorldBridge()
    const a = { calls: 0, on(this: { calls: number }) { this.calls++ } }
    const b = { calls: 0 }
    bridge.on('agents', a.on, a)
    bridge.on('agents', a.on, b)
    bridge.setAgents([])
    expect([a.calls, b.calls]).toEqual([1, 1])
    bridge.off('agents', a.on, a)
    bridge.setAgents([])
    expect([a.calls, b.calls]).toEqual([1, 2])
    bridge.removeAllListeners()
    expect(bridge.emit('agents', [])).toBe(false)
  })

  it('guarda o último estado para a cena ler ao iniciar', () => {
    const bridge = new WorldBridge()
    bridge.setSelected('dev')
    bridge.setTeam(['dev', 'qa'])
    bridge.setSpecialistPage(2)
    expect([bridge.selectedId, bridge.team, bridge.specialistPage]).toEqual(['dev', ['dev', 'qa'], 2])
    const pulse = vi.fn()
    bridge.on('forward', pulse)
    bridge.pulse('dev', 'qa')
    expect(pulse).toHaveBeenCalledWith('dev', 'qa')
  })
})
