// ISLA BRASA 3D — HUD + minimap + overlays (Worker D: progression)
// Plain DOM for the text HUD, one <canvas> for the minimap. No THREE here,
// so this module also imports cleanly in node (all DOM access is inside
// functions). updateHUD() is called every frame by the main loop;
// drawMinimap(S, canvas) can also be called directly with any canvas.

import { LANDMARKS, WEAPONS, CAR_TYPES, CREW } from './config.js';
import { missionMarker, currentStep, stepProgress, missionList } from './missions.js';
import { posOf, dist2D } from './missions.js';
import {
  respectRank, buyCar, upgradeCar, sellCar, hireCrew, levelCrew,
  buyWeapon, carStats, sellValue, upgradeCost, UPGRADE_KINDS,
} from './economy.js';

let lastBriefKey = null;
let briefShownAt = 0;
let lastResultKey = null;
let resultShownAt = 0;
let lastOverlaySig = null;

// ------------------------------------------------------------ DOM helpers
function el(id) {
  return (typeof document !== 'undefined') ? document.getElementById(id) : null;
}

function mk(tag, id, parent, cssText) {
  const n = document.createElement(tag);
  if (id) n.id = id;
  if (cssText) n.style.cssText = cssText;
  if (parent) parent.appendChild(n);
  return n;
}

// Build the HUD shell once (only if the page / main worker hasn't already).
// Sub-elements are looked up by id, so a main-worker HUD with the same ids
// is reused instead of duplicated.
function ensureHud() {
  if (typeof document === 'undefined') return null;
  let hud = el('hud');
  if (!hud) {
    hud = mk('div', 'hud', document.body,
      'position:fixed;top:10px;left:10px;z-index:20;font-family:Arial,sans-serif;' +
      'color:#fff;text-shadow:0 1px 2px #000;pointer-events:none;user-select:none;');
    mk('div', 'hud-cash', hud, 'font-size:20px;font-weight:bold;color:#7CFC9A;');
    mk('div', 'hud-wanted', hud, 'font-size:20px;color:#ffd23f;letter-spacing:2px;');
    mk('div', 'hud-respect', hud, 'font-size:14px;');
    mk('div', 'hud-weapon', hud, 'font-size:14px;color:#cfe8ff;');
    mk('div', 'hud-mission', hud, 'font-size:14px;margin-top:6px;max-width:320px;line-height:1.35;');
    mk('div', 'hud-timer', hud, 'font-size:18px;font-weight:bold;color:#ff5b5b;');
    mk('div', 'hud-speed', hud, 'font-size:16px;color:#ffe9a8;');
  }
  let mm = el('minimap');
  if (!mm) {
    mm = mk('canvas', 'minimap', document.body,
      'position:fixed;right:10px;top:10px;z-index:20;width:180px;height:180px;' +
      'border:2px solid rgba(255,255,255,.35);border-radius:8px;background:#0d1a12;');
    mm.width = 180;
    mm.height = 180;
  }
  return hud;
}

function setText(id, text) {
  const n = el(id);
  if (n && n.textContent !== text) n.textContent = text;
}

function playerInCar(S) {
  const p = S.player || {};
  return !!(p.car || p.vehicle || p.inCar || S.currentCar || S.drivingCar);
}

// ------------------------------------------------------------ mission brief / result banner
function showBanner(id, html, ms) {
  let n = el(id);
  if (!n) {
    n = mk('div', id, document.body,
      'position:fixed;top:18%;left:50%;transform:translateX(-50%);z-index:30;' +
      'background:rgba(0,0,0,.82);border:1px solid #ffd23f;border-radius:10px;' +
      'padding:14px 20px;max-width:520px;text-align:center;color:#fff;' +
      'font-family:Arial,sans-serif;font-size:15px;line-height:1.45;pointer-events:none;');
  }
  n.innerHTML = html;
  n.style.display = 'block';
  return n;
}

