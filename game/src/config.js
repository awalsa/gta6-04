// ISLA BRASA 3D — data tables (Worker D: progression)
// Built from the round-4 mission spec + design spec only.
// Y-up, ground XZ. Landmark coordinates are FIXED — do not change them.

// ---------------------------------------------------------------- landmarks
export const LANDMARKS = {
  market:    { x: -120, z: -80,  label: 'Feria Market' },
  pier:      { x: -180, z: 120,  label: 'Old Pier' },
  marina:    { x: -160, z: -160, label: 'Marina Docks' },
  garage:    { x: 60,   z: -120, label: 'Brasa Garage' },
  arcade:    { x: 0,    z: 0,    label: 'Rook Arcade' },
  casino:    { x: 120,  z: -60,  label: 'Coral Room Casino' },
  tunnel:    { x: 150,  z: 100,  label: 'Coast Tunnel' },
  motel:     { x: -60,  z: 140,  label: 'Motel Vela' },
  underpass: { x: 100,  z: 40,   label: 'Underpass' },
  church:    { x: -40,  z: -140, label: 'Old Church' },
  plaza:     { x: 80,   z: 80,   label: 'Plaza Tower' },
  beach:     { x: 0,    z: 180,  label: 'Beachfront' },
};

// ---------------------------------------------------------------- missions
// Step kinds: goto | collect {count} | clear {count} | steal | deliver.
// `timed` is a total mission countdown in seconds (generous by design).
// Missions auto-unlock in order: next = missionsDone.length + 1.
export const MISSIONS = [
  {
    id: 1, name: 'Tamale Run', payout: 740,
    brief: 'Pick up the tamale crates at Feria Market and drop them at the Old Pier. Keep it quiet.',
    steps: [
      { kind: 'goto',    at: 'market', label: 'Pick up the crates' },
      { kind: 'collect', at: 'market', count: 3, label: 'Load 3 crates' },
      { kind: 'deliver', at: 'pier',   label: 'Deliver to the Old Pier' },
    ],
  },
  {
    id: 2, name: 'The Vela Job', payout: 800,
    brief: 'A courier car is waiting at the Marina. Take it and bring it to the garage — no police.',
    steps: [
      { kind: 'goto',   at: 'marina', label: 'Reach the Marina Docks' },
      { kind: 'steal',  at: 'marina', label: 'Take the courier car' },
      { kind: 'deliver', at: 'garage', label: 'Park it at Brasa Garage' },
    ],
  },
  {
    id: 3, name: 'Feria Shakedown', payout: 990,
    brief: "Delgado's men are shaking down the market stalls. Clear them out, grab the cash, and take a getaway car.",
    steps: [
      { kind: 'clear',   at: 'market', count: 5, label: "Clear 5 of Delgado's men" },
      { kind: 'collect', at: 'market', count: 2, label: 'Collect the cash' },
      { kind: 'steal',   at: 'market', label: 'Take a getaway car' },
      { kind: 'deliver', at: 'arcade', label: 'Bring it to Rook Arcade' },
    ],
  },
  {
    id: 4, name: 'Coral Room Getaway', payout: 1300, timed: 150,
    brief: 'Hit the Coral Room Casino, grab the chips, and lose the cops in the Coast Tunnel. 150 seconds.',
    steps: [
      { kind: 'goto',    at: 'casino', label: 'Reach the casino' },
      { kind: 'collect', at: 'casino', count: 3, label: 'Grab 3 chip cases' },
      { kind: 'deliver', at: 'tunnel', label: 'Escape to the Coast Tunnel' },
    ],
  },
  {
    id: 5, name: 'Last Call', payout: 850,
    brief: 'Four drops, one night: the pier, the motel, the underpass and the church. Then report back to Rook.',
    steps: [
      { kind: 'deliver', at: 'pier',      label: 'Drop 1: Old Pier' },
      { kind: 'deliver', at: 'motel',     label: 'Drop 2: Motel Vela' },
      { kind: 'deliver', at: 'underpass', label: 'Drop 3: Underpass' },
      { kind: 'deliver', at: 'church',    label: 'Drop 4: Old Church' },
      { kind: 'goto',    at: 'arcade',    label: 'Report to Rook Arcade' },
    ],
  },
  {
    id: 6, name: 'Dawn Dash', payout: 880, timed: 120,
    brief: 'Rush delivery: hot plates from the market to the beach AND the plaza before the sun is up. 120 seconds.',
    steps: [
      { kind: 'collect', at: 'market', count: 2, label: 'Pick up the plates' },
      { kind: 'deliver', at: 'beach',  label: 'Deliver to the Beachfront' },
      { kind: 'deliver', at: 'plaza',  label: 'Deliver to Plaza Tower' },
    ],
  },
  {
    id: 7, name: 'Hot Plate', payout: 860, timed: 90,
    brief: "A rival crew's courier car is waiting at the marina. Take it and get the plaza tower menu there by lunch. 90 seconds.",
    steps: [
      { kind: 'steal',   at: 'marina', label: 'Take the courier car' },
      { kind: 'deliver', at: 'plaza',  label: 'Deliver to Plaza Tower' },
    ],
  },
  {
    id: 8, name: 'Pier Pressure', payout: 750,
    brief: "Crates are piling up at the pier and Delgado's crew is guarding them. Clear the crew, grab the crates, stash them at the church.",
    steps: [
      { kind: 'clear',   at: 'pier',   count: 3, label: 'Clear 3 guards' },
      { kind: 'collect', at: 'pier',   count: 5, label: 'Collect 5 crates' },
      { kind: 'deliver', at: 'church', label: 'Stash them at the Old Church' },
    ],
  },
  {
    id: 9, name: 'Motel Stakeout', payout: 800,
    brief: 'A snitch is holed up at Motel Vela. Get close, grab the ledger, deal with his guards, and slip away to Rook.',
    steps: [
      { kind: 'goto',    at: 'motel',  label: 'Reach Motel Vela' },
      { kind: 'collect', at: 'motel',  count: 1, label: 'Grab the ledger' },
      { kind: 'clear',   at: 'motel',  count: 2, label: 'Deal with 2 guards' },
      { kind: 'deliver', at: 'arcade', label: 'Bring it to Rook Arcade' },
    ],
  },
  {
    id: 10, name: 'Tunnel Run', payout: 820,
    brief: 'The Coast Tunnel is the only way past the roadblocks tonight. Take a fast car, thread the tunnel, and hit the marina then the beach.',
    steps: [
      { kind: 'steal',   at: 'tunnel', label: 'Take a fast car' },
      { kind: 'deliver', at: 'marina', label: 'Drop 1: Marina Docks' },
      { kind: 'deliver', at: 'beach',  label: 'Drop 2: Beachfront' },
    ],
  },
  {
    id: 11, name: 'Casino Chips', payout: 850,
    brief: 'The Coral Room is moving chips. Hit the casino floor, take the cases, then fight off the reinforcements at the plaza and keep the cut.',
    steps: [
      { kind: 'clear',   at: 'casino', count: 5, label: 'Clear 5 guards' },
      { kind: 'collect', at: 'casino', count: 3, label: 'Take 3 chip cases' },
      { kind: 'clear',   at: 'plaza',  count: 3, label: 'Fight off 3 reinforcements' },
      { kind: 'deliver', at: 'plaza',  label: 'Keep the cut at Plaza Tower' },
    ],
  },
  {
    id: 12, name: 'The Big One', payout: 870, timed: 240,
    brief: 'The final heist: lift the vault cash at the casino, clear the guards, take the getaway car, shake the tail at the beach, and meet Rook. 240 seconds.',
    steps: [
      { kind: 'goto',    at: 'casino', label: 'Reach the casino' },
      { kind: 'clear',   at: 'casino', count: 4, label: 'Clear 4 guards' },
      { kind: 'collect', at: 'casino', count: 3, label: 'Grab 3 vault cases' },
      { kind: 'steal',   at: 'casino', label: 'Take the getaway car' },
      { kind: 'deliver', at: 'beach',  label: 'Shake the tail at the Beachfront' },
      { kind: 'goto',    at: 'arcade', label: 'Meet Rook and finish' },
    ],
  },
];

