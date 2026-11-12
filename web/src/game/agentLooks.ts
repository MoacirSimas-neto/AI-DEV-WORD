// Aparência pixel art dos agentes e presets visuais. Compartilhado entre o mundo Phaser,
// a pré-visualização animada e os retratos em canvas da interface React.

import type { AvatarPreset } from '../../../shared/protocol.ts'

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

export const AVATAR_PRESET_OPTIONS: { id: AvatarPreset; label: string; subtitle: string }[] = [
  { id: 'architect', label: 'Arquiteto', subtitle: 'Traje azul-petróleo e óculos técnicos' },
  { id: 'dev', label: 'Desenvolvedor', subtitle: 'Jaqueta verde-menta com headset' },
  { id: 'qa', label: 'QA / Investigador', subtitle: 'Casaco âmbar com visor analítico' },
  { id: 'tutor', label: 'Tutor / Mentor', subtitle: 'Traje clássico com óculos de leitura' },
  { id: 'designer', label: 'Designer UI/UX', subtitle: 'Estilo criativo coral/magenta com óculos' },
  { id: 'data', label: 'Engenheiro de Dados', subtitle: 'Traje cobalto com visor de telemetria' },
  { id: 'security', label: 'Especialista em Segurança', subtitle: 'Traje tático grafite com headset e visor rubi' },
  { id: 'docs', label: 'Documentador Técnico', subtitle: 'Colete editorial verde-sálvia com óculos' },
  { id: 'specialist', label: 'Especialista Genérico', subtitle: 'Uniforme tecnológico ciano com headset' },
]

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
  designer: {
    hair: '#4a2545',
    hairLight: '#7c3f73',
    skin: '#f3c6a8',
    cheek: '#e89888',
    shirt: '#b83b6a',
    shirtDark: '#822649',
    accent: '#38bdf8', // detalhe ciano criativo
    pants: '#282538',
    glasses: true,
    headset: false,
    visor: false,
  },
  data: {
    hair: '#1e293b',
    hairLight: '#475569',
    skin: '#d9a47c',
    cheek: '#c48362',
    shirt: '#2563eb',
    shirtDark: '#1d4ed8',
    accent: '#34d399', // visor verde telemetria
    pants: '#1e293b',
    glasses: false,
    headset: false,
    visor: true,
  },
  security: {
    hair: '#1f242d',
    hairLight: '#3f4756',
    skin: '#eab68c',
    cheek: '#d4906a',
    shirt: '#27272a',
    shirtDark: '#18181b',
    accent: '#f43f5e', // rubi tático
    pants: '#18181b',
    glasses: false,
    headset: true,
    visor: true,
  },
  docs: {
    hair: '#785032',
    hairLight: '#a1704c',
    skin: '#f4cdb0',
    cheek: '#e5a387',
    shirt: '#3f6a58',
    shirtDark: '#2b4a3d',
    accent: '#fbbf24', // âmbar editorial
    pants: '#334155',
    glasses: true,
    headset: false,
    visor: false,
  },
  specialist: {
    hair: '#334155',
    hairLight: '#64748b',
    skin: '#f1c29a',
    cheek: '#e09a7e',
    shirt: '#0284c7',
    shirtDark: '#0369a1',
    accent: '#22d3ee', // ciano elétrico
    pants: '#1e293b',
    glasses: false,
    headset: true,
    visor: false,
  },
  data_alt: {
    hair: '#0f172a',
    hairLight: '#334155',
    skin: '#8d5524',
    cheek: '#6d3c16',
    shirt: '#0d9488',
    shirtDark: '#0f766e',
    accent: '#f59e0b', // visor âmbar
    pants: '#1e293b',
    glasses: false,
    headset: false,
    visor: true,
  },
  security_alt: {
    hair: '#3f3f46',
    hairLight: '#71717a',
    skin: '#d4a373',
    cheek: '#b88256',
    shirt: '#1e3a8a',
    shirtDark: '#172554',
    accent: '#38bdf8', // visor azul elétrico tático
    pants: '#0f172a',
    glasses: false,
    headset: true,
    visor: true,
  },
  devops: {
    hair: '#3b2219',
    hairLight: '#5c3826',
    skin: '#eab68c',
    cheek: '#d4906a',
    shirt: '#ea580c',
    shirtDark: '#c2410c',
    accent: '#eab308', // headset amarelo
    pants: '#18181b',
    glasses: false,
    headset: true,
    visor: false,
  },
  mobile: {
    hair: '#c29a67',
    hairLight: '#e4c49b',
    skin: '#f4cdb0',
    cheek: '#e5a387',
    shirt: '#4f46e5',
    shirtDark: '#3730a3',
    accent: '#06b6d4',
    pants: '#1e1b4b',
    glasses: true,
    headset: false,
    visor: false,
  },
  ai_researcher: {
    hair: '#94a3b8',
    hairLight: '#cbd5e1',
    skin: '#f0c49b',
    cheek: '#e39e86',
    shirt: '#7c3aed',
    shirtDark: '#5b21b6',
    accent: '#c084fc', // visor violeta
    pants: '#2e1065',
    glasses: false,
    headset: false,
    visor: true,
  },
}