function updateBanners(S) {
  const now = Date.now();
  // Mission brief on accept (first ~6s of a mission).
  if (S.mission) {
    const key = 'm' + S.mission.id;
    if (key !== lastBriefKey) {
      lastBriefKey = key;
      briefShownAt = now;
      showBanner('hud-brief',
        `<b style="color:#ffd23f;font-size:17px;">${S.mission.def.name} — $${S.mission.def.payout}</b><br>${S.mission.def.brief}`);
    }
    const brief = el('hud-brief');
    if (brief) brief.style.display = (now - briefShownAt < 6000) ? 'block' : 'none';
  } else if (el('hud-brief')) {
    el('hud-brief').style.display = 'none';
    lastBriefKey = null;
  }
  // Completion / failure result.
  const r = S.lastMissionResult;
  if (r) {
    const key = JSON.stringify(r);
    if (key !== lastResultKey) {
      lastResultKey = key;
      resultShownAt = now;
      const html = r.ok
        ? `<b style="color:#7CFC9A;font-size:17px;">MISSION COMPLETE — ${r.name}</b><br>+$${r.payout} &nbsp;·&nbsp; Rank: ${r.rank}`
        : `<b style="color:#ff5b5b;font-size:17px;">MISSION FAILED</b><br>${r.reason || ''} Retry from the mission list.`;
      showBanner('hud-result', html);
    }
    const res = el('hud-result');
    if (res) res.style.display = (now - resultShownAt < 5000) ? 'block' : 'none';
  }
}

// ------------------------------------------------------------ weapon wheel
function updateWeaponWheel(S) {
  if (typeof document === 'undefined') return;
  let wheel = el('weapon-wheel');
  if (!S.weaponWheelOpen) {
    if (wheel) wheel.style.display = 'none';
    return;
  }
  if (!wheel) {
    wheel = mk('div', 'weapon-wheel', document.body,
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:30;' +
      'background:rgba(0,0,0,.85);border:1px solid #888;border-radius:12px;padding:16px 20px;' +
      'font-family:Arial,sans-serif;color:#fff;pointer-events:none;min-width:260px;');
  }
  const owned = S.ownedWeapons || ['fists'];
  const rows = Object.values(WEAPONS).map((w) => {
    const has = owned.includes(w.id);
    const cur = S.weapon === w.id;
    const ammo = w.id === 'fists' ? '∞' : (S.ammo && S.ammo[w.id] != null ? S.ammo[w.id] : 0);
    return `<div style="padding:4px 6px;border-radius:6px;${cur ? 'background:#ffd23f;color:#000;font-weight:bold;' : ''}${!has ? 'opacity:.45;' : ''}">${w.name} — dmg ${w.dmg} · rng ${w.range} · ${w.rate}/s · ammo ${ammo}${!has ? ' (buy in shop: G)' : ''}</div>`;
  }).join('');
  wheel.innerHTML = '<b>WEAPONS — hold Q, 1-5 to pick</b>' + rows;
  wheel.style.display = 'block';
}

// ------------------------------------------------------------ garage / shop overlay
function garageHtml(S) {
  const rank = respectRank(S);
  let h = `<b style="font-size:18px;">BRASA GARAGE</b> &nbsp; Cash: <b style="color:#7CFC9A;">$${S.cash}</b> &nbsp; Rank: ${rank.name}<br>` +
    `<span style="opacity:.8;">G / Esc to close. Upgrades: 3 tiers each (engine / armor / handling).</span><br><br>`;
  for (const car of Object.values(CAR_TYPES)) {
    const owned = (S.ownedCars || []).includes(car.id);
    const stats = carStats(S, car.id);
    h += `<div style="border-top:1px solid #444;padding:8px 0;"><b>${car.name}</b> (${car.kind}) — ` +
      `top ${stats.topSpeed} · accel ${stats.accel} · <b>$${car.price}</b> ` +
      (owned
        ? `<button data-act="sell" data-car="${car.id}">Sell $${sellValue(S, car.id)}</button><br>` +
          UPGRADE_KINDS.map((k) => {
            const tier = (S.upgrades[car.id] || {})[k] || 0;
            const next = tier >= 3 ? 'MAX' : `$${upgradeCost(k, tier + 1)}`;
            return `${k} ${'●'.repeat(tier)}${'○'.repeat(3 - tier)} <button data-act="upg" data-car="${car.id}" data-kind="${k}" ${tier >= 3 ? 'disabled' : ''}>${next}</button>`;
          }).join(' &nbsp; ')
        : `<button data-act="buy" data-car="${car.id}">Buy $${car.price}</button>`);
    h += '</div>';
  }
  h += '<br><b>CREW</b><br>';
  for (const m of Object.values(CREW)) {
    const c = (S.crew && S.crew[m.id]) || { hired: false, level: 0 };
    const effect = m.id === 'rico' ? 'fast getaway car / +20% speed in missions'
      : m.id === 'marta' ? 'ally NPC fights beside you in missions'
      : '+15s per level on timed missions';
    h += `<div style="border-top:1px solid #444;padding:6px 0;"><b>${m.name}</b> (${m.role}) — ${effect} — ` +
      (!c.hired
        ? `<button data-act="hire" data-crew="${m.id}">Hire $${m.price}</button>`
        : `Lv ${c.level}/3 ` + (c.level >= 3
          ? 'MAX'
          : `<button data-act="lvl" data-crew="${m.id}">Level up $${750 * (c.level + 1)}</button>`));
    h += '</div>';
  }
  return h;
}

