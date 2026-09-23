export type QualityTier = 'high' | 'medium' | 'low'

export interface PerformanceSettings {
  tier: QualityTier
  maxPixelRatio: number
  shadowMapSize: number
  enableBloom: boolean
  bloomScale: number
  enableSMAA: boolean
  enableVignette: boolean
  lightShafts: boolean
  environmentMap: boolean
  crosshairRayInterval: number
  hudSyncInterval: number
  toneMappingExposure: number
}

const UA = typeof navigator !== 'undefined' ? navigator.userAgent : ''

function isSafari(): boolean {
  return /Safari/i.test(UA) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/i.test(UA)
}

export function isMobile(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(UA)
}

/** macOS laptops — Chrome included; integrated GPUs struggle with full post stack. */
export function isMac(): boolean {
  return /Macintosh|Mac OS X/i.test(UA)
}

const MAC_LOW: PerformanceSettings = {
  tier: 'low',
  maxPixelRatio: 1,
  shadowMapSize: 512,
  enableBloom: false,
  bloomScale: 0.45,
  enableSMAA: false,
  enableVignette: false,
  lightShafts: false,
  environmentMap: false,
  crosshairRayInterval: 8,
  hudSyncInterval: 1 / 12,
  toneMappingExposure: 0.88,
}

/** Pick conservative defaults for Safari / mobile / Mac GPUs. */
export function detectPerformanceSettings(): PerformanceSettings {
  const safari = isSafari()
  const mobile = isMobile()
  const mac = isMac()

  if (mac) {
    return { ...MAC_LOW }
  }

  if (safari || mobile) {
    return {
      tier: 'low',
      // Phones lose the WebGL context when a full-resolution shadow map sits next to the color buffer.
      maxPixelRatio: 1,
      shadowMapSize: mobile ? 0 : 512,
      enableBloom: false,
      bloomScale: 0.45,
      enableSMAA: false,
      enableVignette: false,
      lightShafts: false,
      environmentMap: false,
      crosshairRayInterval: mobile ? 8 : 6,
      hudSyncInterval: mobile ? 1 / 12 : 1 / 15,
      toneMappingExposure: 0.9,
    }
  }

  return {
    tier: 'high',
    maxPixelRatio: 1.35,
    shadowMapSize: 2048,
    enableBloom: true,
    bloomScale: 0.55,
    enableSMAA: true,
    enableVignette: true,
    lightShafts: true,
    environmentMap: true,
    crosshairRayInterval: 2,
    hudSyncInterval: 1 / 30,
    toneMappingExposure: 0.95,
  }
}

/** Step down quality when sustained frame times exceed budget. */
export function downgradeSettings(current: PerformanceSettings): PerformanceSettings {
  if (current.tier === 'high') {
    return {
      ...current,
      tier: 'medium',
      maxPixelRatio: 1.15,
      shadowMapSize: 1024,
      enableSMAA: false,
      enableBloom: true,
      bloomScale: 0.45,
      lightShafts: false,
      crosshairRayInterval: 4,
      toneMappingExposure: 0.92,
    }
  }
  if (current.tier === 'medium') {
    return {
      ...current,
      tier: 'low',
      maxPixelRatio: 1,
      shadowMapSize: 512,
      enableBloom: false,
      enableSMAA: false,
      enableVignette: false,
      lightShafts: false,
      environmentMap: false,
      crosshairRayInterval: 8,
      hudSyncInterval: 1 / 12,
      toneMappingExposure: 0.88,
    }
  }
  if (current.maxPixelRatio > 0.85) {
    return { ...current, maxPixelRatio: 0.85, shadowMapSize: 0, crosshairRayInterval: 10 }
  }
  return current
}
