// ISLA BRASA 3D — HUD + minimap + overlays (Worker D: progression)
// Plain DOM for the text HUD, one <canvas> for the minimap. No THREE here,
// so this module also imports cleanly in node (all DOM access is inside
// functions). updateHUD() is called every frame by the main loop;
// drawMinimap(S, canvas) can also be called directly with any canvas.

import { LANDMARKS, WEAPONS, CAR_TYPES, CREW, EXTRA_WEAPONS, CLOTHES, CASINO, PROPERTIES, INTERIORS } from './config.js';
import { spinSlots, dealBlackjack, hitBlackjack, standBlackjack, spinRoulette, ensureCasino } from './casino.js';
import { sleepInSafehouse, exitInterior } from './interiors.js';
import { missionMarker, currentStep, stepProgress, missionList, heistPart, heistAvailable } from './missions.js';
import { posOf, dist2D } from './missions.js';
import {
  respectRank, buyCar, upgradeCar, sellCar, hireCrew, levelCrew,
  buyWeapon, carStats, sellValue, upgradeCost, UPGRADE_KINDS,
  buyOutfit, buyAmmo, buyExtraWeapon, GARAGE_VEHICLES,
  buyProperty, openCasino, openProperties,
} from './economy.js';

let lastInteriorSig = null;
let lastToastSig = null;

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
function ensureHud(S) {
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
    mk('div', 'hud-clock', hud, 'font-size:14px;color:#cfe8ff;'); // Worker A: day/night clock
  }
  // The page ships its own #hud, so add the clock line if it is missing.
  if (!el('hud-clock') && hud) {
    mk('div', 'hud-clock', hud, 'font-size:14px;color:#cfe8ff;');
  }
  // Worker D: current-vehicle line (car / bike / boat) — same pattern.
  if (!el('hud-vehicle') && hud) {
    mk('div', 'hud-vehicle', hud, 'font-size:14px;color:#aef3c0;');
  }
  // Worker F: flight readout line (altitude + airspeed while flying).
  if (!el('hud-flight') && hud) {
    mk('div', 'hud-flight', hud, 'font-size:14px;color:#9fd8ff;');
  }
  // Worker E: radio station line + weather icon (added even when the page
  // shipped its own #hud, so they always exist).
  const hudLeft = el('hud-left') || hud;
  if (!el('hud-radio') && hudLeft) {
    mk('div', 'hud-radio', hudLeft, 'font-size:14px;color:#ffb3d9;');
  }
  const hudRight = el('hud-right');
  if (!el('hud-weather') && hudRight) {
    mk('div', 'hud-weather', hudRight, 'font-size:20px;text-align:right;');
  } else if (!el('hud-weather') && hud) {
    mk('div', 'hud-weather', hud, 'font-size:20px;');
  }
  // Worker E: radio station button (bottom-right, next to the mute button).
  let radioBtn = el('hud-radio-btn');
  if (!radioBtn) {
    radioBtn = mk('button', 'hud-radio-btn', document.body,
      'position:fixed;right:230px;bottom:10px;z-index:21;padding:8px 14px;' +
      'background:rgba(0,0,0,.6);color:#fff;border:1px solid #888;border-radius:8px;' +
      'cursor:pointer;font-size:14px;');
    radioBtn.textContent = '📻 Radio (R)';
    radioBtn.addEventListener('click', () => {
      const S = (typeof window !== 'undefined') ? window.ISLA_BRASA : null;
      if (S && S.radio && typeof S.radio.nextStation === 'function') S.radio.nextStation();
    });
  }
  // Worker G: Properties button (P) — bottom-right, next to the radio
  // button. M is mute, so the property menu uses P (see the help line).
  let propBtn = el('hud-properties-btn');
  if (!propBtn) {
    propBtn = mk('button', 'hud-properties-btn', document.body,
      'position:fixed;right:330px;bottom:10px;z-index:21;padding:8px 14px;' +
      'background:rgba(0,0,0,.6);color:#fff;border:1px solid #888;border-radius:8px;' +
      'cursor:pointer;font-size:14px;');
    propBtn.textContent = '🏠 Properties (P)';
    propBtn.addEventListener('click', () => {
      const S = (typeof window !== 'undefined') ? window.ISLA_BRASA : null;
      if (S) openProperties(S);
    });
  }
  // Mute button (Worker A audio): bottom-right, next to Help. The HUD shell
  // is pointer-events:none, so the button re-enables pointer events itself.
  let muteBtn = el('hud-mute-btn');
  if (!muteBtn) {
    muteBtn = mk('button', 'hud-mute-btn', document.body,
      'position:fixed;right:110px;bottom:10px;z-index:21;padding:8px 14px;' +
      'background:rgba(0,0,0,.6);color:#fff;border:1px solid #888;border-radius:8px;' +
      'cursor:pointer;font-size:14px;');
    muteBtn.addEventListener('click', () => {
      if (S && S.audio) { S.audio.toggleMuted(); S.audio.playSfx('click'); }
    });
  }
  let mm = el('minimap');
  if (!mm) {
    mm = mk('canvas', 'minimap', document.body,
      'position:fixed;right:10px;top:10px;z-index:20;width:180px;height:180px;' +
      'border:2px solid rgba(255,255,255,.35);border-radius:8px;background:#0d1a12;');
    mm.width = 180;
    mm.height = 180;
  }
  // Side-job tracker (Worker C): text line + Taxi (T) / Delivery (Y) buttons.
  // Created even when index.html already supplied #hud, so it always exists.
  let sj = el('hud-sidejobs');
  if (!sj) {
    sj = mk('div', 'hud-sidejobs', document.body,
      'position:fixed;left:10px;bottom:44px;z-index:20;font-family:Arial,sans-serif;' +
      'color:#fff;text-shadow:0 1px 2px #000;font-size:13px;pointer-events:auto;user-select:none;' +
      'background:rgba(0,0,0,.55);border:1px solid #00ffe7;border-radius:8px;padding:6px 10px;max-width:340px;line-height:1.4;');
    const span = document.createElement('span');
    span.id = 'hud-sidejobs-text';
    sj.appendChild(span);
    for (const [label, fn] of [['🚕 Taxi (T)', 'startTaxi'], ['📦 Delivery (Y)', 'startDelivery']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'margin:4px 4px 0 0;padding:3px 8px;background:#00383a;color:#aef;border:1px solid #00ffe7;border-radius:6px;cursor:pointer;font-size:12px;';
      b.addEventListener('click', () => {
        const S = (typeof window !== 'undefined') ? window.ISLA_BRASA : null;
        if (S && typeof S[fn] === 'function') S[fn]();
      });
      sj.appendChild(b);
    }
  }
  return hud;
}

