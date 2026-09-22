import * as THREE from 'three'
import type { AABB } from './Environment'
import {
  createCrateMetal,
  createEnergyBridge,
  createForerunnerMetal,
  createRock,
  createTerrainVertexColored,
  createUnscMatte,
} from '../rendering/Materials'
import { COVER, HOG_SPAWN, PELICAN_PAD, PICKUPS, SHADE_POST, SPAWN, type PickupDef } from '../mission/layout'
import { pointInBoxes } from './Raycast'

export interface WorldPickup {
  def: PickupDef
  mesh: THREE.Group
  baseY: number
  phase: number
  taken: boolean
  cooldown: number
}

export interface HaloWorld {
  root: THREE.Group
  colliders: AABB[]
  playerSpawn: { position: THREE.Vector3; yaw: number }
  hogSpawn: { position: THREE.Vector3; yaw: number }
  pelican: THREE.Group
  pelicanRamp: THREE.Group
  doorL: THREE.Group
  doorR: THREE.Group
  shade: THREE.Group
  shadeMuzzle: THREE.Object3D
  shadeMeshes: THREE.Object3D[]
  doorColliders: AABB[]
  pickups: WorldPickup[]
  update: (dt: number) => void
  solidAt: (p: THREE.Vector3) => boolean
  dispose: () => void
}

const FORERUNNER = createForerunnerMetal({ color: 0x7c8682, emissiveIntensity: 0.16 })
const FORERUNNER_DARK = createForerunnerMetal({ color: 0x3e474c, emissiveIntensity: 0.08 })
const OLIVE = createUnscMatte({ color: 0x3f4a34 })
const OLIVE_DARK = createUnscMatte({ color: 0x2a3124 })
const ROCK = createRock()
const CRATE = createCrateMetal()
const BRIDGE = createEnergyBridge({ emissiveIntensity: 1.6 })

function smooth(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0
  const t = Math.min(1, Math.max(0, (x - edge0) / (span === 0 ? 1 : span)))
  return t * t * (3 - 2 * t)
}

function baseHeight(x: number, z: number): number {
  const ax = Math.abs(z)
  const wall = smooth(16, 34, ax) * 12
  const hill = smooth(62, -8, x) * 5.2
  const roll =
    Math.sin(x * 0.04) * 1.05 * (1 - smooth(14, 30, ax)) + Math.sin(x * 0.105 + z * 0.15) * 0.35
  let h = 0.4 + wall + hill + roll
  if (x > 48 && x < 175) {
    const stream = Math.exp(-((z - 8) ** 2) / 28)
    h -= stream * 1.05 * smooth(48, 72, x) * (1 - smooth(150, 176, x))
  }
  const roadGate = smooth(24, 52, x) * (1 - smooth(458, 488, x))
  const road = Math.exp(-(z * z) / 78) * roadGate
  const roadH = 0.55 + Math.sin(x * 0.04) * 0.2
  h = h * (1 - road * 0.78) + roadH * road * 0.78
  return h
}

/** World height in meters. The pit under the cave bridge returns -8. */
export function haloHeight(x: number, z: number): number {
  let h = baseHeight(x, z)

  if (x > -1 && x < 16 && Math.abs(z) < 3.8) {
    const flat = baseHeight(7, 0)
    const edge = Math.max(Math.abs(x - 7) / 8.5, Math.abs(z) / 3.8)
    const t = smooth(0.45, 1, edge)
    h = flat * (1 - t) + h * t
  }

  if (x > 496 && x < 608 && Math.abs(z) < 12.2) {
    if (x > 546 && x < 564 && Math.abs(z) < 4.5) return -8
    return 0.42
  }

  if (x > 468 && x < 498 && Math.abs(z) <= 5.2) {
    const t = smooth(468, 496, x)
    h = h * (1 - t) + 0.42 * t
  }
  if (x > 472 && x < 504 && Math.abs(z) > 5.2 && Math.abs(z) < 42) {
    h = Math.max(h, 13 * (1 - smooth(30, 42, Math.abs(z))))
  }
  if (x > 496 && x < 608 && Math.abs(z) >= 12.2 && Math.abs(z) < 32) {
    h = Math.max(h, 9.5)
  }

  if (x >= 606 && x < 642 && Math.abs(z) <= 6.2) {
    const t = smooth(606, 636, x)
    h = 0.42 * (1 - t) + 0.5 * t
  }
  if (x > 600 && x < 638 && Math.abs(z) > 6.2 && Math.abs(z) < 38) {
    h = Math.max(h, 8 * (1 - smooth(608, 640, x)))
  }

  if (x > 642) {
    const t = smooth(642, 672, x)
    h = h * (1 - t) + 0.48 * t
  }
  if (x > 674 && x < 742 && Math.abs(z) < 18) h = 0.46
  return h
}

