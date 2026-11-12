import type Phaser from 'phaser'
import type { AgentInfo } from '../../../shared/protocol.ts'
import type { WorldAction } from './WorldBridge.ts'

/**
 * Todo o cenário é desenhado numa grade de "pixels de arte" de 240x132, e cada
 * um vale U pixels do mundo. Os personagens usam a mesma escala, o que mantém
 * os pixels do mesmo tamanho na tela inteira.
 */
export const U = 3
export const WORLD = { width: 240 * U, height: 132 * U }
export const FONT = '"Nunito Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
export const MAX_VISIBLE_SPECIALISTS = 6

export interface Station {
  /** Onde o agente fica ao usar o terminal (atrás da mesa). */
  seat: { x: number; y: number }
  /** Faixa em frente à própria mesa onde o agente ocioso passeia. */
  wander: { x: number; y: number; width: number; height: number }
  /** Onde o agente fica quando o CLI não está disponível. */
  rest: { x: number; y: number }
  /** Y do corredor principal para evitar atravessar mesas. */
  corridorY: number
  /** Luz do monitor: o personagem a acende conforme o estado real do agente. */
  led: Phaser.GameObjects.Rectangle
  /** Texto da plaquinha da estação (atualizável para estações de especialistas). */
  plateText?: Phaser.GameObjects.Text
}

export interface OfficeCallbacks {
  onSelectAgent?: (agentId: string) => void
  onAction?: (action: WorldAction) => void
}

// ids = agentes definidos no backend (server/src/agents/registry.ts)
export const DESKS = [
  { id: 'architect', plate: 'Arquiteto', x: 10, restX: 22, accent: 0x3b82f6, tooltip: 'Estação de Arquitetura · Abrir Arquiteto' },
  { id: 'dev', plate: 'Dev', x: 64, restX: 76, accent: 0x10b981, tooltip: 'Estação de Desenvolvimento · Abrir Dev' },
  { id: 'qa', plate: 'QA', x: 118, restX: 130, accent: 0xf59e0b, tooltip: 'Bancada de QA & Testes · Abrir QA' },
  { id: 'tutor', plate: 'Tutor', x: 172, restX: 184, accent: 0xa855f7, tooltip: 'Estúdio do Tutor · Abrir Tutor' },
]

export const SPECIALIST_SLOTS = [
  {
    key: 'slot-0',
    podX: 22,
    podY: 94,
    seat: { x: 32 * U, y: 106 * U },
    rest: { x: 26 * U, y: 121 * U },
    wander: { x: 22 * U, y: 78 * U, width: 22 * U, height: 11 * U },
    accent: 0x38bdf8,
    defaultPlate: 'Espec. 1',
  },
  {
    key: 'slot-1',
    podX: 48,
    podY: 94,
    seat: { x: 58 * U, y: 106 * U },
    rest: { x: 52 * U, y: 121 * U },
    wander: { x: 46 * U, y: 78 * U, width: 22 * U, height: 11 * U },
    accent: 0x34d399,
    defaultPlate: 'Espec. 2',
  },
  {
    key: 'slot-2',
    podX: 170,
    podY: 94,
    seat: { x: 180 * U, y: 106 * U },
    rest: { x: 174 * U, y: 121 * U },
    wander: { x: 168 * U, y: 78 * U, width: 22 * U, height: 11 * U },
    accent: 0xa855f7,
    defaultPlate: 'Espec. 3',
  },
  {
    key: 'slot-3',
    podX: 196,
    podY: 94,
    seat: { x: 206 * U, y: 106 * U },
    rest: { x: 200 * U, y: 121 * U },
    wander: { x: 192 * U, y: 78 * U, width: 20 * U, height: 11 * U },
    accent: 0xf59e0b,
    defaultPlate: 'Espec. 4',
  },
  {
    key: 'slot-4',
    podX: null,
    podY: null,
    seat: { x: 86 * U, y: 108 * U },
    rest: { x: 80 * U, y: 122 * U },
    wander: { x: 74 * U, y: 80 * U, width: 24 * U, height: 11 * U },
    accent: 0x22d3ee,
    defaultPlate: 'Espec. 5',
  },
  {
    key: 'slot-5',
    podX: null,
    podY: null,
    seat: { x: 154 * U, y: 108 * U },
    rest: { x: 160 * U, y: 122 * U },
    wander: { x: 142 * U, y: 80 * U, width: 24 * U, height: 11 * U },
    accent: 0xf43f5e,
    defaultPlate: 'Espec. 6',
  },
]

