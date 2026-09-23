import * as THREE from 'three'
import type { AABB } from '../world/Environment'
import { createUnscMatte } from '../rendering/Materials'
import { driveSurface } from '../world/HaloMissionWorld'
import type { MoveState } from '../player/PlayerController'

const OLIVE = createUnscMatte({ color: 0x3c4a30 })
const DARK = createUnscMatte({ color: 0x1c2118 })
const GUN = createUnscMatte({ color: 0x2a3030 })

/**
 * M12 Warthog. Nose is local +Z. A/D steer, W/S throttle.
 * The chain-gun turret is a child the campaign can aim.
 */
export class Warthog {
  readonly group = new THREE.Group()
  readonly turret = new THREE.Group()
  readonly muzzle = new THREE.Object3D()
  yaw = 0
  drive = 0
  private verticalVel = 0
  private readonly forward = new THREE.Vector3()
  private readonly scratch = new THREE.Vector3()

  constructor(parent: THREE.Object3D, position: THREE.Vector3, yaw: number) {
    this.yaw = yaw
    this.group.name = 'Warthog'
    this.group.position.copy(position)
    this.group.position.y = driveSurface(position.x, position.z) + 0.62
    this.buildMesh()
    parent.add(this.group)
    this.syncRotation(0, 0)
  }

  seatWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.group.localToWorld(out.set(0.42, 1.05, 0.15))
  }

  gunnerEye(out: THREE.Vector3): THREE.Vector3 {
    return this.turret.localToWorld(out.set(0, 0.62, -0.4))
  }

  gunWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out)
  }

  forwardWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, Math.cos(this.yaw))
  }

  teleport(x: number, z: number, yaw: number): void {
    this.yaw = yaw
    this.drive = 0
    this.verticalVel = 0
    this.group.position.set(x, driveSurface(x, z) + 0.62, z)
    this.syncRotation(0, 0)
  }

  /**
   * @param gunYaw world yaw for the turret while a player is on the gun. Null = leave it.
   */
  update(dt: number, keys: MoveState, colliders: readonly AABB[], gunYaw: number | null): void {
    const throttle = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0)
    const steer = (keys.left ? 1 : 0) - (keys.right ? 1 : 0)
    const speedAbs = Math.abs(this.drive)
    const steerRate = steer * (1.15 + Math.min(speedAbs, 16) * 0.075) * (this.drive < -0.4 ? -1 : 1)
    this.yaw += steerRate * dt

    const accel = throttle * 26
    this.drive += accel * dt
    if (throttle === 0) {
      const sign = Math.sign(this.drive)
      const mag = Math.max(0, Math.abs(this.drive) - 18 * dt)
      this.drive = sign * mag
    }
    this.drive = THREE.MathUtils.clamp(this.drive, -9, 20)

    this.forward.set(-Math.sin(this.yaw), 0, Math.cos(this.yaw))
    const aheadX = this.group.position.x + this.forward.x * 2.1
    const aheadZ = this.group.position.z + this.forward.z * 2.1
    const here = driveSurface(this.group.position.x, this.group.position.z)
    const ahead = driveSurface(aheadX, aheadZ)
    if (ahead > here + 1.25 && this.drive > 0) this.drive = 0
    if (ahead < here - 1.25 && this.drive < 0) this.drive = 0

    this.group.position.x += this.forward.x * this.drive * dt
    this.group.position.z += this.forward.z * this.drive * dt
    this.resolveColliders(colliders)

    const surface = driveSurface(this.group.position.x, this.group.position.z)
    const ride = surface + 0.62
    if (ride < this.group.position.y - 0.35) {
      this.verticalVel -= 22 * dt
      this.group.position.y += this.verticalVel * dt
      if (this.group.position.y < ride) {
        this.group.position.y = ride
        this.verticalVel = 0
      }
    } else {
      this.verticalVel = 0
      this.group.position.y = ride
    }

    const yL = driveSurface(
      this.group.position.x + Math.cos(this.yaw) * 0.8,
      this.group.position.z - Math.sin(this.yaw) * 0.8,
    )
    const yR = driveSurface(
      this.group.position.x - Math.cos(this.yaw) * 0.8,
      this.group.position.z + Math.sin(this.yaw) * 0.8,
    )
    const yF = ahead
    const yB = driveSurface(
      this.group.position.x - this.forward.x * 1.8,
      this.group.position.z - this.forward.z * 1.8,
    )
    const pitch = Math.atan2(yF - yB, 3.6)
    const roll = Math.atan2(yL - yR, 1.6)
    this.syncRotation(pitch, -roll)

    if (gunYaw !== null) {
      let rel = gunYaw - this.yaw
      while (rel > Math.PI) rel -= Math.PI * 2
      while (rel < -Math.PI) rel += Math.PI * 2
      this.turret.rotation.y = THREE.MathUtils.damp(this.turret.rotation.y, rel, 10, dt)
    }
  }

  aimTurretAt(worldPoint: THREE.Vector3, dt: number): void {
    this.scratch.copy(worldPoint).sub(this.group.position)
    this.scratch.y = 0
    if (this.scratch.lengthSq() < 0.01) return
    const worldYaw = Math.atan2(this.scratch.x, this.scratch.z)
    let rel = worldYaw + this.yaw
    while (rel > Math.PI) rel -= Math.PI * 2
    while (rel < -Math.PI) rel += Math.PI * 2
    this.turret.rotation.y = THREE.MathUtils.damp(this.turret.rotation.y, rel, 7, dt)
  }

  private syncRotation(pitch: number, roll: number): void {
    this.group.rotation.order = 'YXZ'
    // Nose is local +Z. Drive direction is (-sin yaw, cos yaw), which is rotation.y = -yaw.
    this.group.rotation.y = -this.yaw
    this.group.rotation.x = THREE.MathUtils.clamp(pitch, -0.35, 0.35)
    this.group.rotation.z = THREE.MathUtils.clamp(roll, -0.3, 0.3)
  }

  private resolveColliders(colliders: readonly AABB[]): void {
    const px = this.group.position.x
    const pz = this.group.position.z
    const py = this.group.position.y + 0.35
    const radius = 1.15
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i]!
      if (py + 0.8 < c.min.y || py - 0.4 > c.max.y) continue
      const cx = THREE.MathUtils.clamp(px, c.min.x, c.max.x)
      const cz = THREE.MathUtils.clamp(pz, c.min.z, c.max.z)
      const dx = px - cx
      const dz = pz - cz
      const d2 = dx * dx + dz * dz
      if (d2 > radius * radius || d2 < 1e-8) continue
      const d = Math.sqrt(d2)
      const push = (radius - d) / d
      this.group.position.x += dx * push
      this.group.position.z += dz * push
      this.drive *= 0.45
    }
  }

  private buildMesh(): void {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.42, 4.15), OLIVE)
    body.position.set(0, 0.72, 0)
    body.castShadow = true
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 1.3), OLIVE)
    hood.position.set(0, 0.95, 1.15)
    hood.rotation.x = -0.18
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.55, 1.15), DARK)
    cab.position.set(0, 1.05, 0.15)
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.22, 1.5), DARK)
    bed.position.set(0, 0.78, -1.25)
    this.group.add(body, hood, cab, bed)

    const glass = new THREE.MeshStandardMaterial({
      color: 0xb7e4ef,
      transparent: true,
      opacity: 0.45,
      roughness: 0.05,
      metalness: 0.2,
    })
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 0.06), glass)
    windshield.position.set(0, 1.28, 0.72)
    windshield.rotation.x = 0.35
    this.group.add(windshield)

    const tire = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 8)
    for (const [x, z] of [
      [0.85, 1.25],
      [-0.85, 1.25],
      [0.85, -1.25],
      [-0.85, -1.25],
    ] as const) {
      const w = new THREE.Mesh(tire, DARK)
      w.rotation.z = Math.PI / 2
      w.position.set(x, 0.38, z)
      w.castShadow = true
      this.group.add(w)
    }

    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), GUN)
    for (const x of [-0.7, 0.7]) {
      const b = bar.clone()
      b.position.set(x, 1.35, -0.55)
      this.group.add(b)
    }
    const cage = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.08), GUN)
    cage.position.set(0, 1.68, -0.55)
    this.group.add(cage)

    this.turret.position.set(0, 1.15, -1.15)
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.2, 8), GUN)
    mount.position.y = 0.1
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.9), GUN)
    receiver.position.set(0, 0.32, 0.35)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.8, 6), GUN)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.32, 0.95)
    this.muzzle.position.set(0, 0.32, 1.35)
    this.turret.add(mount, receiver, barrel, this.muzzle)
    this.group.add(this.turret)

    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff1c4,
      emissive: 0xffcc77,
      emissiveIntensity: 0.8,
    })
    for (const x of [-0.55, 0.55]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.08), lampMat)
      lamp.position.set(x, 0.78, 2.05)
      this.group.add(lamp)
    }
  }
}
