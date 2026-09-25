// Fixed-step, seeded Plinko physics. This exact module also runs on the game
// server when a finished drop is verified. The puck, not a preselected slot,
// determines the result. Keep arithmetic/order identical on both sides.
export const PLINKO_PHYSICS_VERSION = 1;
export const PHYSICS_STEP = 1 / 60;
export const PHYSICS_MAX_STEPS = 720;
export const PHYSICS_FLOOR = 88;
export const PHYSICS_LEFT = 3.5;
export const PHYSICS_RIGHT = 96.5;
export const PHYSICS_ROWS = 10;
export const PHYSICS_SLOTS = 11;
export const PHYSICS_TARGET_RETURN = 1.05;
const SLOT_WIDTH = 95 / PHYSICS_SLOTS;
const PUCK_RADIUS = 1.65;
const PEG_RADIUS = 1.15;
const CONTACT_RADIUS = PUCK_RADIUS + PEG_RADIUS;

export const physicsSlotCenter = (lane) => 2.5 + (lane + 0.5) * SLOT_WIDTH;
export const PLINKO_PHYSICS_PEGS = Array.from({ length: PHYSICS_ROWS }, (_, row) => {
  const offset = row % 2 === 0 ? SLOT_WIDTH / 2 : 0;
  const count = row % 2 === 0 ? PHYSICS_SLOTS : PHYSICS_SLOTS + 1;
  return Array.from({ length: count }, (_, column) => ({
    x: 2.5 + offset + column * SLOT_WIDTH,
    y: 16.5 + row * 6.3,
  }));
}).flat();

const random01 = (state) => {
  let next = state.value;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  state.value = next >>> 0;
  return state.value / 0x100000000;
};

export function createPlinkoPuck(seed, lane = 5) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isInteger(lane) || lane < 0 || lane > 10) {
    throw new Error('invalid_plinko_launch');
  }
  const rng = { value: seed || 0x9e3779b9 };
  const jitter = (random01(rng) - 0.5) * 6;
  const vx = (random01(rng) - 0.5) * 8;
  return { x: physicsSlotCenter(lane) + jitter, y: 5, vx, vy: 0, step: 0, collisions: 0, done: false, slot: null, rng };
}

export function stepPlinkoPuck(puck) {
  if (puck.done) return { impact: false, wall: false };
  let impact = false;
  let wall = false;
  const dt = PHYSICS_STEP;
  puck.vy = Math.min(90, puck.vy + 200 * dt);
  puck.vx *= 0.98;
  puck.x += puck.vx * dt;
  puck.y += puck.vy * dt;

  if (puck.x < PHYSICS_LEFT) {
    puck.x = PHYSICS_LEFT + (PHYSICS_LEFT - puck.x);
    puck.vx = Math.abs(puck.vx) * 0.73 + 2;
    wall = true;
  } else if (puck.x > PHYSICS_RIGHT) {
    puck.x = PHYSICS_RIGHT - (puck.x - PHYSICS_RIGHT);
    puck.vx = -Math.abs(puck.vx) * 0.73 - 2;
    wall = true;
  }

  for (const peg of PLINKO_PHYSICS_PEGS) {
    const dy = puck.y - peg.y;
    if (Math.abs(dy) >= CONTACT_RADIUS) continue;
    const dx = puck.x - peg.x;
    if (Math.abs(dx) >= CONTACT_RADIUS) continue;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= CONTACT_RADIUS * CONTACT_RADIUS) continue;
    const distance = Math.sqrt(distanceSquared) || 0.0001;
    const nx = dx / distance;
    const ny = dy / distance;
    const overlap = CONTACT_RADIUS - distance + 0.02;
    puck.x += nx * overlap;
    puck.y += ny * overlap;
    const toward = puck.vx * nx + puck.vy * ny;
    if (toward < 0) {
      puck.vx -= 1.62 * toward * nx;
      puck.vy -= 1.62 * toward * ny;
    }
    // Tiny physical imperfections make repeat drops diverge without choosing a
    // target bucket. This impulse is tied to a collision, not to a payout.
    const side = Math.abs(dx) < 0.35 ? (random01(puck.rng) < 0.5 ? -1 : 1) : Math.sign(dx);
    puck.vx += side * (4 + random01(puck.rng) * 3);
    puck.vy -= random01(puck.rng) * 0.5;
    puck.collisions += 1;
    impact = true;
  }

  puck.vx = Math.max(-13, Math.min(13, puck.vx));
  puck.step += 1;
  if (puck.y >= PHYSICS_FLOOR || puck.step >= PHYSICS_MAX_STEPS) {
    puck.y = PHYSICS_FLOOR;
    puck.x = Math.max(PHYSICS_LEFT, Math.min(PHYSICS_RIGHT, puck.x));
    puck.slot = Math.max(0, Math.min(10, Math.floor((puck.x - 2.5) / SLOT_WIDTH)));
    puck.done = true;
  }
  return { impact, wall };
}

