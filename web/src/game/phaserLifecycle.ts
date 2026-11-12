/**
 * O Phaser 3.90 registra um 'visibilitychange' no document e sobrescreve window.onblur/onfocus
 * em Game.start() (VisibilityHandler), e Game.destroy() não desfaz nada disso. Como o escritório
 * é desmontado a cada troca de aba, cada montagem deixava um ouvinte órfão segurando o emissor
 * do jogo destruído (medido: +1 ouvinte por ciclo).
 *
 * postBoot roda dentro de Game.start() imediatamente antes do VisibilityHandler, de forma
 * síncrona: o primeiro 'visibilitychange' registrado a partir daí é o do Phaser.
 */
export function trackPhaserGlobals() {
  let visibility: EventListenerOrEventListenerObject | null = null
  let blur: typeof window.onblur = null
  let focus: typeof window.onfocus = null
  let restore: (() => void) | null = null

  const postBoot = () => {
    const original = document.addEventListener
    const stop = () => {
      if (document.addEventListener !== intercept) return
      document.addEventListener = original
      restore = null
      // Os dois handlers foram atribuídos na mesma chamada síncrona de start().
      blur = window.onblur
      focus = window.onfocus
    }
    const intercept: typeof document.addEventListener = function (this: Document, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      if (type === 'visibilitychange' && listener && !visibility) visibility = listener
      original.call(this, type, listener as EventListenerOrEventListenerObject, options)
    }
    document.addEventListener = intercept
    restore = stop
    // start() termina antes de qualquer microtarefa: aqui a interceptação já cumpriu o papel.
    queueMicrotask(stop)
  }

  const release = () => {
    restore?.()
    if (visibility) document.removeEventListener('visibilitychange', visibility)
    visibility = null
    if (blur && window.onblur === blur) window.onblur = null
    if (focus && window.onfocus === focus) window.onfocus = null
    blur = focus = null
  }

  return { postBoot, release }
}
