import Phaser from 'phaser'
import type { AgentInfo, AgentState } from '../../../shared/protocol.ts'
import { characterRows, type Frame, lookFor, paletteFor } from './agentLooks.ts'
import { FONT, type Station, U } from './officeLayout.ts'
import { makePixelTexture } from './pixelArt.ts'

const WALK_SPEED = 96 // pixels do mundo por segundo

const BUBBLE_STYLE: Record<AgentState, { text: string; bg: string; fg: string }> = {
  idle: { text: '', bg: '#0f172a', fg: '#f8fafc' },
  waiting: { text: 'ESPERA', bg: '#f59e0b', fg: '#0f172a' },
  working: { text: 'EXEC', bg: '#10b981', fg: '#052e16' },
  planning: { text: 'PLAN', bg: '#38bdf8', fg: '#082f49' },
  approval: { text: 'APROVAR', bg: '#f59e0b', fg: '#0f172a' },
  reviewing: { text: 'QA REV', bg: '#a855f7', fg: '#faf5ff' },
  done: { text: 'PRONTO', bg: '#22c55e', fg: '#052e16' },
  offline: { text: 'OFF', bg: '#334155', fg: '#cbd5e1' },
  error: { text: 'ERRO', bg: '#ef4444', fg: '#fef2f2' },
}

const LED_COLOR: Partial<Record<AgentState, number>> = {
  waiting: 0xf59e0b,
  working: 0x34d399,
  planning: 0x38bdf8,
  approval: 0xf59e0b,
  reviewing: 0xa855f7,
  done: 0x22c55e,
  error: 0xef4444,
}
const LED_OFF = 0x222630

/**
 * Um personagem no mundo. O comportamento é função do estado real do agente:
 * working/planning/reviewing -> trabalha na mesa com animação dedicada;
 * waiting/approval/done -> na mesa aguardando;
 * idle -> passeia pelo corredor; offline -> descansa; error -> alerta.
 */
export class AgentActor {
  readonly id: string
  private agent: AgentInfo
  private station: Station
  private readonly scene: Phaser.Scene
  private readonly root: Phaser.GameObjects.Container
  private readonly sprite: Phaser.GameObjects.Sprite
  private readonly ring: Phaser.GameObjects.Ellipse
  private readonly bubble: Phaser.GameObjects.Text
  private readonly label: Phaser.GameObjects.Text
  private readonly hoverTip: Phaser.GameObjects.Text
  private readonly overlay: Phaser.GameObjects.Container
  private readonly blinkTimer: Phaser.Time.TimerEvent
  private state: AgentState | null = null
  private currentPreset: string
  private selected = false
  private hovered = false
  private walkTween?: Phaser.Tweens.Tween
  private typingTween?: Phaser.Tweens.Tween
  private ledTween?: Phaser.Tweens.Tween
  private wanderTimer?: Phaser.Time.TimerEvent

