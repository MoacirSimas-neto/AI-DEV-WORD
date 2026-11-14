import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type {
  KnowledgeDocKind,
  RoleCategory,
  SpecializationId,
  SpecializationInfo,
} from '../../../shared/protocol.ts'

export const DEFAULT_KNOWLEDGE_ROOT = path.resolve(import.meta.dirname, '../../../knowledge')

interface SpecializationCatalogEntry {
  id: SpecializationId
  name: string
  codename: string
  roleCategory: RoleCategory
  description: string
  defaultAgentId: string
  agentFile: string | null
  knowledgeDir: string | null
}

const CATALOG: Record<SpecializationId, SpecializationCatalogEntry> = {
  none: {
    id: 'none',
    name: 'Sem especialização',
    codename: '',
    roleCategory: 'developing',
    description: 'Usa apenas o papel da etapa, sem documentos de especialização.',
    defaultAgentId: '',
    agentFile: null,
    knowledgeDir: null,
  },
  'tech-lead': {
    id: 'tech-lead',
    name: 'Tech Lead',
    codename: 'O Arquiteto',
    roleCategory: 'planning',
    description: 'Líder técnico: coordena arquitetura, análise de alternativas, riscos e planejamento.',
    defaultAgentId: 'architect',
    agentFile: 'agents/tech-lead.md',
    knowledgeDir: 'tech-lead',
  },
  developer: {
    id: 'developer',
    name: 'Developer',
    codename: 'O Programador Pragmático',
    roleCategory: 'developing',
    description: 'Desenvolvedor pragmático: implementa código claro, seguro, incremental e verificável.',
    defaultAgentId: 'dev',
    agentFile: 'agents/developer.md',
    knowledgeDir: 'developer',
  },
  'qa-tester': {
    id: 'qa-tester',
    name: 'QA Engineer',
    codename: 'O Investigador',
    roleCategory: 'reviewing',
    description: 'Engenheiro de qualidade: investigação técnica, reprodução de falhas, análise de riscos e validação independente.',
    defaultAgentId: 'qa',
    agentFile: 'agents/qa-tester.md',
    knowledgeDir: 'qa-tester',
  },
  tutor: {
    id: 'tutor',
    name: 'Tutor',
    codename: 'O Mentor Técnico',
    roleCategory: 'teaching',
    description: 'Mentor didático: explica conceitos, guia por raciocínio progressivo e apoia o aprendizado.',
    defaultAgentId: 'tutor',
    agentFile: null,
    knowledgeDir: null,
  },
}

const AGENT_TO_SPECIALIZATION: Record<string, SpecializationId> = {
  none: 'none',
  architect: 'tech-lead',
  'tech-lead': 'tech-lead',
  dev: 'developer',
  developer: 'developer',
  qa: 'qa-tester',
  'qa-tester': 'qa-tester',
  tutor: 'tutor',
}

/** Remove frontmatter YAML e referências a ferramentas internas de IDE (`invoke_subagent`, etc.). */
export function sanitizeAgentMarkdown(raw: string): string {
  // Remove bloco YAML inicial (--- ... ---)
  const withoutFrontmatter = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, '')
  // Filtra linhas que mencionem ferramentas exclusivas de runtime interno
  // A seção "Base de conhecimento" manda ler knowledge/*.md, que não existe na pasta
  // do projeto da missão: os trechos relevantes já vão embutidos no prompt.
  const withoutLibrary = withoutFrontmatter.replace(/^## Base de conhecimento\r?\n[\s\S]*?(?=^## |(?![\s\S]))/m, '')
  const lines = withoutLibrary.split(/\r?\n/).filter((line) => {
    return !/\b(invoke_subagent|view_file|grep_search|replace_file_content)\b|knowledge\//i.test(line)
  })
  return lines.join('\n').trim()
}

/** Extrai seções principais de um Markdown até o limite de caracteres estipulado. */
export function extractMarkdownExcerpt(markdown: string, maxChars: number): string {
  const clean = markdown.trim()
  if (clean.length <= maxChars) return clean
  const sliced = clean.slice(0, maxChars)
  const lastHeading = sliced.lastIndexOf('\n## ')
  if (lastHeading > maxChars * 0.5) {
    return `${sliced.slice(0, lastHeading).trim()}\n\n[...conteúdo condensado para caber no orçamento de prompt...]`
  }
  return `${sliced.trim()}\n\n[...conteúdo condensado para caber no orçamento de prompt...]`
}

// O que cada função mais precisa: desempata seções quando a tarefa não cita o tema.
const ROLE_FOCUS: Record<SpecializationId, string> = {
  none: '',
  'tech-lead': 'arquitetura alternativas decisao riscos planejamento requisitos delegacao',
  developer: 'implementar codigo verificar testes erros seguranca requisitos entrega',
  'qa-tester': 'testes evidencias defeitos investigacao classificacao riscos cobertura regressao',
  tutor: '',
}
const MAX_SECTION_CHARS = 1200

