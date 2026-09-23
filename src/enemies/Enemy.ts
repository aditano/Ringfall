import * as THREE from 'three'
import { enemyArmor, forerunnerMetal } from '../rendering/Materials'
import type { SpawnPoint } from '../world/Environment'
import type { EffectsManager } from '../vfx/EffectsManager'
import type { ProjectileManager } from '../weapons/Projectile'

/** AI behavioural states for Covenant units. */
export const EnemyState = {
  Idle: 'idle',
  Patrol: 'patrol',
  Alert: 'alert',
  Chase: 'chase',
  Shoot: 'shoot',
  Cover: 'cover',
  HitReact: 'hit_react',
  Dying: 'dying',
  Dead: 'dead',
} as const

export type EnemyStateId = (typeof EnemyState)[keyof typeof EnemyState]

export type EnemyKind = 'grunt' | 'elite' | 'jackal'

export interface EnemyDamageResult {
  shieldDamage: number
  healthDamage: number
  killed: boolean
  wasHeadshot: boolean
}

const _tmpV = new THREE.Vector3()
const _tmpV2 = new THREE.Vector3()
const _tmpQ = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)
const _aimLift = new THREE.Vector3(0, 1.2, 0)

const geoCache = new Map<string, THREE.BufferGeometry>()

function cachedGeo(key: string, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = geoCache.get(key)
  if (!geo) {
    geo = create()
    geoCache.set(key, geo)
  }
  return geo
}

const BoxGeo = THREE.BoxGeometry
const SphereGeo = THREE.SphereGeometry
const ConeGeo = THREE.ConeGeometry
const CircleGeo = THREE.CircleGeometry

function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return cachedGeo(`box:${w}:${h}:${d}`, () => new BoxGeo(w, h, d))
}

function sphere(r: number, wSeg: number, hSeg: number): THREE.BufferGeometry {
  return cachedGeo(`sph:${r}:${wSeg}:${hSeg}`, () => new SphereGeo(r, wSeg, hSeg))
}

function cone(r: number, h: number, seg: number): THREE.BufferGeometry {
  return cachedGeo(`cone:${r}:${h}:${seg}`, () => new ConeGeo(r, h, seg))
}

function circle(r: number, seg: number): THREE.BufferGeometry {
  return cachedGeo(`circ:${r}:${seg}`, () => new CircleGeo(r, seg))
}

function own<T extends THREE.Material>(mat: T): T {
  mat.userData.owned = true
  return mat
}

/** Translucent shield without transmission. Transmission re-renders the whole scene. */
function shieldMaterial(color: number): THREE.MeshStandardMaterial {
  return own(
    new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.45,
      roughness: 0.25,
      metalness: 0.05,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.FrontSide,
    }),
  )
}

/**
 * Procedural Covenant-inspired combatant — angular armor, colored energy shields,
 * personal shields + health, and a lightweight state-machine AI.
 */
export class Enemy {
  readonly id: string
  readonly kind: EnemyKind
  readonly archetype: EnemyKind
  readonly group = new THREE.Group()
  readonly root: THREE.Group
  readonly meshes: THREE.Object3D[] = []

  health: number
  shield: number
  maxHealth: number
  maxShield: number
  state: EnemyStateId = EnemyState.Patrol
  alive = true

  private readonly speed: number
  private readonly turnSpeed: number
  private readonly attackRange: number
  private readonly attackCooldown: number
  private readonly projectileSpeed: number
  private readonly projectileDamage: number
  private readonly headshotMultiplier: number
  private readonly coverChance: number
  private readonly bodyMat: THREE.MeshStandardMaterial
  private readonly accentMat: THREE.MeshStandardMaterial
  private shieldMesh!: THREE.Mesh
  private readonly shieldMat: THREE.MeshStandardMaterial
  /** Far from the player: hidden and not ticked, so leftover encounters don't pile up. */
  simulated = true
  private weaponMuzzle!: THREE.Object3D
  private readonly home: THREE.Vector3
  private readonly patrolPoints: THREE.Vector3[] = []
  private readonly velocity = new THREE.Vector3()
  private readonly coverPoint = new THREE.Vector3()