function shopHtml(S) {
  let h = `<b style="font-size:18px;">WEAPON SHOP</b> &nbsp; Cash: <b style="color:#7CFC9A;">$${S.cash}</b><br>` +
    `<span style="opacity:.8;">G / Esc to close. Buying a weapon you own buys a 30-round ammo pack instead.</span><br><br>`;
  for (const w of Object.values(WEAPONS)) {
    if (w.id === 'fists') {
      h += `<div style="border-top:1px solid #444;padding:6px 0;"><b>Fists</b> — always owned · dmg 10</div>`;
      continue;
    }
    const owned = (S.ownedWeapons || []).includes(w.id);
    const ammo = (S.ammo && S.ammo[w.id]) || 0;
    h += `<div style="border-top:1px solid #444;padding:6px 0;"><b>${w.name}</b> — dmg ${w.dmg} · rng ${w.range} · ${w.rate}/s · ammo ${ammo} — ` +
      (owned
        ? `<button data-act="ammo" data-w="${w.id}">Ammo $${w.ammoPrice}</button>`
        : `<button data-act="buy-w" data-w="${w.id}">Buy $${w.price}</button>`);
    h += '</div>';
  }
  return h;
}

function updateOverlay(S) {
  if (typeof document === 'undefined') return;
  let ov = el('game-overlay');
  if (!S.overlay) {
    if (ov) ov.style.display = 'none';
    lastOverlaySig = null;
    return;
  }
  if (!ov) {
    ov = mk('div', 'game-overlay', document.body,
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:25;' +
      'background:rgba(10,14,10,.94);border:1px solid #ffd23f;border-radius:12px;' +
      'padding:18px 22px;max-width:640px;max-height:80vh;overflow:auto;color:#fff;' +
      'font-family:Arial,sans-serif;font-size:14px;line-height:1.5;');
  }
  // Re-render only when the underlying state changed (cash / owned / levels),
  // so buttons stay clickable while the overlay is open.
  const sig = JSON.stringify([
    S.overlay, S.cash, S.ownedCars, S.upgrades, S.crew, S.ownedWeapons, S.ammo,
  ]);
  if (sig !== lastOverlaySig) {
    lastOverlaySig = sig;
    ov.innerHTML = (S.overlay === 'garage' ? garageHtml(S) : shopHtml(S)) +
      '<br><button data-act="close">Close (G)</button>';
    ov.querySelectorAll('button[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        let r = null;
        if (act === 'buy') r = buyCar(S, b.dataset.car);
        else if (act === 'sell') r = sellCar(S, b.dataset.car);
        else if (act === 'upg') r = upgradeCar(S, b.dataset.car, b.dataset.kind);
        else if (act === 'hire') r = hireCrew(S, b.dataset.crew);
        else if (act === 'lvl') r = levelCrew(S, b.dataset.crew);
        else if (act === 'buy-w' || act === 'ammo') r = buyWeapon(S, b.dataset.w);
        else if (act === 'close') { S.overlay = null; }
        if (r && !r.ok && S.flash) S.flash(r.error);
        lastOverlaySig = null; // force re-render with the new state
        updateOverlay(S);
      });
    });
  }
  ov.style.display = 'block';
}

