/**
 * Halo: Combat Evolved–inspired title screen.
 * Left-aligned classic menu over a live 3D ringworld backdrop.
 */

import type { GameSettings, UserSettings } from '../settings/GameSettings'
import { prefersTouchInput } from './TouchControls'
import { SettingsPanel } from './SettingsPanel'

export interface MainMenuOptions {
  parent?: HTMLElement
  title?: string
  subtitle?: string
  onPlay?: () => void
  onSettingsApply?: (settings: UserSettings) => void
  requestPointerLockTarget?: HTMLElement | null
  settings?: GameSettings
}

const STYLE_ID = 'ringfall-menu-styles'
const FONT_ID = 'ringfall-menu-fonts'

const MENU_CSS = `
.rf-menu {
  --m-gold: #e4c98a;
  --m-cyan: #9ee0c0;
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  font-family: "Rajdhani", "Orbitron", system-ui, sans-serif;
  color: #e8f0e8;
  overflow: hidden;
  opacity: 1;
  transition: opacity 0.7s ease, visibility 0.7s;
  visibility: visible;
}
.rf-menu.rf-hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
.rf-menu-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 55% 40% at 18% 50%, rgba(8, 16, 22, 0.55), transparent 70%),
    linear-gradient(90deg, rgba(3, 6, 12, 0.78) 0%, rgba(3, 6, 12, 0.28) 46%, transparent 74%);
  pointer-events: none;
}
.rf-menu-panel {
  position: relative;
  z-index: 2;
  margin-left: clamp(1.4rem, 6vw, 4.5rem);
  max-width: 30rem;
  padding: 1.6rem 1.7rem 1.35rem;
  text-align: left;
  border: 1px solid rgba(180, 220, 200, 0.18);
  background: linear-gradient(180deg, rgba(8, 14, 20, 0.62), rgba(6, 10, 16, 0.38));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(10px);
  animation: rf-ce-in 1.1s ease both;
}
.rf-menu-eyebrow {
  font-family: "Orbitron", sans-serif;
  letter-spacing: 0.42em;
  font-size: 0.65rem;
  color: var(--m-cyan);
  margin-bottom: 0.85rem;
  text-transform: uppercase;
}
.rf-menu-title {
  font-family: "Orbitron", sans-serif;
  font-weight: 700;
  font-size: clamp(2.6rem, 7vw, 4.4rem);
  letter-spacing: 0.18em;
  line-height: 0.95;
  color: #f7faf6;
  text-shadow: 0 0 32px rgba(158, 224, 192, 0.28), 0 2px 0 rgba(0,0,0,0.55);
  margin: 0 0 0.75rem;
}
.rf-menu-sub {
  font-size: 1.08rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: rgba(226, 236, 228, 0.78);
  margin: 0 0 1.35rem;
  max-width: 24rem;
}
.rf-menu-status {
  margin: 0 0 0.9rem;
  font-family: "Orbitron", sans-serif;
  font-size: 0.68rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--m-gold);
}
.rf-menu-status[hidden] { display: none; }
.rf-menu-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.65rem;
}
.rf-menu-btn {
  font-family: "Orbitron", sans-serif;
  font-weight: 600;
  font-size: 0.85rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  padding: 0.85rem 1.6rem;
  min-width: 14rem;
  border: 1px solid rgba(158, 224, 192, 0.5);
  background: linear-gradient(180deg, rgba(158, 224, 192, 0.2), rgba(8, 16, 12, 0.4));
  color: #f2f6f2;
  cursor: pointer;
  pointer-events: auto;
  position: relative;
  z-index: 3;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease, border-color 0.2s, opacity 0.2s;
}
.rf-menu-btn:hover:not(:disabled) {
  transform: translateX(4px);
  border-color: rgba(228, 201, 138, 0.85);
  box-shadow: 0 0 28px rgba(158, 224, 192, 0.22);
  background: linear-gradient(180deg, rgba(228, 201, 138, 0.24), rgba(158, 224, 192, 0.12));
}
.rf-menu-btn:disabled {
  cursor: progress;
  opacity: 0.55;
}
.rf-menu-btn.rf-ghost {
  border-color: rgba(180, 200, 190, 0.28);
  background: rgba(8, 12, 16, 0.25);
}
.rf-menu-hint {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.55rem;
  margin-top: 1.35rem;
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  color: rgba(190, 214, 200, 0.72);
}
.rf-key {
  display: inline-block;
  padding: 0.05rem 0.4rem;
  border: 1px solid rgba(228, 201, 138, 0.4);
  border-bottom-width: 2px;
  background: rgba(8, 12, 16, 0.55);
  color: #f4efe2;
  font-family: "Orbitron", sans-serif;
  font-size: 0.62rem;
  letter-spacing: 0.08em;
}
.rf-menu-credits {
  margin: 1.1rem 0 0;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  color: rgba(180, 200, 190, 0.55);
}
.rf-menu-credits a {
  color: rgba(158, 224, 192, 0.85);
  text-decoration: none;
}
.rf-menu-credits a:hover { text-decoration: underline; }
@keyframes rf-ce-in {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (max-width: 700px) {
  .rf-menu { align-items: flex-end; }
  .rf-menu-panel {
    margin: 0;
    padding: 1.1rem 1rem calc(1.2rem + env(safe-area-inset-bottom));
    max-width: none;
    width: 100%;
  }
  .rf-menu-title { font-size: 2.5rem; }
  .rf-menu-btn { width: 100%; min-width: 0; }
  .rf-menu-bg {
    background:
      linear-gradient(180deg, rgba(2, 4, 10, 0.2) 0%, rgba(2, 4, 10, 0.82) 55%);
  }
}
`

