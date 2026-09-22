import * as THREE from 'three'
import { forerunnerGold, forerunnerMetal, unscMatte } from '../rendering/Materials'
import type { AudioManager } from '../audio/AudioManager'
import type { ProjectileManager } from './Projectile'
import type { EffectsManager } from '../vfx/EffectsManager'
import type { AABB } from '../world/Environment'
import { raycastAABBs } from '../world/Raycast'

export type WeaponId = 'br' | 'ar' | 'plasma' | 'prifle'

export type WeaponDef = {
  id: WeaponId
  name: string
  magSize: number
  reserve: number
  fireRate: number
  damage: number
  bloomPerShot: number
  bloomDecay: number
  maxBloom: number
  recoil: number
  reloadTime: number
  burst?: number
  burstGap?: number
  hitscan: boolean
  /** One shot per click. */
  semi?: boolean
  /** Hold-to-charge plasma overcharge. */
  chargeable?: boolean
  chargeTime?: number
  projectileSpeed?: number
  adsFov: number
  hipFov: number
  muzzleColor: number
}

const DEFS: Record<WeaponId, WeaponDef> = {
  br: {
    id: 'br',
    name: 'M6D Magnum',
    magSize: 12,
    reserve: 60,
    fireRate: 4.2,
    damage: 22,
    bloomPerShot: 0.004,
    bloomDecay: 6,
    maxBloom: 0.03,
    recoil: 0.02,
    reloadTime: 1.7,
    hitscan: true,
    semi: true,
    adsFov: 48,
    hipFov: 75,
    muzzleColor: 0xffc48a,
  },
  ar: {
    id: 'ar',
    name: 'MA5B Assault Rifle',
    magSize: 60,
    reserve: 240,
    fireRate: 10.5,
    damage: 7.5,
    bloomPerShot: 0.011,
    bloomDecay: 5,
    maxBloom: 0.12,
    recoil: 0.009,
    reloadTime: 2.15,
    hitscan: true,
    adsFov: 58,
    hipFov: 75,
    muzzleColor: 0xffb36a,
  },
  plasma: {
    id: 'plasma',
    name: 'Plasma Pistol',
    magSize: 100,
    reserve: 0,
    fireRate: 4.2,
    damage: 14,
    bloomPerShot: 0.008,
    bloomDecay: 3.5,
    maxBloom: 0.05,
    recoil: 0.008,
    reloadTime: 1.35,
    hitscan: false,
    chargeable: true,
    chargeTime: 1.15,
    projectileSpeed: 52,
    adsFov: 60,
    hipFov: 75,
    muzzleColor: 0x5dffb0,
  },
  prifle: {
    id: 'prifle',
    name: 'Plasma Rifle',
    magSize: 100,
    reserve: 0,
    fireRate: 9,
    damage: 10,
    bloomPerShot: 0.006,
    bloomDecay: 4,
    maxBloom: 0.05,
    recoil: 0.006,
    reloadTime: 1.5,
    hitscan: false,
    projectileSpeed: 72,
    adsFov: 58,
    hipFov: 75,
    muzzleColor: 0x3cff9a,
  },
}

/**
 * Dual-wield-capable weapon manager: BR 3-round burst, AR auto, chargeable plasma.
 * Hitscan + projectile hybrid with bloom, recoil, ADS FOV lerp, muzzle flash,
 * sway/bob, and procedural Halo-ish viewmodels.
 */
export class WeaponSystem {
  current: WeaponId = 'br'
  ads = false
  bloom = 0

  ammo: Record<WeaponId, { mag: number; reserve: number }> = {
    br: { mag: DEFS.br.magSize, reserve: DEFS.br.reserve },
    ar: { mag: DEFS.ar.magSize, reserve: DEFS.ar.reserve },
    plasma: { mag: DEFS.plasma.magSize, reserve: 0 },
    prifle: { mag: DEFS.prifle.magSize, reserve: 0 },
  }

