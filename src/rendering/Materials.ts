import * as THREE from 'three';

/** Halo Infinite palette — teal skies, warm metal, cyan Forerunner energy. */
export const HaloPalette = {
  forerunnerMetal: 0x3a4550,
  forerunnerAccent: 0xd4924a,
  forerunnerEmissive: 0x5ef0ff,
  unscMatte: 0x5c6358,
  unscAccent: 0x3d4a3a,
  energyGlass: 0x7af5ff,
  terrainGrass: 0x5a9a48,
  terrainDirt: 0x7a6a48,
  terrainMetal: 0x5a6670,
  warmSun: 0xffe8cc,
  coolFill: 0xa8dff0,
  skyTeal: 0x6ec8dc,
  skyHorizonGold: 0xf0d090,
  plasma: 0xc44dff,
  plasmaCore: 0xff66ee,
} as const;

/** String-hex palette alias used by combat / VFX modules. */
export const PALETTE = {
  skyZenith: '#1a6b7a',
  skyHorizon: '#c4a574',
  sun: '#ffd4a8',
  fill: '#6ec8d4',
  forerunner: '#2a3238',
  forerunnerAccent: '#3ee0c5',
  forerunnerGold: '#d4a056',
  energy: '#5ef0d8',
  plasma: '#c44dff',
  plasmaCore: '#ff66ee',
  grass: '#4a7a3e',
  dirt: '#6b5a42',
  metalDark: '#1c2228',
  metalLight: '#5a6670',
  uiOrange: '#f5a623',
  uiCyan: '#3ee0c5',
  shield: '#4fc3f7',
  health: '#e8f0e8',
} as const;

export type MaterialKind =
  | 'forerunnerMetal'
  | 'unscMatte'
  | 'energyGlass'
  | 'terrainGrass'
  | 'terrainDirt'
  | 'terrainMetal'
  | 'crateMetal'
  | 'rock';

const cache = new Map<string, THREE.Material>();

