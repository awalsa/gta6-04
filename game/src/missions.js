// ISLA BRASA 3D — mission step engine (Worker D: progression)
// Supports: goto, collect, clear, steal, deliver — in ANY order, including
// TWO `clear` steps in one mission (each spawns a fresh wave), `steal` at any
// step position, and MULTIPLE `deliver` steps.
//
// Spawning is hook-based so the world/combat workers own the 3D meshes:
// if S.spawnEnemy / S.spawnPickup / S.spawnCar exist they are used and their
// return value is tracked; otherwise plain data objects are pushed into
// S.enemies / S.pickups / S.cars, which the render workers can pick up.
// The same tolerance applies to reading the player: player.x/z, or
// player.position (THREE.Vector3), or player.mesh.position all work.

import { LANDMARKS, MISSIONS, HEIST, HEIST_TOTAL_PAYOUT, HEIST_PART3_TIME, RACES, RESPECT_RANKS, RESPECT_PAYOUT_BONUS_PER_RANK, DIALOGUE } from './config.js';
import { respectRank, awardHeistPayout } from './economy.js';

// ------------------------------------------------------------ dialogue hooks (Worker C)
// Intro on mission start, one completion line on mission complete.
// Never blocks gameplay: uses S.showDialogue when main.js wired it,
// otherwise a best-effort dynamic import; any failure is swallowed.
function showMissionDialogue(S, speaker, lines, onDone) {
  try {
    if (typeof S.showDialogue === 'function') { S.showDialogue(speaker, lines, onDone); return; }
    import('./dialogue.js')
      .then((m) => { if (m && typeof m.showDialogue === 'function') m.showDialogue(S, speaker, lines, onDone); })
      .catch(() => { /* dialogue unavailable — mission still runs */ });
  } catch (e) { /* never break a mission for dialogue */ }
}

export const GOTO_RADIUS = 6; // goto / deliver complete within 6 units
const PICKUP_SPREAD = 6;      // collect pickups scattered around the landmark
const ENEMY_SPREAD = 8;       // clear enemies scattered around the landmark
const STEAL_CAR_TYPES = { 10: 'cometa', 12: 'cometa', 13: 'cometa' }; // fast car for those jobs (13 = heist getaway)

// ------------------------------------------------------------ position utils
export function posOf(obj) {
  if (!obj) return null;
  if (typeof obj.x === 'number' && typeof obj.z === 'number') return { x: obj.x, z: obj.z };
  if (obj.position && typeof obj.position.x === 'number') return { x: obj.position.x, z: obj.position.z };
  if (obj.mesh && obj.mesh.position) return { x: obj.mesh.position.x, z: obj.mesh.position.z };
  return null;
}

export function dist2D(a, b) {
  const pa = posOf(a);
  const pb = typeof b.x === 'number' ? b : posOf(b);
  if (!pa || !pb) return Infinity;
  const dx = pa.x - pb.x;
  const dz = pa.z - pb.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function landmarkPos(key) {
  const lm = LANDMARKS[key];
  return lm ? { x: lm.x, z: lm.z, label: lm.label } : null;
}

function ghostLevel(S) {
  return (S.crew && S.crew.ghost && S.crew.ghost.hired) ? (S.crew.ghost.level || 0) : 0;
}

function ensureState(S) {
  if (!Array.isArray(S.missionsDone)) S.missionsDone = [];
  if (!Array.isArray(S.enemies)) S.enemies = [];
  if (!Array.isArray(S.pickups)) S.pickups = [];
  if (!Array.isArray(S.cars)) S.cars = [];
  if (!Array.isArray(S.markers)) S.markers = [];
  if (!Array.isArray(S.allies)) S.allies = [];
  if (typeof S.cash !== 'number') S.cash = 0;
  if (typeof S.respect !== 'number') S.respect = 0;
  if (typeof S.wanted !== 'number') S.wanted = 0;
  if (!S.heistPartsPaid || typeof S.heistPartsPaid !== 'object') S.heistPartsPaid = {};
}

export function saveProgress(S) {
  try {
    if (typeof S.save === 'function') { S.save(); return; }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('isla-brasa-3d-save', JSON.stringify({
        cash: S.cash, respect: S.respect, missionsDone: S.missionsDone,
        ownedCars: S.ownedCars, upgrades: S.upgrades, crew: S.crew,
        ownedWeapons: S.ownedWeapons, ammo: S.ammo, weapon: S.weapon,
      }));
    }
  } catch (e) { /* save is best-effort; never break gameplay */ }
}

