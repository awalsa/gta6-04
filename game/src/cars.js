// cars.js — Worker C (ISLA BRASA 3D)
// Low-poly cars: box body + cabin box + 4 cylinder wheels.
// W/S accelerate/brake/reverse, A/D steer (scales with speed), camera follows
// behind the car, AABB push-out vs colliders, simple car-vs-car push.
// Car types mirror the config.js CARS table; defaults live here too so cars
// work even if config.js (Worker D) is not written yet. If S.config?.CARS
// exists at runtime it takes precedence.
import * as THREE from 'three';
import { resolveColliders } from './player.js';

export const CARS = {
  Vela:    { name: 'Vela',     topSpeed: 28, accel: 12, color: 0x3a7bd5, price: 2800 },
  'Brasa GT': { name: 'Brasa GT', topSpeed: 38, accel: 18, color: 0xd23c2a, price: 6500 },
  Coyote:  { name: 'Coyote',   topSpeed: 26, accel: 10, color: 0x7a5c2e, price: 4200, truck: true },
  Cometa:  { name: 'Cometa',   topSpeed: 46, accel: 24, color: 0xf2c200, price: 12000 },
  police:  { name: 'Police Cruiser', topSpeed: 32, accel: 14, color: 0x14181d, price: 0 },
};

export function carStats(S, type) {
  const key = normalizeCarType(type);
  // config.js (Worker D) exports CAR_TYPES keyed by lowercase id
  // (vela/brasa/coyote/cometa); also accept the CARS alias if present.
  const cfg = S?.config?.CAR_TYPES || S?.config?.CARS;
  if (cfg) {
    const hit = cfg[type] || cfg[key] || Object.values(cfg).find(
      (c) => c && (c.id === type || c.name === key || c.name === type));
    if (hit) return hit;
  }
  return CARS[key] || CARS.Vela;
}

/** Accepts config ids ('vela','brasa','coyote','cometa'), display names
 *  ('Vela','Brasa GT','Coyote','Cometa') and 'police'. */
export function normalizeCarType(type) {
  const aliases = {
    vela: 'Vela', brasa: 'Brasa GT', coyote: 'Coyote', cometa: 'Cometa',
    police: 'police',
    Vela: 'Vela', 'Brasa GT': 'Brasa GT', Coyote: 'Coyote', Cometa: 'Cometa',
  };
  return aliases[type] || 'Vela';
}

const CAR_COLORS = [0x3a7bd5, 0xd23c2a, 0xf2c200, 0x2e8b57, 0x8e44ad, 0xe67e22, 0xdddddd];

export function createCar(scene, type, pos) {
  const key = normalizeCarType(type);
  const stats = CARS[key] || CARS.Vela;
  const typeId = type; // keep the caller's id ('brasa', 'cometa', ...) on the car
  const isTruck = !!stats.truck;
  const group = new THREE.Group();
  const start = pos?.isVector3 ? pos.clone()
    : new THREE.Vector3(pos?.x ?? 0, 0, pos?.z ?? 0);
  group.position.copy(start);

  const paint = new THREE.MeshStandardMaterial({ color: stats.color, roughness: 0.4, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.15, metalness: 0.6 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.95 });
  const hub = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.3, metalness: 0.7 });

  const len = isTruck ? 5.4 : 4.2;
  const bodyH = isTruck ? 1.0 : 0.65;

  // Body + cabin.
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, bodyH, len), paint);
  body.position.y = 0.62;
  body.castShadow = true;
  group.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.55, isTruck ? 1.4 : 2.1), glass);
  cabin.position.set(0, 1.2, isTruck ? 1.2 : -0.2);
  cabin.castShadow = true;
  group.add(cabin);
  if (isTruck) {
    // Truck bed walls.
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 2.2), paint);
    bed.position.set(0, 1.25, -1.3);
    group.add(bed);
  }
  if (key === 'police') {
    // White doors band + light bar.
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.28, 2.4),
      new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }));
    band.position.y = 0.62;
    group.add(band);
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x222222 }));
    barBase.position.set(0, 1.55, -0.2);
    group.add(barBase);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 1 }));
    red.position.set(-0.28, 1.55, -0.2);
    group.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2266ff, emissive: 0x2266ff, emissiveIntensity: 1 }));
    blue.position.set(0.28, 1.55, -0.2);
    group.add(blue);
  }

  // Headlights / taillights.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6c0, emissive: 0xffeE88, emissiveIntensity: 0.9 });
  for (const sx of [-0.65, 0.65]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), lightMat);
    hl.position.set(sx, 0.62, len / 2 + 0.01);
    group.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xcc1111, emissive: 0xaa0000, emissiveIntensity: 0.8 }));
    tl.position.set(sx, 0.62, -len / 2 - 0.01);
    group.add(tl);
  }

  // 4 cylinder wheels (axis along X).
  const wheels = {};
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const spots = { FL: [-0.95, len / 2 - 0.85], FR: [0.95, len / 2 - 0.85], RL: [-0.95, -len / 2 + 0.85], RR: [0.95, -len / 2 + 0.85] };
  for (const [key, [x, z]] of Object.entries(spots)) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, z);
    const tyreMesh = new THREE.Mesh(wheelGeo, tyre);
    const hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 8), hub);
    hubMesh.rotation.z = Math.PI / 2;
    pivot.add(tyreMesh, hubMesh);
    pivot.castShadow = true;
    group.add(pivot);
    wheels[key] = pivot;
  }

  if (scene) scene.add(group);

  const car = {
    mesh: group,
    pos: start,
    yaw: 0,
    speed: 0,
    type: typeId,
    stats,
    driver: null,
    steer: 0,
    radius: 1.9,
    hp: 100,
    maxHp: 100,
    parts: { wheels, body, cabin },
  };
  group.rotation.y = car.yaw;
  return car;
}

