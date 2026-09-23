/**
 * On-screen controls for touch play.
 * Left stick moves, the right side looks, and buttons fire / aim / act.
 * Mouse input is ignored so a desktop pointer still reaches the canvas.
 */

export interface TouchControlActions {
  setMove: (x: number, y: number) => void
  addLook: (dx: number, dy: number) => void
  setFire: (down: boolean) => void
  setAim: (down: boolean) => void
  setJump: (down: boolean) => void
  use: () => void
  reload: () => void
  grenade: () => void
  swap: () => void
  turret: () => void
  pause: () => void
  onMode?: (enabled: boolean) => void
}

const STYLE_ID = 'ringfall-touch-styles'
const STICK_RADIUS = 46
const STICK_DEAD = 0.15

const TOUCH_CSS = `
.rf-touch {
  position: absolute;
  inset: 0;
  z-index: 46;
  pointer-events: none;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.rf-touch.rf-hidden { display: none; }
.rf-look {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(68%, 520px);
  pointer-events: auto;
  touch-action: none;
}
.rf-stick {
  position: absolute;
  left: max(14px, env(safe-area-inset-left));
  bottom: max(16px, env(safe-area-inset-bottom));
  width: 128px;
  height: 128px;
  border-radius: 50%;
  pointer-events: auto;
  touch-action: none;
  background: rgba(6, 16, 20, 0.38);
  border: 2px solid rgba(94, 234, 212, 0.5);
  box-shadow: inset 0 0 18px rgba(94, 234, 212, 0.12);
}
.rf-stick-knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 52px;
  height: 52px;
  margin: -26px 0 0 -26px;
  border-radius: 50%;
  background: rgba(94, 234, 212, 0.72);
  box-shadow: 0 0 12px rgba(94, 234, 212, 0.45);
}
.rf-pad {
  position: absolute;
  pointer-events: auto;
  touch-action: none;
  border-radius: 50%;
  border: 1px solid rgba(255, 154, 60, 0.55);
  background: rgba(8, 16, 20, 0.5);
  color: #fff6ea;
  font-family: "Orbitron", sans-serif;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.rf-pad-fire {
  right: max(16px, env(safe-area-inset-right));
  bottom: max(18px, env(safe-area-inset-bottom));
  width: 86px;
  height: 86px;
  font-size: 13px;
  background: rgba(180, 48, 32, 0.55);
  border-color: rgba(255, 140, 90, 0.9);
}
.rf-pad-aim {
  right: max(30px, env(safe-area-inset-right));
  bottom: calc(max(18px, env(safe-area-inset-bottom)) + 98px);
  width: 58px;
  height: 58px;
}
.rf-pad-jump {
  right: calc(max(16px, env(safe-area-inset-right)) + 98px);
  bottom: max(28px, env(safe-area-inset-bottom));
  width: 64px;
  height: 64px;
}
.rf-actions {
  position: absolute;
  left: max(12px, env(safe-area-inset-left));
  right: max(12px, env(safe-area-inset-right));
  bottom: calc(max(8px, env(safe-area-inset-bottom)) + 176px);
  display: flex;
  justify-content: center;
  gap: 6px;
  pointer-events: none;
}
.rf-actions button {
  pointer-events: auto;
  touch-action: none;
  min-width: 46px;
  height: 34px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid rgba(126, 200, 160, 0.4);
  background: rgba(6, 14, 18, 0.62);
  color: #e7f6ef;
  font-family: "Orbitron", sans-serif;
  font-size: 9px;
  letter-spacing: 0.06em;
}
.rf-pad.rf-held, .rf-actions button.rf-held {
  background: rgba(94, 234, 212, 0.35);
  border-color: rgba(94, 234, 212, 0.85);
}
`

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = TOUCH_CSS
  document.head.appendChild(style)
}

/** Phones and touch-first browsers. A mouse-only desktop stays on pointer lock. */
export function prefersTouchInput(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const touchPoints = navigator.maxTouchPoints > 0
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const noHover = window.matchMedia('(hover: none)').matches
  if (touchPoints && (coarse || noHover)) return true
  const narrowPortrait = window.matchMedia('(max-width: 820px) and (orientation: portrait)').matches
  return touchPoints && narrowPortrait
}

export function stickAxes(dx: number, dy: number, radius = STICK_RADIUS): { x: number; y: number } {
  let x = dx / radius
  let y = -dy / radius
  const mag = Math.hypot(x, y)
  if (mag < STICK_DEAD) return { x: 0, y: 0 }
  if (mag > 1) {
    x /= mag
    y /= mag
  }
  return { x, y }
}

export class TouchControls {
  readonly root: HTMLElement
  private enabled = false
  private gameplay = false
  private readonly actions: TouchControlActions
  private readonly stick: HTMLElement
  private readonly knob: HTMLElement
  private readonly lookZone: HTMLElement
  private stickId: number | null = null
  private lookId: number | null = null
  private lookX = 0
  private lookY = 0
  private readonly stickOrigin = { x: 0, y: 0 }
  private readonly onFirstTouch: (e: PointerEvent) => void

