// Aparência dos personagens. Sem dependência do Phaser: a interface React usa
// os mesmos dados para desenhar os retratos.

export type Palette = Record<string, string>

export interface AgentLook {
  hair: string
  hairLight: string
  shirt: string
  shirtDark: string
  glasses: boolean
}

// Chaves = ids dos agentes definidos no backend (server/src/agents/registry.ts).
const LOOKS: Record<string, AgentLook> = {
  architect: { hair: '#2e2a3a', hairLight: '#4a4460', shirt: '#8a6fb5', shirtDark: '#6c5496', glasses: true },
  dev: { hair: '#6b4a35', hairLight: '#8a6447', shirt: '#3fa796', shirtDark: '#2f8577', glasses: false },
  qa: { hair: '#b5564e', hairLight: '#d0766a', shirt: '#e0b04a', shirtDark: '#bf9038', glasses: false },
  tutor: { hair: '#cfc6ba', hairLight: '#ece6dc', shirt: '#6f9fd8', shirtDark: '#537fb5', glasses: true },
}

export function lookFor(agentId: string): AgentLook {
  return LOOKS[agentId] ?? LOOKS.dev
}

export function paletteFor(look: AgentLook): Palette {
  return {
    o: '#3a2a2e', // contorno
    h: look.hair,
    H: look.hairLight,
    s: '#f2c9a0', // pele
    k: '#e8a48c', // bochecha
    e: '#3a2a2e', // olho
    g: '#56608a', // ponte dos óculos
    L: '#e4eef6', // lente
    c: look.shirt,
    C: look.shirtDark,
    p: '#4a5a7a', // calça
    b: '#2e2a3a', // sapato
  }
}

// Personagem 16x20: cada caractere é um pixel ('.' = transparente).
const HEAD_TOP = [
  '....oooooooo....',
  '...ohhHHhhhho...',
  '..ohhHHhhhhhho..',
  '..ohhhhhhhhhho..',
  '..ohhsssssshho..',
  '..ohssssssssho..',
]
const EYES = { open: ['..ossessssesso..', '..ossessssesso..'], closed: ['..osssssssssso..', '..ossessssesso..'] }
const EYES_GLASSES = {
  open: ['..osLeLggLeLso..', '..osLeLssLeLso..'],
  closed: ['..osLLLggLLLso..', '..osLeLssLeLso..'],
}
const BODY = [
  '..osksssssskso..',
  '...osssssssso...',
  '....oooooooo....',
  '...occcccccco...',
  '..occcccccccco..',
  '..osccccccccso..',
  '..osCCCCCCCCso..',
  '...oCCCCCCCCo...',
  '...oppppppppo...',
]
const LEGS = {
  apart: ['...oppp..pppo...', '...obbb..bbbo...', '...oooo..oooo...'],
  together: ['....opppppo.....', '....obbbbbo.....', '....ooooooo.....'],
}

export type Frame = 'stand' | 'step' | 'blink'

export function characterRows(look: AgentLook, frame: Frame): string[] {
  const eyes = (look.glasses ? EYES_GLASSES : EYES)[frame === 'blink' ? 'closed' : 'open']
  const legs = frame === 'step' ? LEGS.together : LEGS.apart
  return [...HEAD_TOP, ...eyes, ...BODY, ...legs]
}

/** Pinta as linhas num canvas 2D, um pixel por caractere. */
export function paintRows(ctx: CanvasRenderingContext2D, rows: string[], palette: Palette) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
    }
  })
}