function proceduralNoiseMap(size: number, min = 0.2, max = 0.8): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor((min + Math.random() * (max - min)) * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function proceduralPanelMap(size: number, a: number, b: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const ca = `#${a.toString(16).padStart(6, '0')}`;
  const cb = `#${b.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = ca;
  ctx.fillRect(0, 0, size, size);
  const cell = size / 8;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? cb : ca;
      ctx.globalAlpha = 0.35 + Math.random() * 0.25;
      ctx.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#3de8ff';
      ctx.lineWidth = 1;
      if (Math.random() > 0.55) {
        ctx.strokeRect(x * cell + 6, y * cell + 6, cell - 12, cell - 12);
      }
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function proceduralGrassMap(size: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3d6a32';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = Math.random() > 0.5 ? '#5a8f45' : '#2f5528';
    ctx.fillRect(x, y, 1 + Math.random() * 2, 2 + Math.random() * 3);
  }
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = '#6b5a3e';
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 2 + Math.random() * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return new THREE.CanvasTexture(c);
}

function cacheKey(kind: string, opts?: Record<string, unknown>): string {
  return opts ? `${kind}:${JSON.stringify(opts)}` : kind;
}

/** Dark angular Forerunner alloy with cyan energy edge glow. */
export function createForerunnerMetal(options?: {
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  color?: number;
}): THREE.MeshStandardMaterial {
  const key = cacheKey('forerunnerMetal', options);
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshStandardMaterial;

  const mat = new THREE.MeshStandardMaterial({
    color: options?.color ?? HaloPalette.forerunnerMetal,
    roughness: options?.roughness ?? 0.28,
    metalness: options?.metalness ?? 0.95,
    emissive: new THREE.Color(HaloPalette.forerunnerEmissive),
    emissiveIntensity: options?.emissiveIntensity ?? 0.22,
    envMapIntensity: 1.45,
    map: proceduralPanelMap(512, 0x3a4550, 0x5a6a78),
    roughnessMap: proceduralNoiseMap(256, 0.18, 0.55),
    bumpMap: proceduralNoiseMap(256, 0.35, 0.65),
    bumpScale: 0.04,
  });
  mat.map!.colorSpace = THREE.SRGBColorSpace;
  mat.map!.wrapS = mat.map!.wrapT = THREE.RepeatWrapping;
  mat.map!.repeat.set(2.5, 5);
  mat.map!.anisotropy = 8;
  mat.roughnessMap!.wrapS = mat.roughnessMap!.wrapT = THREE.RepeatWrapping;
  mat.bumpMap!.wrapS = mat.bumpMap!.wrapT = THREE.RepeatWrapping;
  cache.set(key, mat);
  return mat;
}

/** Warm bronze/orange Forerunner accent plates. */
export function createForerunnerAccent(options?: {
  emissiveIntensity?: number;
}): THREE.MeshStandardMaterial {
  const key = cacheKey('forerunnerAccent', options);
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshStandardMaterial;

  const mat = new THREE.MeshStandardMaterial({
    color: HaloPalette.forerunnerAccent,
    roughness: 0.42,
    metalness: 0.85,
    emissive: new THREE.Color(HaloPalette.forerunnerAccent),
    emissiveIntensity: options?.emissiveIntensity ?? 0.08,
    envMapIntensity: 1.0,
  });
  cache.set(key, mat);
  return mat;
}

/** Olive drab UNSC polymer / painted armor — matte, non-reflective. */
export function createUnscMatte(options?: {
  color?: number | string;
  roughness?: number;
}): THREE.MeshStandardMaterial {
  const key = cacheKey('unscMatte', options);
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshStandardMaterial;

  const mat = new THREE.MeshStandardMaterial({
    color: options?.color ?? HaloPalette.unscMatte,
    roughness: options?.roughness ?? 0.88,
    metalness: 0.12,
    envMapIntensity: 0.45,
  });
  cache.set(key, mat);
  return mat;
}

/**
 * Translucent cyan Hardlight / energy glass.
 * Transmission is intentionally off: a transmission material re-renders the
 * whole scene every frame, and DoubleSide + transparent bumps material.version
 * twice per draw (Three recompiles / rebinds the program). That stalled combat
 * whenever an elite shield was on screen.
 */
export function createEnergyGlass(options?: {
  opacity?: number;
  emissiveIntensity?: number;
}): THREE.MeshPhysicalMaterial {
  const key = cacheKey('energyGlass', options);
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshPhysicalMaterial;

  const mat = new THREE.MeshPhysicalMaterial({
    color: HaloPalette.energyGlass,
    roughness: 0.06,
    metalness: 0.05,
    transmission: 0,
    thickness: 0.45,
    ior: 1.35,
    transparent: true,
    opacity: options?.opacity ?? 0.55,
    emissive: new THREE.Color(HaloPalette.energyGlass),
    emissiveIntensity: options?.emissiveIntensity ?? 0.9,
    envMapIntensity: 1.6,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    depthWrite: false,
  });
  cache.set(key, mat);
  return mat;
}

/** Solid emissive Hardlight bridge surface (gameplay-friendly). */
export function createEnergyBridge(options?: {
  emissiveIntensity?: number;
}): THREE.MeshStandardMaterial {
  const key = cacheKey('energyBridge', options);
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshStandardMaterial;

  const mat = new THREE.MeshStandardMaterial({
    color: 0xa8f8ff,
    roughness: 0.2,
    metalness: 0.3,
    emissive: new THREE.Color(HaloPalette.forerunnerEmissive),
    emissiveIntensity: options?.emissiveIntensity ?? 1.35,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
    forceSinglePass: true,
  });
  cache.set(key, mat);
  return mat;
}

/** Bright Zeta Halo turf. */
export function createTerrainGrass(options?: {
  color?: number;
}): THREE.MeshStandardMaterial {
  const key = cacheKey('terrainGrass', options);
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshStandardMaterial;

  const mat = new THREE.MeshStandardMaterial({
    color: options?.color ?? HaloPalette.terrainGrass,
    roughness: 0.92,
    metalness: 0.02,
    envMapIntensity: 0.35,
    map: proceduralGrassMap(256),
  });
  mat.map!.colorSpace = THREE.SRGBColorSpace;
  mat.map!.wrapS = mat.map!.wrapT = THREE.RepeatWrapping;
  mat.map!.repeat.set(24, 24);
  cache.set(key, mat);
  return mat;
}

/** Dry soil / dirt patches between metal plates. */
export function createTerrainDirt(options?: {
  color?: number;
}): THREE.MeshStandardMaterial {
  const key = cacheKey('terrainDirt', options);
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshStandardMaterial;

  const mat = new THREE.MeshStandardMaterial({
    color: options?.color ?? HaloPalette.terrainDirt,
    roughness: 0.95,
    metalness: 0.04,
    envMapIntensity: 0.3,
  });
  cache.set(key, mat);
  return mat;
}

/** Embedded Forerunner ground plating. */
export function createTerrainMetal(): THREE.MeshStandardMaterial {
  const key = cacheKey('terrainMetal');
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshStandardMaterial;

  const mat = new THREE.MeshStandardMaterial({
    color: HaloPalette.terrainMetal,
    roughness: 0.55,
    metalness: 0.78,
    emissive: new THREE.Color(HaloPalette.forerunnerEmissive),
    emissiveIntensity: 0.04,
    envMapIntensity: 0.9,
  });
  cache.set(key, mat);
  return mat;
}

/** Supply crate — olive with slight wear. */
export function createCrateMetal(): THREE.MeshStandardMaterial {
  const key = cacheKey('crateMetal');
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshStandardMaterial;

  const mat = new THREE.MeshStandardMaterial({
    color: 0x4e5548,
    roughness: 0.72,
    metalness: 0.45,
    envMapIntensity: 0.6,
  });
  cache.set(key, mat);
  return mat;
}

/** Natural cover rock — warm grey-brown. */
export function createRock(): THREE.MeshStandardMaterial {
  const key = cacheKey('rock');
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshStandardMaterial;

  const mat = new THREE.MeshStandardMaterial({
    color: 0x6a6558,
    roughness: 0.96,
    metalness: 0.05,
    flatShading: true,
    envMapIntensity: 0.25,
  });
  cache.set(key, mat);
  return mat;
}

/** Vertex-colored terrain (grass/dirt/metal blended in geometry). */
export function createTerrainVertexColored(): THREE.MeshStandardMaterial {
  const key = cacheKey('terrainVertex');
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshStandardMaterial;

  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0.15,
    vertexColors: true,
    envMapIntensity: 0.55,
    map: proceduralGrassMap(256),
  });
  mat.map!.colorSpace = THREE.SRGBColorSpace;
  mat.map!.wrapS = mat.map!.wrapT = THREE.RepeatWrapping;
  mat.map!.repeat.set(18, 18);
  cache.set(key, mat);
  return mat;
}

// --- Short aliases (used by weapons / enemy modules) -------------------------

export function forerunnerMetal(emissiveIntensity = 0.35): THREE.MeshStandardMaterial {
  return createForerunnerMetal({ emissiveIntensity });
}

export function forerunnerGold(): THREE.MeshStandardMaterial {
  return createForerunnerAccent({ emissiveIntensity: 0.15 });
}

export function energyGlass(): THREE.MeshPhysicalMaterial {
  return createEnergyGlass({ opacity: 0.75, emissiveIntensity: 0.8 });
}

export function terrainGrass(): THREE.MeshStandardMaterial {
  return createTerrainGrass();
}

export function terrainDirt(): THREE.MeshStandardMaterial {
  return createTerrainDirt();
}

export function unscMatte(color: number | string = '#3d4650'): THREE.MeshStandardMaterial {
  return createUnscMatte({ color });
}

export function plasmaMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: HaloPalette.plasmaCore,
    emissive: new THREE.Color(HaloPalette.plasma),
    emissiveIntensity: 2.2,
    metalness: 0,
    roughness: 0.2,
    transparent: true,
    opacity: 0.95,
  });
}

export function enemyArmor(hue: 'purple' | 'red' | 'blue' = 'purple'): THREE.MeshStandardMaterial {
  const map = {
    purple: 0x4a2a6a,
    red: 0x6a2a2a,
    blue: 0x2a3a6a,
  } as const;
  return new THREE.MeshStandardMaterial({
    color: map[hue],
    metalness: 0.7,
    roughness: 0.35,
    emissive: new THREE.Color(map[hue]),
    emissiveIntensity: 0.28,
  });
}

/** Resolve a shared material by kind. */
export function getMaterial(kind: MaterialKind): THREE.Material {
  switch (kind) {
    case 'forerunnerMetal':
      return createForerunnerMetal();
    case 'unscMatte':
      return createUnscMatte();
    case 'energyGlass':
      return createEnergyGlass();
    case 'terrainGrass':
      return createTerrainGrass();
    case 'terrainDirt':
      return createTerrainDirt();
    case 'terrainMetal':
      return createTerrainMetal();
    case 'crateMetal':
      return createCrateMetal();
    case 'rock':
      return createRock();
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** Dispose cached shared materials (call on full teardown). */
export function disposeMaterialCache(): void {
  for (const mat of cache.values()) {
    mat.dispose();
  }
  cache.clear();
}