// ------------------------------------------------------------ dialogue box (Worker C)
// Renders S.dialogue (dialogue.js state): speaker + typewriter text + skip hint.
// Pure DOM from state — no import of dialogue.js, so hud.js survives its absence.
function updateDialogueBox(S) {
  if (typeof document === 'undefined') return;
  const d = S.dialogue;
  let box = el('dialogue-box');
  if (!d || !d.open) {
    if (box) box.style.display = 'none';
    return;
  }
  if (!box) {
    box = mk('div', 'dialogue-box', document.body,
      'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:35;' +
      'background:rgba(0,0,0,.85);border:1px solid #ffd23f;border-radius:10px;' +
      'padding:12px 18px;max-width:560px;min-width:320px;color:#fff;' +
      'font-family:Arial,sans-serif;font-size:15px;line-height:1.5;cursor:pointer;');
    const sp = document.createElement('div');
    sp.id = 'dialogue-speaker';
    sp.style.cssText = 'color:#ffd23f;font-weight:bold;font-size:16px;margin-bottom:4px;';
    box.appendChild(sp);
    const tx = document.createElement('div');
    tx.id = 'dialogue-text';
    box.appendChild(tx);
    const hint = document.createElement('div');
    hint.textContent = 'click / any key to skip ▸';
    hint.style.cssText = 'opacity:.6;font-size:12px;margin-top:6px;text-align:right;';
    box.appendChild(hint);
    box.addEventListener('click', () => {
      const S2 = (typeof window !== 'undefined') ? window.ISLA_BRASA : null;
      if (S2 && typeof S2.skipDialogue === 'function') S2.skipDialogue();
    });
  }
  const sp = el('dialogue-speaker');
  if (sp && sp.textContent !== d.speaker) sp.textContent = d.speaker;
  const tx = el('dialogue-text');
  if (tx && tx.textContent !== d.shown) tx.textContent = d.shown;
  box.style.display = 'block';
}