/** Driving surface. The hardlight bridge spans the pit. */
export function driveSurface(x: number, z: number): number {
  if (x > 546 && x < 564 && Math.abs(z) < 1.8) return 0.55
  return haloHeight(x, z)
}

export function buildHaloMission(scene: THREE.Scene): HaloWorld {
  const root = new THREE.Group()
  root.name = 'HaloMission'
  scene.add(root)

  const colliders: AABB[] = []
  const pickups: WorldPickup[] = []

  root.add(buildTerrain())
  buildStream(root)
  buildScatter(root, colliders)
  buildLifeboat(root, colliders)
  buildAutumn(root)
  buildPylons(root, colliders)
  buildCave(root, colliders)
  const doors = buildCaveDoors(root, colliders)
  const shade = buildShade(root)
  const pelican = buildPelican(root)
  buildLzPad(root)
  buildValleyWalls(colliders)
  buildPickups(root, pickups)
  buildDeadMarine(root)

  const smoke = buildSmoke(root)
  let time = 0

  return {
    root,
    colliders,
    playerSpawn: {
      position: new THREE.Vector3(SPAWN.x, haloHeight(SPAWN.x, SPAWN.z) + 1.7, SPAWN.z),
      yaw: SPAWN.yaw,
    },
    hogSpawn: {
      position: new THREE.Vector3(HOG_SPAWN.x, driveSurface(HOG_SPAWN.x, HOG_SPAWN.z), HOG_SPAWN.z),
      yaw: HOG_SPAWN.yaw,
    },
    pelican: pelican.group,
    pelicanRamp: pelican.ramp,
    doorL: doors.left,
    doorR: doors.right,
    shade: shade.group,
    shadeMuzzle: shade.muzzle,
    shadeMeshes: shade.meshes,
    doorColliders: doors.colliders,
    pickups,
    update(dt: number) {
      time += dt
      const attr = smoke.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < attr.count; i++) {
        let y = attr.getY(i) + dt * (1.6 + (i % 5) * 0.35)
        if (y > attr.getY(i) + 18 || y > 28) {
          y = haloHeight(-40, 16) + 6 + (i % 4)
        }
        attr.setY(i, y)
      }
      attr.needsUpdate = true
      for (const p of pickups) {
        if (!p.mesh.visible) continue
        p.mesh.position.y = p.baseY + Math.sin(time * 2.1 + p.phase) * 0.1
        p.mesh.rotation.y += dt * 0.7
      }
    },
    solidAt(p: THREE.Vector3) {
      return pointInBoxes(p, colliders, 0.02)
    },
    dispose() {
      scene.remove(root)
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
      })
    },
  }
}

