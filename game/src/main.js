// main.js — boot + game loop for ISLA BRASA 3D.
//
// Shared contract (design spec): Y-up, ground XZ, city ~400x400
// (x,z in [-200,200]), water west (x<-170) and south (z>170).
// Landmarks: market(-120,-80), pier(-180,120), marina(-160,-160),
// garage(60,-120), arcade(0,0), casino(120,-60), tunnel(150,100),
// motel(-60,140), underpass(100,40), church(-40,-140), plaza(80,80),
// beach(0,180).
//   S fields: scene, camera, renderer, player, cars[], enemies[], pickups[],
//   mission|null, missionsDone[], cash, respect, wanted(0-5),
//   crew{rico,marta,ghost} each {hired,level}, ownedCars[], upgrades{},
//   race|null, markers[], time, input, world{landmarks, colliders[]}.
//
// ACTUAL interfaces of the sibling modules (read from their files, not
// assumed — every import below is still optional with a fallback, so the
// game loads even if a sibling file is missing):
//   world.js   -> buildWorld(scene) -> { landmarks:{name:{x,z,mesh}},
//                 colliders:[{minX,maxX,minZ,maxZ}],
//                 spawnPoints:{ player:{x,z}, cars:[{x,z,angle}] } }
//   player.js  -> createPlayer(scene, pos) -> player { mesh, pos:Vector3,
//                 yaw, hp, car|null, weapon, ... }; updatePlayer(S, dt).
//                 Movement is camera-relative via S.cameraYaw; E enter/exit
//                 car and click-attack live in player.js/combat.js.
//   cars.js    -> createCar(scene, type, pos), spawnParkedCars(S),
//                 updateCar(S, car, dt) (per car), moveCar(S, car, dt, …).
//                 Cars: { mesh, pos:Vector3, yaw, speed, type, stats, driver }.
//   combat.js  -> createEnemy(scene, pos, kind), updateCombat(S, dt),
//                 selectWeapon(S, idOrIndex). Owns the weapon wheel:
//                 sets S.weaponWheelOpen = Q-held; HUD renders the wheel.
//                 Sets only player.weapon — main.js syncs S.weapon from it.
//   police.js  -> addWanted(S, n), setWanted(S, n), updatePolice(S, dt).
//                 Main wires S.addWanted = (n) => addWanted(S, n).
//   missions.js-> startMission(S, id), updateMission(S, dt) [singular],
//                 startRace(S, id), updateRace(S, dt), missionMarker(S),
//                 nextMissionId(S), missionList(S). MISSIONS live in
//                 config.js. No auto-start in missions.js — main.js
//                 auto-starts the next mission when none is active.
//   config.js  -> LANDMARKS, MISSIONS (total 10510), RACES, WEAPONS,
//                 CAR_TYPES (vela/brasa/coyote/cometa), CREW, RESPECT_RANKS.
//   economy.js -> openGarage(S)/openShop(S) (set S.overlay), respectRank(S),
//                 buyCar/upgradeCar/sellCar/hireCrew/levelCrew/buyWeapon.
//                 HUD renders S.overlay ('garage'|'shop') as #game-overlay.
//   hud.js     -> updateHUD(S) — writes #hud-cash, #hud-wanted,
//                 #hud-respect, #hud-weapon, #hud-mission, #hud-timer,
//                 #hud-speed, the mission brief/result banners, the weapon
//                 wheel (#weapon-wheel, from S.weaponWheelOpen), the
//                 garage/shop overlay (#game-overlay, from S.overlay), and
//                 draws the minimap (#minimap) itself.
// Main.js owns: renderer/scene/lights/fog, the S object, the loop, the
// third-person camera (S.cameraYaw is canonical — player.js and cars.js
// read/write it), spawn hooks (S.spawnEnemy/spawnPickup/spawnCar, which
// missions.js calls and which must push into S.enemies/S.pickups/S.cars),
// pickup collection (no sibling module collects pickups), overlay keys
// (G cycles garage→shop→closed, M map, Esc close, R race start),
// mission auto-start, and save triggers.

import * as THREE from 'three';
import { input } from './input.js';
import { saveGame, loadGame, defaultSave, respectRank } from './state.js';

export const LANDMARKS = {
  market: { x: -120, z: -80, name: 'Feria Market' },
  pier: { x: -180, z: 120, name: 'Old Pier' },
  marina: { x: -160, z: -160, name: 'Marina Docks' },
  garage: { x: 60, z: -120, name: 'Brasa Garage' },
  arcade: { x: 0, z: 0, name: 'Rook Arcade' },
  casino: { x: 120, z: -60, name: 'Coral Room Casino' },
  tunnel: { x: 150, z: 100, name: 'Coast Tunnel' },
  motel: { x: -60, z: 140, name: 'Motel Vela' },
  underpass: { x: 100, z: 40, name: 'Underpass' },
  church: { x: -40, z: -140, name: 'Old Church' },
  plaza: { x: 80, z: 80, name: 'Plaza Tower' },
  beach: { x: 0, z: 180, name: 'Beachfront' },
};

const CITY = 200; // half-size; city spans [-200, 200] on x and z.

// --- position helpers (tolerant of both the real player/car shape
// (.pos:Vector3, .mesh) and the fallback shape (.position, .group)) -------
export function objPos(obj) {
  if (!obj) return null;
  if (obj.pos && typeof obj.pos.x === 'number') return obj.pos;
  if (obj.position && typeof obj.position.x === 'number') return obj.position;
  if (obj.mesh && obj.mesh.position) return obj.mesh.position;
  if (typeof obj.x === 'number' && typeof obj.z === 'number') return obj;
  return null;
}
function playerPos(S) { return objPos(S.player); }
function playerInCar(S) {
  const p = S.player;
  return !!(p && (p.car || p.inCar || p.currentCar));
}
function playerHeading(S) {
  const p = S.player;
  if (!p) return 0;
  if (typeof p.yaw === 'number') return p.yaw;
  if (typeof p.heading === 'number') return p.heading;
  return 0;
}

// ---------------------------------------------------------------------------
// Optional module loading
// ---------------------------------------------------------------------------
async function tryImport(path) {
  try {
    return await import(path);
  } catch (err) {
    console.warn(`[main] optional module ${path} not available, using fallback:`, err.message);
    return null;
  }
}

