import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * CC0 Poly Haven surfaces and props. Paths are relative to the Vite base
 * so GitHub Pages project sites resolve them.
 */
const BASE = import.meta.env.BASE_URL

export interface TextureSet {
  map: THREE.Texture
  normal: THREE.Texture
  rough: THREE.Texture
}

export interface InstancedTemplate {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

export interface RingfallAssets {
  envMap: THREE.Texture
  grass: TextureSet
  dirt: TextureSet
  rock: TextureSet
  sand: TextureSet
  forerunner: TextureSet
  concrete: TextureSet
  unsc: TextureSet
  rockLarge: InstancedTemplate
  rockFlat: InstancedTemplate
  grassTuft: InstancedTemplate
  fern: InstancedTemplate
  shrub: InstancedTemplate
  treeTrunk: InstancedTemplate
  treeLeaf: InstancedTemplate
  crate: THREE.Object3D
  ammoBox: THREE.Object3D
  medicalBox: THREE.Object3D
}

function assetUrl(path: string): string {
  const base = BASE.endsWith('/') ? BASE : `${BASE}/`
  return `${base}${path}`
}

function configureTexture(tex: THREE.Texture, color: boolean, anisotropy: number): THREE.Texture {
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = anisotropy
  tex.needsUpdate = true
  return tex
}

async function loadTextureSet(
  loader: THREE.TextureLoader,
  folder: string,
  anisotropy: number,
): Promise<TextureSet> {
  const root = assetUrl(`assets/textures/${folder}`)
  const [map, normal, rough] = await Promise.all([
    loader.loadAsync(`${root}/Diffuse.jpg`),
    loader.loadAsync(`${root}/nor_gl.jpg`),
    loader.loadAsync(`${root}/Rough.jpg`),
  ])
  return {
    map: configureTexture(map, true, anisotropy),
    normal: configureTexture(normal, false, anisotropy),
    rough: configureTexture(rough, false, anisotropy),
  }
}

function bakeMesh(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry
  const geo = new THREE.BufferGeometry()
  const position = src.getAttribute('position')
  if (!position) return geo
  geo.setAttribute('position', position.clone())
  const normal = src.getAttribute('normal')
  if (normal) geo.setAttribute('normal', normal.clone())
  const uv = src.getAttribute('uv')
  if (uv) geo.setAttribute('uv', uv.clone())
  if (src.index) geo.setIndex(src.index.clone())
  geo.applyMatrix4(mesh.matrixWorld)
  if (!geo.getAttribute('normal')) geo.computeVertexNormals()
  return geo
}

function mergedTemplate(
  root: THREE.Object3D,
  foliage: boolean,
  anisotropy: number,
): InstancedTemplate | null {
  root.updateMatrixWorld(true)
  const groups = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>()
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    if (!source) return
    const key = source.uuid
    let group = groups.get(key)
    if (!group) {
      const material = source.clone()
      prepareMaterial(material, foliage, anisotropy)
      group = { material, geos: [] }
      groups.set(key, group)
    }
    group.geos.push(bakeMesh(mesh))
  })
  const first = groups.values().next().value as
    | { material: THREE.Material; geos: THREE.BufferGeometry[] }
    | undefined
  if (!first || first.geos.length === 0) return null
  const merged = first.geos.length === 1 ? first.geos[0]! : mergeGeometries(first.geos, false)
  if (!merged) return null
  if (first.geos.length > 1) {
    for (const geo of first.geos) geo.dispose()
  }
  normalizeToUnitHeight(merged)
  return { geometry: merged, material: first.material }
}

function splitTemplates(
  root: THREE.Object3D,
  anisotropy: number,
): InstancedTemplate[] {
  root.updateMatrixWorld(true)
  const groups = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>()
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    if (!source) return
    const standard = source as THREE.MeshStandardMaterial
    const foliage = standard.transparent || standard.alphaTest > 0 || standard.opacity < 1
    let group = groups.get(source.uuid)
    if (!group) {
      const material = source.clone()
      prepareMaterial(material, foliage, anisotropy)
      group = { material, geos: [] }
      groups.set(source.uuid, group)
    }
    group.geos.push(bakeMesh(mesh))
  })
  const templates: InstancedTemplate[] = []
  for (const group of groups.values()) {
    const merged = group.geos.length === 1 ? group.geos[0]! : mergeGeometries(group.geos, false)
    if (!merged) continue
    if (group.geos.length > 1) {
      for (const geo of group.geos) geo.dispose()
    }
    templates.push({ geometry: merged, material: group.material })
  }
  // Share one ground-aligned scale so trunk and leaves stay registered.
  const box = new THREE.Box3()
  for (const template of templates) {
    template.geometry.computeBoundingBox()
    if (template.geometry.boundingBox) box.union(template.geometry.boundingBox)
  }
  const height = Math.max(0.001, box.max.y - box.min.y)
  const cx = (box.min.x + box.max.x) * 0.5
  const cz = (box.min.z + box.max.z) * 0.5
  for (const template of templates) {
    template.geometry.translate(-cx, -box.min.y, -cz)
    template.geometry.scale(1 / height, 1 / height, 1 / height)
    template.geometry.computeBoundingSphere()
  }
  return templates
}

function normalizeToUnitHeight(geo: THREE.BufferGeometry): void {
  geo.computeBoundingBox()
  const box = geo.boundingBox
  if (!box) return
  const height = Math.max(0.001, box.max.y - box.min.y)
  const cx = (box.min.x + box.max.x) * 0.5
  const cz = (box.min.z + box.max.z) * 0.5
  geo.translate(-cx, -box.min.y, -cz)
  geo.scale(1 / height, 1 / height, 1 / height)
  geo.computeBoundingSphere()
}

