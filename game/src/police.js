// police.js — Worker C (ISLA BRASA 3D)
// Wanted 0-5 stars, police chase cars, REAL roadblocks (police-car
// barricades with solid AABB colliders + flashing lights) and the CONDOR-1
// helicopter (low-poly heli + searchlight cone tracking the player).
// Wanted decays by 1 star per 20s without a crime. Killing an enemy raises
// wanted by 1 — combat.js calls S.addWanted(n); main.js wires
// S.addWanted = (n) => addWanted(S, n).
import * as THREE from 'three';
import { createCar, moveCar } from './cars.js';

export function addWanted(S, n) {
  if (!S) return 0;
  S.wanted = Math.max(0, Math.min(5, (S.wanted || 0) + (n || 0)));
  S._quietTime = 0; // fresh crime resets the decay clock
  return S.wanted;
}

export function setWanted(S, n) {
  if (!S) return 0;
  S.wanted = Math.max(0, Math.min(5, n || 0));
  S._quietTime = 0;
  if (S.wanted === 0) S._policeReset = true; // force a full despawn next tick
  return S.wanted;
}

// ---------------------------------------------------------------- heist heat (Worker F)
// The Brasa Heist escape: wanted climbs while the player runs the loot to
// the Beachfront. missions.js calls this (via main.js S.heistHeat) on a
// timer during the part-3 escape step. Same cap (5) and decay reset as a
// normal crime — it is just addWanted under a heist name.
export function raiseHeistHeat(S, n = 1) {
  return addWanted(S, n);
}

// ---------------------------------------------------------------- helicopter
function buildHeli(scene) {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2f55, roughness: 0.5, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0e1420, roughness: 0.15, metalness: 0.6 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 4.2), dark);
  body.castShadow = true;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 1.2), glass);
  nose.position.set(0, -0.1, 2.4);
  group.add(nose);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 4.5), dark);
  tail.position.set(0, 0.3, -4.0);
  group.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.4, 1.0), dark);
  fin.position.set(0, 0.9, -6.0);
  group.add(fin);
  // Skids.
  for (const sx of [-0.9, 0.9]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 3.6),
      new THREE.MeshStandardMaterial({ color: 0x333333 }));
    skid.position.set(sx, -1.0, 0);
    group.add(skid);
  }
  // Main rotor (spins) + tail rotor.
  const rotor = new THREE.Group();
  rotor.position.y = 0.9;
  const bladeGeo = new THREE.BoxGeometry(9, 0.08, 0.5);
  rotor.add(new THREE.Mesh(bladeGeo, new THREE.MeshStandardMaterial({ color: 0x222222 })));
  const blade2 = new THREE.Mesh(bladeGeo, new THREE.MeshStandardMaterial({ color: 0x222222 }));
  blade2.rotation.y = Math.PI / 2;
  rotor.add(blade2);
  group.add(rotor);

  // Searchlight: SpotLight aimed at the player + a translucent cone mesh
  // so the beam is visible even without shadow maps.
  const spot = new THREE.SpotLight(0xfff2aa, 400, 90, 0.32, 0.45, 1.2);
  spot.position.set(0, -0.8, 1.5);
  group.add(spot);
  group.add(spot.target);
  const coneLen = 30;
  const cone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 7, coneLen, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff2aa, transparent: true, opacity: 0.13,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
  group.add(cone);

  if (scene) scene.add(group);
  return { mesh: group, rotor, spot, cone, coneLen, angle: 0 };
}

function removeHeli(S) {
  const h = S._heli;
  if (!h) return;
  if (S.scene) S.scene.remove(h.mesh);
  h.spot?.dispose?.();
  S._heli = null;
}