async function loadOptionalModules() {
  const [world, player, cars, combat, police, missions, hud, config, economy] = await Promise.all([
    tryImport('./world.js'),
    tryImport('./player.js'),
    tryImport('./cars.js'),
    tryImport('./combat.js'),
    tryImport('./police.js'),
    tryImport('./missions.js'),
    tryImport('./hud.js'),
    tryImport('./config.js'),
    tryImport('./economy.js'),
  ]);
  return { world, player, cars, combat, police, missions, hud, config, economy };
}

// ---------------------------------------------------------------------------
// Fallback world (used only if world.js is absent). Low-poly city: ground,
// roads, water west+south, landmark buildings with AABB colliders, palms,
// lamps, pier deck. Real world.js replaces all of this when it lands.
// ---------------------------------------------------------------------------
function fallbackBuildWorld(scene) {
  const colliders = [];
  const landmarks = {};
  for (const [key, lm] of Object.entries(LANDMARKS)) landmarks[key] = { ...lm };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(460, 460),
    new THREE.MeshLambertMaterial({ color: 0x5a7a4a }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Water: west (x < -170) and south (z > 170).
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x1e6f9e });
  const waterW = new THREE.Mesh(new THREE.PlaneGeometry(60, 460), waterMat);
  waterW.rotation.x = -Math.PI / 2; waterW.position.set(-200, 0.05, 0); scene.add(waterW);
  const waterS = new THREE.Mesh(new THREE.PlaneGeometry(460, 60), waterMat);
  waterS.rotation.x = -Math.PI / 2; waterS.position.set(0, 0.05, 200); scene.add(waterS);

  const roadMat = new THREE.MeshLambertMaterial({ color: 0x2e2e33 });
  for (let i = -160; i <= 160; i += 40) {
    for (const [w, d, x, z] of [[400, 8, 0, i], [8, 400, i, 0]]) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(w, d), roadMat);
      road.rotation.x = -Math.PI / 2; road.position.set(x, 0.06, z); scene.add(road);
    }
  }

  let seed = 12345;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const palette = [0x8a7a5a, 0x7a8a9a, 0x9a7a6a, 0x6a7a8a, 0xa08a6a, 0x5a6a7a];
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
  for (let bx = -160; bx <= 160; bx += 40) {
    for (let bz = -160; bz <= 160; bz += 40) {
      if (Math.abs(bx) < 20 && Math.abs(bz) < 20) continue;
      const nearLandmark = Object.values(LANDMARKS).some(
        (lm) => Math.abs(lm.x - bx) < 22 && Math.abs(lm.z - bz) < 22);
      if (nearLandmark) continue;
      const w = 14 + rand() * 10, d = 14 + rand() * 10, h = 6 + rand() * 22;
      const x = bx + (rand() - 0.5) * 8, z = bz + (rand() - 0.5) * 8;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
        new THREE.MeshLambertMaterial({ color: palette[Math.floor(rand() * palette.length)] }));
      b.position.set(x, h / 2, z); scene.add(b);
      colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
      const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.4, 0.1), winMat);
      win.position.set(x, h * 0.7, z + d / 2 + 0.06); scene.add(win);
    }
  }

  const addBox = (x, z, w, h, d, color) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, h / 2, z); scene.add(m);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    return m;
  };
  addBox(120, -60, 22, 42, 22, 0xd4a017); // casino: tall gold tower
  addBox(-40, -140, 16, 10, 12, 0xf0ead8); // church: white box
  const spire = new THREE.Mesh(new THREE.ConeGeometry(4, 12, 4),
    new THREE.MeshLambertMaterial({ color: 0xd8d0b8 }));
  spire.position.set(-40, 16, -140); scene.add(spire);
  addBox(-60, 140, 30, 6, 10, 0x7a9ab0); // motel: long low block
  addBox(80, 80, 18, 30, 18, 0x5a7a9a); // plaza tower
  addBox(-120, -80, 20, 8, 16, 0xb0703a); // market hall
  addBox(60, -120, 20, 7, 14, 0x8a4a3a); // garage
  addBox(0, 0, 16, 9, 14, 0x9a3a6a); // arcade
  const pier = new THREE.Mesh(new THREE.BoxGeometry(10, 1, 40),
    new THREE.MeshLambertMaterial({ color: 0x8a6a42 }));
  pier.position.set(-180, 0.6, 120); scene.add(pier);

  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a3a });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2e8a4a });
  for (let i = 0; i < 40; i++) {
    const x = -170 + rand() * 340, z = -170 + rand() * 340;
    if (Math.abs(x % 40) < 10 && Math.abs(z % 40) < 10) continue;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 5, 6), trunkMat);
    trunk.position.set(x, 2.5, z); scene.add(trunk);
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(2.2, 3, 6), leafMat);
    leaves.position.set(x, 6, z); scene.add(leaves);
  }
  return {
    landmarks, colliders,
    spawnPoints: { player: { x: 10, z: 10 }, cars: [] },
  };
}

// ---------------------------------------------------------------------------
// Fallback player + cars (used only if player.js / cars.js are absent).
// Low-poly humanoid: capsule body + head + swinging limbs. Shape matches
// the fallback car code below (.position/.group/.inCar), NOT the real
// player.js shape — the camera/beacon helpers above abstract over both.
// ---------------------------------------------------------------------------
function fallbackCreatePlayer(scene, pos) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2a6ab0 });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xd8a070 });
  const legMat = new THREE.MeshLambertMaterial({ color: 0x303030 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.7, 4, 8), bodyMat);
  body.position.y = 1.15; group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), skinMat);
  head.position.y = 2.15; group.add(head);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.8, 0.18), skinMat);
  armL.position.set(-0.6, 1.3, 0); group.add(armL);
  const armR = armL.clone(); armR.position.x = 0.6; group.add(armR);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.22), legMat);
  legL.position.set(-0.22, 0.4, 0); group.add(legL);
  const legR = legL.clone(); legR.position.x = 0.22; group.add(legR);
  group.position.set(pos?.x ?? 0, 0, pos?.z ?? 10);
  scene.add(group);
  return {
    group, mesh: group,
    position: group.position,
    heading: 0, speed: 0, inCar: false, currentCar: null,
    vy: 0, grounded: true,
    _armL: armL, _armR: armR, _legL: legL, _legR: legR, _walkPhase: 0,
  };
}