function prepareMaterial(material: THREE.Material, foliage: boolean, anisotropy: number): void {
  const mat = material as THREE.MeshStandardMaterial
  mat.envMapIntensity = foliage ? 0.35 : 0.85
  const maps = [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap, mat.emissiveMap]
  for (const tex of maps) {
    if (!tex) continue
    tex.anisotropy = anisotropy
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.needsUpdate = true
  }
  if (foliage) {
    mat.transparent = false
    mat.alphaTest = 0.28
    mat.depthWrite = true
    mat.side = THREE.DoubleSide
    mat.forceSinglePass = true
  } else {
    mat.side = THREE.FrontSide
  }
  mat.needsUpdate = true
}

function frameObject(root: THREE.Object3D): THREE.Object3D {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const pivot = new THREE.Group()
  root.position.set(
    -((box.min.x + box.max.x) * 0.5),
    -box.min.y,
    -((box.min.z + box.max.z) * 0.5),
  )
  pivot.add(root)
  pivot.userData.height = Math.max(0.001, size.y)
  pivot.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    const mat = mesh.material
    const list = Array.isArray(mat) ? mat : [mat]
    for (const entry of list) prepareMaterial(entry, false, 8)
  })
  return pivot
}

/** Paint a shared standard material with a tiled CC0 PBR set. */
export function dressStandard(
  mat: THREE.MeshStandardMaterial,
  set: TextureSet,
  opts: {
    color?: number
    metalness?: number
    roughness?: number
    envMapIntensity?: number
    emissiveIntensity?: number
    normalScale?: number
    useRoughnessMap?: boolean
  } = {},
): void {
  mat.map = set.map
  mat.normalMap = set.normal
  mat.roughnessMap = opts.useRoughnessMap === false ? null : set.rough
  if (opts.color !== undefined) mat.color.setHex(opts.color)
  if (opts.metalness !== undefined) mat.metalness = opts.metalness
  if (opts.roughness !== undefined) mat.roughness = opts.roughness
  if (opts.envMapIntensity !== undefined) mat.envMapIntensity = opts.envMapIntensity
  if (opts.emissiveIntensity !== undefined) mat.emissiveIntensity = opts.emissiveIntensity
  const scale = opts.normalScale ?? 1
  mat.normalScale.set(scale, scale)
  mat.needsUpdate = true
}

export async function loadRingfallAssets(renderer: THREE.WebGLRenderer): Promise<RingfallAssets> {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const textures = new THREE.TextureLoader()
  const gltfLoader = new GLTFLoader()
  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()

  const hdr = await new HDRLoader().loadAsync(
    assetUrl('assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr'),
  )
  const envMap = pmrem.fromEquirectangular(hdr).texture
  hdr.dispose()
  pmrem.dispose()

  const [grass, dirt, rock, sand, forerunner, concrete, unsc] = await Promise.all([
    loadTextureSet(textures, 'forrest_ground_01', anisotropy),
    loadTextureSet(textures, 'brown_mud_dry', anisotropy),
    loadTextureSet(textures, 'rock_ground', anisotropy),
    loadTextureSet(textures, 'coast_sand_01', anisotropy),
    loadTextureSet(textures, 'blue_metal_plate', anisotropy),
    loadTextureSet(textures, 'concrete_panels', anisotropy),
    loadTextureSet(textures, 'metal_plate', anisotropy),
  ])

  const loadGltf = async (name: string) => {
    const gltf = await gltfLoader.loadAsync(assetUrl(`assets/models/${name}/${name}.gltf`))
    return gltf.scene
  }

  const [rockLargeScene, rockFlatScene, grassScene, fernScene, shrubScene, treeScene, crateScene, ammoScene, medicalScene] =
    await Promise.all([
      loadGltf('rock_07'),
      loadGltf('rock_09'),
      loadGltf('grass_medium_02'),
      loadGltf('fern_02'),
      loadGltf('shrub_03'),
      loadGltf('quiver_tree_01'),
      loadGltf('old_military_crate'),
      loadGltf('ammo_box'),
      loadGltf('medical_box'),
    ])

  const rockLarge = mergedTemplate(rockLargeScene, false, anisotropy)
  const rockFlat = mergedTemplate(rockFlatScene, false, anisotropy)
  const grassTuft = mergedTemplate(grassScene, true, anisotropy)
  const fern = mergedTemplate(fernScene, true, anisotropy)
  const shrub = mergedTemplate(shrubScene, true, anisotropy)
  const treeParts = splitTemplates(treeScene, anisotropy)
  if (!rockLarge || !rockFlat || !grassTuft || !fern || !shrub || treeParts.length < 2) {
    throw new Error('Ringfall prop library failed to build')
  }
  const treeLeaf = treeParts.find((part) => {
    const mat = part.material as THREE.MeshStandardMaterial
    return mat.alphaTest > 0 || mat.transparent
  })
  const treeTrunk = treeParts.find((part) => part !== treeLeaf) ?? treeParts[0]
  if (!treeTrunk || !treeLeaf) throw new Error('Ringfall tree materials missing')

  return {
    envMap,
    grass,
    dirt,
    rock,
    sand,
    forerunner,
    concrete,
    unsc,
    rockLarge,
    rockFlat,
    grassTuft,
    fern,
    shrub,
    treeTrunk,
    treeLeaf,
    crate: frameObject(crateScene),
    ammoBox: frameObject(ammoScene),
    medicalBox: frameObject(medicalScene),
  }
}
