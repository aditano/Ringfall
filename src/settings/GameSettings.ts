import {
  detectPerformanceSettings,
  isMac,
  isMobile,
  type PerformanceSettings,
  type QualityTier,
} from '../rendering/PerformanceProfile'

export type GraphicsPreset = 'auto' | 'low' | 'medium' | 'high' | 'ultra' | 'custom'

export type ShadowQuality = 'off' | 'low' | 'medium' | 'high'

export type AntialiasingMode = 'off' | 'smaa'

export interface UserSettings {
  graphicsPreset: GraphicsPreset
  resolutionScale: number
  shadows: ShadowQuality
  bloom: boolean
  antialiasing: AntialiasingMode
  vignette: boolean
  lightShafts: boolean
  environmentReflections: boolean
  autoOptimize: boolean
  showFps: boolean
  masterVolume: number
  sfxVolume: number
}

const STORAGE_KEY = 'ringfall-settings-v2'
const LEGACY_STORAGE_KEY = 'ringfall-settings-v1'

export const DEFAULT_SETTINGS: UserSettings = {
  graphicsPreset: 'auto',
  resolutionScale: 1,
  shadows: 'medium',
  bloom: true,
  antialiasing: 'smaa',
  vignette: true,
  lightShafts: true,
  environmentReflections: true,
  autoOptimize: true,
  showFps: false,
  masterVolume: 0.85,
  sfxVolume: 0.9,
}

const PRESET_DEFAULTS: Record<Exclude<GraphicsPreset, 'auto' | 'custom'>, Partial<UserSettings>> = {
  low: {
    resolutionScale: 0.85,
    shadows: 'low',
    bloom: false,
    antialiasing: 'off',
    vignette: false,
    lightShafts: false,
    environmentReflections: false,
  },
  medium: {
    resolutionScale: 1,
    shadows: 'medium',
    bloom: true,
    antialiasing: 'off',
    vignette: true,
    lightShafts: false,
    environmentReflections: true,
  },
  high: {
    resolutionScale: 1.15,
    shadows: 'high',
    bloom: true,
    antialiasing: 'smaa',
    vignette: true,
    lightShafts: true,
    environmentReflections: true,
  },
  ultra: {
    resolutionScale: 1.25,
    shadows: 'high',
    bloom: true,
    antialiasing: 'smaa',
    vignette: true,
    lightShafts: true,
    environmentReflections: true,
  },
}

function shadowSize(shadows: ShadowQuality): number {
  switch (shadows) {
    case 'off':
      return 0
    case 'low':
      return 512
    case 'medium':
      return 1024
    case 'high':
      return 2048
  }
}

function tierFromPreset(preset: GraphicsPreset, auto: PerformanceSettings): QualityTier {
  if (preset === 'auto') return auto.tier
  if (preset === 'custom') return 'medium'
  return preset === 'ultra' ? 'high' : preset
}

export class GameSettings {
  private settings: UserSettings
  private readonly listeners = new Set<(s: UserSettings) => void>()

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS }
    this.load()
  }

  get(): Readonly<UserSettings> {
    return this.settings
  }

  subscribe(cb: (s: UserSettings) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  set(partial: Partial<UserSettings>, opts: { save?: boolean; presetOverride?: GraphicsPreset } = {}): void {
    const next = { ...this.settings, ...partial }
    if (opts.presetOverride) {
      next.graphicsPreset = opts.presetOverride
    } else if (partial.graphicsPreset === undefined && partial !== this.settings) {
      const touchedGraphics =
        partial.resolutionScale !== undefined ||
        partial.shadows !== undefined ||
        partial.bloom !== undefined ||
        partial.antialiasing !== undefined ||
        partial.vignette !== undefined ||
        partial.lightShafts !== undefined ||
        partial.environmentReflections !== undefined
      if (touchedGraphics && next.graphicsPreset !== 'custom') {
        next.graphicsPreset = 'custom'
      }
    }
    this.settings = next
    if (opts.save !== false) this.save()
    for (const cb of this.listeners) cb(this.settings)
  }

  applyPreset(preset: GraphicsPreset): void {
    if (preset === 'auto') {
      this.set({ graphicsPreset: 'auto', ...this.autoBaselineFields() }, { presetOverride: 'auto' })
      return
    }
    if (preset === 'custom') return
    this.set({ graphicsPreset: preset, ...PRESET_DEFAULTS[preset] }, { presetOverride: preset })
  }

  load(): void {
    try {
      let raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
        if (legacy) raw = legacy
      }
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<UserSettings>
      this.settings = { ...DEFAULT_SETTINGS, ...parsed }

      // Desktop ultra/high presets blow the mobile GPU budget and drop the WebGL context.
      const tooHeavy =
        (isMac() || isMobile()) &&
        (this.settings.graphicsPreset === 'ultra' || this.settings.graphicsPreset === 'high')
      if (tooHeavy) {
        this.settings.graphicsPreset = 'auto'
        Object.assign(this.settings, this.autoBaselineFields())
        this.save()
      }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS }
    }
  }

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings))
    } catch {
      // ignore quota / private mode
    }
  }

  toPerformanceSettings(): PerformanceSettings {
    const auto = detectPerformanceSettings()
    const s = this.settings
    const base = s.graphicsPreset === 'auto' ? auto : this.resolveFromUser(s, auto)

    if (!s.autoOptimize && s.graphicsPreset !== 'auto') {
      return base
    }
    if (s.graphicsPreset === 'auto') {
      return { ...base, ...auto }
    }
    return base
  }

  private autoBaselineFields(): Partial<UserSettings> {
    const auto = detectPerformanceSettings()
    return {
      resolutionScale: auto.maxPixelRatio / Math.max(1, window.devicePixelRatio || 1),
      shadows: auto.shadowMapSize >= 2048 ? 'high' : auto.shadowMapSize >= 1024 ? 'medium' : 'low',
      bloom: auto.enableBloom,
      antialiasing: auto.enableSMAA ? 'smaa' : 'off',
      vignette: auto.enableVignette,
      lightShafts: auto.lightShafts,
      environmentReflections: auto.environmentMap,
    }
  }

  private resolveFromUser(s: UserSettings, auto: PerformanceSettings): PerformanceSettings {
    const mapSize = shadowSize(s.shadows)
    const tier = tierFromPreset(s.graphicsPreset, auto)
    const dpr = window.devicePixelRatio || 1
    const maxPixelRatio = Math.min(dpr * s.resolutionScale, s.graphicsPreset === 'ultra' ? 2 : 1.75)

    return {
      tier,
      maxPixelRatio: Math.max(0.75, maxPixelRatio),
      shadowMapSize: mapSize,
      enableBloom: s.bloom,
      bloomScale: tier === 'high' ? 0.55 : 0.45,
      enableSMAA: s.antialiasing === 'smaa',
      enableVignette: s.vignette,
      lightShafts: s.lightShafts,
      environmentMap: s.environmentReflections,
      crosshairRayInterval: tier === 'high' ? 2 : tier === 'medium' ? 4 : 8,
      hudSyncInterval: tier === 'high' ? 1 / 30 : tier === 'medium' ? 1 / 20 : 1 / 12,
      toneMappingExposure: tier === 'high' ? 0.95 : tier === 'medium' ? 0.92 : 0.88,
    }
  }
}

export function shadowMapSizeFor(shadows: ShadowQuality): number {
  return shadowSize(shadows)
}
