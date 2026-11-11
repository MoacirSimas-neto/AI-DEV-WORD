import type Phaser from 'phaser'
import { type Palette, paintRows } from './agentLooks.ts'

/** Cria uma textura do Phaser a partir de linhas de texto (um caractere = um pixel). */
export function makePixelTexture(scene: Phaser.Scene, key: string, rows: string[], palette: Palette) {
  if (scene.textures.exists(key)) return
  const texture = scene.textures.createCanvas(key, rows[0].length, rows.length)!
  paintRows(texture.getContext(), rows, palette)
  texture.refresh()
}