// ------------------------------------------------------------ mission lookup
export function missionDef(id) {
  if (id === HEIST.id) return HEIST;
  return MISSIONS.find((m) => m.id === id) || null;
}

// ------------------------------------------------------------ the heist (Worker F)
// The Brasa Heist (mission 13): 3 parts, $5,000 total — part 1 $250, part 2
// $250, part 3 $4,500. Unlocks once all 12 main missions are done OR the
// player has hired at least 1 crew member. Part 3 runs on its own 240 s
// clock (starts when the vault job begins, not at heist start).
export function heistAvailable(S) {
  ensureState(S);
  if (S.heistDone || S.missionsDone.includes(HEIST.id)) return false;
  if (S.mission) return false;
  const allMissionsDone = MISSIONS.every((m) => S.missionsDone.includes(m.id));
  const crewHired = S.crew && Object.values(S.crew).some((c) => c && c.hired);
  return allMissionsDone || !!crewHired;
}

/** Current heist part (1-3) while the heist is active, else null. */
export function heistPart(S) {
  if (!S.mission || S.mission.id !== HEIST.id) return null;
  const step = currentStep(S);
  if (step && typeof step.part === 'number') return step.part;
  const steps = S.mission.def.steps || [];
  const last = steps[Math.min(S.mission.stepIndex, steps.length - 1)];
  return (last && typeof last.part === 'number') ? last.part : 1;
}

export function startHeist(S) {
  ensureState(S);
  if (S.heistDone || S.missionsDone.includes(HEIST.id)) return { ok: false, error: 'heist already completed' };
  if (S.mission) return { ok: false, error: 'a mission is already active' };
  if (!heistAvailable(S)) return { ok: false, error: 'heist locked — finish all 12 missions or hire a crew member first' };

  S.mission = {
    id: HEIST.id, def: HEIST, stepIndex: 0,
    timeLeft: null, timeLimit: null, // part 3 starts its own 240 s clock
    stepPickups: [], stepEnemies: [], stepCar: null, ally: null, getawayCar: null,
    heist: true, _heatAt: 0,
  };

  // Crew effects: Marta fights beside you in the vault job; Rico's getaway
  // bonus (+20% top speed in missions) applies via economy.carStats.
  if (S.crew && S.crew.marta && S.crew.marta.hired) spawnMartaAlly(S);

  setupStep(S);
  S.overlay = null;
  const intro = DIALOGUE[HEIST.id];
  if (intro) showMissionDialogue(S, intro.speaker, intro.lines);
  return { ok: true, mission: S.mission };
}

/** Next uncompleted mission id (missions auto-unlock in order), or null. */
export function nextMissionId(S) {
  ensureState(S);
  const next = MISSIONS.find((m) => !S.missionsDone.includes(m.id));
  return next ? next.id : null;
}

/** All 12 missions with lock/done status, for a mission-select list. */
export function missionList(S) {
  ensureState(S);
  const next = nextMissionId(S);
  return MISSIONS.map((m) => ({
    ...m,
    done: S.missionsDone.includes(m.id),
    unlocked: S.missionsDone.includes(m.id) || m.id === next,
  }));
}

export function currentStep(S) {
  if (!S.mission) return null;
  return S.mission.def.steps[S.mission.stepIndex] || null;
}