/** Shared driving physics; `throttle` -1..1, `steerInput` -1 (left) .. 1 (right).
 *  Used by updateCar for the player and by police.js for chasing cruisers. */
export function moveCar(S, car, dt, throttle, steerInput) {
  const top = car.stats?.topSpeed ?? 28;
  const accel = car.stats?.accel ?? 12;
  // Worker E: rain cuts grip — less acceleration and lazier steering.
  const raining = !!(S?.weather && typeof S.weather.isRaining === 'function' && S.weather.isRaining());
  const grip = raining ? (S?.config?.WEATHER?.gripMultiplier ?? S?.weather?.grip ?? 0.75) : 1;
  const topMult = raining ? (S?.config?.WEATHER?.topSpeedMultiplier ?? 0.95) : 1;

  if (throttle > 0) car.speed += accel * grip * throttle * dt;
  else if (throttle < 0) {
    // S while moving forward = brake; while stopped/reversing = reverse.
    car.speed += (car.speed > 0.5 ? accel * 1.4 : accel * 0.7) * grip * throttle * dt;
  } else {
    // Rolling drag.
    car.speed -= car.speed * 0.8 * dt;
    if (Math.abs(car.speed) < 0.05) car.speed = 0;
  }
  car.speed = Math.max(-10, Math.min(top * topMult, car.speed));

  // Steering scales with speed (no steering while stationary) and flips in reverse.
  const spdFactor = Math.min(1, Math.abs(car.speed) / 8);
  const steerRate = 1.9 * grip * spdFactor * Math.sign(car.speed || 1);
  car.yaw += steerInput * steerRate * dt;
  car.steer = steerInput * 0.42 * spdFactor;

  const fwdX = Math.sin(car.yaw), fwdZ = Math.cos(car.yaw);
  car.pos.x += fwdX * car.speed * dt;
  car.pos.z += fwdZ * car.speed * dt;

  // Colliders + world bounds.
  resolveColliders(car.pos, car.radius, S?.world?.colliders);
  car.pos.x = Math.max(-230, Math.min(230, car.pos.x));
  car.pos.z = Math.max(-230, Math.min(230, car.pos.z));

  // Car-vs-car push (circle overlap, both cars move unless one is the driver).
  for (const other of S?.cars || []) {
    if (!other || other === car || !other.pos) continue;
    const dx = car.pos.x - other.pos.x, dz = car.pos.z - other.pos.z;
    const d = Math.hypot(dx, dz), min = car.radius + (other.radius ?? 1.9) - 0.4;
    if (d > 0.01 && d < min) {
      const push = (min - d) / 2;
      const nx = dx / d, nz = dz / d;
      car.pos.x += nx * push; car.pos.z += nz * push;
      other.pos.x -= nx * push; other.pos.z -= nz * push;
      if (other.mesh) { other.mesh.position.copy(other.pos); }
      if (Math.abs(car.speed) > 8) { car.speed *= 0.6; car.hp = Math.max(0, (car.hp ?? 100) - 10); } // collision scrub + damage
    }
  }
  // Police cars live in S._policeCars, not S.cars — push against those too.
  for (const other of S?._policeCars || []) {
    if (!other || other === car || !other.pos) continue;
    const dx = car.pos.x - other.pos.x, dz = car.pos.z - other.pos.z;
    const d = Math.hypot(dx, dz), min = car.radius + 1.9 - 0.4;
    if (d > 0.01 && d < min) {
      const push = (min - d) / 2;
      const nx = dx / d, nz = dz / d;
      car.pos.x += nx * push; car.pos.z += nz * push;
      other.pos.x -= nx * push; other.pos.z -= nz * push;
      if (other.mesh) other.mesh.position.copy(other.pos);
    }
  }

  // Sync mesh + wheel spin / front-wheel steer.
  if (car.mesh) {
    car.mesh.position.copy(car.pos);
    car.mesh.rotation.y = car.yaw;
  }
  const w = car.parts?.wheels;
  if (w) {
    const spin = (car.speed * dt) / 0.36;
    for (const key of ['FL', 'FR', 'RL', 'RR']) {
      const pivot = w[key];
      if (!pivot) continue;
      pivot.children[0].rotation.x += spin;
      pivot.children[1].rotation.x += spin;
    }
    if (w.FL) w.FL.rotation.y = car.steer;
    if (w.FR) w.FR.rotation.y = car.steer;
  }
}

