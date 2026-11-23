// pedestrians.js — Worker B (ISLA BRASA 3D)
// Ambient low-poly pedestrians: capsule body + head, varied colours,
// wander between sidewalk waypoints, flee from gunfire / fast cars /
// sprinting player / police chases. Ambient only: no collision with the
// player, cars or mission markers; respawn if they wander too far.
import * as THREE from 'three';
import { sidewalkPoints } from './world.js';

const SHIRTS = [0xd23c2a, 0x2e8b57, 0x3a7bd5, 0xf2c200, 0x8e44ad, 0xe67e22, 0x16a085, 0xec407a, 0x78909c, 0xff7043];
const PANTS = [0x2b3a55, 0x303030, 0x5d4037, 0x37474f, 0x4a235a, 0x1b4f72];
const SKINS = [0xc98d5f, 0x8a5a3b, 0xd9a066, 0xe8b98a, 0x6b4226];

function hashRand(i, salt) {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function pushOutOfColliders(pos, radius, colliders) {
  if (!colliders) return;
  for (const c of colliders) {
    if (c.minX === undefined) continue;
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

function makePedestrian(scene, i, x, z) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: SHIRTS[i % SHIRTS.length], roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: PANTS[Math.floor(hashRand(i, 2) * PANTS.length)], roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: SKINS[Math.floor(hashRand(i, 3) * SKINS.length)], roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.55, 4, 8), shirt);
  body.position.y = 1.02;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), skin);
  head.position.y = 1.74;
  group.add(head);
  const legGeo = new THREE.BoxGeometry(0.18, 0.62, 0.18);
  legGeo.translate(0, -0.31, 0);
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.16, 0.68, 0);
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, pants);
  legR.position.set(0.16, 0.68, 0);
  group.add(legR);
  const armGeo = new THREE.BoxGeometry(0.14, 0.55, 0.14);
  armGeo.translate(0, -0.27, 0);
  const armL = new THREE.Mesh(armGeo, skin);
  armL.position.set(-0.44, 1.38, 0);
  group.add(armL);
  const armR = new THREE.Mesh(armGeo, skin);
  armR.position.set(0.44, 1.38, 0);
  group.add(armR);
  group.position.set(x, 0, z);
  if (scene) scene.add(group);
  return {
    mesh: group, pos: group.position, yaw: hashRand(i, 5) * Math.PI * 2,
    hp: 100, kind: 'pedestrian', ambient: true,
    speed: 1.4 + hashRand(i, 7) * 0.7,
    target: null, fleeUntil: 0, fleeFrom: null, walkPhase: hashRand(i, 9) * 6,
    parts: { body, head, legL, legR, armL, armR },
  };
}

function randomSidewalkPoint(S, near) {
  const pts = (typeof sidewalkPoints === 'function' ? sidewalkPoints(S) : null) || [];
  if (!pts.length) return { x: (near?.x || 0) + 10, z: near?.z || 0 };
  if (near) {
    const close = pts.filter((p) => Math.hypot(p.x - near.x, p.z - near.z) < 80);
    const pool = close.length ? close : pts;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return pts[Math.floor(Math.random() * pts.length)];
}

/** Flee trigger: every pedestrian within `radius` of `pos` runs away. */
export function pedestriansFleeFrom(S, pos, radius) {
  const list = S?.pedestrians?.list;
  if (!list || !pos) return 0;
  const r = radius ?? (S?.config?.PEDESTRIAN_FLEE_RADIUS ?? 18);
  const px = pos.x ?? pos[0] ?? 0, pz = pos.z ?? pos[2] ?? 0;
  let n = 0;
  for (const ped of list) {
    const d = Math.hypot(ped.pos.x - px, ped.pos.z - pz);
    if (d < r) {
      ped.fleeFrom = { x: px, z: pz };
      ped.fleeUntil = (S.time || 0) + 4;
      n++;
    }
  }
  return n;
}

export function createPedestrians(S, count) {
  const n = count ?? S?.config?.PEDESTRIAN_COUNT ?? 16;
  const list = [];
  for (let i = 0; i < n; i++) {
    const pt = randomSidewalkPoint(S, null);
    list.push(makePedestrian(S.scene, i, pt.x, pt.z));
  }
  const api = { list, fleeFrom: (pos, radius) => pedestriansFleeFrom(S, pos, radius) };
  S.pedestrians = api;
  S.pedestriansFleeFrom = (pos, radius) => pedestriansFleeFrom(S, pos, radius);
  return api;
}

export function updatePedestrians(S, dt) {
  const list = S?.pedestrians?.list;
  if (!list) return;
  dt = Math.min(dt || 0.016, 0.05);
  const now = S.time || 0;
  const colliders = S.world?.colliders;
  for (const ped of list) {
    // Respawn if wandered too far from the city (never block missions).
    if (Math.abs(ped.pos.x) > 230 || Math.abs(ped.pos.z) > 230) {
      const pt = randomSidewalkPoint(S, null);
      ped.pos.set(pt.x, 0, pt.z);
      ped.target = null;
      ped.fleeUntil = 0;
    }
    const fleeing = now < ped.fleeUntil && ped.fleeFrom;
    let speed = ped.speed;
    let tx, tz;
    if (fleeing) {
      speed = 5.2; // run away from the threat
      const dx = ped.pos.x - ped.fleeFrom.x, dz = ped.pos.z - ped.fleeFrom.z;
      const d = Math.hypot(dx, dz) || 1;
      tx = ped.pos.x + (dx / d) * 20;
      tz = ped.pos.z + (dz / d) * 20;
    } else {
      if (!ped.target || Math.hypot(ped.target.x - ped.pos.x, ped.target.z - ped.pos.z) < 1.5) {
        ped.target = randomSidewalkPoint(S, ped.pos);
      }
      tx = ped.target.x; tz = ped.target.z;
    }
    const dx = tx - ped.pos.x, dz = tz - ped.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const nx = dx / d, nz = dz / d;
      ped.pos.x += nx * speed * dt;
      ped.pos.z += nz * speed * dt;
      ped.yaw = Math.atan2(nx, nz);
      ped.walkPhase += speed * (fleeing ? 2.4 : 1.7) * dt;
      const s = Math.sin(ped.walkPhase);
      const swing = fleeing ? 0.9 : 0.55;
      ped.parts.legL.rotation.x = s * swing;
      ped.parts.legR.rotation.x = -s * swing;
      ped.parts.armL.rotation.x = -s * swing * 0.8;
      ped.parts.armR.rotation.x = s * swing * 0.8;
    } else {
      ped.parts.legL.rotation.x *= 0.8;
      ped.parts.legR.rotation.x *= 0.8;
      ped.parts.armL.rotation.x *= 0.8;
      ped.parts.armR.rotation.x *= 0.8;
    }
    pushOutOfColliders(ped.pos, 0.5, colliders);
    ped.pos.x = Math.max(-230, Math.min(230, ped.pos.x));
    ped.pos.z = Math.max(-230, Math.min(230, ped.pos.z));
    if (ped.mesh) {
      ped.mesh.position.copy(ped.pos);
      ped.mesh.rotation.y = ped.yaw;
    }
  }
}
