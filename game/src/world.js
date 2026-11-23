// world.js — builds the entire 3D city of ISLA BRASA 3D.
// Y-up, ground plane XZ, city ~400x400 (x,z in [-200,200]).
// Built from the design spec only. Shared geometries/materials are reused
// so draw calls stay sane; buildWorld() runs once (no per-frame work here).
import * as THREE from 'three';
import { SHOP_POSITIONS, INTERIORS, PROPERTIES, RUNWAY } from './config.js';

// Worker G: enterable-interior door positions (from config INTERIORS) and
// buyable-property marker positions (from config PROPERTIES).
export function doorMarkers() {
  return Object.values(INTERIORS).map((d) => ({ id: d.id, name: d.name, x: d.door.x, z: d.door.z }));
}

export function propertyMarkers() {
  return Object.values(PROPERTIES).map((p) => ({ id: p.id, name: p.name, x: p.at.x, z: p.at.z, price: p.price, dailyIncome: p.dailyIncome }));
}

// ---- night-glow registry (Worker A) ---------------------------------------
// Shared lamp-head + window materials are collected here at build time so
// setNightGlow() can dim/brighten them at dusk/dawn; the sky dome material
// is kept too so daynight.js can tint it dark at night.
const nightLampMats = [];
const nightWindowMats = [];
let skyDomeMat = null;

// ---- wet-ground registry (Worker E) ---------------------------------------
// Ground + road materials captured at build time so setWetGround() can
// darken them and drop their roughness when it rains.
let wetGroundMat = null;
let wetRoadMat = null;
let wetGroundOrig = null;
let wetRoadOrig = null;

// ---------------------------------------------------------------------------
// Fixed landmark coordinates — every worker uses these exact numbers.
// ---------------------------------------------------------------------------
export const LANDMARK_POSITIONS = {
  market: { x: -120, z: -80 },
  pier: { x: -180, z: 120 },
  marina: { x: -160, z: -160 },
  garage: { x: 60, z: -120 },
  arcade: { x: 0, z: 0 },
  casino: { x: 120, z: -60 },
  tunnel: { x: 150, z: 100 },
  motel: { x: -60, z: 140 },
  underpass: { x: 100, z: 40 },
  church: { x: -40, z: -140 },
  plaza: { x: 80, z: 80 },
  beach: { x: 0, z: 180 },
};

export function landmarkPos(name) {
  const p = LANDMARK_POSITIONS[name];
  return p ? { x: p.x, z: p.z } : null;
}

// Walkable sidewalk points for pedestrians: along each road line, offset
// ~7.5u to the side (sidewalk band is 6..9u from the road centre), every
// 20u, skipping water (x < -170, z > 170) and building colliders is left to
// the pedestrian's own push-out. Returns [{x, z}, ...].
export function sidewalkPoints(S) {
  const pts = [];
  for (const c of ROAD_LINES) {
    for (let t = -160; t <= 160; t += 20) {
      for (const off of [-7.5, 7.5]) {
        pts.push({ x: c + off, z: t });
        pts.push({ x: t, z: c + off });
      }
    }
  }
  const colliders = S?.world?.colliders || [];
  return pts.filter((p) => {
    if (p.x < -168 || p.x > 198 || p.z < -198 || p.z > 168) return false;
    return !colliders.some((col) => col.minX !== undefined &&
      p.x > col.minX - 1 && p.x < col.maxX + 1 && p.z > col.minZ - 1 && p.z < col.maxZ + 1);
  });
}

// Roads run along these lines (both axes). Road half-width 6, sidewalk 9.
export const ROAD_LINES = [-160, -80, 0, 80, 160];
const ROAD_HALF = 6;
const WALK_HALF = 9;

// Boat moorings on the water (west strip x < -170, south strip z > 170) and
// the motorbike parking spot by Brasa Garage.
export const BOAT_SPAWNS = [
  { x: -185, z: -150 }, // marina docks
  { x: 30, z: 186 },    // beachfront south water
  { x: -190, z: 60 },   // west water, clear of the pier deck
];
export const BIKE_SPAWN = { x: 72, z: -110 }; // by Brasa Garage (60,-120)

/** Road graph for traffic.js: nodes at every road-line intersection, with
 *  an adjacency list (same-row / same-column neighbours only, so every
 *  segment runs straight along a road). Returns { nodes: [{x,z}], adjacent: [[idx]] }. */
