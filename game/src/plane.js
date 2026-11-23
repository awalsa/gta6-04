// plane.js — Worker F (ISLA BRASA 3D)
// Flyable prop plane parked on the Brasa Airfield runway (south road,
// z = 160, x -20..100 — see config.js RUNWAY). Enter with E near the plane,
// W/S throttle, A/D roll/turn, ArrowUp/ArrowDown pitch. Take off above
// takeoff speed by pulling up; land back on the runway (a rough or
// off-runway landing damages the plane/player, never an instant fail).
// The plane is a SEPARATE vehicle type (S.plane, never in S.cars) so it
// cannot break the car system; the flight physics live in cars.js
// (movePlane) and this module owns the mesh + input + enter/exit.
import * as THREE from 'three';
import { movePlane, planeStats } from './cars.js';

/** Key test tolerant of S.input.keys being a Set, an Array, or a plain object. */
function keyDown(S, code) {
  const k = S?.input?.keys;
  if (!k) return false;
  if (k instanceof Set || Array.isArray(k)) return k.has ? k.has(code) : k.includes(code);
  return !!k[code];
}

export function createPlane(scene, pos) {
  const start = pos?.isVector3 ? pos.clone()
    : new THREE.Vector3(pos?.x ?? 20, 0, pos?.z ?? 160);
  const group = new THREE.Group();
  group.position.copy(start);

  const paint = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xd23c2a, roughness: 0.4, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.15, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });

  // Fuselage (nose +z) + tail cone.
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.5, 5.4, 10), paint);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.position.y = 1.1;
  fuselage.castShadow = true;
  group.add(fuselage);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.2, 10), accent);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.1, 3.2);
  group.add(nose);
  // Canopy.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 10), glass);
  canopy.scale.set(1, 0.7, 1.6);
  canopy.position.set(0, 1.65, 1.2);
  group.add(canopy);
  // Main wings + tailplane + vertical stabilizer.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.16, 1.7), accent);
  wing.position.set(0, 1.25, 0.4);
  wing.castShadow = true;
  group.add(wing);
  const tailplane = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 1.0), paint);
  tailplane.position.set(0, 1.25, -2.6);
  group.add(tailplane);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.3, 1.2), accent);
  fin.position.set(0, 1.9, -2.6);
  group.add(fin);
  // Propeller (spins; movePlane rotates parts.prop).
  const prop = new THREE.Group();
  prop.position.set(0, 1.1, 3.9);
  const bladeGeo = new THREE.BoxGeometry(0.28, 3.2, 0.08);
  const blade1 = new THREE.Mesh(bladeGeo, dark);
  const blade2 = new THREE.Mesh(bladeGeo, dark);
  blade2.rotation.z = Math.PI / 2;
  prop.add(blade1, blade2);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), dark);
  prop.add(hub);
  group.add(prop);
  // Landing gear: two wheels + a tail wheel.
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [wx, wz] of [[-0.8, 1.2], [0.8, 1.2], [0, -2.4]]) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(wx, 0.32, wz);
    group.add(w);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 6), dark);
    strut.position.set(wx, 0.65, wz);
    group.add(strut);
  }

  if (scene) scene.add(group);

  const plane = {
    mesh: group,
    pos: start,
    yaw: pos?.yaw ?? Math.PI / 2, // nose east, down the runway
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    vy: 0,
    airborne: false,
    hp: 100,
    maxHp: 100,
    type: 'plane',
    vehicleKind: 'plane',
    stats: { ...planeStats(null), name: 'Brasa Air' },
    driver: null,
    radius: 2.5,
    parts: { prop, fuselage, wing },
  };
  group.rotation.y = plane.yaw;
  return plane;
}

/** Airspeed in km/h (HUD) and altitude in metres (HUD). */
export function flightReadout(plane) {
  if (!plane) return { altitude: 0, airspeedKmh: 0, throttlePct: 0 };
  return {
    altitude: Math.max(0, Math.round(plane.pos.y)),
    airspeedKmh: Math.round(Math.abs(plane.speed || 0) * 3.6),
    throttlePct: Math.round((plane.throttle || 0) * 100),
  };
}

