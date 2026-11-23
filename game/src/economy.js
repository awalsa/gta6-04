// ISLA BRASA 3D — garage / crew / shop / respect (Worker D: progression)
// Pure state logic; the HUD renders the overlays, the driving worker reads
// carStats() for effective speed. All money functions return
// { ok, error? , ... } so callers can show a reason instead of failing silently.

import {
  CAR_TYPES, CREW, CREW_LEVEL_COST, CREW_MAX_LEVEL,
  RESPECT_RANKS, RESPECT_PAYOUT_BONUS_PER_RANK, WEAPONS,
} from './config.js';

export const UPGRADE_KINDS = ['engine', 'armor', 'handling'];
export const MAX_UPGRADE_TIER = 3;
// Base cost per kind, x tier (tier 1/2/3). Engine also adds +10% top speed
// and +accel per tier (see carStats); armor/handling are read by combat /
// driving workers from S.upgrades.
export const UPGRADE_BASE_COST = { engine: 1000, armor: 800, handling: 700 };
export const SELL_FRACTION = 0.6;        // 60% of car price back
export const SELL_UPGRADE_FRACTION = 0.4; // + 40% of upgrades spent
export const AMMO_PACK_SIZE = 30;

function ensureState(S) {
  if (!Array.isArray(S.ownedCars)) S.ownedCars = [];
  if (!S.upgrades || typeof S.upgrades !== 'object') S.upgrades = {};
  if (!S.crew || typeof S.crew !== 'object') {
    S.crew = {
      rico: { hired: false, level: 0 },
      marta: { hired: false, level: 0 },
      ghost: { hired: false, level: 0 },
    };
  }
  for (const id of Object.keys(CREW)) {
    if (!S.crew[id]) S.crew[id] = { hired: false, level: 0 };
  }
  if (!Array.isArray(S.ownedWeapons)) S.ownedWeapons = ['fists'];
  if (!S.ammo || typeof S.ammo !== 'object') S.ammo = {};
  if (typeof S.cash !== 'number') S.cash = 0;
  if (typeof S.respect !== 'number') S.respect = 0;
  if (!S.weapon) S.weapon = 'fists';
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
  } catch (e) { /* best-effort only */ }
}

// ------------------------------------------------------------ overlays
export function openGarage(S) {
  ensureState(S);
  S.overlay = 'garage';
  return S.overlay;
}

export function closeGarage(S) {
  S.overlay = null;
  return null;
}

export function openShop(S) {
  ensureState(S);
  S.overlay = 'shop';
  return S.overlay;
}

export function closeShop(S) {
  S.overlay = null;
  return null;
}

// ------------------------------------------------------------ respect
/** Returns { name, index, min, nextMin, bonus } for the player's respect. */
export function respectRank(S) {
  ensureState(S);
  let index = 0;
  for (let i = 0; i < RESPECT_RANKS.length; i++) {
    if (S.respect >= RESPECT_RANKS[i].min) index = i;
  }
  const rank = RESPECT_RANKS[index];
  const next = RESPECT_RANKS[index + 1] || null;
  return {
    name: rank.name,
    index,
    min: rank.min,
    nextMin: next ? next.min : null,
    nextName: next ? next.name : null,
    bonus: RESPECT_PAYOUT_BONUS_PER_RANK * index, // +5% payout per rank index
  };
}

// ------------------------------------------------------------ cars
export function upgradeCost(kind, tier) {
  // tier = the tier being bought (1, 2 or 3).
  return (UPGRADE_BASE_COST[kind] || 800) * tier;
}

export function upgradesSpent(S, typeId) {
  ensureState(S);
  const up = S.upgrades[typeId] || {};
  let spent = 0;
  for (const kind of UPGRADE_KINDS) {
    const tier = up[kind] || 0;
    for (let t = 1; t <= tier; t++) spent += upgradeCost(kind, t);
  }
  return spent;
}

export function sellValue(S, typeId) {
  const car = CAR_TYPES[typeId];
  if (!car) return 0;
  return Math.round(car.price * SELL_FRACTION + upgradesSpent(S, typeId) * SELL_UPGRADE_FRACTION);
}

export function buyCar(S, typeId) {
  ensureState(S);
  const car = CAR_TYPES[typeId];
  if (!car) return { ok: false, error: 'unknown car' };
  if (S.ownedCars.includes(typeId)) return { ok: false, error: 'already owned' };
  if (S.cash < car.price) return { ok: false, error: `need $${car.price}` };
  S.cash -= car.price;
  S.ownedCars.push(typeId);
  if (!S.upgrades[typeId]) S.upgrades[typeId] = { engine: 0, armor: 0, handling: 0 };
  if (!S.currentCarType) S.currentCarType = typeId;
  saveProgress(S);
  return { ok: true, typeId, name: car.name, cash: S.cash };
}