export function roadNetwork(S) {
  const nodes = [];
  const indexOf = new Map();
  for (const x of ROAD_LINES) {
    for (const z of ROAD_LINES) {
      indexOf.set(`${x},${z}`, nodes.length);
      nodes.push({ x, z });
    }
  }
  const adjacent = nodes.map((n) => {
    const out = [];
    for (const [nx, nz] of [[n.x - 80, n.z], [n.x + 80, n.z], [n.x, n.z - 80], [n.x, n.z + 80]]) {
      const j = indexOf.get(`${nx},${nz}`);
      if (j !== undefined) out.push(j);
    }
    return out;
  });
  return { nodes, adjacent };
}

// Deterministic pseudo-random from two integers (stable layout, no Math.random).
function hash2(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------------------------------------------------------------------
// buildWorld
// ---------------------------------------------------------------------------
export function buildWorld(scene) {
  const colliders = [];
  const landmarks = {};
  const addCollider = (cx, cz, hw, hd) => {
    colliders.push({ minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd });
  };

  // ---- shared geometries --------------------------------------------------
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  const coneGeo = new THREE.ConeGeometry(1, 1, 6);
  const sphereGeo = new THREE.SphereGeometry(1, 12, 8);
  const planeGeo = new THREE.PlaneGeometry(1, 1);

  // ---- shared materials ---------------------------------------------------
  const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05, ...opts });
  const glow = (color) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, roughness: 0.4 });
  const M = {
    grass: mat(0x5d8f4e),
    sand: mat(0xe8d29a),
    road: mat(0x2e2e33, { roughness: 1 }),
    walk: mat(0x9a9a92),
    water: new THREE.MeshStandardMaterial({ color: 0x1e7fb8, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.9 }),
    wood: mat(0x8a5a2b),
    woodDark: mat(0x6b4423),
    white: mat(0xf2efe6),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.35, metalness: 0.7, emissive: 0x6b4d00, emissiveIntensity: 0.35 }),
    dark: mat(0x23233a),
    grey: mat(0x7a7a80),
    window: glow(0xffd977),
    neonPink: glow(0xff2e88),
    neonCyan: glow(0x22d3ee),
    neonOrange: glow(0xff7a1a),
    lampHead: glow(0xfff2b0),
    trunk: mat(0x7a5230),
    palm: mat(0x2f9e44),
    red: mat(0xc0392b),
    blue: mat(0x2471a3),
    teal: mat(0x148f77),
    yellow: mat(0xd4ac0d),
    purple: mat(0x6c3483),
    orange: mat(0xca6f1e),
    pink: mat(0xd86a92),
    crate: mat(0xa67c3d),
  };
  // Register the shared glow materials for the day/night cycle (Worker A):
  // lamps blaze at night, windows light up; both stay dim in daylight.
  if (!nightLampMats.includes(M.lampHead)) nightLampMats.push(M.lampHead);
  if (!nightWindowMats.includes(M.window)) nightWindowMats.push(M.window);
  // Wet-ground refs (Worker E): the base ground + asphalt materials.
  wetGroundMat = M.grass; wetRoadMat = M.road;
  wetGroundOrig = { color: M.grass.color.getHex(), roughness: M.grass.roughness };
  wetRoadOrig = { color: M.road.color.getHex(), roughness: M.road.roughness };
  M.lampHead.emissiveIntensity = 0.12; // day: lamps off
  M.window.emissiveIntensity = 0.25;   // day: windows dim
  const buildingMats = [M.red, M.blue, M.teal, M.purple, M.orange, M.grey, M.pink, M.yellow];
  const carPaints = [M.red, M.blue, M.teal, M.yellow, M.purple, M.white, M.orange];

  const addBox = (parent, material, w, h, d, x, y, z) => {
    const m = new THREE.Mesh(boxGeo, material);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const addPlane = (parent, material, w, d, x, y, z) => {
    const m = new THREE.Mesh(planeGeo, material);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w, d, 1);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // ---- sky visuals (lights are created by main.js) -----------------------
  scene.background = new THREE.Color(0x87ceeb);
  // Gradient sky dome: big inverted sphere with vertex-coloured gradient.
  {
    const skyGeo = new THREE.SphereGeometry(600, 16, 12);
    const top = new THREE.Color(0x3a7bd5);
    const horizon = new THREE.Color(0xcfeef7);
    const pos = skyGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp(pos.getY(i) / 600, 0, 1);
      c.copy(horizon).lerp(top, t);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    skyDomeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
    const sky = new THREE.Mesh(skyGeo, skyDomeMat);
    scene.add(sky);
  }
  // Sun: bright sphere high in the sky.
  {
    const sun = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xfff6b0, fog: false }));
    sun.scale.setScalar(18);
    sun.position.set(-220, 230, -260);
    scene.add(sun);
    const halo = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xfff9c9, transparent: true, opacity: 0.25, fog: false }));
    halo.scale.setScalar(30);
    halo.position.copy(sun.position);
    scene.add(halo);
  }
  // Clouds: low-poly flattened white blobs.
  const cloudSpots = [
    [-120, 85, -140], [40, 95, -120], [150, 80, -40], [-60, 90, 60],
    [120, 88, 140], [-150, 78, 20], [0, 100, 160], [180, 82, 80],
  ];
  for (const [cx, cy, cz] of cloudSpots) {
    const cloud = new THREE.Group();
    const puffs = [[0, 0, 0, 9], [8, -1, 1, 6], [-8, -1, -1, 6.5], [3, 2, -2, 5]];
    for (const [px, py, pz, s] of puffs) {
      const p = new THREE.Mesh(sphereGeo, M.white);
      p.scale.set(s, s * 0.45, s * 0.7);
      p.position.set(px, py, pz);
      cloud.add(p);
    }
    cloud.position.set(cx, cy, cz);
    scene.add(cloud);
  }

  // ---- ground, water, beach sand ------------------------------------------
  addPlane(scene, M.grass, 400, 400, 0, 0, 0); // base ground
  // Water: west strip (x < -170) and south strip (z > 170).
  addPlane(scene, M.water, 30, 400, -185, 0.03, 0);
  addPlane(scene, M.water, 400, 30, 0, 0.03, 185);
  // Beach sand between land and water at the south edge.
  addPlane(scene, M.sand, 400, 16, 0, 0.06, 176);
  // West shoreline sand sliver by the pier/marina.
  addPlane(scene, M.sand, 6, 120, -169, 0.06, 120);

  // ---- road grid -----------------------------------------------------------
  for (const c of ROAD_LINES) {
    addPlane(scene, M.walk, 400, WALK_HALF * 2, c, 0.02, 0); // sidewalk N-S
    addPlane(scene, M.walk, WALK_HALF * 2, 400, 0, 0.02, c); // sidewalk E-W
    addPlane(scene, M.road, 400, ROAD_HALF * 2, c, 0.04, 0); // asphalt N-S
    addPlane(scene, M.road, ROAD_HALF * 2, 400, 0, 0.04, c); // asphalt E-W
    // Centre dashes (small pale strips along each road).
    for (let t = -190; t <= 190; t += 20) {
      addPlane(scene, M.walk, 1.2, 5, c, 0.05, t);
      addPlane(scene, M.walk, 5, 1.2, t, 0.05, c);
    }
  }

  // ---- generic buildings ---------------------------------------------------
  // Block centres between the roads; edge blocks on the west/south water
  // edges and the beach strip are left open.
  const blockCentres = [-120, -40, 40, 120, 183];
  const nearLandmark = (x, z, r) => Object.values(LANDMARK_POSITIONS)
    .some((p) => Math.hypot(p.x - x, p.z - z) < r);
  for (const cx of blockCentres) {
    for (const cz of [-183, -120, -40, 40, 120]) {
      if (cx === 183 && cz === -183) continue;
      if (nearLandmark(cx, cz, 42)) continue; // keep landmark plots clear
      const r = hash2(cx, cz);
      const n = r > 0.6 ? 2 : 1; // sometimes two buildings per block
      for (let i = 0; i < n; i++) {
        const ox = n === 2 ? (i === 0 ? -14 : 14) : 0;
        const oz = n === 2 ? (i === 0 ? -12 : 12) : 0;
        const bx = cx + ox;
        const bz = cz + oz;
        if (nearLandmark(bx, bz, 26)) continue;
        const w = 16 + hash2(bx, bz + 1) * 12;
        const d = 14 + hash2(bx + 2, bz) * 10;
        const h = 6 + hash2(bx + 3, bz + 3) * 22;
        const bmat = buildingMats[Math.floor(hash2(bx, bz) * buildingMats.length)];
        addBox(scene, bmat, w, h, d, bx, h / 2, bz);
        // Emissive window strips on the street-facing side.
        const stripW = w * 0.65;
        addBox(scene, M.window, stripW, 0.7, 0.25, bx, h * 0.35, bz + d / 2 + 0.1);
        addBox(scene, M.window, stripW, 0.7, 0.25, bx, h * 0.7, bz + d / 2 + 0.1);
        addCollider(bx, bz, w / 2, d / 2);
      }
    }
  }

  // ---- landmarks -----------------------------------------------------------
  const mkGroup = (name) => {
    const g = new THREE.Group();
    const p = LANDMARK_POSITIONS[name];
    g.position.set(p.x, 0, p.z);
    scene.add(g);
    landmarks[name] = { x: p.x, z: p.z, mesh: g };
    return g;
  };

  // Market — Feria Market: 4 stalls, small boxes + coloured awnings.
  {
    const g = mkGroup('market');
    const awnings = [M.red, M.yellow, M.teal, M.orange];
    const spots = [[-6, -5], [6, -5], [-6, 5], [6, 5]];
    spots.forEach(([sx, sz], i) => {
      addBox(g, M.wood, 4, 1.2, 2.5, sx, 0.6, sz);
      addBox(g, awnings[i], 4.6, 0.25, 3.2, sx, 2.6, sz);
      addBox(g, M.woodDark, 0.25, 1.6, 0.25, sx - 2, 1.7, sz - 1.3);
      addBox(g, M.woodDark, 0.25, 1.6, 0.25, sx + 2, 1.7, sz - 1.3);
      addCollider(LANDMARK_POSITIONS.market.x + sx, LANDMARK_POSITIONS.market.z + sz, 2, 1.25);
    });
  }

  // Pier — Old Pier: wooden deck reaching west over the water.
  {
    const g = mkGroup('pier');
    addBox(g, M.wood, 30, 0.6, 6, -12, 0.9, 0); // deck, x -27..+3 rel.
    for (let x = -26; x <= 0; x += 6.5) {
      for (const dz of [-2.4, 2.4]) {
        const post = new THREE.Mesh(cylGeo, M.woodDark);
        post.scale.set(0.35, 1.6, 0.35);
        post.position.set(x, 0.2, dz);
        g.add(post);
      }
    }
    addBox(g, M.woodDark, 5, 2.6, 4, -24, 2.2, 0); // end hut
    addCollider(LANDMARK_POSITIONS.pier.x - 24, LANDMARK_POSITIONS.pier.z, 2.5, 2);
  }

  // Marina — Marina Docks: finger docks + two small boats + hut.
  {
    const g = mkGroup('marina');
    addBox(g, M.wood, 6, 0.5, 26, -8, 0.7, 0); // main dock along z
    for (const dz of [-8, 0, 8]) addBox(g, M.wood, 10, 0.4, 2, 0, 0.7, dz);
    // Boats: hull + cabin, moored beside the fingers.
    for (const [bx, bz, paint] of [[6, -8, M.white], [6, 8, M.blue]]) {
      addBox(g, paint, 3, 1.2, 8, bx, 0.7, bz);
      addBox(g, M.grey, 2, 1, 3, bx, 1.7, bz);
    }
    addBox(g, M.teal, 5, 3, 4, -14, 1.5, -10); // harbour hut
    addCollider(LANDMARK_POSITIONS.marina.x - 14, LANDMARK_POSITIONS.marina.z - 10, 2.5, 2);
  }

  // Garage — Brasa Garage: low block with a glowing sign.
  {
    const g = mkGroup('garage');
    addBox(g, M.grey, 18, 5, 11, 0, 2.5, 0);
    addBox(g, M.dark, 8, 3.2, 0.4, -3, 1.6, 5.6); // roller door
    addBox(g, M.neonOrange, 10, 1.6, 0.6, 0, 5.8, 5.4); // sign band
    addBox(g, M.blue, 18.6, 0.4, 11.6, 0, 5.2, 0); // roof trim
    addCollider(60, -120, 9, 5.5);
  }

  // Arcade — Rook Arcade: neon-front block tucked into the NW corner of the
  // (0,0) intersection so both roads and the (10,10) spawn stay clear.
  {
    const g = mkGroup('arcade');
    addBox(g, M.purple, 13, 8, 10, -11, 4, -11);
    addBox(g, M.neonPink, 13.4, 1, 0.5, -11, 6.5, -5.8); // neon strip
    addBox(g, M.neonCyan, 6, 1.8, 0.5, -11, 8.8, -5.8); // roof sign
    addBox(g, M.dark, 4, 5, 0.4, -11, 2.5, -5.8); // entrance
    addCollider(-11, -11, 6.5, 5);
  }

  // Casino — Coral Room Casino: tall GOLD tower.
  {
    const g = mkGroup('casino');
    addBox(g, M.gold, 16, 34, 16, 0, 17, 0);
    addBox(g, M.dark, 18, 2, 18, 0, 1, 0); // base
    addBox(g, M.neonPink, 16.4, 1.2, 0.5, 0, 26, 8.2); // neon crown band
    addBox(g, M.window, 10, 0.8, 0.3, 0, 12, 8.2);
    addBox(g, M.window, 10, 0.8, 0.3, 0, 19, 8.2);
    addCollider(120, -60, 9, 9);
  }

  // Tunnel — Coast Tunnel: dark archway; road passes through the gap, so
  // only the two side pillars block movement.
  {
    const g = mkGroup('tunnel');
    addBox(g, M.dark, 4, 7, 16, -7, 3.5, 0); // west pillar
    addBox(g, M.dark, 4, 7, 16, 7, 3.5, 0); // east pillar
    addBox(g, M.grey, 18, 2.5, 16, 0, 8.2, 0); // lintel over the road
    addBox(g, M.neonOrange, 18.4, 0.8, 0.5, 0, 9.6, 8.2);
    addCollider(150 - 7, 100, 2, 8);
    addCollider(150 + 7, 100, 2, 8);
  }

  // Motel — Motel Vela: long low block with a sign.
  {
    const g = mkGroup('motel');
    addBox(g, M.teal, 26, 4.5, 9, 0, 2.25, 0);
    addBox(g, M.white, 26.4, 0.5, 9.4, 0, 4.7, 0); // roof trim
    for (let x = -10; x <= 10; x += 5) addBox(g, M.window, 2, 1, 0.25, x, 2.4, 4.6);
    const pole = new THREE.Mesh(cylGeo, M.grey);
    pole.scale.set(0.3, 7, 0.3);
    pole.position.set(14, 3.5, 6);
    g.add(pole);
    addBox(g, M.neonPink, 1, 4, 6, 14, 7.5, 6); // tall sign
    addCollider(-60, 140, 13, 4.5);
    addCollider(-60 + 14, 140 + 6, 0.6, 0.6);
  }

  // Underpass: sunken road strip + bridge deck over it; pillars at the
  // sides only, the passage underneath stays open.
  {
    const g = mkGroup('underpass');
    addPlane(g, M.road, 30, 8, 0, 0.05, 0); // dipped road, east-west
    addBox(g, M.grey, 10, 1, 26, 0, 4.5, 0); // bridge deck over it
    addBox(g, M.neonCyan, 10.4, 0.5, 0.5, 0, 5.2, 13.2);
    for (const [px, pz] of [[-4.5, -11], [4.5, -11], [-4.5, 11], [4.5, 11]]) {
      addBox(g, M.grey, 1.2, 4.5, 1.2, px, 2.25, pz);
      addCollider(100 + px, 40 + pz, 0.6, 0.6);
    }
  }

  // Church — Old Church: white box + spire (cone).
  {
    const g = mkGroup('church');
    addBox(g, M.white, 11, 8, 14, 0, 4, 0);
    addBox(g, M.red, 11.6, 0.6, 14.6, 0, 8.3, 0); // roof
    const spire = new THREE.Mesh(coneGeo, M.gold);
    spire.scale.set(3.2, 9, 3.2);
    spire.position.set(0, 12.5, -4);
    g.add(spire);
    addBox(g, M.dark, 3, 5, 0.4, 0, 2.5, 7.2); // door
    addCollider(-40, -140, 5.5, 7);
  }

  // Plaza — Plaza Tower + open square: tower in the SE corner of the
  // (80,80) intersection, square paving left open for approach.
  {
    const g = mkGroup('plaza');
    addPlane(g, M.walk, 26, 26, 0, 0.07, 0); // open square
    addBox(g, M.blue, 10, 22, 10, 11, 11, 11);
    addBox(g, M.window, 10.4, 0.8, 0.3, 11, 8, 16.2);
    addBox(g, M.window, 10.4, 0.8, 0.3, 11, 15, 16.2);
    addBox(g, M.neonCyan, 10.4, 1, 0.5, 11, 22.5, 16.2);
    addCollider(80 + 11, 80 + 11, 5, 5);
  }

  // Beach — Beachfront: sand strip by the water + umbrellas.
  {
    const g = mkGroup('beach');
    addPlane(g, M.sand, 60, 14, 0, 0.08, 2); // sand at the water's edge
    const umbrellaCols = [M.red, M.yellow, M.teal];
    for (let i = 0; i < 3; i++) {
      const ux = -18 + i * 18;
      const pole = new THREE.Mesh(cylGeo, M.woodDark);
      pole.scale.set(0.15, 3, 0.15);
      pole.position.set(ux, 1.5, -2);
      g.add(pole);
      const top = new THREE.Mesh(coneGeo, umbrellaCols[i]);
      top.scale.set(3.5, 1.6, 3.5);
      top.position.set(ux, 3.6, -2);
      g.add(top);
      addBox(g, M.white, 2.4, 0.5, 1, ux, 0.4, 2); // deck chair
      addCollider(0 + ux, 180 - 2, 0.4, 0.4);
    }
  }

  // ---- Brasa Airfield runway (Worker F) ----------------------------------
  // Flat strip along the south road (z = 160, x -20..100, heading east —
  // see config.js RUNWAY). Asphalt + centreline dashes + threshold bars +
  // a windsock at the east end. No colliders on the strip itself: it is
  // flat and clear by design (the nearest parked car sits 20u west of the
  // threshold, palms/lamps stay at z = 168).
  {
    const R = RUNWAY || { x: 40, z: 160, length: 120, width: 12 };
    addPlane(scene, M.dark, R.length, R.width, R.x, 0.07, R.z); // asphalt
    // Centreline dashes along the strip.
    for (let x = R.x - R.length / 2 + 6; x <= R.x + R.length / 2 - 6; x += 12) {
      addPlane(scene, M.white, 6, 0.5, x, 0.08, R.z);
    }
    // Threshold bars at both ends.
    for (const tx of [R.x - R.length / 2 + 3, R.x + R.length / 2 - 3]) {
      addPlane(scene, M.white, 1, R.width - 2, tx, 0.08, R.z);
    }
    // Windsock: pole + orange cone at the east end, off the strip.
    const ws = R.windsock || { x: R.x + 66, z: R.z - 10 };
    const pole = new THREE.Mesh(cylGeo, M.grey);
    pole.scale.set(0.18, 5, 0.18);
    pole.position.set(ws.x, 2.5, ws.z);
    scene.add(pole);
    const sock = new THREE.Mesh(coneGeo, M.orange);
    sock.scale.set(0.7, 2.2, 0.7);
    sock.rotation.z = Math.PI / 2.4;
    sock.position.set(ws.x + 0.9, 5.1, ws.z);
    scene.add(sock);
    addCollider(ws.x, ws.z, 0.3, 0.3);
  }

  // ---- shops (Worker E) --------------------------------------------------
  // Enterable shop doors: Brasa Threads (clothes) at the plaza, Ammu-Nation
  // (weapons) at the underpass. Glowing sign bands + awnings mark the doors;
  // main.js opens the shop overlay with E when the player stands near one.
  {
    const shops = SHOP_POSITIONS || {
      clothes: { x: 70, z: 92 }, weapons: { x: 112, z: 48 },
    };
    // Clothes shop: pink neon sign + striped awning, door faces the plaza.
    addBox(scene, M.neonPink, 9, 1.4, 0.6, shops.clothes.x, 4.6, shops.clothes.z - 3);
    addBox(scene, M.white, 9.4, 0.3, 2.4, shops.clothes.x, 3.4, shops.clothes.z - 2);
    addBox(scene, M.dark, 3.4, 3, 0.4, shops.clothes.x, 1.5, shops.clothes.z - 3);
    // Weapon shop: orange neon sign + dark storefront, door faces the road.
    addBox(scene, M.neonOrange, 9, 1.4, 0.6, shops.weapons.x, 4.6, shops.weapons.z - 3);
    addBox(scene, M.grey, 9.4, 0.3, 2.4, shops.weapons.x, 3.4, shops.weapons.z - 2);
    addBox(scene, M.dark, 3.4, 3, 0.4, shops.weapons.x, 1.5, shops.weapons.z - 3);
  }

  // ---- Worker G: interior doors + property markers ------------------------
  // Glowing door frames mark the three enterable interiors (E to enter):
  // garage (60,-113), casino (120,-50), safehouse/motel (-60,144.5). Gold
  // pillars mark the three buyable properties (P for the property menu).
  for (const d of Object.values(INTERIORS)) {
    addBox(scene, M.neonCyan, 3.6, 0.5, 0.4, d.door.x, 3.4, d.door.z);
    addBox(scene, M.neonCyan, 0.4, 3.4, 0.4, d.door.x - 1.8, 1.7, d.door.z);
    addBox(scene, M.neonCyan, 0.4, 3.4, 0.4, d.door.x + 1.8, 1.7, d.door.z);
    addPlane(scene, M.neonCyan, 4, 1.6, d.door.x, 0.08, d.door.z + 1.2);
  }
  for (const p of Object.values(PROPERTIES)) {
    addBox(scene, M.gold, 0.8, 3.2, 0.8, p.at.x + 6, 1.6, p.at.z + 6);
    addBox(scene, M.window, 1.2, 0.5, 1.2, p.at.x + 6, 3.4, p.at.z + 6);
  }

  // ---- props: street lamps -------------------------------------------------
  const lampAt = (x, z) => {
    const pole = new THREE.Mesh(cylGeo, M.dark);
    pole.scale.set(0.18, 5, 0.18);
    pole.position.set(x, 2.5, z);
    scene.add(pole);
    const head = new THREE.Mesh(boxGeo, M.lampHead);
    head.scale.set(0.9, 0.4, 0.9);
    head.position.set(x, 5.1, z);
    scene.add(head);
    addCollider(x, z, 0.3, 0.3);
  };
  for (const c of ROAD_LINES) {
    for (let t = -160; t <= 160; t += 80) {
      lampAt(c + 8, t);
      lampAt(t, c + 8);
    }
  }

  // ---- props: palm trees (beach + plaza) -----------------------------------
  const palmAt = (x, z) => {
    const trunk = new THREE.Mesh(cylGeo, M.trunk);
    trunk.scale.set(0.35, 6, 0.35);
    trunk.position.set(x, 3, z);
    scene.add(trunk);
    const top = new THREE.Mesh(coneGeo, M.palm);
    top.scale.set(2.6, 3.4, 2.6);
    top.position.set(x, 7.2, z);
    scene.add(top);
    const fronds = new THREE.Mesh(sphereGeo, M.palm);
    fronds.scale.set(2.4, 0.9, 2.4);
    fronds.position.set(x, 5.8, z);
    scene.add(fronds);
    addCollider(x, z, 0.5, 0.5);
  };
  for (let x = -80; x <= 80; x += 20) palmAt(x, 168);
  palmAt(80 + 22, 80 - 2); palmAt(80 - 2, 80 + 22); palmAt(80 + 22, 80 + 22); palmAt(80 - 14, 80 - 14);

  // ---- props: parked cars (static) + car spawn points ----------------------
  const carSpawns = [
    { x: -80, z: -40, angle: 0 },
    { x: 0, z: 60, angle: Math.PI / 2 },
    { x: 80, z: -120, angle: 0 },
    { x: -160, z: 40, angle: Math.PI / 2 },
    { x: 40, z: 80, angle: 0 },
    { x: 160, z: -20, angle: Math.PI / 2 },
    { x: -40, z: 160, angle: 0 },
  ];
  carSpawns.forEach(({ x, z, angle }, i) => {
    const car = new THREE.Group();
    const paint = carPaints[i % carPaints.length];
    const body = new THREE.Mesh(boxGeo, paint);
    body.scale.set(4.2, 0.9, 2);
    body.position.y = 0.7;
    car.add(body);
    const cabin = new THREE.Mesh(boxGeo, M.dark);
    cabin.scale.set(2.2, 0.8, 1.8);
    cabin.position.set(-0.2, 1.5, 0);
    car.add(cabin);
    for (const [wx, wz] of [[-1.4, -1], [1.4, -1], [-1.4, 1], [1.4, 1]]) {
      const wheel = new THREE.Mesh(cylGeo, M.dark);
      wheel.rotation.x = Math.PI / 2;
      wheel.scale.set(0.45, 0.35, 0.45);
      wheel.position.set(wx, 0.45, wz);
      car.add(wheel);
    }
    car.position.set(x, 0, z);
    car.rotation.y = angle;
    scene.add(car);
    addCollider(x, z, 2.1, 1.1);
  });

  // ---- props: crates scattered (mission pickups are separate, in missions.js)
  const crateSpots = [
    [-100, -60], [-30, 30], [50, -90], [110, 10], [-140, 100],
    [30, 130], [140, 140], [-90, 20], [20, -150], [170, 60],
  ];
  for (const [cx, cz] of crateSpots) {
    addBox(scene, M.crate, 1.3, 1.3, 1.3, cx, 0.65, cz);
    addCollider(cx, cz, 0.65, 0.65);
  }

  return {
    landmarks,
    colliders,
    shops: SHOP_POSITIONS || { clothes: { x: 70, z: 92 }, weapons: { x: 112, z: 48 } },
    doors: doorMarkers(), // Worker G: enterable interior doors (E to enter)
    properties: propertyMarkers(), // Worker G: buyable property markers
    spawnPoints: {
      player: { x: 10, z: 10 },
      cars: carSpawns,
      bike: BIKE_SPAWN,
      boats: BOAT_SPAWNS,
      plane: (RUNWAY && RUNWAY.planeSpot) || { x: 20, z: 160, yaw: Math.PI / 2 },
    },
    // Night-glow refs for daynight.js / main.js (Worker A).
    lamps: nightLampMats,
    windows: nightWindowMats,
    skyMaterial: skyDomeMat,
  };
}

