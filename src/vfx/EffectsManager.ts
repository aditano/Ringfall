import * as THREE from 'three'

export interface ScreenShakeState {
  trauma: number
  offset: THREE.Vector3
  roll: number
}

export interface TracerOptions {
  origin: THREE.Vector3
  end: THREE.Vector3
  color?: number
  duration?: number
  width?: number
}

export interface DecalOptions {
  position: THREE.Vector3
  normal: THREE.Vector3
  color?: number
  size?: number
  lifetime?: number
  emissive?: boolean
}

export interface BurstOptions {
  position: THREE.Vector3
  color?: number
  count?: number
  speed?: number
  lifetime?: number
  size?: number
  gravity?: number
}

interface PoolItem {
  alive: boolean
  age: number
  lifetime: number
}

interface Particle extends PoolItem {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  gravity: number
  startScale: number
  color: THREE.Color
}

interface Tracer extends PoolItem {
  line: THREE.Line
  startOpacity: number
}

interface Decal extends PoolItem {
  mesh: THREE.Mesh
  startOpacity: number
}

const PARTICLE_POOL = 256
const TRACER_POOL = 64
const DECAL_POOL = 48
const RIPPLE_POOL = 12
const MAX_DECALS_VISIBLE = 40

const _tmpV = new THREE.Vector3()
const _tmpV2 = new THREE.Vector3()
const _tmpM = new THREE.Matrix4()
const _tmpEye = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

/**
 * Pooled VFX: muzzle sparks, plasma impacts, shield ripples,
 * explosions, dust, bullet tracers, surface decals, and screen-shake hooks.
 */
export class EffectsManager {
  readonly root = new THREE.Group()

  private readonly particles: Particle[] = []
  private readonly tracers: Tracer[] = []
  private readonly decals: Decal[] = []
  private decalStamp = 0

  private trauma = 0
  private readonly shakeOffset = new THREE.Vector3()
  private shakeRoll = 0
  private readonly shakeSeed = Math.random() * 1000

  private readonly particleGeo: THREE.SphereGeometry
  private readonly particleMat: THREE.MeshBasicMaterial
  private readonly tracerMat: THREE.LineBasicMaterial
  private readonly decalMat: THREE.MeshBasicMaterial
  private readonly rippleMat: THREE.MeshBasicMaterial
  private readonly rippleGeo: THREE.RingGeometry

  private readonly activeRipples: {
    mesh: THREE.Mesh
    age: number
    lifetime: number
    alive: boolean
  }[] = []

  constructor(scene: THREE.Scene) {
    this.root.name = 'EffectsManager'
    scene.add(this.root)

    this.particleGeo = new THREE.SphereGeometry(1, 6, 4)
    this.particleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    this.tracerMat = new THREE.LineBasicMaterial({
      color: 0xffcc66,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      linewidth: 1,
    })

    this.decalMat = new THREE.MeshBasicMaterial({
      color: 0x1a1208,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    })

    this.rippleMat = new THREE.MeshBasicMaterial({
      color: 0x66ffcc,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    })
    this.rippleGeo = new THREE.RingGeometry(0.05, 0.2, 16)

    this.initPools()
    this.initRipplePool()
  }

  // —— public spawn API ————————————————————————————————————————————————

  /** Hot muzzle sparks at a weapon muzzle. */
  spawnMuzzleSparks(position: THREE.Vector3, direction: THREE.Vector3, color = 0xffaa44): void {
    this.burst({
      position,
      color,
      count: 10,
      speed: 6,
      lifetime: 0.12,
      size: 0.035,
      gravity: 0,
    })
    // Cone along barrel
    for (let i = 0; i < 6; i++) {
      _tmpV.copy(direction).normalize()
      _tmpV.x += (Math.random() - 0.5) * 0.35
      _tmpV.y += (Math.random() - 0.5) * 0.35
      _tmpV.z += (Math.random() - 0.5) * 0.35
      _tmpV.normalize().multiplyScalar(8 + Math.random() * 10)
      this.emitParticle(position, _tmpV, color, 0.08 + Math.random() * 0.06, 0.04, 0)
    }
  }

  /** Plasma bolt impact flash + residual sparks. */
  spawnPlasmaImpact(position: THREE.Vector3, normal: THREE.Vector3, color = 0x44ffaa): void {
    this.burst({
      position,
      color,
      count: 18,
      speed: 9,
      lifetime: 0.35,
      size: 0.05,
      gravity: 4,
    })
    this.spawnDecal({
      position,
      normal,
      color,
      size: 0.35 + Math.random() * 0.2,
      lifetime: 8,
      emissive: true,
    })
    this.spawnRipple(position, normal, color, 0.9)
    this.addTrauma(0.12)
  }