  private patrolIndex = 0
  private fireCd = 0
  private stateTimer = 0
  private hitReactTimer = 0
  private deathT = 0
  private coverTimer = 0
  private shieldCooldown = 0
  private deathSpin = 0
  private readonly baseScale: number
  groundAt: ((x: number, z: number) => number) | null = null
  pointShield = 0
  private maxPointShield = 0
  private pointShieldMesh: THREE.Mesh | null = null

  constructor(kind: EnemyKind, spawn: SpawnPoint, id: string) {
    this.id = id
    this.kind = kind
    this.archetype = kind
    this.root = this.group
    this.home = spawn.position.clone()
    this.group.position.copy(spawn.position)
    this.group.name = id

    const isElite = kind === 'elite'
    const isJackal = kind === 'jackal'
    this.baseScale = isElite ? 1.12 : isJackal ? 1.02 : 0.78

    if (isElite) {
      this.maxHealth = 100
      this.maxShield = 75
      this.health = this.maxHealth
      this.shield = this.maxShield
      this.speed = 4.3
      this.turnSpeed = 4.4
      this.attackRange = 26
      this.attackCooldown = 0.62
      this.projectileSpeed = 46
      this.projectileDamage = 14
      this.headshotMultiplier = 2.2
      this.coverChance = 0.45
      this.bodyMat = own(enemyArmor('blue'))
      this.accentMat = own(this.bodyMat.clone())
      this.accentMat.color.setHex(0x3ec8ff)
      this.accentMat.emissive = new THREE.Color(0x33ffaa)
      this.accentMat.emissiveIntensity = 0.55
    } else if (isJackal) {
      this.maxHealth = 58
      this.maxShield = 0
      this.health = this.maxHealth
      this.shield = 0
      this.maxPointShield = 70
      this.pointShield = 70
      this.speed = 3.4
      this.turnSpeed = 5
      this.attackRange = 24
      this.attackCooldown = 0.85
      this.projectileSpeed = 44
      this.projectileDamage = 11
      this.headshotMultiplier = 1.8
      this.coverChance = 0.1
      this.bodyMat = own(enemyArmor('red'))
      this.bodyMat.color.setHex(0x8a7048)
      this.bodyMat.emissive.setHex(0x3a2a18)
      this.accentMat = own(enemyArmor('blue'))
      this.accentMat.color.setHex(0x49d6ff)
      this.accentMat.emissive = new THREE.Color(0x49d6ff)
      this.accentMat.emissiveIntensity = 0.8
    } else {
      this.maxHealth = 38
      this.maxShield = 0
      this.health = this.maxHealth
      this.shield = 0
      this.speed = 3.7
      this.turnSpeed = 3.8
      this.attackRange = 18
      this.attackCooldown = 1.05
      this.projectileSpeed = 36
      this.projectileDamage = 8
      this.headshotMultiplier = 2.4
      this.coverChance = 0.2
      this.bodyMat = own(enemyArmor('red'))
      this.bodyMat.color.setHex(0xd4652a)
      this.bodyMat.emissive.setHex(0x5a2208)
      this.accentMat = own(enemyArmor('blue'))
      this.accentMat.color.setHex(0x3ec6ff)
      this.accentMat.emissive = new THREE.Color(0x1a8ec8)
      this.accentMat.emissiveIntensity = 0.7
    }

    this.shieldMat = shieldMaterial(isElite ? 0x33ffaa : 0xffaa44)

    if (isJackal) this.buildJackal()
    else this.buildMesh(isElite)
    if (this.maxShield <= 0) this.shieldMesh.visible = false
    this.seedPatrol(spawn.position)
    if (spawn.yaw !== undefined) {
      this.group.rotation.y = spawn.yaw
    }
  }

