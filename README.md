# Halo

A first-person recreation of the Halo: Combat Evolved mission **Halo**, built in Three.js.

You wake in a lifeboat on the ring, fight through the valley with a squad of marines, take a Warthog, cross a Forerunner installation, and board Foehammer's Pelican.

## Run

```bash
npm install
npm run dev
```

## Controls

| Input | Action |
|--------|--------|
| WASD | Move / drive |
| Mouse | Look (pointer lock) |
| LMB | Fire |
| RMB | Aim down sights |
| R | Reload |
| 1 / 2 | Switch weapons |
| Scroll / Q | Cycle weapons |
| E | Use, board, or exit the Warthog |
| F | Swap between the driver seat and the turret |
| G | Frag grenade |
| Shift | Sprint |
| Space | Jump |
| C / Ctrl | Crouch |

## Stack

- Vite + TypeScript + Three.js
- PBR + environment reflections, bloom / SMAA, ACES tonemapping
- Positional HRTF audio + dynamic combat music
