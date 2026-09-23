/**
 * Procedural Web Audio SFX — no external files.
 * Layered oscillators + filtered noise with envelopes.
 * Supports positional (HRTF) playback for world-space events.
 */

import { MusicDirector, type MusicMode } from './MusicDirector'

export interface AudioManagerOptions {
  masterVolume?: number
  sfxVolume?: number
}

export type Vec3Like = { x: number; y: number; z: number }

type NoiseKind = 'white' | 'brown'

export class AudioManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfxBus: GainNode | null = null
  private masterVolume: number
  private sfxVolume: number
  private unlocked = false
  private footFlip = false
  private voices = 0
  private readonly maxVoices = 28
  private readonly noiseBuffers = new Map<NoiseKind, AudioBuffer>()
  private charge: { osc: OscillatorNode; gain: GainNode; lfo: OscillatorNode } | null = null
  private engine: { osc: OscillatorNode; gain: GainNode } | null = null
  private readonly unlockHandler: () => void
  readonly music: MusicDirector

  constructor(options: AudioManagerOptions = {}) {
    this.masterVolume = options.masterVolume ?? 0.85
    this.sfxVolume = options.sfxVolume ?? 0.9
    this.music = new MusicDirector(() => this.ensure())
    this.unlockHandler = () => {
      void this.resume()
    }
    document.addEventListener('pointerdown', this.unlockHandler, { once: true })
    document.addEventListener('keydown', this.unlockHandler, { once: true })
  }

  async resume(): Promise<void> {
    const ctx = this.ensure()
    if (ctx.state === 'suspended') await ctx.resume()
    this.unlocked = ctx.state === 'running'
    if (this.unlocked && this.master) this.music.attach(this.master)
  }

  isUnlocked(): boolean {
    return this.unlocked
  }

  /** Release the audio thread while the tab is in the background. */
  suspend(): void {
    const ctx = this.ctx
    if (ctx && ctx.state === 'running') void ctx.suspend()
  }

  setMasterVolume(v: number): void {
    this.masterVolume = clamp(v, 0, 1)
    if (this.master) this.master.gain.value = this.masterVolume
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = clamp(v, 0, 1)
    if (this.sfxBus) this.sfxBus.gain.value = this.sfxVolume
  }

  setMusicMode(mode: MusicMode): void {
    void this.resume()
    this.music.setMode(mode)
  }

  setMusicIntensity(v: number): void {
    this.music.setIntensity(v)
  }

  /** Low looping Warthog engine. `amount` is 0..1. */
  setEngine(amount: number): void {
    const ctx = this.ensure()
    const bus = this.sfxBus
    if (!bus) return
    if (!this.engine) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sawtooth'
      osc.frequency.value = 46
      gain.gain.value = 0
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 240
      osc.connect(filter)
      filter.connect(gain)
      gain.connect(bus)
      osc.start()
      this.engine = { osc, gain }
    }
    const level = clamp(amount, 0, 1)
    this.engine.gain.gain.setTargetAtTime(level * 0.045, ctx.currentTime, 0.08)
    this.engine.osc.frequency.setTargetAtTime(42 + level * 78, ctx.currentTime, 0.08)
  }

  chainGun(): void {
    this.gunshot({
      noiseDur: 0.04,
      noiseFreq: 980,
      bodyFreq: 110,
      gain: 0.16,
      metallic: true,
      toneFreq: 260,
    })
  }

  updateMusic(dt: number): void {
    this.music.update(dt)
  }

  /** Sync Web Audio listener to the player camera for HRTF positional SFX. */
  setListener(position: Vec3Like, forward: Vec3Like, up: Vec3Like = { x: 0, y: 1, z: 0 }): void {
    const ctx = this.ctx
    if (!ctx) return
    const l = ctx.listener
    if (l.positionX) {
      l.positionX.value = position.x
      l.positionY.value = position.y
      l.positionZ.value = position.z
      l.forwardX.value = forward.x
      l.forwardY.value = forward.y
      l.forwardZ.value = forward.z
      l.upX.value = up.x
      l.upY.value = up.y
      l.upZ.value = up.z
    } else {
      const legacy = l as AudioListener & {
        setPosition: (x: number, y: number, z: number) => void
        setOrientation: (
          fx: number,
          fy: number,
          fz: number,
          ux: number,
          uy: number,
          uz: number,
        ) => void
      }
      legacy.setPosition?.(position.x, position.y, position.z)
      legacy.setOrientation?.(forward.x, forward.y, forward.z, up.x, up.y, up.z)
    }
  }

  ui(): void {
    this.blip(720, 0.06, 0.22)
    this.blip(980, 0.07, 0.18, 0.05)
  }

  hitmarker(): void {
    this.blip(1400, 0.03, 0.18)
    this.blip(2100, 0.025, 0.12, 0.02)
  }

  shieldHit(): void {
    const ctx = this.ensure()
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(640, t0)
    osc.frequency.exponentialRampToValueAtTime(220, t0 + 0.18)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.4, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 700
    bp.Q.value = 4
    osc.connect(bp)
    bp.connect(g)
    g.connect(this.bus())
    osc.start(t0)
    osc.stop(t0 + 0.22)

    const shimmer = ctx.createOscillator()
    shimmer.type = 'triangle'
    shimmer.frequency.value = 1200
    const sg = ctx.createGain()
    sg.gain.setValueAtTime(0.12, t0)
    sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12)
    shimmer.connect(sg)
    sg.connect(this.bus())
    shimmer.start(t0)
    shimmer.stop(t0 + 0.14)
  }

  shieldBreak(): void {
    const ctx = this.ensure()
    const t0 = ctx.currentTime
    const noise = this.noise('white')
    const nf = ctx.createBiquadFilter()
    nf.type = 'lowpass'
    nf.frequency.setValueAtTime(3000, t0)
    nf.frequency.exponentialRampToValueAtTime(200, t0 + 0.3)
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.55, t0)
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35)
    noise.connect(nf)
    nf.connect(ng)
    ng.connect(this.bus())
    noise.start(t0)
    noise.stop(t0 + 0.35)

    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(180, t0)
    osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.4)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.32, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4)
    osc.connect(g)
    g.connect(this.bus())
    osc.start(t0)
    osc.stop(t0 + 0.42)
  }

  footstep(sprint = false): void {
    this.footFlip = !this.footFlip
    const ctx = this.ensure()
    const t0 = ctx.currentTime
    const noise = this.noise('brown')
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = sprint ? 500 : 350
    const g = ctx.createGain()
    g.gain.setValueAtTime(sprint ? 0.22 : 0.14, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07)
    noise.connect(f)
    f.connect(g)
    g.connect(this.bus())
    noise.start(t0)
    noise.stop(t0 + 0.08)
  }

  jump(): void {
    this.blip(180, 0.06, 0.12)
  }

  land(): void {
    const ctx = this.ensure()
    const t0 = ctx.currentTime
    const noise = this.noise('brown')
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 280
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.3, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12)
    noise.connect(f)
    f.connect(g)
    g.connect(this.bus())
    noise.start(t0)
    noise.stop(t0 + 0.12)
  }

  enemyDeath(): void {
    const ctx = this.ensure()
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(220, t0)
    osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.28)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.2, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3)
    osc.connect(g)
    g.connect(this.bus())
    osc.start(t0)
    osc.stop(t0 + 0.32)
  }

  enemyDeathAt(pos: Vec3Like): void {
    this.playPositional(
      pos,
      (dest) => {
        const ctx = this.ensure()
        const t0 = ctx.currentTime
        const osc = ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(220, t0)
        osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.28)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.28, t0)
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3)
        osc.connect(g)
        g.connect(dest)
        osc.start(t0)
        osc.stop(t0 + 0.32)
        const noise = this.noise('white')
        const nf = ctx.createBiquadFilter()
        nf.type = 'bandpass'
        nf.frequency.value = 500
        const ng = ctx.createGain()
        ng.gain.setValueAtTime(0.2, t0)
        ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2)
        noise.connect(nf)
        nf.connect(ng)
        ng.connect(dest)
        noise.start(t0)
        noise.stop(t0 + 0.22)
      },
      28,
    )
  }

  plasmaFireAt(pos: Vec3Like): void {
    this.playPositional(
      pos,
      (dest) => {
        const ctx = this.ensure()
        const t0 = ctx.currentTime
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(880, t0)
        osc.frequency.exponentialRampToValueAtTime(220, t0 + 0.15)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.22, t0)
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16)
        osc.connect(g)
        g.connect(dest)
        osc.start(t0)
        osc.stop(t0 + 0.18)
      },
      40,
    )
  }

  explosionAt(pos: Vec3Like): void {
    this.playPositional(
      pos,
      (dest) => {
        const ctx = this.ensure()
        const t0 = ctx.currentTime
        const noise = this.noise('white')
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.frequency.setValueAtTime(2000, t0)
        f.frequency.exponentialRampToValueAtTime(120, t0 + 0.35)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.55, t0)
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4)
        noise.connect(f)
        f.connect(g)
        g.connect(dest)
        noise.start(t0)
        noise.stop(t0 + 0.42)
      },
      55,
    )
  }

  reload(): void {
    this.click(0.25, undefined, 700)
    this.click(0.2, this.ensure().currentTime + 0.12, 1100)
  }

  empty(): void {
    this.click(0.2, undefined, 400)
  }

  weaponSwap(): void {
    this.click(0.18, undefined, 600)
    this.blip(320, 0.05, 0.08, 0.04)
  }

  brFire(): void {
    this.gunshot({
      noiseDur: 0.07,
      noiseFreq: 1800,
      bodyFreq: 90,
      gain: 0.5,
      metallic: true,
      toneFreq: 220,
    })
  }

  arFire(): void {
    this.gunshot({
      noiseDur: 0.05,
      noiseFreq: 2400,
      bodyFreq: 75,
      gain: 0.38,
      metallic: false,
      toneFreq: 160,
    })
  }

  plasmaFire(overcharge = false): void {
    const ctx = this.ensure()
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(overcharge ? 420 : 660, t0)
    osc.frequency.exponentialRampToValueAtTime(overcharge ? 80 : 200, t0 + (overcharge ? 0.25 : 0.12))
    const g = ctx.createGain()
    g.gain.setValueAtTime(overcharge ? 0.4 : 0.22, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + (overcharge ? 0.28 : 0.14))
    osc.connect(g)
    g.connect(this.bus())
    osc.start(t0)
    osc.stop(t0 + 0.3)
  }

  startPlasmaCharge(): void {
    if (this.charge) return
    const ctx = this.ensure()
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(120, t0)
    osc.frequency.linearRampToValueAtTime(480, t0 + 1.4)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.001, t0)
    g.gain.linearRampToValueAtTime(0.18, t0 + 1.2)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 8
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 12
    lfo.connect(lfoGain)
    lfoGain.connect(osc.frequency)
    osc.connect(g)
    g.connect(this.bus())
    osc.start(t0)
    lfo.start(t0)
    this.charge = { osc, gain: g, lfo }
  }

  stopCharge(): void {
    if (!this.charge || !this.ctx) return
    const t0 = this.ctx.currentTime
    const { osc, gain, lfo } = this.charge
    try {
      gain.gain.cancelScheduledValues(t0)
      gain.gain.setValueAtTime(Math.max(0.001, gain.gain.value), t0)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05)
      osc.stop(t0 + 0.06)
      lfo.stop(t0 + 0.06)
    } catch {
      /* already stopped */
    }
    this.charge = null
  }

  playWeaponFire(id: 'br' | 'ar' | 'plasma', overcharge = false): void {
    if (id === 'br') this.brFire()
    else if (id === 'ar') this.arFire()
    else this.plasmaFire(overcharge)
  }

  dispose(): void {
    this.stopCharge()
    if (this.engine) {
      try {
        this.engine.osc.stop()
      } catch {
        /* already stopped */
      }
      this.engine = null
    }
    this.music.dispose()
    document.removeEventListener('pointerdown', this.unlockHandler)
    document.removeEventListener('keydown', this.unlockHandler)
    void this.ctx?.close()
    this.ctx = null
    this.master = null
    this.sfxBus = null
  }

  private playPositional(
    pos: Vec3Like,
    build: (dest: AudioNode) => void,
    maxDistance = 45,
  ): void {
    const ctx = this.ensure()
    if (!this.tryVoice(800)) return
    const panner = ctx.createPanner()
    // equalpower stays positional without the HRTF convolver, which stalls
    // the audio thread (and then the frame loop) once many shots overlap.
    panner.panningModel = 'equalpower'
    panner.distanceModel = 'inverse'
    panner.refDistance = 2
    panner.maxDistance = maxDistance
    panner.rolloffFactor = 1.2
    if (panner.positionX) {
      panner.positionX.value = pos.x
      panner.positionY.value = pos.y
      panner.positionZ.value = pos.z
    } else {
      ;(panner as PannerNode & { setPosition: (x: number, y: number, z: number) => void }).setPosition?.(
        pos.x,
        pos.y,
        pos.z,
      )
    }
    panner.connect(this.bus())
    build(panner)
    setTimeout(() => {
      try {
        panner.disconnect()
      } catch {
        /* ignore */
      }
    }, 800)
  }

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctx()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.masterVolume
    this.sfxBus = this.ctx.createGain()
    this.sfxBus.gain.value = this.sfxVolume
    this.sfxBus.connect(this.master)
    this.master.connect(this.ctx.destination)
    this.music.attach(this.master)
    return this.ctx
  }

  private bus(): GainNode {
    this.ensure()
    return this.sfxBus!
  }

  private blip(freq: number, dur: number, gain: number, delay = 0): void {
    const ctx = this.ensure()
    const t0 = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
    osc.connect(g)
    g.connect(this.bus())
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  private click(gain: number, at?: number, freq = 900): void {
    const ctx = this.ensure()
    const t0 = at ?? ctx.currentTime
    const noise = this.noise('white')
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = freq
    f.Q.value = 5
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain * 0.35, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.035)
    noise.connect(f)
    f.connect(g)
    g.connect(this.bus())
    noise.start(t0)
    noise.stop(t0 + 0.05)
  }

  private tryVoice(ms: number): boolean {
    if (this.voices >= this.maxVoices) return false
    this.voices += 1
    window.setTimeout(() => {
      this.voices = Math.max(0, this.voices - 1)
    }, ms)
    return true
  }

  private gunshot(p: {
    noiseDur: number
    noiseFreq: number
    bodyFreq: number
    gain: number
    metallic: boolean
    toneFreq: number
  }): void {
    if (!this.tryVoice(Math.ceil((p.noiseDur + 0.12) * 1000))) return
    const ctx = this.ensure()
    const t0 = ctx.currentTime

    const noise = this.noise('white')
    const nFilter = ctx.createBiquadFilter()
    nFilter.type = 'bandpass'
    nFilter.frequency.value = p.noiseFreq
    nFilter.Q.value = 0.8
    const nGain = ctx.createGain()
    nGain.gain.setValueAtTime(p.gain, t0)
    nGain.gain.exponentialRampToValueAtTime(0.001, t0 + p.noiseDur)
    noise.connect(nFilter)
    nFilter.connect(nGain)
    nGain.connect(this.bus())
    noise.start(t0)
    noise.stop(t0 + p.noiseDur + 0.02)

    const body = ctx.createOscillator()
    body.type = 'sine'
    body.frequency.setValueAtTime(p.bodyFreq, t0)
    body.frequency.exponentialRampToValueAtTime(40, t0 + 0.08)
    const bGain = ctx.createGain()
    bGain.gain.setValueAtTime(p.gain * 0.85, t0)
    bGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1)
    body.connect(bGain)
    bGain.connect(this.bus())
    body.start(t0)
    body.stop(t0 + 0.12)

    if (p.metallic) {
      const ring = ctx.createOscillator()
      ring.type = 'triangle'
      ring.frequency.value = p.toneFreq * 2.5
      const rGain = ctx.createGain()
      rGain.gain.setValueAtTime(p.gain * 0.22, t0)
      rGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09)
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 600
      ring.connect(hp)
      hp.connect(rGain)
      rGain.connect(this.bus())
      ring.start(t0)
      ring.stop(t0 + 0.1)
    }
  }

  /**
   * One cached buffer per noise color. Filling a new buffer on every shot
   * (especially the chain gun) was a main-thread hitch during firefights.
   */
  private noise(kind: NoiseKind): AudioBufferSourceNode {
    const ctx = this.ensure()
    let buffer = this.noiseBuffers.get(kind)
    if (!buffer) {
      const length = Math.max(1, Math.floor(ctx.sampleRate * 0.5))
      buffer = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      let last = 0
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1
        if (kind === 'brown') {
          last = (last + 0.02 * white) / 1.02
          data[i] = last * 3.5
        } else {
          data[i] = white
        }
      }
      this.noiseBuffers.set(kind, buffer)
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer
    return src
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
