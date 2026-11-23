// interiors.js — Worker G (ISLA BRASA 3D)
// Enterable buildings: garage, casino, safehouse. Each interior is a real
// walled room (floor, 4 walls, warm light, props) built once by
// buildInteriors(S) at a quiet corner of the map. E at a door teleports the
// player inside (outside colliders swapped for the room walls); E inside
// (or the HUD exit button) teleports them back out to the door. The player
// can never be trapped: exitInterior always restores the outside position
// and colliders, and the safehouse bed saves the game (sleep).

import * as THREE from 'three';
import { INTERIORS } from './config.js';

const ROOM_HALF_X = 8;
const ROOM_HALF_Z = 6;
const WALL_H = 4;

function wallColliders(room) {
  const { x, z } = room;
  const t = 0.5;
  return [
    { minX: x - ROOM_HALF_X - t, maxX: x + ROOM_HALF_X + t, minZ: z - ROOM_HALF_Z - t, maxZ: z - ROOM_HALF_Z + t, interior: true },
    { minX: x - ROOM_HALF_X - t, maxX: x + ROOM_HALF_X + t, minZ: z + ROOM_HALF_Z - t, maxZ: z + ROOM_HALF_Z + t, interior: true },
    { minX: x - ROOM_HALF_X - t, maxX: x - ROOM_HALF_X + t, minZ: z - ROOM_HALF_Z, maxZ: z + ROOM_HALF_Z, interior: true },
    { minX: x + ROOM_HALF_X - t, maxX: x + ROOM_HALF_X + t, minZ: z - ROOM_HALF_Z, maxZ: z + ROOM_HALF_Z, interior: true },
  ];
}

// Build all interior rooms into the scene. Returns { rooms, byId }.
// Rooms start visible (they sit in empty map corners) — the player only
// ever sees one from the inside.
export function buildInteriors(S) {
  const scene = S.scene;
  const rooms = {};
  if (!scene) return { rooms, byId: rooms };
  for (const def of Object.values(INTERIORS)) {
    const { x, z } = def.room;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...opts });
    const box = (material, w, h, d, px, py, pz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      m.position.set(px, py, pz);
      g.add(m);
      return m;
    };
    // Floor + ceiling + 4 walls (warm wood / plaster palette).
    box(mat(0x8a5a2b), ROOM_HALF_X * 2 + 1, 0.3, ROOM_HALF_Z * 2 + 1, 0, 0.15, 0); // floor
    box(mat(0x6b4a2f), ROOM_HALF_X * 2 + 1, 0.3, ROOM_HALF_Z * 2 + 1, 0, WALL_H + 0.15, 0); // ceiling
    box(mat(0xc9a06a), ROOM_HALF_X * 2 + 1, WALL_H, 0.5, 0, WALL_H / 2, -ROOM_HALF_Z); // north
    box(mat(0xc9a06a), ROOM_HALF_X * 2 + 1, WALL_H, 0.5, 0, WALL_H / 2, ROOM_HALF_Z); // south
    box(mat(0xb98d55), 0.5, WALL_H, ROOM_HALF_Z * 2, -ROOM_HALF_X, WALL_H / 2, 0); // west
    box(mat(0xb98d55), 0.5, WALL_H, ROOM_HALF_Z * 2, ROOM_HALF_X, WALL_H / 2, 0); // east
    // Door (visual, on the south wall) + warm rug.
    box(mat(0x4a2f1a), 2, 3, 0.3, 0, 1.5, ROOM_HALF_Z - 0.2);
    box(mat(0xa03030), 5, 0.1, 3.5, 0, 0.35, 0);
    // Warm interior light.
    const light = new THREE.PointLight(0xffd9a0, 60, 30);
    light.position.set(0, 3.4, 0);
    g.add(light);
    // Props per interior.
    if (def.id === 'garage') {
      for (const [px, pz, color] of [[-4, -2.5, 0xc0392b], [0.5, -2.5, 0x2980b9], [4.5, 2.5, 0xf39c12]]) {
        const car = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 2), mat(color));
        body.position.y = 0.7; car.add(body);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1.8), mat(0x222831));
        cabin.position.set(-0.2, 1.5, 0); car.add(cabin);
        car.position.set(px, 0, pz);
        g.add(car);
      }
      box(mat(0x7a7a80), 3, 1, 1.5, -5.5, 0.8, 3.5); // tool bench
    } else if (def.id === 'casino') {
      for (let i = -1; i <= 1; i++) {
        box(mat(0xd4a017, { emissive: 0x6b4d00, emissiveIntensity: 0.5 }), 1.4, 2, 1, i * 2.4, 1.3, -3.5); // slot machines
        box(new THREE.MeshStandardMaterial({ color: 0xff2e88, emissive: 0xff2e88, emissiveIntensity: 1 }), 1, 0.4, 0.4, i * 2.4, 2.5, -3.2);
      }
      box(mat(0x148f77), 5, 1, 3, 0, 0.8, 2.5); // roulette / card table (green felt)
      box(mat(0xffffff), 0.6, 0.6, 0.6, 2.2, 0.6, 2.5); // roulette ball marker
    } else if (def.id === 'safehouse') {
      box(mat(0x2e5a8a), 3.2, 0.7, 6, -4.5, 0.65, -2); // bed
      box(mat(0xf2f2f2), 3.2, 0.25, 1.4, -4.5, 1.1, -4.4); // pillow
      box(mat(0x8a5a2b), 1.6, 1, 1, 4.5, 0.8, -4); // dresser
      box(new THREE.MeshStandardMaterial({ color: 0xffe9a0, emissive: 0xffd977, emissiveIntensity: 1.2 }), 0.5, 0.5, 0.5, 4.5, 1.6, -4); // lamp
    }
    scene.add(g);
    rooms[def.id] = { def, group: g, colliders: wallColliders(def.room) };
  }
  return { rooms, byId: rooms };
}

