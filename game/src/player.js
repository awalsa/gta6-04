// player.js — Worker C (ISLA BRASA 3D)
// Low-poly humanoid player: WASD camera-relative movement, Shift run,
// limb-swing walk animation, Space jump, E enter/exit car, F interact,
// mouse-click attack (delegates to combat.js), AABB push-out, respawn.
// Shared contract: Y-up, ground XZ. Arcade landmark (0,0) is the respawn point.
import * as THREE from 'three';
import { playerAttack } from './combat.js';

export const WALK_SPEED = 6; // u/s
export const RUN_SPEED = 10; // u/s
export const PLAYER_RADIUS = 0.5;
export const PLAYER_HP = 100;
export const RESPAWN_POINT = { x: 0, z: 0 }; // arcade (0,0)

// ---------------------------------------------------------------- helpers
export function toVec3(pos, y = 0) {
  if (!pos) return new THREE.Vector3(0, y, 0);
  if (pos.isVector3) return pos.clone();
  if (Array.isArray(pos)) return new THREE.Vector3(pos[0] ?? 0, pos[1] ?? y, pos[2] ?? 0);
  return new THREE.Vector3(pos.x ?? 0, pos.y ?? y, pos.z ?? 0);
}

/** Key test tolerant of S.input.keys being a Set, an Array, or a plain object. */
export function keyDown(S, code) {
  const k = S?.input?.keys;
  if (!k) return false;
  if (k instanceof Set || Array.isArray(k)) return k.has ? k.has(code) : k.includes(code);
  return !!k[code];
}

/** Edge-triggered key: true only on the frame the key goes down.
 *  The input singleton exposes pressed(code) as a METHOD (input.js) — use it
 *  first, since it tracks _justPressed across frames. Fall back to a Set /
 *  Array, then to previous-state polling. */
export function keyPressed(S, code) {
  const inp = S?.input;
  if (inp && typeof inp.pressed === 'function') return inp.pressed(code);
  const pressed = inp?.pressed;
  if (pressed instanceof Set) return pressed.has(code);
  if (Array.isArray(pressed)) return pressed.includes(code);
  if (!S._prevKeys) S._prevKeys = {};
  const was = !!S._prevKeys[code];
  const now = keyDown(S, code);
  S._prevKeys[code] = now;
  return now && !was;
}

/** Normalise one collider entry to { minX, maxX, minZ, maxZ } or null.
 *  Accepts: {minX,maxX,minZ,maxZ} | {x,z,hx,hz} | {x,z,halfX,halfZ} |
 *  {x,z,w,d} | {x,z,width,depth} | Box3-like {min:{x,z},max:{x,z}}. */
export function normalizeCollider(c) {
  if (!c) return null;
  if (c.minX !== undefined && c.maxX !== undefined) {
    return { minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ };
  }
  if (c.min && c.max && c.min.x !== undefined) {
    return { minX: c.min.x, maxX: c.max.x, minZ: c.min.z, maxZ: c.max.z };
  }
  if (c.x !== undefined && c.z !== undefined) {
    const hx = c.hx ?? c.halfX ?? (c.w !== undefined ? c.w / 2 : 0);
    const hz = c.hz ?? c.halfZ ?? (c.d !== undefined ? c.d / 2 : 0);
    const w2 = c.width !== undefined ? c.width / 2 : hx;
    const d2 = c.depth !== undefined ? c.depth / 2 : hz;
    return { minX: c.x - w2, maxX: c.x + w2, minZ: c.z - d2, maxZ: c.z + d2 };
  }
  return null;
}

/** Circle-vs-AABB push-out on the XZ plane. Mutates `pos` (THREE.Vector3). */
export function resolveColliders(pos, radius, colliders) {
  if (!colliders || !colliders.length) return;
  for (const raw of colliders) {
    const c = normalizeCollider(raw);
    if (!c) continue;
    const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    let dx = pos.x - cx;
    let dz = pos.z - cz;
    let d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 < 1e-8) {
      // Centre inside the box: push out along the smallest penetration axis.
      const pl = pos.x - c.minX, pr = c.maxX - pos.x;
      const pt = pos.z - c.minZ, pb = c.maxZ - pos.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) pos.x = c.minX - radius;
      else if (m === pr) pos.x = c.maxX + radius;
      else if (m === pt) pos.z = c.minZ - radius;
      else pos.z = c.maxZ + radius;
      continue;
    }
    const d = Math.sqrt(d2);
    const push = (radius - d) / d;
    dx *= push; dz *= push;
    pos.x += dx; pos.z += dz;
  }
}