export function updateCar(S, car, dt) {
  if (!car) return;
  dt = Math.min(dt || 0.016, 0.05);
  const driven = S?.player?.car === car;
  if (!driven) {
    // Parked / AI car: no throttle, just keep the mesh in sync.
    if (car.mesh) { car.mesh.position.copy(car.pos); car.mesh.rotation.y = car.yaw; }
    return;
  }
  const k = S.input?.keys;
  const has = (code) => {
    if (!k) return false;
    return k instanceof Set ? k.has(code) : Array.isArray(k) ? k.includes(code) : !!k[code];
  };
  let throttle = 0;
  if (has('KeyW') || has('ArrowUp')) throttle += 1;
  if (has('KeyS') || has('ArrowDown')) throttle -= 1;
  let steer = 0;
  if (has('KeyA') || has('ArrowLeft')) steer -= 1;
  if (has('KeyD') || has('ArrowRight')) steer += 1;

  // Bikes and boats have their own drive physics (lean / water handling).
  if (car.vehicleKind === 'bike') moveBike(S, car, dt, throttle, steer);
  else if (car.vehicleKind === 'boat') moveBoat(S, car, dt, throttle, steer);
  else moveCar(S, car, dt, throttle, steer);

  // Engine hum follows car speed (Worker A audio).
  if (S?.audio?.setEngineLevel) S.audio.setEngineLevel(Math.min(1, Math.abs(car.speed || 0) / ((car.stats && car.stats.topSpeed) || 30)));

  // Pedestrians flee a fast car bearing down on them (throttled).
  if (Math.abs(car.speed) > 10 && (S.time - (car._fleeAt || 0)) > 0.5) {
    car._fleeAt = S.time;
    if (typeof S.pedestriansFleeFrom === 'function') S.pedestriansFleeFrom(car.pos, S.config?.PEDESTRIAN_CAR_FLEE_RADIUS ?? 12);
  }
  // Damaged car smokes continuously; fast off-road driving kicks up dust.
  if (car.hp !== undefined && car.hp < 40 && (S.time - (car._smokeAt || 0)) > 0.25) {
    car._smokeAt = S.time;
    if (S.particles?.spawnSmoke) S.particles.spawnSmoke(car.pos);
  }
  const ROAD_LINES = [-160, -80, 0, 80, 160];
  const onRoad = ROAD_LINES.some((l) => Math.abs(car.pos.x - l) < 9) || ROAD_LINES.some((l) => Math.abs(car.pos.z - l) < 9);
  if (car.vehicleKind !== 'boat' && !onRoad && Math.abs(car.speed) > 15 && (S.time - (car._dustAt || 0)) > 0.12) {
    car._dustAt = S.time;
    const bx = car.pos.x - Math.sin(car.yaw) * 2, bz = car.pos.z - Math.cos(car.yaw) * 2;
    if (S.particles?.spawnDust) S.particles.spawnDust({ x: bx, y: 0, z: bz });
  }

  // Camera follows behind the car; keep S.cameraYaw in sync so that
  // stepping out (E) faces a sensible direction.
  if (S) {
    S.cameraTarget = S.cameraTarget || new THREE.Vector3();
    S.cameraTarget.set(car.pos.x, car.pos.y + 2, car.pos.z);
    let targetYaw = car.yaw + Math.PI;
    let dy = targetYaw - (S.cameraYaw ?? targetYaw);
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    S.cameraYaw = (S.cameraYaw ?? targetYaw) + dy * Math.min(1, dt * 3);
  }
}