function pushOutOfColliders(pos, radius, colliders) {
  for (const c of colliders) {
    if (pos.x > c.minX - radius && pos.x < c.maxX + radius &&
        pos.z > c.minZ - radius && pos.z < c.maxZ + radius) {
      const dxl = pos.x - (c.minX - radius), dxr = (c.maxX + radius) - pos.x;
      const dzl = pos.z - (c.minZ - radius), dzr = (c.maxZ + radius) - pos.z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) pos.x = c.minX - radius;
      else if (m === dxr) pos.x = c.maxX + radius;
      else if (m === dzl) pos.z = c.minZ - radius;
      else pos.z = c.maxZ + radius;
    }
  }
}

function fallbackCreateCar(scene, x, z, color, name) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.2),
    new THREE.MeshLambertMaterial({ color }));
  body.position.y = 0.65; group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2),
    new THREE.MeshLambertMaterial({ color: 0x222831 }));
  cabin.position.set(0, 1.25, -0.2); group.add(cabin);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  for (const [wx, wz] of [[-0.95, 1.3], [0.95, 1.3], [-0.95, -1.3], [0.95, -1.3]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10), wheelMat);
    w.rotation.z = Math.PI / 2; w.position.set(wx, 0.38, wz); group.add(w);
  }
  group.position.set(x, 0, z);
  scene.add(group);
  return {
    group, mesh: group, position: group.position, heading: 0, speed: 0,
    name, topSpeed: 26, accel: 14, handling: 1,
  };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