/** Progress text for the current step, e.g. "3/5" for collect/clear. */
export function stepProgress(S) {
  if (!S.mission) return '';
  const step = currentStep(S);
  if (!step) return '';
  if (step.kind === 'collect') {
    const done = (S.mission.stepPickups || []).filter((p) => pickupTaken(S, p)).length;
    return `${done}/${step.count}`;
  }
  if (step.kind === 'clear') {
    const left = (S.mission.stepEnemies || []).filter((e) => !enemyDefeated(S, e)).length;
    return `${step.count - left}/${step.count}`;
  }
  return '';
}

// ------------------------------------------------------------ spawn helpers
function spawnPickup(S, x, z) {
  let p = null;
  if (typeof S.spawnPickup === 'function') p = S.spawnPickup(x, z) || null;
  if (!p) {
    p = { x, z, taken: false, mission: true, kind: 'crate' };
    S.pickups.push(p);
  }
  p.mission = true;
  return p;
}

function spawnEnemy(S, x, z) {
  let e = null;
  if (typeof S.spawnEnemy === 'function') e = S.spawnEnemy(x, z) || null;
  if (!e) {
    e = { x, z, hp: 100, maxHp: 100, alive: true, mission: true, kind: 'thug' };
    S.enemies.push(e);
  }
  e.mission = true;
  return e;
}

function spawnCar(S, typeId, x, z, opts = {}) {
  let c = null;
  if (typeof S.spawnCar === 'function') c = S.spawnCar(typeId, x, z) || null;
  if (!c) {
    c = { x, z, type: typeId, mission: true, target: !!opts.target, kind: 'car' };
    S.cars.push(c);
  }
  c.mission = true;
  if (opts.target) c.target = true;
  return c;
}

function jitter(center, spread, i, n) {
  // Deterministic ring scatter so pickups/enemies never stack on one point.
  const angle = (i / Math.max(n, 1)) * Math.PI * 2 + 0.6;
  const r = spread * (0.5 + 0.5 * ((i % 2) + 1) / 2);
  return { x: center.x + Math.cos(angle) * r, z: center.z + Math.sin(angle) * r };
}

// Worker F: push a point out of any building collider (with a 2u margin)
// so a collect pickup never lands somewhere the player cannot stand —
// pickups jittered around the casino centre (18x18 collider) were
// uncollectible by walking, which also blocked the heist's vault cases.
function clearOfColliders(S, x, z) {
  const cols = S?.world?.colliders || [];
  let px = x, pz = z;
  for (const c of cols) {
    if (c.minX === undefined || c.maxX === undefined) continue;
    const m = 2;
    if (px > c.minX - m && px < c.maxX + m && pz > c.minZ - m && pz < c.maxZ + m) {
      const dl = px - (c.minX - m), dr = (c.maxX + m) - px;
      const dt = pz - (c.minZ - m), db = (c.maxZ + m) - pz;
      const min = Math.min(dl, dr, dt, db);
      if (min === dl) px = c.minX - m;
      else if (min === dr) px = c.maxX + m;
      else if (min === dt) pz = c.minZ - m;
      else pz = c.maxZ + m;
    }
  }
  return { x: px, z: pz };
}

// ------------------------------------------------------------ beacons/markers
function setMarker(S, target) {
  // S.markers is the shared contract the world worker renders as a glowing
  // beacon pillar + the HUD reads for its arrow. One current marker at a time.
  S.markers = target ? [{ x: target.x, z: target.z, label: target.label, kind: 'mission' }] : [];
  S.beacon = target ? { x: target.x, z: target.z, label: target.label } : null;
  if (S.mission) S.mission.marker = target;
}

/** Current target {x, z, label} for the HUD arrow + 3D beacon (race wins if active). */
export function missionMarker(S) {
  if (S.race && S.race.checkpoint) return S.race.checkpoint;
  if (!S.mission) return null;
  const step = currentStep(S);
  if (!step) return null;
  const lm = landmarkPos(step.at);
  if (!lm) return null;
  return { x: lm.x, z: lm.z, label: step.label || lm.label };
}