function arcadePos(S) {
  const lm = S?.world?.landmarks?.arcade;
  if (lm) { const v = toVec3(lm); return { x: v.x, z: v.z }; }
  return RESPAWN_POINT;
}

// ---------------------------------------------------------------- player
export function createPlayer(scene, pos) {
  const start = toVec3(pos, 0);
  const group = new THREE.Group();
  group.position.copy(start);

  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d5f, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.9 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.9 });

  // Body: capsule torso.
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.55, 4, 10), shirt);
  body.position.y = 1.05;
  body.castShadow = true;
  group.add(body);

  // Head + hair cap.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), skin);
  head.position.y = 1.78;
  head.castShadow = true;
  group.add(head);
  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  hairMesh.position.y = 1.82;
  group.add(hairMesh);

  // Limbs (pivot at shoulder/hip: geometry translated so rotation swings them).
  function limb(mat, w, h, d, x, y) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(0, -h / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, 0);
    m.castShadow = true;
    group.add(m);
    return m;
  }
  const armL = limb(skin, 0.16, 0.62, 0.16, -0.46, 1.42);
  const armR = limb(skin, 0.16, 0.62, 0.16, 0.46, 1.42);
  const legL = limb(pants, 0.2, 0.68, 0.2, -0.18, 0.72);
  const legR = limb(pants, 0.2, 0.68, 0.2, 0.18, 0.72);

  if (scene) scene.add(group);

  const player = {
    mesh: group,
    pos: start, // feet position; source of truth (y = height above ground)
    yaw: 0,
    hp: PLAYER_HP,
    maxHp: PLAYER_HP,
    speed: 0,
    car: null, // car object while driving, else null
    weapon: 'fists',
    vy: 0,
    grounded: true,
    walkPhase: 0,
    radius: PLAYER_RADIUS,
    parts: { body, head, armL, armR, legL, legR },
  };
  group.rotation.y = player.yaw;
  return player;
}

/** Camera yaw (radians) the player moves relative to.
 *  Prefers S.cameraYaw; otherwise derives it from the camera view direction. */
export function getCameraYaw(S) {
  if (typeof S?.cameraYaw === 'number') return S.cameraYaw;
  if (S?.camera) {
    const dir = new THREE.Vector3();
    S.camera.getWorldDirection(dir);
    if (Math.abs(dir.x) + Math.abs(dir.z) > 1e-4) {
      return Math.atan2(-dir.x, -dir.z);
    }
  }
  return 0;
}

