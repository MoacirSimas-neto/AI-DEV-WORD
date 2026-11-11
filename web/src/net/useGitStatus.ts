import { useEffect, useState } from 'react'
import type { GitStatus } from '../../../shared/protocol.ts'
import type { Send, Subscribe } from './useServer.ts'

const POLL_MS = 5000

/**
 * Estado Git do projeto ativo. Consulta de tempos em tempos porque quem altera
 * os arquivos são os agentes, por fora da interface.
 */
export function useGitStatus(send: Send, subscribe: Subscribe, online: boolean, projectId: number | null) {
  const [status, setStatus] = useState<GitStatus | null>(null)

  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'git-status') setStatus(message.status)
      }),
    [subscribe],
  )

  useEffect(() => {
    if (!online) return
    const ask = () => send({ type: 'git-status' })
    ask()
    const timer = setInterval(ask, POLL_MS)
    return () => clearInterval(timer)
  }, [online, projectId, send])

  return projectId === null ? null : status
}
