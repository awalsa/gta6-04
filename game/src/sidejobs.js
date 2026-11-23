// sidejobs.js — repeatable side activities (Worker C).
// Taxi ($120), delivery ($100 on time / $50 late), 10 hidden orbs ($50).
// Side jobs NEVER touch S.mission / S.markers / mission spawns: they keep
// their own S.sideJobs state + their own cyan beacon, and they run only
// when no other side job is active. Payouts go through S.awardSideJob
// (economy.awardSideJob, wired by main.js) with a direct-credit fallback,
// so this module works even if economy.js is absent.

import { LANDMARKS, SIDE_JOBS, COLLECTIBLE_ORBS } from './config.js';

const LANDMARK_KEYS = Object.keys(LANDMARKS);

function posOf(obj) {
  if (!obj) return null;
  if (typeof obj.x === 'number' && typeof obj.z === 'number') return { x: obj.x, z: obj.z, y: obj.y || 0 };
  if (obj.position && typeof obj.position.x === 'number') return { x: obj.position.x, z: obj.position.z, y: obj.position.y || 0 };
  if (obj.pos && typeof obj.pos.x === 'number') return { x: obj.pos.x, z: obj.pos.z, y: obj.pos.y || 0 };
  if (obj.mesh && obj.mesh.position) return { x: obj.mesh.position.x, z: obj.mesh.position.z, y: obj.mesh.position.y || 0 };
  return null;
}

function dist2D(a, b) {
  if (!a || !b) return Infinity;
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function randomLandmark(exceptKey) {
  const pool = LANDMARK_KEYS.filter((k) => k !== exceptKey);
  const key = pool[Math.floor(Math.random() * pool.length)];
  const lm = LANDMARKS[key];
  return { key, x: lm.x, z: lm.z, label: lm.label };
}

function payOut(S, kind, amount) {
  if (typeof S.awardSideJob === 'function') {
    try { return S.awardSideJob(kind, amount); } catch (e) { /* fall through to direct credit */ }
  }
  S.cash = (S.cash || 0) + amount;
  S.respect = (S.respect || 0) + 5;
  if (!S.sideJobsDone || typeof S.sideJobsDone !== 'object') S.sideJobsDone = { taxi: 0, delivery: 0, orbs: 0, earned: 0 };
  if (kind === 'taxi') S.sideJobsDone.taxi = (S.sideJobsDone.taxi || 0) + 1;
  else if (kind === 'delivery') S.sideJobsDone.delivery = (S.sideJobsDone.delivery || 0) + 1;
  else if (kind === 'orb') S.sideJobsDone.orbs = (S.sideJobsDone.orbs || 0) + 1;
  S.sideJobsDone.earned = (S.sideJobsDone.earned || 0) + amount;
  if (typeof S.save === 'function') { try { S.save(); } catch (e) { /* best-effort */ } }
  return { ok: true, kind, amount, cash: S.cash };
}

function ensureSideJobs(S) {
  if (!S.sideJobs || typeof S.sideJobs !== 'object') S.sideJobs = null;
  return S.sideJobs;
}

function setBeacon(S, target) {
  const sj = ensureSideJobs(S);
  if (!sj) return;
  sj.target = target || null;
  if (sj.beacon) {
    sj.beacon.visible = !!target;
    if (target) sj.beacon.position.set(target.x, 30, target.z);
  }
  if (sj.markerMesh) {
    sj.markerMesh.visible = !!target;
    if (target) sj.markerMesh.position.set(target.x, 2, target.z);
  }
}

/**
 * Initialise S.sideJobs (orbs + totals + beacon). Call once from main.js.
 * Works with no scene (data-only orbs) and no THREE (meshes skipped);
 * meshes are created lazily via dynamic import so node / headless use
 * never fails on a missing renderer.
 */
export function createSideJobs(S) {
  if (!S || typeof S !== 'object') return null;
  if (!Array.isArray(S.orbsCollected)) S.orbsCollected = [];
  if (!S.sideJobsDone || typeof S.sideJobsDone !== 'object') {
    S.sideJobsDone = { taxi: 0, delivery: 0, orbs: 0, earned: 0 };
  }
  const orbs = COLLECTIBLE_ORBS.map((o, i) => ({
    index: i, x: o.x, z: o.z, y: o.y || 1.5, near: o.near,
    taken: S.orbsCollected.includes(i), mesh: null, baseY: o.y || 1.5,
  }));
  S.sideJobs = {
    active: null, // { kind:'taxi'|'delivery', phase, from, to, timeLeft, late }
    orbs, target: null,
    beacon: null, markerMesh: null,
    lastResult: null,
  };
  // 3D visuals (best-effort; orbs stay collectible without them).
  if (S.scene) {
    import('three').then((THREE) => {
      if (!S.sideJobs) return;
      try {
        const orbGeo = new THREE.SphereGeometry(0.7, 12, 10);
        const orbMat = new THREE.MeshBasicMaterial({ color: 0x00ffe7 });
        for (const orb of S.sideJobs.orbs) {
          if (orb.taken) continue;
          const mesh = new THREE.Mesh(orbGeo, orbMat);
          mesh.position.set(orb.x, orb.y, orb.z);
          S.scene.add(mesh);
          orb.mesh = mesh;
        }
        const beaconMat = new THREE.MeshBasicMaterial({ color: 0x00ffe7, transparent: true, opacity: 0.3 });
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 60, 12, 1, true), beaconMat);
        beacon.visible = false;
        S.scene.add(beacon);
        S.sideJobs.beacon = beacon;
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10),
          new THREE.MeshBasicMaterial({ color: 0x00ffe7 }));
        marker.visible = false;
        S.scene.add(marker);
        S.sideJobs.markerMesh = marker;
      } catch (e) { /* visuals are optional; logic still runs */ }
    }).catch(() => { /* no THREE available; data-only orbs */ });
  }
  return S.sideJobs;
}

