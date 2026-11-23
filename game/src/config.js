// ISLA BRASA 3D — data tables (Worker D: progression)
// Built from the round-4 mission spec + design spec only.
// Y-up, ground XZ. Landmark coordinates are the GAMEPLAY target point for
// a place: the approachable entrance, NOT the building centre. The arcade
// (0,0) and plaza (80,80) already follow this (their buildings sit offset
// from the point). Casino/garage/church used to be the building centres,
// which sit inside solid colliders, so radius-6 goto/deliver/race/side-job
// targets there were unreachable (casino: nearest standable point 9.5u) or
// exactly at threshold (garage/church: 6.0u). Their points are the doors.
export const LANDMARKS = {
  market:    { x: -120, z: -80,  label: 'Feria Market' },
  pier:      { x: -180, z: 120,  label: 'Old Pier' },
  marina:    { x: -160, z: -160, label: 'Marina Docks' },
  garage:    { x: 60,   z: -113, label: 'Brasa Garage' },
  arcade:    { x: 0,    z: 0,    label: 'Rook Arcade' },
  casino:    { x: 120,  z: -50,  label: 'Coral Room Casino' },
  tunnel:    { x: 150,  z: 100,  label: 'Coast Tunnel' },
  motel:     { x: -60,  z: 140,  label: 'Motel Vela' },
  underpass: { x: 100,  z: 40,   label: 'Underpass' },
  church:    { x: -40,  z: -132, label: 'Old Church' },
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

// ---------------------------------------------------------------- the heist (Worker F)
// Mission 13 — the biggest score in the game. Three parts, one chain:
//   Part 1 "Getaway Car" ($250): steal the getaway car at the Coast Tunnel
//     and park it at Rook Arcade.
//   Part 2 "Crew & Gear" ($250): grab 3 gear crates at the Marina Docks.
//     Having a hired crew member helps — Marta fights beside you in part 3
//     (see missions.js startHeist) — and the heist unlocks early once you
//     have hired at least 1 crew member.
//   Part 3 "The Vault" ($4,500, timed 240 s): clear 6 vault guards at the
//     Coral Room Casino, grab 4 vault cases, then escape to the Beachfront
//     while the heat rises (wanted climbs during the escape).
// Total payout $5,000 exactly: parts 1+2 pay $250 each on completion of
// their part, part 3 pays the remaining $4,500 on completion.
// Unlock: all 12 main missions done, OR at least 1 crew member hired.
export const HEIST = {
  id: 13, name: 'The Brasa Heist', payout: 5000,
  brief: 'The big one: steal a getaway car, gear up with your crew, hit the Coral Room vault and escape to the beach. $5,000 — the biggest score on Isla Brasa.',
  parts: [
    { part: 1, name: 'Getaway Car', payout: 250 },
    { part: 2, name: 'Crew & Gear', payout: 250 },
    { part: 3, name: 'The Vault', payout: 4500 },
  ],
  steps: [
    { kind: 'steal',   at: 'tunnel', part: 1, label: 'Steal the getaway car at the Coast Tunnel' },
    { kind: 'deliver', at: 'arcade', part: 1, label: 'Park the getaway car at Rook Arcade' },
    { kind: 'collect', at: 'marina', count: 3, part: 2, label: 'Grab 3 gear crates at the Marina' },
    { kind: 'clear',   at: 'casino', count: 6, part: 3, label: 'Clear 6 vault guards' },
    { kind: 'collect', at: 'casino', count: 4, part: 3, label: 'Grab 4 vault cases' },
    { kind: 'deliver', at: 'beach',  part: 3, label: 'Escape to the Beachfront — lose the cops!' },
  ],
};
export const HEIST_TOTAL_PAYOUT = 5000; // parts 1+2 ($250 each) + part 3 ($4,500)
export const HEIST_PART3_TIME = 240; // seconds on the clock once the vault job starts

// ---------------------------------------------------------------- the plane (Worker F)
// Brasa Air: a small prop plane parked on the Brasa Airfield runway — a
// flat strip along the south road (z = 160, x from -20 to 100, heading
// east). Takeoff speed 22 u/s; W/S throttle, A/D roll/turn, ArrowUp/Down
// pitch. Rough landings damage the plane (and the player) but never fail
// the flight outright.
export const PLANE = {
  id: 'brasa-air', name: 'Brasa Air', kind: 'plane', price: 0,
  takeoffSpeed: 22, maxSpeed: 55, stallSpeed: 14, accel: 10,
  climbRate: 12, maxPitch: 0.5, maxBank: 0.9, turnRate: 0.9,
  handling: 1.0, hp: 100,
};
export const RUNWAY = {
  x: 40, z: 160, heading: Math.PI / 2, // east-west strip, heading east (+x)
  length: 120, width: 12,
  planeSpot: { x: 20, z: 160, yaw: Math.PI / 2 }, // parked plane, nose east
  windsock: { x: 106, z: 150 },
  label: 'Brasa Airfield',
};

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
  bike:   { id: 'bike',   name: 'Brisa Bike',   kind: 'bike', price: 1500,  topSpeed: 52, accel: 22 },
  boat:   { id: 'boat',   name: 'Marina Skiff', kind: 'boat', price: 4500,  topSpeed: 34, accel: 14 },
};