  /** Energy shield hit ripple on a character. */
  spawnShieldRipple(position: THREE.Vector3, color = 0x66ffcc): void {
    this.burst({
      position,
      color,
      count: 12,
      speed: 5,
      lifetime: 0.28,
      size: 0.04,
      gravity: 0,
    })
    this.spawnRipple(position, _up, color, 1.2)
  }

  /** @deprecated Prefer spawnShieldRipple */
  shieldRipple(position: THREE.Vector3, color = 0x66ffcc): void {
    this.spawnShieldRipple(position, color)
  }

  /** Generic surface impact (bullet / plasma). */
  spawnImpact(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    kind: 'bullet' | 'plasma' | string = 'bullet',
  ): void {
    if (kind === 'plasma') {
      this.spawnPlasmaImpact(position, normal, 0xc44dff)
    } else {
      this.burst({
        position,
        color: 0xffcc88,
        count: 10,
        speed: 5,
        lifetime: 0.22,
        size: 0.03,
        gravity: 3,
      })
      this.spawnDecal({
        position,
        normal,
        color: 0x1a1208,
        size: 0.22,
        lifetime: 12,
      })
      this.addTrauma(0.05)
    }
  }

  /** Soft explosion — grenades / elite death. */
  spawnExplosion(position: THREE.Vector3, color = 0xff6622, scale = 1): void {
    this.burst({
      position,
      color,
      count: Math.floor(28 * scale),
      speed: 14 * scale,
      lifetime: 0.55,
      size: 0.08 * scale,
      gravity: 6,
    })
    this.burst({
      position,
      color: 0xffee88,
      count: Math.floor(10 * scale),
      speed: 6 * scale,
      lifetime: 0.25,
      size: 0.12 * scale,
      gravity: 0,
    })
    this.spawnRipple(position, _up, color, 1.6 * scale)
    this.addTrauma(0.45 * scale)
  }

  /** @deprecated Prefer spawnExplosion */
  explosion(position: THREE.Vector3, color = 0xff6622, scale = 1): void {
    this.spawnExplosion(position, color, scale)
  }

  /** Footstep / landing dust puff. */
  spawnDust(position: THREE.Vector3, color = 0xc4b89a): void {
    this.burst({
      position,
      color,
      count: 8,
      speed: 1.6,
      lifetime: 0.7,
      size: 0.07,
      gravity: -0.4,
    })
  }

  /** Thin emissive tracer from origin → end. */
  spawnTracer(opts: TracerOptions): void {
    const tracer = this.acquireTracer()
    if (!tracer) return

    const color = opts.color ?? 0xffcc66
    const geo = tracer.line.geometry as THREE.BufferGeometry
    const positions = geo.attributes.position as THREE.BufferAttribute
    positions.setXYZ(0, opts.origin.x, opts.origin.y, opts.origin.z)
    positions.setXYZ(1, opts.end.x, opts.end.y, opts.end.z)
    positions.needsUpdate = true

    const mat = tracer.line.material as THREE.LineBasicMaterial
    mat.color.setHex(color)
    mat.opacity = 0.95
    tracer.line.visible = true
    tracer.alive = true
    tracer.age = 0
    tracer.lifetime = opts.duration ?? 0.08
    tracer.startOpacity = 0.95
  }

  /** Project a simple quad decal onto a surface along its normal. */
  spawnDecal(opts: DecalOptions): void {
    const decal = this.acquireDecal()
    if (!decal) return

    const size = opts.size ?? 0.3
    decal.mesh.scale.set(size, size, 1)
    decal.mesh.position.copy(opts.position).addScaledVector(opts.normal, 0.01)

    _tmpV.copy(opts.normal).normalize()
    _tmpEye.copy(opts.position).add(_tmpV)
    _tmpM.lookAt(_tmpEye, opts.position, _up)
    decal.mesh.quaternion.setFromRotationMatrix(_tmpM)

    const mat = decal.mesh.material as THREE.MeshBasicMaterial
    mat.color.setHex(opts.color ?? 0x1a1208)
    mat.opacity = opts.emissive ? 0.75 : 0.85
    mat.blending = opts.emissive ? THREE.AdditiveBlending : THREE.NormalBlending

    decal.mesh.visible = true
    decal.alive = true
    decal.age = 0
    decal.lifetime = opts.lifetime ?? 10
    decal.startOpacity = mat.opacity
    this.decalStamp += 1
    this.cullOldDecals()
  }

  // —— screen shake ————————————————————————————————————————————————————

  /** Add trauma in 0–1 range (nonlinear → shake magnitude). */
  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  resetTrauma(): void {
    this.trauma = 0
    this.shakeOffset.set(0, 0, 0)
    this.shakeRoll = 0
  }

  /** Alias used by some combat hooks. */
  addShake(amount: number): void {
    this.addTrauma(amount)
  }