// ------------------------------------------------------------ step lifecycle
function setupStep(S) {
  const step = currentStep(S);
  if (!step) return;
  const lm = landmarkPos(step.at);
  if (!lm) return;
  S.mission.stepPickups = [];
  S.mission.stepEnemies = [];
  S.mission.stepCar = null;

  if (step.kind === 'collect') {
    const n = step.count || 1;
    for (let i = 0; i < n; i++) {
      const p = jitter(lm, PICKUP_SPREAD, i, n);
      const clear = clearOfColliders(S, p.x, p.z);
      S.mission.stepPickups.push(spawnPickup(S, clear.x, clear.z));
    }
  } else if (step.kind === 'clear') {
    // Fresh wave every time — a second `clear` step spawns a new wave.
    const n = step.count || 1;
    // Heist vault job: a proper guard squad via combat.js (main.js wires
    // S.spawnHeistSquad); falls back to plain thug spawns when absent.
    let squad = null;
    if (S.mission.id === HEIST.id && typeof S.spawnHeistSquad === 'function') {
      try { squad = S.spawnHeistSquad(lm.x, lm.z, n) || null; } catch { squad = null; }
    }
    if (squad && squad.length) {
      S.mission.stepEnemies.push(...squad);
    } else {
      for (let i = 0; i < n; i++) {
        const p = jitter(lm, ENEMY_SPREAD, i, n);
        S.mission.stepEnemies.push(spawnEnemy(S, p.x, p.z));
      }
    }
  } else if (step.kind === 'steal') {
    const typeId = STEAL_CAR_TYPES[S.mission.id] || 'brasa';
    S.mission.stepCar = spawnCar(S, typeId, lm.x, lm.z, { target: true });
  }
  setMarker(S, { x: lm.x, z: lm.z, label: step.label || lm.label });
}

function clearStepSpawns(S) {
  if (!S.mission) return;
  // Remove leftover mission pickups/enemies of the finished step only if
  // they belong to this mission; the world worker may already have removed
  // dead/taken ones, so filter defensively.
  if (S.mission.stepPickups) {
    S.pickups = S.pickups.filter((p) => !S.mission.stepPickups.includes(p) || !p.taken);
  }
  if (S.mission.stepEnemies) {
    S.enemies = S.enemies.filter((e) => !S.mission.stepEnemies.includes(e) || !enemyDefeated(S, e));
  }
}

function pickupTaken(S, p) {
  return !p || p.taken === true || (Array.isArray(S.pickups) && !S.pickups.includes(p));
}

function enemyDefeated(S, e) {
  if (!e) return true;
  if (e.hp <= 0 || e.dead === true || e.alive === false) return true;
  // Combat worker may remove dead enemies from S.enemies outright.
  if (Array.isArray(S.enemies) && !S.enemies.includes(e)) return true;
  return false;
}

function playerInCar(S, car) {
  if (!car) return false;
  const p = S.player || {};
  if (p.car === car || p.vehicle === car || p.inCar === car) return true;
  if (S.currentCar === car || S.drivingCar === car) return true;
  if (car.driver === p || car.occupiedBy === 'player' || car.playerInside === true) return true;
  // Generic "player is driving something" signal + this is the target car
  // the player is sitting in (driving worker sets S.currentCar; covered
  // above). Fall through: on foot near the car does NOT count.
  return false;
}

function playerInAnyCar(S) {
  const p = S.player || {};
  return !!(p.car || p.vehicle || p.inCar || S.currentCar || S.drivingCar);
}

// ------------------------------------------------------------ crew effects
function spawnMartaAlly(S) {
  const p = posOf(S.player) || { x: 0, z: 0 };
  let ally = null;
  if (typeof S.spawnAlly === 'function') ally = S.spawnAlly(p.x + 3, p.z + 3) || null;
  if (!ally) {
    ally = { x: p.x + 3, z: p.z + 3, hp: 200, maxHp: 200, alive: true, ally: true, kind: 'ally', name: 'Marta' };
    S.allies.push(ally);
  }
  ally.ally = true;
  S.mission.ally = ally;
  return ally;
}