// ---------------------------------------------------------------- vehicles
// Bike: fastest top speed in the game, but twitchy (see cars.js moveBike).
// Boat: drives on the water strips (west x < -170, south z > 170).
export const BIKE = { id: 'bike', name: 'Brisa Bike', kind: 'bike', price: 1500, topSpeed: 52, accel: 22, handling: 1.6 };
export const BOAT = { id: 'boat', name: 'Marina Skiff', kind: 'boat', price: 4500, topSpeed: 34, accel: 14, handling: 0.8 };

// ---------------------------------------------------------------- traffic
// Ambient traffic (traffic.js): how many cars cruise the road grid, how
// fast, and how far from the camera a car may get before it respawns.
export const TRAFFIC = {
  count: 8,
  cruiseSpeed: 12,
  maxSpeed: 16,
  yieldDistance: 14, // slow when the player is this far ahead
  stopDistance: 5,   // full stop when the player is this close ahead
  respawnDistance: 130, // teleport to a fresh road node beyond this range
  respawnMinDistance: 60, // ...but never closer than this to the camera
  types: ['vela', 'brasa', 'coyote', 'cometa'],
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

// ---------------------------------------------------------------- pedestrians + particles (Worker B)
// Ambient crowd + FX budgets. Pedestrians are ambient only (never block
// missions); particles are capped so the frame budget stays small.
export const PEDESTRIAN_COUNT = 16;
export const PEDESTRIAN_FLEE_RADIUS = 18;
export const PEDESTRIAN_CAR_FLEE_RADIUS = 12;
export const PEDESTRIAN_SPRINT_FLEE_RADIUS = 3;
export const PARTICLE_MAX = 400;
export const PARTICLE_EXPLOSION_COUNT = 50;

// ---------------------------------------------------------------- dialogue (Worker C)
// Mission intro + completion lines. Keyed by mission id.
// `done` is the one completion line shown when the mission is finished.
export const DIALOGUE = {
  1: { speaker: 'Rook', lines: [
    'Listen up. Tamale crates at Feria Market, Old Pier by nightfall.',
    'Keep it quiet — Delgado\'s boys are sniffing around the stalls.',
    'You drop the crates, you get paid. Simple. Don\'t make it complicated.',
  ], done: { speaker: 'Rook', lines: ['Clean run. The pier crew sends their regards — and your cut.'] } },
  2: { speaker: 'Rico', lines: [
    'There\'s a courier car sitting at the Marina, keys practically in it.',
    'Bring it to the garage in one piece. No police, no scratches.',
  ], done: { speaker: 'Rico', lines: ['She purrs like a kitten. Garage is happy, I\'m happy.'] } },
  3: { speaker: 'Marta', lines: [
    'Delgado\'s men are shaking down my auntie\'s stall at the market.',
    'Clear them out, grab the cash, and take one of their cars on the way out.',
  ], done: { speaker: 'Marta', lines: ['The market breathes again. Tell Rook the cash is counted.'] } },
  4: { speaker: 'Ghost', lines: [
    'Coral Room Casino. Cameras loop in ninety seconds — that\'s your window.',
    'Grab the chip cases, then vanish into the Coast Tunnel. One-fifty on the clock.',
  ], done: { speaker: 'Ghost', lines: ['Cameras never saw a thing. Beautiful work.'] } },
  5: { speaker: 'Rook', lines: [
    'Four drops, one night: pier, motel, underpass, church.',
    'Then come back to the arcade and report. No shortcuts, no excuses.',
  ], done: { speaker: 'Rook', lines: ['All four drops landed. You\'re becoming reliable. I like reliable.'] } },
  6: { speaker: 'Rico', lines: [
    'Hot plates from the market — beach first, then the plaza. Sun\'s coming up.',
    'One-twenty on the clock. Drive like the food\'s still warm, because it is.',
  ], done: { speaker: 'Rico', lines: ['Delivered hot, both stops. The plaza crowd loves you already.'] } },
  7: { speaker: 'Ghost', lines: [
    'Rival crew left a courier car at the marina. Ninety seconds, plaza tower, lunch rush.',
    'Their menu, our table. Go.',
  ], done: { speaker: 'Ghost', lines: ['Menu delivered before dessert. The rival crew is furious. Perfect.'] } },
  8: { speaker: 'Marta', lines: [
    'Crates piling up at the pier and Delgado\'s crew is sitting on them.',
    'Clear the guards, grab the crates, stash them at the church. Quietly, if you can.',
  ], done: { speaker: 'Marta', lines: ['Crates are safe behind the altar. Even Delgado won\'t look there.'] } },
  9: { speaker: 'Rook', lines: [
    'A snitch is holed up at Motel Vela with our ledger.',
    'Get close, grab the ledger, deal with his guards, and slip away to me.',
  ], done: { speaker: 'Rook', lines: ['Ledger\'s back where it belongs. The snitch won\'t be talking to anyone.'] } },
  10: { speaker: 'Rico', lines: [
    'Roadblocks everywhere tonight. The Coast Tunnel is the only way through.',
    'Take a fast car, thread the tunnel, marina then beach. Don\'t stop for anything.',
  ], done: { speaker: 'Rico', lines: ['You threaded it like a needle. Tunnel\'s ours tonight.'] } },
  11: { speaker: 'Ghost', lines: [
    'The Coral Room is moving chips again. Hit the floor, take the cases.',
    'Reinforcements will come at the plaza — be ready for them.',
  ], done: { speaker: 'Ghost', lines: ['Chips secured, plaza held. The house always loses — to us.'] } },
  12: { speaker: 'Rook', lines: [
    'The Big One. Vault cash at the casino, guards, a getaway car, a tail at the beach.',
    'Four minutes. Then you meet me at the arcade — and Isla Brasa is ours.',
  ], done: { speaker: 'Rook', lines: ['That\'s it. That\'s the whole island. Legend of Isla Brasa — you earned it.'] } },
  13: { speaker: 'Rook', lines: [
    'The Brasa Heist. Five grand — the biggest score this island has ever seen.',
    'First: a getaway car from the Coast Tunnel. Then gear from the Marina. Then the vault.',
    'The vault job runs on a four-minute clock, and the whole island will be chasing you on the way out.',
  ], done: { speaker: 'Rook', lines: ['Five thousand. Clean. You just pulled the biggest heist in Isla Brasa history.'] } },
};

// ---------------------------------------------------------------- side jobs (Worker C)
// Repeatable side activities. Taxi $120, delivery $100 on time
// ($50 if late, inside a 60s grace window), collectible orb $50 each.
export const SIDE_JOBS = {
  taxi: { kind: 'taxi', payout: 120, radius: 6, label: 'Taxi Fare' },
  delivery: { kind: 'delivery', payout: 100, latePayout: 50, timeLimit: 90, lateGrace: 60, radius: 6, label: 'Courier Run' },
  orb: { kind: 'orb', payout: 50, radius: 2.5, count: 10, label: 'Hidden Orb' },
};

// 10 hidden glowing orbs, fixed positions near landmarks / beach / rooftops.
// y is the orb height; collection checks horizontal distance + |dy| < 3.
export const COLLECTIBLE_ORBS = [
  { x: -108, z: -72,  y: 1.5, near: 'market' },
  { x: -180, z: 132,  y: 1.5, near: 'pier' },
  { x: -150, z: -150, y: 1.5, near: 'marina' },
  { x: 66,   z: -108, y: 2.5, near: 'garage' },
  { x: 8,    z: 6,    y: 2.5, near: 'arcade' },
  { x: 132,  z: -48,  y: 1.5, near: 'casino' },
  { x: 150,  z: 112,  y: 1.5, near: 'tunnel' },
  { x: -48,  z: 148,  y: 1.5, near: 'motel' },
  { x: -40,  z: -128, y: 1.5, near: 'church' },
  { x: 12,   z: 180,  y: 1.5, near: 'beach' },
];

// ISLA BRASA 3D — recorded agent authorship touch (2026-11-23)

// ---------------------------------------------------------------- audio + day/night (Worker A)
// DAY_LENGTH_SEC: one full day/night cycle, in real seconds (6 in-game min).
// DAY_START: S.timeOfDay at boot (0..1; 0.30 = 07:12, morning).
export const DAY_LENGTH_SEC = 360;
export const DAY_START = 0.30;
export const AUDIO = {
  musicVolume: 0.5, // music bus gain inside audio.js
  sfxVolume: 0.9,   // sfx bus gain inside audio.js
  engineVolume: 0.12, // engine hum gain at full speed
  muted: false,     // default mute state (persisted in localStorage)
};

// ---------------------------------------------------------------- radio (Worker E)
// Three in-car stations, all synthesised WebAudio loops (no audio files).
// tempo in BPM; root in Hz; scale = semitone offsets from the root;
// bass = 8th-note steps (0-15) where the bass plays; roots = per-bar
// semitone offsets (4 bars); lead = arp pattern (scale degrees, -1 = rest);
// drums picks the kit pattern ('latin' | 'boom-bap' | 'rock').
export const RADIO_STATIONS = [
  {
    id: 'brasa', name: 'Radio Brasa', mood: 'latin', tempo: 132,
    root: 110.0, scale: [0, 2, 3, 5, 7, 8, 10], bass: [0, 3, 6, 8, 11, 14],
    roots: [0, 0, -4, 5], lead: [0, 2, 4, 5, 4, 2, 5, 6, 4, 2, 1, 2, 4, 5, 6, 4],
    wave: 'triangle', leadWave: 'square', drums: 'latin',
  },
  {
    id: 'isla95', name: 'Isla 95 FM', mood: 'hip-hop', tempo: 88,
    root: 55.0, scale: [0, 3, 5, 7, 10], bass: [0, 7, 10],
    roots: [0, 0, -2, 3], lead: [0, -1, 2, -1, 1, -1, 3, -1, 2, -1, 0, -1, 4, 3, -1, -1],
    wave: 'sine', leadWave: 'sawtooth', drums: 'boom-bap',
  },
  {
    id: 'coast', name: 'Coast Rock', mood: 'rock', tempo: 140,
    root: 82.41, scale: [0, 2, 3, 5, 7, 10], bass: [0, 2, 4, 6, 8, 10, 12, 14],
    roots: [0, -4, -2, 5], lead: [0, 2, 4, 5, 4, 2, 0, 2, 4, 5, 6, 5, 4, 2, 1, 0],
    wave: 'square', leadWave: 'sawtooth', drums: 'rock',
  },
];

// ---------------------------------------------------------------- clothes (Worker E)
// Outfits recolour the player model (shirt / pants / skin / hair hex).
// 'street' is the free default outfit every save starts with.
export const CLOTHES = {
  street: { id: 'street', name: 'Street', price: 0, shirt: 0x2e8b57, pants: 0x2b3a55, skin: 0xc98d5f, hair: 0x1a1210 },
  vice:   { id: 'vice',   name: 'Vice',   price: 800,  shirt: 0xff5fa2, pants: 0xf2f2f2, skin: 0xd9a066, hair: 0x2b2b2b },
  racer:  { id: 'racer',  name: 'Racer',  price: 1500, shirt: 0xd23c2a, pants: 0x111111, skin: 0xc98d5f, hair: 0x111111 },
  boss:   { id: 'boss',   name: 'Boss',   price: 4000, shirt: 0x1a1a1a, pants: 0x1a1a1a, skin: 0xe8b88a, hair: 0xdddddd },
};

// ---------------------------------------------------------------- extra weapons (Worker E)
// Ammu-Nation exclusives: beyond the wheel's 5 base weapons. High prices,
// distinct stats; they join the weapon wheel + combat once owned.
export const EXTRA_WEAPONS = {
  sniper: { id: 'sniper', name: 'Sniper Rifle', dmg: 120, range: 120, rate: 0.7, price: 6000, ammoPrice: 300, ammo: 5, auto: false },
  rpg:    { id: 'rpg',    name: 'RPG',          dmg: 150, range: 50,  rate: 0.5, price: 9000, ammoPrice: 500, ammo: 3, auto: false },
};

// ---------------------------------------------------------------- shops (Worker E)
// Shop doors: clothes at the plaza, weapons at the underpass. Open with E
// while standing near the door (and not next to a car).
export const SHOP_POSITIONS = {
  clothes: { x: 70, z: 92, label: 'Brasa Threads — Clothes' },
  weapons: { x: 112, z: 48, label: 'Ammu-Nation — Weapons' },
};

// ---------------------------------------------------------------- weather (Worker E)
// Rain rolls in at random every few minutes, lasts 1-2 minutes, and is
// cosmetic + handling only — no mission is ever locked to weather.
export const WEATHER = {
  rainChanceIntervalMin: 150, // seconds between rain rolls (min)
  rainChanceIntervalMax: 300, // seconds between rain rolls (max)
  rainDurationMin: 60,        // rain lasts at least 60s
  rainDurationMax: 120,       // rain lasts at most 120s
  gripMultiplier: 0.75,       // car grip while raining (25% less)
  topSpeedMultiplier: 0.95,   // top speed while raining
};

// ---------------------------------------------------------------- casino (Worker G)
// Coral Room Casino (120,-60). Buy-ins / payouts for the 3 mini-games in
// casino.js; economy.casinoBet/casinoPayout move the money on S.cash.
export const CASINO = {
  slotsCost: 20,
  slotsJackpot: 500,   // three 7s
  slotsThreeKind: 100, // any other three of a kind
  slotsTwoKind: 40,    // any pair
  slotsSymbols: ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'],
  blackjackBet: 50,    // per hand; win pays 2x, blackjack pays 3:2 (2.5x total)
  rouletteBets: [25, 50, 100], // bet red/black, win pays 2x
  rouletteRed: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36],
};

