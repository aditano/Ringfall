import * as THREE from 'three'
import type { SpawnPoint } from '../world/Environment'
import type { EffectsManager } from '../vfx/EffectsManager'
import type { AudioManager } from '../audio/AudioManager'
import type { ProjectileManager } from '../weapons/Projectile'
import { Enemy, EnemyState, type EnemyKind } from './Enemy'

/** Beyond radar range. Sleep so a full mission of leftovers does not keep simulating. */
const SLEEP_DIST_SQ = 70 * 70
const WAKE_DIST_SQ = 58 * 58

export interface WaveDefinition {
  count: number
  eliteChance: number
  startDelay: number
  spawnInterval: number
  spawnPoints?: THREE.Vector3[]
}

export interface EnemyManagerOptions {
  scene: THREE.Object3D
  spawns: SpawnPoint[]
  projectiles: ProjectileManager
  effects: EffectsManager
  audio: AudioManager
}

/**
 * Spawns and orchestrates Covenant waves for arena combat.
 * Compatible with Game.ts (constructor args + damageEnemy / getMeshes / startWave).
 */
export class EnemyManager {
  enemies: Enemy[] = []
  kills = 0

  private readonly scene: THREE.Object3D
  private readonly spawns: SpawnPoint[]
  private readonly projectiles: ProjectileManager
  private readonly effects: EffectsManager
  private readonly audio: AudioManager
  groundAt: ((x: number, z: number) => number) | null = null
  private readonly arenaCenter = new THREE.Vector3()
  private readonly arenaRadius = 18
  private readonly meshCache: THREE.Object3D[] = []
  private meshCacheDirty = true

  private seq = 0
  private wave = 0
  private phase: 'idle' | 'delay' | 'spawning' | 'fighting' | 'between' | 'done' = 'idle'
  private phaseTimer = 0
  private spawnQueue = 0
  private spawnTimer = 0
  private currentEliteChance = 0
  private waves: WaveDefinition[] | null = null
  private waveIndex = -1
  private useCustomWaves = false
  onWaveCleared?: (wave: number) => void
  onWaveStarted?: (wave: number) => void

  constructor(
    scene: THREE.Object3D,
    spawns: SpawnPoint[],
    projectiles: ProjectileManager,
    effects: EffectsManager,
    audio: AudioManager,
  ) {
    this.scene = scene
    this.spawns = spawns
    this.projectiles = projectiles
    this.effects = effects
    this.audio = audio
    if (spawns.length > 0) {
      for (const s of spawns) this.arenaCenter.add(s.position)
      this.arenaCenter.multiplyScalar(1 / spawns.length)
    }
  }

  setWaves(waves: WaveDefinition[]): void {
    this.waves = waves.map((w) => ({
      ...w,
      spawnPoints: w.spawnPoints?.map((p) => p.clone()),
    }))
    this.useCustomWaves = true
  }

  getMeshes(): THREE.Object3D[] {
    if (this.meshCacheDirty) {
      this.meshCache.length = 0
      for (const e of this.enemies) {
        if (e.alive) this.meshCache.push(...e.meshes)
      }
      this.meshCacheDirty = false
    }
    return this.meshCache
  }

  private invalidateMeshCache(): void {
    this.meshCacheDirty = true
  }

  get aliveCount(): number {
    let n = 0
    for (const e of this.enemies) if (e.alive) n += 1
    return n
  }

  get currentWave(): number {
    return this.wave
  }

  get waveNumber(): number {
    return Math.max(1, this.wave)
  }

  startWave(n = 6): void {
    this.wave += 1
    this.phase = 'spawning'
    this.spawnQueue = n
    this.spawnTimer = 0
    this.currentEliteChance = Math.min(0.55, 0.1 + this.wave * 0.08)
    this.phaseTimer = 0
    this.onWaveStarted?.(this.wave)
  }

  reset(): void {
    this.clear()
    this.kills = 0
    this.wave = 0
    this.phase = 'idle'
    this.waveIndex = -1
    this.useCustomWaves = false
    this.phaseTimer = 0
    this.spawnQueue = 0
    this.spawnTimer = 0
  }

  startCombat(): void {
    if (!this.waves || this.waves.length === 0) {
      this.startWave(6)
      return
    }
    this.useCustomWaves = true
    this.waveIndex = -1
    this.beginNextCustomWave()
  }

  spawnEnemy(kind: EnemyKind, spawn: SpawnPoint): Enemy {
    const e = new Enemy(kind, spawn, `e${this.seq++}`)
    e.groundAt = this.groundAt
    this.enemies.push(e)
    this.scene.add(e.group)
    this.invalidateMeshCache()
    return e
  }