  /**
   * Consume trauma into a scalar shake magnitude for manual camera offset.
   * Prefer applyShakeToCamera when possible.
   */
  consumeShake(dt: number): number {
    const shake = this.getScreenShake(dt)
    return shake.trauma * shake.trauma * 0.35
  }

  /** Soften trauma over time; call from game loop. */
  getScreenShake(_dt: number): ScreenShakeState {
    const shake = this.trauma * this.trauma
    const t = performance.now() * 0.001 + this.shakeSeed
    this.shakeOffset.set(
      Math.sin(t * 37.1) * shake * 0.12,
      Math.cos(t * 29.7) * shake * 0.1,
      Math.sin(t * 41.3) * shake * 0.04,
    )
    this.shakeRoll = Math.sin(t * 33.0) * shake * 0.035
    return {
      trauma: this.trauma,
      offset: this.shakeOffset,
      roll: this.shakeRoll,
    }
  }

  /** Apply shake offsets to a camera (call after camera pose is set). */
  applyShakeToCamera(camera: THREE.Camera, dt: number): void {
    const shake = this.getScreenShake(dt)
    camera.position.add(shake.offset)
    // Roll omitted — rotateZ was accumulating every frame and caused camera hitch.
  }

  // —— update / dispose ————————————————————————————————————————————————

  update(dt: number): void {
    this.trauma = Math.max(0, this.trauma - dt * 1.35)
    this.updateParticles(dt)
    this.updateTracers(dt)
    this.updateDecals(dt)
    this.updateRipples(dt)
  }

  dispose(): void {
    for (const p of this.particles) {
      p.mesh.geometry.dispose()
      ;(p.mesh.material as THREE.Material).dispose()
    }
    for (const t of this.tracers) {
      t.line.geometry.dispose()
      ;(t.line.material as THREE.Material).dispose()
    }
    for (const d of this.decals) {
      d.mesh.geometry.dispose()
      ;(d.mesh.material as THREE.Material).dispose()
    }
    for (const r of this.activeRipples) {
      ;(r.mesh.material as THREE.Material).dispose()
    }
    this.rippleGeo.dispose()
    this.particleGeo.dispose()
    this.particleMat.dispose()
    this.tracerMat.dispose()
    this.decalMat.dispose()
    this.rippleMat.dispose()
    this.root.removeFromParent()
  }

  // —— pooling ——————————————————————————————————————————————————————————

  private initPools(): void {
    for (let i = 0; i < PARTICLE_POOL; i++) {
      const mat = this.particleMat.clone()
      const mesh = new THREE.Mesh(this.particleGeo, mat)
      mesh.visible = false
      mesh.frustumCulled = false
      this.root.add(mesh)
      this.particles.push({
        alive: false,
        age: 0,
        lifetime: 1,
        mesh,
        velocity: new THREE.Vector3(),
        gravity: 0,
        startScale: 0.05,
        color: new THREE.Color(),
      })
    }

    for (let i = 0; i < TRACER_POOL; i++) {
      const geo = new THREE.BufferGeometry()
      const positions = new Float32Array(6)
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const mat = this.tracerMat.clone()
      const line = new THREE.Line(geo, mat)
      line.visible = false
      line.frustumCulled = false
      this.root.add(line)
      this.tracers.push({
        alive: false,
        age: 0,
        lifetime: 0.1,
        line,
        startOpacity: 1,
      })
    }

    const decalGeo = new THREE.PlaneGeometry(1, 1)
    for (let i = 0; i < DECAL_POOL; i++) {
      const mat = this.decalMat.clone()
      const mesh = new THREE.Mesh(decalGeo, mat)
      mesh.visible = false
      mesh.frustumCulled = true
      this.root.add(mesh)
      this.decals.push({
        alive: false,
        age: 0,
        lifetime: 10,
        mesh,
        startOpacity: 1,
      })
    }
  }

  private acquireParticle(): Particle | null {
    for (const p of this.particles) if (!p.alive) return p
    // Steal oldest
    let oldest = this.particles[0]!
    for (const p of this.particles) if (p.age > oldest.age) oldest = p
    return oldest
  }

  private acquireTracer(): Tracer | null {
    for (const t of this.tracers) if (!t.alive) return t
    let oldest = this.tracers[0]!
    for (const t of this.tracers) if (t.age > oldest.age) oldest = t
    return oldest
  }

  private acquireDecal(): Decal | null {
    for (const d of this.decals) if (!d.alive) return d
    let oldest = this.decals[0]!
    for (const d of this.decals) if (d.age > oldest.age) oldest = d
    return oldest
  }

