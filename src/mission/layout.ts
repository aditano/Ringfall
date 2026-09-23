import type { EnemyKind } from '../enemies/Enemy'

export interface UnitSpawn {
  kind: EnemyKind
  x: number
  z: number
  yaw: number
}

export interface EncounterDef {
  id: string
  anchorX: number
  radius: number
  units: UnitSpawn[]
}

export interface PickupDef {
  id: string
  kind: 'weapon' | 'health' | 'grenades' | 'ammo'
  weapon?: 'br' | 'ar' | 'plasma' | 'prifle'
  amount: number
  x: number
  z: number
}

export interface CheckpointDef {
  id: string
  x: number
  z: number
  yaw: number
  /** Become the active checkpoint once the player passes this X. */
  at: number
  /** Only arm after this encounter is cleared. */
  requires?: string
}

/** Canonical coordinates for the Combat Evolved "Halo" mission recreation. */
export const SPAWN = { x: 7.2, z: 0.35, yaw: -Math.PI / 2 }
export const HOG_SPAWN = { x: 188, z: 2.4, yaw: -Math.PI / 2 }
export const PELICAN_PAD = { x: 718, z: 0 }
export const CAVE_MOUTH = { x: 492, z: 0 }
export const SHADE_POST = { x: 326, z: -10 }

export const MARINE_POSTS = [
  { x: 90, z: -2.2 },
  { x: 93.5, z: 2.6 },
  { x: 87.5, z: 0.4 },
]

export const ENCOUNTERS: EncounterDef[] = [
  {
    id: 'contact',
    anchorX: 46,
    radius: 26,
    units: [
      { kind: 'grunt', x: 40, z: -3.2, yaw: Math.PI / 2 },
      { kind: 'grunt', x: 45, z: 4.2, yaw: Math.PI / 2 },
      { kind: 'grunt', x: 50, z: 0.6, yaw: 2.1 },
      { kind: 'elite', x: 56, z: -2.4, yaw: Math.PI / 2 },
    ],
  },
  {
    id: 'marines',
    anchorX: 108,
    radius: 30,
    units: [
      { kind: 'grunt', x: 112, z: -4, yaw: Math.PI / 2 },
      { kind: 'grunt', x: 116, z: 3.4, yaw: Math.PI / 2 },
      { kind: 'grunt', x: 121, z: -1, yaw: 1.4 },
      { kind: 'jackal', x: 118, z: 7.2, yaw: Math.PI / 2 },
      { kind: 'jackal', x: 114, z: -8, yaw: 1.1 },
      { kind: 'elite', x: 128, z: 1.2, yaw: Math.PI / 2 },
    ],
  },
  {
    id: 'patrol',
    anchorX: 158,
    radius: 22,
    units: [
      { kind: 'grunt', x: 152, z: -2.2, yaw: 0.5 },
      { kind: 'grunt', x: 158, z: 3.2, yaw: -0.2 },
      { kind: 'grunt', x: 163, z: -4.6, yaw: 1.2 },
      { kind: 'jackal', x: 170, z: 2.4, yaw: Math.PI / 2 },
    ],
  },
  {
    id: 'alpha',
    anchorX: 314,
    radius: 32,
    units: [
      { kind: 'grunt', x: 304, z: 5, yaw: Math.PI / 2 },
      { kind: 'grunt', x: 308, z: -5.5, yaw: 1.1 },
      { kind: 'grunt', x: 318, z: 6.4, yaw: Math.PI / 2 },
      { kind: 'jackal', x: 320, z: -3, yaw: Math.PI / 2 },
      { kind: 'jackal', x: 312, z: 8.5, yaw: 2 },
      { kind: 'elite', x: 334, z: 0.4, yaw: Math.PI / 2 },
    ],
  },
  {
    id: 'bravo',
    anchorX: 418,
    radius: 30,
    units: [
      { kind: 'grunt', x: 406, z: -5, yaw: Math.PI / 2 },
      { kind: 'grunt', x: 412, z: 4.5, yaw: 1.5 },
      { kind: 'grunt', x: 422, z: -2, yaw: Math.PI / 2 },
      { kind: 'jackal', x: 426, z: 7, yaw: 2.1 },
      { kind: 'elite', x: 434, z: -0.6, yaw: Math.PI / 2 },
      { kind: 'elite', x: 416, z: -8, yaw: 1 },
    ],
  },
  {
    id: 'cave-hall',
    anchorX: 526,
    radius: 20,
    units: [
      { kind: 'grunt', x: 516, z: -4, yaw: Math.PI / 2 },
      { kind: 'grunt', x: 520, z: 5, yaw: 1.3 },
      { kind: 'grunt', x: 528, z: -2, yaw: Math.PI / 2 },
      { kind: 'grunt', x: 534, z: 3.2, yaw: 2 },
      { kind: 'jackal', x: 538, z: -6, yaw: Math.PI / 2 },
      { kind: 'jackal', x: 524, z: 7, yaw: 1 },
    ],
  },
  {
    id: 'cave-bridge',
    anchorX: 558,
    radius: 18,
    units: [
      { kind: 'grunt', x: 568, z: -1, yaw: Math.PI / 2 },
      { kind: 'grunt', x: 572, z: 2.2, yaw: 2 },
      { kind: 'jackal', x: 570, z: 6.4, yaw: Math.PI / 2 },
      { kind: 'elite', x: 576, z: -2.2, yaw: Math.PI / 2 },
      { kind: 'elite', x: 574, z: 4.2, yaw: 1.6 },
    ],
  },
  {
    id: 'cave-exit',
    anchorX: 592,
    radius: 16,
    units: [
      { kind: 'grunt', x: 586, z: 4, yaw: Math.PI / 2 },
      { kind: 'grunt', x: 592, z: -4, yaw: 1.1 },
      { kind: 'jackal', x: 598, z: 2, yaw: Math.PI / 2 },
      { kind: 'elite', x: 602, z: -0.8, yaw: Math.PI / 2 },
    ],
  },
  {
    id: 'lz',
    anchorX: 694,
    radius: 36,
    units: [
      { kind: 'grunt', x: 676, z: -8, yaw: -1.2 },
      { kind: 'grunt', x: 682, z: 6.5, yaw: 2.6 },
      { kind: 'grunt', x: 694, z: -5, yaw: Math.PI / 2 },
      { kind: 'grunt', x: 702, z: 8, yaw: 2.4 },
      { kind: 'grunt', x: 690, z: 1.5, yaw: Math.PI },
      { kind: 'jackal', x: 708, z: -6, yaw: -1 },
      { kind: 'jackal', x: 678, z: 10, yaw: 0.4 },
      { kind: 'jackal', x: 714, z: 3, yaw: Math.PI / 2 },
      { kind: 'elite', x: 698, z: -1.5, yaw: Math.PI },
      { kind: 'elite', x: 710, z: 5.5, yaw: 2.2 },
    ],
  },
]

