import type Phaser from 'phaser'

export type Palette = Record<string, string>

/** Desenha uma textura a partir de linhas de texto: cada caractere é um pixel. */
export function makePixelTexture(scene: Phaser.Scene, key: string, rows: string[], palette: Palette) {
  if (scene.textures.exists(key)) return
  const texture = scene.textures.createCanvas(key, rows[0].length, rows.length)!
  const ctx = texture.getContext()
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
    }
  })
  texture.refresh()
}

// Personagem 16x20: o = contorno, h = cabelo, s = pele, e = olho,
// c = camisa, p = calça, b = sapato, . = transparente.
const BODY = [
  '....oooooooo....',
  '...ohhhhhhhho...',
  '..ohhhhhhhhhho..',
  '..ohhhhhhhhhho..',
  '..ohhsssssshho..',
  '..ohssssssssho..',
  '..ossessssesso..',
  '..ossessssesso..',
  '..osssssssssso..',
  '...osssssssso...',
  '....oooooooo....',
  '...occcccccco...',
  '..occcccccccco..',
  '..osccccccccso..',
  '..osccccccccso..',
  '...occcccccco...',
  '...oppppppppo...',
]

const LEGS_APART = ['...oppp..pppo...', '...obbb..bbbo...', '...oooo..oooo...']
const LEGS_TOGETHER = ['....opppppo.....', '....obbbbbo.....', '....ooooooo.....']

export const CHARACTER_FRAMES = {
  stand: [...BODY, ...LEGS_APART],
  step: [...BODY, ...LEGS_TOGETHER],
}

export function characterPalette(hair: string, shirt: string): Palette {
  return { o: '#3a2a2e', h: hair, s: '#f2c9a0', e: '#3a2a2e', c: shirt, p: '#4a5a7a', b: '#2e2a3a' }
}