async function boot() {
  const save = loadGame() || defaultSave();
  const mods = await loadOptionalModules();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false; // perf: hemisphere + directional only
  $('game-container').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5d6);
  scene.fog = new THREE.Fog(0x87b5d6, 120, 380);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 800);
  camera.position.set(0, 8, 18);

  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x4a5a3a, 0.95));
  const sun = new THREE.DirectionalLight(0xfff2cc, 1.1);
  sun.position.set(120, 180, 60);
  scene.add(sun);
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(8, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xfff6c0, fog: false }));
  sunMesh.position.set(180, 140, -120); scene.add(sunMesh);
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (const [cx, cy, cz] of [[-80, 55, -100], [60, 62, 80], [120, 50, -40], [-40, 58, 140]]) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(9, 8, 6), cloudMat);
    c.scale.set(1.8, 0.6, 1); c.position.set(cx, cy, cz); scene.add(c);
  }

  // --- shared state S (contract) -------------------------------------------
  const S = {
    scene, camera, renderer,
    player: null, cars: [], enemies: [], pickups: [], allies: [],
    mission: null, missionsDone: [...(save.missionsDone || [])],
    cash: save.cash ?? 500, respect: save.respect ?? 0, wanted: 0,
    crew: save.crew || defaultSave().crew,
    ownedCars: save.ownedCars || ['vela'],
    upgrades: save.upgrades || {},
    weapon: save.weapon || 'fists',
    ownedWeapons: save.ownedWeapons || ['fists'],
    ammo: save.ammo || {},
    race: null, racesWon: [...(save.racesWon || [])],
    markers: [], time: 0, input,
    world: { landmarks: LANDMARKS, colliders: [] },
    paused: false,
    overlay: null, // hud/economy-owned: null | 'garage' | 'shop'
    overlayOpen: null, // main-owned overlays: null | 'map' | 'brief'
    weaponWheelOpen: false, // combat.js sets this while Q is held
    cameraYaw: Math.PI / 4, // canonical camera yaw (player.js + cars.js use it)
    camYaw: Math.PI / 4, // alias, kept in sync
    camPitch: 0.32, camDist: 8,
    cameraTarget: null,
    config: mods.config || null,
    saveGame: () => saveGame(S),
    save: () => saveGame(S), // missions.js/economy.js call S.save()
    showBrief: (title, text) => showBrief(title, text),
    closeOverlays: () => closeMainOverlays(),
  };
  S.addWanted = (n) => (mods.police?.addWanted ? mods.police.addWanted(S, n)
    : (S.wanted = Math.max(0, Math.min(5, S.wanted + (n || 0)))));
  window.ISLA_BRASA = S; // debug / headless verification handle
  window.__THREE__ = THREE;

  // --- world ---------------------------------------------------------------
  if (mods.world?.buildWorld) {
    try {
      const w = mods.world.buildWorld(scene);
      if (w && w.landmarks) S.world.landmarks = w.landmarks;
      if (w && w.colliders) S.world.colliders = w.colliders;
      if (w && w.spawnPoints) S.world.spawnPoints = w.spawnPoints;
    } catch (err) {
      console.warn('[main] buildWorld failed, using fallback world:', err);
      S.world = fallbackBuildWorld(scene);
    }
  } else {
    S.world = fallbackBuildWorld(scene);
  }
  if (!S.world.landmarks) S.world.landmarks = LANDMARKS;
  if (!S.world.colliders) S.world.colliders = [];
  const spawnPos = S.world.spawnPoints?.player || { x: 10, z: 10 };

  // --- player --------------------------------------------------------------
  if (mods.player?.createPlayer) {
    try { S.player = mods.player.createPlayer(scene, spawnPos); }
    catch (err) { console.warn('[main] createPlayer failed, using fallback:', err); S.player = fallbackCreatePlayer(scene, spawnPos); }
  } else {
    S.player = fallbackCreatePlayer(scene, spawnPos);
  }

  // --- cars ----------------------------------------------------------------
  if (mods.cars?.spawnParkedCars) {
    try { mods.cars.spawnParkedCars(S); } catch (err) { console.warn('[main] spawnParkedCars failed:', err); }
  }
  if (S.cars.length === 0) {
    S.cars = [
      fallbackCreateCar(scene, 6, 4, 0xc0392b, 'sedan'),
      fallbackCreateCar(scene, -8, -6, 0x2980b9, 'hatch'),
      fallbackCreateCar(scene, 60, -108, 0xf39c12, 'sport'),
      fallbackCreateCar(scene, 120, -48, 0x8e44ad, 'muscle'),
    ];
  }

  // --- spawn hooks (missions.js calls these; the hook MUST push the created
  // object into S.enemies / S.pickups / S.cars — missions.js only pushes
  // when the hook is absent) ------------------------------------------------
  S.spawnEnemy = (x, z) => {
    if (mods.combat?.createEnemy) {
      const e = mods.combat.createEnemy(scene, { x, z }, 'thug');
      if (e) { S.enemies.push(e); return e; }
    }
    const e = { x, z, pos: new THREE.Vector3(x, 0, z), hp: 60, maxHp: 60, alive: true, kind: 'thug' };
    S.enemies.push(e);
    return e;
  };
  S.spawnPickup = (x, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9),
      new THREE.MeshBasicMaterial({ color: 0xffd700 }));
    mesh.position.set(x, 1, z);
    scene.add(mesh);
    const p = { x, z, pos: mesh.position, mesh, taken: false, mission: true, kind: 'crate' };
    S.pickups.push(p);
    return p;
  };
  S.spawnCar = (typeId, x, z) => {
    if (mods.cars?.createCar) {
      const c = mods.cars.createCar(scene, typeId, { x, z });
      if (c) { S.cars.push(c); return c; }
    }
    const c = fallbackCreateCar(scene, x, z, 0xd23c2a, String(typeId));
    S.cars.push(c);
    return c;
  };
  // Pickups are collected by walking over them (within 2.2 units) or via F
  // (player.js calls S.onPickup for the nearest pickup). No sibling module
  // collects them, so main.js owns this.
  S.onPickup = (pk) => {
    if (!pk || pk.taken) return;
    pk.taken = true;
    if (pk.mesh && scene) scene.remove(pk.mesh);
  };

  // --- mission beacon (shared 3D marker; missions.js sets S.markers /
  // S.beacon, main.js renders them here) ------------------------------------
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.35 });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 60, 12, 1, true), beaconMat);
  beacon.visible = false; scene.add(beacon);
  S._beacon = beacon;
  const markerMesh = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd700 }));
  markerMesh.visible = false; scene.add(markerMesh);
  S._markerMesh = markerMesh;

  // --- update functions (module or fallback) -------------------------------
  const updatePlayer = mods.player?.updatePlayer
    ? (dt) => mods.player.updatePlayer(S, dt)
    : (dt) => fallbackUpdatePlayer(S, dt);
  const updateCars = mods.cars?.updateCar
    ? (dt) => { for (const car of [...S.cars]) mods.cars.updateCar(S, car, dt); }
    : (dt) => fallbackUpdateCars(S, dt);
  const updateCombat = mods.combat?.updateCombat
    ? (dt) => mods.combat.updateCombat(S, dt)
    : () => {};
  const updatePolice = mods.police?.updatePolice
    ? (dt) => mods.police.updatePolice(S, dt)
    : () => {};
  const updateMissions = mods.missions?.updateMission
    ? (dt) => mods.missions.updateMission(S, dt)
    : (dt) => fallbackUpdateMissions(S, dt);
  const updateRace = mods.missions?.updateRace
    ? (dt) => mods.missions.updateRace(S, dt)
    : () => {};
  const updateHUD = mods.hud?.updateHUD
    ? () => mods.hud.updateHUD(S)
    : () => { fallbackUpdateHUD(S); drawMinimap(S); };

  S.startMission = (id) => {
    if (mods.missions?.startMission) return mods.missions.startMission(S, id);
    return fallbackStartMission(S, id);
  };
  S.startRace = (id) => {
    if (mods.missions?.startRace) return mods.missions.startRace(S, id);
    return { ok: false, error: 'races not available' };
  };
  S.MISSIONS = mods.config?.MISSIONS || FALLBACK_MISSIONS;
  S.RACES = mods.config?.RACES || [];

  // --- input / overlays ------------------------------------------------------
  input.attach(window);
  wireOverlays(S, mods);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- loop ------------------------------------------------------------------
  const clock = new THREE.Clock();
  let lastMissionsDone = S.missionsDone.length;
  let lastCash = S.cash;
  let autosaveAt = 0;
  let seenResult = null;
  let failAt = -100;

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05); // fixed-dt clamp
    // Input aliases other workers read: player.js checks S.input.clicked,
    // combat.js checks S.input.mouseHeld.
    input.clicked = input.mouse.clicked;
    input.mouseHeld = input.mouse.down;
    handleOverlayKeys(S, mods);
    // Pause while any overlay is open (garage/shop via S.overlay, map/brief
    // via S.overlayOpen). The weapon wheel does NOT pause the game.
    S.paused = !!(S.overlay || S.overlayOpen);
    if (!S.paused) {
      S.time += dt;
      updatePlayer(dt);
      updateCars(dt);
      updateCombat(dt);
      updatePolice(dt);
      updateMissions(dt);
      updateRace(dt);
      collectNearbyPickups(S);
      // Auto-start the next mission when none is active (missions.js has
      // no auto-start; the HUD just says "Next: …"). Wait 2 s after a
      // failure so the player sees the fail banner first.
      if (!S.mission && !S.race && mods.missions?.nextMissionId) {
        const r = S.lastMissionResult;
        if (r !== seenResult) {
          seenResult = r;
          if (r && !r.ok) failAt = S.time;
        }
        if (S.time - failAt > 2) {
          const next = mods.missions.nextMissionId(S);
          if (next != null) S.startMission(next);
        }
      }
      updateCamera(S, dt);
      updateBeacon(S, mods);
    }
    // combat.js sets only player.weapon; the HUD reads S.weapon.
    if (S.player && typeof S.player.weapon === 'string') S.weapon = S.player.weapon;
    S.camYaw = S.cameraYaw;
    updateHUD();
    // Save after missions / economy change, plus a 30 s autosave.
    if (S.missionsDone.length !== lastMissionsDone || S.cash !== lastCash) {
      saveGame(S); lastMissionsDone = S.missionsDone.length; lastCash = S.cash;
    }
    if (S.time - autosaveAt > 30) { saveGame(S); autosaveAt = S.time; }
    input.update(); // end of frame: clear edge flags / drag deltas (see input.js)
    renderer.render(scene, camera);
  }
  animate();
  console.log('[main] ISLA BRASA 3D booted. Cash $' + S.cash + ', missions done: ' + S.missionsDone.length);
}