const DEFAULT_SPOTS = [
  [-40, -20, 0], [40, 20, Math.PI / 2], [-20, 60, 0], [60, -40, Math.PI / 2],
  [-80, 40, 0], [20, -80, Math.PI / 2], [100, 60, 0], [-100, -60, Math.PI / 2],
  [0, 120, 0], [140, -20, Math.PI / 2], [-140, 100, 0], [80, 120, Math.PI / 2],
];

// ---------------------------------------------------------------------------
// Traffic spawner (Worker D): a moving car for traffic.js. Same shape as a
// normal car, plus traffic/route bookkeeping; the traffic module steers it
// along the road graph and respawns it when it gets far from the camera.
// ---------------------------------------------------------------------------
export function spawnTrafficCar(S, type, pos, route) {
  const car = createCar(S?.scene, type, pos);
  if (!car) return null;
  car.traffic = true;
  car.vehicleKind = 'car';
  car.route = route || null;
  car.cruiseSpeed = (S?.config?.TRAFFIC?.cruiseSpeed) ?? 12;
  car._yieldStopAt = 0;
  if (route?.target) {
    car.yaw = Math.atan2(route.target.x - car.pos.x, route.target.z - car.pos.z);
    car.mesh.rotation.y = car.yaw;
  }
  if (S) { S.cars = S.cars || []; S.cars.push(car); }
  return car;
}

// ---------------------------------------------------------------------------
// Motorbike (Worker D): fastest top speed in the game, but twitchy —
// sharper steering, a visible lean into turns, and a speed wobble when
// steering hard at full speed. The wobble only scrubs speed; it never
// crashes the bike or hurts the player.
// ---------------------------------------------------------------------------
export const BIKE_STATS = { id: 'bike', name: 'Brisa Bike', kind: 'bike', price: 1500, topSpeed: 52, accel: 22 };

export function createBike(scene, pos) {
  const group = new THREE.Group();
  const start = pos?.isVector3 ? pos.clone()
    : new THREE.Vector3(pos?.x ?? 0, 0, pos?.z ?? 0);
  group.position.copy(start);

  const paint = new THREE.MeshStandardMaterial({ color: 0x18a058, roughness: 0.35, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.8 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.25, metalness: 0.8 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.95 });

  // Wheels (thin cylinders, axis along X), 1.1 apart.
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.14, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = {};
  for (const [key, z] of [['F', 0.75], ['R', -0.75]]) {
    const w = new THREE.Mesh(wheelGeo, tyre);
    w.position.set(0, 0.34, z);
    group.add(w);
    wheels[key] = w;
  }
  // Frame: low tank + seat + handlebar + headlight.
  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.8), paint);
  tank.position.set(0, 0.72, 0.15);
  group.add(tank);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.55), dark);
  seat.position.set(0, 0.78, -0.45);
  group.add(seat);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), chrome);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.02, 0.72);
  group.add(bar);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xfff6c0, emissive: 0xffee88, emissiveIntensity: 0.9 }));
  lamp.position.set(0, 0.8, 0.92);
  group.add(lamp);

  if (scene) scene.add(group);

  const bike = {
    mesh: group,
    pos: start,
    yaw: 0,
    speed: 0,
    type: 'bike',
    vehicleKind: 'bike',
    stats: { ...BIKE_STATS },
    driver: null,
    steer: 0,
    lean: 0,
    radius: 0.9,
    hp: 100,
    maxHp: 100,
    parts: { wheels, body: tank },
  };
  group.rotation.y = bike.yaw;
  return bike;
}