function spawnRicoGetaway(S) {
  // Rico: a fast getaway car spawns near the player at mission start.
  const p = posOf(S.player) || { x: 0, z: 0 };
  const car = spawnCar(S, 'brasa', p.x + 6, p.z, { target: false });
  car.getaway = true;
  S.mission.getawayCar = car;
  return car;
}

// ------------------------------------------------------------ public API
export function startMission(S, id) {
  ensureState(S);
  const def = missionDef(id);
  if (!def) return { ok: false, error: 'unknown mission' };
  if (S.missionsDone.includes(id)) return { ok: false, error: 'already completed' };
  if (S.mission) return { ok: false, error: 'a mission is already active' };
  const next = nextMissionId(S);
  if (id !== next) return { ok: false, error: 'mission locked — finish mission ' + next + ' first' };

  const timeLeft = def.timed ? def.timed + 15 * ghostLevel(S) : null;
  S.mission = {
    id: def.id, def, stepIndex: 0,
    timeLeft, timeLimit: timeLeft,
    stepPickups: [], stepEnemies: [], stepCar: null, ally: null, getawayCar: null,
  };

  // Crew effects on mission start.
  if (S.crew && S.crew.marta && S.crew.marta.hired) spawnMartaAlly(S);
  if (S.crew && S.crew.rico && S.crew.rico.hired) {
    const hasCarStep = def.steps.some((s) => s.kind === 'steal' || s.kind === 'deliver');
    if (hasCarStep) spawnRicoGetaway(S);
  }

  setupStep(S);
  S.overlay = null;
  const intro = DIALOGUE[id];
  if (intro) showMissionDialogue(S, intro.speaker, intro.lines);
  return { ok: true, mission: S.mission };
}

function advanceStep(S) {
  const finished = currentStep(S);
  const prevPart = finished ? finished.part : null;
  S.mission.stepIndex += 1;
  if (S.mission.stepIndex >= S.mission.def.steps.length) {
    completeMission(S);
    return;
  }
  // Heist part boundary: pay the finished part, and start the part-3 clock
  // when the vault job begins (Ghost adds +15s/level, applied once here).
  if (S.mission.id === HEIST.id && prevPart != null) {
    const nextStep = S.mission.def.steps[S.mission.stepIndex];
    if (nextStep && nextStep.part !== prevPart) {
      const partDef = HEIST.parts.find((p) => p.part === prevPart);
      if (partDef) {
        const r = awardHeistPayout(S, prevPart, partDef.payout);
        if (r.ok) S.mission.lastPartPayout = { part: prevPart, amount: partDef.payout };
      }
      if (nextStep.part === 3) {
        const timeLeft = HEIST_PART3_TIME + 15 * ghostLevel(S);
        S.mission.timeLeft = timeLeft;
        S.mission.timeLimit = timeLeft;
      }
    }
  }
  setupStep(S);
}

function stepDone(S) {
  const step = currentStep(S);
  if (!step) return false;
  const lm = landmarkPos(step.at);
  switch (step.kind) {
    case 'goto':
    case 'deliver': {
      // Deliver: reach the marker within 6 units. If the previous step was
      // a steal, the player SHOULD be in the target car — but do not
      // hard-fail if on foot; just require reaching the marker.
      if (!lm) return false;
      return dist2D(S.player, lm) <= GOTO_RADIUS;
    }
    case 'collect': {
      const need = step.count || 1;
      const got = (S.mission.stepPickups || []).filter((p) => pickupTaken(S, p)).length;
      return got >= need;
    }
    case 'clear': {
      const foes = S.mission.stepEnemies || [];
      return foes.length > 0 && foes.every((e) => enemyDefeated(S, e));
    }
    case 'steal': {
      return playerInCar(S, S.mission.stepCar);
    }
    default:
      return false;
  }
}