// Pickups within 2.2 units of the player are collected (walk-over).
function collectNearbyPickups(S) {
  const pos = playerPos(S);
  if (!pos) return;
  for (const pk of S.pickups || []) {
    if (pk.taken) continue;
    const pp = objPos(pk);
    if (!pp) continue;
    if (Math.hypot(pp.x - pos.x, pp.z - pos.z) < 2.2) S.onPickup(pk);
  }
}

// ---------------------------------------------------------------------------
// Fallback player movement (camera-relative WASD, Shift run, Space jump,
// E enter/exit nearest car, AABB push-out, limb swing). Only used if
// player.js is absent; it uses S.cameraYaw like the real player.js.
// ---------------------------------------------------------------------------
function fallbackUpdatePlayer(S, dt) {
  const p = S.player;
  if (!p) return;
  if (p.inCar) return; // driving is handled by fallbackUpdateCars
  const speed = input.run ? 9 : 5;
  let fx = 0, fz = 0;
  const yaw = S.cameraYaw;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  // Forward (camera-relative) is (-sin yaw, -cos yaw).
  if (input.moveForward) { fx -= sin; fz -= cos; }
  if (input.moveBack) { fx += sin; fz += cos; }
  if (input.moveLeft) { fx -= cos; fz += sin; }
  if (input.moveRight) { fx += cos; fz -= sin; }
  const len = Math.hypot(fx, fz);
  if (len > 0) {
    fx /= len; fz /= len;
    p.position.x += fx * speed * dt;
    p.position.z += fz * speed * dt;
    p.heading = Math.atan2(fx, fz);
    p._walkPhase = (p._walkPhase || 0) + dt * (input.run ? 13 : 9);
    const swing = Math.sin(p._walkPhase) * 0.6;
    if (p._legL) { p._legL.rotation.x = swing; p._legR.rotation.x = -swing; }
    if (p._armL) { p._armL.rotation.x = -swing; p._armR.rotation.x = swing; }
    p.speed = speed;
  } else {
    p.speed = 0;
    if (p._legL) { p._legL.rotation.x *= 0.8; p._legR.rotation.x *= 0.8; }
    if (p._armL) { p._armL.rotation.x *= 0.8; p._armR.rotation.x *= 0.8; }
  }
  if (input.jump && p.grounded) { p.vy = 7; p.grounded = false; }
  if (!p.grounded) {
    p.vy -= 22 * dt;
    p.position.y += p.vy * dt;
    if (p.position.y <= 0) { p.position.y = 0; p.vy = 0; p.grounded = true; }
  }
  p.position.x = THREE.MathUtils.clamp(p.position.x, -CITY, CITY);
  p.position.z = THREE.MathUtils.clamp(p.position.z, -CITY, CITY);
  pushOutOfColliders(p.position, 0.6, S.world.colliders);
  if (p.group) p.group.rotation.y = p.heading;
  if (S.cameraTarget) S.cameraTarget.set(p.position.x, p.position.y + 1.6, p.position.z);
  if (input.pressed('KeyE')) {
    let best = null, bestD = 4;
    for (const car of S.cars) {
      const cp = objPos(car);
      if (!cp) continue;
      const d = Math.hypot(cp.x - p.position.x, cp.z - p.position.z);
      if (d < bestD) { best = car; bestD = d; }
    }
    if (best) {
      p.inCar = true; p.currentCar = best; best.driver = p;
      if (p.group) p.group.visible = false;
    }
  }
}

function fallbackUpdateCars(S, dt) {
  const p = S.player;
  for (const car of S.cars) {
    const cp = objPos(car);
    if (!cp) continue;
    if (p && p.inCar && p.currentCar === car) {
      const top = (car.topSpeed || 26) * (1 + 0.15 * ((S.upgrades[car.name]?.engine) || 0));
      if (input.moveForward) car.speed = Math.min(car.speed + (car.accel || 14) * dt, top);
      else if (input.moveBack) car.speed = Math.max(car.speed - (car.accel || 14) * dt, -10);
      else car.speed *= Math.max(0, 1 - 1.2 * dt);
      const steer = (input.moveLeft ? 1 : 0) - (input.moveRight ? 1 : 0);
      if (Math.abs(car.speed) > 0.1) {
        car.heading += steer * 1.9 * dt * Math.sign(car.speed) * (car.handling || 1);
      }
      cp.x += Math.sin(car.heading) * car.speed * dt;
      cp.z += Math.cos(car.heading) * car.speed * dt;
      cp.x = THREE.MathUtils.clamp(cp.x, -CITY, CITY);
      cp.z = THREE.MathUtils.clamp(cp.z, -CITY, CITY);
      pushOutOfColliders(cp, 1.6, S.world.colliders);
      if (car.group) car.group.rotation.y = car.heading;
      if (input.pressed('KeyE')) {
        p.inCar = false; p.currentCar = null; car.driver = null; car.speed = 0;
        p.position.set(cp.x + 3, 0, cp.z);
        if (p.group) p.group.visible = true;
      }
    } else if (car.group) {
      car.group.rotation.y = car.heading;
    }
  }
}