function buildTerrain(): THREE.Mesh {
  const x0 = -180
  const x1 = 780
  const z0 = -72
  const z1 = 72
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 192, 42)
  geo.rotateX(-Math.PI / 2)
  geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const grass = new THREE.Color(0x4a8a36)
  const grassDark = new THREE.Color(0x2f5e28)
  const dirt = new THREE.Color(0x8d6d42)
  const rock = new THREE.Color(0x7a756c)
  const sand = new THREE.Color(0xcbb88a)
  const metal = new THREE.Color(0x667078)
  const tint = new THREE.Color()

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const y = haloHeight(x, z)
    pos.setY(i, y)
    const slope = Math.abs(haloHeight(x + 2, z) - y) + Math.abs(haloHeight(x, z + 2) - y)
    const n = Math.sin(x * 0.37) * Math.cos(z * 0.41)
    const interior = x > 496 && x < 608 && Math.abs(z) < 12
    const path = Math.abs(z) < 4.2 && x > 30 && x < 470
    const beach = x > 660
    if (interior) tint.copy(metal)
    else if (slope > 1.35) tint.copy(rock)
    else if (beach && Math.abs(z) < 16) tint.copy(sand).lerp(grass, 0.35)
    else if (path) tint.copy(dirt)
    else if (n > 0.35) tint.copy(grassDark)
    else tint.copy(grass)
    if (!interior) tint.offsetHSL(0, 0, n * 0.04)
    colors[i * 3] = tint.r
    colors[i * 3 + 1] = tint.g
    colors[i * 3 + 2] = tint.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, createTerrainVertexColored())
  mesh.name = 'HaloTerrain'
  mesh.receiveShadow = true
  return mesh
}

function buildStream(root: THREE.Group): void {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a6e86,
    transparent: true,
    opacity: 0.72,
    roughness: 0.08,
    metalness: 0.15,
  })
  const geo = new THREE.PlaneGeometry(120, 3.2, 24, 1)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + 110
    const z = pos.getZ(i) + 8
    pos.setXYZ(i, x, haloHeight(x, z) + 0.08, z)
  }
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'Stream'
  root.add(mesh)
}

function buildScatter(root: THREE.Group, colliders: AABB[]): void {
  const rng = mulberry32(7)
  for (const c of COVER) {
    const y = haloHeight(c.x, c.z)
    if (c.crate) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(c.s * 1.3, c.s, c.s * 0.9), CRATE)
      crate.position.set(c.x, y + c.s * 0.5, c.z)
      crate.castShadow = true
      crate.receiveShadow = true
      root.add(crate)
      addCollider(colliders, c.x, y + c.s * 0.5, c.z, c.s * 1.3, c.s, c.s * 0.9)
    } else {
      addRock(root, colliders, c.x, c.z, c.s, true)
    }
  }
  for (let i = 0; i < 36; i++) {
    const x = -20 + rng() * 760
    const z = (rng() > 0.5 ? 1 : -1) * (8 + rng() * 18)
    if (x > 480 && x < 630) continue
    if (Math.abs(z) < 3.2 && x > 20 && x < 470) continue
    addRock(root, colliders, x, z, 0.55 + rng() * 0.7, false)
  }
  for (let i = 0; i < 22; i++) {
    const x = 20 + rng() * 430
    const z = (rng() > 0.5 ? 1 : -1) * (12 + rng() * 16)
    if (x > 470 && x < 640) continue
    addTree(root, x, z, 0.85 + rng() * 0.6)
  }
  const grassGeo = new THREE.ConeGeometry(0.22, 0.7, 4)
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x3e7a32, roughness: 1 })
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, 200)
  const dummy = new THREE.Object3D()
  let n = 0
  for (let i = 0; i < 200; i++) {
    const x = rng() * 450
    const z = (rng() - 0.5) * 28
    if (Math.abs(z) < 3 && x > 40) continue
    if (x > 490 && x < 640) continue
    const y = haloHeight(x, z)
    dummy.position.set(x, y + 0.3, z)
    dummy.rotation.y = rng() * Math.PI
    dummy.scale.setScalar(0.7 + rng() * 0.8)
    dummy.updateMatrix()
    grass.setMatrixAt(n, dummy.matrix)
    n++
  }
  grass.count = n
  grass.instanceMatrix.needsUpdate = true
  root.add(grass)
}

function addRock(
  root: THREE.Group,
  colliders: AABB[],
  x: number,
  z: number,
  s: number,
  solid: boolean,
): void {
  const y = haloHeight(x, z)
  const geo = new THREE.DodecahedronGeometry(s, 0)
  const mesh = new THREE.Mesh(geo, ROCK)
  mesh.position.set(x, y + s * 0.45, z)
  mesh.scale.set(1.1, 0.72, 0.95)
  mesh.rotation.y = x * 0.2
  mesh.castShadow = solid
  mesh.receiveShadow = true
  root.add(mesh)
  if (solid) addCollider(colliders, x, y + s * 0.4, z, s * 1.7, s * 1.1, s * 1.5)
}

