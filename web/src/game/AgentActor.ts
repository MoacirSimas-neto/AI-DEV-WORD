import Phaser from 'phaser'
import type { AgentInfo, AgentState } from '../../../shared/protocol.ts'
import { type Station, stationFor, WANDER_AREA } from './officeLayout.ts'
import { CHARACTER_FRAMES, characterPalette, makePixelTexture } from './pixelArt.ts'

const SCALE = 3
const WALK_SPEED = 90 // pixels por segundo
const BUBBLE_TEXT: Record<AgentState, string> = {
  idle: '',
  waiting: '?',
  working: '...',
  offline: 'zzz',
  error: '!',
}

/**
 * Um personagem no mundo. O comportamento é função do estado real do agente:
 * working -> digita na mesa; waiting -> parado na mesa esperando você;
 * idle -> passeia; offline -> dorme; error -> alerta.
 */
export class AgentActor {
  readonly id: string
  private readonly scene: Phaser.Scene
  private readonly root: Phaser.GameObjects.Container
  private readonly sprite: Phaser.GameObjects.Sprite
  private readonly ring: Phaser.GameObjects.Ellipse
  private readonly bubble: Phaser.GameObjects.Text
  private readonly walkKey: string
  private readonly station: Station
  private state: AgentState | null = null
  private walkTween?: Phaser.Tweens.Tween
  private typingTween?: Phaser.Tweens.Tween
  private wanderTimer?: Phaser.Time.TimerEvent

  constructor(scene: Phaser.Scene, agent: AgentInfo, onSelect: (id: string) => void) {
    this.scene = scene
    this.id = agent.id
    this.station = stationFor(agent.id)

    const stand = `${agent.id}-stand`
    const step = `${agent.id}-step`
    this.walkKey = `${agent.id}-walk`
    const palette = characterPalette(this.station.hair, this.station.shirt)
    makePixelTexture(scene, stand, CHARACTER_FRAMES.stand, palette)
    makePixelTexture(scene, step, CHARACTER_FRAMES.step, palette)
    if (!scene.anims.exists(this.walkKey)) {
      scene.anims.create({ key: this.walkKey, frames: [{ key: step }, { key: stand }], frameRate: 6, repeat: -1 })
    }

    this.ring = scene.add.ellipse(0, -2, 44, 14).setStrokeStyle(2, 0xfff3c4).setVisible(false)
    const shadow = scene.add.ellipse(0, -1, 34, 9, 0x000000, 0.2)
    this.sprite = scene.add.sprite(0, 0, stand).setOrigin(0.5, 1).setScale(SCALE)
    this.sprite.setInteractive({ useHandCursor: true })
    this.sprite.on('pointerdown', () => onSelect(agent.id))

    const label = scene.add
      .text(0, 4, agent.name, { fontFamily: 'monospace', fontSize: '12px', color: '#fff8e7' })
      .setOrigin(0.5, 0)
      .setStroke('#3a2a2e', 4)
    this.bubble = scene.add
      .text(0, -68, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#3a2a2e',
        backgroundColor: '#fff8e7',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5, 1)

    this.root = scene.add.container(this.station.rest.x, this.station.rest.y, [this.ring, shadow, this.sprite, label, this.bubble])
    this.root.setDepth(this.root.y)
    this.setState(agent.state)
  }

  setSelected(selected: boolean) {
    this.ring.setVisible(selected)
  }

  setState(state: AgentState) {
    if (state === this.state) return
    this.state = state
    this.stopActivity()

    this.bubble.setText(BUBBLE_TEXT[state]).setVisible(state !== 'idle')
    if (state === 'offline') this.sprite.setTint(0x8a8fa0)
    else this.sprite.clearTint()

    const { seat, rest } = this.station
    if (state === 'working') {
      this.walkTo(seat.x, seat.y, () => this.startTyping())
    } else if (state === 'waiting') {
      this.walkTo(seat.x, seat.y)
    } else if (state === 'idle') {
      this.wanderSoon()
    } else if (state === 'offline') {
      this.walkTo(rest.x, rest.y)
    }
  }

  destroy() {
    this.stopActivity()
    this.root.destroy()
  }

  private stopActivity() {
    this.walkTween?.stop()
    this.typingTween?.stop()
    this.wanderTimer?.remove()
    this.sprite.stop()
    this.sprite.setTexture(`${this.id}-stand`)
    this.sprite.y = 0
  }

  private walkTo(x: number, y: number, onArrive?: () => void) {
    const distance = Phaser.Math.Distance.Between(this.root.x, this.root.y, x, y)
    if (distance < 2) {
      onArrive?.()
      return
    }
    this.sprite.setFlipX(x < this.root.x)
    this.sprite.play(this.walkKey)
    this.walkTween = this.scene.tweens.add({
      targets: this.root,
      x,
      y,
      duration: (distance / WALK_SPEED) * 1000,
      onUpdate: () => this.root.setDepth(this.root.y),
      onComplete: () => {
        this.sprite.stop()
        this.sprite.setTexture(`${this.id}-stand`)
        onArrive?.()
      },
    })
  }

  private startTyping() {
    this.sprite.setFlipX(false)
    this.typingTween = this.scene.tweens.add({
      targets: this.sprite,
      y: -2,
      duration: 140,
      yoyo: true,
      repeat: -1,
    })
  }

  private wanderSoon() {
    this.wanderTimer = this.scene.time.delayedCall(Phaser.Math.Between(1200, 3500), () => {
      const x = WANDER_AREA.x + Math.random() * WANDER_AREA.width
      const y = WANDER_AREA.y + Math.random() * WANDER_AREA.height
      this.walkTo(x, y, () => this.wanderSoon())
    })
  }
}
