/**
 * Headless stress check for the combat freeze fixes.
 * Run: npx vite-node scripts/stress-freeze.ts
 */
import * as THREE from 'three'

class FakeCanvas {
  width = 8
  height = 8
  getContext(): CanvasRenderingContext2D {
    const ctx = {
      fillStyle: '',
      globalAlpha: 1,
      strokeStyle: '',
      lineWidth: 1,
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      arc() {},
      fill() {},
    }
    return ctx as unknown as CanvasRenderingContext2D
  }
}

const documentStub = {
  createElement: (tag: string) => (tag === 'canvas' ? new FakeCanvas() : {}),
}
Object.assign(globalThis, { document: documentStub })

const { EnemyManager } = await import('../src/enemies/EnemyManager')
const { MAX_PROJECTILES, ProjectileManager } = await import('../src/weapons/Projectile')
type EffectsManager = import('../src/vfx/EffectsManager').EffectsManager
type AudioManager = import('../src/audio/AudioManager').AudioManager

const effects = {
  spawnExplosion() {},
  spawnImpact() {},
  spawnShieldRipple() {},
  spawnPlasmaImpact() {},
  spawnDecal() {},
  addTrauma() {},
} as unknown as EffectsManager

const audio = {} as AudioManager

function pointLights(root: THREE.Object3D): number {
  let n = 0
  root.traverse((obj) => {
    if ((obj as THREE.PointLight).isPointLight) n += 1
  })
  return n
}

const scene = new THREE.Scene()
const projectiles = new ProjectileManager(scene)
const origin = new THREE.Vector3(0, 1, 0)
const dir = new THREE.Vector3(1, 0, 0)
const t0 = performance.now()
for (let i = 0; i < 500; i++) {
  origin.set(i * 0.01, 1, 0)
  projectiles.spawn(origin, dir, 48, { fromPlayer: false, damage: 8, color: 0x44ffaa })
}
const spawnMs = performance.now() - t0
if (projectiles.projectiles.length !== MAX_PROJECTILES) {
  throw new Error(`expected ${MAX_PROJECTILES} live bolts, got ${projectiles.projectiles.length}`)
}
if (pointLights(scene) !== 0) {
  throw new Error(`projectile lights leaked: ${pointLights(scene)}`)
}

const enemies = new EnemyManager(scene, [], projectiles, effects, audio)
for (let i = 0; i < 40; i++) {
  const kind = i % 5 === 0 ? 'elite' : i % 3 === 0 ? 'jackal' : 'grunt'
  enemies.spawnEnemy(kind, { position: new THREE.Vector3(i * 30, 0, (i % 2) * 4), yaw: 0 })
}
const player = new THREE.Vector3(0, 1.7, 0)
for (let frame = 0; frame < 30; frame++) {
  enemies.update(0.05, player)
  projectiles.update(0.05)
}
const awake = enemies.enemies.filter((e) => e.simulated && e.alive).length
if (awake > 6) throw new Error(`too many simulated enemies near origin: ${awake}`)

const first = enemies.enemies.find((e) => e.kind === 'grunt')
const second = enemies.spawnEnemy('grunt', { position: new THREE.Vector3(2, 0, 1), yaw: 0 })
const torsoA = first?.group.getObjectByName('torso') as THREE.Mesh | undefined
const torsoB = second.group.getObjectByName('torso') as THREE.Mesh | undefined
if (!torsoA || !torsoB) throw new Error('missing torso')
if (torsoA.geometry !== torsoB.geometry) throw new Error('grunt geometry was not shared')

const elite = enemies.enemies.find((e) => e.kind === 'elite')
if (!elite) throw new Error('missing elite')
let transmission = 0
elite.group.traverse((obj) => {
  const mesh = obj as THREE.Mesh
  const mat = mesh.material as THREE.MeshPhysicalMaterial | undefined
  if (mat && typeof mat.transmission === 'number' && mat.transmission > 0) transmission += 1
})
if (transmission !== 0) throw new Error('elite shield still uses transmission')

first?.dispose()
if (!torsoB.geometry.getAttribute('position')) throw new Error('disposing one enemy disposed shared geometry')

projectiles.clear()
const bolt = projectiles.spawn(origin, dir, 10, { fromPlayer: false })
bolt.heard = true
bolt.life = 0
projectiles.update(0.016)
const again = projectiles.spawn(origin, dir, 10, { fromPlayer: false })
if (again.heard) throw new Error('recycled bolt kept heard flag')
if (projectiles.projectiles.length !== 1) throw new Error('clear/spawn pool desync')

console.log(
  JSON.stringify({
    ok: true,
    spawnMs: Math.round(spawnMs),
    liveBolts: projectiles.projectiles.length,
    pointLights: pointLights(scene),
    awake,
    enemies: enemies.enemies.length,
  }),
)
