import * as THREE from 'three'

/**
 * Plasma / hardlight bolt with glow trail. Used by WeaponSystem and EnemyManager.
 *
 * Bolts are pooled. They deliberately have no PointLight: each add/remove changes
 * Three's scene-wide point-light count, which recompiles every lit shader and
 * stalls the main thread mid-firefight.
 */
export class Projectile {
  readonly mesh: THREE.Group
  readonly core: THREE.Mesh
  readonly velocity = new THREE.Vector3()
  life = 2.5
  damage = 18
  radius = 0.15
  fromPlayer = true
  alive = false
  heard = false
  splashRadius = 0

  private readonly glow: THREE.Mesh
  private readonly trail: THREE.Line
  private readonly trailPos: Float32Array
  private age = 0

  constructor() {
    this.mesh = new THREE.Group()
    this.mesh.visible = false
    this.mesh.matrixAutoUpdate = true

    this.core = new THREE.Mesh(CORE_GEO, coreMaterial())
    this.core.scale.set(1, 1, 2.2)
    this.mesh.add(this.core)

    this.glow = new THREE.Mesh(GLOW_GEO, glowMaterial())
    this.glow.scale.set(1.1, 1.1, 2.4)
    this.mesh.add(this.glow)

    const len = 8
    this.trailPos = new Float32Array(len * 3)
    const trailGeo = new THREE.BufferGeometry()
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3))
    this.trail = new THREE.Line(trailGeo, trailMaterial())
    this.mesh.add(this.trail)
  }

  activate(position: THREE.Vector3, direction: THREE.Vector3, speed: number, color: number): void {
    this.mesh.position.copy(position)
    this.velocity.copy(direction).normalize().multiplyScalar(speed)
    this.life = 2.5
    this.damage = 18
    this.fromPlayer = true
    this.splashRadius = 0
    this.age = 0
    this.heard = false
    this.alive = true
    this.mesh.visible = true

    const coreMat = this.core.material as THREE.MeshStandardMaterial
    coreMat.color.setHex(color)
    coreMat.emissive.setHex(color)
    const glowMat = this.glow.material as THREE.MeshBasicMaterial
    glowMat.color.setHex(color)
    const trailMat = this.trail.material as THREE.LineBasicMaterial
    trailMat.color.setHex(color)

    const n = this.trailPos.length / 3
    for (let i = 0; i < n; i++) {
      this.trailPos[i * 3] = position.x
      this.trailPos[i * 3 + 1] = position.y
      this.trailPos[i * 3 + 2] = position.z
    }
    ;(this.trail.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }

  retire(): void {
    this.alive = false
    this.mesh.visible = false
  }

  update(dt: number): void {
    if (!this.alive) return
    this.age += dt
    this.mesh.position.addScaledVector(this.velocity, dt)
    this.life -= dt
    if (this.life <= 0) {
      this.retire()
      return
    }

    if (this.velocity.lengthSq() > 1e-6) {
      this.mesh.lookAt(
        this.mesh.position.x + this.velocity.x,
        this.mesh.position.y + this.velocity.y,
        this.mesh.position.z + this.velocity.z,
      )
    }

    const pulse = 0.85 + Math.sin(this.age * 30) * 0.15
    this.glow.scale.set(1.1 * pulse, 1.1 * pulse, 2.4 * pulse)
    ;(this.glow.material as THREE.MeshBasicMaterial).opacity = 0.22 + pulse * 0.18
    this.pushTrail()
  }

  private pushTrail(): void {
    const n = this.trailPos.length / 3
    for (let i = n - 1; i > 0; i--) {
      this.trailPos[i * 3] = this.trailPos[(i - 1) * 3]!
      this.trailPos[i * 3 + 1] = this.trailPos[(i - 1) * 3 + 1]!
      this.trailPos[i * 3 + 2] = this.trailPos[(i - 1) * 3 + 2]!
    }
    this.trailPos[0] = this.mesh.position.x
    this.trailPos[1] = this.mesh.position.y
    this.trailPos[2] = this.mesh.position.z
    ;(this.trail.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }

  dispose(): void {
    ;(this.core.material as THREE.Material).dispose()
    ;(this.glow.material as THREE.Material).dispose()
    this.trail.geometry.dispose()
    ;(this.trail.material as THREE.Material).dispose()
  }
}

export const MAX_PROJECTILES = 40

export type ProjectileSpawnOpts = {
  damage?: number
  fromPlayer?: boolean
  color?: number
  life?: number
  splashRadius?: number
}

export class ProjectileManager {
  readonly projectiles: Projectile[] = []
  private readonly pool: Projectile[] = []
  private readonly root = new THREE.Group()

  constructor(scene: THREE.Scene) {
    this.root.name = 'Projectiles'
    scene.add(this.root)
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const p = new Projectile()
      this.pool.push(p)
      this.root.add(p.mesh)
    }
  }

  spawn(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    opts?: ProjectileSpawnOpts,
  ): Projectile {
    let slot = this.pool.find((p) => !p.alive)
    if (!slot) {
      slot = this.pool[0]!
      for (const p of this.pool) {
        if (p.life < slot.life) slot = p
      }
      slot.retire()
      const idx = this.projectiles.indexOf(slot)
      if (idx >= 0) this.projectiles.splice(idx, 1)
    }

    slot.activate(position, direction, speed, opts?.color ?? 0xc44dff)
    if (opts?.damage != null) slot.damage = opts.damage
    if (opts?.fromPlayer != null) slot.fromPlayer = opts.fromPlayer
    if (opts?.life != null) slot.life = opts.life
    if (opts?.splashRadius != null) slot.splashRadius = opts.splashRadius
    this.projectiles.push(slot)
    return slot
  }

  update(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!
      p.update(dt)
      if (!p.alive || p.mesh.position.y < -5) {
        p.retire()
        this.projectiles.splice(i, 1)
      }
    }
  }

  clear(): void {
    for (const p of this.projectiles) p.retire()
    this.projectiles.length = 0
  }

  dispose(): void {
    this.clear()
    for (const p of this.pool) p.dispose()
    this.pool.length = 0
    CORE_GEO.dispose()
    GLOW_GEO.dispose()
    this.root.removeFromParent()
  }
}

const CORE_GEO = new THREE.SphereGeometry(0.1, 8, 6)
const GLOW_GEO = new THREE.SphereGeometry(0.22, 8, 6)

function coreMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xff66ee,
    emissive: 0xc44dff,
    emissiveIntensity: 1.4,
    metalness: 0,
    roughness: 0.2,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  })
}

function glowMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xc44dff,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    toneMapped: false,
  })
}

function trailMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: 0xc44dff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    toneMapped: false,
  })
}
