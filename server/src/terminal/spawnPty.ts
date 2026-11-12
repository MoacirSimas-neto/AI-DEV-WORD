import pty from 'node-pty'
import { findCli } from '../cli/probe.ts'
import { guardedLaunch, killTreeByPid, planSpawn, type SpawnPlan } from '../cli/run.ts'
import type { PtySpawner } from './manager.ts'

/**
 * Abre o CLI do agente dentro de um pseudo-terminal real, na pasta do projeto.
 * Só o executável do próprio CLI é iniciado: nunca um shell genérico.
 */
export const spawnCliPty: PtySpawner = (cli, cwd, cols, rows, extraArgs = []) => {
  const executable = findCli(cli)
  if (!executable) throw new Error(`CLI "${cli}" não encontrado no PATH.`)

  return spawnGuardedPty(planSpawn(executable, extraArgs), cwd, cols, rows, `terminal · ${cli}`)
}

/**
 * PTY sob o guardião: o CLI herda o terminal do guardião, e a queda do backend (inclusive
 * kill -9) encerra a árvore. Fechar a sessão encerra a árvore inteira, não só o processo do PTY.
 */
export function spawnGuardedPty(plan: SpawnPlan, cwd: string, cols: number, rows: number, label: string, env: NodeJS.ProcessEnv = process.env) {
  const launch = guardedLaunch(plan, env, label)
  // No Windows o node-pty aceita a linha de comando pronta como string.
  const args = launch.verbatim ? launch.args.join(' ') : launch.args
  const term = pty.spawn(launch.file, args, { name: 'xterm-256color', cols, rows, cwd, env: launch.env as Record<string, string> })
  if (!launch.guarded) return term
  const kill = term.kill.bind(term)
  term.kill = (signal?: string) => {
    killTreeByPid(term.pid, process.platform !== 'win32')
    kill(signal)
  }
  return term
}
