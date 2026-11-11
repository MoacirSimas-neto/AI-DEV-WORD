import { useEffect, useRef } from 'react'
import type { AvatarPreset } from '../../../shared/protocol.ts'
import { characterRows, type Frame, lookFor, paintRows, paletteFor } from '../game/agentLooks.ts'

export type PreviewAnimMode = 'static' | 'idle' | 'walk' | 'work'

const PORTRAIT_ROWS = 13 // cabeça e ombros do personagem de 16x20
const FULL_ROWS = 20 // corpo inteiro 16x20

const ANIM_FRAMES: Record<Exclude<PreviewAnimMode, 'static'>, { frames: Frame[]; intervalMs: number }> = {
  idle: { frames: ['stand', 'stand', 'stand', 'blink'], intervalMs: 520 },
  walk: { frames: ['step', 'stand', 'stepAlt', 'stand'], intervalMs: 160 },
  work: { frames: ['work1', 'work2'], intervalMs: 240 },
}

interface Props {
  agentId: string
  preset?: AvatarPreset
  dimmed?: boolean
  fullBody?: boolean
  animMode?: PreviewAnimMode
  className?: string
}

/** Retrato ou prévia animada em pixel art, desenhado com os mesmos dados do personagem no mundo Phaser. */
export function AgentPortrait({
  agentId,
  preset,
  dimmed = false,
  fullBody = false,
  animMode = 'static',
  className,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const height = fullBody ? FULL_ROWS : PORTRAIT_ROWS

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const look = lookFor(agentId, preset)
    const palette = paletteFor(look)

    const drawFrame = (frame: Frame) => {
      ctx.clearRect(0, 0, 16, height)
      const rows = characterRows(look, frame)
      paintRows(ctx, fullBody ? rows : rows.slice(0, PORTRAIT_ROWS), palette)
    }

    drawFrame('stand')
    if (animMode === 'static') return

    const seq = ANIM_FRAMES[animMode]
    let idx = 0
    const timer = setInterval(() => {
      idx = (idx + 1) % seq.frames.length
      drawFrame(seq.frames[idx])
    }, seq.intervalMs)

    return () => clearInterval(timer)
  }, [agentId, preset, height, fullBody, animMode])

  const baseClass = fullBody ? 'portrait portrait-fullbody' : 'portrait'
  return (
    <canvas
      ref={canvas}
      width={16}
      height={height}
      className={`${baseClass}${dimmed ? ' portrait-dimmed' : ''}${className ? ` ${className}` : ''}`}
      aria-hidden
    />
  )
}