export const MISSION_TOTAL = MISSIONS.reduce((sum, m) => sum + m.payout, 0); // 10510

// ---------------------------------------------------------------- races
// checkpoints are LANDMARKS keys, in order. Start a race near the first
// checkpoint (within 15 units) with R; beat timeLimit to win prize + respect.
export const RACES = [
  {
    id: 1, name: 'Malecon Sprint', prize: 400, timeLimit: 75,
    checkpoints: ['marina', 'plaza', 'market', 'beach'],
  },
  {
    id: 2, name: 'Old Town Circuit', prize: 550, timeLimit: 90,
    checkpoints: ['arcade', 'church', 'market', 'underpass', 'arcade'],
  },
  {
    id: 3, name: 'Beachfront Dash', prize: 700, timeLimit: 80,
    checkpoints: ['beach', 'tunnel', 'garage', 'marina', 'beach'],
  },
];

// ---------------------------------------------------------------- weapons
// dmg = damage per hit, range in world units, rate = shots/hits per second.
// price = buy cost (fists are free / always owned); ammoPrice = one ammo pack.
export const WEAPONS = {
  fists:   { id: 'fists',   name: 'Fists',   dmg: 10, range: 2,  rate: 2, price: 0,    ammoPrice: 0,   ammo: Infinity },
  pistol:  { id: 'pistol',  name: 'Pistol',  dmg: 25, range: 30, rate: 3, price: 500,  ammoPrice: 50,  ammo: 12 },
  smg:     { id: 'smg',     name: 'SMG',     dmg: 15, range: 25, rate: 8, price: 1500, ammoPrice: 120, ammo: 30 },
  shotgun: { id: 'shotgun', name: 'Shotgun', dmg: 60, range: 12, rate: 1, price: 2000, ammoPrice: 150, ammo: 6 },
  rifle:   { id: 'rifle',   name: 'Rifle',   dmg: 40, range: 60, rate: 2, price: 3500, ammoPrice: 200, ammo: 10 },
};