// ---------------------------------------------------------------- properties (Worker G)
// Buyable properties: one-time price, then passive income every in-game
// day (paid at the day/night rollover, see properties.js). `at` is the
// map/marker position; `door` is the walk-up door for the safehouse interior.
export const PROPERTIES = {
  safehouse: { id: 'safehouse', name: 'Safehouse — Motel Vela', price: 5000, dailyIncome: 100, at: { x: -60, z: 140 }, door: { x: -60, z: 144.5 }, desc: 'A quiet room at Motel Vela. Sleep here to save. +$100/day.' },
  shop:      { id: 'shop',      name: 'Corner Shop — Feria Market', price: 12000, dailyIncome: 300, at: { x: -120, z: -80 }, door: null, desc: 'A market stall that sells while you sleep. +$300/day.' },
  nightclub: { id: 'nightclub', name: 'Nightclub — Plaza Tower', price: 25000, dailyIncome: 800, at: { x: 80, z: 80 }, door: null, desc: 'The hottest floor on the plaza. +$800/day.' },
};

// ---------------------------------------------------------------- interiors (Worker G)
// Enterable buildings: E at the door walks the player inside a walled room
// (built by interiors.js at `room`); E inside (or the HUD button) exits
// back to `door`. `sleep` marks the safehouse (sleeping there saves).
export const INTERIORS = {
  garage:    { id: 'garage',    name: 'Brasa Garage',        door: { x: 60,  z: -113 }, room: { x: 185, z: -185 }, sleep: false },
  casino:    { id: 'casino',    name: 'Coral Room Casino',   door: { x: 120, z: -50 },  room: { x: 185, z: 185 },  sleep: false },
  safehouse: { id: 'safehouse', name: 'Safehouse — Motel Vela', door: { x: -60, z: 144.5 }, room: { x: -185, z: 185 }, sleep: true },
};
