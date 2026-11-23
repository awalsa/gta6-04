// combat.js — Worker C (ISLA BRASA 3D)
// Enemies (thug / guard / cop) with HP bars, hitscan shooting, melee punch,
// weapon wheel (hold Q, 5 weapons, keys 1-5 or click via selectWeapon),
// kill rewards (cash + wanted +1, cap 5).
// Weapon stats mirror the config.js WEAPONS table; defaults live here too
// so combat works even if config.js (Worker D) is not written yet.
import * as THREE from 'three';

export const WEAPONS = {
  fists:   { name: 'Fists',   dmg: 10, range: 2,  rate: 2, auto: false },
  pistol:  { name: 'Pistol',  dmg: 25, range: 30, rate: 3, auto: false },
  smg:     { name: 'SMG',     dmg: 15, range: 25, rate: 8, auto: true },
  shotgun: { name: 'Shotgun', dmg: 60, range: 12, rate: 1, auto: false },
  rifle:   { name: 'Rifle',   dmg: 40, range: 60, rate: 2, auto: false },
};
export const WEAPON_ORDER = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'];

export function weaponStats(S, id) {
  return S?.config?.WEAPONS?.[id] || WEAPONS[id] || WEAPONS.fists;
}

/** Select a weapon by id ('pistol') or 0-based index into WEAPON_ORDER.
 *  Called by the HUD / weapon-wheel click handler in main.js. */
export function selectWeapon(S, idOrIndex) {
  const p = S?.player;
  if (!p) return;
  const id = typeof idOrIndex === 'number'
    ? WEAPON_ORDER[idOrIndex]
    : idOrIndex;
  if (id && weaponStats(S, id)) p.weapon = id;
}

const ENEMY_KINDS = {
  thug:  { hp: 60, speed: 3.5, cash: 25, shirt: 0x7a2e2e, pants: 0x2b2b2b, skin: 0xc98d5f },
  guard: { hp: 90, speed: 3.0, cash: 40, shirt: 0x3d5a3d, pants: 0x222222, skin: 0x8a5a3b },
  cop:   { hp: 80, speed: 4.0, cash: 30, shirt: 0x1d2f55, pants: 0x14181d, skin: 0xd9a066 },
};

export function createEnemy(scene, pos, kind = 'thug') {
  const def = ENEMY_KINDS[kind] || ENEMY_KINDS.thug;
  const start = pos?.isVector3 ? pos.clone()
    : new THREE.Vector3(pos?.x ?? 0, 0, pos?.z ?? 0);
  const group = new THREE.Group();
  group.position.copy(start);

  const skin = new THREE.MeshStandardMaterial({ color: def.skin, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: def.shirt, roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: def.pants, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.55, 4, 10), shirt);
  body.position.y = 1.05;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), skin);
  head.position.y = 1.78;
  group.add(head);
  if (kind === 'cop') {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 12),
      new THREE.MeshStandardMaterial({ color: 0x0d1526 }));
    cap.position.y = 1.98;
    group.add(cap);
  }
  function limb(mat, w, h, d, x, y) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(0, -h / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, 0);
    group.add(m);
    return m;
  }
  const armL = limb(skin, 0.16, 0.62, 0.16, -0.46, 1.42);
  const armR = limb(skin, 0.16, 0.62, 0.16, 0.46, 1.42);
  const legL = limb(pants, 0.2, 0.68, 0.2, -0.18, 0.72);
  const legR = limb(pants, 0.2, 0.68, 0.2, 0.18, 0.72);

  // HP bar: two sprites above the head (sprites always face the camera).
  const barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x330000, depthTest: false }));
  barBg.scale.set(1.4, 0.16, 1);
  barBg.position.y = 2.35;
  group.add(barBg);
  const barFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x33dd33, depthTest: false }));
  barFg.scale.set(1.4, 0.11, 1);
  barFg.position.y = 2.35;
  group.add(barFg);

  if (scene) scene.add(group);

  return {
    mesh: group,
    pos: start,
    yaw: 0,
    hp: def.hp,
    maxHp: def.hp,
    kind,
    speed: def.speed,
    cash: def.cash,
    attackCd: 0,
    walkPhase: Math.random() * 6,
    parts: { body, head, armL, armR, legL, legR, barBg, barFg },
  };
}