// ---------------------------------------------------------------------------
// Fallback missions: the 12 missions from the design + round-4 specs, so the
// tracker/brief/beacon work even before missions.js lands. Only 'goto' /
// 'deliver' steps are playable in the fallback (collect/clear/steal need
// combat.js / pickups); missions.js replaces this entirely when present.
// ---------------------------------------------------------------------------
const FALLBACK_MISSIONS = [
  { id: 1, name: 'Tamale Run', payout: 740, brief: 'Pick up tamales at the market and deliver them to Rook Arcade.', steps: [{ kind: 'goto', at: 'market', label: 'Reach Feria Market' }, { kind: 'deliver', at: 'arcade', label: 'Deliver to Rook Arcade' }] },
  { id: 2, name: 'The Vela Job', payout: 800, brief: 'Lift the package at Motel Vela and bring it back to Rook.', steps: [{ kind: 'goto', at: 'motel', label: 'Reach Motel Vela' }, { kind: 'deliver', at: 'arcade', label: 'Deliver to Rook Arcade' }] },
  { id: 3, name: 'Feria Shakedown', payout: 990, brief: "Delgado's men are shaking down the market stalls. Clear them out, grab the cash, and take a getaway car.", steps: [{ kind: 'clear', at: 'market', count: 5, label: "Clear 5 of Delgado's men" }, { kind: 'collect', at: 'market', count: 2, label: 'Collect the cash' }, { kind: 'steal', at: 'market', label: 'Take a getaway car' }, { kind: 'deliver', at: 'arcade', label: 'Bring it to Rook Arcade' }] },
  { id: 4, name: 'Coral Room Getaway', payout: 1300, timed: 150, brief: 'Hit the Coral Room Casino, grab the chips, and lose the cops in the Coast Tunnel. 150 seconds.', steps: [{ kind: 'goto', at: 'casino', label: 'Reach the casino' }, { kind: 'collect', at: 'casino', count: 3, label: 'Grab 3 chip cases' }, { kind: 'deliver', at: 'tunnel', label: 'Escape to the Coast Tunnel' }] },
  { id: 5, name: 'Last Call', payout: 850, brief: 'Four drops, one night: the pier, the motel, the underpass and the church. Then report back to Rook.', steps: [{ kind: 'deliver', at: 'pier', label: 'Drop 1: Old Pier' }, { kind: 'deliver', at: 'motel', label: 'Drop 2: Motel Vela' }, { kind: 'deliver', at: 'underpass', label: 'Drop 3: Underpass' }, { kind: 'deliver', at: 'church', label: 'Drop 4: Old Church' }, { kind: 'goto', at: 'arcade', label: 'Report to Rook Arcade' }] },
  { id: 6, name: 'Dawn Dash', payout: 880, timed: 120, brief: 'Rush delivery: hot plates from the market to the beach AND the plaza before the sun is up. 120 seconds.', steps: [{ kind: 'collect', at: 'market', count: 2, label: 'Pick up the plates' }, { kind: 'deliver', at: 'beach', label: 'Deliver to the Beachfront' }, { kind: 'deliver', at: 'plaza', label: 'Deliver to Plaza Tower' }] },
  { id: 7, name: 'Hot Plate', payout: 860, timed: 90, brief: "A rival crew's courier car is waiting at the marina. Take it and get the plaza tower menu there by lunch. 90 seconds.", steps: [{ kind: 'steal', at: 'marina', label: 'Take the courier car' }, { kind: 'deliver', at: 'plaza', label: 'Deliver to Plaza Tower' }] },
  { id: 8, name: 'Pier Pressure', payout: 750, brief: "Crates are piling up at the pier and Delgado's crew is guarding them. Clear the crew, grab the crates, stash them at the church.", steps: [{ kind: 'clear', at: 'pier', count: 3, label: 'Clear 3 guards' }, { kind: 'collect', at: 'pier', count: 5, label: 'Collect 5 crates' }, { kind: 'deliver', at: 'church', label: 'Stash them at the Old Church' }] },
  { id: 9, name: 'Motel Stakeout', payout: 800, brief: 'A snitch is holed up at Motel Vela. Get close, grab the ledger, deal with his guards, and slip away to Rook.', steps: [{ kind: 'goto', at: 'motel', label: 'Reach Motel Vela' }, { kind: 'collect', at: 'motel', count: 1, label: 'Grab the ledger' }, { kind: 'clear', at: 'motel', count: 2, label: 'Deal with 2 guards' }, { kind: 'deliver', at: 'arcade', label: 'Bring it to Rook Arcade' }] },
  { id: 10, name: 'Tunnel Run', payout: 820, brief: 'The Coast Tunnel is the only way past the roadblocks tonight. Take a fast car, thread the tunnel, and hit the marina then the beach.', steps: [{ kind: 'steal', at: 'tunnel', label: 'Take a fast car' }, { kind: 'deliver', at: 'marina', label: 'Drop 1: Marina Docks' }, { kind: 'deliver', at: 'beach', label: 'Drop 2: Beachfront' }] },
  { id: 11, name: 'Casino Chips', payout: 850, brief: 'The Coral Room is moving chips. Hit the casino floor, take the cases, then fight off the reinforcements at the plaza and keep the cut.', steps: [{ kind: 'clear', at: 'casino', count: 5, label: 'Clear 5 guards' }, { kind: 'collect', at: 'casino', count: 3, label: 'Take 3 chip cases' }, { kind: 'clear', at: 'plaza', count: 3, label: 'Fight off 3 reinforcements' }, { kind: 'deliver', at: 'plaza', label: 'Keep the cut at Plaza Tower' }] },
  { id: 12, name: 'The Big One', payout: 870, timed: 240, brief: 'The final heist: lift the vault cash at the casino, clear the guards, take the getaway car, shake the tail at the beach, and meet Rook. 240 seconds.', steps: [{ kind: 'goto', at: 'casino', label: 'Reach the casino' }, { kind: 'clear', at: 'casino', count: 4, label: 'Clear 4 guards' }, { kind: 'collect', at: 'casino', count: 3, label: 'Grab 3 vault cases' }, { kind: 'steal', at: 'casino', label: 'Take the getaway car' }, { kind: 'deliver', at: 'beach', label: 'Shake the tail at the Beachfront' }, { kind: 'goto', at: 'arcade', label: 'Meet Rook and finish' }] },
];

function fallbackStartMission(S, id) {
  const def = FALLBACK_MISSIONS.find((m) => m.id === id);
  if (!def) return { ok: false, error: 'unknown mission' };
  S.mission = { id: def.id, def, stepIndex: 0, timeLeft: def.timed || null, startedAt: S.time };
  S.showBrief(def.name, def.brief + ` Payout: $${def.payout}.`);
  return { ok: true, mission: S.mission };
}

