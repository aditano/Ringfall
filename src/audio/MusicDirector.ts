/**
 * Dynamic layered music + Halo CE–inspired Gregorian choir bed.
 * All procedural — original composition, not licensed Halo audio.
 */

export type MusicMode = 'menu' | 'explore' | 'combat' | 'victory' | 'silence'

export class MusicDirector {
  private ctx: AudioContext | null = null
  private musicBus: GainNode | null = null
  private mode: MusicMode = 'silence'
  private intensity = 0
  private targetIntensity = 0
  private started = false
  private voices: Array<{ osc: OscillatorNode; gain: GainNode; base: number }> = []
  private pads: Array<{ osc: OscillatorNode; gain: GainNode }> = []
  private combatPulse: { osc: OscillatorNode; gain: GainNode; lfo: OscillatorNode } | null = null
  private percussionTimer: number | null = null
  private choirTimer: number | null = null
  private chordIndex = 0
  private readonly menuChords = [
    // Dorian / Aeolian-flavored open fifths — solemn, not a Halo transcription
    [110, 146.83, 164.81, 220],
    [98, 146.83, 196, 233.08],
    [87.31, 130.81, 174.61, 220],
    [123.47, 164.81, 185, 246.94],
  ]
  private readonly exploreChords = [
    [130.81, 164.81, 196, 261.63],
    [146.83, 174.61, 220, 293.66],
    [110, 164.81, 196, 246.94],
  ]
  private readonly combatChords = [
    [82.41, 123.47, 164.81, 246.94],
    [92.5, 138.59, 185, 277.18],
    [103.83, 155.56, 207.65, 311.13],
  ]

  constructor(private getContext: () => AudioContext) {}

  attach(master: GainNode): void {
    this.ctx = this.getContext()
    if (this.musicBus) return
    this.musicBus = this.ctx.createGain()
    this.musicBus.gain.value = 0.32
    this.musicBus.connect(master)
  }

  setMode(mode: MusicMode): void {
    if (this.mode === mode) return
    this.mode = mode
    if (!this.started && mode !== 'silence') this.startEngine()
    this.retargetLayers()
  }

  /** 0..1 combat heat — drives percussion and brighter choir. */
  setIntensity(v: number): void {
    this.targetIntensity = Math.max(0, Math.min(1, v))
  }