function addTree(root: THREE.Group, x: number, z: number, s: number): void {
  const y = haloHeight(x, z)
  const g = new THREE.Group()
  g.position.set(x, y, z)
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 1.1 * s, 5),
    createUnscMatte({ color: 0x5a4632 }),
  )
  trunk.position.y = 0.55 * s
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(0.85 * s, 2.2 * s, 6),
    new THREE.MeshStandardMaterial({ color: 0x2f6a34, roughness: 0.95 }),
  )
  crown.position.y = 1.8 * s
  g.add(trunk, crown)
  root.add(g)
}

function buildLifeboat(root: THREE.Group, colliders: AABB[]): void {
  const x = 6.2
  const z = 0
  const floor = haloHeight(x, z)
  const g = new THREE.Group()
  g.name = 'Lifeboat'
  g.position.set(x, floor, z)
  g.add(mesh(new THREE.BoxGeometry(7.2, 0.16, 3.05), OLIVE_DARK, 0, 0.1, 0))
  g.add(mesh(new THREE.BoxGeometry(7.2, 0.18, 3.15), OLIVE, 0, 2.25, 0))
  const stripe = mesh(
    new THREE.BoxGeometry(7.5, 0.18, 3.2),
    new THREE.MeshStandardMaterial({
      color: 0xc4b07a,
      roughness: 0.6,
      metalness: 0.2,
    }),
    0,
    1.7,
    0,
  )
  g.add(stripe)
  const nose = mesh(new THREE.BoxGeometry(0.5, 1.7, 2.6), OLIVE_DARK, -3.7, 1.2, 0)
  g.add(nose)
  // Interior floor lip and side walls. The +X face stays open — that's the ramp.
  const left = mesh(new THREE.BoxGeometry(6.6, 1.7, 0.28), OLIVE_DARK, -0.2, 1.15, 1.45)
  const right = mesh(new THREE.BoxGeometry(6.6, 1.7, 0.28), OLIVE_DARK, -0.2, 1.15, -1.45)
  g.add(left, right)
  const aft = mesh(new THREE.BoxGeometry(0.35, 1.8, 2.7), OLIVE_DARK, -3.2, 1.15, 0)
  g.add(aft)
  const bench = mesh(new THREE.BoxGeometry(2.2, 0.35, 1.1), OLIVE_DARK, -1.2, 0.4, 0)
  g.add(bench)
  const beacon = mesh(
    new THREE.BoxGeometry(0.28, 0.28, 0.28),
    new THREE.MeshStandardMaterial({ color: 0xff6633, emissive: 0xff4400, emissiveIntensity: 2 }),
    0.4,
    2.35,
    0,
  )
  g.add(beacon)
  const light = new THREE.PointLight(0xff7733, 1.4, 8)
  light.position.set(0.4, 2.5, 0)
  g.add(light)
  root.add(g)

  addCollider(colliders, x - 0.2, floor + 1.15, z + 1.45, 6.6, 1.7, 0.28)
  addCollider(colliders, x - 0.2, floor + 1.15, z - 1.45, 6.6, 1.7, 0.28)
  addCollider(colliders, x - 3.2, floor + 1.15, z, 0.4, 1.8, 2.7)
  addCollider(colliders, x, floor + 2.35, z, 6.8, 0.25, 2.8)
}