  purgeIds(ids: readonly string[]): void {
    if (ids.length === 0) return
    const drop = new Set(ids)
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]!
      if (!drop.has(e.id)) continue
      e.alive = false
      e.dispose()
      this.enemies.splice(i, 1)
    }
    this.invalidateMeshCache()
  }

  damageEnemy(id: string, damage: number, point: THREE.Vector3, headshot: boolean): boolean {
    const e = this.enemies.find((x) => x.id === id)
    if (!e || !e.alive) return false
    const killed = e.takeDamage(damage, point, this.effects, headshot)
    if (killed) {
      this.kills += 1
      this.invalidateMeshCache()
      this.playDeathSfx()
    }
    return killed
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    for (const e of this.enemies) {
      if (e.state === EnemyState.Dead) continue
      const dx = e.group.position.x - playerPos.x
      const dz = e.group.position.z - playerPos.z
      const distSq = dx * dx + dz * dz
      const dying = e.state === EnemyState.Dying
      if (!dying && e.simulated && distSq > SLEEP_DIST_SQ) {
        e.setSimulated(false)
        continue
      }
      if (!e.simulated) {
        if (e.state === EnemyState.Dying) {
          e.state = EnemyState.Dead
          e.group.visible = false
          continue
        }
        if (distSq > WAKE_DIST_SQ) continue
        e.setSimulated(true)
      }
      e.update(dt, playerPos, this.projectiles, true)
    }
    this.pruneDead()
    this.updateWaves(dt)
  }

  clear(): void {
    for (const e of this.enemies) e.dispose()
    this.enemies.length = 0
    this.phase = 'idle'
    this.spawnQueue = 0
    this.invalidateMeshCache()
  }

  dispose(): void {
    this.clear()
  }

  private playDeathSfx(): void {
    const audio = this.audio as AudioManager & {
      enemyDeath?: () => void
      play?: (n: string) => void
    }
    if (typeof audio.enemyDeath === 'function') audio.enemyDeath()
    else if (typeof audio.play === 'function') audio.play('ui_blip')
  }

  private pruneDead(): void {
    let removed = false
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]!
      if (e.state === EnemyState.Dead || (!e.alive && !e.group.visible)) {
        e.dispose()
        this.enemies.splice(i, 1)
        removed = true
      }
    }
    if (removed) this.invalidateMeshCache()
  }

  private updateWaves(dt: number): void {
    if (this.useCustomWaves && this.waves) {
      this.updateCustomWaves(dt)
      return
    }

    if (this.phase === 'idle') return

    if (this.phase === 'spawning') {
      if (this.spawnQueue > 0) {
        this.spawnTimer -= dt
        if (this.spawnTimer <= 0) {
          this.spawnOne()
          this.spawnQueue -= 1
          this.spawnTimer = 0.4
        }
      } else {
        this.phase = 'fighting'
      }
      return
    }

    if (this.phase === 'fighting') {
      if (this.aliveCount === 0) {
        this.phase = 'between'
        this.phaseTimer = 2.0
        this.onWaveCleared?.(this.wave)
      }
      return
    }

    if (this.phase === 'between') {
      this.phaseTimer -= dt
      if (this.phaseTimer <= 0) {
        this.startWave(Math.min(14, 5 + this.wave * 2))
      }
    }
  }

  private beginNextCustomWave(): void {
    if (!this.waves) return
    this.waveIndex += 1
    if (this.waveIndex >= this.waves.length) {
      this.phase = 'done'
      return
    }
    const w = this.waves[this.waveIndex]!
    this.wave = this.waveIndex + 1
    this.phase = 'delay'
    this.phaseTimer = w.startDelay
    this.spawnQueue = w.count
    this.currentEliteChance = w.eliteChance
    this.spawnTimer = 0
  }

  private updateCustomWaves(dt: number): void {
    if (this.phase === 'done' || this.phase === 'idle') return

    if (this.phase === 'delay') {
      this.phaseTimer -= dt
      if (this.phaseTimer <= 0) this.phase = 'spawning'
      return
    }

    if (this.phase === 'spawning') {
      if (this.spawnQueue > 0) {
        this.spawnTimer -= dt
        if (this.spawnTimer <= 0) {
          this.spawnOne()
          this.spawnQueue -= 1
          const w = this.waves?.[this.waveIndex]
          this.spawnTimer = w?.spawnInterval ?? 0.4
        }
      } else {
        this.phase = 'fighting'
      }
      return
    }

    if (this.phase === 'fighting' && this.aliveCount === 0) {
      this.phase = 'between'
      this.phaseTimer = 2
      return
    }

    if (this.phase === 'between') {
      this.phaseTimer -= dt
      if (this.phaseTimer <= 0) this.beginNextCustomWave()
    }
  }

  private spawnOne(): void {
    const spawn = this.nextSpawn()
    const kind: EnemyKind = Math.random() < this.currentEliteChance ? 'elite' : 'grunt'
    const e = this.spawnEnemy(kind, spawn)
    e.group.position.x += (Math.random() - 0.5) * 2
    e.group.position.z += (Math.random() - 0.5) * 2
  }

  private nextSpawn(): SpawnPoint {
    if (this.spawns.length > 0) {
      const s = this.spawns[this.seq % this.spawns.length]!
      return { position: s.position.clone(), yaw: s.yaw }
    }
    const angle = Math.random() * Math.PI * 2
    const r = this.arenaRadius * (0.55 + Math.random() * 0.35)
    return {
      position: new THREE.Vector3(
        this.arenaCenter.x + Math.cos(angle) * r,
        this.arenaCenter.y,
        this.arenaCenter.z + Math.sin(angle) * r,
      ),
      yaw: angle + Math.PI,
    }
  }
}

export type { EnemyKind, EnemyDamageResult } from './Enemy'
export { Enemy, EnemyState } from './Enemy'
