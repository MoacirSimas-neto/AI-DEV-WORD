import type Phaser from 'phaser'

/**
 * Todo o cenário é desenhado numa grade de "pixels de arte" de 216x120, e cada
 * um vale U pixels do mundo. Os personagens usam a mesma escala, o que mantém
 * os pixels do mesmo tamanho na tela inteira.
 */
export const U = 3
export const WORLD = { width: 216 * U, height: 120 * U }
export const FONT = '"Pixelify Sans Variable", monospace'

export interface Station {
  /** Onde o agente fica ao usar o terminal (atrás da mesa). */
  seat: { x: number; y: number }
  /** Faixa em frente à própria mesa onde o agente ocioso passeia (evita nomes sobrepostos). */
  wander: { x: number; y: number; width: number; height: number }
  /** Onde o agente fica quando o CLI não está disponível. */
  rest: { x: number; y: number }
  /** Luz do monitor: o personagem a acende conforme o estado real do agente. */
  led: Phaser.GameObjects.Rectangle
}

// ids = agentes definidos no backend (server/src/agents/registry.ts)
const DESKS = [
  { id: 'architect', plate: 'Arquiteto', x: 10, restX: 44 },
  { id: 'dev', plate: 'Dev', x: 62, restX: 88 },
  { id: 'qa', plate: 'QA', x: 114, restX: 130 },
  { id: 'tutor', plate: 'Tutor', x: 166, restX: 174 },
]

const C = {
  wall: 0xecdcb9,
  wallStripe: 0xe3d0a9,
  wood: 0x8a5a3c,
  woodDark: 0x5c3d2a,
  woodMid: 0x7a5238,
  woodLight: 0xb58153,
  woodShine: 0xcf9a68,
  floorA: 0xc9955f,
  floorB: 0xbf8a55,
  floorSeam: 0xa87645,
  paper: 0xf4efe6,
  parchment: 0xf4e4c1,
  red: 0xc0564e,
  redDark: 0xa3443d,
  gold: 0xe8c27a,
  leaf: 0x4f8a5b,
  leafLight: 0x6fae73,
  pot: 0xb5694a,
  metal: 0x3a3f4b,
  metalDark: 0x2a2e38,
  ink: 0x3a2a2e,
}

type Paint = (x: number, y: number, w: number, h: number, color: number, alpha?: number) => void

/** Devolve um "pincel" que desenha retângulos em pixels de arte. */
function painter(g: Phaser.GameObjects.Graphics): Paint {
  return (x, y, w, h, color, alpha = 1) => {
    g.fillStyle(color, alpha)
    g.fillRect(x * U, y * U, w * U, h * U)
  }
}

/** Objeto com profundidade = base dele, para ordenar corretamente com os personagens. */
function prop(scene: Phaser.Scene, baseY: number): Paint {
  return painter(scene.add.graphics().setDepth(baseY * U))
}

/** Desenha o escritório e devolve a estação de trabalho de cada agente. */
export function drawOffice(scene: Phaser.Scene): Record<string, Station> {
  const p = painter(scene.add.graphics())

  // Parede: papel listrado, sanca e lambri de madeira
  p(0, 0, 216, 38, C.wall)
  for (let x = 3; x < 216; x += 8) p(x, 2, 1, 28, C.wallStripe)
  p(0, 0, 216, 2, C.woodMid)
  p(0, 30, 216, 8, C.woodLight)
  p(0, 30, 216, 1, C.woodShine)
  for (let x = 5; x < 216; x += 12) p(x, 32, 1, 5, C.wood)
  p(0, 37, 216, 1, C.woodDark)

  // Piso de tábuas com emendas desencontradas
  for (let row = 0, y = 38; y < 120; row++, y += 7) {
    p(0, y, 216, 7, row % 2 ? C.floorA : C.floorB)
    p(0, y + 6, 216, 1, C.floorSeam)
    for (let x = (row * 29) % 46; x < 216; x += 46) p(x, y, 1, 6, C.floorSeam)
  }
  p(0, 38, 216, 2, 0x000000, 0.12)

  drawWindow(scene, p, 14)
  drawWindow(scene, p, 166)
  drawBookshelf(p)
  drawTaskBoard(p)
  drawClock(scene, p)
  drawRug(p)

  const stations: Record<string, Station> = {}
  for (const desk of DESKS) {
    stations[desk.id] = {
      seat: { x: (desk.x + 30) * U, y: 59 * U },
      wander: { x: (desk.x + 9) * U, y: 90 * U, width: 22 * U, height: 14 * U },
      rest: { x: desk.restX * U, y: 116 * U },
      led: drawDesk(scene, p, desk.x, desk.plate),
    }
  }

  drawCoffeeCorner(scene)
  drawWaterCooler(scene)
  drawPlant(scene, 3, 106)
  drawPlant(scene, 199, 106)
  return stations
}

