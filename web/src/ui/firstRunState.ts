export type FirstRunState = {
  completed: boolean
  lastStep: number
}

const STORAGE_KEY = 'aidw.firstRun.v1'

export function loadFirstRunState(): FirstRunState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { completed: false, lastStep: 0 }
    const parsed = JSON.parse(raw) as Partial<FirstRunState>
    return {
      completed: Boolean(parsed.completed),
      lastStep: typeof parsed.lastStep === 'number' ? parsed.lastStep : 0,
    }
  } catch {
    return { completed: false, lastStep: 0 }
  }
}

export function saveFirstRunState(state: FirstRunState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore storage errors
  }
}
