import * as THREE from 'three'

/**
 * Halo: Combat Evolved–inspired title backdrop:
 * starfield, planet, and a slowly orbiting ringworld in deep space.
 */
export class HaloCEMenuWorld {
  readonly root = new THREE.Group()
  private readonly ringPivot = new THREE.Group()
  private readonly stars: THREE.Points
  private readonly planet: THREE.Mesh
  private readonly rimLight: THREE.DirectionalLight
  private readonly fill: THREE.AmbientLight
  private readonly hemi: THREE.HemisphereLight
  private elapsed = 0
  private prevFog: THREE.Fog | THREE.FogExp2 | null = null
  private prevBackground: THREE.Color | THREE.Texture | null = null
  private active = false

  constructor(private scene: THREE.Scene) {
    this.root.name = 'HaloCEMenuWorld'
    this.root.visible = false

    // Deep space
    this.fill = new THREE.AmbientLight(0x1a2030, 0.35)
    this.root.add(this.fill)
    this.hemi = new THREE.HemisphereLight(0x2a4060, 0x050508, 0.4)
    this.root.add(this.hemi)
    this.rimLight = new THREE.DirectionalLight(0xa8c8ff, 1.4)
    this.rimLight.position.set(-40, 20, 30)
    this.root.add(this.rimLight)
    const key = new THREE.DirectionalLight(0xffe6c8, 0.55)
    key.position.set(30, 10, -20)
    this.root.add(key)

    this.stars = this.buildStars()
    this.root.add(this.stars)

    this.planet = this.buildPlanet()
    this.planet.position.set(-18, -6, -40)
    this.root.add(this.planet)

    this.ringPivot.add(this.buildRing())
    this.ringPivot.position.set(6, -2, -8)
    this.ringPivot.rotation.x = 0.55
    this.ringPivot.rotation.z = -0.25
    this.root.add(this.ringPivot)

    // Soft nebula planes
    for (let i = 0; i < 3; i++) {
      const neb = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 50),
        new THREE.MeshBasicMaterial({
          color: i % 2 ? 0x1a3048 : 0x2a1840,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          forceSinglePass: true,
        }),
      )
      neb.position.set((i - 1) * 25, (i - 1) * 8, -60 - i * 10)
      neb.rotation.z = i * 0.4
      this.root.add(neb)
    }

    scene.add(this.root)
  }

  show(): void {
    if (this.active) return
    this.active = true
    this.root.visible = true
    this.prevFog = (this.scene.fog as THREE.Fog | THREE.FogExp2 | null) ?? null
    this.prevBackground = this.scene.background as THREE.Color | THREE.Texture | null
    this.scene.fog = null
    this.scene.background = new THREE.Color(0x02040a)
  }

  hide(): void {
    if (!this.active) return
    this.active = false
    this.root.visible = false
    this.scene.fog = this.prevFog
    this.scene.background = this.prevBackground
  }

  get isActive() {
    return this.active
  }

  /** Slow heroic orbit — camera looks at the ring from a drifting vantage. */
  updateCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    this.elapsed += dt
    this.ringPivot.rotation.y += dt * 0.08
    this.planet.rotation.y += dt * 0.02
    this.stars.rotation.y += dt * 0.003

    const t = this.elapsed * 0.15
    const r = 22
    camera.position.set(
      Math.cos(t) * r * 0.55 + 4,
      4 + Math.sin(t * 0.6) * 1.2,
      14 + Math.sin(t * 0.4) * 2,
    )
    camera.lookAt(this.ringPivot.position.x, this.ringPivot.position.y + 1, this.ringPivot.position.z)
    const nextFov = THREE.MathUtils.damp(camera.fov, 48, 4, dt)
    if (Math.abs(camera.fov - nextFov) > 0.05) {
      camera.fov = nextFov
      camera.updateProjectionMatrix()
    }
  }

  dispose(): void {
    this.hide()
    this.scene.remove(this.root)
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = mesh.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else if (mat) (mat as THREE.Material).dispose()
    })
  }

  private buildStars(): THREE.Points {
    const count = 2500
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const r = 80 + Math.random() * 220
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      positions[i * 3 + 2] = r * Math.cos(phi)
      const c = 0.7 + Math.random() * 0.3
      colors[i * 3] = c
      colors[i * 3 + 1] = c * (0.9 + Math.random() * 0.1)
      colors[i * 3 + 2] = 1
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const mat = new THREE.PointsMaterial({
      size: 0.35,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      sizeAttenuation: true,
    })
    return new THREE.Points(geo, mat)
  }

  private buildPlanet(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(10, 48, 32)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const ctx = canvas.getContext('2d')!
    const grd = ctx.createLinearGradient(0, 0, 0, 256)
    grd.addColorStop(0, '#1a4060')
    grd.addColorStop(0.4, '#2a6a4a')
    grd.addColorStop(0.7, '#3a5080')
    grd.addColorStop(1, '#0a1828')
    ctx.fillStyle = grd
    ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.08})`
      ctx.beginPath()
      ctx.ellipse(Math.random() * 256, Math.random() * 256, 20 + Math.random() * 40, 8 + Math.random() * 16, Math.random(), 0, Math.PI * 2)
      ctx.fill()
    }
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.MeshStandardMaterial({
      map,
      roughness: 0.85,
      metalness: 0.05,
      emissive: 0x102030,
      emissiveIntensity: 0.15,
    })
    const mesh = new THREE.Mesh(geo, mat)
    // Atmosphere shell
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(10.35, 32, 24),
      new THREE.MeshBasicMaterial({
        color: 0x6ab0ff,
        transparent: true,
        opacity: 0.12,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    )
    mesh.add(atmo)
    return mesh
  }

  private buildRing(): THREE.Group {
    const g = new THREE.Group()
    // Main ring band
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(9, 0.55, 16, 128),
      new THREE.MeshStandardMaterial({
        color: 0x6a7a88,
        metalness: 0.55,
        roughness: 0.45,
        emissive: 0x1a3040,
        emissiveIntensity: 0.2,
      }),
    )
    torus.castShadow = false
    g.add(torus)

    // Inner livable surface suggestion (greener band)
    const inner = new THREE.Mesh(
      new THREE.TorusGeometry(9, 0.28, 12, 128),
      new THREE.MeshStandardMaterial({
        color: 0x3a6a48,
        metalness: 0.1,
        roughness: 0.8,
        emissive: 0x1a4028,
        emissiveIntensity: 0.25,
      }),
    )
    inner.scale.set(1, 1, 1.02)
    g.add(inner)

    // Segment plates around the ring
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.12, 0.8),
        new THREE.MeshStandardMaterial({
          color: i % 3 === 0 ? 0x8a9aaa : 0x4a5560,
          metalness: 0.7,
          roughness: 0.35,
          emissive: i % 5 === 0 ? 0x3de8ff : 0x000000,
          emissiveIntensity: i % 5 === 0 ? 0.35 : 0,
        }),
      )
      plate.position.set(Math.cos(a) * 9, 0, Math.sin(a) * 9)
      plate.lookAt(0, 0, 0)
      plate.rotateX(Math.PI / 2)
      g.add(plate)
    }

    // Subtle glow ring
    const glow = new THREE.Mesh(
      new THREE.TorusGeometry(9, 0.08, 8, 128),
      new THREE.MeshBasicMaterial({
        color: 0x7ec8ff,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    g.add(glow)

    return g
  }
}