  /** Combat Evolved carries two weapons. Empty slots stay null until a pickup. */
  slots: (WeaponId | null)[] = ['br', null]
  slot = 0

  readonly group = new THREE.Group()

  private fireCooldown = 0
  private reloading = false
  private reloadT = 0
  private burstLeft = 0
  private burstTimer = 0
  private muzzleFlash = 0
  private swayT = 0
  private bobT = 0
  private recoilPitch = 0
  private recoilYaw = 0
  private firing = false
  private adsAmount = 0
  private charging = false
  private charge = 0
  private triggerLatched = false

  private worldColliders: readonly AABB[] = []
  private readonly models: Record<WeaponId, THREE.Group>
  private readonly muzzleLight: THREE.PointLight
  private readonly raycaster = new THREE.Raycaster()
  private readonly aim = new THREE.Vector3()
  private readonly spreadDir = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly worldUp = new THREE.Vector3(0, 1, 0)
  private readonly muzzleLocal = new THREE.Vector3(0.02, 0.02, -0.85)

  private readonly camera: THREE.PerspectiveCamera
  private readonly audio: AudioManager
  private readonly projectiles: ProjectileManager
  private readonly effects: EffectsManager
  private readonly getEnemyMeshes: () => THREE.Object3D[]
  private readonly onHitEnemy: (id: string, damage: number, point: THREE.Vector3, headshot: boolean) => void

  constructor(
    camera: THREE.PerspectiveCamera,
    audio: AudioManager,
    projectiles: ProjectileManager,
    effects: EffectsManager,
    getEnemyMeshes: () => THREE.Object3D[],
    onHitEnemy: (id: string, damage: number, point: THREE.Vector3, headshot: boolean) => void,
  ) {
    this.camera = camera
    this.audio = audio
    this.projectiles = projectiles
    this.effects = effects
    this.getEnemyMeshes = getEnemyMeshes
    this.onHitEnemy = onHitEnemy

    this.models = {
      br: buildMagnum(),
      ar: buildAR(),
      plasma: buildPlasma(),
      prifle: buildPlasmaRifle(),
    }
    for (const m of Object.values(this.models)) {
      m.visible = false
      this.group.add(m)
    }
    this.models.br.visible = true

    this.muzzleLight = new THREE.PointLight(0xffcc88, 0, 8, 2)
    this.muzzleLight.position.copy(this.muzzleLocal)
    this.group.add(this.muzzleLight)

    camera.add(this.group)
    this.group.position.set(0.28, -0.26, -0.45)
    camera.fov = DEFS.br.hipFov
    camera.updateProjectionMatrix()
  }

  get def(): WeaponDef {
    return DEFS[this.current]
  }

  get ammoState(): { mag: number; reserve: number } {
    return this.ammo[this.current]
  }

  get chargeAmount(): number {
    return this.charge
  }

  get isReloading(): boolean {
    return this.reloading
  }

  setWorldColliders(colliders: readonly AABB[]): void {
    this.worldColliders = colliders
  }

  reset(): void {
    this.current = 'br'
    this.slots = ['br', null]
    this.slot = 0
    this.ads = false
    this.bloom = 0
    this.ammo = {
      br: { mag: DEFS.br.magSize, reserve: DEFS.br.reserve },
      ar: { mag: DEFS.ar.magSize, reserve: DEFS.ar.reserve },
      plasma: { mag: DEFS.plasma.magSize, reserve: 0 },
      prifle: { mag: DEFS.prifle.magSize, reserve: 0 },
    }
    this.cancelFireState()
    this.reloading = false
    this.reloadT = 0
    this.muzzleFlash = 0
    this.muzzleLight.intensity = 0
    this.recoilPitch = 0
    this.recoilYaw = 0
    this.adsAmount = 0
    for (const [k, m] of Object.entries(this.models)) m.visible = k === 'br'
    this.camera.fov = DEFS.br.hipFov
    this.camera.updateProjectionMatrix()
    this.group.position.set(0.28, -0.26, -0.45)
    this.group.rotation.set(0, 0, 0)
  }

