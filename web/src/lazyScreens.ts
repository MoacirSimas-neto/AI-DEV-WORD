import { lazy } from 'react'

// Módulos pesados fora do JavaScript inicial. O estado da aplicação vive em useServer (App),
// então carregar uma tela sob demanda não perde nada além do que já se perdia ao trocar de aba.
const loaders = {
  phaser: () => import('./game/PhaserGame.tsx'),
  terminal: () => import('./ui/TerminalView.tsx'),
  tasks: () => import('./ui/TaskPanel.tsx'),
  history: () => import('./ui/HistoryPanel.tsx'),
  agents: () => import('./ui/AgentCenter.tsx'),
  memory: () => import('./ui/MemoryCenter.tsx'),
  observability: () => import('./ui/ObservabilityCenter.tsx'),
  home: () => import('./ui/HomeView.tsx'),
  prototypes: () => import('./prototypes/PrototypeShowcase.tsx'),
}

export const LazyPhaserGame = lazy(() => loaders.phaser().then((m) => ({ default: m.PhaserGame })))
export const LazyTerminalView = lazy(() => loaders.terminal().then((m) => ({ default: m.TerminalView })))
export const LazyTaskPanel = lazy(() => loaders.tasks().then((m) => ({ default: m.TaskPanel })))
export const LazyHistoryPanel = lazy(() => loaders.history().then((m) => ({ default: m.HistoryPanel })))
export const LazyAgentCenter = lazy(() => loaders.agents().then((m) => ({ default: m.AgentCenter })))
export const LazyMemoryCenter = lazy(() => loaders.memory().then((m) => ({ default: m.MemoryCenter })))
export const LazyObservabilityCenter = lazy(() => loaders.observability().then((m) => ({ default: m.ObservabilityCenter })))
export const LazyHomeView = lazy(() => loaders.home().then((m) => ({ default: m.HomeView })))
export const LazyPrototypeShowcase = lazy(() => loaders.prototypes().then((m) => ({ default: m.PrototypeShowcase })))

/**
 * Depois que a tela inicial está de pé, baixa as telas de uso comum em segundo plano para a
 * primeira troca de aba não esperar a rede. Protótipos ficam de fora (só sob demanda).
 */
export function prefetchScreens() {
  const run = () => {
    for (const key of ['tasks', 'agents', 'observability', 'memory', 'history', 'terminal'] as const) void loaders[key]().catch(() => undefined)
  }
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 4000 })
  else setTimeout(run, 2000)
}
