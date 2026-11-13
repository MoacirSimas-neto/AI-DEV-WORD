export type CloseBehavior = 'ask' | 'minimize' | 'quit'

const STORAGE_KEY = 'aidw.closeBehavior'

export function loadCloseBehavior(): CloseBehavior {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'minimize' || raw === 'quit' || raw === 'ask') return raw
  } catch {
    // ignore storage errors
  }
  return 'ask'
}

export function saveCloseBehavior(behavior: CloseBehavior): void {
  try {
    localStorage.setItem(STORAGE_KEY, behavior)
  } catch {
    // ignore storage errors
  }
}