  isHeadObject(obj: THREE.Object3D): boolean {
    let cur: THREE.Object3D | null = obj
    while (cur && cur !== this.group) {
      if (cur.userData.isHead) return true
      cur = cur.parent
    }
    return false
  }

  takeDamage(
    amount: number,
    point: THREE.Vector3,
    effects: EffectsManager,
    headshot = false,
  ): boolean {
    return this.applyDamage(amount, point, effects, headshot).killed
  }

  applyDamage(
    amount: number,
    point: THREE.Vector3,
    effects: EffectsManager,
    headshot = false,
  ): EnemyDamageResult {
    if (!this.alive || this.state === EnemyState.Dying || this.state === EnemyState.Dead) {
      return { shieldDamage: 0, healthDamage: 0, killed: false, wasHeadshot: headshot }
    }

    if (this.kind === 'jackal' && this.pointShield > 0) {
      _tmpV.copy(point).sub(this.group.position)
      _tmpV.y = 0
      if (_tmpV.lengthSq() > 1e-6) {
        _tmpV.normalize()
        _tmpV2.set(0, 0, 1).applyQuaternion(this.group.quaternion)
        if (_tmpV.dot(_tmpV2) > 0.05) {
          this.pointShield = Math.max(0, this.pointShield - amount)
          effects.spawnShieldRipple(this.group.position.clone().setY(this.group.position.y + 1.2), 0x66e8ff)
          if (this.pointShield <= 0 && this.pointShieldMesh) this.pointShieldMesh.visible = false
          this.triggerHitReact(point)
          return { shieldDamage: amount, healthDamage: 0, killed: false, wasHeadshot: false }
        }
      }
    }

    if (this.kind === 'grunt') {
      _tmpV.copy(point).sub(this.group.position)
      _tmpV.y = 0
      if (_tmpV.lengthSq() > 1e-4) {
        _tmpV.normalize()
        _tmpV2.set(0, 0, -1).applyQuaternion(this.group.quaternion)
        if (_tmpV.dot(_tmpV2) > 0.5) {
          this.health = 0
          this.beginDeath(effects)
          return { shieldDamage: 0, healthDamage: amount, killed: true, wasHeadshot: false }
        }
      }
    }

    let remaining = amount
    let shieldDamage = 0
    let healthDamage = 0
    const hadShield = this.shield > 0

    if (this.shield > 0) {
      effects.spawnShieldRipple(
        this.group.position.clone().setY(this.group.position.y + 1.1),
        this.kind === 'elite' ? 0x66ffcc : 0xffaa44,
      )
      shieldDamage = Math.min(this.shield, remaining)
      this.shield -= shieldDamage
      remaining -= shieldDamage
      this.shieldCooldown = this.kind === 'elite' ? 1.8 : 2.4
      if (hadShield && this.shield <= 0) {
        this.shieldMat.opacity = 0.7
        this.shieldMat.emissiveIntensity = 2
      }
    }

    if (remaining > 0) {
      const mult = headshot ? this.headshotMultiplier : 1
      healthDamage = remaining * mult
      this.health = Math.max(0, this.health - healthDamage)
      effects.spawnImpact(point, new THREE.Vector3(0, 1, 0), 'bullet')
    }

    this.triggerHitReact(point)

    if (this.health <= 0) {
      this.beginDeath(effects)
      return { shieldDamage, healthDamage, killed: true, wasHeadshot: headshot }
    }

    if (this.state === EnemyState.Idle || this.state === EnemyState.Patrol) {
      this.enterState(EnemyState.Alert)
    }
    return { shieldDamage, healthDamage, killed: false, wasHeadshot: headshot }
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    projectiles: ProjectileManager,
    _canSeePlayer: boolean,
  ): void {
    if (this.state === EnemyState.Dead) return

    this.fireCd = Math.max(0, this.fireCd - dt)
    this.stateTimer += dt
    this.updateShields(dt)
    this.updateShieldVisual()

    if (this.state === EnemyState.Dying) {
      this.updateDeath(dt)
      return
    }

    if (this.state === EnemyState.HitReact) {
      this.hitReactTimer -= dt
      this.group.position.addScaledVector(this.velocity, dt)
      this.velocity.multiplyScalar(0.85)
      if (this.hitReactTimer <= 0) {
        this.enterState(EnemyState.Chase)
        this.bodyMat.emissiveIntensity = 0.12
      }
      return
    }

    const dist = this.group.position.distanceTo(playerPos)

    if (dist < 36) {
      if (this.state === EnemyState.Idle || this.state === EnemyState.Patrol) {
        this.enterState(EnemyState.Alert)
      }
    } else if (dist > 52 && (this.state === EnemyState.Chase || this.state === EnemyState.Shoot)) {
      this.enterState(EnemyState.Patrol)
    }

    switch (this.state) {
      case EnemyState.Idle:
        this.velocity.set(0, 0, 0)
        if (this.stateTimer > 1.4) this.enterState(EnemyState.Patrol)
        break
      case EnemyState.Patrol:
        this.updatePatrol()
        break
      case EnemyState.Alert:
        this.faceToward(playerPos, dt * this.turnSpeed)
        this.velocity.multiplyScalar(0.85)
        if (this.stateTimer > 0.4) this.enterState(EnemyState.Chase)
        break
      case EnemyState.Chase:
        this.updateChase(dt, playerPos, dist)
        break
      case EnemyState.Shoot:
        this.updateShoot(dt, playerPos, dist, projectiles)
        break
      case EnemyState.Cover:
        this.updateCover(dt, playerPos)
        break
      default:
        break
    }

    this.applyLocomotion(dt)
  }