/** Enter the plane (E near it). Returns { ok } — fails when the plane is
 *  wrecked (hp 0) or the player is already flying it. */
export function enterPlane(S) {
  const p = S?.player;
  const plane = S?.plane;
  if (!p || !plane) return { ok: false, error: 'no plane' };
  if (p.plane) return { ok: false, error: 'already flying' };
  if (p.car) return { ok: false, error: 'exit your car first' };
  if ((plane.hp ?? 100) <= 0) return { ok: false, error: 'the plane is wrecked' };
  const d = Math.hypot(plane.pos.x - p.pos.x, plane.pos.z - p.pos.z);
  if (d > 4) return { ok: false, error: 'get closer to the plane' };
  p.plane = plane;
  plane.driver = p;
  if (p.mesh) p.mesh.visible = false; // hidden while flying
  return { ok: true };
}

/** Exit the plane (E while flying). Only on the ground — mid-air the
 *  pilot is told to land first. Returns { ok } either way. */
export function exitPlane(S) {
  const p = S?.player;
  const plane = S?.plane;
  if (!p || !plane || p.plane !== plane) return { ok: false, error: 'not in the plane' };
  if (plane.airborne || plane.pos.y > 1 || Math.abs(plane.speed || 0) > 5) {
    return { ok: false, error: 'land the plane first' };
  }
  plane.driver = null;
  p.plane = null;
  const side = new THREE.Vector3(Math.cos(plane.yaw), 0, -Math.sin(plane.yaw));
  p.pos.set(plane.pos.x + side.x * 3, 0, plane.pos.z + side.z * 3);
  p.yaw = plane.yaw;
  if (p.mesh) p.mesh.visible = true;
  return { ok: true };
}

/** Per-frame plane update. While the player flies, W/S throttle, A/D roll,
 *  ArrowUp/Down pitch — movePlane (cars.js) owns the physics. The camera
 *  target + yaw follow the plane like cars.js does for cars. Parked, the
 *  mesh just stays in sync. */
export function updatePlane(S, dt) {
  const plane = S?.plane;
  if (!plane || !plane.pos) return;
  dt = Math.min(dt || 0.016, 0.05);
  const p = S.player;
  const flying = !!(p && p.plane === plane);

  if (flying) {
    let throttle = 0;
    if (keyDown(S, 'KeyW')) throttle += 1; // throttle up (ArrowUp is pitch)
    if (keyDown(S, 'KeyS')) throttle -= 1; // throttle down
    let roll = 0;
    if (keyDown(S, 'KeyA') || keyDown(S, 'ArrowLeft')) roll -= 1;
    if (keyDown(S, 'KeyD') || keyDown(S, 'ArrowRight')) roll += 1;
    let pitch = 0;
    if (keyDown(S, 'ArrowUp')) pitch += 1; // pull up / climb
    if (keyDown(S, 'ArrowDown')) pitch -= 1; // nose down / descend
    movePlane(S, plane, dt, throttle, roll, pitch);

    // Track the pilot + camera like a driven car does.
    p.pos.copy(plane.pos);
    p.yaw = plane.yaw;
    if (p.mesh) p.mesh.position.copy(plane.pos);
    if (S) {
      S.cameraTarget = S.cameraTarget || new THREE.Vector3();
      S.cameraTarget.set(plane.pos.x, plane.pos.y + 2, plane.pos.z);
      let targetYaw = plane.yaw + Math.PI;
      let dy = targetYaw - (S.cameraYaw ?? targetYaw);
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      S.cameraYaw = (S.cameraYaw ?? targetYaw) + dy * Math.min(1, dt * 3);
    }
    // Engine hum follows throttle (Worker A audio).
    if (S?.audio?.setEngineLevel) S.audio.setEngineLevel(0.15 + 0.6 * (plane.throttle || 0));
  } else {
    if (plane.mesh) {
      plane.mesh.position.copy(plane.pos);
      plane.mesh.rotation.y = plane.yaw;
    }
  }
}

// ISLA BRASA 3D — Worker F authorship (2026-11-23)
