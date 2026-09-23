const STYLE_ID = 'ringfall-fps-styles'

const FPS_CSS = `
.rf-fps {
  position: absolute;
  top: max(12px, env(safe-area-inset-top));
  right: 14px;
  z-index: 55;
  font-family: "Orbitron", "Rajdhani", monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: rgba(94, 234, 212, 0.92);
  text-shadow: 0 0 10px rgba(94, 234, 212, 0.45);
  padding: 5px 10px;
  border: 1px solid rgba(94, 234, 212, 0.28);
  background: rgba(6, 14, 18, 0.55);
  pointer-events: none;
  user-select: none;
  opacity: 0;
  transition: opacity 0.25s ease;
}
.rf-fps.rf-visible { opacity: 1; }
.rf-fps.rf-warn { color: rgba(255, 154, 60, 0.95); border-color: rgba(255, 154, 60, 0.35); }
.rf-fps.rf-bad { color: rgba(255, 90, 90, 0.95); border-color: rgba(255, 90, 90, 0.4); }
`

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = FPS_CSS
  document.head.appendChild(style)
}

/** Top-right FPS readout with smoothed frame time. */
export class FpsCounter {
  readonly root: HTMLElement
  private visible = false
  private smoothed = 60
  private accum = 0
  private frames = 0

  constructor(parent: HTMLElement = document.body) {
    ensureStyles()
    this.root = document.createElement('div')
    this.root.className = 'rf-fps'
    this.root.setAttribute('aria-hidden', 'true')
    this.root.textContent = '— FPS'
    parent.appendChild(this.root)
  }

  setVisible(show: boolean): void {
    this.visible = show
    this.root.classList.toggle('rf-visible', show)
  }

  update(dt: number): void {
    if (!this.visible || dt <= 0) return
    const instant = 1 / dt
    this.smoothed = this.smoothed * 0.88 + instant * 0.12
    this.accum += dt
    this.frames += 1
    if (this.accum < 0.12) return
    const fps = Math.round(this.smoothed)
    this.root.textContent = `${fps} FPS`
    this.root.classList.toggle('rf-warn', fps < 50 && fps >= 30)
    this.root.classList.toggle('rf-bad', fps < 30)
    this.accum = 0
    this.frames = 0
  }

  dispose(): void {
    this.root.remove()
  }
}