function drawWindow(scene: Phaser.Scene, p: Paint, x: number) {
  p(x - 3, 3, 42, 1, C.woodDark) // varão da cortina
  p(x, 5, 36, 23, C.woodMid)
  p(x + 2, 7, 32, 6, 0x7cc4e8)
  p(x + 2, 13, 32, 6, 0xa8dcf0)
  p(x + 2, 19, 32, 4, 0xd9f1f8)
  p(x + 2, 23, 32, 3, 0x8fc27a) // colinas ao longe
  p(x + 8, 22, 9, 1, 0x8fc27a)
  p(x + 24, 22, 6, 1, 0x8fc27a)
  p(x + 6, 11, 8, 2, 0xffffff) // nuvens
  p(x + 8, 10, 5, 1, 0xffffff)
  p(x + 22, 15, 7, 2, 0xffffff)
  p(x + 24, 14, 4, 1, 0xffffff)
  p(x + 17, 7, 2, 19, C.woodMid)
  p(x + 2, 16, 32, 1, C.woodMid)
  p(x - 1, 28, 38, 2, C.wood)
  for (const cx of [x - 2, x + 33]) {
    p(cx, 4, 5, 23, C.red)
    p(cx, 4, 1, 23, C.redDark)
    p(cx + 3, 4, 1, 23, C.redDark)
  }
  // Luz do sol projetada no chão
  const light = scene.add.graphics()
  light.fillStyle(0xfff3c4, 0.13)
  light.fillPoints(
    [
      { x: (x + 2) * U, y: 40 * U },
      { x: (x + 34) * U, y: 40 * U },
      { x: (x + 42) * U, y: 70 * U },
      { x: (x - 6) * U, y: 70 * U },
    ],
    true,
  )
}

function drawBookshelf(p: Paint) {
  p(84, 4, 48, 30, C.woodMid)
  p(84, 4, 48, 1, C.wood)
  const books = [0xc0564e, 0x4f8a8b, 0xe8c27a, 0x6b7fb5, 0x8fb573, 0xc98a5a, 0x8a6fb5]
  for (const shelfY of [6, 20]) {
    p(86, shelfY, 44, 12, 0x4a3122)
    for (let i = 0, x = 87; x < 128; i++, x += 3) {
      if ((i + shelfY) % 7 === 5) continue // um vão entre os livros
      const height = 7 + ((i * 5 + shelfY) % 4)
      p(x, shelfY + 12 - height, 2, height, books[(i + shelfY) % books.length])
    }
  }
  // Vasinho em cima da estante
  p(89, 1, 4, 3, C.pot)
  p(88, -1, 2, 2, C.leaf)
  p(91, -2, 2, 3, C.leafLight)
}

/** Quadro de tarefas com post-its (as tarefas reais chegam numa etapa futura). */
function drawTaskBoard(p: Paint) {
  p(137, 8, 24, 17, C.wood)
  p(138, 9, 22, 15, C.paper)
  p(145, 9, 1, 15, 0xd8d0c0)
  p(152, 9, 1, 15, 0xd8d0c0)
  const notes: [number, number, number][] = [
    [139, 11, 0xf0d060],
    [139, 16, 0xf0a0a0],
    [147, 11, 0x9ad0f0],
    [147, 16, 0xf0d060],
    [147, 20, 0xa8e0a0],
    [154, 12, 0xa8e0a0],
  ]
  for (const [x, y, color] of notes) p(x, y, 4, 3, color)
}

/** Relógio de parede com a hora real do computador. */
function drawClock(scene: Phaser.Scene, p: Paint) {
  p(71, 9, 9, 11, C.woodDark)
  p(70, 10, 11, 9, C.woodDark)
  p(72, 10, 7, 9, C.parchment)
  p(71, 11, 9, 7, C.parchment)
  const center = { x: 75.5 * U, y: 14.5 * U }
  const hands = scene.add.graphics()
  const draw = () => {
    const now = new Date()
    const minute = (now.getMinutes() / 60) * Math.PI * 2
    const hour = (((now.getHours() % 12) + now.getMinutes() / 60) / 12) * Math.PI * 2
    hands.clear()
    hands.lineStyle(U, C.ink)
    hands.lineBetween(center.x, center.y, center.x + Math.sin(hour) * 2 * U, center.y - Math.cos(hour) * 2 * U)
    hands.lineStyle(U - 1, C.red)
    hands.lineBetween(center.x, center.y, center.x + Math.sin(minute) * 3 * U, center.y - Math.cos(minute) * 3 * U)
  }
  draw()
  scene.time.addEvent({ delay: 15_000, loop: true, callback: draw })
}