  switchWeapon(id: WeaponId): void {
    if (!this.slots.includes(id)) return
    if (id === this.current) return
    this.slot = Math.max(0, this.slots.indexOf(id))
    this.cancelFireState()
    this.reloading = false
    this.current = id
    for (const [k, m] of Object.entries(this.models)) m.visible = k === id
    this.audio.weaponSwap()
    this.bloom = Math.min(this.bloom, DEFS[id].maxBloom * 0.25)
  }

  switchSlot(index: number): void {
    const id = this.slots[index]
    if (!id) return
    this.switchWeapon(id)
  }

  /**
   * Pick up a weapon into an empty slot, or replace the one in hand.
   * Returns the id that was dropped, if any.
   */
  acquire(id: WeaponId): WeaponId | null {
    const def = DEFS[id]
    const battery = id === 'plasma' || id === 'prifle'
    if (this.slots.includes(id)) {
      if (battery) this.ammo[id].mag = def.magSize
      else this.ammo[id].reserve = Math.min(def.reserve, this.ammo[id].reserve + def.magSize)
      return null
    }
    const empty = this.slots.findIndex((s) => s === null)
    this.ammo[id].mag = def.magSize
    this.ammo[id].reserve = battery ? 0 : def.reserve
    if (empty >= 0) {
      this.slots[empty] = id
      this.switchWeapon(id)
      return null
    }
    const dropped = this.current
    this.slots[this.slot] = id
    this.cancelFireState()
    this.reloading = false
    this.current = id
    for (const [k, m] of Object.entries(this.models)) m.visible = k === id
    this.audio.weaponSwap()
    return dropped
  }

  resupply(): void {
    for (const id of this.slots) {
      if (!id) continue
      const def = DEFS[id]
      if (id === 'plasma' || id === 'prifle') this.ammo[id].mag = def.magSize
      else this.ammo[id].reserve = Math.min(def.reserve, this.ammo[id].reserve + def.magSize)
    }
  }

  cycleWeapon(dir: 1 | -1): void {
    const owned = this.slots.filter((id): id is WeaponId => id !== null)
    if (owned.length < 2) return
    const i = owned.indexOf(this.current)
    const next = owned[(i + dir + owned.length) % owned.length]!
    this.switchWeapon(next)
  }

  startReload(): void {
    const a = this.ammo[this.current]
    const def = this.def
    if (this.reloading || a.mag >= def.magSize) return
    const battery = this.current === 'plasma' || this.current === 'prifle'
    if (!battery && a.reserve <= 0) return
    this.cancelFireState()
    this.reloading = true
    this.reloadT = def.reloadTime
    this.audio.reload()
  }

  setFiring(down: boolean): void {
    if (down && !this.firing) this.triggerLatched = false
    if (!down) this.releaseCharge()
    this.firing = down

    if (down && this.def.burst && this.fireCooldown <= 0 && !this.reloading && !this.triggerLatched) {
      this.triggerLatched = true
      this.burstLeft = this.def.burst
      this.burstTimer = 0
    }
  }

  setAds(down: boolean): void {
    this.ads = down
  }

  update(dt: number, moving: boolean, grounded: boolean): void {
    const def = this.def
    const clamped = Math.min(dt, 0.05)

    this.fireCooldown = Math.max(0, this.fireCooldown - clamped)
    this.bloom = Math.max(0, this.bloom - def.bloomDecay * clamped * Math.max(this.bloom, 0.002))
    this.muzzleFlash = Math.max(0, this.muzzleFlash - clamped * 16)
    this.muzzleLight.intensity = this.muzzleFlash * 8
    this.recoilPitch = THREE.MathUtils.damp(this.recoilPitch, 0, 10, clamped)
    this.recoilYaw = THREE.MathUtils.damp(this.recoilYaw, 0, 10, clamped)

    const adsTarget = this.ads && !this.reloading ? 1 : 0
    this.adsAmount = THREE.MathUtils.damp(this.adsAmount, adsTarget, 12, clamped)
    const fov = THREE.MathUtils.lerp(def.hipFov, def.adsFov, this.adsAmount)
    if (Math.abs(this.camera.fov - fov) > 0.04) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }

    if (this.reloading) {
      this.reloadT -= clamped
      if (this.reloadT <= 0) this.finishReload()
    } else {
      this.handleFire(clamped, def)
    }

    // Passive plasma heat recovery when not firing/charging.
    if (
      (this.current === 'plasma' || this.current === 'prifle') &&
      !this.firing &&
      !this.charging &&
      !this.reloading
    ) {
      const cell = this.ammo[this.current]
      cell.mag = Math.min(100, cell.mag + (this.current === 'prifle' ? 14 : 22) * clamped)
    }

    this.updateViewModel(clamped, moving, grounded)
  }

  private handleFire(dt: number, def: WeaponDef): void {
    if (def.chargeable) {
      if (this.firing) {
        if (!this.charging) {
          this.charging = true
          this.audio.startPlasmaCharge()
        }
        this.charge = Math.min(1, this.charge + dt / (def.chargeTime ?? 1.3))
        const core = this.models.plasma.getObjectByName('plasmaCore') as THREE.Mesh | undefined
        if (core) {
          const mat = core.material as THREE.MeshStandardMaterial
          mat.emissiveIntensity = 0.6 + this.charge * 2.4
          core.scale.setScalar(1 + this.charge * 0.5)
        }
      }
      return
    }

    if (def.semi) {
      if (this.firing && !this.triggerLatched && this.fireCooldown <= 0) {
        this.triggerLatched = true
        this.fireOnce()
        this.fireCooldown = 1 / def.fireRate
      }
      return
    }

    if (def.burst) {
      if (this.burstLeft > 0) {
        this.burstTimer -= dt
        if (this.burstTimer <= 0) {
          this.fireOnce()
          this.burstLeft--
          this.burstTimer = def.burstGap ?? 0.05
          if (this.burstLeft === 0) this.fireCooldown = 1 / def.fireRate
        }
      }
      return
    }

    if (this.firing && this.fireCooldown <= 0) {
      this.fireOnce()
      this.fireCooldown = 1 / def.fireRate
    }
  }

  private releaseCharge(): void {
    if (!this.def.chargeable) return
    if (!this.charging && this.charge <= 0) return
    this.charging = false
    this.audio.stopCharge()
    const c = this.charge
    this.charge = 0
    const core = this.models.plasma.getObjectByName('plasmaCore') as THREE.Mesh | undefined
    if (core) {
      ;(core.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6
      core.scale.setScalar(1)
    }
    if (this.reloading) return
    this.fireOnce(c)
    this.fireCooldown = 1 / this.def.fireRate
  }

  private finishReload(): void {
    const def = this.def
    const a = this.ammo[this.current]
    this.reloading = false
    if (this.current === 'plasma' || this.current === 'prifle') {
      a.mag = def.magSize
      return
    }
    const need = def.magSize - a.mag
    const take = Math.min(need, a.reserve)
    a.mag += take
    a.reserve -= take
  }

  private cancelFireState(): void {
    this.burstLeft = 0
    this.burstTimer = 0
    this.charging = false
    this.charge = 0
    this.triggerLatched = false
    this.audio.stopCharge()
  }

  private fireOnce(chargeAmt = 0): void {
    const def = this.def
    const a = this.ammo[this.current]
    const cost = def.chargeable ? (chargeAmt > 0.85 ? 38 : chargeAmt > 0.25 ? 12 : 5) : 1
    if (a.mag < cost) {
      this.audio.empty()
      this.startReload()
      return
    }
    a.mag -= cost

    const adsScale = THREE.MathUtils.lerp(1, 0.4, this.adsAmount)
    this.audio.playWeaponFire(this.current === 'prifle' ? 'plasma' : this.current, chargeAmt > 0.85)
    this.muzzleFlash = 1
    this.muzzleLight.color.setHex(def.muzzleColor)
    this.bloom = Math.min(def.maxBloom, this.bloom + def.bloomPerShot * adsScale)
    this.recoilPitch += def.recoil * (0.75 + Math.random() * 0.5) * adsScale
    this.recoilYaw += def.recoil * 0.35 * (Math.random() * 2 - 1) * adsScale
    this.effects.addTrauma(0.035 + (chargeAmt > 0.85 ? 0.1 : 0))

    this.camera.getWorldDirection(this.aim)
    this.applySpread(this.aim, this.bloom * adsScale, this.spreadDir)

    const origin = this.camera.getWorldPosition(new THREE.Vector3())
    const muzzle = this.muzzleLocal.clone().applyMatrix4(this.group.matrixWorld)
    this.effects.spawnMuzzleSparks(muzzle, this.spreadDir, def.muzzleColor)

    if (def.hitscan) {
      this.raycaster.set(origin, this.spreadDir)
      this.raycaster.far = 220
      const hits = this.raycaster.intersectObjects(this.getEnemyMeshes(), true)
      const wallT = raycastAABBs(origin, this.spreadDir, 180, this.worldColliders)
      let end = origin.clone().addScaledVector(this.spreadDir, Math.min(140, wallT))
      let normal = this.spreadDir.clone().multiplyScalar(-1)

      if (hits.length > 0 && hits[0]!.distance <= wallT + 0.05) {
        const h = hits[0]!
        end.copy(h.point)
        if (h.face) normal.copy(h.face.normal).transformDirection(h.object.matrixWorld).normalize()
        const { enemyId, headshot } = resolveEnemyHit(h.object)
        if (enemyId) {
          this.onHitEnemy(enemyId, def.damage * (headshot ? 1.45 : 1), h.point.clone(), headshot)
          this.effects.spawnPlasmaImpact(h.point, normal, 0xffaa55)
        } else {
          this.effects.spawnDecal({ position: end.clone(), normal: normal.clone(), size: 0.1 })
        }
      }

      this.effects.spawnTracer({
        origin: muzzle,
        end,
        color: this.current === 'br' ? 0xffe0a0 : 0xffd080,
        duration: 0.055,
      })
    } else {
      const over = chargeAmt > 0.85
      this.projectiles.spawn(muzzle, this.spreadDir, (def.projectileSpeed ?? 50) * (over ? 1.3 : 1), {
        damage: over ? def.damage * 4.2 : def.damage * (1 + chargeAmt * 1.5),
        fromPlayer: true,
        color: over ? 0x9bff6a : 0x3cff9a,
        life: over ? 3.0 : 2.2,
        splashRadius: over ? 2.2 : 0,
      })
    }
  }

  private applySpread(dir: THREE.Vector3, radians: number, out: THREE.Vector3): void {
    if (radians <= 1e-5) {
      out.copy(dir).normalize()
      return
    }
    const theta = Math.random() * Math.PI * 2
    const phi = Math.sqrt(Math.random()) * radians
    if (Math.abs(dir.y) < 0.99) this.right.crossVectors(dir, this.worldUp).normalize()
    else this.right.set(1, 0, 0)
    this.up.crossVectors(this.right, dir).normalize()
    out
      .copy(dir)
      .addScaledVector(this.right, Math.cos(theta) * Math.sin(phi))
      .addScaledVector(this.up, Math.sin(theta) * Math.sin(phi))
      .normalize()
  }

  private updateViewModel(dt: number, moving: boolean, grounded: boolean): void {
    const sprinting = moving && grounded && this.adsAmount < 0.25
    const bobAmp = sprinting ? 0.018 : moving && grounded ? 0.012 : 0.004
    if (moving && grounded) this.bobT += dt * (sprinting ? 13 : 9)
    else this.bobT += dt * 2
    this.swayT += dt

    const adsMul = 1 - this.adsAmount * 0.85
    const baseX = THREE.MathUtils.lerp(0.28, 0.02, this.adsAmount)
    const baseY = THREE.MathUtils.lerp(-0.26, -0.16, this.adsAmount)
    const baseZ = THREE.MathUtils.lerp(-0.45, -0.34, this.adsAmount)

    let x = baseX + Math.sin(this.swayT * 1.2) * 0.006 * adsMul + Math.cos(this.bobT) * bobAmp * 0.55 * adsMul
    let y =
      baseY +
      Math.cos(this.swayT * 1.05) * 0.005 * adsMul +
      Math.sin(this.bobT * 2) * bobAmp * adsMul -
      this.recoilPitch * 0.35
    let z = baseZ + this.recoilPitch * 0.3

    if (sprinting) {
      y -= 0.035
      z += 0.04
      this.group.rotation.z = THREE.MathUtils.damp(this.group.rotation.z, -0.32, 8, dt)
      this.group.rotation.x = THREE.MathUtils.damp(this.group.rotation.x, 0.22 + this.recoilPitch, 8, dt)
    } else {
      this.group.rotation.z = THREE.MathUtils.damp(this.group.rotation.z, this.recoilYaw * 0.8, 10, dt)
      this.group.rotation.x = THREE.MathUtils.damp(this.group.rotation.x, this.recoilPitch, 10, dt)
    }
    this.group.rotation.y = Math.sin(this.swayT * 0.55) * 0.012 * adsMul + this.recoilYaw * 0.5

    if (this.reloading) {
      const t = 1 - this.reloadT / Math.max(0.01, this.def.reloadTime)
      y -= Math.sin(t * Math.PI) * 0.1
      this.group.rotation.x += Math.sin(t * Math.PI) * 0.3
    }

    this.group.position.set(x, y, z)
  }
}