const BUILTIN_STATION_IDS = new Set(DESKS.map((d) => d.id))

export interface AgentPlacement {
  agent: AgentInfo
  stationKey: string
  seat: { x: number; y: number }
  rest: { x: number; y: number }
}

export interface OfficePlacementResult {
  visible: AgentPlacement[]
  totalSpecialists: number
  page: number
  totalPages: number
}

/**
 * Calcula de forma determinística e sem sobreposição quais agentes aparecem no
 * escritório e qual estação cada um ocupa (suporta paginação acima de 6 especialistas).
 */
export function computeOfficePlacement(agents: AgentInfo[], requestedPage = 0): OfficePlacementResult {
  const seen = new Set<string>()
  const builtin: AgentInfo[] = []
  const specialists: AgentInfo[] = []

  for (const agent of agents) {
    if (!agent?.id || seen.has(agent.id)) continue
    seen.add(agent.id)
    if (BUILTIN_STATION_IDS.has(agent.id)) {
      builtin.push(agent)
    } else {
      specialists.push(agent)
    }
  }

  const totalSpecialists = specialists.length
  const totalPages = Math.max(1, Math.ceil(totalSpecialists / MAX_VISIBLE_SPECIALISTS))
  const page = Math.min(Math.max(0, requestedPage), totalPages - 1)
  const sliceStart = page * MAX_VISIBLE_SPECIALISTS
  const visibleSpecialists = specialists.slice(sliceStart, sliceStart + MAX_VISIBLE_SPECIALISTS)

  const visible: AgentPlacement[] = []
  for (const agent of builtin) {
    const desk = DESKS.find((d) => d.id === agent.id)!
    visible.push({
      agent,
      stationKey: desk.id,
      seat: { x: (desk.x + 28) * U, y: 59 * U },
      rest: { x: desk.restX * U, y: 73 * U },
    })
  }
  visibleSpecialists.forEach((agent, idx) => {
    const slot = SPECIALIST_SLOTS[idx]
    visible.push({
      agent,
      stationKey: slot.key,
      seat: slot.seat,
      rest: slot.rest,
    })
  })

  return { visible, totalSpecialists, page, totalPages }
}