function buildAutumn(root: THREE.Group): void {
  const x = -48
  const z = 22
  const y = haloHeight(-20, 16) - 2
  const g = new THREE.Group()
  g.name = 'PillarOfAutumn'
  g.position.set(x, y, z)
  g.rotation.y = 0.22
  const hullMat = createUnscMatte({ color: 0x6a7268 })
  const dark = createUnscMatte({ color: 0x2c332e })
  g.add(mesh(new THREE.BoxGeometry(92, 14, 22), hullMat, 0, 10, 0))
  g.add(mesh(new THREE.BoxGeometry(70, 8, 16), hullMat, -4, 20, 0))
  g.add(mesh(new THREE.BoxGeometry(18, 10, 14), dark, 40, 8, 0))
  g.add(mesh(new THREE.BoxGeometry(16, 12, 10), dark, -42, 12, 6))
  const fire = new THREE.PointLight(0xff6622, 18, 70)
  fire.position.set(36, 14, 2)
  g.add(fire)
  const glow = mesh(
    new THREE.SphereGeometry(3.2, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff5518, transparent: true, opacity: 0.85 }),
    36,
    12,
    2,
  )
  g.add(glow)
  root.add(g)
}

function buildSmoke(root: THREE.Group): THREE.Points {
  const count = 70
  const positions = new Float32Array(count * 3)
  const baseY = haloHeight(-40, 16) + 8
  for (let i = 0; i < count; i++) {
    positions[i * 3] = -20 + Math.random() * 28
    positions[i * 3 + 1] = baseY + Math.random() * 16
    positions[i * 3 + 2] = 14 + Math.random() * 14
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const pts = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0x4a4e52,
      size: 7,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  )
  pts.name = 'AutumnSmoke'
  root.add(pts)
  return pts
}

function buildPylons(root: THREE.Group, colliders: AABB[]): void {
  const spots = [
    { x: 250, z: -22 },
    { x: 360, z: 24 },
    { x: 430, z: -26 },
  ]
  for (const s of spots) {
    const y = haloHeight(s.x, s.z)
    const g = new THREE.Group()
    g.position.set(s.x, y, s.z)
    g.add(mesh(new THREE.BoxGeometry(3.2, 18, 3.2), FORERUNNER, 0, 9, 0))
    g.add(mesh(new THREE.BoxGeometry(5.4, 1.2, 5.4), FORERUNNER_DARK, 0, 16.5, 0))
    const strip = new THREE.MeshStandardMaterial({
      color: 0x9ffff0,
      emissive: 0x3ef0ff,
      emissiveIntensity: 1.8,
    })
    g.add(mesh(new THREE.BoxGeometry(0.18, 14, 0.18), strip, 1.7, 8, 0))
    g.add(mesh(new THREE.BoxGeometry(0.18, 14, 0.18), strip, -1.7, 8, 0))
    root.add(g)
    addCollider(colliders, s.x, y + 9, s.z, 3.2, 18, 3.2)
  }
}