function resolveEnemyHit(obj: THREE.Object3D): { enemyId?: string; headshot: boolean } {
  let cur: THREE.Object3D | null = obj
  let headshot = Boolean(obj.userData?.isHead) || obj.name === 'head'
  while (cur) {
    if (cur.userData?.enemyId) {
      return { enemyId: cur.userData.enemyId as string, headshot: headshot || Boolean(cur.userData.isHead) }
    }
    if (cur.userData?.isHead) headshot = true
    cur = cur.parent
  }
  return { headshot }
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  return m
}

function buildMagnum(): THREE.Group {
  const g = new THREE.Group()
  const body = unscMatte('#2f3842')
  const dark = unscMatte('#1a2028')
  g.add(mesh(new THREE.BoxGeometry(0.1, 0.13, 0.56), body, 0, 0, -0.12))
  g.add(mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), forerunnerMetal(0.25), 0, 0.02, -0.52))
  g.add(mesh(new THREE.BoxGeometry(0.06, 0.07, 0.16), forerunnerGold(), 0, 0.11, -0.08))
  const ringA = mesh(new THREE.TorusGeometry(0.032, 0.005, 6, 14), forerunnerGold(), 0, 0.13, -0.04)
  g.add(ringA)
  const ringB = mesh(new THREE.TorusGeometry(0.032, 0.005, 6, 14), forerunnerGold(), 0, 0.13, -0.12)
  g.add(ringB)
  g.add(mesh(new THREE.BoxGeometry(0.055, 0.15, 0.09), dark, 0, -0.13, 0.02))
  g.add(mesh(new THREE.BoxGeometry(0.08, 0.1, 0.2), body, 0, -0.01, 0.34))
  g.add(mesh(new THREE.BoxGeometry(0.105, 0.025, 0.12), forerunnerGold(), 0, -0.04, -0.2))
  g.add(mesh(new THREE.BoxGeometry(0.11, 0.06, 0.22), dark, 0, -0.03, -0.28))
  return g
}