export function simulatePlinko(seed, lane = 5) {
  const puck = createPlinkoPuck(seed, lane);
  while (!puck.done) stepPlinkoPuck(puck);
  return { slot: puck.slot, x: puck.x, steps: puck.step, collisions: puck.collisions };
}

// 10,000 deterministic physics drops per launch lane, sampled with independent
// 32-bit seeds. The observed distribution sets the visible paytable, keeping
// the free Snow Coin game roughly as generous as the previous version even
// though the real peg dynamics are not a binomial left/right walk.
const PHYSICS_LANE_COUNTS = [
  [3364,2460,1833,1231,768,344,0,0,0,0,0],
  [2870,2185,1828,1296,896,574,351,0,0,0,0],
  [2301,1735,1674,1401,1161,863,512,353,0,0,0],
  [1473,1409,1335,1478,1405,1144,871,555,330,0,0],
  [871,875,1179,1389,1412,1379,1160,880,537,318,0],
  [335,613,872,1100,1367,1495,1369,1159,825,570,295],
  [0,307,541,838,1111,1415,1445,1449,1195,835,864],
  [0,0,324,536,839,1193,1394,1443,1385,1419,1467],
  [0,0,0,315,527,859,1135,1355,1826,1722,2261],
  [0,0,0,0,353,557,882,1429,1842,2096,2841],
  [0,0,0,0,0,331,739,1286,1861,2423,3360],
];

const TOWER_BASE = {
  chill: [4, 2, 1.5, 1.2, 1, 0.7, 1, 1.2, 1.5, 2, 4],
  classic: [11.5, 4.6, 2.3, 1.4, 0.7, 0.5, 0.7, 1.4, 2.3, 4.6, 11.5],
  wild: [25, 10, 4, 1, 0.4, 0.2, 0.4, 1, 4, 10, 25],
};
const WIDE_BASE = {
  chill: [2, 1.5, 1.25, 1.1, 1, .85, 1, 1.1, 1.25, 1.5, 2],
  classic: [5, 2.5, 1.5, 1, .65, .45, .65, 1, 1.5, 2.5, 5],
  wild: [10, 4, 2, .8, .3, .15, .3, .8, 2, 4, 10],
};

export const physicsProbabilities = (lane) => PHYSICS_LANE_COUNTS[lane].map((count) => count / 10000);

export function physicsMultipliers(board, risk, lane = 5) {
  const base = (board === 'wide' ? WIDE_BASE : TOWER_BASE)[risk];
  if (!base || !Number.isInteger(lane) || lane < 0 || lane > 10) throw new Error('invalid_plinko_paytable');
  const chances = physicsProbabilities(board === 'wide' ? lane : 5);
  const expected = base.reduce((sum, value, index) => sum + value * chances[index], 0);
  return base.map((value) => Math.round(value * PHYSICS_TARGET_RETURN / expected * 100) / 100);
}