// ------------------------------------------------------------ side-job tracker (Worker C)
function updateSideJobsTracker(S) {
  if (typeof document === 'undefined') return;
  const sj = S.sideJobs;
  const orbs = Array.isArray(S.orbsCollected) ? S.orbsCollected.length : 0;
  const done = S.sideJobsDone || {};
  let text = `◆ Orbs ${orbs}/10 · Taxi ${done.taxi || 0} · Deliveries ${done.delivery || 0} · Side-job earnings $${done.earned || 0}`;
  if (sj && sj.active) {
    const job = sj.active;
    const target = job.phase === 'pickup' ? job.from : job.to;
    const p = posOf(S.player);
    const dist = (p && target) ? Math.round(dist2D(S.player, target)) : null;
    const what = job.kind === 'taxi'
      ? (job.phase === 'pickup' ? `Pick up passenger at ${target.label}` : `Drop off at ${target.label}`)
      : (job.phase === 'pickup' ? `Pick up package at ${target.label}` : `Deliver to ${target.label}`);
    let timer = '';
    if (job.kind === 'delivery' && typeof job.timeLeft === 'number') {
      timer = job.late ? ' · LATE ($50)' : ` · ${Math.max(0, Math.ceil(job.timeLeft))}s left`;
    }
    text = `◆ ${job.kind === 'taxi' ? 'TAXI' : 'COURIER'}: ${what}${dist != null ? ` · ${dist}m` : ''}${timer} — ${job.kind === 'taxi' ? '$120' : '$100'}`;
  } else if (sj && sj.lastResult && sj.lastResult.ok) {
    text += ` — ${sj.lastResult.label || ''}`;
  }
  setText('hud-sidejobs-text', text);
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
  // Worker E: Ammu-Nation exclusives join the wheel once owned (7 slots).
  const allWeapons = { ...WEAPONS, ...(EXTRA_WEAPONS || {}) };
  const rows = Object.values(allWeapons).map((w) => {
    const has = owned.includes(w.id);
    const cur = S.weapon === w.id;
    const ammo = w.id === 'fists' ? '∞' : (S.ammo && S.ammo[w.id] != null ? S.ammo[w.id] : 0);
    return `<div style="padding:4px 6px;border-radius:6px;${cur ? 'background:#ffd23f;color:#000;font-weight:bold;' : ''}${!has ? 'opacity:.45;' : ''}">${w.name} — dmg ${w.dmg} · rng ${w.range} · ${w.rate}/s · ammo ${ammo}${!has ? ' (buy in shop: G)' : ''}</div>`;
  }).join('');
  wheel.innerHTML = '<b>WEAPONS — hold Q, 1-7 to pick</b>' + rows;
  wheel.style.display = 'block';
}