// ------------------------------------------------------------ main HUD update
export function updateHUD(S) {
  if (typeof document === 'undefined') return;
  ensureHud();

  setText('hud-cash', '$' + (S.cash || 0));
  const wanted = Math.max(0, Math.min(5, S.wanted || 0));
  setText('hud-wanted', '★'.repeat(wanted) + '☆'.repeat(5 - wanted));
  const rank = respectRank(S);
  setText('hud-respect', `Respect ${S.respect || 0} · ${rank.name}${rank.nextName ? ` (next: ${rank.nextName} at ${rank.nextMin})` : ' — MAX'}`);
  const w = WEAPONS[S.weapon] || WEAPONS.fists;
  const ammo = w.id === 'fists' ? '∞' : ((S.ammo && S.ammo[w.id]) || 0);
  setText('hud-weapon', `Weapon: ${w.name} · ammo ${ammo}`);

  // Mission tracker: name + current step + progress + distance.
  let missionText = '';
  if (S.mission) {
    const step = currentStep(S);
    const marker = missionMarker(S);
    const p = posOf(S.player);
    const d = (marker && p) ? Math.round(dist2D(S.player, marker)) : null;
    const prog = stepProgress(S);
    missionText = `${S.mission.def.name} (${S.mission.stepIndex + 1}/${S.mission.def.steps.length}) — ${step ? step.label : ''}${prog ? ' ' + prog : ''}${d != null ? ' · ' + d + 'm' : ''}`;
  } else if (S.race) {
    const marker = missionMarker(S);
    const d = marker ? Math.round(dist2D(S.player, marker)) : null;
    missionText = `RACE: ${S.race.def.name} — ${S.race.checkpoint.label}${d != null ? ' · ' + d + 'm' : ''}`;
  } else {
    const next = missionList(S).find((m) => m.unlocked && !m.done);
    missionText = next
      ? `Next: ${next.name} ($${next.payout}) — find the mission start`
      : 'All 12 missions complete — Legend of Isla Brasa!';
  }
  setText('hud-mission', missionText);

  // Timer (timed missions and races only).
  const t = S.mission ? S.mission.timeLeft : (S.race ? S.race.timeLeft : null);
  if (typeof t === 'number') {
    const s = Math.max(0, Math.ceil(t));
    setText('hud-timer', `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  } else {
    setText('hud-timer', '');
  }

  // Speed, only while driving.
  if (playerInCar(S)) {
    const sp = (S.player && typeof S.player.speed === 'number') ? S.player.speed
      : (typeof S.speed === 'number' ? S.speed : 0);
    setText('hud-speed', `${Math.round(sp * 3.6)} km/h`);
  } else {
    setText('hud-speed', '');
  }

  updateBanners(S);
  updateWeaponWheel(S);
  updateOverlay(S);
  const mm = el('minimap');
  if (mm) drawMinimap(S, mm);
}

// ------------------------------------------------------------ minimap
const MAP_MIN = -200;
const MAP_MAX = 200;

export function drawMinimap(S, canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const scale = (v) => ((v - MAP_MIN) / (MAP_MAX - MAP_MIN));
  const mx = (x) => scale(x) * W;
  const my = (z) => scale(z) * H; // north (-z) is up: z=-200 -> y=0

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#12261a';
  ctx.fillRect(0, 0, W, H);
  // Water along the south edge (beach / pier / marina side, z > 160).
  ctx.fillStyle = '#14456b';
  ctx.fillRect(0, my(160), W, H - my(160));
  // Road grid.
  ctx.strokeStyle = 'rgba(255,255,255,.14)';
  ctx.lineWidth = 1;
  for (let g = -160; g <= 160; g += 40) {
    ctx.beginPath(); ctx.moveTo(mx(g), 0); ctx.lineTo(mx(g), H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, my(g)); ctx.lineTo(W, my(g)); ctx.stroke();
  }
  // Landmarks.
  const marker = missionMarker(S);
  for (const [key, lm] of Object.entries(LANDMARKS)) {
    const isTarget = marker && Math.abs(marker.x - lm.x) < 1 && Math.abs(marker.z - lm.z) < 1;
    ctx.fillStyle = isTarget ? '#ffd23f' : 'rgba(255,255,255,.75)';
    ctx.beginPath();
    ctx.arc(mx(lm.x), my(lm.z), isTarget ? 5 : 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Mission / race target ring (pulsing).
  if (marker) {
    const pulse = 7 + 3 * Math.sin((S.time || 0) * 4);
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mx(marker.x), my(marker.z), pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 9px Arial';
    ctx.fillText(marker.label, Math.min(mx(marker.x) + 8, W - 70), my(marker.z) - 6);
  }
  // Pickups (gold) and enemies (red) — mission ones matter most.
  ctx.fillStyle = '#ff9f1c';
  for (const p of (S.pickups || [])) {
    if (p.taken) continue;
    ctx.fillRect(mx(posOf(p).x) - 1.5, my(posOf(p).z) - 1.5, 3, 3);
  }
  ctx.fillStyle = '#ff5b5b';
  for (const e of (S.enemies || [])) {
    if (e.hp <= 0 || e.dead) continue;
    ctx.beginPath();
    ctx.arc(mx(posOf(e).x), my(posOf(e).z), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Police (blue) if the police worker exposes them.
  ctx.fillStyle = '#4da6ff';
  for (const p of (S.police || [])) {
    ctx.beginPath();
    ctx.arc(mx(posOf(p).x), my(posOf(p).z), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Player arrow.
  const pp = posOf(S.player);
  if (pp) {
    const heading = (S.player && typeof S.player.heading === 'number') ? S.player.heading
      : (S.player && typeof S.player.angle === 'number' ? S.player.angle : 0);
    ctx.save();
    ctx.translate(mx(pp.x), my(pp.z));
    ctx.rotate(-heading);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