  constructor(parent: HTMLElement, actions: TouchControlActions) {
    ensureStyles()
    this.actions = actions
    this.root = document.createElement('div')
    this.root.className = 'rf-touch rf-hidden'
    this.root.innerHTML = `
      <div class="rf-look" aria-hidden="true"></div>
      <div class="rf-stick" aria-label="Move">
        <div class="rf-stick-knob"></div>
      </div>
      <button type="button" class="rf-pad rf-pad-jump">Jump</button>
      <button type="button" class="rf-pad rf-pad-aim">Aim</button>
      <button type="button" class="rf-pad rf-pad-fire">Fire</button>
      <div class="rf-actions">
        <button type="button" data-act="use">Use</button>
        <button type="button" data-act="turret">Gun</button>
        <button type="button" data-act="reload">Rld</button>
        <button type="button" data-act="grenade">Frag</button>
        <button type="button" data-act="swap">Swap</button>
        <button type="button" data-act="pause">Menu</button>
      </div>
    `
    parent.appendChild(this.root)
    this.stick = this.root.querySelector('.rf-stick')!
    this.knob = this.root.querySelector('.rf-stick-knob')!
    this.lookZone = this.root.querySelector('.rf-look')!

    this.stick.addEventListener('pointerdown', (e) => this.onStickDown(e))
    this.stick.addEventListener('pointermove', (e) => this.onStickMove(e))
    this.stick.addEventListener('pointerup', (e) => this.onStickUp(e))
    this.stick.addEventListener('pointercancel', (e) => this.onStickUp(e))

    this.lookZone.addEventListener('pointerdown', (e) => this.onLookDown(e))
    this.lookZone.addEventListener('pointermove', (e) => this.onLookMove(e))
    this.lookZone.addEventListener('pointerup', (e) => this.onLookUp(e))
    this.lookZone.addEventListener('pointercancel', (e) => this.onLookUp(e))

    this.bindHold(this.root.querySelector('.rf-pad-fire')!, (down) => this.actions.setFire(down))
    this.bindHold(this.root.querySelector('.rf-pad-aim')!, (down) => this.actions.setAim(down))
    this.bindHold(this.root.querySelector('.rf-pad-jump')!, (down) => this.actions.setJump(down))

    const taps: Record<string, () => void> = {
      use: () => this.actions.use(),
      turret: () => this.actions.turret(),
      reload: () => this.actions.reload(),
      grenade: () => this.actions.grenade(),
      swap: () => this.actions.swap(),
      pause: () => this.actions.pause(),
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.rf-actions button')) {
      const act = button.dataset.act ?? ''
      const fn = taps[act]
      button.addEventListener('pointerdown', (e) => {
        if (!this.isTouchPointer(e)) return
        e.preventDefault()
        e.stopPropagation()
        fn?.()
      })
    }

    this.onFirstTouch = (e) => {
      if (e.pointerType === 'touch') this.setEnabled(true)
    }
    window.addEventListener('pointerdown', this.onFirstTouch, true)
    this.setEnabled(prefersTouchInput())
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return
    this.enabled = on
    this.actions.onMode?.(on)
    this.refresh()
  }

  setGameplay(active: boolean): void {
    this.gameplay = active
    this.refresh()
  }

  private refresh(): void {
    const show = this.gameplay && this.enabled
    this.root.classList.toggle('rf-hidden', !show)
    if (!show) this.releaseAll()
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.onFirstTouch, true)
    this.releaseAll()
    this.root.remove()
  }

  private releaseAll(): void {
    this.stickId = null
    this.lookId = null
    this.knob.style.transform = ''
    this.actions.setMove(0, 0)
    this.actions.setFire(false)
    this.actions.setAim(false)
    this.actions.setJump(false)
    for (const el of this.root.querySelectorAll('.rf-held')) el.classList.remove('rf-held')
  }

  private isTouchPointer(e: PointerEvent): boolean {
    return e.pointerType !== 'mouse'
  }

  private capture(el: HTMLElement, pointerId: number): void {
    try {
      el.setPointerCapture(pointerId)
    } catch {
      // Untrusted or already-ended pointers still drive the control.
    }
  }

  private onStickDown(e: PointerEvent): void {
    if (!this.isTouchPointer(e) || this.stickId !== null) return
    e.preventDefault()
    this.stickId = e.pointerId
    this.capture(this.stick, e.pointerId)
    const rect = this.stick.getBoundingClientRect()
    this.stickOrigin.x = rect.left + rect.width / 2
    this.stickOrigin.y = rect.top + rect.height / 2
    this.applyStick(e)
  }

  private onStickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return
    e.preventDefault()
    this.applyStick(e)
  }

  private onStickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return
    this.stickId = null
    this.knob.style.transform = ''
    this.actions.setMove(0, 0)
  }

  private applyStick(e: PointerEvent): void {
    const axes = stickAxes(e.clientX - this.stickOrigin.x, e.clientY - this.stickOrigin.y)
    this.knob.style.transform = `translate(${axes.x * STICK_RADIUS}px, ${-axes.y * STICK_RADIUS}px)`
    this.actions.setMove(axes.x, axes.y)
  }

  private onLookDown(e: PointerEvent): void {
    if (!this.isTouchPointer(e) || this.lookId !== null) return
    e.preventDefault()
    this.lookId = e.pointerId
    this.capture(this.lookZone, e.pointerId)
    this.lookX = e.clientX
    this.lookY = e.clientY
  }

  private onLookMove(e: PointerEvent): void {
    if (e.pointerId !== this.lookId) return
    e.preventDefault()
    const dx = e.clientX - this.lookX
    const dy = e.clientY - this.lookY
    this.lookX = e.clientX
    this.lookY = e.clientY
    if (dx !== 0 || dy !== 0) this.actions.addLook(dx, dy)
  }

  private onLookUp(e: PointerEvent): void {
    if (e.pointerId !== this.lookId) return
    this.lookId = null
  }

  private bindHold(el: HTMLElement, setDown: (down: boolean) => void): void {
    const down = (e: PointerEvent) => {
      if (!this.isTouchPointer(e)) return
      e.preventDefault()
      e.stopPropagation()
      this.capture(el, e.pointerId)
      el.classList.add('rf-held')
      setDown(true)
    }
    const up = (e: PointerEvent) => {
      if (!el.classList.contains('rf-held')) return
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      el.classList.remove('rf-held')
      setDown(false)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
}
