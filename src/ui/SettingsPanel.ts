import type { AntialiasingMode, GameSettings, GraphicsPreset, ShadowQuality, UserSettings } from '../settings/GameSettings'

export interface SettingsPanelOptions {
  parent: HTMLElement
  settings: GameSettings
  onApply?: (settings: UserSettings) => void
  onClose?: () => void
}

const STYLE_ID = 'ringfall-settings-styles'

const SETTINGS_CSS = `
.rf-settings-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(2, 4, 10, 0.62);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.25s ease, visibility 0.25s;
  z-index: 8;
}
.rf-settings-overlay.rf-open {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
.rf-settings-card {
  width: min(420px, 92vw);
  max-height: min(88vh, 640px);
  overflow-y: auto;
  padding: 1.35rem 1.5rem 1.25rem;
  border: 1px solid rgba(126, 200, 160, 0.35);
  background: rgba(6, 12, 14, 0.96);
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.45);
}
.rf-settings-card h2 {
  font-family: "Orbitron", sans-serif;
  letter-spacing: 0.22em;
  font-size: 0.85rem;
  margin: 0 0 0.35rem;
  color: #7ec8a0;
}
.rf-settings-sub {
  font-size: 0.78rem;
  color: rgba(180, 210, 195, 0.55);
  margin: 0 0 1rem;
  letter-spacing: 0.04em;
}
.rf-settings-section {
  font-family: "Orbitron", sans-serif;
  font-size: 0.62rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: rgba(196, 163, 90, 0.85);
  margin: 1rem 0 0.5rem;
  padding-top: 0.65rem;
  border-top: 1px solid rgba(126, 200, 160, 0.12);
}
.rf-settings-section:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
.rf-settings-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.5rem 0;
  font-size: 0.88rem;
  color: rgba(220, 235, 225, 0.88);
}
.rf-settings-row label { cursor: pointer; }
.rf-settings-row select,
.rf-settings-row input[type="range"] {
  width: 9.5rem;
  accent-color: #7ec8a0;
  font-family: inherit;
  font-size: 0.82rem;
  background: rgba(8, 16, 18, 0.9);
  color: #e8f0e8;
  border: 1px solid rgba(126, 200, 160, 0.3);
  border-radius: 2px;
  padding: 0.25rem 0.35rem;
}
.rf-settings-row input[type="checkbox"] {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: #7ec8a0;
  cursor: pointer;
}
.rf-settings-val {
  min-width: 2.5rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 0.8rem;
  color: rgba(196, 163, 90, 0.9);
}
.rf-settings-actions {
  display: flex;
  gap: 0.65rem;
  margin-top: 1.15rem;
}
.rf-settings-btn {
  flex: 1;
  font-family: "Orbitron", sans-serif;
  font-weight: 600;
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.7rem 0.5rem;
  border: 1px solid rgba(126, 200, 160, 0.45);
  background: linear-gradient(180deg, rgba(126, 200, 160, 0.14), rgba(8, 16, 12, 0.35));
  color: #f2f6f2;
  cursor: pointer;
}
.rf-settings-btn.rf-ghost {
  border-color: rgba(180, 200, 190, 0.25);
  background: transparent;
}
`

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = SETTINGS_CSS
  document.head.appendChild(style)
}

export class SettingsPanel {
  readonly root: HTMLElement
  private readonly settings: GameSettings
  private readonly onApply?: (s: UserSettings) => void
  private readonly onClose?: () => void
  private unsub?: () => void