function buildAR(): THREE.Group {
  const g = new THREE.Group()
  const body = unscMatte('#3a4550')
  const dark = unscMatte('#242c34')
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.15, 0.5), body))
  const barrel = mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.42, 8), forerunnerMetal(0.2), 0, 0.02, -0.46)
  barrel.rotation.x = Math.PI / 2
  g.add(barrel)
  g.add(mesh(new THREE.BoxGeometry(0.045, 0.08, 0.28), forerunnerGold(), 0, 0.12, -0.02))
  g.add(mesh(new THREE.BoxGeometry(0.07, 0.18, 0.1), dark, 0, -0.14, 0.02))
  const grip = mesh(new THREE.BoxGeometry(0.055, 0.12, 0.07), dark, 0, -0.12, 0.16)
  grip.rotation.x = 0.28
  g.add(grip)
  g.add(mesh(new THREE.BoxGeometry(0.125, 0.025, 0.08), forerunnerGold(), 0, 0.04, 0.18))
  g.add(mesh(new THREE.BoxGeometry(0.09, 0.1, 0.18), body, 0, 0, 0.32))
  const led = mesh(
    new THREE.BoxGeometry(0.035, 0.018, 0.05),
    new THREE.MeshStandardMaterial({
      color: 0x3ee0c5,
      emissive: 0x3ee0c5,
      emissiveIntensity: 1.5,
    }),
    0.045,
    0.1,
    -0.04,
  )
  g.add(led)
  return g
}