export const PICKUPS: PickupDef[] = [
  { id: 'ppistol', kind: 'weapon', weapon: 'plasma', amount: 1, x: 51, z: 6.2 },
  { id: 'ar', kind: 'weapon', weapon: 'ar', amount: 1, x: 72, z: -1.6 },
  { id: 'ammo1', kind: 'ammo', amount: 1, x: 134, z: 2.2 },
  { id: 'nades1', kind: 'grenades', amount: 2, x: 137, z: -2.4 },
  { id: 'health1', kind: 'health', amount: 55, x: 204, z: 4.2 },
  { id: 'prifle', kind: 'weapon', weapon: 'prifle', amount: 1, x: 532, z: 8.2 },
  { id: 'nades2', kind: 'grenades', amount: 2, x: 542, z: -7.2 },
  { id: 'health2', kind: 'health', amount: 70, x: 586, z: 6.4 },
  { id: 'ammo2', kind: 'ammo', amount: 1, x: 656, z: -3 },
  { id: 'health3', kind: 'health', amount: 60, x: 664, z: 3.4 },
]

export const CHECKPOINTS: CheckpointDef[] = [
  { id: 'pod', x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw, at: -999 },
  { id: 'after-contact', x: 64, z: 0.2, yaw: -Math.PI / 2, at: 60, requires: 'contact' },
  { id: 'after-marines', x: 136, z: 0, yaw: -Math.PI / 2, at: 130, requires: 'marines' },
  { id: 'hog', x: 196, z: 0.4, yaw: -Math.PI / 2, at: 184 },
  { id: 'pre-alpha', x: 276, z: 0, yaw: -Math.PI / 2, at: 268 },
  { id: 'cave', x: 462, z: 0, yaw: -Math.PI / 2, at: 452 },
  { id: 'beach', x: 646, z: 0, yaw: -Math.PI / 2, at: 638 },
]

/** Cover that stays off the driving line (|z| small is the road). */
export const COVER: { x: number; z: number; s: number; crate?: boolean }[] = [
  { x: 37, z: -5.4, s: 1.35 },
  { x: 48, z: 6.6, s: 1.15 },
  { x: 58, z: 4.8, s: 0.9 },
  { x: 86, z: -4.2, s: 1.4 },
  { x: 98, z: 5.2, s: 1.2 },
  { x: 108, z: -6.4, s: 1.05 },
  { x: 124, z: 6.8, s: 1.25 },
  { x: 154, z: 5.5, s: 1.1 },
  { x: 166, z: -6.2, s: 1.3 },
  { x: 300, z: 6.4, s: 1.35 },
  { x: 316, z: -6.8, s: 1.15 },
  { x: 330, z: 7.2, s: 1.4 },
  { x: 404, z: -6.5, s: 1.2 },
  { x: 422, z: 7.4, s: 1.3 },
  { x: 438, z: -5.2, s: 1.05 },
  { x: 668, z: 7.6, s: 1.2, crate: true },
  { x: 684, z: -7.2, s: 1.15, crate: true },
  { x: 702, z: 9, s: 1.3 },
  { x: 716, z: -8, s: 1.1, crate: true },
]