/** Bike drive physics: same W/S/A/D input as cars, sharper steering, lean
 *  into turns, high-speed wobble that only scrubs speed (never lethal). */
export function moveBike(S, bike, dt, throttle, steerInput) {
  const top = bike.stats?.topSpeed ?? 52;
  const accel = bike.stats?.accel ?? 22;

  if (throttle > 0) bike.speed += accel * throttle * dt;
  else if (throttle < 0) {
    bike.speed += (bike.speed > 0.5 ? accel * 1.4 : accel * 0.7) * throttle * dt;
  } else {
    bike.speed -= bike.speed * 0.5 * dt;
    if (Math.abs(bike.speed) < 0.05) bike.speed = 0;
  }
  bike.speed = Math.max(-8, Math.min(top, bike.speed));

  // Sharper steering than a car, still scaled by speed.
  const spdFactor = Math.min(1, Math.abs(bike.speed) / 8);
  const steerRate = 2.6 * spdFactor * Math.sign(bike.speed || 1);
  bike.yaw += steerInput * steerRate * dt;
  bike.steer = steerInput * 0.5 * spdFactor;

  // High-speed wobble: hard steering above 40 u/s shakes the bike and
  // scrubs speed — a warning, never a crash.
  if (Math.abs(bike.speed) > 40 && Math.abs(steerInput) > 0.4) {
    bike.yaw += Math.sin((S?.time || 0) * 9) * 0.22 * dt * Math.sign(bike.speed);
    bike.speed *= (1 - 0.15 * dt);
  }

  const fwdX = Math.sin(bike.yaw), fwdZ = Math.cos(bike.yaw);
  bike.pos.x += fwdX * bike.speed * dt;
  bike.pos.z += fwdZ * bike.speed * dt;

  resolveColliders(bike.pos, bike.radius, S?.world?.colliders);
  bike.pos.x = Math.max(-230, Math.min(230, bike.pos.x));
  bike.pos.z = Math.max(-230, Math.min(230, bike.pos.z));

  // Gentle push against other vehicles (no damage — bikes just bounce off).
  for (const other of S?.cars || []) {
    if (!other || other === bike || !other.pos) continue;
    const dx = bike.pos.x - other.pos.x, dz = bike.pos.z - other.pos.z;
    const d = Math.hypot(dx, dz), min = bike.radius + (other.radius ?? 1.9) - 0.3;
    if (d > 0.01 && d < min) {
      const push = (min - d) / 2;
      bike.pos.x += (dx / d) * push; bike.pos.z += (dz / d) * push;
      other.pos.x -= (dx / d) * push; other.pos.z -= (dz / d) * push;
      if (other.mesh) other.mesh.position.copy(other.pos);
    }
  }

  // Lean into the turn; ease back upright when the steering releases.
  const targetLean = -steerInput * 0.38 * spdFactor;
  bike.lean += (targetLean - bike.lean) * Math.min(1, dt * 8);

  if (bike.mesh) {
    bike.mesh.position.copy(bike.pos);
    bike.mesh.rotation.y = bike.yaw;
    bike.mesh.rotation.z = bike.lean;
  }
  const w = bike.parts?.wheels;
  if (w) {
    const spin = (bike.speed * dt) / 0.34;
    for (const key of ['F', 'R']) {
      if (w[key]) w[key].rotation.x += spin;
    }
  }
}

// ---------------------------------------------------------------------------
// Boat (Worker D): drives on the water strips (west x < -170, south
// z > 170). Sluggish steering, long momentum, gentle bob + roll. It cannot
// leave the water: hitting the shoreline bounces it back softly.
// ---------------------------------------------------------------------------
export const BOAT_STATS = { id: 'boat', name: 'Marina Skiff', kind: 'boat', price: 4500, topSpeed: 34, accel: 14 };