function nearestCar(S, pos, maxDist) {
  let best = null, bestD = maxDist;
  for (const car of S.cars || []) {
    if (!car || !car.pos) continue;
    const d = Math.hypot(car.pos.x - pos.x, car.pos.z - pos.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

function respawn(S, p) {
  const a = arcadePos(S);
  p.pos.set(a.x, 0, a.z);
  p.hp = p.maxHp;
  p.vy = 0;
  p.grounded = true;
  p.car = null;
  if (S.cash !== undefined) S.cash = Math.floor(S.cash / 2); // forgiving: lose half cash
  S.wanted = 0;
  S._policeReset = true; // police.js clears its spawns on next update
  S._respawnGrace = 2; // seconds of protection after respawn
  if (p.mesh) p.mesh.visible = true;
}

export function updatePlayer(S, dt) {
  const p = S?.player;
  if (!p || !p.pos) return;
  dt = Math.min(dt || 0.016, 0.05);

  if (S._respawnGrace > 0) S._respawnGrace -= dt;

  // --- death / respawn (checked even while driving) ---
  if (p.hp <= 0) {
    if (p.car) { p.car.driver = null; p.car = null; }
    respawn(S, p);
  }

  // --- E: enter / exit nearest car (edge-triggered) ---
  if (keyPressed(S, 'KeyE')) {
    if (p.car) {
      const car = p.car;
      car.driver = null;
      p.car = null;
      // Step out to the side of the car.
      const side = new THREE.Vector3(Math.cos(car.yaw), 0, -Math.sin(car.yaw));
      p.pos.set(car.pos.x + side.x * 2.2, 0, car.pos.z + side.z * 2.2);
      p.yaw = car.yaw;
      if (p.mesh) p.mesh.visible = true;
    } else {
      const car = nearestCar(S, p.pos, 3);
      if (car) {
        p.car = car;
        car.driver = p;
        if (p.mesh) p.mesh.visible = false; // hidden while driving
      }
    }
  }

  // --- while driving, the car module owns movement; just track the camera ---
  if (p.car) {
    p.pos.copy(p.car.pos);
    p.yaw = p.car.yaw;
    if (p.mesh) p.mesh.position.copy(p.pos);
    if (S) {
      S.cameraTarget = S.cameraTarget || new THREE.Vector3();
      S.cameraTarget.set(p.pos.x, p.pos.y + 2, p.pos.z);
    }
    return;
  }

  // --- F: interact (missions / pickups hook in via S) ---
  if (keyPressed(S, 'KeyF')) {
    if (typeof S.onInteract === 'function') S.onInteract(S);
    else if (typeof S.interact === 'function') S.interact(S);
    // Pick up a nearby pickup crate if the mission layer did not take it.
    if (S.pickups && S.pickups.length) {
      let best = null, bestD = 2.5;
      for (const pk of S.pickups) {
        const pp = pk.pos || pk.mesh?.position;
        if (!pp) continue;
        const d = Math.hypot(pp.x - p.pos.x, pp.z - p.pos.z);
        if (d < bestD) { bestD = d; best = pk; }
      }
      if (best && typeof S.onPickup === 'function') S.onPickup(best);
    }
  }

  // --- mouse click: attack (punch / shoot via combat.js) ---
  if (S.input?.clicked) {
    S.input.clicked = false;
    playerAttack(S);
  }

  // --- WASD camera-relative movement ---
  const yaw = getCameraYaw(S);
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const move = new THREE.Vector3();
  if (keyDown(S, 'KeyW') || keyDown(S, 'ArrowUp')) move.add(fwd);
  if (keyDown(S, 'KeyS') || keyDown(S, 'ArrowDown')) move.sub(fwd);
  if (keyDown(S, 'KeyD') || keyDown(S, 'ArrowRight')) move.add(right);
  if (keyDown(S, 'KeyA') || keyDown(S, 'ArrowLeft')) move.sub(right);

  const running = keyDown(S, 'ShiftLeft') || keyDown(S, 'ShiftRight');
  const speed = running ? RUN_SPEED : WALK_SPEED;
  let moving = false;
  if (move.lengthSq() > 0) {
    move.normalize();
    moving = true;
    p.pos.addScaledVector(move, speed * dt);
    p.speed = speed;
    // Face the movement direction.
    const targetYaw = Math.atan2(move.x, move.z);
    let dy = targetYaw - p.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    p.yaw += dy * Math.min(1, dt * 12);
  } else {
    p.speed = 0;
  }

  // --- Space: small hop ---
  if (keyPressed(S, 'Space') && p.grounded) {
    p.vy = 7;
    p.grounded = false;
  }
  if (!p.grounded) {
    p.vy -= 22 * dt;
    p.pos.y += p.vy * dt;
    if (p.pos.y <= 0) { p.pos.y = 0; p.vy = 0; p.grounded = true; }
  }

  // --- AABB push-out vs world colliders + soft world bounds ---
  resolveColliders(p.pos, p.radius, S.world?.colliders);
  p.pos.x = Math.max(-230, Math.min(230, p.pos.x));
  p.pos.z = Math.max(-230, Math.min(230, p.pos.z));

  // --- limb-swing walk animation ---
  const targetPhaseRate = moving ? speed * 1.7 : 0;
  p.walkPhase += targetPhaseRate * dt;
  const swing = moving ? 0.65 : 0;
  const s = Math.sin(p.walkPhase);
  const L = p.parts;
  const ease = Math.min(1, dt * 10);
  L.legL.rotation.x += (s * swing - L.legL.rotation.x) * ease;
  L.legR.rotation.x += (-s * swing - L.legR.rotation.x) * ease;
  L.armL.rotation.x += (-s * swing * 0.8 - L.armL.rotation.x) * ease;
  L.armR.rotation.x += (s * swing * 0.8 - L.armR.rotation.x) * ease;
  // Slight bob while running.
  L.body.position.y = 1.05 + (moving ? Math.abs(Math.cos(p.walkPhase)) * 0.05 : 0);

  // --- sync mesh + camera target ---
  if (p.mesh) {
    p.mesh.position.copy(p.pos);
    p.mesh.rotation.y = p.yaw;
  }
  if (S) {
    S.cameraTarget = S.cameraTarget || new THREE.Vector3();
    S.cameraTarget.set(p.pos.x, p.pos.y + 1.6, p.pos.z);
  }
}