function fallbackUpdateMissions(S, dt) {
  if (!S.mission) return;
  const m = S.mission;
  if (m.timeLeft != null) {
    m.timeLeft -= dt;
    if (m.timeLeft <= 0) { S.mission = null; S.showBrief('Mission failed', `${m.def.name} — out of time.`); return; }
  }
  const step = m.def.steps[m.stepIndex];
  if (!step) return;
  const lm = S.world.landmarks[step.at];
  if (!lm) return;
  const pos = playerPos(S);
  if (!pos) return;
  const d = Math.hypot(pos.x - lm.x, pos.z - lm.z);
  S._missionTarget = { x: lm.x, z: lm.z, dist: d, label: step.label };
  if ((step.kind === 'goto' || step.kind === 'deliver') && d < 12) {
    m.stepIndex++;
    if (m.stepIndex >= m.def.steps.length) {
      S.cash += m.def.payout;
      S.respect += 250;
      S.missionsDone.push(m.id);
      S.showBrief('Mission complete!', `${m.def.name} — +$${m.def.payout}, +250 respect.`);
      S.mission = null;
      saveGame(S);
    }
  }
}

// ---------------------------------------------------------------------------
// Third-person camera. Canonical yaw is S.cameraYaw: the view forward is
// (-sin yaw, -cos yaw), so the camera sits behind the target at
// +(sin yaw, cos yaw) * distance. Mouse drag orbits; while driving,
// cars.js eases S.cameraYaw toward car.yaw + PI. Arrow keys are movement
// keys in player.js/cars.js, so they do NOT orbit. Q is the weapon wheel
// and E is enter/exit car, so neither orbits either — drag is the orbit.
// Anti-clip: if the camera point lands inside a building AABB, pull it in
// close to the target and raise it.
// ---------------------------------------------------------------------------
function updateCamera(S, dt) {
  const drag = input.consumeDrag();
  S.cameraYaw -= drag.dx * 0.005;
  S.camPitch = THREE.MathUtils.clamp(S.camPitch + drag.dy * 0.004, 0.08, 1.1);
  if (input.mouse.wheelDelta) {
    S.camDist = THREE.MathUtils.clamp(S.camDist + input.mouse.wheelDelta * 0.01, 5, 14);
  }

  const target = S.cameraTarget || (() => {
    const pos = playerPos(S);
    return pos ? new THREE.Vector3(pos.x, (pos.y || 0) + 1.6, pos.z) : new THREE.Vector3(0, 2, 0);
  })();
  const dist = playerInCar(S) ? S.camDist + 2 : S.camDist;
  const cp = Math.cos(S.camPitch), sp = Math.sin(S.camPitch);
  let cx = target.x + Math.sin(S.cameraYaw) * cp * dist;
  let cz = target.z + Math.cos(S.cameraYaw) * cp * dist;
  let cy = target.y + sp * dist;
  for (const c of S.world.colliders) {
    if (cx > c.minX && cx < c.maxX && cz > c.minZ && cz < c.maxZ && cy < 24) {
      // Pull in close and high instead of clipping through the building.
      cx = target.x + Math.sin(S.cameraYaw) * 3;
      cz = target.z + Math.cos(S.cameraYaw) * 3;
      cy = Math.max(cy, 24);
      break;
    }
  }
  cy = Math.max(cy, 1.4);
  S.camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 10));
  S.camera.lookAt(target.x, target.y, target.z);
}

function currentTarget(S, mods) {
  if (mods?.missions?.missionMarker) {
    try {
      const t = mods.missions.missionMarker(S);
      if (t) {
        const pos = playerPos(S);
        return { ...t, dist: pos ? Math.hypot(pos.x - t.x, pos.z - t.z) : null };
      }
    } catch { /* fall through to fallback target */ }
  }
  return S._missionTarget || null;
}

function updateBeacon(S, mods) {
  const t = currentTarget(S, mods);
  const beacon = S._beacon, marker = S._markerMesh;
  if (!t || (!S.mission && !S.race)) {
    if (beacon) beacon.visible = false;
    if (marker) marker.visible = false;
    return;
  }
  S._missionTarget = t;
  beacon.position.set(t.x, 30, t.z);
  beacon.visible = true;
  beacon.rotation.y += 0.02;
  marker.position.set(t.x, 2 + Math.sin(S.time * 3) * 0.4, t.z);
  marker.visible = true;
}

// ---------------------------------------------------------------------------
// HUD fallback (hud.js replaces this when present). Updates the DOM ids
// defined in index.html; never throws if an element is missing.
// ---------------------------------------------------------------------------
function fallbackUpdateHUD(S) {
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('hud-cash', '$' + Math.floor(S.cash).toLocaleString('en-US'));
  set('hud-respect', `${respectRank(S.respect).name} (${Math.floor(S.respect).toLocaleString('en-US')})`);
  const stars = $('hud-wanted');
  if (stars) stars.textContent = '★'.repeat(S.wanted) + '☆'.repeat(Math.max(0, 5 - S.wanted));
  set('hud-weapon', S.weapon || 'fists');
  const m = S.mission;
  const tracker = $('hud-mission');
  if (tracker) {
    if (!m) {
      const done = S.missionsDone.length;
      tracker.textContent = `Missions ${done}/12 — Next: ${(S.MISSIONS.find((x) => !S.missionsDone.includes(x.id)) || {}).name || 'All done!'}`;
    } else {
      const step = m.def.steps[m.stepIndex];
      const time = m.timeLeft != null ? ` — ${Math.ceil(m.timeLeft)}s` : '';
      tracker.textContent = `${m.def.name} ($${m.def.payout})${time} — ${step ? step.label : ''} (step ${Math.min(m.stepIndex + 1, m.def.steps.length)}/${m.def.steps.length})`;
    }
  }
  const arrow = $('hud-arrow');
  if (arrow) {
    const t = S._missionTarget;
    arrow.textContent = t ? `➤ ${t.label} — ${Math.round(t.dist)}m` : '';
  }
}