export function updateMission(S, dt) {
  if (!S.mission) return;
  ensureState(S);
  const m = S.mission;

  // Timed missions: countdown from mission start (Ghost adds +15s/level,
  // applied once in startMission).
  if (typeof m.timeLeft === 'number') {
    m.timeLeft -= dt;
    if (m.timeLeft <= 0) {
      m.timeLeft = 0;
      failMission(S, 'Time up!');
      return;
    }
  }

  // Player died mid-mission (combat worker sets S.player.hp <= 0 / dead).
  const hp = S.player ? (S.player.hp ?? S.player.health) : null;
  if ((typeof hp === 'number' && hp <= 0) || (S.player && S.player.dead === true)) {
    failMission(S, 'You died.');
    return;
  }

  // Pickup sparkle: a mission pickup newly taken since last frame glints.
  S._sparkledPickups = S._sparkledPickups || new Set();
  for (const pk of m.stepPickups || []) {
    if (pickupTaken(S, pk) && !S._sparkledPickups.has(pk)) {
      S._sparkledPickups.add(pk);
      if (S.particles?.spawnSparkle) S.particles.spawnSparkle(pk.pos || { x: pk.x, z: pk.z });
    }
  }

  // Heist escape: wanted climbs while running the loot to the Beachfront
  // (police.js raiseHeistHeat via main.js S.heistHeat, S.addWanted fallback).
  if (m.id === HEIST.id) {
    const step = currentStep(S);
    if (step && step.part === 3 && step.kind === 'deliver') {
      const now = S.time || 0;
      if (now - (m._heatAt || 0) >= 8) {
        m._heatAt = now;
        if (typeof S.heistHeat === 'function') S.heistHeat(1);
        else if (typeof S.addWanted === 'function') S.addWanted(1);
      }
    }
  }

  if (stepDone(S)) {
    const finished = currentStep(S);
    if (finished && finished.kind === 'steal') {
      // Stealing in view draws heat.
      S.wanted = Math.min(5, (S.wanted || 0) + 1);
    }
    clearStepSpawns(S);
    advanceStep(S);
  }
  missionPickupChime(S); // Worker A audio: chime on each collected pickup
}

// Pickup chime hook (Worker A audio): call once per frame from updateMission;
// plays when a new mission pickup has been taken since the last frame.
function missionPickupChime(S) {
  if (!S || !S.mission) return;
  const takenNow = (S.mission.stepPickups || []).filter((p) => pickupTaken(S, p)).length;
  if (takenNow > (S.mission._takenCount || 0)) {
    S.mission._takenCount = takenNow;
    if (S.audio) S.audio.playSfx('pickup');
  }
}

export function completeMission(S) {
  if (!S.mission) return { ok: false, error: 'no active mission' };
  ensureState(S);
  const m = S.mission;
  const rank = respectRank(S);
  let payout;
  if (m.id === HEIST.id) {
    // Heist: the total is exactly $5,000 — parts 1+2 already paid on their
    // part boundaries, so part 3 pays the remainder ($4,500 on a clean run).
    const paid = Object.values(S.heistPartsPaid || {}).reduce((a, b) => a + (b || 0), 0);
    payout = Math.max(0, HEIST_TOTAL_PAYOUT - paid);
    if (payout > 0) {
      const r = awardHeistPayout(S, 3, payout);
      payout = r.ok ? r.amount : 0;
    }
    S.heistDone = true;
  } else {
    const bonus = 1 + RESPECT_PAYOUT_BONUS_PER_RANK * rank.index;
    payout = Math.round(m.def.payout * bonus);
    S.cash = (S.cash || 0) + payout;
    S.respect = (S.respect || 0) + Math.round(m.def.payout / 10);
  }
  if (!S.missionsDone.includes(m.id)) S.missionsDone.push(m.id);
  S.missionsDone.sort((a, b) => a - b);

  // Clean up mission spawns/ally, then clear the mission.
  if (m.ally && Array.isArray(S.allies)) S.allies = S.allies.filter((a) => a !== m.ally);
  setMarker(S, null);
  const doneId = m.id;
  const doneName = m.def.name;
  S.mission = null;
  S.lastMissionResult = { ok: true, id: doneId, name: doneName, payout, rank: rank.name };
  const outro = DIALOGUE[doneId];
  if (outro && outro.done) showMissionDialogue(S, outro.done.speaker || outro.speaker, outro.done.lines);
  if (S.audio) S.audio.playSfx('mission-complete'); // Worker A audio
  saveProgress(S);
  return { ok: true, id: doneId, name: doneName, payout, rank: rank.name };
}