// Toggle the night glow: lamps blaze and building windows light up at
// night, both dim back down in daylight. Safe to call before buildWorld
// (no-op) and cheap enough to call on every dusk/dawn transition.
export function setNightGlow(S, isNight) {
  try {
    for (const m of nightLampMats) {
      if (m && m.emissive) m.emissiveIntensity = isNight ? 2.4 : 0.12;
    }
    for (const m of nightWindowMats) {
      if (m && m.emissive) m.emissiveIntensity = isNight ? 1.6 : 0.25;
    }
    return true;
  } catch {
    return false;
  }
}

// ---- wet ground + rain field (Worker E) -----------------------------------
// setWetGround(S, wet): rain makes the grass darker and the asphalt darker
// and shinier (lower roughness = more reflective look); dry restores the
// original colours. Safe to call before buildWorld (no-op).
export function setWetGround(S, wet) {
  try {
    if (!wetGroundMat || !wetRoadMat || !wetGroundOrig || !wetRoadOrig) return false;
    if (wet) {
      wetGroundMat.color.setHex(0x3d5f33);
      wetGroundMat.roughness = 0.55;
      wetRoadMat.color.setHex(0x1a1a20);
      wetRoadMat.roughness = 0.35;
    } else {
      wetGroundMat.color.setHex(wetGroundOrig.color);
      wetGroundMat.roughness = wetGroundOrig.roughness;
      wetRoadMat.color.setHex(wetRoadOrig.color);
      wetRoadMat.roughness = wetRoadOrig.roughness;
    }
    return true;
  } catch {
    return false;
  }
}