function drawMinimap(S) {
  const canvas = $('minimap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const toMap = (x, z) => [((x + CITY) / (CITY * 2)) * W, ((z + CITY) / (CITY * 2)) * H];
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1a2a1a'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1e6f9e';
  ctx.fillRect(0, 0, (30 / 400) * W, H); // west water
  ctx.fillRect(0, (370 / 400) * H, W, (30 / 400) * H); // south water
  ctx.strokeStyle = '#333'; ctx.strokeRect(0, 0, W, H);
  for (const lm of Object.values(S.world.landmarks)) {
    const [mx, my] = toMap(lm.x, lm.z);
    ctx.fillStyle = '#ffd700'; ctx.fillRect(mx - 2, my - 2, 4, 4);
  }
  const t = S._missionTarget;
  if (t && S.mission) {
    const [mx, my] = toMap(t.x, t.z);
    ctx.fillStyle = '#ff4040';
    ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.fill();
  }
  const pos = playerPos(S);
  if (pos) {
    const [mx, my] = toMap(pos.x, pos.z);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.stroke();
  }
  for (const car of S.cars || []) {
    const cp = objPos(car);
    if (!cp) continue;
    const [mx, my] = toMap(cp.x, cp.z);
    ctx.fillStyle = '#7ab8ff'; ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
  }
}

// ---------------------------------------------------------------------------
// Overlays. Ownership: weapon wheel = combat.js (S.weaponWheelOpen) +
// hud.js (renders #weapon-wheel); garage/shop = economy.js (S.overlay) +
// hud.js (renders #game-overlay). Main.js owns only the map + mission-brief
// overlays (S.overlayOpen) and the keys that open/close things.
// G cycles garage -> shop -> closed (economy.js, or the fallback shop panel
// below when economy.js is absent). R tries every race until one starts
// (missions.startRace checks the 15-unit start distance itself).
// ---------------------------------------------------------------------------
function openMainOverlay(S, name) {
  S.overlayOpen = name;
  for (const id of ['map-overlay', 'mission-brief']) {
    const el = $(id); if (el) el.classList.add('hidden');
  }
  const map = { map: 'map-overlay', brief: 'mission-brief' };
  const el = $(map[name]); if (el) el.classList.remove('hidden');
}

function closeMainOverlays() {
  const S = window.ISLA_BRASA;
  if (S) S.overlayOpen = null;
  for (const id of ['map-overlay', 'mission-brief']) {
    const el = $(id); if (el) el.classList.add('hidden');
  }
}

function showBrief(title, text) {
  const t = $('brief-title'), b = $('brief-text');
  if (t) t.textContent = title;
  if (b) b.textContent = text;
  const S = window.ISLA_BRASA;
  if (S) openMainOverlay(S, 'brief');
}

// Fallback shop panel (only when economy.js is absent; hud.js + economy.js
// render the real garage/shop as #game-overlay from S.overlay).
function renderShop(S) {
  const el = $('shop-content');
  if (!el) return;
  const cars = [
    { id: 'vela', name: 'Vela', price: 2800 },
    { id: 'coyote', name: 'Coyote', price: 4200 },
    { id: 'brasa', name: 'Brasa GT', price: 6500 },
    { id: 'cometa', name: 'Cometa', price: 12000 },
  ];
  const crew = [
    { id: 'rico', name: 'Rico Vega — driver', price: 1500 },
    { id: 'marta', name: 'Marta Solis — gunman', price: 2000 },
    { id: 'ghost', name: 'Ghost — hacker', price: 2500 },
  ];
  el.innerHTML = `
    <h3>Garage — buy cars</h3>
    ${cars.map((c) => `<div>${c.name} — $${c.price.toLocaleString()} ${S.ownedCars.includes(c.id) ? '(owned)' : `<button data-buy-car="${c.id}" data-price="${c.price}">Buy</button>`}</div>`).join('')}
    <h3>Crew</h3>
    ${crew.map((c) => `<div>${c.name} — $${c.price.toLocaleString()} ${S.crew[c.id]?.hired ? `(hired, level ${S.crew[c.id].level})` : `<button data-hire="${c.id}" data-price="${c.price}">Hire</button>`}</div>`).join('')}
    <p>Cash: $${Math.floor(S.cash).toLocaleString()}. Sell: 60% of car price + 40% of upgrades (at the garage).</p>`;
  el.querySelectorAll('[data-buy-car]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const price = Number(btn.dataset.price);
      if (S.cash >= price && !S.ownedCars.includes(btn.dataset.buyCar)) {
        S.cash -= price; S.ownedCars.push(btn.dataset.buyCar);
        saveGame(S); renderShop(S);
      }
    });
  });
  el.querySelectorAll('[data-hire]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const price = Number(btn.dataset.price);
      const id = btn.dataset.hire;
      if (S.cash >= price && !S.crew[id]?.hired) {
        S.cash -= price; S.crew[id] = { hired: true, level: 1 };
        saveGame(S); renderShop(S);
      }
    });
  });
}

function handleOverlayKeys(S, mods) {
  if (input.pressed('KeyG')) {
    if (mods.economy) {
      if (S.overlay === 'garage') mods.economy.openShop(S);
      else if (S.overlay === 'shop') mods.economy.closeShop(S);
      else mods.economy.openGarage(S);
    } else if (S.overlayOpen === 'shop') {
      closeMainOverlays();
    } else {
      S.overlayOpen = 'shop';
      const el = $('shop-overlay'); if (el) el.classList.remove('hidden');
      renderShop(S);
    }
  }
  if (input.pressed('KeyM')) {
    if (S.overlayOpen === 'map') closeMainOverlays(); else openMainOverlay(S, 'map');
  }
  if (input.pressed('KeyR') && !S.race && S.startRace) {
    for (const race of S.RACES || []) {
      const r = S.startRace(race.id);
      if (r && r.ok) break;
    }
  }
  if (input.pressed('Escape')) {
    S.overlay = null;
    closeMainOverlays();
    const shop = $('shop-overlay'); if (shop) shop.classList.add('hidden');
  }
  if (input.pressed('KeyF') && S.overlayOpen === 'brief') closeMainOverlays();
  // Q (weapon wheel) is owned by combat.js + hud.js; main.js does not touch it.
}

function wireOverlays(S, mods) {
  const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  bind('close-shop', () => { closeMainOverlays(); });
  bind('close-map', () => closeMainOverlays());
  bind('close-brief', () => closeMainOverlays());
  bind('close-help', () => { const el = $('help-overlay'); if (el) el.classList.add('hidden'); });
  bind('help-btn', () => { const el = $('help-overlay'); if (el) el.classList.remove('hidden'); });
  bind('brief-accept', () => closeMainOverlays());
}

boot().catch((err) => {
  console.error('[main] boot failed:', err);
  const el = document.getElementById('load-error');
  if (el) { el.classList.remove('hidden'); el.textContent = 'Failed to load ISLA BRASA 3D: ' + err.message; }
});
