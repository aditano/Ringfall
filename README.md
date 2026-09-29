# Ringfall

A first-person mission on a ringworld, built in the browser with Three.js. You wake in a lifeboat, cross the valley, take a Warthog through a Forerunner installation, and reach the landing zone.

Play the deployed build at [aditano.github.io/Ringfall](https://aditano.github.io/Ringfall/).

## Run

```bash
npm install
npm run dev
```

`npm run build` emits `dist/`. GitHub Pages deploys that folder on every push to `main` (see `.github/workflows/pages.yml`). Vite's `base` is `./`, so the project site resolves scripts and CC0 assets correctly.

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

Settings (quality preset, bloom, ambient occlusion, shadows, SMAA, vignette, god rays, reflections) live on the title screen and are saved in this browser.

## Look

- AgX tone mapping, sRGB output, and a Poly Haven HDRI for image-based lighting
- Warm key light with soft shadows, cool fill, and hemisphere bounce
- Bloom, ground-truth ambient occlusion, SMAA, vignette, and exponential fog
- CC0 terrain, rocks, trees, crates, and pickups from Poly Haven (see [CREDITS.md](CREDITS.md))

Low and medium presets turn ambient occlusion off. Auto-optimize steps the stack down if the frame rate stays under 50.
