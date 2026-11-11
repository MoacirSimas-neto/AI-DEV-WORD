import pty from 'node-pty'
import { findCli } from '../cli/probe.ts'
import { planSpawn } from '../cli/run.ts'
import type { PtySpawner } from './manager.ts'

/**
 * Abre o CLI do agente dentro de um pseudo-terminal real, na pasta do projeto.
 * Só o executável do próprio CLI é iniciado: nunca um shell genérico.
 */
export const spawnCliPty: PtySpawner = (cli, cwd, cols, rows) => {
  const executable = findCli(cli)
  if (!executable) throw new Error(`CLI "${cli}" não encontrado no PATH.`)

  const plan = planSpawn(executable, [])
  // No Windows o node-pty aceita a linha de comando pronta como string.
  const args = plan.verbatim ? plan.args.join(' ') : plan.args
  return pty.spawn(plan.file, args, { name: 'xterm-256color', cols, rows, cwd, env: process.env })
}