// createRainField(scene): a cheap Points-based rain streak field (~600
// points) around the origin; weather.js moves it with the camera and
// recycles drops that hit the ground. Returns { points, update }.
export function createRainField(scene) {
  try {
    const COUNT = 600;
    const AREA = 60;
    const HEIGHT = 28;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * AREA * 2;
      pos[i * 3 + 1] = Math.random() * HEIGHT;
      pos[i * 3 + 2] = (Math.random() - 0.5) * AREA * 2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x9fc8ff, size: 0.18, transparent: true, opacity: 0.65 });
    const points = new THREE.Points(geo, mat);
    points.visible = false;
    points.frustumCulled = false;
    if (scene) scene.add(points);
    return {
      points,
      update(cameraPos, dt) {
        if (!cameraPos) return;
        const arr = geo.attributes.position.array;
        for (let i = 0; i < COUNT; i++) {
          arr[i * 3 + 1] -= 26 * dt;
          arr[i * 3] += 26 * 0.12 * dt;
          if (arr[i * 3 + 1] < 0) {
            arr[i * 3 + 1] = HEIGHT;
            arr[i * 3] = cameraPos.x + (Math.random() - 0.5) * AREA * 2;
            arr[i * 3 + 2] = cameraPos.z + (Math.random() - 0.5) * AREA * 2;
          }
        }
        geo.attributes.position.needsUpdate = true;
      },
    };
  } catch {
    return null;
  }
}

// ISLA BRASA 3D — recorded agent authorship touch (2026-11-23)
