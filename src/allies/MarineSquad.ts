import * as THREE from 'three'
import type { AABB } from '../world/Environment'
import type { Enemy } from '../enemies/Enemy'
import type { EnemyManager } from '../enemies/EnemyManager'
import type { EffectsManager } from '../vfx/EffectsManager'
import { createUnscMatte } from '../rendering/Materials'
import { raycastAABBs } from '../world/Raycast'

const OLIVE = createUnscMatte({ color: 0x4d5840 })
const ARMOR = createUnscMatte({ color: 0x2e352c })
const VISOR = new THREE.MeshStandardMaterial({
  color: 0x8fd0c8,
  emissive: 0x14302c,
  emissiveIntensity: 0.4,
  roughness: 0.25,
})

export class Marine {
  readonly group = new THREE.Group()
  health = 85
  alive = true
  seated = false
  following = false
  fireCd = 0
  readonly home = new THREE.Vector3()
  private readonly velocity = new THREE.Vector3()
  private bob = 0

  constructor(index: number, x: number, z: number, y: number) {
    this.home.set(x, y, z)
    this.group.name = `Marine${index}`
    this.group.position.set(x, y, z)
    this.group.rotation.y = -Math.PI / 2
    buildMarine(this.group)
  }

  wound(amount: number): boolean {
    if (!this.alive) return false
    this.health -= amount
    if (this.health <= 0) {
      this.health = 0
      this.alive = false
      this.group.rotation.z = 1.2
      this.group.position.y = this.home.y + 0.25
      return true
    }
    return false
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    playerYaw: number,
    slot: number,
    enemies: EnemyManager,
    colliders: readonly AABB[],
    groundAt: (x: number, z: number) => number,
    effects: EffectsManager,
  ): void {
    if (!this.alive || this.seated) return
    this.fireCd = Math.max(0, this.fireCd - dt)

    const dest = this.velocity
    if (this.following) {
      const back = 2.3 + slot * 0.85
      const side = slot === 0 ? -1.35 : slot === 1 ? 1.35 : 0
      dest.set(
        playerPos.x + Math.sin(playerYaw) * back + Math.cos(playerYaw) * side,
        0,
        playerPos.z + Math.cos(playerYaw) * back - Math.sin(playerYaw) * side,
      )
    } else {
      dest.copy(this.home)
    }

    const dx = dest.x - this.group.position.x
    const dz = dest.z - this.group.position.z
    const dist = Math.hypot(dx, dz)
    if (dist > 1.6) {
      const step = Math.min(dist, 6.4 * dt)
      this.group.position.x += (dx / dist) * step
      this.group.position.z += (dz / dist) * step
      this.group.rotation.y = Math.atan2(dx, dz)
      this.bob += dt * 8
    }

    const y = groundAt(this.group.position.x, this.group.position.z)
    this.group.position.y = y + Math.abs(Math.sin(this.bob)) * 0.04
    if (y < -3) {
      this.alive = false
      this.group.visible = false
      return
    }

    const target = nearestEnemy(this.group.position, enemies, 30)
    if (!target) return
    const aim = _aim.copy(target.group.position)
    aim.y += 1.1
    const origin = _origin.copy(this.group.position)
    origin.y += 1.35
    const delta = _delta.copy(aim).sub(origin)
    const range = delta.length()
    if (range < 0.5) return
    delta.multiplyScalar(1 / range)
    this.group.rotation.y = Math.atan2(delta.x, delta.z)
    const wall = raycastAABBs(origin, delta, range, colliders)
    if (wall < range - 0.5) return
    if (this.fireCd > 0) return
    this.fireCd = 0.38 + Math.random() * 0.2
    const end = origin.clone().addScaledVector(delta, range)
    effects.spawnTracer({ origin: origin.clone(), end, color: 0xffd090, duration: 0.05 })
    enemies.damageEnemy(target.id, 9, aim, false)
  }
}

export class MarineSquad {
  readonly marines: Marine[] = []

  constructor(parent: THREE.Object3D, posts: { x: number; z: number }[], groundAt: (x: number, z: number) => number) {
    posts.forEach((p, i) => {
      const marine = new Marine(i, p.x, p.z, groundAt(p.x, p.z))
      this.marines.push(marine)
      parent.add(marine.group)
    })
  }

  setFollowing(on: boolean): void {
    for (const m of this.marines) if (m.alive) m.following = on
  }

  living(): Marine[] {
    return this.marines.filter((m) => m.alive)
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    playerYaw: number,
    enemies: EnemyManager,
    colliders: readonly AABB[],
    groundAt: (x: number, z: number) => number,
    effects: EffectsManager,
  ): void {
    let slot = 0
    for (const m of this.marines) {
      m.update(dt, playerPos, playerYaw, slot, enemies, colliders, groundAt, effects)
      if (m.alive && !m.seated) slot++
    }
  }

  reset(posts: { x: number; z: number }[], groundAt: (x: number, z: number) => number, parent: THREE.Object3D): void {
    for (const m of this.marines) {
      parent.attach(m.group)
      m.alive = true
      m.health = 85
      m.seated = false
      m.following = false
      m.fireCd = 0
      m.group.visible = true
      m.group.rotation.set(0, -Math.PI / 2, 0)
    }
    this.marines.forEach((m, i) => {
      const p = posts[i]
      if (!p) return
      const y = groundAt(p.x, p.z)
      m.home.set(p.x, y, p.z)
      m.group.position.set(p.x, y, p.z)
    })
  }
}

const _aim = new THREE.Vector3()
const _origin = new THREE.Vector3()
const _delta = new THREE.Vector3()

function nearestEnemy(from: THREE.Vector3, enemies: EnemyManager, maxDist: number): Enemy | null {
  let best: Enemy | null = null
  let bestD = maxDist
  for (const e of enemies.enemies) {
    if (!e.alive) continue
    const d = e.group.position.distanceTo(from)
    if (d < bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

function buildMarine(group: THREE.Group): void {
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.28), OLIVE)
  torso.position.y = 1.15
  torso.castShadow = true
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), ARMOR)
  head.position.y = 1.62
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.06), VISOR)
  visor.position.set(0, 1.64, 0.14)
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.16), ARMOR)
  pack.position.set(0, 1.2, -0.2)
  group.add(torso, head, visor, pack)
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.12), OLIVE)
    arm.position.set(side * 0.34, 1.1, 0.05)
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.16), OLIVE)
    leg.position.set(side * 0.14, 0.4, 0)
    group.add(arm, leg)
  }
  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.7), ARMOR)
  rifle.position.set(0.28, 1.05, 0.35)
  group.add(rifle)
}