function buildCave(root: THREE.Group, colliders: AABB[]): void {
  const y0 = 0
  // Flanking cliffs at the mouth.
  addWall(root, colliders, 490, y0 + 7, 20, 16, 14, 22)
  addWall(root, colliders, 490, y0 + 7, -20, 16, 14, 22)
  // Interior shell.
  addWall(root, colliders, 552, 3.6, 12.5, 112, 7.2, 1.15)
  addWall(root, colliders, 552, 3.6, -12.5, 112, 7.2, 1.15)
  const ceiling = mesh(new THREE.BoxGeometry(112, 0.45, 24), FORERUNNER_DARK, 552, 7.1, 0)
  ceiling.receiveShadow = true
  root.add(ceiling)
  // Entrance frame
  const frameMat = FORERUNNER
  root.add(mesh(new THREE.BoxGeometry(1.4, 8, 1.2), frameMat, 493, 4, 5.6))
  root.add(mesh(new THREE.BoxGeometry(1.4, 8, 1.2), frameMat, 493, 4, -5.6))
  root.add(mesh(new THREE.BoxGeometry(1.4, 1.1, 12.4), frameMat, 493, 7.6, 0))
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xc8fff8,
    emissive: 0x49f3ff,
    emissiveIntensity: 1.7,
  })
  root.add(mesh(new THREE.BoxGeometry(0.2, 6.4, 0.2), glowMat, 492.2, 3.6, 5.2))
  root.add(mesh(new THREE.BoxGeometry(0.2, 6.4, 0.2), glowMat, 492.2, 3.6, -5.2))
  root.add(mesh(new THREE.BoxGeometry(0.2, 0.2, 10), glowMat, 492.2, 7.1, 0))

  // Pillars and light strips inside.
  for (const x of [522, 548, 582]) {
    root.add(mesh(new THREE.BoxGeometry(1.1, 6.2, 1.1), FORERUNNER, x, 3.1, 8))
    root.add(mesh(new THREE.BoxGeometry(1.1, 6.2, 1.1), FORERUNNER, x, 3.1, -8))
    addCollider(colliders, x, 3.1, 8, 1.1, 6.2, 1.1)
    addCollider(colliders, x, 3.1, -8, 1.1, 6.2, 1.1)
  }
  for (let i = 0; i < 8; i++) {
    const x = 508 + i * 12
    root.add(mesh(new THREE.BoxGeometry(0.12, 0.12, 8), glowMat, x, 0.15, 9.4))
    root.add(mesh(new THREE.BoxGeometry(0.12, 0.12, 8), glowMat, x, 0.15, -9.4))
    root.add(mesh(new THREE.BoxGeometry(0.12, 4.5, 0.12), glowMat, x, 3.2, 11.8))
  }

  // Pit rails (visual only) and the hardlight bridge.
  root.add(mesh(new THREE.BoxGeometry(16, 0.7, 0.2), FORERUNNER_DARK, 555, 0.85, 4.5))
  root.add(mesh(new THREE.BoxGeometry(16, 0.7, 0.2), FORERUNNER_DARK, 555, 0.85, -4.5))
  const bridge = mesh(new THREE.BoxGeometry(18, 0.18, 3.4), BRIDGE, 555, 0.48, 0)
  bridge.name = 'LightBridge'
  root.add(bridge)
  addCollider(colliders, 555, 0.4, 0, 18, 0.28, 3.4)

  // Exit frame
  root.add(mesh(new THREE.BoxGeometry(1.2, 7, 1.1), frameMat, 606, 3.5, 5.4))
  root.add(mesh(new THREE.BoxGeometry(1.2, 7, 1.1), frameMat, 606, 3.5, -5.4))
  root.add(mesh(new THREE.BoxGeometry(1.2, 1, 12), frameMat, 606, 6.8, 0))
}

function buildCaveDoors(
  root: THREE.Group,
  colliders: AABB[],
): { left: THREE.Group; right: THREE.Group; colliders: AABB[] } {
  const left = new THREE.Group()
  const right = new THREE.Group()
  left.position.set(493.6, 0.42, 2.4)
  right.position.set(493.6, 0.42, -2.4)
  const panel = new THREE.BoxGeometry(0.45, 6.2, 4.6)
  left.add(mesh(panel, FORERUNNER_DARK, 0, 3.1, 0))
  right.add(mesh(panel, FORERUNNER_DARK, 0, 3.1, 0))
  const seam = new THREE.MeshStandardMaterial({
    color: 0xd8fff8,
    emissive: 0x5ef6ff,
    emissiveIntensity: 1.4,
  })
  left.add(mesh(new THREE.BoxGeometry(0.5, 6.2, 0.08), seam, 0, 3.1, -2.25))
  right.add(mesh(new THREE.BoxGeometry(0.5, 6.2, 0.08), seam, 0, 3.1, 2.25))
  root.add(left, right)
  const before = colliders.length
  addCollider(colliders, 493.6, 3.52, 2.4, 0.7, 6.2, 4.6)
  addCollider(colliders, 493.6, 3.52, -2.4, 0.7, 6.2, 4.6)
  return { left, right, colliders: colliders.slice(before) }
}