// Nearest interior door within 6 units of the player, or null.
export function nearestDoor(S) {
  const p = S.player && S.player.pos;
  if (!p) return null;
  let best = null, bestD = 6;
  for (const def of Object.values(INTERIORS)) {
    const d = Math.hypot(p.x - def.door.x, p.z - def.door.z);
    if (d < bestD) { bestD = d; best = { ...def, dist: d }; }
  }
  return best;
}

// Walk the player inside. Saves the outside spot + colliders, swaps in the
// room walls, teleports the player to the room centre. Returns { ok, id }.
export function enterInterior(S, id) {
  const built = S.interiors;
  const room = built && built.rooms && built.rooms[id];
  const def = INTERIORS[id];
  if (!def || !room) return { ok: false, error: 'unknown interior' };
  if (S.insideInterior) return { ok: false, error: 'already inside ' + S.insideInterior };
  const p = S.player;
  if (!p || !p.pos) return { ok: false, error: 'no player' };
  if (p.car) return { ok: false, error: 'exit your car first' };
  S._outsideSpot = { x: p.pos.x, z: p.pos.z, yaw: p.yaw };
  S._outsideColliders = S.world ? S.world.colliders : [];
  if (S.world) S.world.colliders = room.colliders;
  S.insideInterior = id;
  S.interiorBounds = {
    minX: def.room.x - ROOM_HALF_X + 0.8, maxX: def.room.x + ROOM_HALF_X - 0.8,
    minZ: def.room.z - ROOM_HALF_Z + 0.8, maxZ: def.room.z + ROOM_HALF_Z - 0.8,
  };
  // Teleport (player.js helper when available, direct set otherwise).
  if (typeof S.teleportPlayer === 'function') S.teleportPlayer(def.room.x, 0, def.room.z + 2);
  else { p.pos.set(def.room.x, 0, def.room.z + 2); if (p.mesh) p.mesh.position.copy(p.pos); }
  p.yaw = Math.PI; // face the room (north, toward the props)
  if (p.mesh) p.mesh.rotation.y = p.yaw;
  S.camDist = 4.5;
  return { ok: true, id, name: def.name };
}

// Walk back out: restore the outside spot + colliders. Never traps the
// player — even if the saved spot is missing, it falls back to the door.
export function exitInterior(S) {
  const id = S.insideInterior;
  if (!id) return { ok: false, error: 'not inside an interior' };
  const def = INTERIORS[id];
  const spot = S._outsideSpot || { x: def.door.x, z: def.door.z + 2, yaw: 0 };
  const p = S.player;
  if (S.world && S._outsideColliders) S.world.colliders = S._outsideColliders;
  S.insideInterior = null;
  S.interiorBounds = null;
  S._outsideSpot = null;
  S._outsideColliders = null;
  S.camDist = 8;
  if (p && p.pos) {
    if (typeof S.teleportPlayer === 'function') S.teleportPlayer(spot.x, 0, spot.z);
    else { p.pos.set(spot.x, 0, spot.z); if (p.mesh) p.mesh.position.copy(p.pos); }
    p.yaw = spot.yaw || 0;
    if (p.mesh) p.mesh.rotation.y = p.yaw;
  }
  return { ok: true, id, name: def ? def.name : id };
}

// Per-frame interior upkeep: keep the camera close while inside (main.js
// also shortens the camera distance). Never throws.
export function updateInterior(S, dt) {
  if (!S || !S.insideInterior) return false;
  if (typeof S.camDist === 'number' && S.camDist > 5) S.camDist = 4.5;
  return true;
}

// Sleep in the safehouse: saves the game. Only works inside the safehouse.
export function sleepInSafehouse(S) {
  if (S.insideInterior !== 'safehouse') return { ok: false, error: 'you must be inside the safehouse to sleep' };
  let saved = false;
  try { if (typeof S.save === 'function') { S.save(); saved = true; } } catch { saved = false; }
  if (saved && typeof S.saveGame === 'function') { try { S.saveGame(); } catch { /* ignore */ } }
  return { ok: saved, saved, message: saved ? 'You slept and saved the game. Rested and ready.' : 'Save failed — try again.' };
}