  /** Hide and skip AI when the player has left this fight behind. */
  setSimulated(on: boolean): void {
    if (this.simulated === on) return
    this.simulated = on
    if (!on) {
      this.group.visible = false
      return
    }
    this.group.visible = this.state !== EnemyState.Dead
  }

  dispose(): void {
    const seen = new Set<THREE.Material>()
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) {
        if (!mat.userData.owned || seen.has(mat)) continue
        seen.add(mat)
        mat.dispose()
      }
    })
    this.group.removeFromParent()
  }

  private buildMesh(isElite: boolean): void {
    const scale = this.baseScale
    const tag = (obj: THREE.Object3D, head = false) => {
      obj.userData.enemyId = this.id
      if (head) obj.userData.isHead = true
      this.meshes.push(obj)
    }

    const torsoH = isElite ? 0.95 : 0.7
    const torsoW = isElite ? 0.7 : 0.55
    const torsoD = isElite ? 0.4 : 0.32

    const torso = new THREE.Mesh(box(torsoW, torsoH, torsoD), this.bodyMat)
    torso.name = 'torso'
    torso.position.y = isElite ? 1.15 : 0.95
    torso.castShadow = true
    tag(torso)
    this.group.add(torso)

    const plate = new THREE.Mesh(
      box(torsoW * 1.15, torsoH * 0.45, torsoD * 0.35),
      this.accentMat,
    )
    plate.position.set(0, torso.position.y + 0.12, torsoD * 0.45)
    plate.rotation.x = -0.18
    tag(plate)
    this.group.add(plate)

    for (const side of [-1, 1]) {
      const pauldron = new THREE.Mesh(box(0.28, 0.22, 0.35), this.bodyMat)
      pauldron.position.set(side * (torsoW * 0.55), torso.position.y + torsoH * 0.28, 0)
      pauldron.rotation.z = side * -0.35
      tag(pauldron)
      this.group.add(pauldron)
    }

    const headSize = isElite ? 0.32 : 0.26
    const head = new THREE.Mesh(
      box(headSize, headSize * 1.1, headSize * 1.05),
      forerunnerMetal(0.25),
    )
    head.name = 'head'
    head.position.y = torso.position.y + torsoH * 0.55 + headSize * 0.55
    head.castShadow = true
    tag(head, true)
    this.group.add(head)

    const visor = new THREE.Mesh(
      box(headSize * 0.85, headSize * 0.28, 0.06),
      own(
        new THREE.MeshStandardMaterial({
          color: isElite ? 0x66ffcc : 0xffaa33,
          emissive: isElite ? 0x33ffaa : 0xff8800,
          emissiveIntensity: 1.4,
          roughness: 0.2,
          metalness: 0.3,
        }),
      ),
    )
    visor.position.set(0, head.position.y + 0.02, headSize * 0.52)
    tag(visor, true)
    this.group.add(visor)

    if (isElite) {
      const crest = new THREE.Mesh(cone(0.12, 0.35, 4), this.accentMat)
      crest.position.set(0, head.position.y + 0.28, -0.05)
      crest.rotation.x = 0.4
      tag(crest)
      this.group.add(crest)
      for (const side of [-1, 1] as const) {
        const mandible = new THREE.Mesh(box(0.05, 0.26, 0.07), this.accentMat)
        mandible.position.set(side * 0.14, head.position.y - 0.12, 0.16)
        mandible.rotation.z = side * 0.4
        tag(mandible)
        this.group.add(mandible)
      }
    } else {
      const tank = new THREE.Mesh(sphere(0.22, 8, 6), this.accentMat)
      tank.position.set(0, torso.position.y + 0.05, -0.28)
      tag(tank)
      this.group.add(tank)
      const beak = new THREE.Mesh(cone(0.09, 0.2, 4), this.accentMat)
      beak.rotation.x = Math.PI / 2
      beak.position.set(0, head.position.y - 0.02, 0.22)
      tag(beak, true)
      this.group.add(beak)
    }

    for (const side of [-1, 1]) {
      const upper = new THREE.Mesh(box(0.14, 0.45, 0.14), this.bodyMat)
      upper.position.set(side * (torsoW * 0.62), torso.position.y + 0.05, 0)
      upper.rotation.z = side * 0.15
      tag(upper)
      this.group.add(upper)

      const lower = new THREE.Mesh(box(0.12, 0.4, 0.12), this.bodyMat)
      lower.position.set(side * (torsoW * 0.68), torso.position.y - 0.35, 0.08)
      tag(lower)
      this.group.add(lower)

      const thigh = new THREE.Mesh(box(0.18, 0.45, 0.2), this.bodyMat)
      thigh.position.set(side * 0.16, 0.55, 0)
      tag(thigh)
      this.group.add(thigh)

      const shin = new THREE.Mesh(box(0.16, 0.4, 0.18), this.bodyMat)
      shin.position.set(side * 0.16, 0.2, 0.02)
      tag(shin)
      this.group.add(shin)
    }

    const weapon = new THREE.Group()
    weapon.position.set(torsoW * 0.55, torso.position.y - 0.05, 0.35)
    const receiver = new THREE.Mesh(
      box(0.12, 0.14, 0.45),
      forerunnerMetal(0.8),
    )
    weapon.add(receiver)
    const muzzle = new THREE.Object3D()
    muzzle.name = 'muzzle'
    muzzle.position.set(0, 0, 0.28)
    weapon.add(muzzle)
    this.group.add(weapon)
    this.weaponMuzzle = muzzle

    this.shieldMesh = new THREE.Mesh(
      sphere(isElite ? 1.15 : 0.95, 16, 12),
      this.shieldMat,
    )
    this.shieldMesh.name = 'energyShield'
    this.shieldMesh.position.y = isElite ? 1.05 : 0.9
    this.shieldMesh.scale.set(1, 1.15, 1)
    this.group.add(this.shieldMesh)

    void scale
  }

  private buildJackal(): void {
    const tag = (obj: THREE.Object3D, head = false) => {
      obj.userData.enemyId = this.id
      if (head) obj.userData.isHead = true
      this.meshes.push(obj)
    }
    const torso = new THREE.Mesh(box(0.38, 0.85, 0.28), this.bodyMat)
    torso.position.y = 1.15
    torso.castShadow = true
    tag(torso)
    this.group.add(torso)
    const head = new THREE.Mesh(box(0.22, 0.42, 0.22), this.bodyMat)
    head.position.y = 1.85
    head.castShadow = true
    tag(head, true)
    this.group.add(head)
    const beak = new THREE.Mesh(cone(0.07, 0.22, 4), this.accentMat)
    beak.rotation.x = Math.PI / 2
    beak.position.set(0, 1.78, 0.16)
    tag(beak, true)
    this.group.add(beak)
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(box(0.1, 0.7, 0.1), this.bodyMat)
      leg.position.set(side * 0.12, 0.4, 0)
      tag(leg)
      this.group.add(leg)
    }
    const arm = new THREE.Mesh(box(0.1, 0.5, 0.1), this.bodyMat)
    arm.position.set(0.28, 1.2, 0.15)
    tag(arm)
    this.group.add(arm)
    const shield = new THREE.Mesh(
      circle(0.48, 16),
      own(
        new THREE.MeshStandardMaterial({
          color: 0x9ae9ff,
          emissive: 0x49d6ff,
          emissiveIntensity: 1.1,
          transparent: true,
          opacity: 0.45,
          side: THREE.DoubleSide,
          depthWrite: false,
          forceSinglePass: true,
        }),
      ),
    )
    shield.position.set(0.15, 1.25, 0.42)
    tag(shield)
    this.group.add(shield)
    this.pointShieldMesh = shield

    const weapon = new THREE.Group()
    weapon.position.set(-0.22, 1.15, 0.32)
    weapon.add(new THREE.Mesh(box(0.08, 0.1, 0.4), forerunnerMetal(0.4)))
    const muzzle = new THREE.Object3D()
    muzzle.position.set(0, 0, 0.24)
    weapon.add(muzzle)
    this.group.add(weapon)
    this.weaponMuzzle = muzzle

    this.shieldMesh = new THREE.Mesh(sphere(0.2, 6, 4), this.shieldMat)
    this.shieldMesh.visible = false
    this.group.add(this.shieldMesh)
  }

  private seedPatrol(origin: THREE.Vector3): void {
    const radius = this.kind === 'elite' ? 8 : 5
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.random() * 0.4
      this.patrolPoints.push(
        new THREE.Vector3(origin.x + Math.cos(a) * radius, origin.y, origin.z + Math.sin(a) * radius),
      )
    }
  }

  private enterState(next: EnemyStateId): void {
    this.state = next
    this.stateTimer = 0
    if (next === EnemyState.Cover) {
      this.pickCoverPoint()
      this.coverTimer = 1.2 + Math.random() * 1.4
    }
  }

  private updatePatrol(): void {
    if (this.patrolPoints.length === 0) {
      this.enterState(EnemyState.Idle)
      return
    }
    const target = this.patrolPoints[this.patrolIndex]!
    this.moveToward(target, this.speed * 0.55)
    this.faceToward(target, 0.08)
    if (this.group.position.distanceTo(target) < 0.6) {
      this.patrolIndex = (this.patrolIndex + 1) % this.patrolPoints.length
      if (Math.random() < 0.25) this.enterState(EnemyState.Idle)
    }
  }

  private updateChase(dt: number, playerPos: THREE.Vector3, dist: number): void {
    this.faceToward(playerPos, dt * this.turnSpeed)
    if (dist <= this.attackRange * (this.kind === 'jackal' ? 1 : 0.85)) {
      this.enterState(EnemyState.Shoot)
      return
    }
    this.moveToward(playerPos, this.speed)
    _tmpV.copy(playerPos).sub(this.group.position).setY(0).normalize()
    _tmpV2.set(-_tmpV.z, 0, _tmpV.x).multiplyScalar(Math.sin(this.stateTimer * 2.2) * 1.2)
    this.velocity.add(_tmpV2)
  }

  private updateShoot(
    dt: number,
    playerPos: THREE.Vector3,
    dist: number,
    projectiles: ProjectileManager,
  ): void {
    this.faceToward(playerPos, dt * this.turnSpeed * 1.2)
    this.velocity.multiplyScalar(0.7)
    if (this.kind === 'jackal' && dist < 8) {
      _tmpV.copy(this.group.position).sub(playerPos).setY(0)
      if (_tmpV.lengthSq() > 0.01) {
        _tmpV.normalize().multiplyScalar(this.speed)
        this.velocity.add(_tmpV)
      }
    }

    _tmpV.copy(playerPos).sub(this.group.position).setY(0).normalize()
    _tmpV2.set(-_tmpV.z, 0, _tmpV.x).multiplyScalar(Math.sin(this.stateTimer * 3) * 1.6)
    this.velocity.addScaledVector(_tmpV2, dt * 8)

    if (dist > this.attackRange * 1.15) {
      this.enterState(EnemyState.Chase)
      return
    }

    if (this.fireCd <= 0) {
      this.firePlasma(playerPos, projectiles)
      this.fireCd = this.attackCooldown * (0.85 + Math.random() * 0.3)
      if (Math.random() < this.coverChance && this.health < this.maxHealth * 0.5) {
        this.enterState(EnemyState.Cover)
      }
    }
  }

  private updateCover(dt: number, playerPos: THREE.Vector3): void {
    this.coverTimer -= dt
    this.moveToward(this.coverPoint, this.speed * 1.1)
    this.faceToward(playerPos, dt * this.turnSpeed)
    if (this.group.position.distanceTo(this.coverPoint) < 0.7) this.velocity.multiplyScalar(0.5)
    if (this.coverTimer <= 0) this.enterState(EnemyState.Shoot)
  }

  private pickCoverPoint(): void {
    const away = _tmpV.copy(this.group.position).sub(this.home).setY(0)
    if (away.lengthSq() < 0.01) away.set(Math.random() - 0.5, 0, Math.random() - 0.5)
    away.normalize()
    const lateral = _tmpV2.set(-away.z, 0, away.x).multiplyScalar((Math.random() - 0.5) * 4)
    this.coverPoint
      .copy(this.group.position)
      .addScaledVector(away, 3 + Math.random() * 3)
      .add(lateral)
    this.coverPoint.y = this.home.y
  }

  private firePlasma(playerPos: THREE.Vector3, projectiles: ProjectileManager): void {
    const origin = this.weaponMuzzle.getWorldPosition(_tmpV)
    const dir = _tmpV2.copy(playerPos).add(_aimLift).sub(origin).normalize()
    const spread = this.kind === 'elite' ? 0.02 : 0.045
    dir.x += (Math.random() - 0.5) * spread
    dir.y += (Math.random() - 0.5) * spread * 0.6
    dir.z += (Math.random() - 0.5) * spread
    dir.normalize()

    const color = this.kind === 'elite' ? 0x44ffaa : this.kind === 'jackal' ? 0x66d8ff : 0xc44dff
    projectiles.spawn(origin, dir, this.projectileSpeed, {
      damage: this.projectileDamage,
      fromPlayer: false,
      color,
    })
  }

  private moveToward(target: THREE.Vector3, speed: number): void {
    _tmpV.copy(target).sub(this.group.position)
    _tmpV.y = 0
    const len = _tmpV.length()
    if (len < 0.05) {
      this.velocity.set(0, 0, 0)
      return
    }
    _tmpV.multiplyScalar(speed / len)
    this.velocity.lerp(_tmpV, 0.18)
  }

  private faceToward(target: THREE.Vector3, amount: number): void {
    _tmpV.copy(target).sub(this.group.position)
    _tmpV.y = 0
    if (_tmpV.lengthSq() < 0.0001) return
    _tmpV.normalize()
    const yaw = Math.atan2(_tmpV.x, _tmpV.z)
    _tmpQ.setFromAxisAngle(_up, yaw)
    this.group.quaternion.slerp(_tmpQ, Math.min(1, amount))
  }

  private applyLocomotion(dt: number): void {
    this.group.position.addScaledVector(this.velocity, dt)
    const ground = this.groundAt
      ? this.groundAt(this.group.position.x, this.group.position.z)
      : this.home.y
    if (ground < -4) {
      this.alive = false
      this.state = EnemyState.Dead
      this.group.visible = false
      return
    }
    this.group.position.y = ground
    const speed = this.velocity.length()
    if (speed > 0.2) {
      this.group.position.y = ground + Math.abs(Math.sin(this.stateTimer * 10)) * 0.03
    }
  }

  private updateShields(dt: number): void {
    if (this.shield >= this.maxShield) return
    if (this.shieldCooldown > 0) {
      this.shieldCooldown -= dt
      return
    }
    const rate = this.kind === 'elite' ? 32 : 18
    this.shield = Math.min(this.maxShield, this.shield + rate * dt)
  }

  private updateShieldVisual(): void {
    if (this.pointShieldMesh) {
      const mat = this.pointShieldMesh.material as THREE.MeshStandardMaterial
      this.pointShieldMesh.visible = this.pointShield > 0
      const ratioP = this.maxPointShield > 0 ? this.pointShield / this.maxPointShield : 0
      mat.opacity = 0.18 + ratioP * 0.45
      mat.emissiveIntensity = 0.4 + ratioP * 1.2
    }
    const ratio = this.maxShield > 0 ? this.shield / this.maxShield : 0
    this.shieldMesh.visible = ratio > 0.01
    this.shieldMat.opacity = 0.12 + ratio * 0.28
    this.shieldMat.emissiveIntensity = 0.25 + ratio * 0.55
    const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.03 * ratio
    this.shieldMesh.scale.set(pulse, pulse * 1.15, pulse)
  }

  private triggerHitReact(point: THREE.Vector3): void {
    this.hitReactTimer = 0.18
    this.enterState(EnemyState.HitReact)
    _tmpV.copy(this.group.position).sub(point).setY(0).normalize()
    this.velocity.copy(_tmpV).multiplyScalar(2.5)
    this.bodyMat.emissiveIntensity = 0.8
  }

  private beginDeath(effects: EffectsManager): void {
    this.alive = false
    this.health = 0
    this.shield = 0
    this.shieldMesh.visible = false
    this.enterState(EnemyState.Dying)
    this.deathT = 0
    if (!this.simulated) {
      this.state = EnemyState.Dead
      this.group.visible = false
      return
    }
    this.deathSpin = (Math.random() > 0.5 ? 1 : -1) * (1.8 + Math.random())
    this.velocity.set((Math.random() - 0.5) * 3, 2.5, (Math.random() - 0.5) * 3)
    effects.spawnExplosion(
      this.group.position.clone().add(new THREE.Vector3(0, 1, 0)),
      this.kind === 'elite' ? 0x44ffaa : 0xff6622,
      this.kind === 'elite' ? 1.15 : 0.85,
    )
  }

  private updateDeath(dt: number): void {
    this.deathT += dt
    this.group.position.addScaledVector(this.velocity, dt)
    this.velocity.y -= 14 * dt
    this.velocity.x *= 0.98
    this.velocity.z *= 0.98
    this.group.rotation.x += this.deathSpin * dt
    this.group.rotation.z += this.deathSpin * 0.6 * dt
    const t = Math.min(1, this.deathT / 1.1)
    this.group.scale.setScalar(Math.max(0.01, 1 - t * 0.35))

    if (this.group.position.y < this.home.y - 0.2) {
      this.group.position.y = this.home.y - 0.2
      this.velocity.y *= -0.2
    }

    if (this.deathT > 1.4) {
      this.state = EnemyState.Dead
      this.group.visible = false
    }
  }
}
