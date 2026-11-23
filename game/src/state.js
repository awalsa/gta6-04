// state.js — localStorage save/load for ISLA BRASA 3D.
export const SAVE_KEY = 'isla-brasa-3d-save';
export const SAVE_VERSION = 1;

// Respect ranks (spec gap 6): Nobody -> Legend, 35,000 respect total,
// +5% mission payout per rank. Thresholds match config.js RESPECT_RANKS
// (economy.js respectRank(S) is the one the HUD/missions use).
export const RESPECT_RANKS = [
  { name: 'Nobody', at: 0 },
  { name: 'Hustler', at: 500 },
  { name: 'Street Boss', at: 2000 },
  { name: 'Kingpin', at: 8000 },
  { name: 'Legend', at: 35000 },
];

export function respectRank(respect) {
  let rank = RESPECT_RANKS[0];
  for (const r of RESPECT_RANKS) if (respect >= r.at) rank = r;
  return rank;
}

// +5% payout per rank above Nobody.
export function payoutMultiplier(respect) {
  const idx = RESPECT_RANKS.indexOf(respectRank(respect));
  return 1 + idx * 0.05;
}

export function defaultSave() {
  return {
    version: SAVE_VERSION,
    cash: 500,
    respect: 0,
    missionsDone: [],
    ownedCars: ['vela'],
    ownedVehicles: [], // owned bike ('bike') / boat ('boat') ids — Worker D
    upgrades: {}, // carId -> { engine: 0-3, armor: 0-3, handling: 0-3 }
    weapon: 'fists',
    ownedWeapons: ['fists'],
    ammo: {},
    outfits: ['street'], // Worker E: owned outfit ids
    equippedOutfit: 'street', // Worker E: outfit the player model wears
    crew: {
      rico: { hired: false, level: 0 },
      marta: { hired: false, level: 0 },
      ghost: { hired: false, level: 0 },
    },
    racesWon: [],
    orbsCollected: [], // Worker C: indices into config COLLECTIBLE_ORBS
    sideJobsDone: { taxi: 0, delivery: 0, orbs: 0, earned: 0 }, // Worker C
    properties: [], // Worker G: owned property ids ('safehouse' | 'shop' | 'nightclub')
    heistDone: false, // Worker F: true once The Brasa Heist pays out
    heistPartsPaid: {}, // Worker F: part number -> $ paid (never pays twice)
    savedAt: Date.now(),
  };
}

// Save the fields listed in the shared contract from state object S.
// Extra fields on S are ignored; missing fields fall back to defaults.
export function saveGame(S) {
  try {
    const save = {
      version: SAVE_VERSION,
      cash: S.cash ?? 500,
      respect: S.respect ?? 0,
      missionsDone: Array.isArray(S.missionsDone) ? [...S.missionsDone] : [],
      ownedCars: Array.isArray(S.ownedCars) ? [...S.ownedCars] : ['vela'],
      ownedVehicles: Array.isArray(S.ownedVehicles) ? [...S.ownedVehicles] : [],
      upgrades: S.upgrades ? JSON.parse(JSON.stringify(S.upgrades)) : {},
      weapon: S.weapon || 'fists',
      ownedWeapons: Array.isArray(S.ownedWeapons) ? [...S.ownedWeapons] : ['fists'],
      ammo: S.ammo ? JSON.parse(JSON.stringify(S.ammo)) : {},
      outfits: Array.isArray(S.outfits) ? [...S.outfits] : ['street'],
      equippedOutfit: S.equippedOutfit || 'street',
      crew: S.crew ? JSON.parse(JSON.stringify(S.crew)) : defaultSave().crew,
      racesWon: Array.isArray(S.racesWon) ? [...S.racesWon] : [],
      orbsCollected: Array.isArray(S.orbsCollected) ? [...S.orbsCollected] : [],
      sideJobsDone: S.sideJobsDone ? { ...defaultSave().sideJobsDone, ...S.sideJobsDone } : defaultSave().sideJobsDone,
      properties: Array.isArray(S.properties) ? [...S.properties] : [], // Worker G: owned properties persist
      heistDone: !!S.heistDone, // Worker F: heist completion persists
      heistPartsPaid: S.heistPartsPaid ? { ...S.heistPartsPaid } : {}, // Worker F: part payouts persist (no double-pay)
      savedAt: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch (err) {
    console.warn('[state] saveGame failed:', err);
    return false;
  }
}

// Returns a save object or null (no save / corrupt / wrong version).
export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw);
    if (!save || typeof save !== 'object') return null;
    // Merge over defaults so older saves missing a field still work.
    const merged = { ...defaultSave(), ...save };
    merged.crew = { ...defaultSave().crew, ...(save.crew || {}) };
    merged.ownedVehicles = Array.isArray(save.ownedVehicles) ? [...save.ownedVehicles] : [];
    merged.outfits = Array.isArray(save.outfits) ? [...save.outfits] : ['street'];
    if (!merged.outfits.includes('street')) merged.outfits.unshift('street');
    merged.equippedOutfit = (typeof save.equippedOutfit === 'string' && save.equippedOutfit) || 'street';
    merged.sideJobsDone = { ...defaultSave().sideJobsDone, ...(save.sideJobsDone || {}) };
    merged.properties = Array.isArray(save.properties) ? [...save.properties] : []; // Worker G: owned properties
    merged.heistDone = !!save.heistDone || (Array.isArray(save.missionsDone) && save.missionsDone.includes(13)); // Worker F
    merged.heistPartsPaid = (save.heistPartsPaid && typeof save.heistPartsPaid === 'object') ? { ...save.heistPartsPaid } : {}; // Worker F
    merged.orbsCollected = Array.isArray(save.orbsCollected) ? [...save.orbsCollected] : [];
    for (const k of ['rico', 'marta', 'ghost']) {
      merged.crew[k] = { ...defaultSave().crew[k], ...(save.crew?.[k] || {}) };
    }
    return merged;
  } catch (err) {
    console.warn('[state] loadGame failed:', err);
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