/** Radicais (6 letras, sem acento) das palavras com 5+ letras: "testes" e "testar" casam. */
export function stems(text: string): Set<string> {
  const plain = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return new Set((plain.match(/[a-z]{5,}/g) ?? []).map((w) => w.slice(0, 6)))
}

/**
 * Escolhe as seções (## e ###) mais relevantes para a tarefa até o orçamento,
 * devolvendo-as na ordem original. Peso 3 no título, 2 para termos da tarefa
 * no corpo e 1 para o foco da função.
 */
export function selectRelevantSections(markdown: string, taskText: string, roleFocus: string, maxChars: number): string {
  const task = stems(taskText)
  const role = stems(roleFocus)
  const ranked = markdown
    .split(/^(?=#{2,3} )/m)
    .map((s) => s.trim())
    .filter((s) => /^#{2,3} /.test(s))
    .map((text, index) => {
      const heading = stems(text.split('\n', 1)[0])
      const body = stems(text)
      let score = 0
      for (const s of task) score += (heading.has(s) ? 3 : 0) + (body.has(s) ? 2 : 0)
      for (const s of role) score += (heading.has(s) ? 3 : 0) + (body.has(s) ? 1 : 0)
      return { text: extractMarkdownExcerpt(text, MAX_SECTION_CHARS), index, score }
    })
  const picked: typeof ranked = []
  let used = 0
  for (const section of [...ranked].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (used + section.text.length > maxChars) continue
    picked.push(section)
    used += section.text.length + 2
  }
  return picked
    .sort((a, b) => a.index - b.index)
    .map((s) => s.text)
    .join('\n\n')
}

export interface KnowledgeSelectionOptions {
  /** Texto da tarefa/missão para decidir seletivamente quais documentos anexar. */
  taskContext?: string
  /** Força inclusão do dossiê de especialistas. */
  includeDossier?: boolean
  /** Força inclusão das referências bibliográficas. */
  includeReferences?: boolean
  /** Limite máximo de caracteres do bloco de conhecimento retornado (padrão: 6500). */
  maxChars?: number
}

export interface ResolvedSpecializationContext {
  specialization: SpecializationInfo
  loadedDocs: KnowledgeDocKind[]
  missingDocs: KnowledgeDocKind[]
  promptBlock: string
}

export class SpecializationRegistry {
  private readonly rootDir: string
  private readonly fileCache = new Map<string, string>()

  constructor(rootDir: string = DEFAULT_KNOWLEDGE_ROOT) {
    this.rootDir = rootDir
  }

  /** Verifica se uma string corresponde a uma especialização registrada. */
  hasSpecialization(id: string): id is SpecializationId {
    return Object.prototype.hasOwnProperty.call(CATALOG, id)
  }

  /** Retorna a especialização padrão para uma categoria de atuação. */
  defaultForCategory(category: RoleCategory): SpecializationId {
    switch (category) {
      case 'planning':
        return 'tech-lead'
      case 'developing':
        return 'developer'
      case 'reviewing':
        return 'qa-tester'
      case 'teaching':
        return 'tutor'
    }
  }

  /** Retorna a especialização associada a um `agentId` ou `specializationId`. */
  resolveId(agentOrSpecId: string): SpecializationId {
    return AGENT_TO_SPECIALIZATION[agentOrSpecId] ?? 'developer'
  }

  /** Lista todas as especializações disponíveis e verifica quais documentos existem no disco. */
  list(): SpecializationInfo[] {
    return (Object.keys(CATALOG) as SpecializationId[]).filter((id) => id !== 'none').map((id) => this.getInfo(id))
  }

  getInfo(id: SpecializationId): SpecializationInfo {
    const entry = CATALOG[id]
    const availableDocs: KnowledgeDocKind[] = []
    if (entry.agentFile && this.hasFile(entry.agentFile)) availableDocs.push('agent')
    if (entry.knowledgeDir) {
      if (this.hasFile(`${entry.knowledgeDir}/principios.md`)) availableDocs.push('principios')
      if (this.hasFile(`${entry.knowledgeDir}/dossie.md`)) availableDocs.push('dossie')
      if (this.hasFile(`${entry.knowledgeDir}/referencias.md`)) availableDocs.push('referencias')
    }
    return {
      id: entry.id,
      name: entry.name,
      codename: entry.codename,
      roleCategory: entry.roleCategory,
      description: entry.description,
      defaultAgentId: entry.defaultAgentId,
      knowledgeDir: entry.knowledgeDir,
      availableDocs,
    }
  }

  /** Lê um documento específico (`agent`, `principios`, `dossie`, `referencias`) da especialização. */
  readDocument(id: SpecializationId, kind: KnowledgeDocKind): string | null {
    const entry = CATALOG[id]
    if (!entry) return null
    let relPath: string | null = null
    if (kind === 'agent') relPath = entry.agentFile
    else if (entry.knowledgeDir) relPath = `${entry.knowledgeDir}/${kind}.md`
    if (!relPath) return null

    const content = this.readFileSafe(relPath)
    if (content === null) return null
    return kind === 'agent' ? sanitizeAgentMarkdown(content) : content.trim()
  }

  /**
   * Seleciona e condensa o conhecimento relevante para uma missão ou tarefa,
   * sem despejar todos os arquivos em todos os prompts.
   */
  resolveForTask(
    agentOrSpecId: string,
    options: KnowledgeSelectionOptions = {},
  ): ResolvedSpecializationContext {
    const specId = this.resolveId(agentOrSpecId)
    const info = this.getInfo(specId)
    const maxChars = options.maxChars ?? 6500
    const contextText = (options.taskContext ?? '').toLowerCase()
    const pick = (doc: string, share: number) =>
      selectRelevantSections(doc, contextText, ROLE_FOCUS[specId], Math.floor(maxChars * share)) ||
      extractMarkdownExcerpt(doc, Math.floor(maxChars * share))

    const loadedDocs: KnowledgeDocKind[] = []
    const missingDocs: KnowledgeDocKind[] = []
    const sections: string[] = []

    // 1. Definição base do papel (identidade, responsabilidades, formato e limites)
    const agentDoc = this.readDocument(specId, 'agent')
    if (agentDoc) {
      loadedDocs.push('agent')
      sections.push(extractMarkdownExcerpt(agentDoc, Math.floor(maxChars * 0.3)))
    } else if (CATALOG[specId].agentFile) {
      missingDocs.push('agent')
    }

    // 2. Princípios operacionais e protocolos de verificação (sempre prioritários)
    const principiosDoc = this.readDocument(specId, 'principios')
    if (principiosDoc) {
      loadedDocs.push('principios')
      sections.push(pick(principiosDoc, 0.6))
    } else if (info.knowledgeDir) {
      missingDocs.push('principios')
    }

    // 3. Carregamento seletivo de Dossiê e Referências apenas quando solicitado ou relevante ao tema
    const needsDossier =
      options.includeDossier === true ||
      /(arquitet|refator|concorr[eê]nc|distribu[ií]d|explorat[oó]ri|dossi[eê]|teori|complexidad|legad)/i.test(
        contextText,
      )
    if (needsDossier && info.knowledgeDir) {
      const dossieDoc = this.readDocument(specId, 'dossie')
      if (dossieDoc) {
        loadedDocs.push('dossie')
        sections.push(pick(dossieDoc, 0.25))
      } else {
        missingDocs.push('dossie')
      }
    }

    const needsReferences =
      options.includeReferences === true ||
      /(refer[eê]nc|bibliogr|autor|fonte|cita[cç]|estud|aprend|ensina|did[aá]tic)/i.test(contextText)
    if (needsReferences && info.knowledgeDir) {
      const refDoc = this.readDocument(specId, 'referencias')
      if (refDoc) {
        loadedDocs.push('referencias')
        sections.push(pick(refDoc, 0.2))
      } else {
        missingDocs.push('referencias')
      }
    }

    // Fallback para o Tutor (usa Modo Aprendizado consolidado)
    if (specId === 'tutor' && sections.length === 0) {
      sections.push(
        [
          '# Tutor — O Mentor Técnico',
          '- Priorize explicações progressivas, dicas e raciocínio estruturado.',
          '- Incentive o usuário a formular hipóteses antes de entregar soluções prontas.',
          '- Diferencie fatos observados no código de inferências conceituais.',
        ].join('\n'),
      )
    }

    const combined = extractMarkdownExcerpt(sections.join('\n\n---\n\n'), maxChars)

    return {
      specialization: info,
      loadedDocs,
      missingDocs,
      promptBlock: combined,
    }
  }

  private hasFile(relPath: string): boolean {
    return existsSync(path.join(this.rootDir, relPath))
  }

  private readFileSafe(relPath: string): string | null {
    const fullPath = path.join(this.rootDir, relPath)
    if (this.fileCache.has(fullPath)) return this.fileCache.get(fullPath)!
    if (!existsSync(fullPath)) return null
    try {
      const text = readFileSync(fullPath, 'utf8')
      this.fileCache.set(fullPath, text)
      return text
    } catch {
      return null
    }
  }
}

export const defaultSpecializations = new SpecializationRegistry()