export function failMission(S, reason) {
  if (!S.mission) return { ok: false, error: 'no active mission' };
  ensureState(S);
  const m = S.mission;
  // Mission stays as the next uncompleted one; retry is allowed.
  if (m.ally && Array.isArray(S.allies)) S.allies = S.allies.filter((a) => a !== m.ally);
  // Remove uncollected mission pickups / living mission enemies so a retry
  // spawns a fresh set; keep the target/getaway cars in the world.
  if (m.stepPickups) S.pickups = S.pickups.filter((p) => !m.stepPickups.includes(p));
  if (m.stepEnemies) S.enemies = S.enemies.filter((e) => !m.stepEnemies.includes(e));
  setMarker(S, null);
  const failedId = m.id;
  S.mission = null;
  S.lastMissionResult = { ok: false, id: failedId, reason: reason || 'Mission failed.' };
  saveProgress(S);
  return { ok: false, id: failedId, reason: reason || 'Mission failed.' };
}

// ------------------------------------------------------------ races (light)
// Races reuse the mission marker/beacon for checkpoints. The driving worker
// may own race flow instead; these helpers exist so races work standalone.
export function startRace(S, id) {
  ensureState(S);
  const race = RACES.find((r) => r.id === id) || null;
  if (!race) return { ok: false, error: 'unknown race' };
  if (S.race) return { ok: false, error: 'a race is already active' };
  const first = landmarkPos(race.checkpoints[0]);
  if (!first) return { ok: false, error: 'bad race checkpoints' };
  if (dist2D(S.player, first) > 15) {
    return { ok: false, error: 'get within 15 units of the start: ' + first.label };
  }
  S.race = {
    id: race.id, def: race, checkpointIndex: 0,
    timeLeft: race.timeLimit, timeLimit: race.timeLimit,
    checkpoint: { x: first.x, z: first.z, label: 'Checkpoint 1: ' + first.label },
  };
  setMarker(S, S.race.checkpoint);
  return { ok: true, race: S.race };
}

export function updateRace(S, dt) {
  if (!S.race) return;
  ensureState(S);
  const r = S.race;
  r.timeLeft -= dt;
  if (r.timeLeft <= 0) {
    r.timeLeft = 0;
    S.race = null;
    setMarker(S, null);
    S.lastRaceResult = { ok: false, reason: 'Time up!' };
    return;
  }
  const cp = r.checkpoint;
  if (cp && dist2D(S.player, cp) <= GOTO_RADIUS) {
    r.checkpointIndex += 1;
    if (r.checkpointIndex >= r.def.checkpoints.length) {
      const rank = respectRank(S);
      const prize = r.def.prize;
      S.cash = (S.cash || 0) + prize;
      S.respect = (S.respect || 0) + Math.round(prize / 10);
      S.race = null;
      setMarker(S, null);
      S.lastRaceResult = { ok: true, name: r.def.name, prize, rank: rank.name };
      saveProgress(S);
      return;
    }
    const next = landmarkPos(r.def.checkpoints[r.checkpointIndex]);
    r.checkpoint = {
      x: next.x, z: next.z,
      label: `Checkpoint ${r.checkpointIndex + 1}: ${next.label}`,
    };
    setMarker(S, r.checkpoint);
  }
}

// ISLA BRASA 3D — recorded agent authorship touch (2026-11-23)
