export interface ViewportBox {
  width: number
  height: number
  offsetLeft: number
  offsetTop: number
}

export function visualViewportBox(
  visual: { width: number; height: number; offsetLeft?: number; offsetTop?: number } | null,
  fallback: { width: number; height: number },
): ViewportBox {
  const width = Math.max(1, Math.round(visual?.width || fallback.width || 1))
  const height = Math.max(1, Math.round(visual?.height || fallback.height || 1))
  return {
    width,
    height,
    offsetLeft: visual?.offsetLeft ?? 0,
    offsetTop: visual?.offsetTop ?? 0,
  }
}

/** Pin a stage element to the visible viewport so mobile browser chrome does not letterbox the canvas. */
export function applyViewportBox(el: HTMLElement, box: ViewportBox): void {
  el.style.position = 'fixed'
  el.style.left = `${box.offsetLeft}px`
  el.style.top = `${box.offsetTop}px`
  el.style.width = `${box.width}px`
  el.style.height = `${box.height}px`
  el.style.right = 'auto'
  el.style.bottom = 'auto'
}

export function readVisualViewportBox(): ViewportBox {
  const visual = window.visualViewport
  return visualViewportBox(
    visual
      ? {
          width: visual.width,
          height: visual.height,
          offsetLeft: visual.offsetLeft,
          offsetTop: visual.offsetTop,
        }
      : null,
    { width: window.innerWidth, height: window.innerHeight },
  )
}

export function syncStageToVisualViewport(stage: HTMLElement): ViewportBox {
  const box = readVisualViewportBox()
  applyViewportBox(stage, box)
  return box
}

/** Fires on resize, orientation, and visual-viewport changes (URL bar show/hide). */
export function watchVisualViewport(stage: HTMLElement, onChange: () => void): () => void {
  let lastW = -1
  let lastH = -1
  const run = () => {
    const box = syncStageToVisualViewport(stage)
    if (box.width === lastW && box.height === lastH) return
    lastW = box.width
    lastH = box.height
    onChange()
  }
  run()
  window.addEventListener('resize', run)
  window.addEventListener('orientationchange', run)
  window.visualViewport?.addEventListener('resize', run)
  window.visualViewport?.addEventListener('scroll', run)
  return () => {
    window.removeEventListener('resize', run)
    window.removeEventListener('orientationchange', run)
    window.visualViewport?.removeEventListener('resize', run)
    window.visualViewport?.removeEventListener('scroll', run)
  }
}