function bumpWanted(S, n) {
  if (typeof S?.addWanted === 'function') S.addWanted(n);
  else S.wanted = Math.max(0, Math.min(5, (S.wanted || 0) + n));
  S._quietTime = 0; // a fresh crime resets the wanted-decay clock
}

function damageEnemy(S, enemy, dmg) {
  enemy.hp -= dmg;
  if (enemy.hp > 0) return;
  // Kill: remove from scene + list, drop cash, raise wanted by 1 (cap 5).
  if (enemy.mesh && S.scene) S.scene.remove(enemy.mesh);
  if (S.enemies) {
    const i = S.enemies.indexOf(enemy);
    if (i >= 0) S.enemies.splice(i, 1);
  }
  if (S.cash !== undefined) S.cash += enemy.cash || 0;
  bumpWanted(S, 1);
}

/** Aim direction for hitscan: camera forward if a camera exists, else the
 *  player's facing. Origin is the player's chest height. */
function aimRay(S) {
  const p = S.player;
  const origin = new THREE.Vector3(p.pos.x, p.pos.y + 1.4, p.pos.z);
  const dir = new THREE.Vector3();
  if (S.camera) {
    S.camera.getWorldDirection(dir);
  } else {
    dir.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
  }
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();
  // Keep the shot level (no shooting the sky / floor from a high camera).
  dir.y = 0;
  dir.normalize();
  return { origin, dir };
}

function spawnTracer(S, from, to, color = 0xffe066) {
  if (!S.scene) return;
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
  S.scene.add(line);
  S._tracers = S._tracers || [];
  S._tracers.push({ line, life: 0.09 });
}

/** Player attack: punch with fists, hitscan shot with a gun.
 *  Rate-limited per weapon; called from updatePlayer on mouse click.
 *  Holding the mouse works for automatic weapons (SMG). */
export function playerAttack(S) {
  const p = S?.player;
  if (!p || p.car || p.hp <= 0) return; // cannot attack while driving / dead
  const weaponId = p.weapon || 'fists';
  const w = weaponStats(S, weaponId);
  const now = S.time ?? performance.now() / 1000;
  const last = S._lastShotAt ?? -10;
  if (now - last < 1 / (w.rate || 2)) return;
  S._lastShotAt = now;

  if (weaponId === 'fists') {
    // Punch: nearest enemy within range in front of the player.
    let best = null, bestD = w.range;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    for (const e of S.enemies || []) {
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      const dot = d > 1e-6 ? (dx * fx + dz * fz) / d : 1;
      if (dot < 0.2) continue;
      bestD = d; best = e;
    }
    S._punchAt = now; // main.js/HUD can flash a punch swing off this
    if (best) damageEnemy(S, best, w.dmg);
    return;
  }

  // Hitscan shot toward the crosshair (camera forward).
  const { origin, dir } = aimRay(S);
  const cone = weaponId === 'shotgun' ? 0.26 : 0.1; // radians of tolerance
  let best = null, bestT = w.range;
  for (const e of S.enemies || []) {
    const to = new THREE.Vector3(e.pos.x - origin.x, 0, e.pos.z - origin.z);
    const t = to.dot(dir);
    if (t < 0 || t > w.range) continue;
    const perp = to.clone().addScaledVector(dir, -t);
    const allowed = 1.0 + t * Math.tan(cone);
    if (perp.length() > allowed) continue;
    if (t < bestT) { bestT = t; best = e; }
  }
  const end = best
    ? new THREE.Vector3(best.pos.x, best.pos.y + 1.2, best.pos.z)
    : origin.clone().addScaledVector(dir, w.range);
  spawnTracer(S, origin, end);
  if (best) damageEnemy(S, best, w.dmg);
}

