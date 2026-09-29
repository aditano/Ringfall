import * as THREE from 'three'

/** Project each triangle onto its dominant plane so box faces tile in meters. */
export function tileSurfaceUvs(geo: THREE.BufferGeometry, metersPerTile = 2.4): void {
  if (geo.userData.tiled === true) return
  if (!geo.getAttribute('normal')) geo.computeVertexNormals()
  const indexed = geo.index !== null
  const src = indexed ? geo.toNonIndexed() : geo
  const pos = src.getAttribute('position')
  const nrm = src.getAttribute('normal')
  if (!pos || !nrm) return
  let uv = src.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uv) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2)
    src.setAttribute('uv', uv)
  }
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  for (let i = 0; i < pos.count; i += 3) {
    n.fromBufferAttribute(nrm, i)
    const ax = Math.abs(n.x)
    const ay = Math.abs(n.y)
    const az = Math.abs(n.z)
    for (let k = 0; k < 3; k++) {
      p.fromBufferAttribute(pos, i + k)
      let u = p.x
      let v = p.z
      if (ay >= ax && ay >= az) {
        u = p.x
        v = p.z
      } else if (ax >= az) {
        u = p.z
        v = p.y
      } else {
        u = p.x
        v = p.y
      }
      uv.setXY(i + k, u / metersPerTile, v / metersPerTile)
    }
  }
  uv.needsUpdate = true
  if (indexed) {
    geo.copy(src)
    src.dispose()
  }
  geo.userData.tiled = true
}
