import { act, renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { useServer } from './useServer.ts'

test('só um snapshot válido confirma a lista após conexão e reconexão', () => {
  vi.useFakeTimers()
  const sockets: FakeSocket[] = []
  class FakeSocket {
    static CLOSED = 3
    readyState = 3
    onopen?: () => void
    onclose?: () => void
    onmessage?: (event: { data: string }) => void
    constructor() { sockets.push(this) }
    close() {}
    receive(data: object) { this.onmessage?.({ data: JSON.stringify(data) }) }
  }
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
  const { result, unmount } = renderHook(useServer)
  try {
    expect(result.current.agentLoadStatus).toBe('connecting')
    act(() => sockets[0].onopen?.())
    expect(result.current.agentLoadStatus).toBe('loading')
    act(() => sockets[0].receive({ type: 'snapshot', configs: [] }))
    expect(result.current.agentLoadStatus).toBe('error')
    const snapshot = { type: 'snapshot', agents: [], configs: [], allConfigs: [] }
    act(() => sockets[0].receive(snapshot))
    expect(result.current.agentLoadStatus).toBe('ready')
    act(() => sockets[0].onclose?.())
    expect(result.current.agentLoadStatus).toBe('reconnecting')
    act(() => vi.advanceTimersByTime(2000))
    act(() => sockets[1].onopen?.())
    expect(result.current.agentLoadStatus).toBe('loading')
    act(() => sockets[1].receive(snapshot))
    expect(result.current.agentLoadStatus).toBe('ready')
    act(() => sockets[1].receive({ type: 'snapshot-error' }))
    act(() => sockets[1].onclose?.())
    expect(result.current.agentLoadStatus).toBe('error')
  } finally {
    unmount()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})

test('falha de pareamento desktop mostra erro antes de abrir WebSocket', async () => {
  const socket = vi.fn()
  vi.stubGlobal('WebSocket', socket)
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke: async (command: string) => (
    command === 'get_backend_status' ? { status: 'ready', port: 14518 } : { code: 'fixture', port: 14518 }
  ) })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
  const { result, unmount } = renderHook(useServer)
  try {
    await act(async () => {})
    expect(result.current.agentLoadStatus).toBe('error')
    expect(socket).not.toHaveBeenCalled()
  } finally {
    unmount()
    vi.unstubAllGlobals()
  }
})
