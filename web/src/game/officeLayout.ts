import type Phaser from 'phaser'

export const WORLD = { width: 640, height: 360 }

/** Área do tapete, onde os agentes ociosos passeiam. */
export const WANDER_AREA = { x: 215, y: 245, width: 210, height: 55 }

export interface Station {
  /** Texto da plaquinha na frente da mesa. */
  plate: string
  /** Onde o agente fica ao usar o terminal (atrás da mesa). */
  seat: { x: number; y: number }
  /** Onde o agente "dorme" quando o CLI não está disponível. */
  rest: { x: number; y: number }
  hair: string
  shirt: string
}

const DESK = { width: 124, top: 156 }
const deskLeft = (slot: number) => 26 + slot * 155

function station(slot: number, plate: string, hair: string, shirt: string): Station & { deskX: number } {
  const deskX = deskLeft(slot)
  return {
    deskX,
    plate,
    seat: { x: deskX + 86, y: 176 },
    rest: { x: deskX + 62, y: 338 },
    hair,
    shirt,
  }
}

// Chaves = ids dos agentes definidos no backend (server/src/agents/registry.ts).
const STATIONS: Record<string, Station & { deskX: number }> = {
  architect: station(0, 'ARQUITETO', '#2e2a3a', '#8a6fb5'),
  dev: station(1, 'DEV', '#6b4a35', '#3fa796'),
  qa: station(2, 'QA', '#b5564e', '#e0b04a'),
  tutor: station(3, 'TUTOR', '#cfc6ba', '#6f9fd8'),
}

export function stationFor(agentId: string): Station {
  return STATIONS[agentId] ?? STATIONS.dev
}

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

  drawWindow(g, 60)
  drawWindow(g, 468)
  g.fillStyle(0xfff3c4, 0.18).fillRect(50, 206, 140, 60).fillRect(458, 206, 140, 60)

  // Estante com livros
  g.fillStyle(0x7a5238).fillRect(250, 22, 140, 74)
  g.fillStyle(0x5c3d2a).fillRect(256, 28, 128, 28).fillRect(256, 62, 128, 28)
  const books = [0xc0564e, 0x4f8a8b, 0xe8c27a, 0x6b7fb5, 0x8fb573, 0xc98a5a]
  for (let i = 0; i < 15; i++) {
    g.fillStyle(books[i % books.length]).fillRect(260 + i * 8, 32 + (i % 3) * 2, 6, 24 - (i % 3) * 2)
    g.fillStyle(books[(i + 3) % books.length]).fillRect(260 + i * 8, 68 + (i % 2) * 3, 6, 22 - (i % 2) * 3)
  }

  // Tapete
  g.fillStyle(0xe8c27a).fillRect(196, 226, 248, 92)
  g.fillStyle(0xb5564e).fillRect(202, 232, 236, 80)
  g.fillStyle(0xc96a5e).fillRect(214, 244, 212, 56)

  for (const { deskX, plate } of Object.values(STATIONS)) drawDesk(scene, deskX, plate)
  drawPlant(scene, 8)
  drawPlant(scene, 592)
}

function drawWindow(g: Phaser.GameObjects.Graphics, x: number) {
  g.fillStyle(0x6b4a35).fillRect(x, 18, 112, 68)
  g.fillStyle(0xa8dcec).fillRect(x + 6, 24, 100, 56)
  g.fillStyle(0xd4f0f7).fillRect(x + 6, 24, 100, 18)
  g.fillStyle(0x6b4a35).fillRect(x + 54, 24, 4, 56).fillRect(x + 6, 50, 100, 4)
}

function drawDesk(scene: Phaser.Scene, x: number, plate: string) {
  const { width, top } = DESK
  const desk = scene.add.graphics().setDepth(top + 44)
  desk.fillStyle(0x000000, 0.15).fillRect(x + 6, top + 40, width - 6, 8)
  desk.fillStyle(0x6b4a35).fillRect(x + 6, top + 20, 10, 26).fillRect(x + width - 16, top + 20, 10, 26)
  desk.fillStyle(0x7a5238).fillRect(x, top + 14, width, 22)
  desk.fillStyle(0xa9764c).fillRect(x, top, width, 16)
  // Monitor (de costas para nós) e caneca
  desk.fillStyle(0x3a3f4b).fillRect(x + 10, top - 26, 44, 30)
  desk.fillStyle(0x2a2e38).fillRect(x + 14, top - 22, 36, 22).fillRect(x + 27, top + 4, 10, 4)
  desk.fillStyle(0xf4efe6).fillRect(x + width - 16, top - 8, 9, 10)
  desk.fillStyle(0xc0564e).fillRect(x + width - 16, top - 4, 9, 3)
  // Plaquinha com o papel do agente
  desk.fillStyle(0xf4e4c1).fillRect(x + 22, top + 18, width - 44, 14)
  scene.add
    .text(x + width / 2, top + 25, plate, { fontFamily: 'monospace', fontSize: '10px', color: '#3a2a2e' })
    .setOrigin(0.5)
    .setDepth(top + 45)
}

/** Vaso nos cantos de baixo; `y` é o topo do vaso. */
function drawPlant(scene: Phaser.Scene, x: number, y = 326) {
  const plant = scene.add.graphics().setDepth(y + 24)
  plant.fillStyle(0x000000, 0.15).fillRect(x + 4, y + 20, 36, 6)
  plant.fillStyle(0xb5694a).fillRect(x + 6, y, 30, 22)
  plant.fillStyle(0x9c5438).fillRect(x + 6, y, 30, 5)
  plant.fillStyle(0x4f8a5b).fillRect(x + 13, y - 30, 16, 30).fillRect(x, y - 20, 13, 13).fillRect(x + 29, y - 24, 13, 15)
  plant.fillStyle(0x6fae73).fillRect(x + 17, y - 38, 8, 16).fillRect(x + 4, y - 18, 6, 6).fillRect(x + 32, y - 22, 6, 6)
}