function buildPlasmaRifle(): THREE.Group {
  const g = new THREE.Group()
  const shell = forerunnerMetal(0.45)
  const glow = new THREE.MeshStandardMaterial({
    color: 0x39ff9a,
    emissive: 0x1aff80,
    emissiveIntensity: 1.3,
  })
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.16, 0.72), shell, 0, 0.02, -0.05))
  g.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 0.42), glow, 0, 0.08, -0.28))
  const grip = mesh(new THREE.BoxGeometry(0.07, 0.16, 0.08), shell, 0, -0.12, 0.12)
  grip.rotation.x = 0.3
  g.add(grip)
  g.add(mesh(new THREE.BoxGeometry(0.14, 0.08, 0.16), shell, 0, -0.02, 0.28))
  return g
}

function buildPlasma(): THREE.Group {
  const g = new THREE.Group()
  const shell = forerunnerMetal(0.55)
  const accent = forerunnerGold()
  g.add(mesh(new THREE.BoxGeometry(0.14, 0.12, 0.28), shell, 0, 0.02, 0))
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.07, 0.18), shell, 0, 0.09, -0.04))
  const nozzle = mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.12, 6), accent, 0, 0.02, -0.22)
  nozzle.rotation.x = Math.PI / 2
  g.add(nozzle)
  const core = mesh(
    new THREE.SphereGeometry(0.048, 10, 10),
    new THREE.MeshStandardMaterial({
      color: 0x3cff9a,
      emissive: 0x1aff80,
      emissiveIntensity: 1.1,
      metalness: 0.15,
      roughness: 0.25,
    }),
    0,
    0.02,
    -0.1,
  )
  core.name = 'plasmaCore'
  g.add(core)
  for (let i = 0; i < 3; i++) {
    const coil = mesh(
      new THREE.TorusGeometry(0.075 + i * 0.012, 0.007, 6, 16),
      new THREE.MeshStandardMaterial({
        color: 0x5dffb0,
        emissive: 0x3cff9a,
        emissiveIntensity: 0.85 + i * 0.25,
      }),
      0,
      0.02,
      -0.04 - i * 0.045,
    )
    coil.rotation.y = 0.25
    g.add(coil)
  }
  const grip = mesh(new THREE.BoxGeometry(0.06, 0.14, 0.08), shell, 0, -0.11, 0.06)
  grip.rotation.x = 0.35
  g.add(grip)
  g.add(mesh(new THREE.BoxGeometry(0.02, 0.1, 0.16), accent, 0.075, 0.02, 0))
  g.add(mesh(new THREE.BoxGeometry(0.02, 0.1, 0.16), accent, -0.075, 0.02, 0))
  return g
}

export function getWeaponCatalog(): readonly WeaponDef[] {
  return Object.values(DEFS)
}