export function createBoat(scene, pos) {
  const group = new THREE.Group();
  const start = pos?.isVector3 ? pos.clone()
    : new THREE.Vector3(pos?.x ?? 0, 0, pos?.z ?? 0);
  group.position.copy(start);

  const hullMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, metalness: 0.1 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2471a3, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.15, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.8 });

  // Hull + bow wedge + cabin + outboard motor.
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 6.4), hullMat);
  hull.position.y = 0.55;
  group.add(hull);
  const bow = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 1.6), hullMat);
  bow.position.set(0, 0.55, 3.6);
  bow.rotation.x = -0.35;
  group.add(bow);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.22, 6.4), trimMat);
  stripe.position.y = 0.95;
  group.add(stripe);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 2.2), glass);
  cabin.position.set(0, 1.45, -0.6);
  group.add(cabin);
  const motor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.5), dark);
  motor.position.set(0, 0.7, -3.4);
  group.add(motor);

  if (scene) scene.add(group);

  const boat = {
    mesh: group,
    pos: start,
    yaw: 0,
    speed: 0,
    type: 'boat',
    vehicleKind: 'boat',
    stats: { ...BOAT_STATS },
    driver: null,
    steer: 0,
    radius: 2.2,
    hp: 100,
    maxHp: 100,
    _bobPhase: Math.random() * Math.PI * 2,
    parts: { body: hull, cabin },
  };
  group.rotation.y = boat.yaw;
  return boat;
}

/** Boat drive physics: same W/S/A/D input, slow steering, long glide,
 *  bob + roll on the waves, and a soft bounce off the shoreline. */
export function moveBoat(S, boat, dt, throttle, steerInput) {
  const top = boat.stats?.topSpeed ?? 34;
  const accel = boat.stats?.accel ?? 14;

  if (throttle > 0) boat.speed += accel * throttle * dt;
  else if (throttle < 0) {
    boat.speed += (boat.speed > 0.5 ? accel * 1.2 : accel * 0.6) * throttle * dt;
  } else {
    // Water drag is light: the boat glides on after the throttle lifts.
    boat.speed -= boat.speed * 0.25 * dt;
    if (Math.abs(boat.speed) < 0.05) boat.speed = 0;
  }
  boat.speed = Math.max(-8, Math.min(top, boat.speed));

  // Sluggish steering (boats turn slow) that still flips in reverse.
  const spdFactor = Math.min(1, Math.abs(boat.speed) / 8);
  const steerRate = 1.2 * spdFactor * Math.sign(boat.speed || 1);
  boat.yaw += steerInput * steerRate * dt;
  boat.steer = steerInput * 0.3 * spdFactor;

  const prevX = boat.pos.x, prevZ = boat.pos.z;
  boat.pos.x += Math.sin(boat.yaw) * boat.speed * dt;
  boat.pos.z += Math.cos(boat.yaw) * boat.speed * dt;
  boat.pos.x = Math.max(-200, Math.min(200, boat.pos.x));
  boat.pos.z = Math.max(-200, Math.min(200, boat.pos.z));

  // Stay on the water: west strip (x < -170) or south strip (z > 170).
  // Running aground bounces the boat back instead of beaching it.
  if (boat.pos.x > -170 && boat.pos.z < 170) {
    boat.pos.x = prevX; boat.pos.z = prevZ;
    boat.speed *= -0.15;
  }

  if (boat.mesh) {
    const t = (S?.time || 0) + boat._bobPhase;
    boat.mesh.position.set(boat.pos.x, 0.12 + Math.sin(t * 2) * 0.07, boat.pos.z);
    boat.mesh.rotation.y = boat.yaw;
    boat.mesh.rotation.z = Math.sin(t * 1.3) * 0.05 + boat.steer * 0.08;
  }
}

// ---------------------------------------------------------------------------
// Plane flight physics (Worker F): simple throttle + pitch/roll model.
// The plane is a SEPARATE vehicle type (S.plane, never in S.cars) — this is
// the only place cars.js touches flight; plane.js owns the mesh + input
// mapping and calls movePlane each frame while the player flies.
//   throttleInput: -1 (S: throttle down) .. +1 (W: throttle up)
//   rollInput: -1 (A: bank left) .. +1 (D: bank right)
//   pitchInput: -1 (ArrowDown: nose down) .. +1 (ArrowUp: pull up / climb)
// ---------------------------------------------------------------------------
export const PLANE_DEFAULTS = {
  takeoffSpeed: 22, maxSpeed: 55, stallSpeed: 14, accel: 10,
  climbRate: 12, maxPitch: 0.5, maxBank: 0.9, turnRate: 0.9,
};