// ---------------------------------------------------------------- roadblocks
function buildRoadblock(S, centre, heading) {
  // Two police cars parked side-by-side across the road (perpendicular to
  // the player's heading), with solid AABB colliders + flashing light bars.
  const perp = heading + Math.PI / 2;
  const px = Math.sin(perp), pz = Math.cos(perp);
  const cars = [];
  const colliders = [];
  const flashers = [];
  for (const side of [-2.6, 2.6]) {
    const x = centre.x + px * side, z = centre.z + pz * side;
    const car = createCar(S.scene, 'police', { x, z });
    car.yaw = perp;
    car.mesh.rotation.y = perp;
    car.speed = 0;
    cars.push(car);
    // Solid AABB collider for the barricade car (axis-aligned approx).
    const col = { minX: x - 2.4, maxX: x + 2.4, minZ: z - 1.4, maxZ: z + 1.4, __roadblock: true };
    (S.world.colliders = S.world.colliders || []).push(col);
    colliders.push(col);
    // Flashing light bar (red/blue emissive boxes on the roof).
    const mats = [];
    for (const [ox, color] of [[-0.28, 0xff2222], [0.28, 0x2266ff]]) {
      const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.3), m);
      box.position.set(ox, 1.62, -0.2);
      car.mesh.add(box);
      mats.push(m);
    }
    flashers.push(...mats);
  }
  return { cars, colliders, flashers };
}

function removeRoadblocks(S) {
  const blocks = S._roadblocks || [];
  for (const b of blocks) {
    for (const car of b.cars) if (S.scene) S.scene.remove(car.mesh);
    if (S.world?.colliders) {
      S.world.colliders = S.world.colliders.filter((c) => !c.__roadblock);
    }
  }
  S._roadblocks = [];
}

function removePoliceCars(S, keep = 0) {
  const list = S._policeCars || [];
  while (list.length > keep) {
    const car = list.pop();
    if (car && S.scene) S.scene.remove(car.mesh);
  }
}

