# Ringfall

Ringfall is a first-person mission you play in the browser. You wake in a lifeboat on a ringworld, cross the valley, rally a marine squad, drive a Warthog through a Forerunner installation, and reach the landing zone for extraction.

It is an unofficial recreation of the Halo: Combat Evolved mission "Halo." The game code, music, and sound effects are original. Terrain, props, and the sky HDRI are CC0 assets from Poly Haven.

**Play the live build:** [aditano.github.io/Ringfall](https://aditano.github.io/Ringfall/)

GitHub Pages publishes `dist/` on every push to `main`. The workflow is `.github/workflows/pages.yml`.

## Features

- A scripted campaign with objectives, dialogue subtitles, checkpoints, and a Pelican extraction
- Two weapon slots. You start with the M6D Magnum and can pick up the MA5B Assault Rifle, a chargeable Plasma Pistol, and a Plasma Rifle
- Frag grenades, plus weapon, ammo, health, and grenade pickups
- Covenant Grunts, Jackals, and Elites with energy shields, headshots, and combat AI
- Marine allies who fight with you
- An M12 Warthog you can drive, or switch to the chain-gun turret
- A Shade turret inside the installation
- Recharging energy shields, then health
- A HUD with the objective, motion tracker, waypoint, ammo, grenade count, hit markers, and a kill feed
- A title screen with graphics and audio settings saved in this browser
- Quality presets (auto, low, medium, high, ultra) for bloom, ground-truth ambient occlusion, SMAA, vignette, light shafts, reflections, shadows, and resolution scale
- Automatic quality reduction when the frame rate stays under 50
- On-screen touch controls for phones
- AgX tone mapping and image-based lighting from a Poly Haven HDRI
- Procedural music and sound effects through the Web Audio API

## Controls

| Input | Action |
| --- | --- |
| WASD or arrows | Move, or steer and throttle the Warthog |
| Mouse | Look (pointer lock) |
| Left mouse | Fire |
| Right mouse | Aim down sights |
| R | Reload |
| 1 / 2 | Switch weapon slots |
| Scroll or Q | Cycle weapons |
| E | Use, pick up, board, or exit the Warthog |
| F | Swap between the driver seat and the turret |
| G | Throw a frag grenade |
| Shift | Sprint |
| Space | Jump |
| C or Ctrl | Crouch |

On a phone, the left stick moves, the right side of the screen looks, and the on-screen buttons cover fire, aim, jump, use, reload, grenades, weapon swap, and the turret.

## Run locally

Install [Node.js 20](https://nodejs.org/) (the version the Pages workflow uses) and npm.

```bash
npm install
npm run dev
```

Vite prints a local URL, usually `http://localhost:5173`.

To build the same output Pages deploys:

```bash
npm run build
npm run preview
```

`npm run build` typechecks with TypeScript, then writes `dist/`. Vite's `base` is `./`, so scripts and assets resolve on the GitHub Pages path.

## Tech stack

- TypeScript 6
- Vite 8
- Three.js 0.185 (WebGL renderer, postprocessing composer, bloom, ground-truth ambient occlusion, SMAA)
- Web Audio API
- GitHub Actions and GitHub Pages

## License

Copyright 2026 Anthony DiTano.

Ringfall is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. The full license is in [LICENSE](LICENSE).

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

### Third-party exceptions

These materials keep their own licenses:

- Models, textures, and the HDRI in `public/assets` and `public/hdri` are [CC0](https://creativecommons.org/publicdomain/zero/1.0/) assets from [Poly Haven](https://polyhaven.com). Sources are listed in [CREDITS.md](CREDITS.md).
- Orbitron and Rajdhani are loaded from Google Fonts for the title screen and HUD. They remain under the [SIL Open Font License 1.1](https://openfontlicense.org/).
- npm packages keep the licenses they publish: [three.js](https://github.com/mrdoob/three.js) (MIT), Vite (MIT), TypeScript (Apache-2.0), and `@types/three` (MIT).