export function planeStats(S) {
  return { ...PLANE_DEFAULTS, ...(S?.config?.PLANE || {}) };
}

/** Is (x, z) over the runway strip? Used for the landing check. */
export function isOverRunway(S, x, z) {
  const r = S?.config?.RUNWAY || { x: 40, z: 160, length: 120, width: 12 };
  return Math.abs(x - r.x) <= r.length / 2 + 6 && Math.abs(z - r.z) <= r.width / 2 + 4;
}

export function movePlane(S, plane, dt, throttleInput, rollInput, pitchInput) {
  if (!plane || !plane.pos) return;
  dt = Math.min(dt || 0.016, 0.05);
  const st = planeStats(S);

  // --- throttle: W spools up, S spools down (0..1) ---
  plane.throttle = Math.max(0, Math.min(1, (plane.throttle || 0) + (throttleInput || 0) * 0.5 * dt));
  const targetSpeed = plane.throttle * st.maxSpeed;
  // Acceleration is the engine (st.accel); deceleration in the air is
  // gentle air drag so a dive keeps its speed, while on the ground the
  // plane brakes hard (rolling friction). A dive therefore still lands
  // hard, but a level power-off glide bleeds speed and lands softly.
  const rate = targetSpeed > plane.speed ? st.accel : (plane.airborne ? 6 : st.accel * 1.6);
  plane.speed += Math.max(-rate * dt, Math.min(rate * dt, targetSpeed - plane.speed));
  plane.speed = Math.max(0, plane.speed);

  // --- pitch / roll ease toward the pilot's input ---
  const targetPitch = (pitchInput || 0) * st.maxPitch;
  const targetRoll = (rollInput || 0) * st.maxBank;
  plane.pitch += (targetPitch - plane.pitch) * Math.min(1, dt * 3);
  plane.roll += (targetRoll - plane.roll) * Math.min(1, dt * 3);

  if (!plane.airborne) {
    // --- on the ground: taxi along the heading, steer gently with A/D ---
    plane.pitch = 0;
    plane.roll = 0;
    const spdFactor = Math.min(1, plane.speed / 8);
    plane.yaw += (rollInput || 0) * 1.1 * spdFactor * dt;
    plane.pos.x += Math.sin(plane.yaw) * plane.speed * dt;
    plane.pos.z += Math.cos(plane.yaw) * plane.speed * dt;
    plane.pos.y = 0;
    // Liftoff: above takeoff speed + pulling up.
    if (plane.speed >= st.takeoffSpeed && (pitchInput || 0) > 0.2) {
      plane.airborne = true;
      plane.vy = st.climbRate * 0.4;
    }
  } else {
    // --- in the air: banked turns, pitch sets climb/descent, stall sinks ---
    plane.yaw += plane.roll * st.turnRate * dt;
    const climbing = Math.sin(plane.pitch) * plane.speed;
    // Stall sink is capped below the hard-landing threshold (-6 u/s) so a
    // fully stalled plane still lands gently — only a steep powered
    // descent counts as a rough landing.
    const stallSink = plane.speed < st.stallSpeed ? (st.stallSpeed - plane.speed) * 0.35 : 0;
    plane.vy = climbing - stallSink;
    plane.pos.y += plane.vy * dt;
    plane.pos.x += Math.sin(plane.yaw) * Math.cos(plane.pitch) * plane.speed * dt;
    plane.pos.z += Math.cos(plane.yaw) * Math.cos(plane.pitch) * plane.speed * dt;
    plane.pos.y = Math.min(plane.pos.y, 120); // ceiling
    // --- landing check: touching down ---
    if (plane.pos.y <= 0) {
      plane.pos.y = 0;
      const hard = plane.vy < -6; // descending too fast
      const offRunway = !isOverRunway(S, plane.pos.x, plane.pos.z);
      if (hard || offRunway) {
        // Rough landing: damage, never an instant fail.
        const dmg = (hard ? 25 : 0) + (offRunway ? 15 : 0);
        plane.hp = Math.max(0, (plane.hp ?? 100) - dmg);
        if (S.player && S.player.plane === plane) {
          S.player.hp = Math.max(1, (S.player.hp ?? 100) - Math.round(dmg / 2));
          if (S.flash) S.flash(hard ? 'Rough landing! The plane took damage.' : 'Off-runway landing! The plane took damage.');
        }
        plane.speed *= 0.4;
      }
      plane.airborne = false;
      plane.vy = 0;
      plane.pitch = 0;
      plane.roll = 0;
    }
  }

  // --- soft world bounds ---
  plane.pos.x = Math.max(-230, Math.min(230, plane.pos.x));
  plane.pos.z = Math.max(-230, Math.min(230, plane.pos.z));

  // --- mesh sync: nose-up is rotation.x negative for a +z-forward model.
  // Roll sign matches the cars (A decreases yaw, same as moveCar): the
  // plane banks INTO its turn, so rotation.z takes the roll value as-is.
  if (plane.mesh) {
    plane.mesh.position.copy(plane.pos);
    plane.mesh.rotation.set(-plane.pitch, plane.yaw, plane.roll);
  }
  // Propeller spin (plane.js stores it in parts.prop).
  if (plane.parts?.prop) plane.parts.prop.rotation.z += dt * (4 + plane.throttle * 40);
}

