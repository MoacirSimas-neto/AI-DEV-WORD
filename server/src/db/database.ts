import { DatabaseSync } from 'node:sqlite'

/** Quanto uma escrita espera por outra conexão antes de desistir com SQLITE_BUSY. */
export const BUSY_TIMEOUT_MS = 5000

/**
 * Abre o banco do app com as mesmas regras para toda conexão:
 * - busy_timeout: uma escrita concorrente espera em vez de falhar na hora;
 * - WAL (só em arquivo): leitores não bloqueiam o escritor e um encerramento
 *   abrupto é recuperado pelo próprio SQLite na próxima abertura;
 * - synchronous FULL (padrão do SQLite) mantido: integridade antes de velocidade.
 * WAL não impede duas instâncias de escreverem no mesmo banco: isso é papel de
 * acquireInstanceLock.
 */
export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  if (file !== ':memory:' && file !== '') {
    const row = db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode?: string } | undefined
    if (row?.journal_mode !== 'wal') {
      // Sistemas de arquivos sem memória compartilhada (ex.: rede) recusam WAL; o banco segue no modo anterior.
      console.warn(`SQLite: WAL indisponível para ${file} (modo atual: ${row?.journal_mode ?? 'desconhecido'}).`)
    }
  }
  return db
}

export type InstanceLock = { readonly file: string; release(): void }

/**
 * Garante uma única instância do backend por pasta de dados.
 * O arquivo de trava é um banco SQLite em locking_mode=EXCLUSIVE: a trava é do
 * sistema operacional e some sozinha quando o processo morre (queda, kill, falta
 * de luz), então não há PID obsoleto para limpar nem risco de reuso de PID.
 */
export function acquireInstanceLock(lockFile: string): InstanceLock {
  const db = new DatabaseSync(lockFile)
  try {
    db.exec('PRAGMA busy_timeout = 0')
    db.exec('PRAGMA locking_mode = EXCLUSIVE')
    // A trava não guarda nada importante: sem arquivo de journal sobrando ao lado.
    db.exec('PRAGMA journal_mode = MEMORY')
    // A primeira escrita prende a trava exclusiva até a conexão fechar.
    db.exec('CREATE TABLE IF NOT EXISTS owner (pid INTEGER NOT NULL, started_at TEXT NOT NULL)')
    db.exec('BEGIN EXCLUSIVE')
    db.exec('DELETE FROM owner')
    db.prepare('INSERT INTO owner (pid, started_at) VALUES (?, ?)').run(process.pid, new Date().toISOString())
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.close()
    } catch {}
    if (isBusyError(error)) {
      throw new Error(
        `Outra instância do AI Dev World já está usando estes dados (${lockFile}). ` +
          'Feche a outra cópia ou use outra pasta em AIDW_DATA_DIR.',
      )
    }
    throw error
  }
  let released = false
  return {
    file: lockFile,
    release() {
      if (released) return
      released = true
      db.close()
    },
  }
}

/** SQLITE_BUSY (5) ou SQLITE_LOCKED (6), inclusive códigos estendidos. */
export function isBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { errcode?: unknown }).errcode
  if (typeof code === 'number' && ((code & 0xff) === 5 || (code & 0xff) === 6)) return true
  return /database is locked|database table is locked/i.test(error.message)
}

/** Mensagem legível para a interface quando o banco ficou ocupado além do busy_timeout. */
export function describeDatabaseError(error: unknown): string | null {
  if (!isBusyError(error)) return null
  return 'O banco de dados local está ocupado por outro processo. Aguarde alguns segundos e tente de novo.'
}

/** Executa fn numa transação de escrita; desfaz tudo se fn lançar. */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
