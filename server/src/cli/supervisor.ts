import { randomBytes } from 'node:crypto'
import { chmodSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Script do guardião: roda como processo Node entre o backend e o CLI. */
export const GUARD_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'guard.ts')
/** Marcador na linha de comando do guardião: identifica processos deste app sem depender de PID. */
export const GUARD_FLAG = '--aidw-guard'
/** Variável que diz ao guardião onde está o canal do supervisor. */
export const SUPERVISOR_ENV = 'AIDW_SUPERVISOR'

export interface GuardSpec {
  file: string
  args: string[]
  verbatim: boolean
}

export interface GuardedProcess {
  token: string
  label: string
  guardPid: number | null
  childPid: number | null
  startedAt: string
}

/**
 * Supervisor dos CLIs. Cada CLI roda sob um guardião (guard.ts) conectado a este canal local
 * (named pipe no Windows, socket Unix no Linux). Se o backend morrer por qualquer motivo, inclusive
 * kill -9, o sistema operacional fecha o canal e o guardião encerra a árvore do CLI. Isso não
 * depende de handler de shutdown.
 *
 * O que NÃO cobre: o guardião ser morto isoladamente, ou um CLI que se desligue da própria árvore
 * de processos (daemons). A garantia completa exige Job Objects / processo supervisor do desktop.
 */
export class ProcessSupervisor {
  readonly address: string
  private readonly server: net.Server
  private readonly pending = new Map<string, { spec: GuardSpec; label: string }>()
  private readonly live = new Map<string, GuardedProcess>()

  private constructor(address: string, server: net.Server) {
    this.address = address
    this.server = server
  }

  static async start(): Promise<ProcessSupervisor> {
    const id = `aidw-${process.pid}-${randomBytes(6).toString('hex')}`
    const address = process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : path.join(tmpdir(), `${id}.sock`)
    const server = net.createServer()
    const supervisor = new ProcessSupervisor(address, server)
    server.on('connection', (socket) => supervisor.accept(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(address, () => {
        if (process.platform !== 'win32') chmodSync(address, 0o600)
        resolve()
      })
    })
    return supervisor
  }

  /** Reserva uma execução: o guardião só recebe a especificação depois de se conectar. */
  register(spec: GuardSpec, label: string): { token: string; command: string; args: string[]; env: NodeJS.ProcessEnv } {
    const token = randomBytes(12).toString('hex')
    this.pending.set(token, { spec, label })
    return {
      token,
      command: process.execPath,
      args: ['--no-warnings', GUARD_SCRIPT, GUARD_FLAG, token],
      env: { [SUPERVISOR_ENV]: this.address },
    }
  }

  /** Processos guardados vivos agora (identificação por missão/sessão). */
  processes(): GuardedProcess[] {
    return [...this.live.values()]
  }

  async close() {
    for (const socket of this.sockets) socket.destroy()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
    if (process.platform !== 'win32') rmSync(this.address, { force: true })
  }

  private readonly sockets = new Set<net.Socket>()

  private accept(socket: net.Socket) {
    this.sockets.add(socket)
    let buffer = ''
    let token: string | null = null
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        let msg: { token?: string; pid?: number; childPid?: number }
        try {
          msg = JSON.parse(line)
        } catch {
          socket.destroy()
          return
        }
        if (token === null) {
          const entry = typeof msg.token === 'string' ? this.pending.get(msg.token) : undefined
          // Token desconhecido ou já usado: o guardião não recebe nada e não inicia o CLI.
          if (!entry) {
            socket.destroy()
            return
          }
          token = msg.token!
          this.pending.delete(token)
          this.live.set(token, { token, label: entry.label, guardPid: msg.pid ?? null, childPid: null, startedAt: new Date().toISOString() })
          socket.write(JSON.stringify(entry.spec) + '\n')
        } else if (typeof msg.childPid === 'number') {
          const proc = this.live.get(token)
          if (proc) proc.childPid = msg.childPid
        }
      }
    })
    const drop = () => {
      this.sockets.delete(socket)
      if (token) this.live.delete(token)
    }
    socket.on('close', drop)
    socket.on('error', drop)
  }
}

let current: ProcessSupervisor | null = null
/** O backend instala o supervisor na inicialização; sem ele os CLIs rodam como antes (testes unitários). */
export const setSupervisor = (s: ProcessSupervisor | null) => {
  current = s
}
export const getSupervisor = () => current
