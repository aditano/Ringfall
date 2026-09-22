import * as THREE from 'three'
import type { AudioManager } from '../audio/AudioManager'
import type { Marine } from '../allies/MarineSquad'
import { MarineSquad } from '../allies/MarineSquad'
import type { DamageSystem } from '../combat/DamageSystem'
import type { EnemyManager } from '../enemies/EnemyManager'
import type { PlayerController } from '../player/PlayerController'
import type { EffectsManager } from '../vfx/EffectsManager'
import type { ProjectileManager } from '../weapons/Projectile'
import type { WeaponId, WeaponSystem } from '../weapons/WeaponSystem'
import { Warthog } from '../vehicles/Warthog'
import { haloHeight, type HaloWorld, type WorldPickup } from '../world/HaloMissionWorld'
import { raycastAABBs } from '../world/Raycast'
import {
  CAVE_MOUTH,
  CHECKPOINTS,
  ENCOUNTERS,
  HOG_SPAWN,
  MARINE_POSTS,
  PELICAN_PAD,
  type EncounterDef,
} from './layout'
import { createUnscMatte } from '../rendering/Materials'

const WEAPON_LABEL: Record<WeaponId, string> = {
  br: 'M6D Magnum',
  ar: 'MA5B Assault Rifle',
  plasma: 'Plasma Pistol',
  prifle: 'Plasma Rifle',
}

interface RuntimeEncounter {
  def: EncounterDef
  spawned: boolean
  cleared: boolean
  ids: string[]
}

interface Grenade {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  fuse: number
}

export interface HaloCampaignOptions {
  world: HaloWorld
  player: PlayerController
  camera: THREE.PerspectiveCamera
  enemies: EnemyManager
  weapons: WeaponSystem
  damage: DamageSystem
  effects: EffectsManager
  audio: AudioManager
  projectiles: ProjectileManager
  setObjective: (text: string) => void
  setSubtitle: (speaker: string, text: string) => void
  clearSubtitle: () => void
  setPrompt: (text: string | null) => void
  setGrenades: (n: number) => void
  setFade: (opacity: number) => void
  setHint: (text: string | null) => void
  showBanner: (text: string) => void
}

/**
 * Mission 02 — Halo.
 * Lifeboat, valley contact, marine rally, Warthog run, Forerunner cave, Foehammer extraction.
 */
export class HaloCampaign {
  driving = false
  gunning = false
  finished = false
  sinceFinish = 0

  private readonly world: HaloWorld
  private readonly player: PlayerController
  private readonly camera: THREE.PerspectiveCamera
  private readonly enemies: EnemyManager
  private readonly weapons: WeaponSystem
  private readonly damage: DamageSystem
  private readonly effects: EffectsManager
  private readonly audio: AudioManager
  private readonly projectiles: ProjectileManager
  private readonly ui: HaloCampaignOptions
  private readonly hog: Warthog
  private readonly squad: MarineSquad
  private readonly encounters: RuntimeEncounter[]
  private readonly lines: { speaker: string; text: string; time: number }[] = []
  private readonly grenades: Grenade[] = []
  private readonly ramCd = new Map<string, number>()
  private readonly said = new Set<string>()
  private readonly v = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly v3 = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()
  private readonly doorHome: { minY: number; maxY: number }[]
  private readonly waypoint = new THREE.Vector3()

  private checkpointIndex = 0
  private lineT = 0
  private showingLine = false
  private grenadeCount = 2
  private hogUnlocked = false
  private door = 0
  private shadeHp = 240
  private shadeAlive = true
  private shadeCd = 0.6
  private chainCd = 0
  private triggerDown = false
  private landing = false
  private landed = false
  private fade = 1
  private age = 0
  private hasWaypoint = false
  private prompt: string | null = null
  private objective = ''
  private readonly fragMat = new THREE.MeshStandardMaterial({ color: 0x556043, roughness: 0.6 })