// ---------------------------------------------------------------- cars
// topSpeed / accel are in game units; effective values come from
// economy.carStats() (Rico +20% in missions, engine upgrades +10%/tier).
export const CAR_TYPES = {
  vela:   { id: 'vela',   name: 'Vela',     kind: 'sedan',    price: 2800,  topSpeed: 28, accel: 12 },
  brasa:  { id: 'brasa',  name: 'Brasa GT', kind: 'sports',   price: 6500,  topSpeed: 38, accel: 18 },
  coyote: { id: 'coyote', name: 'Coyote',   kind: 'truck',    price: 4200,  topSpeed: 26, accel: 10 },
  cometa: { id: 'cometa', name: 'Cometa',   kind: 'supercar', price: 12000, topSpeed: 46, accel: 24 },
};

// ---------------------------------------------------------------- crew
// hire price; level-up cost = 750 x new level (max level 3).
// Effects: Rico = fast getaway car spawns on missions (+20% top speed in
// missions); Marta = ally NPC fights beside you on missions;
// Ghost = +15s per level on timed missions.
export const CREW = {
  rico:  { id: 'rico',  name: 'Rico Vega',   role: 'driver', price: 1500 },
  marta: { id: 'marta', name: 'Marta Solis', role: 'gunman', price: 2000 },
  ghost: { id: 'ghost', name: 'Ghost',       role: 'hacker', price: 2500 },
};

export const CREW_MAX_LEVEL = 3;
export const CREW_LEVEL_COST = (newLevel) => 750 * newLevel; // 750 / 1500 / 2250

// ---------------------------------------------------------------- respect
// +5% mission payout per rank index (index 0 = Nobody, no bonus).
export const RESPECT_RANKS = [
  { name: 'Nobody',     min: 0,     respect: 0 },
  { name: 'Hustler',    min: 500,   respect: 500 },
  { name: 'Street Boss', min: 2000,  respect: 2000 },
  { name: 'Kingpin',    min: 8000,  respect: 8000 },
  { name: 'Legend',     min: 35000, respect: 35000 },
];

export const RESPECT_PAYOUT_BONUS_PER_RANK = 0.05;
