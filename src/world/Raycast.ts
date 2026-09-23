import type * as THREE from 'three'
import type { AABB } from './Environment'

export function raycastAABBs(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  boxes: readonly AABB[],
): number {
  let best = maxDist
  for (let i = 0; i < boxes.length; i++) {
    const t = rayAABB(origin, dir, boxes[i]!)
    if (t !== null && t > 0.02 && t < best) best = t
  }
  return best
}

export function pointInBoxes(p: THREE.Vector3, boxes: readonly AABB[], pad = 0): boolean {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!
    if (
      p.x >= b.min.x - pad &&
      p.x <= b.max.x + pad &&
      p.y >= b.min.y - pad &&
      p.y <= b.max.y + pad &&
      p.z >= b.min.z - pad &&
      p.z <= b.max.z + pad
    ) {
      return true
    }
  }
  return false
}

function rayAABB(
  o: THREE.Vector3,
  d: THREE.Vector3,
  box: AABB,
): number | null {
  let tmin = 0
  let tmax = Infinity
  const origin = [o.x, o.y, o.z]
  const dir = [d.x, d.y, d.z]
  const min = [box.min.x, box.min.y, box.min.z]
  const max = [box.max.x, box.max.y, box.max.z]
  for (let i = 0; i < 3; i++) {
    const di = dir[i]!
    const oi = origin[i]!
    if (Math.abs(di) < 1e-8) {
      if (oi < min[i]! || oi > max[i]!) return null
      continue
    }
    let t1 = (min[i]! - oi) / di
    let t2 = (max[i]! - oi) / di
    if (t1 > t2) {
      const swap = t1
      t1 = t2
      t2 = swap
    }
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }
  if (tmax < 0) return null
  return tmin >= 0 ? tmin : tmax
}
