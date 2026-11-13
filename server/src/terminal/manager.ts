import { EventEmitter } from 'node:events'
import { statSync } from 'node:fs'
import type { CliId } from '../../../shared/protocol.ts'
import type { AgentRegistry } from '../agents/registry.ts'
import { liveRedaction } from '../security/redact.ts'

/** O mínimo que usamos de um pseudo-terminal (o node-pty satisfaz esta interface). */
export interface PtyLike {
  onData(listener: (data: string) => void): unknown
  onExit(listener: (event: { exitCode: number }) => void): unknown
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export type PtySpawner = (cli: CliId, cwd: string, cols: number, rows: number, args?: string[]) => PtyLike

export interface TerminalOptions {
  /** Sem saída por este tempo, o agente passa de 'working' para 'waiting'. */
  quietMs?: number
  /** Saída logo após uma tecla é eco da digitação, não trabalho do agente. */
  echoMs?: number
  /** Obtém parâmetros adicionais do agente (modelo, esforço) configurados na Central. */
  getArgs?: (agentId: string) => { cli: CliId; args: string[] }
  /** Abre o shell do usuário (terminal pessoal). Sem isto, sessões `user:<n>` são recusadas. */
  spawnShell?: (cwd: string, cols: number, rows: number) => PtyLike
}

/** Terminal pessoal: id fixo `user:<n>`, nunca um id de agente. */
export const isUserShell = (id: string) => /^user:[1-9]\d{0,2}$/.test(id)
const MAX_USER_SHELLS = 8

interface Session {
  pty: PtyLike
  cwd: string
  buffer: string
  lastInput: number
  quietTimer?: NodeJS.Timeout
}

const MAX_BUFFER = 200_000

/**
 * Uma sessão de terminal por agente. A sessão pertence ao backend, não à aba:
 * recarregar a página não mata o CLI, e o `buffer` permite redesenhar a tela.
 * Emite 'data' (agentId, texto) e 'exit' (agentId, código).
 */
export class TerminalManager extends EventEmitter {
  private readonly sessions = new Map<string, Session>()
  private readonly registry: AgentRegistry
  private readonly spawn: PtySpawner
  private readonly activeProjectPath: () => string | null
  private readonly quietMs: number
  private readonly echoMs: number
  private readonly getArgs?: (agentId: string) => { cli: CliId; args: string[] }
  private readonly spawnShell?: (cwd: string, cols: number, rows: number) => PtyLike

  constructor(
    registry: AgentRegistry,
    spawn: PtySpawner,
    activeProjectPath: () => string | null,
    options: TerminalOptions = {},
  ) {
    super()
    this.registry = registry
    this.spawn = spawn
    this.activeProjectPath = activeProjectPath
    this.quietMs = options.quietMs ?? 1500
    this.echoMs = options.echoMs ?? 400
    this.getArgs = options.getArgs
    this.spawnShell = options.spawnShell
  }

  /** Terminais pessoais vivos (a tela e a confirmação de saída leem daqui, não de estado React). */
  userShells(): string[] {
    return [...this.sessions.keys()].filter(isUserShell)
  }

  /** Inicia a sessão (ou reaproveita a existente) e devolve a saída acumulada. */
  open(agentId: string, cols: number, rows: number): string {
    const existing = this.sessions.get(agentId)
    if (existing) {
      existing.pty.resize(cols, rows)
      return existing.buffer
    }

    const userShell = isUserShell(agentId)
    // A pasta vem só do projeto ativo registrado pelo usuário no backend; o cliente nunca envia caminho.
    const cwd = this.activeProjectPath()
    if (!cwd) throw new Error('Escolha um projeto antes de iniciar a sessão.')

    let pty: PtyLike
    if (userShell) {
      if (!this.spawnShell) throw new Error('Terminal pessoal indisponível neste backend.')
      if (this.userShells().length >= MAX_USER_SHELLS) throw new Error(`Limite de ${MAX_USER_SHELLS} terminais pessoais abertos.`)
      if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error('A pasta do projeto não existe mais.')
      pty = this.spawnShell(cwd, cols, rows)
    } else {
      const agent = this.registry.get(agentId)
      if (!agent) throw new Error('Agente desconhecido.')
      const custom = this.getArgs?.(agentId)
      const cli = custom?.cli ?? agent.cli
      if (agent.state === 'offline') throw new Error(`CLI "${cli}" não está disponível.`)
      pty = this.spawn(cli, cwd, cols, rows, custom?.args ?? [])
    }

    const session: Session = { pty, cwd, buffer: '', lastInput: 0 }
    this.sessions.set(agentId, session)
    if (userShell) this.emit('sessions', this.userShells())
    else this.registry.setRuntimeState(agentId, 'waiting', `Sessão aberta em ${cwd}`)

    // A saída do terminal só sai do backend (tela e histórico de rolagem) depois da redação.
    // O que o usuário digita vai ao processo sem alteração.
    const live = liveRedaction((safe) => {
      session.buffer = (session.buffer + safe).slice(-MAX_BUFFER)
      this.emit('data', agentId, safe)
    })
    session.pty.onData((data) => {
      live.write(data)
      if (!userShell && Date.now() - session.lastInput > this.echoMs) this.markWorking(agentId, session)
    })
    session.pty.onExit(({ exitCode }) => {
      live.end()
      clearTimeout(session.quietTimer)
      this.sessions.delete(agentId)
      // 'sessions' sai antes de 'exit': a tela nunca vê "sessão viva" depois do fim (reabriria sozinha).
      if (userShell) this.emit('sessions', this.userShells())
      else this.registry.setRuntimeState(agentId, 'idle', 'Sessão encerrada.')
      this.emit('exit', agentId, exitCode)
    })
    return session.buffer
  }

  write(agentId: string, data: string) {
    const session = this.sessions.get(agentId)
    if (!session) return
    session.lastInput = Date.now()
    session.pty.write(data)
  }

  resize(agentId: string, cols: number, rows: number) {
    this.sessions.get(agentId)?.pty.resize(cols, rows)
  }

  close(agentId: string) {
    this.sessions.get(agentId)?.pty.kill()
  }

  closeAll() {
    for (const session of [...this.sessions.values()]) session.pty.kill()
  }

  private markWorking(agentId: string, session: Session) {
    this.registry.setRuntimeState(agentId, 'working', `Trabalhando em ${session.cwd}`)
    clearTimeout(session.quietTimer)
    session.quietTimer = setTimeout(() => {
      this.registry.setRuntimeState(agentId, 'waiting', `Aguardando você em ${session.cwd}`)
    }, this.quietMs)
  }
}