function buildShade(root: THREE.Group): { group: THREE.Group; muzzle: THREE.Object3D; meshes: THREE.Object3D[] } {
  const y = haloHeight(SHADE_POST.x, SHADE_POST.z)
  const group = new THREE.Group()
  group.name = 'Shade'
  group.position.set(SHADE_POST.x, y, SHADE_POST.z)
  const purple = new THREE.MeshStandardMaterial({
    color: 0x4a2e6a,
    metalness: 0.55,
    roughness: 0.4,
    emissive: 0x2a1848,
    emissiveIntensity: 0.4,
  })
  const meshes: THREE.Object3D[] = []
  const tag = (m: THREE.Mesh) => {
    m.userData.enemyId = 'shade-alpha'
    m.castShadow = true
    meshes.push(m)
    return m
  }
  group.add(tag(mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.4, 8), purple, 0, 0.4, 0)))
  group.add(tag(mesh(new THREE.BoxGeometry(0.35, 1.1, 0.35), purple, 0, 1.05, 0)))
  const gun = tag(mesh(new THREE.BoxGeometry(0.45, 0.38, 1.5), purple, 0, 1.55, 0.4))
  group.add(gun)
  const muzzle = new THREE.Object3D()
  muzzle.position.set(0, 1.55, 1.2)
  group.add(muzzle)
  const glow = new THREE.MeshStandardMaterial({
    color: 0x9dffc8,
    emissive: 0x44ffaa,
    emissiveIntensity: 1.5,
  })
  group.add(mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), glow, 0, 1.55, 1.15))
  root.add(group)
  return { group, muzzle, meshes }
}

function buildPelican(root: THREE.Group): { group: THREE.Group; ramp: THREE.Group } {
  const y = haloHeight(PELICAN_PAD.x, PELICAN_PAD.z)
  const group = new THREE.Group()
  group.name = 'Pelican'
  group.position.set(PELICAN_PAD.x, y + 26, PELICAN_PAD.z)
  group.rotation.y = -Math.PI / 2
  const body = mesh(new THREE.BoxGeometry(2.8, 1.7, 6.4), OLIVE, 0, 1.3, 0.4)
  const belly = mesh(new THREE.BoxGeometry(2.4, 0.7, 4.2), OLIVE_DARK, 0, 0.45, 0)
  group.add(body, belly)
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9ad7e8,
    emissive: 0x206080,
    emissiveIntensity: 0.4,
    roughness: 0.15,
    metalness: 0.4,
    transparent: true,
    opacity: 0.8,
  })
  group.add(mesh(new THREE.BoxGeometry(1.6, 0.7, 1.1), glass, 0, 1.85, 2.8))
  // Nacelles
  group.add(mesh(new THREE.BoxGeometry(0.7, 0.7, 4.8), OLIVE_DARK, 1.8, 1.15, -0.2))
  group.add(mesh(new THREE.BoxGeometry(0.7, 0.7, 4.8), OLIVE_DARK, -1.8, 1.15, -0.2))
  const thrust = new THREE.MeshStandardMaterial({
    color: 0xffe2a8,
    emissive: 0xffaa44,
    emissiveIntensity: 1.2,
  })
  group.add(mesh(new THREE.BoxGeometry(0.45, 0.45, 0.2), thrust, 1.8, 1.15, -2.6))
  group.add(mesh(new THREE.BoxGeometry(0.45, 0.45, 0.2), thrust, -1.8, 1.15, -2.6))
  const ramp = new THREE.Group()
  ramp.position.set(0, 0.85, -2.5)
  ramp.rotation.x = -0.2
  const panel = mesh(new THREE.BoxGeometry(2.15, 0.12, 2.5), OLIVE, 0, -0.15, -1.2)
  ramp.add(panel)
  group.add(ramp)
  group.visible = true
  root.add(group)
  return { group, ramp }
}

function buildLzPad(root: THREE.Group): void {
  const y = 0.48
  const pad = mesh(
    new THREE.BoxGeometry(16, 0.12, 16),
    createUnscMatte({ color: 0x4a5148 }),
    PELICAN_PAD.x - 4,
    y,
    0,
  )
  pad.receiveShadow = true
  root.add(pad)
  const paint = new THREE.MeshStandardMaterial({ color: 0xd7c48a, roughness: 0.7 })
  root.add(mesh(new THREE.BoxGeometry(8, 0.04, 0.25), paint, PELICAN_PAD.x - 4, y + 0.1, 0))
  root.add(mesh(new THREE.BoxGeometry(0.25, 0.04, 8), paint, PELICAN_PAD.x - 4, y + 0.1, 0))
}