// ------------------------------------------------------------ garage / shop overlay
function garageHtml(S) {
  const rank = respectRank(S);
  let h = `<b style="font-size:18px;">BRASA GARAGE</b> &nbsp; Cash: <b style="color:#7CFC9A;">$${S.cash}</b> &nbsp; Rank: ${rank.name}<br>` +
    `<span style="opacity:.8;">G / Esc to close. Upgrades: 3 tiers each (engine / armor / handling).</span><br><br>`;
  for (const id of GARAGE_VEHICLES) {
    const car = CAR_TYPES[id];
    if (!car) continue;
    const owned = (S.ownedCars || []).includes(car.id) || (S.ownedVehicles || []).includes(car.id);
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
  // Worker E: Ammu-Nation exclusives — sniper + RPG, high prices.
  h += '<br><b>AMMU-NATION EXCLUSIVES</b><br>';
  for (const w of Object.values(EXTRA_WEAPONS || {})) {
    const owned = (S.ownedWeapons || []).includes(w.id);
    const ammo = (S.ammo && S.ammo[w.id]) || 0;
    h += `<div style="border-top:1px solid #444;padding:6px 0;"><b>${w.name}</b> — dmg ${w.dmg} · rng ${w.range} · ${w.rate}/s · ammo ${ammo} — ` +
      (owned
        ? `<button data-act="ammo-x" data-w="${w.id}">Ammo $${w.ammoPrice}</button>`
        : `<button data-act="buy-x" data-w="${w.id}">Buy $${w.price}</button>`);
    h += '</div>';
  }
  return h;
}

// Worker E: clothes shop overlay (Brasa Threads, at the plaza).
function clothesHtml(S) {
  let h = `<b style="font-size:18px;">BRASA THREADS — CLOTHES</b> &nbsp; Cash: <b style="color:#7CFC9A;">$${S.cash}</b><br>` +
    `<span style="opacity:.8;">E / Esc to close. Buying an outfit equips it — it recolours your character and persists in the save.</span><br><br>`;
  for (const o of Object.values(CLOTHES || {})) {
    const owned = (S.outfits || []).includes(o.id);
    const equipped = S.equippedOutfit === o.id;
    h += `<div style="border-top:1px solid #444;padding:6px 0;"><b>${o.name}</b> — ` +
      `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:#${o.shirt.toString(16).padStart(6, '0')};border:1px solid #fff;vertical-align:middle;"></span> ` +
      (equipped ? '<b style="color:#7CFC9A;">EQUIPPED</b> '
        : owned ? `<button data-act="equip-outfit" data-o="${o.id}">Equip</button> `
          : `<button data-act="buy-outfit" data-o="${o.id}">Buy $${o.price}</button>`);
    h += '</div>';
  }
  return h;
}

// ------------------------------------------------------------ Worker G: casino overlay
// Three playable games: slots ($20/spin), blackjack ($50/hand, dealer
// stands on 17), roulette (red/black $25–$100, win pays 2x). All money
// moves on S.cash immediately via casino.js.
function casinoHtml(S) {
  ensureCasino(S);
  const c = S.casino;
  const bj = c.bj;
  const r = c.roulette;
  const bjPlayer = bj.player.length ? `${bj.player.join(' + ')} = ${bj.player.reduce((a, b) => a + b, 0)}` : '—';
  const bjDealer = bj.phase === 'playing' && bj.dealer.length
    ? `${bj.dealer[0]} + ?`
    : (bj.dealer.length ? `${bj.dealer.join(' + ')} = ${bj.dealer.reduce((a, b) => a + b, 0)}` : '—');
  let h = `<b style="font-size:18px;">🎰 CORAL ROOM CASINO</b> &nbsp; Cash: <b style="color:#7CFC9A;">$${S.cash}</b><br>` +
    `<span style="opacity:.8;">Esc to close. Winnings and losses hit your cash immediately.</span><br><br>` +
    `<b>🎰 SLOTS — $${CASINO.slotsCost}/spin</b> · 3×7️⃣ = $${CASINO.slotsJackpot} · 3 of a kind = $${CASINO.slotsThreeKind} · pair = $${CASINO.slotsTwoKind}<br>` +
    `<div style="font-size:34px;letter-spacing:6px;margin:6px 0;">${c.slots.reels.join(' ')}</div>` +
    `<div>${c.slots.last || 'Press SPIN to play.'}</div>` +
    `<button data-act="slots-spin">SPIN $${CASINO.slotsCost}</button><br><br>` +
    `<b>🃏 BLACKJACK — $${CASINO.blackjackBet}/hand</b> · dealer stands on 17 · win pays 2x · blackjack pays 3:2<br>` +
    `<div>Your hand: <b>${bjPlayer}</b> &nbsp; Dealer: <b>${bjDealer}</b></div>` +
    `<div>${bj.message}</div>` +
    (bj.phase === 'playing'
      ? `<button data-act="bj-hit">Hit</button> <button data-act="bj-stand">Stand</button>`
      : `<button data-act="bj-deal">Deal $${CASINO.blackjackBet}</button>`) + `<br><br>` +
    `<b>🎡 ROULETTE — bet red / black, win pays 2x</b> · 0 is green, both lose<br>` +
    `<div>${r.lastNumber != null ? `Last spin: <b>${r.lastNumber} ${r.lastColor}</b> — ` : ''}${r.message}</div>` +
    CASINO.rouletteBets.map((amt) =>
      `<button data-act="roulette-red" data-bet="${amt}">🔴 Red $${amt}</button> <button data-act="roulette-black" data-bet="${amt}">⚫ Black $${amt}</button>`).join('<br>');
  return h;
}

// ------------------------------------------------------------ Worker G: property menu
// Safehouse $5,000 (+$100/day), shop $12,000 (+$300/day), nightclub
// $25,000 (+$800/day). Income lands automatically at each day rollover.
function propertiesHtml(S) {
  const owned = Array.isArray(S.properties) ? S.properties : [];
  const income = owned.reduce((sum, id) => sum + (PROPERTIES[id]?.dailyIncome || 0), 0);
  let h = `<b style="font-size:18px;">🏠 PROPERTIES</b> &nbsp; Cash: <b style="color:#7CFC9A;">$${S.cash}</b><br>` +
    `<span style="opacity:.8;">P / Esc to close. Owned properties pay passive income every in-game day (day rollover).</span><br>` +
    `<div style="margin:6px 0;">Owned: ${owned.length ? owned.map((id) => PROPERTIES[id].name).join(', ') : 'none yet'} · <b style="color:#7CFC9A;">+$${income}/day</b></div>`;
  for (const p of Object.values(PROPERTIES)) {
    const has = owned.includes(p.id);
    h += `<div style="border-top:1px solid #444;padding:8px 0;"><b>${p.name}</b> — ${p.desc}<br>` +
      `Price <b>$${p.price.toLocaleString()}</b> · income <b style="color:#7CFC9A;">$${p.dailyIncome}/day</b> ` +
      (has ? `<b style="color:#7CFC9A;">✓ OWNED</b>`
        : `<button data-act="buy-prop" data-prop="${p.id}">Buy $${p.price.toLocaleString()}</button>`);
    h += '</div>';
  }
  return h;
}

// ------------------------------------------------------------ Worker G: interior banner + toast
// While inside a building: room name, exit prompt, and (casino /
// safehouse) the contextual action buttons. Daily-income toasts show here.
function updateInteriorBanner(S) {
  if (typeof document === 'undefined') return;
  let bar = el('interior-banner');
  const sig = JSON.stringify([S.insideInterior, S.overlay, S.lastIncome]);
  if (!S.insideInterior && !S.lastIncome) {
    if (bar) bar.style.display = 'none';
    lastInteriorSig = null;
    return;
  }
  if (!bar) {
    bar = mk('div', 'interior-banner', document.body,
      'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:28;' +
      'background:rgba(0,0,0,.85);border:1px solid #ffd23f;border-radius:10px;' +
      'padding:10px 16px;color:#fff;font-family:Arial,sans-serif;font-size:14px;' +
      'text-align:center;line-height:1.6;pointer-events:auto;');
  }
  if (sig !== lastInteriorSig) {
    lastInteriorSig = sig;
    let html = '';
    if (S.insideInterior) {
      const def = INTERIORS[S.insideInterior];
      html += `<b style="color:#ffd23f;">${def ? def.name : S.insideInterior} — INSIDE</b> · press <b>E</b> at the door to exit &nbsp; <button data-act="exit-interior">🚪 Exit (E)</button><br>`;
      if (S.insideInterior === 'casino') html += `<button data-act="play-casino">🎰 Play Casino</button> `;
      if (S.insideInterior === 'safehouse') html += `<button data-act="sleep-save">💤 Sleep — Save Game</button> `;
      if (S.insideInterior === 'garage') html += `<span style="opacity:.8;">Your rides on display. Press G outside for the garage shop.</span>`;
    }
    if (S.lastIncome && Date.now() - (S.lastIncome.at || 0) < 8000) {
      html += `<div style="color:#7CFC9A;">💰 Property income: +$${S.lastIncome.amount} (day ${S.lastIncome.day || ''})</div>`;
    }
    bar.innerHTML = html;
    bar.querySelectorAll('button[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'exit-interior') { exitInterior(S); }
        else if (act === 'play-casino') { openCasino(S); }
        else if (act === 'sleep-save') {
          const r = sleepInSafehouse(S);
          if (r && r.message && S.flash) S.flash(r.message);
          else if (r && r.message) { const t = el('interior-banner'); if (t) t.innerHTML += `<div>${r.message}</div>`; }
        }
        lastInteriorSig = null;
        updateInteriorBanner(S);
      });
    });
  }
  bar.style.display = 'block';
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
    S.outfits, S.equippedOutfit, S.properties, S.casino, S.insideInterior,
  ]);
  if (sig !== lastOverlaySig) {
    lastOverlaySig = sig;
    // Worker E: 'clothes' (Brasa Threads) and 'weapons' (Ammu-Nation) are
    // the enterable shops; 'shop' is the G-cycled weapon shop.
    // Worker G: 'casino' (Coral Room, 3 games) and 'properties' (P menu).
    ov.innerHTML = (S.overlay === 'garage' ? garageHtml(S)
      : S.overlay === 'clothes' ? clothesHtml(S)
      : S.overlay === 'casino' ? casinoHtml(S)
      : S.overlay === 'properties' ? propertiesHtml(S)
      : shopHtml(S)) +
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
        else if (act === 'buy-x') r = buyExtraWeapon(S, b.dataset.w);
        else if (act === 'ammo-x') r = buyAmmo(S, b.dataset.w);
        else if (act === 'buy-outfit' || act === 'equip-outfit') r = buyOutfit(S, b.dataset.o);
        else if (act === 'slots-spin') r = spinSlots(S);
        else if (act === 'bj-deal') r = dealBlackjack(S);
        else if (act === 'bj-hit') r = hitBlackjack(S);
        else if (act === 'bj-stand') r = standBlackjack(S);
        else if (act === 'roulette-red') r = spinRoulette(S, 'red', Number(b.dataset.bet));
        else if (act === 'roulette-black') r = spinRoulette(S, 'black', Number(b.dataset.bet));
        else if (act === 'buy-prop') r = buyProperty(S, b.dataset.prop);
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
  ensureHud(S);

  // Day/night clock (Worker A): HH:MM from S.timeOfDay + day/night glyph.
  const tod = (typeof S.timeOfDay === 'number') ? S.timeOfDay : 0.30;
  const mins = Math.floor(tod * 24 * 60) % (24 * 60);
  setText('hud-clock', `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')} ${S.isNight ? '☾ night' : '☀ day'}`);
  // Mute button label follows the live muted state (Worker A audio).
  const mb = el('hud-mute-btn');
  if (mb) {
    const label = (S.audio && S.audio.isMuted()) ? '🔇 Muted (M)' : '🔊 Sound (M)';
    if (mb.textContent !== label) mb.textContent = label;
  }
  // One-time help-line fix: M is mute now, the map moved to N (Worker A).
  // Worker G: P opens the property menu; E at a glowing door enters a
  // building (garage / casino / safehouse) and opens the casino inside.
  const hb = el('hud-bottom');
  if (hb && !hb.dataset.audioHelp) {
    hb.dataset.audioHelp = '1';
    hb.textContent = 'WASD move · Shift run · E enter/exit car · E at glowing door: enter building / casino · P properties · Click attack/shoot · Q (hold) weapons · G garage · R race on foot / radio while driving · V weather · N map · M mute · drag mouse to orbit camera';
  }
  // Worker E: radio station (only while driving) + weather icon.
  const radioEl = el('hud-radio');
  if (radioEl) {
    const st = (S.radio && typeof S.radio.currentStation === 'function') ? S.radio.currentStation() : null;
    const driving = playerInCar(S);
    const radioText = (driving && st) ? `📻 ${st.name} (${st.mood}) — R to change` : '';
    if (radioEl.textContent !== radioText) radioEl.textContent = radioText;
  }
  const weatherEl = el('hud-weather');
  if (weatherEl) {
    const kind = (S.weather && S.weather.kind) || S.weatherKind || 'clear';
    const icon = kind === 'rain' ? '🌧 rain' : kind === 'cloudy' ? '☁ cloudy' : '☀ clear';
    if (weatherEl.textContent !== icon) weatherEl.textContent = icon;
  }

  setText('hud-cash', '$' + (S.cash || 0));
  const wanted = Math.max(0, Math.min(5, S.wanted || 0));
  setText('hud-wanted', '★'.repeat(wanted) + '☆'.repeat(5 - wanted));
  const rank = respectRank(S);
  setText('hud-respect', `Respect ${S.respect || 0} · ${rank.name}${rank.nextName ? ` (next: ${rank.nextName} at ${rank.nextMin})` : ' — MAX'}`);
  const w = WEAPONS[S.weapon] || (EXTRA_WEAPONS || {})[S.weapon] || WEAPONS.fists;
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
    // Worker F: heist progress — part number + part name up front.
    let heistPrefix = '';
    if (S.mission.id === 13) {
      const part = heistPart(S);
      const partDef = (S.mission.def.parts || []).find((pp) => pp.part === part);
      heistPrefix = `HEIST Part ${part || 1}/3${partDef ? ' — ' + partDef.name : ''} · `;
    }
    missionText = `${heistPrefix}${S.mission.def.name} (${S.mission.stepIndex + 1}/${S.mission.def.steps.length}) — ${step ? step.label : ''}${prog ? ' ' + prog : ''}${d != null ? ' · ' + d + 'm' : ''}`;
  } else if (S.race) {
    const marker = missionMarker(S);
    const d = marker ? Math.round(dist2D(S.player, marker)) : null;
    missionText = `RACE: ${S.race.def.name} — ${S.race.checkpoint.label}${d != null ? ' · ' + d + 'm' : ''}`;
  } else {
    const next = missionList(S).find((m) => m.unlocked && !m.done);
    if (next) {
      missionText = `Next: ${next.name} ($${next.payout}) — find the mission start`;
    } else if ((S.missionsDone || []).includes(13) || S.heistDone) {
      missionText = 'All 12 missions + The Brasa Heist complete — Legend of Isla Brasa!';
    } else if (heistAvailable(S)) {
      missionText = 'Next: THE BRASA HEIST ($5,000) — the biggest score on the island';
    } else {
      missionText = 'All 12 missions complete — Legend of Isla Brasa!';
    }
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

  // Current vehicle (Worker D): car / motorbike / boat, with its speed.
  // The bike is the fastest ride in the game; the boat only runs on water.
  const veh = S.player?.car;
  if (veh) {
    const kind = veh.vehicleKind || 'car';
    const label = kind === 'bike' ? '🏍 Bike' : kind === 'boat' ? '⛵ Boat' : '🚗 Car';
    const name = (veh.stats && veh.stats.name) || veh.type || '';
    const vsp = Math.round(Math.abs(veh.speed || 0) * 3.6);
    setText('hud-vehicle', `${label} — ${name} · ${vsp} km/h`);
  } else {
    setText('hud-vehicle', '');
  }

  // Worker F: flight readout while flying the plane (altitude + airspeed).
  const plane = S.player?.plane || (S.plane && S.plane.driver === S.player ? S.plane : null);
  if (plane) {
    const alt = Math.max(0, Math.round(plane.pos.y));
    const spd = Math.round(Math.abs(plane.speed || 0) * 3.6);
    const thr = Math.round((plane.throttle || 0) * 100);
    const state = plane.airborne ? '✈ AIRBORNE' : '✈ ON GROUND';
    const hp = plane.hp < 100 ? ` · plane HP ${Math.round(plane.hp)}` : '';
    setText('hud-flight', `${state} · ALT ${alt}m · ${spd} km/h · throttle ${thr}%${hp}`);
  } else {
    setText('hud-flight', '');
  }

  updateBanners(S);
  updateDialogueBox(S);
  updateSideJobsTracker(S);
  updateWeaponWheel(S);
  updateOverlay(S);
  updateInteriorBanner(S); // Worker G: inside-building banner + income toast
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
  // Side jobs (Worker C, cyan): active job target ring + uncollected orbs.
  if (S.sideJobs) {
    const sj = S.sideJobs;
    if (sj.active && sj.target) {
      ctx.strokeStyle = '#00ffe7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx(sj.target.x), my(sj.target.z), 6 + 2 * Math.sin((S.time || 0) * 4), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#00ffe7';
    for (const orb of (sj.orbs || [])) {
      if (orb.taken) continue;
      ctx.beginPath();
      ctx.arc(mx(orb.x), my(orb.z), 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Worker G: buyable property markers (gold) + owned badge (green house).
  // Unowned properties show as gold dots; owned ones as green squares.
  for (const p of Object.values(PROPERTIES)) {
    const owned = (S.properties || []).includes(p.id);
    if (owned) {
      ctx.fillStyle = '#2eff5e';
      ctx.fillRect(mx(p.at.x) - 3, my(p.at.z) - 3, 6, 6);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 8px Arial';
      ctx.fillText('✓', mx(p.at.x) - 3, my(p.at.z) + 3);
    } else {
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(mx(p.at.x), my(p.at.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
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

// ISLA BRASA 3D — recorded agent authorship touch (2026-11-23)
