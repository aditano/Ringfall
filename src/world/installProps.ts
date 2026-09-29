import * as THREE from 'three'
import type { RingfallAssets } from '../rendering/AssetLibrary'
import type { WorldPickup } from './HaloMissionWorld'

export interface ScatterItem {
  x: number
  z: number
  s: number
  yaw: number
}

export interface ScatterLayout {
  coverRocks: ScatterItem[]
  crates: ScatterItem[]
  rocks: ScatterItem[]
  trees: ScatterItem[]
  grass: ScatterItem[]
  ferns: ScatterItem[]
  shrubs: ScatterItem[]
}

const dummy = new THREE.Object3D()

function instances(
  template: { geometry: THREE.BufferGeometry; material: THREE.Material },
  items: ScatterItem[],
  heightFor: (item: ScatterItem) => number,
  groundAt: (x: number, z: number) => number,
  opts: { castShadow?: boolean; sink?: number } = {},
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(template.geometry, template.material, Math.max(1, items.length))
  mesh.count = items.length
  mesh.castShadow = opts.castShadow ?? false
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const height = heightFor(item)
    const y = groundAt(item.x, item.z) - height * (opts.sink ?? 0.02)
    dummy.position.set(item.x, y, item.z)
    dummy.rotation.set(0, item.yaw, 0)
    dummy.scale.setScalar(height)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

function placeProp(
  template: THREE.Object3D,
  item: ScatterItem,
  height: number,
  groundAt: (x: number, z: number) => number,
): THREE.Object3D {
  const obj = template.clone(true)
  const native = (template.userData.height as number) || 1
  const scale = height / native
  obj.scale.setScalar(scale)
  obj.position.set(item.x, groundAt(item.x, item.z), item.z)
  obj.rotation.y = item.yaw
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
  })
  return obj
}

function swapPickup(pickup: WorldPickup, template: THREE.Object3D, height: number): void {
  const native = (template.userData.height as number) || 1
  const scale = height / native
  while (pickup.mesh.children.length > 0) {
    const child = pickup.mesh.children[0]!
    pickup.mesh.remove(child)
  }
  const obj = template.clone(true)
  obj.scale.setScalar(scale)
  obj.position.y = -height * 0.35
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
  })
  pickup.mesh.add(obj)
}

/** Replace cone trees, dodecahedron rocks, and flat crates with CC0 props. */
export function installProps(
  root: THREE.Group,
  layout: ScatterLayout,
  assets: RingfallAssets,
  pickups: WorldPickup[],
  groundAt: (x: number, z: number) => number,
): void {
  const old = root.getObjectByName('PlaceholderScatter')
  if (old) {
    root.remove(old)
    old.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry && mesh.userData.disposeGeo) mesh.geometry.dispose()
    })
  }

  const props = new THREE.Group()
  props.name = 'CcProps'
  props.add(
    instances(assets.rockLarge, layout.coverRocks, (item) => item.s * 1.35, groundAt, { castShadow: true, sink: 0.08 }),
  )
  props.add(
    instances(assets.rockLarge, layout.rocks.filter((_, i) => i % 2 === 0), (item) => item.s * 1.15, groundAt, {
      castShadow: true,
      sink: 0.06,
    }),
  )
  props.add(
    instances(assets.rockFlat, layout.rocks.filter((_, i) => i % 2 === 1), (item) => item.s * 0.55, groundAt, {
      castShadow: false,
      sink: 0.04,
    }),
  )
  const trunk = instances(assets.treeTrunk, layout.trees, (item) => 8.5 + item.s * 4.5, groundAt, { castShadow: true })
  const leaf = instances(assets.treeLeaf, layout.trees, (item) => 8.5 + item.s * 4.5, groundAt, { castShadow: false })
  trunk.name = 'QuiverTrunks'
  leaf.name = 'QuiverLeaves'
  props.add(trunk, leaf)
  props.add(instances(assets.grassTuft, layout.grass, (item) => 0.85 + item.s * 0.55, groundAt, { sink: 0 }))
  props.add(instances(assets.fern, layout.ferns, (item) => 1.05 + item.s * 0.7, groundAt, { sink: 0 }))
  props.add(instances(assets.shrub, layout.shrubs, (item) => 1.35 + item.s * 0.8, groundAt, { castShadow: true, sink: 0.02 }))
  for (const crate of layout.crates) {
    props.add(placeProp(assets.crate, crate, crate.s * 0.95, groundAt))
  }
  root.add(props)

  for (const pickup of pickups) {
    if (pickup.def.kind === 'health') swapPickup(pickup, assets.medicalBox, 0.42)
    else if (pickup.def.kind === 'ammo') swapPickup(pickup, assets.ammoBox, 0.34)
  }

  const stream = root.getObjectByName('Stream') as THREE.Mesh | undefined
  if (stream) {
    const normal = assets.sand.normal.clone()
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping
    normal.repeat.set(6, 1.4)
    const mat = stream.material as THREE.MeshStandardMaterial
    mat.normalMap = normal
    mat.normalScale.set(0.35, 0.35)
    mat.roughness = 0.06
    mat.metalness = 0.04
    mat.envMapIntensity = 1.6
    mat.color.set(0x1a6d82)
    mat.needsUpdate = true
    stream.userData.waterNormal = normal
  }
}