function buildValleyWalls(colliders: AABB[]): void {
  addCollider(colliders, 300, 16, 46, 1100, 32, 3)
  addCollider(colliders, 300, 16, -46, 1100, 32, 3)
  addCollider(colliders, -12, 12, 0, 3, 24, 40)
  addCollider(colliders, 748, 10, 0, 3, 20, 60)
}

function buildPickups(root: THREE.Group, pickups: WorldPickup[]): void {
  for (const def of PICKUPS) {
    const y = haloHeight(def.x, def.z)
    const meshGroup = makePickupMesh(def)
    meshGroup.position.set(def.x, y + 0.75, def.z)
    root.add(meshGroup)
    pickups.push({
      def,
      mesh: meshGroup,
      baseY: y + 0.75,
      phase: def.x * 0.1,
      taken: false,
      cooldown: 0,
    })
  }
}

function makePickupMesh(def: PickupDef): THREE.Group {
  const g = new THREE.Group()
  if (def.kind === 'weapon') {
    const covenant = def.weapon === 'plasma' || def.weapon === 'prifle'
    const mat = new THREE.MeshStandardMaterial({
      color: covenant ? 0x163028 : 0x3a4038,
      emissive: covenant ? 0x39ff9a : 0xd4a24a,
      emissiveIntensity: covenant ? 0.7 : 0.35,
      metalness: 0.5,
      roughness: 0.4,
    })
    const length = def.weapon === 'ar' || def.weapon === 'prifle' ? 0.85 : 0.48
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.16, length), mat, 0, 0, 0))
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), mat, 0, -0.14, 0.1))
  } else if (def.kind === 'health') {
    const box = mesh(
      new THREE.BoxGeometry(0.42, 0.28, 0.32),
      new THREE.MeshStandardMaterial({ color: 0xe8f2ea, roughness: 0.45, metalness: 0.1 }),
      0,
      0,
      0,
    )
    const cross = new THREE.MeshStandardMaterial({
      color: 0x2dff6a,
      emissive: 0x14ff64,
      emissiveIntensity: 1.4,
    })
    g.add(box)
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.06, 0.08), cross, 0, 0.16, 0))
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.06, 0.22), cross, 0, 0.16, 0))
  } else if (def.kind === 'grenades') {
    const frag = new THREE.MeshStandardMaterial({ color: 0x556043, roughness: 0.7, metalness: 0.2 })
    g.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), frag, -0.12, 0, 0))
    g.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), frag, 0.12, 0, 0))
  } else {
    g.add(
      mesh(
        new THREE.BoxGeometry(0.46, 0.28, 0.34),
        new THREE.MeshStandardMaterial({
          color: 0x8a7040,
          emissive: 0xc4964a,
          emissiveIntensity: 0.25,
          roughness: 0.55,
        }),
        0,
        0,
        0,
      ),
    )
  }
  return g
}

function buildDeadMarine(root: THREE.Group): void {
  const x = 72
  const z = -1.6
  const y = haloHeight(x, z)
  const g = new THREE.Group()
  g.position.set(x, y + 0.28, z)
  g.rotation.y = 0.6
  g.rotation.z = Math.PI * 0.46
  const mat = createUnscMatte({ color: 0x445038 })
  g.add(mesh(new THREE.BoxGeometry(0.55, 0.7, 0.32), mat, 0, 0.2, 0))
  g.add(mesh(new THREE.BoxGeometry(0.28, 0.28, 0.3), OLIVE_DARK, 0, 0.7, 0.05))
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.7, 0.16), mat, 0.2, -0.2, 0))
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.7, 0.16), mat, -0.2, -0.2, 0.05))
  root.add(g)
}

function addWall(
  root: THREE.Group,
  colliders: AABB[],
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
): void {
  const m = mesh(new THREE.BoxGeometry(w, h, d), FORERUNNER, x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  root.add(m)
  addCollider(colliders, x, y, z, w, h, d)
}

function mesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  return m
}

function addCollider(
  colliders: AABB[],
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
): void {
  colliders.push({
    min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
    max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
  })
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
