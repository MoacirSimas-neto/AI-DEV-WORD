import type Phaser from 'phaser'
import { type Palette, paintRows } from './agentLooks.ts'

/** Cria ou atualiza uma textura do Phaser a partir de linhas de texto (um caractere = um pixel). */
export function makePixelTexture(scene: Phaser.Scene, key: string, rows: string[], palette: Palette) {
  if (scene.textures.exists(key)) {
    const existing = scene.textures.get(key) as Phaser.Textures.CanvasTexture
    const ctx = existing.getContext()
    ctx.clearRect(0, 0, existing.width, existing.height)
    paintRows(ctx, rows, palette)
    existing.refresh()
    return
  }
  const texture = scene.textures.createCanvas(key, rows[0].length, rows.length)!
  paintRows(texture.getContext(), rows, palette)
  texture.refresh()
}