  private emitParticle(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    color: number,
    lifetime: number,
    size: number,
    gravity: number,
  ): void {
    const p = this.acquireParticle()
    if (!p) return
    p.mesh.position.copy(position)
    p.velocity.copy(velocity)
    p.color.setHex(color)
    ;(p.mesh.material as THREE.MeshBasicMaterial).color.copy(p.color)
    ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = 1
    p.startScale = size
    p.mesh.scale.setScalar(size)
    p.mesh.visible = true
    p.alive = true
    p.age = 0
    p.lifetime = lifetime
    p.gravity = gravity
  }

  private burst(opts: BurstOptions): void {
    const count = opts.count ?? 12
    const speed = opts.speed ?? 5
    const lifetime = opts.lifetime ?? 0.4
    const size = opts.size ?? 0.05
    const gravity = opts.gravity ?? 2
    const color = opts.color ?? 0xffffff

    for (let i = 0; i < count; i++) {
      _tmpV2.set(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8))
      this.emitParticle(
        opts.position,
        _tmpV2,
        color,
        lifetime * (0.6 + Math.random() * 0.5),
        size * (0.6 + Math.random() * 0.6),
        gravity,
      )
    }
  }

  private initRipplePool(): void {
    for (let i = 0; i < RIPPLE_POOL; i++) {
      const mat = this.rippleMat.clone()
      const mesh = new THREE.Mesh(this.rippleGeo, mat)
      mesh.visible = false
      mesh.frustumCulled = false
      this.root.add(mesh)
      this.activeRipples.push({ mesh, age: 0, lifetime: 0.35, alive: false })
    }
  }

  private acquireRipple(): (typeof this.activeRipples)[number] | null {
    for (const r of this.activeRipples) if (!r.alive) return r
    let oldest = this.activeRipples[0]!
    for (const r of this.activeRipples) if (r.age > oldest.age) oldest = r
    return oldest
  }

  private spawnRipple(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    color: number,
    scale: number,
  ): void {
    const ripple = this.acquireRipple()
    if (!ripple) return

    const mesh = ripple.mesh
    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.color.setHex(color)
    mesh.position.copy(position).addScaledVector(normal, 0.02)
    _tmpV.copy(normal).normalize()
    _tmpEye.copy(position).add(_tmpV)
    _tmpM.lookAt(_tmpEye, position, _up)
    mesh.quaternion.setFromRotationMatrix(_tmpM)
    mesh.scale.setScalar(scale * 0.3)
    mat.opacity = 0.55
    mesh.visible = true
    ripple.alive = true
    ripple.age = 0
    ripple.lifetime = 0.35
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      if (!p.alive) continue
      p.age += dt
      if (p.age >= p.lifetime) {
        p.alive = false
        p.mesh.visible = false
        continue
      }
      p.velocity.y -= p.gravity * dt
      p.mesh.position.addScaledVector(p.velocity, dt)
      const t = p.age / p.lifetime
      const mat = p.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = 1 - t
      p.mesh.scale.setScalar(p.startScale * (1 + t * 0.8))
    }
  }

  private updateTracers(dt: number): void {
    for (const t of this.tracers) {
      if (!t.alive) continue
      t.age += dt
      if (t.age >= t.lifetime) {
        t.alive = false
        t.line.visible = false
        continue
      }
      const fade = 1 - t.age / t.lifetime
      ;(t.line.material as THREE.LineBasicMaterial).opacity = t.startOpacity * fade
    }
  }

  private updateDecals(dt: number): void {
    for (const d of this.decals) {
      if (!d.alive) continue
      d.age += dt
      if (d.age >= d.lifetime) {
        d.alive = false
        d.mesh.visible = false
        continue
      }
      // Fade last 25%
      const fadeStart = d.lifetime * 0.75
      if (d.age > fadeStart) {
        const f = 1 - (d.age - fadeStart) / (d.lifetime - fadeStart)
        ;(d.mesh.material as THREE.MeshBasicMaterial).opacity = d.startOpacity * f
      }
    }
  }

  private updateRipples(dt: number): void {
    for (const r of this.activeRipples) {
      if (!r.alive) continue
      r.age += dt
      const t = r.age / r.lifetime
      if (t >= 1) {
        r.alive = false
        r.mesh.visible = false
        continue
      }
      r.mesh.scale.setScalar(0.3 + t * 2.2)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t)
    }
  }

  private cullOldDecals(): void {
    let alive = 0
    for (const d of this.decals) if (d.alive) alive += 1
    if (alive <= MAX_DECALS_VISIBLE) return

    // Kill oldest extras
    const live = this.decals.filter((d) => d.alive).sort((a, b) => b.age - a.age)
    const excess = alive - MAX_DECALS_VISIBLE
    for (let i = 0; i < excess; i++) {
      const d = live[i]
      if (!d) break
      d.alive = false
      d.mesh.visible = false
    }
  }
}
