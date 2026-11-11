// Aparência pixel art original dos 4 agentes. Compartilhado entre o mundo Phaser
// e os retratos em canvas da interface React (Home, Central de Agentes, Roster).

export type Palette = Record<string, string>

export interface AgentLook {
  hair: string
  hairLight: string
  skin: string
  cheek: string
  shirt: string
  shirtDark: string
  accent: string
  pants: string
  glasses: boolean
  headset: boolean
  visor: boolean
}

const LOOKS: Record<string, AgentLook> = {
  architect: {
    hair: '#2a3042',
    hairLight: '#505b78',
    skin: '#f2c9a0',
    cheek: '#e6a48e',
    shirt: '#214e63',
    shirtDark: '#163747',
    accent: '#9d74e8', // acento roxo IA / gravata técnica
    pants: '#252c3d',
    glasses: true,
    headset: false,
    visor: false,
  },
  dev: {
    hair: '#5c3c28',
    hairLight: '#855a3e',
    skin: '#f0c49b',
    cheek: '#e39e86',
    shirt: '#2c8c72',
    shirtDark: '#1e6652',
    accent: '#4de6b8', // verde menta nos detalhes e headset
    pants: '#2d3748',
    glasses: false,
    headset: true,
    visor: false,
  },
  qa: {
    hair: '#9e4238',
    hairLight: '#c95c50',
    skin: '#f4cdb0',
    cheek: '#e8a690',
    shirt: '#d48c32',
    shirtDark: '#a3681e',
    accent: '#5ce0d8', // visor analítico ciano/menta
    pants: '#2e3440',
    glasses: false,
    headset: false,
    visor: true,
  },
  tutor: {
    hair: '#c8c2b8',
    hairLight: '#e8e2d8',
    skin: '#f0c69e',
    cheek: '#e2a088',
    shirt: '#8a5a3c',
    shirtDark: '#633e27',
    accent: '#f0bd5e', // detalhe âmbar/creme de mentor
    pants: '#3b4254',
    glasses: true,
    headset: false,
    visor: false,
  },
}

export function lookFor(agentId: string): AgentLook {
  return LOOKS[agentId] ?? LOOKS.dev
}

export function paletteFor(look: AgentLook): Palette {
  return {
    o: '#1a1621', // contorno escuro nítido
    h: look.hair,
    H: look.hairLight,
    s: look.skin,
    k: look.cheek,
    e: '#1e1b24', // pupila
    w: '#f6f8fa', // brilho ocular
    g: '#d8a84e', // armação óculos
    L: '#d8f0ff', // lente óculos
    v: look.accent, // visor / headset / gravata / insígnia
    c: look.shirt,
    C: look.shirtDark,
    p: look.pants,
    b: '#1f1c26', // calçado
  }
}

export type Frame = 'stand' | 'step' | 'stepAlt' | 'blink' | 'work1' | 'work2'

const HEAD_STANDARD = [
  '....oooooooo....',
  '...ohhHHhhhho...',
  '..ohhHHhhhhhho..',
  '..ohhhhhhhhhho..',
  '..ohhsssssshho..',
  '..ohssssssssho..',
]

const HEAD_HEADSET = [
  '....oooooooo....',
  '...ovvvvvvvvo...',
  '..ovhhHHhhhhvo..',
  '..vohhhhhhhhov..',
  '..vohhssssshov..',
  '..vohssssssshv..',
]

const EYES_NORMAL = {
  open: ['..oswewsswewso..', '..osssssssssso..'],
  closed: ['..osssssssssso..', '..osooossoooso..'],
}

const EYES_GLASSES = {
  open: ['..ogLeLggLeLgo..', '..osLeLssLeLso..'],
  closed: ['..ogLLLggLLLgo..', '..osLLLssLLLso..'],
}

const EYES_VISOR = {
  open: ['..ovvvvvvvvvvo..', '..osvvvssvvvso..'],
  closed: ['..ovooooooooovo..', '..osssssssssso..'],
}

const TORSO_STAND = [
  '..osksssssskso..',
  '...osssssssso...',
  '....oooooooo....',
  '...occcvvccco...',
  '..occccvvcccco..',
  '..oscccvvcccso..',
  '..osCCCvvCCCso..',
  '...oCCCCCCCCo...',
  '...oppppppppo...',
]

const TORSO_WORK_1 = [
  '..osksssssskso..',
  '...osssssssso...',
  '....oooooooo....',
  '...occcvvccco...',
  '..occccvvcccco..',
  '..sscccvvcccoo..',
  '..ooCCCvvCCCss..',
  '...oCCCCCCCCo...',
  '...oppppppppo...',
]

const TORSO_WORK_2 = [
  '..osksssssskso..',
  '...osssssssso...',
  '....oooooooo....',
  '...occcvvccco...',
  '..occccvvcccco..',
  '..oocccvvcccss..',
  '..ssCCCvvCCCoo..',
  '...oCCCCCCCCo...',
  '...oppppppppo...',
]

const LEGS = {
  stand: ['...oppp..pppo...', '...obbb..bbbo...', '...oooo..oooo...'],
  step: ['...oppp...ppo...', '...obbb...bbo...', '...oooo...ooo...'],
  stepAlt: ['...opp...pppo...', '...obb...bbbo...', '...ooo...oooo...'],
}

export function characterRows(look: AgentLook, frame: Frame): string[] {
  const head = look.headset ? HEAD_HEADSET : HEAD_STANDARD
  const eyeSet = look.visor ? EYES_VISOR : look.glasses ? EYES_GLASSES : EYES_NORMAL
  const eyes = eyeSet[frame === 'blink' ? 'closed' : 'open']

  let torso = TORSO_STAND
  if (frame === 'work1') torso = TORSO_WORK_1
  else if (frame === 'work2') torso = TORSO_WORK_2

  let legs = LEGS.stand
  if (frame === 'step') legs = LEGS.step
  else if (frame === 'stepAlt') legs = LEGS.stepAlt

  return [...head, ...eyes, ...torso, ...legs]
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