// ---------------------------------------------------------------- per-frame
export function updateCombat(S, dt) {
  if (!S) return;
  dt = Math.min(dt || 0.016, 0.05);
  const p = S.player;
  const keys = S.input?.keys;
  const has = (code) => {
    if (!keys) return false;
    return keys instanceof Set ? keys.has(code) : Array.isArray(keys) ? keys.includes(code) : !!keys[code];
  };

  // --- weapon wheel: hold Q opens it; main.js/HUD renders it ---
  S.weaponWheelOpen = has('KeyQ');
  if (S.weaponWheelOpen) {
    for (let i = 0; i < WEAPON_ORDER.length; i++) {
      if (has('Digit' + (i + 1)) || has('Numpad' + (i + 1))) selectWeapon(S, i);
    }
    // Click while the wheel is open: main.js sets S.selectedWeaponIndex
    // (from its wheel UI hit-test) — honour it here.
    if (typeof S.selectedWeaponIndex === 'number') {
      selectWeapon(S, S.selectedWeaponIndex);
      S.selectedWeaponIndex = undefined;
    }
  }

  // --- hold-to-fire for automatic weapons (SMG) ---
  if (p && !p.car && p.hp > 0 && S.input?.mouseHeld) {
    const w = weaponStats(S, p.weapon || 'fists');
    if (w.auto) playerAttack(S);
  }

  // --- tracer fade-out ---
  if (S._tracers) {
    for (let i = S._tracers.length - 1; i >= 0; i--) {
      const t = S._tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        if (S.scene) S.scene.remove(t.line);
        t.line.geometry?.dispose?.();
        t.line.material?.dispose?.();
        S._tracers.splice(i, 1);
      }
    }
  }

  if (S._respawnGrace > 0) S._respawnGrace -= dt;

  // --- enemy AI: chase + melee attack + HP bars ---
  const list = S.enemies || [];
  for (const e of [...list]) {
    if (!e || !e.pos) continue;
    if (e.hp <= 0) continue; // damageEnemy already removed it; safety net
    const target = p?.car ? p.car.pos : p?.pos;
    if (!target) continue;
    const dx = target.x - e.pos.x, dz = target.z - e.pos.z;
    const dist = Math.hypot(dx, dz);

    // Chase when near (30u) — mission-spawned enemies stay put until close.
    if (dist < 30 && dist > 1.8) {
      const nx = dx / dist, nz = dz / dist;
      e.pos.x += nx * e.speed * dt;
      e.pos.z += nz * e.speed * dt;
      e.yaw = Math.atan2(nx, nz);
      e.walkPhase += e.speed * 1.7 * dt;
      const s = Math.sin(e.walkPhase);
      e.parts.legL.rotation.x = s * 0.6;
      e.parts.legR.rotation.x = -s * 0.6;
      e.parts.armL.rotation.x = -s * 0.5;
      e.parts.armR.rotation.x = s * 0.5;
    } else {
      e.parts.legL.rotation.x *= 0.8;
      e.parts.legR.rotation.x *= 0.8;
      e.parts.armL.rotation.x *= 0.8;
      e.parts.armR.rotation.x *= 0.8;
    }

    // Melee attack: 8 damage/s at range 2.2, on foot only.
    if (p && !p.car && p.hp > 0 && dist < 2.2 && (S._respawnGrace || 0) <= 0) {
      p.hp -= 8 * dt;
      // Face the player while attacking.
      e.yaw = Math.atan2(dx, dz);
    }

    // Separation between enemies so they do not stack.
    for (const o of list) {
      if (o === e || !o.pos) continue;
      const ox = e.pos.x - o.pos.x, oz = e.pos.z - o.pos.z;
      const od = Math.hypot(ox, oz);
      if (od > 0.01 && od < 1.0) {
        e.pos.x += (ox / od) * 0.5 * dt * 10;
        e.pos.z += (oz / od) * 0.5 * dt * 10;
      }
    }

    // HP bar scales with hp.
    const frac = Math.max(0, e.hp / e.maxHp);
    if (e.parts.barFg) {
      e.parts.barFg.scale.x = 1.4 * frac;
      e.parts.barFg.material.color.setHex(frac > 0.5 ? 0x33dd33 : frac > 0.25 ? 0xffaa00 : 0xff3333);
    }

    if (e.mesh) {
      e.mesh.position.copy(e.pos);
      e.mesh.rotation.y = e.yaw;
    }
  }
}