function ensureFonts(): void {
  if (document.getElementById(FONT_ID) || document.getElementById('ringfall-hud-fonts')) return
  const link = document.createElement('link')
  link.id = FONT_ID
  link.rel = 'stylesheet'
  link.href =
    'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700&family=Rajdhani:wght@500;600;700&display=swap'
  document.head.appendChild(link)
}

function ensureStyles(): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = MENU_CSS
}

export class MainMenu {
  readonly root: HTMLElement
  private readonly settingsPanel: SettingsPanel | null
  private readonly playBtn: HTMLButtonElement
  private readonly settingsBtn: HTMLButtonElement
  private onPlay: (() => void) | null
  private onSettingsApply: ((s: UserSettings) => void) | null
  private pointerLockTarget: HTMLElement | null
  private dismissed = false

  constructor(opts: MainMenuOptions = {}) {
    ensureFonts()
    ensureStyles()

    const title = opts.title ?? 'RINGFALL'
    const subtitle = opts.subtitle ?? 'Infinite Protocols'
    this.onPlay = opts.onPlay ?? null
    this.onSettingsApply = opts.onSettingsApply ?? null
    this.pointerLockTarget = opts.requestPointerLockTarget ?? document.body

    const parent = opts.parent ?? document.body
    this.root = document.createElement('div')
    this.root.className = 'rf-menu'
    this.root.dataset.state = 'ready'
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-label', 'Main menu')

    this.root.innerHTML = `
      <div class="rf-menu-bg"></div>
      <div class="rf-menu-panel">
        <div class="rf-menu-eyebrow">Ringworld</div>
        <h1 class="rf-menu-title">${escapeHtml(title)}</h1>
        <p class="rf-menu-sub">${escapeHtml(subtitle)}</p>
        <p class="rf-menu-status" hidden></p>
        <div class="rf-menu-actions">
          <button type="button" class="rf-menu-btn rf-play">Campaign</button>
          <button type="button" class="rf-menu-btn rf-ghost rf-settings-open">Settings</button>
        </div>
        <p class="rf-menu-hint">${
          prefersTouchInput()
            ? '<span class="rf-key">Stick</span> move <span class="rf-key">Drag</span> look <span class="rf-key">Fire</span> <span class="rf-key">Use</span> <span class="rf-key">Frag</span>'
            : '<span class="rf-key">WASD</span> move <span class="rf-key">Mouse</span> look <span class="rf-key">LMB</span> fire <span class="rf-key">E</span> use <span class="rf-key">G</span> frag'
        }</p>
        <p class="rf-menu-credits">Terrain, props, and sky from <a href="https://polyhaven.com" target="_blank" rel="noopener noreferrer">Poly Haven</a> · CC0</p>
      </div>
    `

    parent.appendChild(this.root)
    this.playBtn = this.root.querySelector('.rf-play')!
    this.settingsBtn = this.root.querySelector('.rf-settings-open')!
    this.playBtn.addEventListener('click', () => this.handlePlay())
    this.settingsBtn.addEventListener('click', () => this.openSettings())

    this.settingsPanel = opts.settings
      ? new SettingsPanel({
          parent: this.root,
          settings: opts.settings,
          onApply: (s) => this.onSettingsApply?.(s),
          onClose: () => undefined,
        })
      : null
  }

  setCallbacks(opts: { onPlay?: () => void; onSettingsApply?: (s: UserSettings) => void }): void {
    if (opts.onPlay) this.onPlay = opts.onPlay
    if (opts.onSettingsApply) this.onSettingsApply = opts.onSettingsApply
  }

  setPointerLockTarget(el: HTMLElement | null): void {
    this.pointerLockTarget = el
  }

  /** Disable Campaign while the CC0 library is still streaming in. */
  setBusy(message: string | null): void {
    const status = this.root.querySelector('.rf-menu-status') as HTMLElement | null
    if (message) {
      if (status) {
        status.hidden = false
        status.textContent = message
      }
      this.playBtn.disabled = true
      this.root.dataset.state = 'loading'
      return
    }
    if (status) {
      status.hidden = true
      status.textContent = ''
    }
    this.playBtn.disabled = false
    this.root.dataset.state = 'ready'
  }

  show(): void {
    this.dismissed = false
    this.root.classList.remove('rf-hidden')
  }

  hide(): void {
    this.dismissed = true
    this.root.classList.add('rf-hidden')
    this.closeSettings()
  }

  get isVisible(): boolean {
    return !this.dismissed
  }

  openSettings(): void {
    this.settingsPanel?.open()
  }

  closeSettings(): void {
    this.settingsPanel?.close()
  }

  dispose(): void {
    this.settingsPanel?.dispose()
    this.root.remove()
  }

  private handlePlay(): void {
    this.hide()
    this.onPlay?.()
    if (prefersTouchInput()) return
    const target = this.pointerLockTarget
    if (target && typeof target.requestPointerLock === 'function') {
      const result = target.requestPointerLock()
      if (result && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>).catch(() => undefined)
      }
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