  constructor(scene: Phaser.Scene, agent: AgentInfo, station: Station, onSelect: (id: string) => void) {
    this.scene = scene
    this.agent = agent
    this.station = station
    this.id = agent.id
    this.currentPreset = `${agent.avatarPreset ?? ''}:${agent.id}:${agent.role ?? ''}:${agent.name ?? ''}`

    this.rebuildTextures()
    if (!scene.anims.exists(this.key('walk'))) {
      scene.anims.create({
        key: this.key('walk'),
        frames: [
          { key: this.key('step') },
          { key: this.key('stand') },
          { key: this.key('stepAlt') },
          { key: this.key('stand') },
        ],
        frameRate: 7,
        repeat: -1,
      })
    }
    if (!scene.anims.exists(this.key('work'))) {
      scene.anims.create({
        key: this.key('work'),
        frames: [{ key: this.key('work1') }, { key: this.key('work2') }],
        frameRate: 4,
        repeat: -1,
      })
    }

    this.ring = scene.add.ellipse(0, -2, 48, 15).setStrokeStyle(3, 0x38bdf8).setVisible(false)
    const shadow = scene.add.ellipse(0, -1, 38, 10, 0x000000, 0.28)
    this.sprite = scene.add.sprite(0, 0, this.key('stand')).setOrigin(0.5, 1).setScale(U)
    this.sprite.setInteractive({ useHandCursor: true })
    this.sprite.on('pointerdown', () => onSelect(agent.id))
    this.sprite.on('pointerover', () => {
      this.hovered = true
      this.ring.setVisible(true)
      this.updateHoverTip()
      this.hoverTip.setVisible(true)
    })
    this.sprite.on('pointerout', () => {
      this.hovered = false
      this.ring.setVisible(this.selected)
      this.hoverTip.setVisible(false)
    })

    this.label = scene.add
      .text(0, 4, agent.name, {
        fontFamily: FONT,
        fontSize: '11px',
        fontStyle: '700',
        color: '#f8fafc',
        backgroundColor: '#0f172acc',
        padding: { x: 5, y: 1 },
        resolution: 2,
      })
      .setOrigin(0.5, 0)
    this.bubble = scene.add
      .text(0, -68, '', {
        fontFamily: FONT,
        fontSize: '10px',
        fontStyle: '700',
        color: '#0f172a',
        backgroundColor: '#38bdf8',
        padding: { x: 5, y: 2 },
        resolution: 2,
      })
      .setOrigin(0.5, 1)
    this.hoverTip = scene.add
      .text(0, -86, '', {
        fontFamily: FONT,
        fontSize: '11px',
        fontStyle: '600',
        color: '#f8fafc',
        backgroundColor: '#0f172aee',
        padding: { x: 6, y: 3 },
        resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setVisible(false)

    this.root = scene.add.container(station.rest.x, station.rest.y, [this.ring, shadow, this.sprite])
    this.root.setDepth(this.root.y)
    this.overlay = scene.add.container(this.root.x, this.root.y, [this.label, this.bubble, this.hoverTip]).setDepth(10_500)

    this.syncPlate()

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

  updateAgent(agent: AgentInfo, station: Station) {
    this.agent = agent
    if (this.station !== station) {
      this.setLed(null)
      this.station = station
    }
    this.label.setText(agent.name)
    this.syncPlate()
    const nextPreset = `${agent.avatarPreset ?? ''}:${agent.id}:${agent.role ?? ''}:${agent.name ?? ''}`
    if (nextPreset !== this.currentPreset) {
      this.currentPreset = nextPreset
      this.rebuildTextures()
      if (!this.sprite.anims.isPlaying) {
        this.sprite.setTexture(this.key('stand'))
      }
    }
    if (this.hovered) this.updateHoverTip()
    this.setState(agent.state)
  }

  setSelected(selected: boolean) {
    this.selected = selected
    this.ring.setVisible(selected || this.hovered)
  }

  private rebuildTextures() {
    const roleOrName = this.agent.role ? `${this.agent.name} ${this.agent.role}` : this.agent.name
    const look = lookFor(this.agent.id, this.agent.avatarPreset, roleOrName)
    for (const frame of ['stand', 'step', 'stepAlt', 'blink', 'work1', 'work2'] as Frame[]) {
      makePixelTexture(this.scene, this.key(frame), characterRows(look, frame), paletteFor(look))
    }
  }

  private syncPlate() {
    if (this.station.plateText) {
      const raw = this.agent.name
      const shortName = raw.length > 7 ? raw.slice(0, 5) + '.' : raw
      this.station.plateText.setText(shortName).setVisible(true)
    }
  }

  private updateHoverTip() {
    const spec = this.agent.specializationId ?? this.agent.role
    const stText = BUBBLE_STYLE[this.agent.state].text || 'DISPONÍVEL'
    this.hoverTip.setText(`${this.agent.name} · ${spec} · ${stText}`)
  }

  setState(state: AgentState) {
    if (state === this.state) return
    this.state = state
    this.stopActivity()

    const badge = BUBBLE_STYLE[state]
    this.bubble
      .setText(badge.text)
      .setStyle({
        fontFamily: FONT,
        fontSize: '10px',
        fontStyle: '700',
        color: badge.fg,
        backgroundColor: badge.bg,
        resolution: 2,
      })
      .setVisible(state !== 'idle')

    this.label.setVisible(state === 'idle' || state === 'offline' || state === 'error')
    if (state === 'offline') this.sprite.setTint(0x8a8fa0)
    else this.sprite.clearTint()
    this.setLed(state)

    const { seat, rest } = this.station
    if (state === 'working' || state === 'planning' || state === 'reviewing') {
      this.walkTo(seat.x, seat.y, () => this.startTyping())
    } else if (state === 'waiting' || state === 'approval' || state === 'done') {
      this.walkTo(seat.x, seat.y)
    } else if (state === 'idle') {
      this.wanderSoon()
    } else if (state === 'offline') {
      this.walkTo(rest.x, rest.y)
    } else if (state === 'error') {
      this.walkTo(seat.x, seat.y)
    }
  }

  destroy() {
    this.stopActivity()
    this.blinkTimer.remove()
    this.setLed(null)
    this.station.plateText?.setText('Livre')
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
    if (state === 'working' || state === 'planning' || state === 'reviewing') {
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

  private walkTo(targetX: number, targetY: number, onArrive?: () => void) {
    const { corridorY } = this.station
    const waypoints: { x: number; y: number }[] = []

    // Se precisa cruzar entre a mesa (y < corridorY) e outro eixo X, usa o corredor principal
    if (Math.abs(targetX - this.root.x) > 18 * U && (this.root.y < corridorY || targetY < corridorY)) {
      if (Math.abs(this.root.y - corridorY) > 4) {
        waypoints.push({ x: this.root.x, y: corridorY })
      }
      waypoints.push({ x: targetX, y: corridorY })
    }
    waypoints.push({ x: targetX, y: targetY })

    this.followWaypoints(waypoints, onArrive)
  }

  private followWaypoints(points: { x: number; y: number }[], onArrive?: () => void) {
    const next = points.shift()
    if (!next) {
      this.sprite.stop()
      this.sprite.setTexture(this.key('stand'))
      this.sprite.setFlipX(false)
      onArrive?.()
      return
    }
    const distance = Phaser.Math.Distance.Between(this.root.x, this.root.y, next.x, next.y)
    if (distance < 2) {
      this.followWaypoints(points, onArrive)
      return
    }
    this.sprite.setFlipX(next.x < this.root.x)
    if (!this.sprite.anims.isPlaying || this.sprite.anims.currentAnim?.key !== this.key('walk')) {
      this.sprite.play(this.key('walk'))
    }
    this.walkTween = this.scene.tweens.add({
      targets: this.root,
      x: next.x,
      y: next.y,
      duration: (distance / WALK_SPEED) * 1000,
      onUpdate: () => {
        this.root.setDepth(this.root.y)
        this.overlay.setPosition(this.root.x, this.root.y)
      },
      onComplete: () => this.followWaypoints(points, onArrive),
    })
  }

  private startTyping() {
    this.sprite.play(this.key('work'))
    this.typingTween = this.scene.tweens.add({
      targets: this.sprite,
      y: -U,
      duration: 180,
      yoyo: true,
      repeat: -1,
      ease: 'Stepped',
    })
  }

  private wanderSoon() {
    this.wanderTimer = this.scene.time.delayedCall(Phaser.Math.Between(1400, 4200), () => {
      const area = this.station.wander
      const x = area.x + Math.random() * area.width
      const y = area.y + Math.random() * area.height
      this.walkTo(x, y, () => this.wanderSoon())
    })
  }
}
