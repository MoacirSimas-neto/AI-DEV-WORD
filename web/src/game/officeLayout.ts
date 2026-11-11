import type Phaser from 'phaser'

export const WORLD = { width: 640, height: 360 }

/** Onde o agente fica ao trabalhar (atrás da mesa) e onde passeia quando ocioso. */
export const DESK_SEAT = { x: 540, y: 182 }
export const REST_SPOT = { x: 110, y: 300 }
export const WANDER_AREA = { x: 220, y: 225, width: 200, height: 75 }

const WALL_HEIGHT = 110

/** Desenha o cenário estático. Objetos usam depth = y da base para ordenar com os personagens. */
export function drawOffice(scene: Phaser.Scene) {
  const g = scene.add.graphics()

  // Parede e rodapé
  g.fillStyle(0xead9b6).fillRect(0, 0, WORLD.width, WALL_HEIGHT)
  g.fillStyle(0xdcc8a0).fillRect(0, 0, WORLD.width, 8)
  g.fillStyle(0x9c6b4a).fillRect(0, WALL_HEIGHT - 14, WORLD.width, 14)
  g.fillStyle(0x7a5238).fillRect(0, WALL_HEIGHT - 4, WORLD.width, 4)

  // Piso de tábuas
  const plank = 25
  for (let row = 0, y = WALL_HEIGHT; y < WORLD.height; row++, y += plank) {
    g.fillStyle(row % 2 ? 0xc48f5a : 0xbb854f).fillRect(0, y, WORLD.width, plank)
    g.fillStyle(0xa87645).fillRect(0, y + plank - 2, WORLD.width, 2)
    for (let x = row % 2 ? 60 : 140; x < WORLD.width; x += 160) g.fillRect(x, y, 2, plank - 2)
  }

  // Janela e a luz que ela projeta no chão
  g.fillStyle(0x6b4a35).fillRect(70, 18, 112, 68)
  g.fillStyle(0xa8dcec).fillRect(76, 24, 100, 56)
  g.fillStyle(0xd4f0f7).fillRect(76, 24, 100, 18)
  g.fillStyle(0x6b4a35).fillRect(124, 24, 4, 56).fillRect(76, 50, 100, 4)
  g.fillStyle(0xfff3c4, 0.22).fillRect(60, 120, 150, 90)

  // Estante com livros
  g.fillStyle(0x7a5238).fillRect(250, 26, 120, 70)
  g.fillStyle(0x5c3d2a).fillRect(256, 32, 108, 26).fillRect(256, 64, 108, 26)
  const books = [0xc0564e, 0x4f8a8b, 0xe8c27a, 0x6b7fb5, 0x8fb573, 0xc98a5a]
  for (let i = 0; i < 12; i++) {
    g.fillStyle(books[i % books.length]).fillRect(260 + i * 8, 36 + (i % 3) * 2, 6, 22 - (i % 3) * 2)
    g.fillStyle(books[(i + 3) % books.length]).fillRect(260 + i * 8, 70 + (i % 2) * 3, 6, 20 - (i % 2) * 3)
  }

  // Tapete
  g.fillStyle(0xe8c27a).fillRect(200, 212, 240, 104)
  g.fillStyle(0xb5564e).fillRect(206, 218, 228, 92)
  g.fillStyle(0xc96a5e).fillRect(218, 230, 204, 68)

  drawDesk(scene)
  drawPlant(scene)
}

function drawDesk(scene: Phaser.Scene) {
  const desk = scene.add.graphics().setDepth(200)
  desk.fillStyle(0x000000, 0.15).fillRect(446, 196, 150, 8)
  desk.fillStyle(0x6b4a35).fillRect(446, 176, 10, 26).fillRect(580, 176, 10, 26)
  desk.fillStyle(0x7a5238).fillRect(440, 170, 156, 22)
  desk.fillStyle(0xa9764c).fillRect(440, 156, 156, 16)
  // Monitor (de costas para nós) e caneca
  desk.fillStyle(0x3a3f4b).fillRect(456, 130, 46, 30)
  desk.fillStyle(0x2a2e38).fillRect(460, 134, 38, 22).fillRect(474, 160, 10, 4)
  desk.fillStyle(0xf4efe6).fillRect(572, 148, 10, 10)
  desk.fillStyle(0xc0564e).fillRect(572, 152, 10, 3)
}

function drawPlant(scene: Phaser.Scene) {
  const plant = scene.add.graphics().setDepth(340)
  plant.fillStyle(0x000000, 0.15).fillRect(28, 334, 40, 6)
  plant.fillStyle(0xb5694a).fillRect(32, 312, 32, 24)
  plant.fillStyle(0x9c5438).fillRect(32, 312, 32, 5)
  plant.fillStyle(0x4f8a5b).fillRect(40, 280, 16, 32).fillRect(26, 290, 14, 14).fillRect(56, 286, 14, 16)
  plant.fillStyle(0x6fae73).fillRect(44, 272, 8, 16).fillRect(30, 292, 6, 6).fillRect(60, 288, 6, 6)
}
