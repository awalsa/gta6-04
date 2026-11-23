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

  if (throttle > 0) car.speed += accel * throttle * dt;
  else if (throttle < 0) {
    // S while moving forward = brake; while stopped/reversing = reverse.
    car.speed += (car.speed > 0.5 ? accel * 1.4 : accel * 0.7) * throttle * dt;
  } else {
    // Rolling drag.
    car.speed -= car.speed * 0.8 * dt;
    if (Math.abs(car.speed) < 0.05) car.speed = 0;
  }
  car.speed = Math.max(-10, Math.min(top, car.speed));

  // Steering scales with speed (no steering while stationary) and flips in reverse.
  const spdFactor = Math.min(1, Math.abs(car.speed) / 8);
  const steerRate = 1.9 * spdFactor * Math.sign(car.speed || 1);
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
      if (Math.abs(car.speed) > 8) car.speed *= 0.6; // collision scrub
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

  moveCar(S, car, dt, throttle, steer);

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