export function upgradeCar(S, typeId, kind) {
  ensureState(S);
  const car = CAR_TYPES[typeId];
  if (!car) return { ok: false, error: 'unknown car' };
  if (!S.ownedCars.includes(typeId)) return { ok: false, error: 'buy the car first' };
  if (!UPGRADE_KINDS.includes(kind)) return { ok: false, error: 'unknown upgrade' };
  if (!S.upgrades[typeId]) S.upgrades[typeId] = { engine: 0, armor: 0, handling: 0 };
  const tier = S.upgrades[typeId][kind] || 0;
  if (tier >= MAX_UPGRADE_TIER) return { ok: false, error: kind + ' already maxed (tier 3)' };
  const cost = upgradeCost(kind, tier + 1);
  if (S.cash < cost) return { ok: false, error: `need $${cost}` };
  S.cash -= cost;
  S.upgrades[typeId][kind] = tier + 1;
  saveProgress(S);
  return { ok: true, typeId, kind, tier: tier + 1, cost, cash: S.cash };
}

export function sellCar(S, typeId) {
  ensureState(S);
  const car = CAR_TYPES[typeId];
  if (!car) return { ok: false, error: 'unknown car' };
  if (!S.ownedCars.includes(typeId)) return { ok: false, error: 'not owned' };
  const value = sellValue(S, typeId);
  S.cash += value;
  S.ownedCars = S.ownedCars.filter((c) => c !== typeId);
  delete S.upgrades[typeId];
  if (S.currentCarType === typeId) S.currentCarType = S.ownedCars[0] || null;
  saveProgress(S);
  return { ok: true, typeId, name: car.name, value, cash: S.cash };
}

/**
 * Effective car stats for the driving worker.
 * Rico (hired driver): +20% top speed during missions.
 * Engine upgrades: +10% top speed and +2 accel per tier.
 * Handling upgrades: +1 handling per tier (driving worker reads `handling`).
 * Armor upgrades: +25 max HP per tier (combat worker reads `armor`).
 */
export function carStats(S, typeId) {
  ensureState(S);
  const car = CAR_TYPES[typeId];
  if (!car) return null;
  const up = S.upgrades[typeId] || { engine: 0, armor: 0, handling: 0 };
  const engineTier = up.engine || 0;
  const inMission = !!S.mission;
  const ricoBonus = (inMission && S.crew.rico && S.crew.rico.hired) ? 1.2 : 1;
  const topSpeed = car.topSpeed * (1 + 0.1 * engineTier) * ricoBonus;
  return {
    ...car,
    topSpeed: Math.round(topSpeed * 10) / 10,
    accel: car.accel + 2 * engineTier,
    handling: 1 + 0.15 * (up.handling || 0),
    armor: up.armor || 0,
    maxHp: 100 + 25 * (up.armor || 0),
    tiers: { engine: engineTier, armor: up.armor || 0, handling: up.handling || 0 },
  };
}

// ------------------------------------------------------------ crew
export function hireCrew(S, id) {
  ensureState(S);
  const member = CREW[id];
  if (!member) return { ok: false, error: 'unknown crew member' };
  if (S.crew[id].hired) return { ok: false, error: member.name + ' already hired' };
  if (S.cash < member.price) return { ok: false, error: `need $${member.price}` };
  S.cash -= member.price;
  S.crew[id].hired = true;
  S.crew[id].level = 1; // hired crew start at level 1 (0 = not hired)
  saveProgress(S);
  return { ok: true, id, name: member.name, level: 1, cash: S.cash };
}

export function levelCrew(S, id) {
  ensureState(S);
  const member = CREW[id];
  if (!member) return { ok: false, error: 'unknown crew member' };
  if (!S.crew[id].hired) return { ok: false, error: 'hire ' + member.name + ' first' };
  const level = S.crew[id].level || 0;
  if (level >= CREW_MAX_LEVEL) return { ok: false, error: member.name + ' already max level 3' };
  const cost = CREW_LEVEL_COST(level + 1);
  if (S.cash < cost) return { ok: false, error: `need $${cost}` };
  S.cash -= cost;
  S.crew[id].level = level + 1;
  saveProgress(S);
  return { ok: true, id, name: member.name, level: level + 1, cost, cash: S.cash };
}

/** Ghost hacker bonus: +15s per level on timed missions. */
export function ghostTimeBonus(S) {
  ensureState(S);
  const g = S.crew.ghost;
  return g && g.hired ? 15 * (g.level || 0) : 0;
}

// ------------------------------------------------------------ weapons / shop
export function buyWeapon(S, weaponId) {
  ensureState(S);
  const w = WEAPONS[weaponId];
  if (!w) return { ok: false, error: 'unknown weapon' };
  if (weaponId === 'fists') return { ok: true, weaponId, note: 'fists are always owned' };

  // Already owned: buy an ammo pack instead.
  if (S.ownedWeapons.includes(weaponId)) {
    if (S.cash < w.ammoPrice) return { ok: false, error: `need $${w.ammoPrice} for ammo` };
    S.cash -= w.ammoPrice;
    S.ammo[weaponId] = (S.ammo[weaponId] || 0) + AMMO_PACK_SIZE;
    S.weapon = weaponId;
    saveProgress(S);
    return { ok: true, weaponId, ammo: true, ammoCount: S.ammo[weaponId], cash: S.cash };
  }

  if (S.cash < w.price) return { ok: false, error: `need $${w.price}` };
  S.cash -= w.price;
  S.ownedWeapons.push(weaponId);
  S.ammo[weaponId] = w.ammo; // first magazine included
  S.weapon = weaponId;
  saveProgress(S);
  return { ok: true, weaponId, name: w.name, ammoCount: S.ammo[weaponId], cash: S.cash };
}