/** Start a taxi fare: reach the passenger, then their destination. $120. */
export function startTaxi(S) {
  ensureSideJobs(S);
  if (!S.sideJobs) createSideJobs(S);
  if (S.sideJobs.active) return { ok: false, error: 'a side job is already active' };
  const from = randomLandmark();
  const to = randomLandmark(from.key);
  S.sideJobs.active = { kind: 'taxi', phase: 'pickup', from, to, timeLeft: null, late: false };
  setBeacon(S, { x: from.x, z: from.z, label: 'Pick up passenger: ' + from.label });
  return { ok: true, job: S.sideJobs.active };
}

/** Start a courier run: collect the package, deliver within 90s. $100 ($50 late). */
export function startDelivery(S) {
  ensureSideJobs(S);
  if (!S.sideJobs) createSideJobs(S);
  if (S.sideJobs.active) return { ok: false, error: 'a side job is already active' };
  const from = randomLandmark();
  const to = randomLandmark(from.key);
  S.sideJobs.active = {
    kind: 'delivery', phase: 'pickup', from, to,
    timeLeft: SIDE_JOBS.delivery.timeLimit, late: false,
  };
  setBeacon(S, { x: from.x, z: from.z, label: 'Pick up package: ' + from.label });
  return { ok: true, job: S.sideJobs.active };
}

/** Collectible orbs collected so far (0-10). */
export function orbsCollectedCount(S) {
  return Array.isArray(S.orbsCollected) ? S.orbsCollected.length : 0;
}

/** Current side-job target {x,z,label} for the HUD/minimap, or null. */
export function sideJobMarker(S) {
  const sj = ensureSideJobs(S);
  return (sj && sj.active && sj.target) ? sj.target : null;
}

function finishJob(S, kind, amount, label) {
  const sj = ensureSideJobs(S);
  if (!sj) return;
  sj.active = null;
  setBeacon(S, null);
  const r = payOut(S, kind, amount);
  sj.lastResult = { ok: true, kind, amount, label, cash: r.cash };
  return r;
}

function cancelJob(S, reason) {
  const sj = ensureSideJobs(S);
  if (!sj || !sj.active) return;
  sj.active = null;
  setBeacon(S, null);
  sj.lastResult = { ok: false, kind: null, amount: 0, label: reason || 'Side job ended.' };
}

/** Per-frame update: proximity checks, delivery timer, orb bobbing. */
export function updateSideJobs(S, dt) {
  const sj = ensureSideJobs(S);
  if (!sj) return;
  const step = Math.max(0, dt || 0);
  const p = posOf(S.player);

  // --- collectible orbs (always live, even during missions) ---
  if (p) {
    for (const orb of sj.orbs) {
      if (orb.taken) continue;
      const dx = orb.x - p.x, dz = orb.z - p.z;
      const dy = (orb.y || 1.5) - (p.y || 0);
      if (Math.hypot(dx, dz) <= SIDE_JOBS.orb.radius && Math.abs(dy) < 3) {
        orb.taken = true;
        if (orb.mesh && S.scene) S.scene.remove(orb.mesh);
        orb.mesh = null;
        if (!S.orbsCollected.includes(orb.index)) S.orbsCollected.push(orb.index);
        payOut(S, 'orb', SIDE_JOBS.orb.payout);
        sj.lastResult = { ok: true, kind: 'orb', amount: SIDE_JOBS.orb.payout, label: `Hidden orb ${S.orbsCollected.length}/10 found! +$${SIDE_JOBS.orb.payout}` };
      } else if (orb.mesh) {
        orb.mesh.position.y = orb.baseY + Math.sin((S.time || 0) * 2 + orb.index) * 0.3;
        orb.mesh.rotation.y += step;
      }
    }
  }

  // --- active taxi / delivery job ---
  const job = sj.active;
  if (!job) return;
  if (sj.beacon) sj.beacon.rotation.y += step * 0.5;
  if (sj.markerMesh && sj.target) {
    sj.markerMesh.position.y = 2 + Math.sin((S.time || 0) * 3) * 0.4;
  }
  if (job.kind === 'delivery') {
    job.timeLeft -= step;
    if (job.timeLeft <= 0 && !job.late) job.late = true;
    if (job.timeLeft <= -SIDE_JOBS.delivery.lateGrace) {
      cancelJob(S, 'Courier run expired — package returned. No penalty.');
      return;
    }
  }
  if (!p) return;
  const target = job.phase === 'pickup' ? job.from : job.to;
  if (dist2D(p, target) <= SIDE_JOBS.taxi.radius) {
    if (job.phase === 'pickup') {
      job.phase = 'deliver';
      setBeacon(S, { x: job.to.x, z: job.to.z, label: (job.kind === 'taxi' ? 'Drop off at ' : 'Deliver to ') + job.to.label });
    } else if (job.kind === 'taxi') {
      finishJob(S, 'taxi', SIDE_JOBS.taxi.payout, `Taxi fare complete! +$${SIDE_JOBS.taxi.payout}`);
    } else {
      const amount = job.late ? SIDE_JOBS.delivery.latePayout : SIDE_JOBS.delivery.payout;
      finishJob(S, 'delivery', amount, job.late
        ? `Courier run complete (late)! +$${amount}`
        : `Courier run complete! +$${amount}`);
    }
  }
}

export default { createSideJobs, updateSideJobs, startTaxi, startDelivery, orbsCollectedCount, sideJobMarker };