  constructor(opts: HaloCampaignOptions) {
    this.world = opts.world
    this.player = opts.player
    this.camera = opts.camera
    this.enemies = opts.enemies
    this.weapons = opts.weapons
    this.damage = opts.damage
    this.effects = opts.effects
    this.audio = opts.audio
    this.projectiles = opts.projectiles
    this.ui = opts
    this.enemies.groundAt = haloHeight
    this.hog = new Warthog(opts.world.root, opts.world.hogSpawn.position, opts.world.hogSpawn.yaw)
    this.squad = new MarineSquad(opts.world.root, MARINE_POSTS, haloHeight)
    this.encounters = ENCOUNTERS.map((def) => ({ def, spawned: false, cleared: false, ids: [] }))
    this.doorHome = opts.world.doorColliders.map((b) => ({ minY: b.min.y, maxY: b.max.y }))
  }

  get blocksWeapons(): boolean {
    return (this.driving && !this.gunning) || this.finished
  }

  get showReticle(): boolean {
    return !this.finished && (!this.driving || this.gunning)
  }

  marines(): Marine[] {
    return this.squad.marines
  }

  extraMeshes(): THREE.Object3D[] {
    return this.shadeAlive ? this.world.shadeMeshes : []
  }

  damageProp(id: string, amount: number): boolean {
    if (id !== 'shade-alpha' || !this.shadeAlive) return false
    this.shadeHp -= amount
    this.effects.spawnImpact(this.world.shade.position.clone().setY(this.world.shade.position.y + 1.4), this.v.set(0, 1, 0), 'bullet')
    if (this.shadeHp <= 0) this.killShade()
    return true
  }