const C = {
  wallTop: 0x162231,
  wall: 0x1e2d40,
  wallStripe: 0x24364d,
  wood: 0x8a5a3c,
  woodDark: 0x5c3d2a,
  woodMid: 0x7a5238,
  woodLight: 0xb58153,
  woodShine: 0xcf9a68,
  floorA: 0xc9955f,
  floorB: 0xbf8a55,
  floorSeam: 0xa87645,
  corridorCarpet: 0x1f3347,
  corridorBorder: 0x38bdf8,
  paper: 0xf4efe6,
  parchment: 0xf4e4c1,
  red: 0xc0564e,
  redDark: 0xa3443d,
  gold: 0xe8c27a,
  leaf: 0x4f8a5b,
  leafLight: 0x6fae73,
  pot: 0xb5694a,
  metal: 0x3a3f4b,
  metalDark: 0x222630,
  metalLight: 0x555d6e,
  cyan: 0x38bdf8,
  mint: 0x34d399,
  purple: 0xa855f7,
  ink: 0x1e293b,
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
export function drawOffice(scene: Phaser.Scene, callbacks?: OfficeCallbacks): Record<string, Station> {
  const p = painter(scene.add.graphics())

  // Parede tecnológica escuro-petróleo com lambri de madeira aquecida
  p(0, 0, 240, 38, C.wall)
  p(0, 0, 240, 4, C.wallTop)
  for (let x = 4; x < 240; x += 10) p(x, 4, 1, 26, C.wallStripe)
  // Faixa de LED sutil na sanca superior
  p(0, 3, 240, 1, C.cyan, 0.35)
  p(0, 30, 240, 8, C.woodLight)
  p(0, 30, 240, 1, C.woodShine)
  for (let x = 5; x < 240; x += 12) p(x, 32, 1, 5, C.wood)
  p(0, 37, 240, 1, C.woodDark)

  // Piso de tábuas de madeira aquecida com emendas desencontradas
  for (let row = 0, y = 38; y < 132; row++, y += 7) {
    p(0, y, 240, 7, row % 2 ? C.floorA : C.floorB)
    p(0, y + 6, 240, 1, C.floorSeam)
    for (let x = (row * 29) % 46; x < 240; x += 46) p(x, y, 1, 6, C.floorSeam)
  }
  p(0, 38, 240, 2, 0x000000, 0.16)

  // Tapete de circulação central e zona de reunião
  drawRugAndMeetingZone(scene, p, callbacks)

  // Janelas panorâmicas noturnas/entardecer
  drawWindow(scene, p, 12)
  drawWindow(scene, p, 178)

  // Biblioteca do Tutor e Quadro Kanban de Tarefas
  drawBookshelf(scene, p, callbacks)
  drawTaskBoard(scene, p, callbacks)
  drawClock(scene, p)
  drawServerRack(scene, callbacks)

  // Banner flutuante de tooltip para objetos interativos
  const tooltipText = scene.add
    .text(120 * U, 6 * U, '', {
      fontFamily: FONT,
      fontSize: '12px',
      fontStyle: '600',
      color: '#f8fafc',
      backgroundColor: '#0f172acc',
      padding: { x: 8, y: 3 },
      resolution: 2,
    })
    .setOrigin(0.5, 0)
    .setDepth(12_000)
    .setVisible(false)

  const bindHotspot = (
    gx: number,
    gy: number,
    gw: number,
    gh: number,
    label: string,
    onClick: () => void,
  ) => {
    const outline = scene.add
      .rectangle((gx + gw / 2) * U, (gy + gh / 2) * U, gw * U, gh * U)
      .setStrokeStyle(2, C.cyan, 0.9)
      .setFillStyle(C.cyan, 0.08)
      .setDepth(11_000)
      .setVisible(false)

    const zone = scene.add
      .zone((gx + gw / 2) * U, (gy + gh / 2) * U, gw * U, gh * U)
      .setInteractive({ useHandCursor: true })
      .setDepth(11_001)

    zone.on('pointerover', () => {
      outline.setVisible(true)
      tooltipText.setText(`⚡ ${label}`).setVisible(true)
    })
    zone.on('pointerout', () => {
      outline.setVisible(false)
      tooltipText.setVisible(false)
    })
    zone.on('pointerdown', onClick)
  }

  const stations: Record<string, Station> = {}
  for (const desk of DESKS) {
    stations[desk.id] = {
      seat: { x: (desk.x + 28) * U, y: 59 * U },
      wander: { x: (desk.x + 6) * U, y: 78 * U, width: 28 * U, height: 14 * U },
      rest: { x: desk.restX * U, y: 73 * U },
      corridorY: 76 * U,
      led: drawDesk(scene, p, desk.x, desk.plate, desk.id, desk.accent),
    }
    bindHotspot(desk.x, 41, 42, 25, desk.tooltip, () => callbacks?.onSelectAgent?.(desk.id))
  }

  for (const slot of SPECIALIST_SLOTS) {
    const podVisuals = drawSpecialistStation(scene, p, slot)
    stations[slot.key] = {
      seat: slot.seat,
      wander: slot.wander,
      rest: slot.rest,
      corridorY: 76 * U,
      led: podVisuals.led,
      plateText: podVisuals.plateText,
    }
  }

  // Hotspots dos objetos funcionais do escritório
  bindHotspot(135, 7, 30, 20, 'Quadro Kanban · Abrir Projetos e Tarefas', () =>
    callbacks?.onAction?.('tasks'),
  )
  bindHotspot(84, 4, 46, 30, 'Biblioteca Técnica & Perfis · Abrir Central de Agentes', () =>
    callbacks?.onAction?.('agents'),
  )
  bindHotspot(216, 42, 20, 38, 'Rack de Servidores & Logs · Abrir Histórico', () =>
    callbacks?.onAction?.('history'),
  )
  bindHotspot(78, 96, 84, 28, 'Mesa de Comando da Equipe · Acompanhar Missões', () =>
    callbacks?.onAction?.('mission'),
  )

  drawCoffeeCorner(scene)
  drawWaterCooler(scene)
  drawPlant(scene, 3, 114)
  drawPlant(scene, 222, 114)
  return stations
}

function drawWindow(scene: Phaser.Scene, p: Paint, x: number) {
  p(x - 2, 4, 40, 1, C.woodDark)
  p(x, 5, 36, 23, C.woodMid)
  // Céu noturno/crepúsculo tecnológico com horizonte iluminado
  p(x + 2, 7, 32, 6, 0x0f172a)
  p(x + 2, 13, 32, 6, 0x1e3a5f)
  p(x + 2, 19, 32, 4, 0x38bdf8, 0.45)
  // Silhueta de prédios ao fundo
  p(x + 4, 17, 5, 9, 0x0f172a)
  p(x + 10, 14, 6, 12, 0x162231)
  p(x + 19, 16, 5, 10, 0x0f172a)
  p(x + 25, 13, 7, 13, 0x162231)
  // Janelinhas acesas nos prédios e estrelas
  p(x + 12, 16, 1, 1, C.gold)
  p(x + 14, 19, 1, 1, C.cyan)
  p(x + 27, 15, 1, 1, C.gold)
  p(x + 29, 18, 1, 1, C.gold)
  p(x + 7, 9, 1, 1, 0xffffff)
  p(x + 22, 10, 1, 1, 0xffffff)
  // Esquadria da janela
  p(x + 17, 7, 2, 19, C.woodMid)
  p(x + 2, 16, 32, 1, C.woodMid)
  p(x - 1, 28, 38, 2, C.wood)
  // Feixe de luz suave projetado no chão
  const light = scene.add.graphics()
  light.fillStyle(0x7dd3fc, 0.08)
  light.fillPoints(
    [
      { x: (x + 2) * U, y: 40 * U },
      { x: (x + 34) * U, y: 40 * U },
      { x: (x + 40) * U, y: 68 * U },
      { x: (x - 4) * U, y: 68 * U },
    ],
    true,
  )
}

function drawBookshelf(_scene: Phaser.Scene, p: Paint, _callbacks?: OfficeCallbacks) {
  p(84, 4, 46, 30, C.woodMid)
  p(84, 4, 46, 1, C.wood)
  const books = [0xc0564e, 0x38bdf8, 0xe8c27a, 0x6b7fb5, 0x34d399, 0xc98a5a, 0xa855f7]
  for (const shelfY of [6, 20]) {
    p(86, shelfY, 42, 12, 0x3b261a)
    for (let i = 0, x = 87; x < 126; i++, x += 3) {
      if ((i + shelfY) % 7 === 5) continue
      const height = 7 + ((i * 5 + shelfY) % 4)
      p(x, shelfY + 12 - height, 2, height, books[(i + shelfY) % books.length])
    }
  }
  p(89, 1, 4, 3, C.pot)
  p(88, 0, 2, 2, C.leaf)
  p(91, 0, 2, 2, C.leafLight)
}

/** Quadro Kanban de tarefas na parede. */
function drawTaskBoard(scene: Phaser.Scene, p: Paint, _callbacks?: OfficeCallbacks) {
  p(135, 7, 30, 20, C.metalDark)
  p(136, 8, 28, 18, 0x0f172a)
  p(136, 8, 28, 2, C.cyan, 0.8)
  // Colunas Kanban: TODO | EXEC | DONE
  p(145, 10, 1, 15, 0x334155)
  p(154, 10, 1, 15, 0x334155)
  const notes: [number, number, number][] = [
    [138, 12, 0xfbbf24],
    [138, 17, 0xf87171],
    [147, 12, 0x38bdf8],
    [147, 17, 0xa855f7],
    [156, 12, 0x34d399],
    [156, 17, 0x34d399],
  ]
  for (const [x, y, color] of notes) p(x, y, 6, 3, color)
  scene.add
    .text(150 * U, 28 * U, 'KANBAN', { fontFamily: FONT, fontSize: '9px', fontStyle: '700', color: '#94a3b8', resolution: 2 })
    .setOrigin(0.5, 0)
}

/** Relógio de parede com a hora real do computador. */
function drawClock(scene: Phaser.Scene, p: Paint) {
  p(62, 9, 9, 11, C.woodDark)
  p(61, 10, 11, 9, C.woodDark)
  p(63, 10, 7, 9, C.parchment)
  p(62, 11, 9, 7, C.parchment)
  const center = { x: 66.5 * U, y: 14.5 * U }
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

function drawRugAndMeetingZone(scene: Phaser.Scene, p: Paint, _callbacks?: OfficeCallbacks) {
  // Tapete Command Center na zona inferior de reunião
  p(74, 94, 92, 30, C.corridorBorder, 0.5)
  p(75, 95, 90, 28, C.corridorCarpet)
  p(77, 97, 86, 24, 0x162436)

  // Mesa holográfica de comando / arquitetura no centro do tapete
  const table = prop(scene, 114)
  table(96, 113, 48, 2, 0x000000, 0.25)
  table(98, 102, 44, 11, C.woodDark)
  table(96, 100, 48, 8, C.woodMid)
  table(97, 101, 46, 6, 0x0f172a)
  // Blueprint holográfico na mesa de reunião
  table(102, 102, 16, 4, C.cyan, 0.55)
  table(122, 102, 14, 4, C.mint, 0.45)
  table(104, 103, 12, 1, 0xffffff, 0.7)

  scene.add
    .text(120 * U, 116 * U, 'MESA DE MISSÕES', {
      fontFamily: FONT,
      fontSize: '10px',
      fontStyle: '700',
      color: '#7dd3fc',
      backgroundColor: '#090d16cc',
      padding: { x: 6, y: 2 },
      resolution: 2,
    })
    .setOrigin(0.5, 0)
    .setDepth(115 * U)
}

function drawDesk(
  scene: Phaser.Scene,
  base: Paint,
  x: number,
  plate: string,
  agentId: string,
  accent: number,
) {
  // Cadeira ergonômica: fica atrás do personagem
  base(x + 23, 44, 10, 12, C.metalDark)
  base(x + 24, 43, 8, 1, accent)
  base(x + 24, 46, 8, 8, C.metal)

  const p = prop(scene, 66)
  p(x + 1, 66, 40, 2, 0x000000, 0.18)
  p(x + 2, 62, 3, 5, C.woodDark)
  p(x + 37, 62, 3, 5, C.woodDark)
  p(x, 57, 42, 6, C.woodMid)
  p(x, 62, 42, 1, C.woodDark)
  p(x, 51, 42, 6, C.woodLight)
  p(x, 51, 42, 1, C.woodShine)
  // Faixa de cor da especialidade do agente na frente da mesa
  p(x + 2, 57, 38, 1, accent)

  // Monitor principal + detalhes específicos da função
  p(x + 4, 41, 15, 10, C.metalDark)
  p(x + 5, 42, 13, 8, C.metal)
  p(x + 10, 51, 3, 1, C.metalDark)
  p(x + 8, 52, 7, 1, C.metalDark)

  if (agentId === 'dev') {
    // Segundo monitor lateral para o Desenvolvedor
    p(x + 20, 43, 11, 8, C.metalDark)
    p(x + 21, 44, 9, 6, 0x132a2e)
    p(x + 24, 51, 3, 1, C.metalDark)
  } else if (agentId === 'architect') {
    // Blueprint azul aberto na bancada do Arquiteto
    p(x + 21, 52, 10, 4, 0x1d4ed8)
    p(x + 22, 53, 8, 1, 0x93c5fd)
    p(x + 22, 55, 6, 1, 0x93c5fd)
  } else if (agentId === 'qa') {
    // Dispositivo de teste / checklist de validação
    p(x + 21, 52, 8, 4, C.paper)
    p(x + 22, 53, 2, 1, C.mint)
    p(x + 22, 55, 2, 1, C.gold)
  } else {
    // Livros empilhados na bancada do Tutor
    p(x + 21, 51, 7, 2, C.purple)
    p(x + 21, 53, 8, 2, C.gold)
  }

  // Caneca de café na ponta da mesa
  p(x + 35, 49, 3, 3, C.paper)
  p(x + 38, 50, 1, 1, C.paper)
  p(x + 35, 50, 3, 1, accent)

  // Plaquinha com o papel do agente
  p(x + 8, 58, 26, 4, C.parchment)
  scene.add
    .text((x + 21) * U, 60 * U, plate, { fontFamily: FONT, fontSize: '10px', fontStyle: '700', color: '#1e293b', resolution: 2 })
    .setOrigin(0.5)
    .setDepth(66 * U + 1)

  return scene.add
    .rectangle((x + 16) * U, 48 * U, U * 1.5, U * 1.5, C.metalDark)
    .setOrigin(0)
    .setDepth(66 * U + 2)
}

function drawSpecialistStation(
  scene: Phaser.Scene,
  base: Paint,
  slot: (typeof SPECIALIST_SLOTS)[number],
): { led: Phaser.GameObjects.Rectangle; plateText: Phaser.GameObjects.Text } {
  if (slot.podX !== null && slot.podY !== null) {
    const x = slot.podX
    const y = slot.podY
    // Tapete individual da estação de especialista
    base(x - 1, y - 1, 22, 18, C.corridorCarpet, 0.7)
    base(x, y, 20, 1, slot.accent, 0.65)

    const p = prop(scene, y + 14)
    p(x + 1, y + 13, 18, 2, 0x000000, 0.2)
    p(x + 1, y + 6, 18, 7, C.woodMid)
    p(x + 1, y + 5, 18, 2, C.woodLight)
    p(x + 2, y + 7, 16, 1, slot.accent)
    // Terminal compacto
    p(x + 3, y, 9, 6, C.metalDark)
    p(x + 4, y + 1, 7, 4, 0x0f172a)
    p(x + 6, y + 6, 3, 1, C.metalDark)

    // Plaquinha frontal de alto contraste
    p(x + 2, y + 8, 16, 4, 0x0f172a)

    const plateText = scene.add
      .text((x + 10) * U, (y + 10) * U, slot.defaultPlate, {
        fontFamily: FONT,
        fontSize: '10px',
        fontStyle: '700',
        color: '#7dd3fc',
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth((y + 14) * U + 1)

    const led = scene.add
      .rectangle((x + 14) * U, (y + 3) * U, U * 1.5, U * 1.5, C.metalDark)
      .setOrigin(0)
      .setDepth((y + 14) * U + 2)

    return { led, plateText }
  }

  // Estações táticas junto à Mesa de Comando (slot-4 e slot-5)
  const gx = Math.round(slot.seat.x / U)
  const gy = Math.round(slot.seat.y / U)
  base(gx - 5, gy - 2, 10, 4, C.corridorBorder, 0.35)
  const led = scene.add
    .rectangle((gx - 1) * U, (gy - 6) * U, U * 1.5, U * 1.5, C.metalDark)
    .setOrigin(0)
    .setDepth(116 * U)
  base(gx - 4, gy + 2, 8, 4, 0x0f172a)
  const plateText = scene.add
    .text(gx * U, (gy + 4) * U, slot.defaultPlate, {
      fontFamily: FONT,
      fontSize: '10px',
      fontStyle: '700',
      color: '#7dd3fc',
      resolution: 2,
    })
    .setOrigin(0.5)
    .setDepth(116 * U)

  return { led, plateText }
}

function drawServerRack(scene: Phaser.Scene, _callbacks?: OfficeCallbacks) {
  const p = prop(scene, 82)
  const x = 217
  p(x, 79, 18, 2, 0x000000, 0.25)
  p(x + 1, 42, 16, 37, C.metalDark)
  p(x + 2, 43, 14, 35, 0x111827)
  p(x + 1, 42, 16, 2, C.cyan, 0.7)
  for (let bayY = 46; bayY <= 70; bayY += 6) {
    p(x + 3, bayY, 12, 4, C.metal)
    p(x + 4, bayY + 1, 2, 1, C.mint)
    p(x + 7, bayY + 1, 2, 1, C.cyan)
  }
  const blinkLed = scene.add
    .rectangle((x + 12) * U, 47 * U, U, U, C.gold)
    .setOrigin(0)
    .setDepth(82 * U + 1)
  scene.tweens.add({
    targets: blinkLed,
    alpha: 0.2,
    duration: 500,
    yoyo: true,
    repeat: -1,
  })
}

function drawCoffeeCorner(scene: Phaser.Scene) {
  const p = prop(scene, 96)
  p(3, 96, 16, 2, 0x000000, 0.15)
  p(2, 84, 16, 12, C.woodMid)
  p(4, 87, 5, 7, C.wood)
  p(11, 87, 5, 7, C.wood)
  p(2, 82, 16, 3, C.woodShine)
  p(4, 73, 8, 9, C.metal)
  p(5, 74, 6, 3, C.metalDark)
  p(6, 78, 4, 3, C.metalDark)
  p(10, 74, 1, 1, 0xe07a6c)
  p(7, 79, 2, 2, C.paper)
  p(14, 79, 2, 3, C.paper)
  p(14, 80, 2, 1, C.cyan)
}

function drawWaterCooler(scene: Phaser.Scene) {
  const p = prop(scene, 102)
  const x = 223
  p(x, 102, 10, 2, 0x000000, 0.15)
  p(x + 2, 77, 6, 9, 0x7dd3fc)
  p(x + 3, 78, 1, 6, 0xe0f2fe)
  p(x + 3, 76, 4, 1, 0x38bdf8)
  p(x + 1, 86, 8, 16, C.paper)
  p(x + 1, 86, 8, 1, 0xd8d0c0)
  p(x + 3, 90, 1, 2, C.cyan)
  p(x + 6, 90, 1, 2, C.red)
  p(x + 2, 94, 6, 1, 0xd8d0c0)
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
