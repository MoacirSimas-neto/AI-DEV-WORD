import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ProjectInfo, Workspace } from '../../../shared/protocol.ts'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

/**
 * Projetos = diretórios que o usuário autorizou. Os agentes só são iniciados
 * dentro do projeto ativo; nenhum outro caminho chega aos CLIs.
 */
export class ProjectStore {
  /** Conexão compartilhada com as tarefas e o histórico (mesmo arquivo). */
  readonly db: DatabaseSync

  /** Use ':memory:' nos testes. */
  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(SCHEMA)
  }

  workspace(): Workspace {
    const projects = this.db
      .prepare('SELECT id, name, path FROM projects ORDER BY name COLLATE NOCASE')
      .all() as unknown as ProjectInfo[]
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'active_project'").get()
    const activeId = row ? Number(row.value) : null
    return {
      projects: projects.map((p) => ({ id: p.id, name: p.name, path: p.path })),
      activeProjectId: projects.some((p) => p.id === activeId) ? activeId : null,
    }
  }

  active(): ProjectInfo | null {
    const { projects, activeProjectId } = this.workspace()
    return projects.find((p) => p.id === activeProjectId) ?? null
  }

  get(projectId: number): ProjectInfo | null {
    return this.workspace().projects.find((p) => p.id === projectId) ?? null
  }

  /** Registra uma pasta existente e a torna o projeto ativo. */
  add(rawPath: string) {
    const unquoted = rawPath.trim().replace(/^["'](.*)["']$/, '$1').trim()
    if (!unquoted) throw new Error('Informe o caminho completo da pasta.')
    if (!path.isAbsolute(unquoted)) throw new Error('Informe o caminho completo da pasta.')
    const input = path.resolve(unquoted)

    let folder: string
    try {
      folder = realpathSync.native(input)
      if (!statSync(folder).isDirectory()) throw new Error('não é pasta')
    } catch {
      throw new Error(`Pasta não encontrada: ${input}`)
    }

    let id = Number(this.db.prepare('SELECT id FROM projects WHERE path = ?').get(folder)?.id ?? 0)
    if (!id) {
      // O id nunca é reutilizado: tarefas e memórias de um projeto removido não
      // podem reaparecer num projeto novo que herdasse o mesmo número.
      const seq = this.db.prepare("SELECT value FROM settings WHERE key = 'project_seq'").get()
      const max = this.db.prepare('SELECT COALESCE(MAX(id), 0) AS max FROM projects').get()
      id = Math.max(Number(seq?.value ?? 0), Number(max!.max)) + 1
      this.db
        .prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)')
        .run(id, path.basename(folder) || folder, folder, new Date().toISOString())
      this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('project_seq', ?)").run(String(id))
    }
    this.select(id)
  }

  select(projectId: number) {
    if (!this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) {
      throw new Error('Projeto desconhecido.')
    }
    this.db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_project', ?)")
      .run(String(projectId))
  }

  /** Só tira da lista: nunca apaga arquivos do disco. */
  remove(projectId: number) {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
  }

  close() {
    this.db.close()
  }
}
