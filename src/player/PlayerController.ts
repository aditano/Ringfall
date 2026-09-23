import * as THREE from 'three'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'
import type { AABB } from '../world/Environment'

export type MoveState = {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  jump: boolean
  sprint: boolean
  crouch: boolean
}

const EYE_HEIGHT = 1.7
const CROUCH_HEIGHT = 1.05
const RADIUS = 0.35
const WALK = 7.2
const SPRINT = 11.5
const CROUCH_MUL = 0.55
const GRAVITY = 22
const JUMP_VEL = 8.2
const GROUND_ACCEL = 28
const AIR_ACCEL = 8.5
const COYOTE_TIME = 0.12
const JUMP_BUFFER = 0.15

/**
 * Halo-feel FPS locomotion: PointerLock look, sprint/crouch/jump with coyote +
 * buffer, floaty air control, grounded friction, AABB world collision.
 */
export class PlayerController {
  readonly controls: PointerLockControls
  readonly velocity = new THREE.Vector3()
  readonly position = new THREE.Vector3()
  readonly keys: MoveState = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    crouch: false,
  }

  grounded = false
  eyeHeight = EYE_HEIGHT

  private coyote = 0
  private jumpBuffer = 0
  private readonly wish = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly worldUp = new THREE.Vector3(0, 1, 0)
  private readonly planar = new THREE.Vector3()
  private readonly accelVec = new THREE.Vector3()
  private colliders: AABB[] = []
  private groundSampler?: (x: number, z: number) => number
  private readonly colliderScratch: AABB[] = []
  private bounds = { minX: -85, maxX: 85, minZ: -85, maxZ: 85 }
  private unlockCb?: () => void
  private hadLock = false
  private readonly onLock: () => void
  private readonly onKeyDown: (e: KeyboardEvent) => void
  private readonly onKeyUp: (e: KeyboardEvent) => void
  private readonly onUnlock: () => void

  constructor(camera: THREE.Camera, domElement: HTMLElement) {
    this.controls = new PointerLockControls(camera, domElement)
    this.position.set(0, EYE_HEIGHT, 8)
    camera.position.copy(this.position)

    this.onKeyDown = (e) => this.setKey(e.code, true, e)
    this.onKeyUp = (e) => this.setKey(e.code, false, e)
    this.onUnlock = () => {
      if (this.hadLock) this.unlockCb?.()
      this.hadLock = false
    }
    this.onLock = () => {
      this.hadLock = true
    }

    document.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('keyup', this.onKeyUp)
    this.controls.addEventListener('unlock', this.onUnlock)
    this.controls.addEventListener('lock', this.onLock)
  }

  setColliders(colliders: AABB[]): void {
    this.colliders = colliders
  }

  setGroundSampler(fn: (x: number, z: number) => number): void {
    this.groundSampler = fn
  }

  setWorldBounds(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.bounds = { minX, maxX, minZ, maxZ }
  }

  resetTo(position: THREE.Vector3, yaw = 0): void {
    this.position.copy(position)
    this.velocity.set(0, 0, 0)
    this.grounded = false
    this.coyote = 0
    this.jumpBuffer = 0
    this.eyeHeight = EYE_HEIGHT
    this.keys.forward = false
    this.keys.back = false
    this.keys.left = false
    this.keys.right = false
    this.keys.jump = false
    this.keys.sprint = false
    this.keys.crouch = false
    this.hadLock = false
    const cam = this.controls.object
    cam.position.copy(position)
    cam.rotation.set(0, yaw, 0)
  }

  lock(): void {
    this.controls.lock()
  }

  get locked(): boolean {
    return this.controls.isLocked
  }

  onPointerUnlock(cb: () => void): void {
    this.unlockCb = cb
  }

  getLookDirection(out = new THREE.Vector3()): THREE.Vector3 {
    return this.controls.object.getWorldDirection(out)
  }

  getDirection(out = new THREE.Vector3()): THREE.Vector3 {
    return this.getLookDirection(out)
  }

  getPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.position)
  }

  getVelocity(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.velocity)
  }

  getCamera(): THREE.Object3D {
    return this.controls.object
  }

  getHorizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z)
  }

  isSprinting(): boolean {
    return this.keys.sprint && !this.keys.crouch && this.grounded && this.getHorizontalSpeed() > 0.5
  }

  isCrouching(): boolean {
    return this.keys.crouch || this.eyeHeight < (EYE_HEIGHT + CROUCH_HEIGHT) * 0.5
  }

  update(dt: number): void {
    const cam = this.controls.object
    const targetEye = this.keys.crouch ? CROUCH_HEIGHT : EYE_HEIGHT
    this.eyeHeight = THREE.MathUtils.damp(this.eyeHeight, targetEye, 12, dt)

    this.coyote = this.grounded ? COYOTE_TIME : Math.max(0, this.coyote - dt)
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt)

    cam.getWorldDirection(this.forward)
    this.forward.y = 0
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1)
    else this.forward.normalize()
    this.right.crossVectors(this.forward, this.worldUp).normalize()

    this.wish.set(0, 0, 0)
    if (this.keys.forward) this.wish.add(this.forward)
    if (this.keys.back) this.wish.sub(this.forward)
    if (this.keys.right) this.wish.add(this.right)
    if (this.keys.left) this.wish.sub(this.right)
    const hasWish = this.wish.lengthSq() > 1e-6
    if (hasWish) this.wish.normalize()

    const crouchMul = this.keys.crouch ? CROUCH_MUL : 1
    const speed = (this.keys.sprint && !this.keys.crouch ? SPRINT : WALK) * crouchMul
    const accel = this.grounded ? GROUND_ACCEL : AIR_ACCEL
    const maxSpeed = this.grounded ? speed : speed * 1.05

    this.planar.set(this.velocity.x, 0, this.velocity.z)
    if (hasWish) {
      this.accelVec.copy(this.wish).multiplyScalar(maxSpeed).sub(this.planar)
      const gap = this.accelVec.length()
      if (gap > 1e-6) {
        const step = Math.min(accel * dt * (this.grounded ? 1 : 0.85), gap)
        this.accelVec.multiplyScalar(step / gap)
        this.velocity.x += this.accelVec.x
        this.velocity.z += this.accelVec.z
      }
    }

    if (this.grounded) {
      // Soft Halo momentum — stronger friction with no input, lighter while strafing.
      const friction = hasWish ? 5.5 : 11
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, 0, friction, dt)
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, 0, friction, dt)
      if (!hasWish && Math.hypot(this.velocity.x, this.velocity.z) < 0.04) {
        this.velocity.x = 0
        this.velocity.z = 0
      }
    }

    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocity.y = JUMP_VEL
      this.grounded = false
      this.coyote = 0
      this.jumpBuffer = 0
    }

    this.velocity.y -= GRAVITY * dt
    this.velocity.y = Math.max(this.velocity.y, -40)

    this.moveWithCollision(dt)
    cam.position.set(this.position.x, this.position.y, this.position.z)
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('keyup', this.onKeyUp)
    this.controls.removeEventListener('unlock', this.onUnlock)
    this.controls.removeEventListener('lock', this.onLock)
    this.controls.unlock()
    this.controls.dispose()
  }

  private setKey(code: string, pressed: boolean, e: KeyboardEvent): void {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = pressed
        break
      case 'KeyS':
      case 'ArrowDown':
        this.keys.back = pressed
        break
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = pressed
        break
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = pressed
        break
      case 'Space':
        this.keys.jump = pressed
        if (pressed) this.jumpBuffer = JUMP_BUFFER
        e.preventDefault()
        break
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.sprint = pressed
        break
      case 'ControlLeft':
      case 'ControlRight':
      case 'KeyC':
        this.keys.crouch = pressed
        break
    }
  }

  private moveWithCollision(dt: number): void {
    this.position.x += this.velocity.x * dt
    this.resolveAxis('x')
    this.position.z += this.velocity.z * dt
    this.resolveAxis('z')
    this.position.y += this.velocity.y * dt
    this.grounded = false
    this.resolveAxis('y')

    this.position.x = THREE.MathUtils.clamp(this.position.x, this.bounds.minX, this.bounds.maxX)
    this.position.z = THREE.MathUtils.clamp(this.position.z, this.bounds.minZ, this.bounds.maxZ)
  }

  private resolveAxis(axis: 'x' | 'y' | 'z'): void {
    const feet = this.position.y - this.eyeHeight
    const head = this.position.y + 0.15
    const px = this.position.x
    const pz = this.position.z
    const horizRange = axis === 'y' ? 0 : 6.5

    this.colliderScratch.length = 0
    for (const c of this.colliders) {
      if (horizRange > 0) {
        if (px + horizRange < c.min.x || px - horizRange > c.max.x) continue
        if (pz + horizRange < c.min.z || pz - horizRange > c.max.z) continue
      }
      this.colliderScratch.push(c)
    }

    for (const c of this.colliderScratch) {
      const isGround = c.max.y <= 0.1 && c.min.y < 0
      if (isGround && axis !== 'y') continue

      const overlapX = px + RADIUS > c.min.x && px - RADIUS < c.max.x
      const overlapZ = pz + RADIUS > c.min.z && pz - RADIUS < c.max.z
      const overlapY = head > c.min.y && feet < c.max.y
      if (!(overlapX && overlapZ && overlapY)) continue

      // Low slabs (the light bridge, rocks) are floors, not walls.
      if (axis !== 'y' && c.max.y <= feet + 0.5) continue

      if (axis === 'x') {
        const pushL = c.min.x - (px + RADIUS)
        const pushR = c.max.x - (px - RADIUS)
        this.position.x += Math.abs(pushL) < Math.abs(pushR) ? pushL : pushR
        this.velocity.x = 0
      } else if (axis === 'z') {
        const pushL = c.min.z - (pz + RADIUS)
        const pushR = c.max.z - (pz - RADIUS)
        this.position.z += Math.abs(pushL) < Math.abs(pushR) ? pushL : pushR
        this.velocity.z = 0
      } else if (this.velocity.y <= 0 && feet < c.max.y && this.position.y - this.eyeHeight + 0.45 > c.max.y) {
        this.position.y = c.max.y + this.eyeHeight
        this.velocity.y = 0
        this.grounded = true
      } else if (this.velocity.y > 0 && head > c.min.y) {
        this.position.y = c.min.y - 0.15
        this.velocity.y = 0
      } else if (feet < c.max.y && head > c.max.y && this.velocity.y <= 0) {
        this.position.y = c.max.y + this.eyeHeight
        this.velocity.y = 0
        this.grounded = true
      }
    }

    const floor = this.groundSampler?.(this.position.x, this.position.z) ?? 0
    const minY = floor + this.eyeHeight + 0.05
    if (axis === 'y' && this.position.y < minY && this.velocity.y <= 0) {
      this.position.y = minY
      this.velocity.y = 0
      this.grounded = true
    }
  }
}