function drawRug(p: Paint) {
  p(66, 78, 84, 28, C.gold)
  p(68, 80, 80, 24, C.redDark)
  p(70, 82, 76, 20, C.red)
  p(72, 84, 72, 16, 0xc96a5e)
  for (let x = 78; x < 142; x += 10) {
    p(x, 91, 2, 2, C.gold)
    p(x - 1, 92, 4, 0.5, C.gold)
  }
  for (let x = 68; x < 150; x += 4) {
    p(x, 77, 1, 1, C.gold) // franjas
    p(x, 106, 1, 1, C.gold)
  }
}

function drawDesk(scene: Phaser.Scene, base: Paint, x: number, plate: string) {
  // Cadeira: fica atrás do personagem, que a cobre ao sentar
  base(x + 25, 45, 10, 11, 0x7a4038)
  base(x + 26, 44, 8, 1, 0x7a4038)
  base(x + 26, 46, 8, 1, 0x9a5a4e)
  base(x + 25, 45, 1, 11, 0x5c2e28)

  const p = prop(scene, 66)
  p(x + 1, 66, 38, 2, 0x000000, 0.15)
  p(x + 2, 62, 3, 5, C.woodDark)
  p(x + 35, 62, 3, 5, C.woodDark)
  p(x, 57, 40, 6, C.woodMid)
  p(x, 62, 40, 1, C.woodDark)
  p(x, 52, 40, 5, C.woodLight)
  p(x, 52, 40, 1, C.woodShine)
  // Monitor (de costas para nós), papéis, lápis e caneca
  p(x + 4, 41, 15, 10, C.metalDark)
  p(x + 5, 42, 13, 8, C.metal)
  p(x + 10, 51, 3, 1, C.metalDark)
  p(x + 8, 52, 7, 1, C.metalDark)
  p(x + 21, 53, 6, 3, C.paper)
  p(x + 22, 54, 4, 0.5, 0xb8b0a0)
  p(x + 28, 55, 4, 1, 0xf0d060)
  p(x + 34, 49, 3, 3, C.paper)
  p(x + 37, 50, 1, 1, C.paper)
  p(x + 34, 50, 3, 1, C.red)
  // Plaquinha com o papel do agente
  p(x + 7, 58, 26, 4, C.parchment)
  scene.add
    .text((x + 20) * U, 60 * U, plate, { fontFamily: FONT, fontSize: '11px', color: '#3a2a2e' })
    .setOrigin(0.5)
    .setDepth(66 * U + 1)

  return scene.add
    .rectangle((x + 16) * U, 48 * U, U, U, C.metalDark)
    .setOrigin(0)
    .setDepth(66 * U + 1)
}

function drawCoffeeCorner(scene: Phaser.Scene) {
  const p = prop(scene, 86)
  p(3, 86, 16, 2, 0x000000, 0.15)
  p(2, 74, 16, 12, C.woodMid)
  p(4, 77, 5, 7, C.wood)
  p(11, 77, 5, 7, C.wood)
  p(2, 72, 16, 3, C.woodShine)
  p(4, 63, 8, 9, C.metal)
  p(5, 64, 6, 3, C.metalDark)
  p(6, 68, 4, 3, C.metalDark)
  p(10, 64, 1, 1, 0xe07a6c)
  p(7, 69, 2, 2, C.paper)
  p(14, 69, 2, 3, C.paper)
  p(14, 70, 2, 1, 0x6b7fb5)
}

function drawWaterCooler(scene: Phaser.Scene) {
  const p = prop(scene, 86)
  p(201, 86, 10, 2, 0x000000, 0.15)
  p(203, 61, 6, 9, 0xa8dcf0)
  p(204, 62, 1, 6, 0xd9f1f8)
  p(204, 60, 4, 1, 0x7cc4e8)
  p(202, 70, 8, 16, C.paper)
  p(202, 70, 8, 1, 0xd8d0c0)
  p(204, 74, 1, 2, 0x6b7fb5)
  p(207, 74, 1, 2, C.red)
  p(203, 78, 6, 1, 0xd8d0c0)
}

/** `y` é o topo do vaso. */
function drawPlant(scene: Phaser.Scene, x: number, y: number) {
  const p = prop(scene, y + 9)
  p(x + 2, y + 9, 12, 2, 0x000000, 0.15)
  p(x + 3, y, 9, 9, C.pot)
  p(x + 2, y, 11, 2, 0xc98a5a)
  p(x + 6, y - 13, 3, 13, C.leaf)
  p(x + 2, y - 9, 4, 6, C.leaf)
  p(x + 9, y - 10, 4, 7, C.leaf)
  p(x, y - 6, 3, 3, C.leaf)
  p(x + 12, y - 7, 3, 3, C.leaf)
  p(x + 5, y - 15, 3, 4, C.leafLight)
  p(x + 9, y - 12, 2, 3, C.leafLight)
  p(x + 2, y - 10, 2, 2, C.leafLight)
  p(x + 13, y - 8, 1, 2, C.leafLight)
}
