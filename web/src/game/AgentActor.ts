import Phaser from 'phaser'
import type { AgentInfo, AgentState } from '../../../shared/protocol.ts'
import { characterRows, type Frame, lookFor, paletteFor } from './agentLooks.ts'
import { FONT, type Station, U } from './officeLayout.ts'
import { makePixelTexture } from './pixelArt.ts'

const WALK_SPEED = 90 // pixels do mundo por segundo
const BUBBLE_TEXT: Record<AgentState, string> = {
  idle: '',
  waiting: '?',
  working: '...',
  offline: 'zzz',
  error: '!',
}
const LED_COLOR: Partial<Record<AgentState, number>> = { waiting: 0xf0bd5e, working: 0x7fe08a }
const LED_OFF = 0x2a2e38

/**
 * Um personagem no mundo. O comportamento é função do estado real do agente:
 * working -> digita na mesa; waiting -> parado na mesa esperando você;
 * idle -> passeia; offline -> dorme; error -> alerta.
 */
export class AgentActor {
  readonly id: string
  private readonly scene: Phaser.Scene
  private readonly station: Station
  private readonly root: Phaser.GameObjects.Container
  private readonly sprite: Phaser.GameObjects.Sprite
  private readonly ring: Phaser.GameObjects.Ellipse
  private readonly bubble: Phaser.GameObjects.Text
  private readonly label: Phaser.GameObjects.Text
  private readonly overlay: Phaser.GameObjects.Container
  private readonly blinkTimer: Phaser.Time.TimerEvent
  private state: AgentState | null = null
  private walkTween?: Phaser.Tweens.Tween
  private typingTween?: Phaser.Tweens.Tween
  private ledTween?: Phaser.Tweens.Tween
  private wanderTimer?: Phaser.Time.TimerEvent

  constructor(scene: Phaser.Scene, agent: AgentInfo, station: Station, onSelect: (id: string) => void) {
    this.scene = scene
    this.station = station
    this.id = agent.id

    const look = lookFor(agent.id)
    for (const frame of ['stand', 'step', 'blink'] as Frame[]) {
      makePixelTexture(scene, this.key(frame), characterRows(look, frame), paletteFor(look))
    }
    if (!scene.anims.exists(this.key('walk'))) {
      scene.anims.create({
        key: this.key('walk'),
        frames: [{ key: this.key('step') }, { key: this.key('stand') }],
        frameRate: 6,
        repeat: -1,
      })
    }

    this.ring = scene.add.ellipse(0, -2, 46, 14).setStrokeStyle(3, 0xfff3c4).setVisible(false)
    const shadow = scene.add.ellipse(0, -1, 36, 9, 0x000000, 0.2)
    this.sprite = scene.add.sprite(0, 0, this.key('stand')).setOrigin(0.5, 1).setScale(U)
    this.sprite.setInteractive({ useHandCursor: true })
    this.sprite.on('pointerdown', () => onSelect(agent.id))

    this.label = scene.add
      .text(0, 3, agent.name, { fontFamily: FONT, fontSize: '14px', color: '#fff8e7' })
      .setOrigin(0.5, 0)
      .setStroke('#3a2a2e', 4)
    this.bubble = scene.add
      .text(0, -66, '', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#3a2a2e',
        backgroundColor: '#fff8e7',
        padding: { x: 6, y: 1 },
      })
      .setOrigin(0.5, 1)

    this.root = scene.add.container(station.rest.x, station.rest.y, [this.ring, shadow, this.sprite])
    this.root.setDepth(this.root.y)
    // Nome e balão ficam numa camada acima de tudo, para nunca serem cobertos por móveis.
    this.overlay = scene.add.container(this.root.x, this.root.y, [this.label, this.bubble]).setDepth(10_000)

    // Piscar os olhos de vez em quando, só quando parado.
    this.blinkTimer = scene.time.addEvent({
      delay: Phaser.Math.Between(2600, 4800),
      loop: true,
      callback: () => {
        if (this.sprite.anims.isPlaying) return
        this.sprite.setTexture(this.key('blink'))
        scene.time.delayedCall(140, () => {
          if (!this.sprite.anims.isPlaying && this.sprite.active) this.sprite.setTexture(this.key('stand'))
        })
      },
    })

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
    // Sentado, a plaquinha da mesa já diz quem é.
    this.label.setVisible(state !== 'working' && state !== 'waiting')
    if (state === 'offline') this.sprite.setTint(0x8a8fa0)
    else this.sprite.clearTint()
    this.setLed(state)

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
    this.blinkTimer.remove()
    this.setLed(null)
    this.root.destroy()
    this.overlay.destroy()
  }

  private key(name: string) {
    return `${this.id}-${name}`
  }

  private setLed(state: AgentState | null) {
    const { led } = this.station
    this.ledTween?.stop()
    led.setAlpha(1).setFillStyle((state && LED_COLOR[state]) ?? LED_OFF)
    if (state === 'working') {
      this.ledTween = this.scene.tweens.add({ targets: led, alpha: 0.25, duration: 320, yoyo: true, repeat: -1 })
    }
  }

  private stopActivity() {
    this.walkTween?.stop()
    this.typingTween?.stop()
    this.wanderTimer?.remove()
    this.sprite.stop()
    this.sprite.setTexture(this.key('stand'))
    this.sprite.y = 0
  }

  private walkTo(x: number, y: number, onArrive?: () => void) {
    const distance = Phaser.Math.Distance.Between(this.root.x, this.root.y, x, y)
    if (distance < 2) {
      onArrive?.()
      return
    }
    this.sprite.setFlipX(x < this.root.x)
    this.sprite.play(this.key('walk'))
    this.walkTween = this.scene.tweens.add({
      targets: this.root,
      x,
      y,
      duration: (distance / WALK_SPEED) * 1000,
      onUpdate: () => {
        this.root.setDepth(this.root.y)
        this.overlay.setPosition(this.root.x, this.root.y)
      },
      onComplete: () => {
        this.sprite.stop()
        this.sprite.setTexture(this.key('stand'))
        this.sprite.setFlipX(false)
        onArrive?.()
      },
    })
  }

  private startTyping() {
    this.typingTween = this.scene.tweens.add({
      targets: this.sprite,
      y: -U,
      duration: 150,
      yoyo: true,
      repeat: -1,
      ease: 'Stepped',
    })
  }

  private wanderSoon() {
    this.wanderTimer = this.scene.time.delayedCall(Phaser.Math.Between(1200, 4200), () => {
      const area = this.station.wander
      const x = area.x + Math.random() * area.width
      const y = area.y + Math.random() * area.height
      this.walkTo(x, y, () => this.wanderSoon())
    })
  }
}
