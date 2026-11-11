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
  private readonly db: DatabaseSync

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

  /** Registra uma pasta existente e a torna o projeto ativo. */
  add(rawPath: string) {
    const input = rawPath.trim().replace(/^"(.*)"$/, '$1')
    if (!path.isAbsolute(input)) throw new Error('Informe o caminho completo da pasta.')

    let folder: string
    try {
      folder = realpathSync.native(input)
      if (!statSync(folder).isDirectory()) throw new Error('não é pasta')
    } catch {
      throw new Error(`Pasta não encontrada: ${input}`)
    }

    this.db
      .prepare('INSERT OR IGNORE INTO projects (name, path, created_at) VALUES (?, ?, ?)')
      .run(path.basename(folder) || folder, folder, new Date().toISOString())
    const row = this.db.prepare('SELECT id FROM projects WHERE path = ?').get(folder)
    this.select(Number(row!.id))
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