  ridePosition(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.driving) return null
    return this.gunning ? this.hog.gunnerEye(out) : this.hog.seatWorld(out)
  }

  radarBlips(
    playerPos: THREE.Vector3,
    forward: THREE.Vector3,
    right: THREE.Vector3,
  ): { x: number; y: number; friendly?: boolean }[] {
    const out: { x: number; y: number; friendly?: boolean }[] = []
    const range = 52
    const add = (x: number, z: number, friendly?: boolean) => {
      const dx = x - playerPos.x
      const dz = z - playerPos.z
      const dist = Math.hypot(dx, dz)
      if (dist < 0.8 || dist > range) return
      const scale = dist / range
      const nx = dx / dist
      const nz = dz / dist
      out.push({
        x: (nx * right.x + nz * right.z) * scale,
        y: (nx * forward.x + nz * forward.z) * scale,
        friendly,
      })
    }
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue
      add(e.group.position.x, e.group.position.z)
    }
    for (const m of this.squad.marines) {
      if (!m.alive || m.seated) continue
      add(m.group.position.x, m.group.position.z, true)
    }
    if (!this.driving) add(this.hog.group.position.x, this.hog.group.position.z, true)
    if (this.shadeAlive) add(this.world.shade.position.x, this.world.shade.position.z)
    return out
  }

  waypointAngle(playerPos: THREE.Vector3, forward: THREE.Vector3, right: THREE.Vector3): number | null {
    if (!this.hasWaypoint || this.finished) return null
    this.v.copy(this.waypoint).sub(playerPos)
    this.v.y = 0
    if (this.v.lengthSq() < 36) return null
    return Math.atan2(this.v.dot(right), this.v.dot(forward))
  }

  begin(): void {
    this.finished = false
    this.sinceFinish = 0
    this.driving = false
    this.gunning = false
    this.checkpointIndex = 0
    this.grenadeCount = 2
    this.hogUnlocked = false
    this.door = 0
    this.shadeHp = 240
    this.shadeAlive = true
    this.shadeCd = 0.8
    this.landing = false
    this.landed = false
    this.fade = 1
    this.age = 0
    this.lines.length = 0
    this.lineT = 0
    this.showingLine = false
    this.said.clear()
    this.ramCd.clear()
    this.clearGrenades()
    this.world.shade.visible = true
    this.world.pelican.position.y = haloHeight(PELICAN_PAD.x, PELICAN_PAD.z) + 26
    this.world.pelicanRamp.rotation.x = -0.15
    this.world.doorL.position.z = 2.4
    this.world.doorR.position.z = -2.4
    this.restoreDoorColliders()
    for (const p of this.world.pickups) {
      if (p.def.id.startsWith('drop-')) {
        p.mesh.removeFromParent()
      } else {
        p.taken = false
        p.cooldown = 0
        p.mesh.visible = true
      }
    }
    this.world.pickups.splice(
      0,
      this.world.pickups.length,
      ...this.world.pickups.filter((p) => !p.def.id.startsWith('drop-')),
    )
    for (const enc of this.encounters) {
      enc.spawned = false
      enc.cleared = false
      enc.ids.length = 0
    }
    this.enemies.reset()
    this.enemies.groundAt = haloHeight
    this.hog.teleport(HOG_SPAWN.x, HOG_SPAWN.z, HOG_SPAWN.yaw)
    this.squad.reset(MARINE_POSTS, haloHeight, this.world.root)
    this.ui.setGrenades(this.grenadeCount)
    this.ui.setFade(1)
    this.ui.setHint('WASD move · Mouse aim · LMB fire · E use · G grenade · F turret')
    this.setObjective('Exit the lifeboat', 18, 0)
    this.say('Cortana', 'Chief.', 1.6)
    this.say('Cortana', 'Can you hear me?', 2.2)
    this.say('Cortana', 'You have no idea how glad I am to see you. I thought you were dead for sure.', 4.2)
    this.say('Cortana', 'The Autumn survived the impact. She is down, but we made it.', 3.8)
    this.say('Cortana', 'We need to find other survivors and regroup.', 3.4)
    this.ui.showBanner('HALO')
  }

  respawn(): void {
    const cp = CHECKPOINTS[this.checkpointIndex] ?? CHECKPOINTS[0]!
    this.driving = false
    this.gunning = false
    this.triggerDown = false
    const y = haloHeight(cp.x, cp.z) + 1.7
    this.player.resetTo(new THREE.Vector3(cp.x, y, cp.z), cp.yaw)
    if (this.hogUnlocked) this.hog.teleport(cp.x - 7, cp.z + 3.4, HOG_SPAWN.yaw)
    this.unseat(false)
    for (const enc of this.encounters) {
      if (enc.spawned && !enc.cleared) {
        this.despawn(enc)
        enc.spawned = false
      }
    }
    this.clearGrenades()
    this.ui.showBanner('CHECKPOINT')
  }

  interact(): void {
    if (this.finished || !this.damage.alive) return
    if (this.driving) {
      this.exitHog()
      return
    }
    if (this.tryBoard()) return
    if (this.tryPickup()) return
    if (this.nearHog()) this.enterHog()
  }

  toggleGun(): void {
    if (!this.driving || this.finished) return
    this.gunning = !this.gunning
    this.audio.weaponSwap()
  }

  setTrigger(down: boolean): void {
    this.triggerDown = down
  }

  throwGrenade(origin: THREE.Vector3, dir: THREE.Vector3): void {
    if (this.finished || this.driving || this.grenadeCount <= 0 || !this.damage.alive) return
    this.grenadeCount -= 1
    this.ui.setGrenades(this.grenadeCount)
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), this.fragMat)
    mesh.position.copy(origin)
    this.world.root.add(mesh)
    const vel = dir.clone().multiplyScalar(15)
    vel.y += 5
    this.grenades.push({ mesh, vel, fuse: 1.65 })
    this.audio.ui()
  }

  update(dt: number, look: THREE.Vector3): void {
    if (!this.damage.alive) return
    this.age += dt
    this.fade = Math.max(0, this.fade - dt * 0.4)
    if (this.finished) {
      this.sinceFinish += dt
      const out = THREE.MathUtils.smoothstep(this.sinceFinish, 3.2, 6.2)
      this.ui.setFade(out)
    } else {
      this.ui.setFade(this.fade)
    }
    if (this.age > 16) this.ui.setHint(null)

    this.world.update(dt)
    this.updateDialogue(dt)
    this.updateDoors(dt)
    this.updateShade(dt)
    this.updatePelican(dt)
    this.updateGrenades(dt)
    this.tickRam(dt)

    for (const p of this.world.pickups) {
      if (p.cooldown > 0) p.cooldown = Math.max(0, p.cooldown - dt)
    }

    if (this.driving && !this.finished) {
      this.hog.update(dt, this.player.keys, this.world.colliders, null)
      this.updateTurret(dt, look)
      this.ram()
      const fallY = this.hog.group.position.y
      if (fallY < -1.2) {
        this.damage.applyDamage(400, this.hog.group.position)
        return
      }
    }

    this.audio.setEngine(this.driving ? Math.min(1, Math.abs(this.hog.drive) / 16) : 0)

    const px = this.player.position.x
    if (!this.finished) {
      if (this.player.position.y < -1.2) {
        this.damage.applyDamage(400, this.player.position)
        return
      }
      this.updateEncounters(px)
      this.updateScript(px)
      this.updateCheckpoints(px)
      this.squad.update(
        dt,
        this.player.position,
        this.camera.rotation.y,
        this.enemies,
        this.world.colliders,
        haloHeight,
        this.effects,
      )
    }

    this.prompt = this.computePrompt()
    this.ui.setPrompt(this.prompt)
  }

  private updateTurret(dt: number, look: THREE.Vector3): void {
    this.chainCd = Math.max(0, this.chainCd - dt)
    if (this.gunning) {
      this.v.copy(this.camera.position).addScaledVector(look, 40)
      this.hog.aimTurretAt(this.v, dt)
      if (this.triggerDown) this.fireChain()
      return
    }
    const target = this.nearestEnemy(this.hog.group.position, 46)
    if (!target || this.squad.living().length === 0) return
    this.v.copy(target.group.position)
    this.v.y += 1.1
    this.hog.aimTurretAt(this.v, dt)
    this.hog.forwardWorld(this.v2)
    const to = this.v2.copy(target.group.position).sub(this.hog.group.position)
    to.y = 0
    to.normalize()
    this.hog.forwardWorld(this.v2)
    if (this.v2.dot(to) > 0.45) this.fireChain()
  }

  private fireChain(): void {
    if (this.chainCd > 0) return
    this.chainCd = 0.075
    const origin = this.hog.gunWorld(this.v3)
    this.v2.set(0, 0, 1).applyQuaternion(this.hog.muzzle.getWorldQuaternion(this.q)).normalize()
    this.v2.x += (Math.random() - 0.5) * 0.035
    this.v2.y += (Math.random() - 0.5) * 0.02
    this.v2.z += (Math.random() - 0.5) * 0.035
    this.v2.normalize()
    this.audio.chainGun()
    this.effects.spawnMuzzleSparks(origin.clone(), this.v2, 0xffc56a)
    const wall = raycastAABBs(origin, this.v2, 110, this.world.colliders)
    let bestT = wall
    let bestId: string | null = null
    const bestPoint = this.v.set(0, 0, 0)
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue
      const center = e.group.position
      const relX = center.x - origin.x
      const relY = center.y + 1 - origin.y
      const relZ = center.z - origin.z
      const t = relX * this.v2.x + relY * this.v2.y + relZ * this.v2.z
      if (t < 0 || t > bestT) continue
      const cx = origin.x + this.v2.x * t
      const cy = origin.y + this.v2.y * t
      const cz = origin.z + this.v2.z * t
      const d = Math.hypot(cx - center.x, cy - (center.y + 1), cz - center.z)
      if (d < 0.95) {
        bestT = t
        bestId = e.id
        bestPoint.set(cx, cy, cz)
      }
    }
    const shadeT = this.shadeRay(origin, this.v2, bestT)
    if (shadeT < bestT) {
      bestId = 'shade-alpha'
      bestT = shadeT
      bestPoint.copy(origin).addScaledVector(this.v2, shadeT)
    }
    const end = origin.clone().addScaledVector(this.v2, Math.min(bestT, 90))
    this.effects.spawnTracer({ origin: origin.clone(), end, color: 0xffe0a0, duration: 0.04 })
    if (bestId === 'shade-alpha') this.damageProp('shade-alpha', 12)
    else if (bestId) this.enemies.damageEnemy(bestId, 12, bestPoint, false)
    else this.effects.spawnImpact(end, this.v2.clone().multiplyScalar(-1), 'bullet')
  }

  private shadeRay(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): number {
    if (!this.shadeAlive) return maxT
    const center = this.world.shade.position
    const relX = center.x - origin.x
    const relY = center.y + 1.2 - origin.y
    const relZ = center.z - origin.z
    const t = relX * dir.x + relY * dir.y + relZ * dir.z
    if (t < 0 || t > maxT) return maxT
    const d = Math.hypot(
      origin.x + dir.x * t - center.x,
      origin.y + dir.y * t - (center.y + 1.2),
      origin.z + dir.z * t - center.z,
    )
    return d < 1.3 ? t : maxT
  }

  private ram(): void {
    if (Math.abs(this.hog.drive) < 8) return
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue
      const wait = this.ramCd.get(e.id) ?? 0
      if (wait > 0) continue
      if (e.group.position.distanceTo(this.hog.group.position) > 2.35) continue
      this.ramCd.set(e.id, 0.4)
      this.enemies.damageEnemy(e.id, 85, e.group.position, false)
      this.effects.spawnExplosion(e.group.position.clone().setY(e.group.position.y + 0.6), 0xffaa66, 0.45)
    }
  }

  private tickRam(dt: number): void {
    for (const [id, t] of this.ramCd) {
      const next = t - dt
      if (next <= 0) this.ramCd.delete(id)
      else this.ramCd.set(id, next)
    }
  }

  private updateEncounters(px: number): void {
    for (const enc of this.encounters) {
      if (!enc.spawned && !enc.cleared && Math.abs(px - enc.def.anchorX) < enc.def.radius) {
        this.spawn(enc)
        this.onSpawned(enc.def.id)
      }
      if (enc.spawned && !enc.cleared) {
        const alive = enc.ids.some((id) => this.enemies.enemies.some((e) => e.id === id && e.alive))
        if (!alive) {
          enc.cleared = true
          this.onCleared(enc.def.id)
        }
      }
    }
  }

  private spawn(enc: RuntimeEncounter): void {
    enc.spawned = true
    enc.ids.length = 0
    for (const u of enc.def.units) {
      const y = haloHeight(u.x, u.z)
      const enemy = this.enemies.spawnEnemy(u.kind, {
        position: new THREE.Vector3(u.x, y, u.z),
        yaw: u.yaw,
      })
      enc.ids.push(enemy.id)
    }
  }

  private despawn(enc: RuntimeEncounter): void {
    this.enemies.purgeIds(enc.ids)
    enc.ids.length = 0
  }

  private onSpawned(id: string): void {
    if (id === 'contact') this.say('Cortana', 'Covenant. They are already on the ring.', 3)
    if (id === 'marines') this.say('Marine', 'Over here! We have got contacts on the rise!', 3)
    if (id === 'lz') {
      this.setObjective('Neutralize the landing zone', PELICAN_PAD.x, PELICAN_PAD.z)
      this.say('Foehammer', 'Chief, that pad is crawling. Clear it and I will set down.', 3.6)
    }
  }

  private onCleared(id: string): void {
    if (id === 'contact') {
      this.say('Cortana', 'That will not be the last of them. I am reading friendlies ahead.', 3.4)
      this.setObjective('Find the marine squad', 96, 0)
    }
    if (id === 'marines') {
      this.squad.setFollowing(true)
      this.say('Marine', 'Sir. Am I glad to see a Spartan.', 2.8)
      this.say('Cortana', 'There is a Warthog further down the valley. Take it.', 3.4)
      this.setObjective('Reach the Warthog', HOG_SPAWN.x, HOG_SPAWN.z)
    }
    if (id === 'cave-exit') this.say('Cortana', 'The far side of the installation is opening up.', 3)
    if (id === 'lz') {
      this.landing = true
      this.say('Foehammer', 'Echo 419 to Master Chief. Pelican is on the pad. Get aboard.', 3.8)
      this.setObjective('Board the Pelican', PELICAN_PAD.x + 6, 0)
    }
  }

  private updateScript(px: number): void {
    if (px > 16) this.once('leave', () => {
      this.setObjective('Find other survivors', 44, 1)
      this.say('Cortana', 'I am picking up weapons fire ahead. Some of it is human.', 3.4)
    })
    if (px > 170) this.once('see-hog', () => {
      this.hogUnlocked = true
      this.say('Cortana', 'Warthog. That will cover ground a lot faster than we will.', 3.2)
      this.setObjective('Reach the Warthog', HOG_SPAWN.x, HOG_SPAWN.z)
    })
    if (px > 230 && this.driving) this.once('open-ring', () => {
      this.say('Cortana', 'The ring just keeps going. This is not a natural satellite.', 3.6)
    })
    if (px > 430) this.once('cave-line', () => {
      this.say('Cortana', 'This cave is not a natural formation.', 2.8)
      this.say('Cortana', 'Someone built it. So it must lead somewhere.', 3.4)
      this.setObjective('Investigate the structure', CAVE_MOUTH.x + 8, 0)
    })
    if (px > 510) this.once('forerunner', () => {
      this.say('Cortana', 'Forerunner. Nothing in our records is this old.', 3.2)
      this.setObjective('Push through the installation', 600, 0)
    })
    if (px > 632) this.once('extract', () => {
      this.say('Foehammer', 'Echo 419 to Master Chief. I have your beacon. Inbound for extraction.', 4)
      this.setObjective('Reach the extraction point', 690, 0)
    })
  }

  private updateCheckpoints(px: number): void {
    for (let i = this.checkpointIndex + 1; i < CHECKPOINTS.length; i++) {
      const cp = CHECKPOINTS[i]!
      if (px < cp.at) break
      if (cp.requires && !this.encounters.find((e) => e.def.id === cp.requires)?.cleared) continue
      this.checkpointIndex = i
    }
  }

  private updateDoors(dt: number): void {
    const want = this.player.position.x > 448 ? 1 : 0
    this.door = THREE.MathUtils.damp(this.door, want, 2.2, dt)
    this.world.doorL.position.z = 2.4 + this.door * 3.8
    this.world.doorR.position.z = -2.4 - this.door * 3.8
    const open = this.door > 0.72
    this.world.doorColliders.forEach((box, i) => {
      const home = this.doorHome[i]
      if (!home) return
      box.min.y = open ? 60 : home.minY
      box.max.y = open ? 61 : home.maxY
    })
  }

  private restoreDoorColliders(): void {
    this.world.doorColliders.forEach((box, i) => {
      const home = this.doorHome[i]
      if (!home) return
      box.min.y = home.minY
      box.max.y = home.maxY
    })
  }

  private updateShade(dt: number): void {
    if (!this.shadeAlive || this.finished) return
    this.shadeCd = Math.max(0, this.shadeCd - dt)
    const target = this.driving ? this.hog.group.position : this.player.position
    const dist = this.world.shade.position.distanceTo(target)
    if (dist > 52 || dist < 5) return
    const aimX = target.x - this.world.shade.position.x
    const aimZ = target.z - this.world.shade.position.z
    this.world.shade.rotation.y = Math.atan2(aimX, aimZ)
    if (this.shadeCd > 0) return
    const origin = this.world.shadeMuzzle.getWorldPosition(this.v)
    this.v2.set(target.x, target.y + 1.1, target.z).sub(origin).normalize()
    const dir = this.v2
    const wall = raycastAABBs(origin, dir, dist, this.world.colliders)
    if (wall < dist - 1) return
    this.shadeCd = 0.55
    this.projectiles.spawn(origin.clone(), dir, 42, { damage: 12, fromPlayer: false, color: 0x66ffb0 })
  }

  private updatePelican(dt: number): void {
    const padY = haloHeight(PELICAN_PAD.x, PELICAN_PAD.z) + 3.15
    if (!this.landing) return
    const y = this.world.pelican.position.y
    this.world.pelican.position.y = THREE.MathUtils.damp(y, padY, 1.35, dt)
    if (Math.abs(this.world.pelican.position.y - padY) < 0.35) {
      this.landed = true
      this.world.pelicanRamp.rotation.x = THREE.MathUtils.damp(this.world.pelicanRamp.rotation.x, -1.12, 2.4, dt)
    }
  }

  private updateGrenades(dt: number): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i]!
      g.fuse -= dt
      g.vel.y -= 16 * dt
      g.mesh.position.addScaledVector(g.vel, dt)
      const ground = haloHeight(g.mesh.position.x, g.mesh.position.z) + 0.16
      if (g.mesh.position.y < ground) {
        g.mesh.position.y = ground
        g.vel.y *= -0.32
        g.vel.x *= 0.7
        g.vel.z *= 0.7
      }
      if (this.world.solidAt(g.mesh.position)) {
        g.vel.multiplyScalar(-0.4)
      }
      if (g.fuse <= 0) {
        this.explode(g.mesh.position)
        g.mesh.removeFromParent()
        g.mesh.geometry.dispose()
        this.grenades.splice(i, 1)
      }
    }
  }

  private explode(pos: THREE.Vector3): void {
    this.effects.spawnExplosion(pos, 0xff8844, 1.15)
    this.audio.explosionAt(pos)
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue
      const d = e.group.position.distanceTo(pos)
      if (d < 6.2) this.enemies.damageEnemy(e.id, 110 * (1 - d / 6.2), pos, false)
    }
    if (this.shadeAlive && this.world.shade.position.distanceTo(pos) < 5) this.damageProp('shade-alpha', 80)
    const playerD = this.player.position.distanceTo(pos)
    if (playerD < 4.5) this.damage.applyDamage(55 * (1 - playerD / 4.5), pos)
    for (const m of this.squad.marines) {
      if (!m.alive) continue
      m.group.getWorldPosition(this.v)
      const d = this.v.distanceTo(pos)
      if (d < 4.2) m.wound(70 * (1 - d / 4.2))
    }
  }

  private clearGrenades(): void {
    for (const g of this.grenades) {
      g.mesh.removeFromParent()
      g.mesh.geometry.dispose()
    }
    this.grenades.length = 0
  }

  private updateDialogue(dt: number): void {
    const line = this.lines[0]
    if (!line) {
      if (this.showingLine) {
        this.showingLine = false
        this.ui.clearSubtitle()
      }
      return
    }
    if (!this.showingLine) {
      this.showingLine = true
      this.lineT = 0
      this.ui.setSubtitle(line.speaker, line.text)
    }
    this.lineT += dt
    if (this.lineT >= line.time) {
      this.lines.shift()
      this.showingLine = false
      this.lineT = 0
    }
  }

  private say(speaker: string, text: string, time: number): void {
    this.lines.push({ speaker, text, time })
  }

  private once(id: string, fn: () => void): void {
    if (this.said.has(id)) return
    this.said.add(id)
    fn()
  }

  private setObjective(text: string, x: number, z: number): void {
    if (this.objective === text) {
      this.mark(x, z)
      return
    }
    this.objective = text
    this.ui.setObjective(text)
    this.ui.showBanner('NEW OBJECTIVE')
    this.mark(x, z)
  }

  private mark(x: number, z: number): void {
    this.hasWaypoint = true
    this.waypoint.set(x, haloHeight(x, z) + 1, z)
  }

  private computePrompt(): string | null {
    if (this.finished) return null
    if (this.driving) return this.gunning ? 'E dismount · F driver seat' : 'E dismount · F turret'
    if (this.landed && this.nearPelican()) return 'E — Board Pelican'
    const pickup = this.closestPickup()
    if (pickup) return `E — ${this.pickupLabel(pickup)}`
    if (this.nearHog()) return 'E — Drive Warthog'
    return null
  }

  private pickupLabel(p: WorldPickup): string {
    if (p.def.kind === 'weapon' && p.def.weapon) return WEAPON_LABEL[p.def.weapon]
    if (p.def.kind === 'health') return 'Medical kit'
    if (p.def.kind === 'grenades') return 'Frag grenades'
    return 'Ammunition'
  }

  private closestPickup(): WorldPickup | null {
    let best: WorldPickup | null = null
    let bestD = 2.15
    for (const p of this.world.pickups) {
      if (p.taken || p.cooldown > 0) continue
      p.cooldown = Math.max(0, p.cooldown)
      const d = Math.hypot(p.mesh.position.x - this.player.position.x, p.mesh.position.z - this.player.position.z)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best
  }

  private tryPickup(): boolean {
    const p = this.closestPickup()
    if (!p) return false
    if (p.def.kind === 'weapon' && p.def.weapon) {
      const dropped = this.weapons.acquire(p.def.weapon)
      if (dropped) this.dropWeapon(dropped, p.mesh.position)
      this.say('Cortana', `${WEAPON_LABEL[p.def.weapon]} online.`, 1.8)
    } else if (p.def.kind === 'health') {
      this.damage.heal(p.def.amount)
      this.audio.ui()
    } else if (p.def.kind === 'grenades') {
      this.grenadeCount = Math.min(4, this.grenadeCount + p.def.amount)
      this.ui.setGrenades(this.grenadeCount)
      this.audio.ui()
    } else {
      this.weapons.resupply()
      this.audio.reload()
    }
    p.taken = true
    p.mesh.visible = false
    return true
  }

  private dropWeapon(id: WeaponId, at: THREE.Vector3): void {
    const mesh = new THREE.Group()
    const mat = createUnscMatte({ color: id === 'plasma' || id === 'prifle' ? 0x143028 : 0x3a4038 })
    mesh.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.55), mat))
    mesh.position.set(at.x, haloHeight(at.x, at.z) + 0.7, at.z + 0.8)
    this.world.root.add(mesh)
    this.world.pickups.push({
      def: { id: `drop-${id}-${this.age.toFixed(2)}`, kind: 'weapon', weapon: id, amount: 1, x: mesh.position.x, z: mesh.position.z },
      mesh,
      baseY: mesh.position.y,
      phase: this.age,
      taken: false,
      cooldown: 1.25,
    })
  }

  private nearHog(): boolean {
    return this.hog.group.position.distanceTo(this.player.position) < 4.2
  }

  private enterHog(): void {
    this.hogUnlocked = true
    this.driving = true
    this.gunning = false
    this.seatMarines()
    this.audio.ui()
    this.once('drive-line', () => {
      this.say('Cortana', 'Drive. I will watch the sensors.', 2.6)
      this.setObjective('Reach the structure', CAVE_MOUTH.x, 0)
    })
  }

  private exitHog(): void {
    this.driving = false
    this.gunning = false
    this.hog.forwardWorld(this.v)
    const side = this.v2.set(this.v.z, 0, -this.v.x).normalize()
    const x = this.hog.group.position.x + side.x * 2.4
    const z = this.hog.group.position.z + side.z * 2.4
    const y = haloHeight(x, z) + this.player.eyeHeight
    this.player.position.set(x, y, z)
    this.player.velocity.set(0, 0, 0)
    this.camera.position.copy(this.player.position)
    this.unseat(true)
  }

  private seatMarines(): void {
    const seats = [
      new THREE.Vector3(-0.45, 0.82, 0.05),
      new THREE.Vector3(0.05, 0.95, -0.85),
      new THREE.Vector3(0.42, 0.78, -0.45),
    ]
    const living = this.squad.living().filter((m) => !m.seated)
    living.sort((a, b) => a.group.position.distanceTo(this.hog.group.position) - b.group.position.distanceTo(this.hog.group.position))
    living.slice(0, 3).forEach((m, i) => {
      if (m.group.position.distanceTo(this.hog.group.position) > 18 && !m.following) return
      m.seated = true
      this.hog.group.attach(m.group)
      m.group.position.copy(seats[i]!)
      m.group.rotation.set(0, 0, 0)
    })
  }

  private unseat(follow: boolean): void {
    const spot = [
      new THREE.Vector3(2.2, 0, 1.6),
      new THREE.Vector3(2.2, 0, -1.6),
      new THREE.Vector3(-1.2, 0, 2.2),
    ]
    let i = 0
    for (const m of this.squad.marines) {
      if (!m.seated) continue
      this.world.root.attach(m.group)
      m.seated = false
      m.following = follow && m.alive && this.cleared('marines')
      const s = spot[i] ?? spot[0]!
      i++
      const x = this.hog.group.position.x + s.x
      const z = this.hog.group.position.z + s.z
      m.group.position.set(x, haloHeight(x, z), z)
    }
  }

  private nearPelican(): boolean {
    this.world.pelican.localToWorld(this.v.set(0, 0, -4.2))
    return this.v.distanceTo(this.player.position) < 3.6
  }

  private tryBoard(): boolean {
    if (!this.landed || !this.nearPelican()) return false
    this.finished = true
    this.driving = false
    this.gunning = false
    this.sinceFinish = 0
    this.hasWaypoint = false
    this.say('Cortana', 'We are clear.', 2)
    this.say('Foehammer', 'Welcome to Halo.', 3.2)
    this.ui.showBanner('MISSION COMPLETE')
    this.ui.setObjective('Welcome to Halo')
    this.audio.setEngine(0)
    this.audio.setMusicMode('explore')
    this.audio.setMusicIntensity(0.2)
    return true
  }

  private cleared(id: string): boolean {
    return this.encounters.some((e) => e.def.id === id && e.cleared)
  }

  private nearestEnemy(from: THREE.Vector3, maxDist: number) {
    let best: (typeof this.enemies.enemies)[number] | null = null
    let bestD = maxDist
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue
      const d = e.group.position.distanceTo(from)
      if (d < bestD) {
        bestD = d
        best = e
      }
    }
    return best
  }

  private killShade(): void {
    this.shadeAlive = false
    this.world.shade.visible = false
    this.effects.spawnExplosion(this.world.shade.position.clone().setY(this.world.shade.position.y + 1), 0x66ffb0, 1.2)
    this.audio.explosionAt(this.world.shade.position)
  }
}
