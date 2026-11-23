# ISLA BRASA 3D

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/awalsa/gta6-04/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/awalsa/gta6-04/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

A 3D third-person GTA-style open-city game for the [make.fun gta6-01 bounty](https://make.fun/competitions/gta6-01) — a full rebuild of ISLA BRASA in Three.js (low-poly, no external model files). Walk the streets of Isla Brasa, steal cars, fight Delgado's crew, dodge the cops, and finish all **12 missions for $10,510**.

## What is in the game

- **Open 3D city** (~400×400): Feria Market, Old Pier, Marina Docks, Brasa Garage, Rook Arcade, Coral Room Casino, Coast Tunnel, Motel Vela, Underpass, Old Church, Plaza Tower and Beachfront; water west and south, pier deck, palms, street lamps.
- **12 missions** — Tamale Run ($740) through The Big One ($870 finale, timed 240s), with goto / collect / clear / steal / deliver steps, gold beacon + HUD arrow + distance, and generous timers.
- **Police / wanted 0–5 stars** — roadblocks and the CONDOR-1 helicopter at 3★+, wanted decays when hidden.
- **Weapon wheel** (hold Q): fists, pistol, SMG, shotgun, rifle.
- **Garage** (G): buy 4 cars ($2,800–$12,000), 3-tier engine/armor/handling upgrades, sell for 60% + 40% of upgrades.
- **Crew**: hire Rico Vega ($1,500 driver), Marta Solis ($2,000 gunman), Ghost ($2,500 hacker); each levels 0–3.
- **Respect ranks**: Nobody → Hustler → Street Boss → Kingpin → Legend (35,000 respect), +5% payout per rank.
- **Street races**: Malecon Sprint, Old Town Circuit, Beachfront Dash — start with R near a start point, beat the clock.
- **HUD**: cash, wanted stars, respect, mission tracker, minimap. Progress autosaves to localStorage.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move (camera-relative) / drive: accelerate, brake, steer |
| Shift | Run |
| Space | Jump |
| E | Enter / exit car (near a car) |
| Mouse click | Attack / shoot |
| Mouse drag | Orbit camera (← → also orbit, wheel zooms) |
| Q (hold) | Weapon wheel (1–5 to pick) |
| F | Interact |
| G | Shop / garage |
| R | Start a street race near a start point |
| M | Map |
| Esc | Close overlay |

## Run it

Serve the repo root (e.g. `python3 -m http.server`) and open `game/index.html`. Three.js r160 loads from unpkg via an import map, with an automatic one-time fallback to jsDelivr (`?three=jsdelivr`) if unpkg fails.

## Structure

- `game/index.html` — single entry, HUD + overlays, import map + CDN fallback boot probe.
- `game/src/main.js` — boot, renderer/scene/lights/fog, shared state `S`, game loop (dt clamped to 0.05), third-person camera, fallback world/player/cars/missions used only until the dedicated modules land.
- `game/src/input.js` — keyboard/mouse singleton with edge-trigger helpers.
- `game/src/state.js` — localStorage save/load (`isla-brasa-3d-save`), respect ranks.
- Other `game/src/` modules (world, player, cars, combat, police, missions, race, hud) are loaded optionally by `main.js` — see the interface assumptions in the header of `main.js`.