LOOKS.lead = LOOKS.architect
LOOKS.sec = LOOKS.security

export function lookFor(agentId: string, preset?: string, roleOrName?: string): AgentLook {
  // Aliases imediatos por ID do agente
  if (agentId === 'lead' || agentId === 'architect') return LOOKS.architect
  if (agentId === 'sec' || agentId === 'security') return LOOKS.security
  if (agentId === 'dev') return LOOKS.dev
  if (agentId === 'qa') return LOOKS.qa
  if (agentId === 'tutor') return LOOKS.tutor

  const text = `${roleOrName ?? ''} ${preset ?? ''} ${agentId}`.toLowerCase()

  // Heurística determinística de duplicata ou segundo agente da mesma especialidade
  let hash = 0
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0
  }
  const isSecond = /(?:^|\b|\D)(2|3|4|alt|segund|copia|clone|extra|b)(?:\b|\D|$)/i.test(agentId)
    || /(?:^|\b|\D)(2|3|4|alt|segund|copia|clone|extra|b)(?:\b|\D|$)/i.test(text)
    || (hash % 2 === 1)

  // 1. Dados / SQL / Database
  if (text.includes('dado') || text.includes('data') || text.includes('sql') || text.includes('banco') || text.includes('db')) {
    return isSecond ? LOOKS.data_alt : LOOKS.data
  }

  // 2. Segurança / Auditoria
  if (text.includes('seguran') || text.includes('sec') || text.includes('security') || text.includes('audit')) {
    return isSecond ? LOOKS.security_alt : LOOKS.security
  }

  // 3. Design / UI / UX / Frontend
  if (text.includes('design') || text.includes('ui') || text.includes('ux') || text.includes('front') || text.includes('layout')) {
    return LOOKS.designer
  }

  // 4. Documentação / Redação Técnica
  if (text.includes('doc') || text.includes('texto') || text.includes('manual') || text.includes('redat') || text.includes('escrit')) {
    return LOOKS.docs
  }

  // 5. Cloud / DevOps / SRE / Infra
  if (text.includes('cloud') || text.includes('devops') || text.includes('infra') || text.includes('sre') || text.includes('docker') || text.includes('deploy')) {
    return LOOKS.devops
  }

  // 6. Mobile / Apps
  if (text.includes('mobile') || text.includes('app') || text.includes('android') || text.includes('ios') || text.includes('flutter')) {
    return LOOKS.mobile
  }

  // 7. IA / Machine Learning / Pesquisa
  if (text.includes('ia') || text.includes('ai') || text.includes('pesquis') || text.includes('research') || text.includes('llm') || text.includes('prompt')) {
    return LOOKS.ai_researcher
  }

  // 8. QA / Qualidade / Testes
  if (text.includes('qa') || text.includes('qualidade') || text.includes('test')) {
    return LOOKS.qa
  }

  // 9. Arquiteto / Tech Lead
  if (text.includes('arquit') || text.includes('lead')) {
    return LOOKS.architect
  }

  // 10. Desenvolvedor
  if (text.includes('dev') || text.includes('desenvolv') || text.includes('coder') || text.includes('software')) {
    return LOOKS.dev
  }

  // 11. Tutor / Mentor
  if (text.includes('tutor') || text.includes('mentor') || text.includes('ensin')) {
    return LOOKS.tutor
  }

  // 12. Se um preset explícito foi passado e não for o genérico 'specialist'
  if (preset && preset !== 'specialist' && LOOKS[preset]) {
    return LOOKS[preset]
  }

  if (LOOKS[agentId]) return LOOKS[agentId]

  // 13. Variação determinística entre 10 estilos únicos para especialistas sem especialidade identificada
  const VARIANTS = [
    LOOKS.data,
    LOOKS.security,
    LOOKS.designer,
    LOOKS.docs,
    LOOKS.devops,
    LOOKS.mobile,
    LOOKS.ai_researcher,
    LOOKS.data_alt,
    LOOKS.security_alt,
    LOOKS.specialist,
  ]
  return VARIANTS[hash % VARIANTS.length]
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