  constructor(opts: SettingsPanelOptions) {
    ensureStyles()
    this.settings = opts.settings
    this.onApply = opts.onApply
    this.onClose = opts.onClose

    this.root = document.createElement('div')
    this.root.className = 'rf-settings-overlay'
    this.root.setAttribute('aria-hidden', 'true')
    this.root.innerHTML = `
      <div class="rf-settings-card" role="dialog" aria-label="Settings">
        <h2>SETTINGS</h2>
        <p class="rf-settings-sub">Changes apply immediately. Saved to this browser.</p>
        <div class="rf-settings-body"></div>
        <div class="rf-settings-actions">
          <button type="button" class="rf-settings-btn rf-apply">Apply</button>
          <button type="button" class="rf-settings-btn rf-ghost rf-close">Close</button>
        </div>
      </div>
    `
    opts.parent.appendChild(this.root)

    const body = this.root.querySelector('.rf-settings-body') as HTMLElement
    this.buildForm(body)
    this.root.querySelector('.rf-apply')!.addEventListener('click', () => this.emitApply())
    this.root.querySelector('.rf-close')!.addEventListener('click', () => this.close())
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close()
    })
    this.root.querySelector('.rf-settings-card')!.addEventListener('click', (e) => e.stopPropagation())

    this.unsub = this.settings.subscribe(() => this.syncForm())
    this.syncForm()
  }

  open(): void {
    this.root.classList.add('rf-open')
    this.root.setAttribute('aria-hidden', 'false')
    this.syncForm()
  }

  close(): void {
    this.root.classList.remove('rf-open')
    this.root.setAttribute('aria-hidden', 'true')
    this.onClose?.()
  }

  get isOpen(): boolean {
    return this.root.classList.contains('rf-open')
  }

  dispose(): void {
    this.unsub?.()
    this.root.remove()
  }

  private buildForm(body: HTMLElement): void {
    const s = this.settings.get()
    body.innerHTML = `
      <div class="rf-settings-section">Graphics</div>
      ${selectRow('preset', 'Quality preset', [
        ['auto', 'Auto (recommended)'],
        ['low', 'Low'],
        ['medium', 'Medium'],
        ['high', 'High'],
        ['ultra', 'Ultra'],
        ['custom', 'Custom'],
      ], s.graphicsPreset === 'custom' ? 'custom' : s.graphicsPreset)}
      ${selectRow('resolution', 'Resolution scale', [
        ['0.75', '75%'],
        ['0.85', '85%'],
        ['1', '100%'],
        ['1.15', '115%'],
        ['1.25', '125%'],
        ['1.5', '150%'],
      ], String(s.resolutionScale))}
      ${selectRow('shadows', 'Shadows', [
        ['off', 'Off'],
        ['low', 'Low'],
        ['medium', 'Medium'],
        ['high', 'High'],
      ], s.shadows)}
      ${toggleRow('bloom', 'Bloom', s.bloom)}
      ${toggleRow('ssao', 'Ambient occlusion', s.ssao)}
      ${selectRow('aa', 'Anti-aliasing', [
        ['off', 'Off'],
        ['smaa', 'SMAA'],
      ], s.antialiasing)}
      ${toggleRow('vignette', 'Vignette', s.vignette)}
      ${toggleRow('shafts', 'God rays', s.lightShafts)}
      ${toggleRow('env', 'Environment reflections', s.environmentReflections)}
      ${toggleRow('autoOpt', 'Auto-optimize FPS', s.autoOptimize)}
      ${toggleRow('fps', 'Show FPS counter', s.showFps)}
      <div class="rf-settings-section">Audio</div>
      ${rangeRow('master', 'Master volume', s.masterVolume)}
      ${rangeRow('sfx', 'SFX volume', s.sfxVolume)}
    `

    body.querySelector('[data-field="preset"]')!.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value as GraphicsPreset
      if (v === 'custom') return
      this.settings.applyPreset(v)
      this.emitApply()
    })
    body.querySelector('[data-field="resolution"]')!.addEventListener('change', (e) => {
      this.patch({ resolutionScale: parseFloat((e.target as HTMLSelectElement).value) })
    })
    body.querySelector('[data-field="shadows"]')!.addEventListener('change', (e) => {
      this.patch({ shadows: (e.target as HTMLSelectElement).value as ShadowQuality })
    })
    body.querySelector('[data-field="aa"]')!.addEventListener('change', (e) => {
      this.patch({ antialiasing: (e.target as HTMLSelectElement).value as AntialiasingMode })
    })
    for (const key of ['bloom', 'ssao', 'vignette', 'shafts', 'env', 'autoOpt', 'fps'] as const) {
      body.querySelector(`[data-field="${key}"]`)!.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked
        switch (key) {
          case 'bloom':
            this.patch({ bloom: checked })
            break
          case 'ssao':
            this.patch({ ssao: checked })
            break
          case 'vignette':
            this.patch({ vignette: checked })
            break
          case 'shafts':
            this.patch({ lightShafts: checked })
            break
          case 'env':
            this.patch({ environmentReflections: checked })
            break
          case 'autoOpt':
            this.patch({ autoOptimize: checked })
            break
          case 'fps':
            this.patch({ showFps: checked })
            break
          default: {
            const unknown: never = key
            throw new Error(`Unknown settings field ${unknown}`)
          }
        }
      })
    }
    for (const key of ['master', 'sfx'] as const) {
      const input = body.querySelector(`[data-field="${key}"]`) as HTMLInputElement
      input.addEventListener('input', () => {
        const val = parseInt(input.value, 10) / 100
        const label = body.querySelector(`[data-val="${key}"]`)!
        label.textContent = `${input.value}%`
        this.patch(key === 'master' ? { masterVolume: val } : { sfxVolume: val })
      })
    }
  }

  private patch(partial: Partial<UserSettings>): void {
    this.settings.set(partial)
    this.emitApply()
  }

  private emitApply(): void {
    this.onApply?.(this.settings.get())
  }

  private syncForm(): void {
    const s = this.settings.get()
    const setSelect = (field: string, val: string) => {
      const el = this.root.querySelector(`[data-field="${field}"]`) as HTMLSelectElement | null
      if (el) el.value = val
    }
    const setCheck = (field: string, val: boolean) => {
      const el = this.root.querySelector(`[data-field="${field}"]`) as HTMLInputElement | null
      if (el) el.checked = val
    }
    setSelect('preset', s.graphicsPreset)
    setSelect('resolution', String(s.resolutionScale))
    setSelect('shadows', s.shadows)
    setSelect('aa', s.antialiasing)
    setCheck('bloom', s.bloom)
    setCheck('ssao', s.ssao)
    setCheck('vignette', s.vignette)
    setCheck('shafts', s.lightShafts)
    setCheck('env', s.environmentReflections)
    setCheck('autoOpt', s.autoOptimize)
    setCheck('fps', s.showFps)
    const master = this.root.querySelector('[data-field="master"]') as HTMLInputElement | null
    const sfx = this.root.querySelector('[data-field="sfx"]') as HTMLInputElement | null
    if (master) {
      master.value = String(Math.round(s.masterVolume * 100))
      const lbl = this.root.querySelector('[data-val="master"]')
      if (lbl) lbl.textContent = `${master.value}%`
    }
    if (sfx) {
      sfx.value = String(Math.round(s.sfxVolume * 100))
      const lbl = this.root.querySelector('[data-val="sfx"]')
      if (lbl) lbl.textContent = `${sfx.value}%`
    }
  }
}

function selectRow(field: string, label: string, options: [string, string][], value: string): string {
  const opts = options.map(([v, t]) => `<option value="${v}"${v === value ? ' selected' : ''}>${t}</option>`).join('')
  return `<div class="rf-settings-row"><label for="rf-${field}">${label}</label><select id="rf-${field}" data-field="${field}">${opts}</select></div>`
}

function toggleRow(field: string, label: string, checked: boolean): string {
  return `<div class="rf-settings-row"><label for="rf-${field}">${label}</label><input id="rf-${field}" type="checkbox" data-field="${field}"${checked ? ' checked' : ''} /></div>`
}

function rangeRow(field: string, label: string, value: number): string {
  const pct = Math.round(value * 100)
  return `<div class="rf-settings-row"><label for="rf-${field}">${label}</label><span class="rf-settings-val" data-val="${field}">${pct}%</span></div>
    <div class="rf-settings-row" style="padding-top:0"><span></span><input id="rf-${field}" type="range" min="0" max="100" value="${pct}" data-field="${field}" /></div>`
}
