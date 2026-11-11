import { useEffect, useRef } from 'react'
import { characterRows, lookFor, paintRows, paletteFor } from '../game/agentLooks.ts'

const ROWS = 13 // cabeça e ombros do personagem de 16x20

/** Retrato em pixel art, desenhado com os mesmos dados do personagem no mundo. */
export function AgentPortrait({ agentId, dimmed = false }: { agentId: string; dimmed?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const look = lookFor(agentId)
    ctx.clearRect(0, 0, 16, ROWS)
    paintRows(ctx, characterRows(look, 'stand').slice(0, ROWS), paletteFor(look))
  }, [agentId])

  return <canvas ref={canvas} width={16} height={ROWS} className={dimmed ? 'portrait portrait-dimmed' : 'portrait'} aria-hidden />
}
