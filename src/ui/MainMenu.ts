/**
 * Halo: Combat Evolved–inspired title screen.
 * Left-aligned classic menu over a live 3D ringworld backdrop.
 */

import type { GameSettings, UserSettings } from '../settings/GameSettings'
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
  --m-gold: #c4a35a;
  --m-cyan: #7ec8a0;
  position: fixed;
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
    radial-gradient(ellipse 70% 55% at 75% 35%, rgba(126, 200, 160, 0.14), transparent 55%),
    linear-gradient(90deg, rgba(2, 4, 10, 0.82) 0%, rgba(2, 4, 10, 0.35) 42%, transparent 72%);
  pointer-events: none;
}
.rf-menu-panel {
  position: relative;
  z-index: 2;
  margin-left: clamp(2rem, 8vw, 6rem);
  max-width: 28rem;
  text-align: left;
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
  font-size: clamp(2.8rem, 8vw, 4.8rem);
  letter-spacing: 0.14em;
  line-height: 0.95;
  color: #f2f6f2;
  text-shadow: 0 0 28px rgba(126, 200, 160, 0.35), 0 2px 0 rgba(0,0,0,0.55);
  margin: 0 0 0.75rem;
}
.rf-menu-sub {
  font-size: 1.05rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: rgba(210, 230, 215, 0.72);
  margin: 0 0 1.75rem;
  max-width: 22rem;
}
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
  border: 1px solid rgba(126, 200, 160, 0.45);
  background: linear-gradient(180deg, rgba(126, 200, 160, 0.16), rgba(8, 16, 12, 0.35));
  color: #f2f6f2;
  cursor: pointer;
  pointer-events: auto;
  position: relative;
  z-index: 3;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease, border-color 0.2s;
}
.rf-menu-btn:hover {
  transform: translateX(4px);
  border-color: rgba(196, 163, 90, 0.75);
  box-shadow: 0 0 28px rgba(126, 200, 160, 0.22);
  background: linear-gradient(180deg, rgba(196, 163, 90, 0.22), rgba(126, 200, 160, 0.1));
}
.rf-menu-btn.rf-ghost {
  border-color: rgba(180, 200, 190, 0.25);
  background: transparent;
}
.rf-menu-hint {
  margin-top: 1.5rem;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  color: rgba(170, 200, 185, 0.45);
}
@keyframes rf-ce-in {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
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
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-label', 'Main menu')

    this.root.innerHTML = `
      <div class="rf-menu-bg"></div>
      <div class="rf-menu-panel">
        <div class="rf-menu-eyebrow">Pillar of Autumn</div>
        <h1 class="rf-menu-title">${escapeHtml(title)}</h1>
        <p class="rf-menu-sub">${escapeHtml(subtitle)}</p>
        <div class="rf-menu-actions">
          <button type="button" class="rf-menu-btn rf-play">Campaign</button>
          <button type="button" class="rf-menu-btn rf-ghost rf-settings-open">Settings</button>
        </div>
        <p class="rf-menu-hint">WASD · Mouse · LMB fire · E use · G grenade · F turret</p>
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