/** Spawn the world's free bike (by the garage) + boats (on the water).
 *  Uses S.world.spawnPoints when the world module provides them, else
 *  built-in spots. All three are enterable with E like parked cars. */
export function spawnWorldVehicles(S) {
  if (!S) return [];
  S.cars = S.cars || [];
  const sp = S.world?.spawnPoints || {};
  const bikeAt = sp.bike || { x: 72, z: -110 };
  const boatAts = Array.isArray(sp.boats) && sp.boats.length
    ? sp.boats
    : [{ x: -185, z: -150 }, { x: 30, z: 186 }, { x: -190, z: 60 }];
  const created = [];
  const bike = createBike(S.scene, bikeAt);
  bike.yaw = Math.PI / 2;
  bike.mesh.rotation.y = bike.yaw;
  S.cars.push(bike);
  created.push(bike);
  for (const [i, p] of boatAts.entries()) {
    const boat = createBoat(S.scene, p);
    boat.yaw = i === 1 ? Math.PI : (i === 2 ? -Math.PI / 2 : 0);
    boat.mesh.rotation.y = boat.yaw;
    S.cars.push(boat);
    created.push(boat);
  }
  return created;
}

/** Scatter 10+ drivable parked cars on roads. Uses S.world.spawnPoints
 *  when the world module provides them, else a built-in road grid. */
export function spawnParkedCars(S) {
  if (!S) return [];
  S.cars = S.cars || [];
  const types = ['Vela', 'Brasa GT', 'Coyote', 'Cometa'];
  const spots = [];
  const sp = S.world?.spawnPoints;
  // world.js shape: { player: {x,z}, cars: [{x,z,angle}, ...] }.
  // Also accept a plain array of points.
  const carSpawns = Array.isArray(sp) ? sp : sp?.cars;
  if (Array.isArray(carSpawns) && carSpawns.length) {
    for (const p of carSpawns) {
      const x = p.x ?? p[0] ?? 0, z = p.z ?? p[2] ?? 0;
      spots.push([x, z, p.angle ?? 0]);
    }
    // Top the list up to 10 with built-in road spots (the world only
    // defines 7 car spawns, and it also parks static cars on those).
    for (const s of DEFAULT_SPOTS) {
      if (spots.length >= 10) break;
      if (!spots.some(([x, z]) => Math.hypot(x - s[0], z - s[1]) < 8)) spots.push(s);
    }
  } else {
    spots.push(...DEFAULT_SPOTS);
  }
  const created = [];
  spots.slice(0, 10).forEach(([x, z, yaw], i) => {
    const type = types[i % types.length];
    const car = createCar(S.scene, type, { x, z });
    car.yaw = yaw;
    car.mesh.rotation.y = yaw;
    // Vary the paint a little so parked cars do not all match.
    if (i % 3 === 1 && car.parts?.body) {
      car.parts.body.material = car.parts.body.material.clone();
      car.parts.body.material.color.setHex(CAR_COLORS[i % CAR_COLORS.length]);
    }
    S.cars.push(car);
    created.push(car);
  });
  return created;
}

// ISLA BRASA 3D — recorded agent authorship touch (2026-11-23)