  update(dt: number): void {
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, dt * 1.8)
    if (!this.ctx || !this.combatPulse) return
    const t = this.ctx.currentTime
    const combatGain = this.mode === 'combat' ? 0.08 + this.intensity * 0.22 : this.intensity * 0.04
    this.combatPulse.gain.gain.setTargetAtTime(combatGain, t, 0.4)
    this.combatPulse.lfo.frequency.setTargetAtTime(1.5 + this.intensity * 4, t, 0.5)
  }

  private startEngine(): void {
    if (!this.ctx || !this.musicBus || this.started) return
    this.started = true
    const ctx = this.ctx
    const bus = this.musicBus

    // Soft reverb
    const convolver = ctx.createConvolver()
    convolver.buffer = this.makeReverbImpulse(2.8)
    const revGain = ctx.createGain()
    revGain.gain.value = 0.45
    const dry = ctx.createGain()
    dry.gain.value = 0.7
    dry.connect(bus)
    convolver.connect(revGain)
    revGain.connect(bus)

    // Choir voices (4)
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator()
      osc.type = i % 2 === 0 ? 'sine' : 'triangle'
      const gain = ctx.createGain()
      gain.gain.value = 0.0001
      const filt = ctx.createBiquadFilter()
      filt.type = 'lowpass'
      filt.frequency.value = 1200 + i * 200
      filt.Q.value = 0.7
      osc.connect(filt)
      filt.connect(gain)
      gain.connect(dry)
      gain.connect(convolver)
      osc.start()
      this.voices.push({ osc, gain, base: 110 })
    }

    // Deep pads
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      const gain = ctx.createGain()
      gain.gain.value = 0.0001
      osc.connect(gain)
      gain.connect(dry)
      gain.connect(convolver)
      osc.frequency.value = 55 * (i + 1)
      osc.start()
      this.pads.push({ osc, gain })
    }

    // Combat pulse bed
    const pulse = ctx.createOscillator()
    pulse.type = 'sawtooth'
    pulse.frequency.value = 55
    const pg = ctx.createGain()
    pg.gain.value = 0.0001
    const pf = ctx.createBiquadFilter()
    pf.type = 'lowpass'
    pf.frequency.value = 400
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 2
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.15
    lfo.connect(lfoGain)
    lfoGain.connect(pg.gain)
    pulse.connect(pf)
    pf.connect(pg)
    pg.connect(dry)
    pulse.start()
    lfo.start()
    this.combatPulse = { osc: pulse, gain: pg, lfo }

    this.scheduleChoir()
    this.schedulePercussion()
    this.retargetLayers()
  }

  private scheduleChoir(): void {
    if (!this.ctx) return
    const tick = () => {
      if (!this.ctx || this.mode === 'silence') {
        this.choirTimer = window.setTimeout(tick, 2000)
        return
      }
      const chords =
        this.mode === 'menu'
          ? this.menuChords
          : this.mode === 'combat'
            ? this.combatChords
            : this.exploreChords
      this.chordIndex = (this.chordIndex + 1) % chords.length
      const chord = chords[this.chordIndex]!
      const t = this.ctx.currentTime
      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i]!
        const freq = chord[i % chord.length]! * (1 + (Math.random() - 0.5) * 0.004)
        v.osc.frequency.setTargetAtTime(freq, t, 0.8)
        const vol =
          this.mode === 'menu'
            ? 0.045 + i * 0.01
            : this.mode === 'combat'
              ? 0.03 + this.intensity * 0.04
              : 0.025
        v.gain.gain.setTargetAtTime(vol, t, 1.2)
      }
      for (let i = 0; i < this.pads.length; i++) {
        const p = this.pads[i]!
        p.osc.frequency.setTargetAtTime(chord[0]! / (i + 1), t, 1.5)
        p.gain.gain.setTargetAtTime(this.mode === 'menu' ? 0.06 : 0.035, t, 1.5)
      }
      const hold = this.mode === 'menu' ? 5200 + Math.random() * 1800 : 3200 + Math.random() * 1200
      this.choirTimer = window.setTimeout(tick, hold)
    }
    tick()
  }

  private schedulePercussion(): void {
    const tick = () => {
      if (!this.ctx || !this.musicBus) {
        this.percussionTimer = window.setTimeout(tick, 500)
        return
      }
      const active = this.mode === 'combat' || this.intensity > 0.35
      if (active) {
        this.thump(0.12 + this.intensity * 0.15)
        if (this.intensity > 0.55 && Math.random() > 0.4) {
          setTimeout(() => this.thump(0.08), 120)
        }
      }
      const interval =
        this.mode === 'combat' ? 420 - this.intensity * 160 : 900 - this.intensity * 300
      this.percussionTimer = window.setTimeout(tick, Math.max(220, interval))
    }
    tick()
  }

  private thump(gain: number): void {
    if (!this.ctx || !this.musicBus) return
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(90, t)
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.18)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
    osc.connect(g)
    g.connect(this.musicBus)
    osc.start(t)
    osc.stop(t + 0.25)
  }

  private retargetLayers(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    if (this.mode === 'silence') {
      for (const v of this.voices) v.gain.gain.setTargetAtTime(0.0001, t, 0.5)
      for (const p of this.pads) p.gain.gain.setTargetAtTime(0.0001, t, 0.5)
      if (this.combatPulse) this.combatPulse.gain.gain.setTargetAtTime(0.0001, t, 0.5)
      return
    }
    if (this.mode === 'victory') {
      for (const v of this.voices) v.gain.gain.setTargetAtTime(0.06, t, 0.8)
      this.targetIntensity = 0.2
    }
  }

  private makeReverbImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!
    const rate = ctx.sampleRate
    // Keep this short. A multi-second impulse filled with Math.pow on the
    // main thread froze the first click that started music.
    const length = Math.floor(rate * Math.min(seconds, 0.7))
    const buffer = ctx.createBuffer(2, length, rate)
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch)
      for (let i = 0; i < length; i++) {
        const t = 1 - i / length
        data[i] = (Math.random() * 2 - 1) * t * t
      }
    }
    return buffer
  }

  dispose(): void {
    if (this.choirTimer != null) clearTimeout(this.choirTimer)
    if (this.percussionTimer != null) clearTimeout(this.percussionTimer)
    for (const v of this.voices) {
      try {
        v.osc.stop()
      } catch {
        /* ignore */
      }
    }
    for (const p of this.pads) {
      try {
        p.osc.stop()
      } catch {
        /* ignore */
      }
    }
    if (this.combatPulse) {
      try {
        this.combatPulse.osc.stop()
        this.combatPulse.lfo.stop()
      } catch {
        /* ignore */
      }
    }
  }
}