// ---------------------------------------------------------------- per-frame
export function updatePolice(S, dt) {
  if (!S) return;
  dt = Math.min(dt || 0.016, 0.05);
  if (S.wanted === undefined) S.wanted = 0;
  S._quietTime = (S._quietTime || 0) + dt;
  S._policeTime = (S._policeTime || 0) + dt;
  S._policeCars = S._policeCars || [];
  S._roadblocks = S._roadblocks || [];

  const p = S.player;
  const pPos = p?.car ? p.car.pos : p?.pos;

  // --- wanted decay: -1 star per 20s without a crime ---
  if (S.wanted > 0 && S._quietTime >= 20) {
    S.wanted -= 1;
    S._quietTime = 0;
    if (S.wanted === 0) S._policeReset = true;
  }

  // --- full reset (wanted hit 0 / respawn): despawn everything gradually ---
  if (S._policeReset) {
    S._policeReset = false;
    removeRoadblocks(S);
    removeHeli(S);
    removePoliceCars(S, 0);
    S._despawnT = 0;
    return;
  }

  if (!pPos) return;

  // --- police chase cars: up to `wanted` cruisers (max 4) ---
  const wantCars = S.wanted >= 1 ? Math.min(S.wanted, 4) : 0;
  if (S._policeCars.length < wantCars) {
    // Spawn a cruiser 30-40u away from the player, on a random bearing.
    const a = Math.random() * Math.PI * 2;
    const r = 32 + Math.random() * 8;
    const car = createCar(S.scene, 'police', {
      x: pPos.x + Math.sin(a) * r,
      z: pPos.z + Math.cos(a) * r,
    });
    car.speed = 10;
    S._policeCars.push(car);
  } else if (S._policeCars.length > wantCars) {
    // Despawn gradually: one cruiser per second (farthest first).
    S._despawnT = (S._despawnT || 0) + dt;
    if (S._despawnT >= 1) {
      S._despawnT = 0;
      let worst = 0, worstD = -1;
      S._policeCars.forEach((c, i) => {
        const d = Math.hypot(c.pos.x - pPos.x, c.pos.z - pPos.z);
        if (d > worstD) { worstD = d; worst = i; }
      });
      const [gone] = S._policeCars.splice(worst, 1);
      if (gone && S.scene) S.scene.remove(gone.mesh);
    }
  }

  // Chase + ram.
  for (const car of S._policeCars) {
    const dx = pPos.x - car.pos.x, dz = pPos.z - car.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const targetYaw = Math.atan2(dx, dz);
    let dy = targetYaw - car.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    car.yaw += dy * Math.min(1, dt * 2.2);
    const boost = S.wanted >= 4 ? 1.15 : 1;
    moveCar(S, car, dt, dist > 6 ? 1 : 0.4, 0);
    car.speed = Math.min(car.speed, (car.stats?.topSpeed ?? 32) * boost);
    // A police chase passing nearby scatters pedestrians (throttled).
    if ((S.time - (S._policeFleeAt || 0)) > 0.5) {
      S._policeFleeAt = S.time;
      if (typeof S.pedestriansFleeFrom === 'function') S.pedestriansFleeFrom(car.pos, 15);
    }
    // Ram: shove the player / their car and hurt an on-foot player.
    if (dist < 3.2) {
      const nx = dx / dist, nz = dz / dist;
      if (p && !p.car && p.hp > 0 && (S._respawnGrace || 0) <= 0) {
        p.pos.x -= nx * 3 * dt * 10;
        p.pos.z -= nz * 3 * dt * 10;
        p.hp -= 6 * dt;
      } else if (p?.car) {
        p.car.pos.x -= nx * 2 * dt * 10;
        p.car.pos.z -= nz * 2 * dt * 10;
        p.car.speed *= 0.97;
      }
      car.speed *= 0.5; // the cruiser slows after impact
    }
    // Keep the cruiser mesh synced (moveCar already does this).
  }

  // --- roadblocks at wanted >= 3: 2 barricades ahead of the player ---
  if (S.wanted >= 3 && S._roadblocks.length === 0) {
    const heading = p?.car ? p.car.yaw : (p?.yaw ?? 0);
    const fx = Math.sin(heading), fz = Math.cos(heading);
    for (const ahead of [25, 42]) {
      S._roadblocks.push(buildRoadblock(S, {
        x: pPos.x + fx * ahead,
        z: pPos.z + fz * ahead,
      }, heading));
    }
  } else if (S.wanted < 3 && S._roadblocks.length > 0) {
    removeRoadblocks(S);
  }
  // Flash the roadblock light bars (alternate red/blue).
  const blink = Math.sin(S._policeTime * 9) > 0;
  for (const b of S._roadblocks) {
    b.flashers.forEach((m, i) => {
      m.emissiveIntensity = (i % 2 === 0) === blink ? 2.2 : 0.15;
    });
  }

  // --- CONDOR-1 helicopter at wanted >= 3 ---
  if (S.wanted >= 3 && !S._heli) {
    S._heli = buildHeli(S.scene);
  } else if (S.wanted < 3 && S._heli) {
    removeHeli(S);
  }
  if (S._heli) {
    const h = S._heli;
    const fast = S.wanted >= 4;
    h.angle += dt * (fast ? 0.55 : 0.28);
    const radius = fast ? 9 : 13;
    const hoverY = fast ? 20 : 26;
    const tx = pPos.x + Math.sin(h.angle) * radius;
    const tz = pPos.z + Math.cos(h.angle) * radius;
    const k = Math.min(1, dt * 1.5);
    h.mesh.position.x += (tx - h.mesh.position.x) * k;
    h.mesh.position.z += (tz - h.mesh.position.z) * k;
    h.mesh.position.y += (hoverY - h.mesh.position.y) * k;
    h.mesh.rotation.y = Math.atan2(pPos.x - h.mesh.position.x, pPos.z - h.mesh.position.z);
    h.rotor.rotation.y += dt * 22;
    // Searchlight tracks the player.
    h.spot.target.position.set(pPos.x, (pPos.y || 0) + 1, pPos.z);
    h.spot.target.updateMatrixWorld();
    // Orient the translucent cone from the heli down to the player.
    const from = new THREE.Vector3(h.mesh.position.x, h.mesh.position.y - 0.8, h.mesh.position.z);
    const to = new THREE.Vector3(pPos.x, (pPos.y || 0), pPos.z);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const dir = to.clone().sub(from);
    const len = dir.length();
    h.cone.position.copy(mid);
    h.cone.scale.y = len / h.coneLen;
    h.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize().negate());
    // At wanted >= 4 the heli sits lower and its beam is brighter.
    h.spot.intensity = fast ? 600 : 400;
  }
}
