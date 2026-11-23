// traffic.js — ambient traffic AI (Worker D, ISLA BRASA 3D).
// ~8 cars cruise the road grid on a simple node graph (world.roadNetwork),
// keep a steady speed, slow/stop when the player is directly ahead, steer
// around the player instead of ramming, and despawn/respawn off-screen so
// there are always ~8 active. Traffic never blocks missions: cars yield to
// the player, never park on a mission marker, and a car the player steals
// is replaced by a fresh one.
//
// Shared shape: a traffic car is a normal car object (cars.js createCar)
// with .traffic = true, .route = { from, target } (road-graph nodes) and
// .cruiseSpeed. It lives in S.cars like any other car, so updateCar keeps
// its mesh in sync; this module only moves .pos/.yaw/.speed.
import * as THREE from 'three';
import { spawnTrafficCar } from './cars.js';
import { roadNetwork } from './world.js';
import { missionMarker } from './missions.js';
import { resolveColliders } from './player.js';

const FALLBACK_LINES = [-160, -80, 0, 80, 160];

function fallbackNetwork() {
  const nodes = [];
  const indexOf = new Map();
  for (const x of FALLBACK_LINES) {
    for (const z of FALLBACK_LINES) {
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

function trafficSettings(S) {
  const t = S?.config?.TRAFFIC || {};
  return {
    count: t.count ?? 8,
    cruiseSpeed: t.cruiseSpeed ?? 12,
    maxSpeed: t.maxSpeed ?? 16,
    yieldDistance: t.yieldDistance ?? 14,
    stopDistance: t.stopDistance ?? 5,
    respawnDistance: t.respawnDistance ?? 130,
    respawnMinDistance: t.respawnMinDistance ?? 60,
    types: Array.isArray(t.types) && t.types.length ? t.types : ['vela', 'brasa', 'coyote', 'cometa'],
  };
}

function nearestNodeIdx(net, x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < net.nodes.length; i++) {
    const d = Math.hypot(net.nodes[i].x - x, net.nodes[i].z - z);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function pickNextNode(net, fromIdx, prevIdx) {
  const opts = (net.adjacent[fromIdx] || []).filter((j) => j !== prevIdx);
  const pool = opts.length ? opts : (net.adjacent[fromIdx] || []);
  if (!pool.length) return fromIdx;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Mission target the traffic must keep clear of (marker, else the
 *  main.js _missionTarget fallback). Returns {x,z} or null. */
function missionTarget(S) {
  try {
    const m = missionMarker(S);
    if (m && typeof m.x === 'number') return { x: m.x, z: m.z };
  } catch { /* missions.js may be absent */ }
  const t = S?._missionTarget;
  if (t && typeof t.x === 'number') return { x: t.x, z: t.z };
  return null;
}

/** A road node is a legal respawn point if it is far enough from the
 *  camera to be off-screen, but not absurdly far, and not on/near the
 *  mission marker. */
function respawnNodeIdx(S, net, camPos, settings) {
  const target = missionTarget(S);
  const cands = [];
  for (let i = 0; i < net.nodes.length; i++) {
    const n = net.nodes[i];
    const dCam = Math.hypot(n.x - camPos.x, n.z - camPos.z);
    if (dCam < settings.respawnMinDistance || dCam > settings.respawnDistance + 60) continue;
    if (target && Math.hypot(n.x - target.x, n.z - target.z) < 15) continue;
    cands.push(i);
  }
  if (!cands.length) return -1;
  return cands[Math.floor(Math.random() * cands.length)];
}

function spawnOne(S, net, settings, atIdx) {
  const idx = (atIdx !== undefined && atIdx >= 0) ? atIdx
    : Math.floor(Math.random() * net.nodes.length);
  const node = net.nodes[idx];
  const nextIdx = pickNextNode(net, idx, -1);
  const target = net.nodes[nextIdx];
  const type = settings.types[Math.floor(Math.random() * settings.types.length)];
  const car = spawnTrafficCar(S, type, { x: node.x, z: node.z }, {
    from: { x: node.x, z: node.z },
    target: { x: target.x, z: target.z },
    fromIdx: idx,
    targetIdx: nextIdx,
  });
  if (!car) return null;
  car.cruiseSpeed = settings.cruiseSpeed;
  car._routeFromIdx = idx;
  car._routeTargetIdx = nextIdx;
  return car;
}

/** Create the traffic set: `count` cars on the road graph. Safe to call
 *  once at boot; updateTraffic keeps the count topped up afterwards. */
export function createTraffic(S, count) {
  const settings = trafficSettings(S);
  const want = count ?? settings.count;
  let net = null;
  try { net = roadNetwork(S); } catch { net = null; }
  if (!net || !Array.isArray(net.nodes) || !net.nodes.length) net = fallbackNetwork();
  const cars = [];
  for (let i = 0; i < want; i++) {
    const car = spawnOne(S, net, settings);
    if (car) cars.push(car);
  }
  const traffic = { cars, net, count: want, settings };
  if (S) S.traffic = traffic;
  return traffic;
}

/** Per-frame traffic update: route following, yielding, respawn, top-up. */
export function updateTraffic(S, dt) {
  const traffic = S?.traffic;
  if (!traffic || !Array.isArray(traffic.cars)) return;
  dt = Math.min(dt || 0.016, 0.05);
  const settings = traffic.settings || trafficSettings(S);
  const net = traffic.net || fallbackNetwork();
  const camPos = S.camera?.position || S.player?.pos || { x: 0, z: 0 };
  const playerPos = S.player?.pos || null;
  const playerCar = S.player?.car || null;
  const target = missionTarget(S);

  for (const car of [...traffic.cars]) {
    if (!car || !car.pos) continue;
    // The player stole this car: it is theirs now; the top-up below
    // replaces it, and the route resumes if they step out.
    if (car.driver) continue;

    // --- despawn / respawn: too far from the camera -> fresh road node ---
    const dCam = Math.hypot(car.pos.x - camPos.x, car.pos.z - camPos.z);
    if (dCam > settings.respawnDistance) {
      const idx = respawnNodeIdx(S, net, camPos, settings);
      if (idx >= 0) {
        const node = net.nodes[idx];
        const nextIdx = pickNextNode(net, idx, -1);
        car.pos.set(node.x, 0, node.z);
        car.speed = 0;
        car.route = {
          from: { x: node.x, z: node.z },
          target: { x: net.nodes[nextIdx].x, z: net.nodes[nextIdx].z },
          fromIdx: idx, targetIdx: nextIdx,
        };
        car._routeFromIdx = idx;
        car._routeTargetIdx = nextIdx;
        car.yaw = Math.atan2(net.nodes[nextIdx].x - node.x, net.nodes[nextIdx].z - node.z);
      }
    }

    // --- route: pick the next node when the target is reached ---
    const rt = car.route;
    if (!rt || !rt.target) {
      const fromIdx = nearestNodeIdx(net, car.pos.x, car.pos.z);
      const nextIdx = pickNextNode(net, fromIdx, -1);
      car.route = {
        from: { ...net.nodes[fromIdx] },
        target: { ...net.nodes[nextIdx] },
        fromIdx, targetIdx: nextIdx,
      };
      car._routeFromIdx = fromIdx;
      car._routeTargetIdx = nextIdx;
    }
    const tgt = car.route.target;
    const distToTarget = Math.hypot(tgt.x - car.pos.x, tgt.z - car.pos.z);
    if (distToTarget < 5) {
      const nextIdx = pickNextNode(net, car._routeTargetIdx, car._routeFromIdx);
      car._routeFromIdx = car._routeTargetIdx;
      car._routeTargetIdx = nextIdx;
      car.route = {
        from: { ...tgt },
        target: { ...net.nodes[nextIdx] },
        fromIdx: car._routeFromIdx, targetIdx: nextIdx,
      };
    }

    // --- yielding: the player (on foot or driving) ahead of this car ---
    // Also never stop on the mission marker: if the player is standing on
    // it, the car creeps around instead of blocking the approach.
    let wantSpeed = settings.cruiseSpeed;
    let steerBias = 0;
    const aheadOf = (px, pz) => {
      const dx = px - car.pos.x, dz = pz - car.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.01 || d > settings.yieldDistance) return 0;
      const fwdX = Math.sin(car.yaw), fwdZ = Math.cos(car.yaw);
      const dot = (dx * fwdX + dz * fwdZ) / d; // 1 = straight ahead
      if (dot < 0.6) return 0;
      return d;
    };
    if (playerPos) {
      const dPlayer = aheadOf(playerPos.x, playerPos.z);
      if (dPlayer > 0) {
        const onMarker = target && Math.hypot(playerPos.x - target.x, playerPos.z - target.z) < 12;
        if (dPlayer < settings.stopDistance && !onMarker) {
          wantSpeed = 0;
        } else {
          wantSpeed = Math.min(wantSpeed, settings.cruiseSpeed * 0.35);
          // Steer around the player: bias away from their side.
          const fwdX = Math.sin(car.yaw), fwdZ = Math.cos(car.yaw);
          const side = (playerPos.x - car.pos.x) * fwdZ - (playerPos.z - car.pos.z) * fwdX;
          steerBias = side > 0 ? -0.5 : 0.5;
          if (onMarker) wantSpeed = Math.max(wantSpeed, settings.cruiseSpeed * 0.5);
        }
      }
    }
    // --- traffic ahead: don't rear-end the car in front ---
    for (const other of traffic.cars) {
      if (!other || other === car || !other.pos || other.driver) continue;
      const dOther = aheadOf(other.pos.x, other.pos.z);
      if (dOther > 0) {
        if (dOther < 5) wantSpeed = Math.min(wantSpeed, 0);
        else wantSpeed = Math.min(wantSpeed, Math.max(0, other.speed || 0));
      }
    }
    // Never sit stopped on the mission marker: creep on after 2.5 s.
    if (wantSpeed === 0 && target && Math.hypot(car.pos.x - target.x, car.pos.z - target.z) < 12) {
      if (!car._blockedAt) car._blockedAt = S.time || 0;
      if ((S.time || 0) - car._blockedAt > 2.5) {
        wantSpeed = settings.cruiseSpeed * 0.5;
        steerBias = 0.6;
        car._blockedAt = 0;
      }
    } else {
      car._blockedAt = 0;
    }

    // --- speed toward the wanted speed ---
    const accel = wantSpeed > car.speed ? 10 : 16;
    if (car.speed < wantSpeed) car.speed = Math.min(wantSpeed, car.speed + accel * dt);
    else if (car.speed > wantSpeed) car.speed = Math.max(wantSpeed, car.speed - accel * dt);

    // --- stuck detection: a lamp post (they stand in the roadways) can
    // wedge a car head-on — resolveColliders cancels the forward motion
    // every frame while the car still "drives". If the car barely moves
    // for ~1.5 game-seconds despite driving, pick a lateral detour bias
    // and hold it until the car is moving freely again.
    const movedX = car.pos.x - (car._lastX ?? car.pos.x);
    const movedZ = car.pos.z - (car._lastZ ?? car.pos.z);
    car._lastX = car.pos.x; car._lastZ = car.pos.z;
    const moved = Math.hypot(movedX, movedZ);
    const expected = Math.abs(car.speed) * dt;
    if (wantSpeed > 2 && car.speed > 2 && expected > 0.01 && moved < expected * 0.3) {
      car._stuckTime = (car._stuckTime || 0) + dt;
    } else if (moved > expected * 0.5) {
      car._stuckTime = 0;
    }
    if ((car._stuckTime || 0) > 1.5 && !((S.time || 0) < (car._detourUntil || 0))) {
      car._detourBias = (Math.random() < 0.5 ? -1 : 1) * 0.9;
      car._detourUntil = (S.time || 0) + 2.5;
      car._stuckTime = 0;
    }
    if ((S.time || 0) < (car._detourUntil || 0)) {
      steerBias += car._detourBias || 0;
    }

    // --- steer toward the route target (plus any yield bias) ---
    const desiredYaw = Math.atan2(tgt.x - car.pos.x, tgt.z - car.pos.z);
    let dy = desiredYaw - car.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const turnRate = 2.2;
    car.yaw += THREE.MathUtils.clamp(dy, -turnRate * dt, turnRate * dt);
    if (steerBias) car.yaw += steerBias * 1.4 * dt;

    // --- move + keep on the road grid (buildings push out) ---
    car.pos.x += Math.sin(car.yaw) * car.speed * dt;
    car.pos.z += Math.cos(car.yaw) * car.speed * dt;
    resolveColliders(car.pos, car.radius || 1.9, S?.world?.colliders);
    car.pos.x = Math.max(-200, Math.min(200, car.pos.x));
    car.pos.z = Math.max(-200, Math.min(200, car.pos.z));
    if (car.mesh) {
      car.mesh.position.copy(car.pos);
      car.mesh.rotation.y = car.yaw;
    }
  }

  // --- top-up: replace cars the player stole so ~count stay active ---
  const active = traffic.cars.filter((c) => c && !c.driver).length;
  for (let i = active; i < settings.count; i++) {
    const idx = respawnNodeIdx(S, net, camPos, settings);
    if (idx < 0) break; // no legal off-screen node right now; try next frame
    const car = spawnOne(S, net, settings, idx);
    if (car) traffic.cars.push(car);
    else break;
  }
  // Prune entries whose mesh was removed from the scene (defensive).
  traffic.cars = traffic.cars.filter((c) => c && c.pos && (S.cars || []).includes(c));
}
