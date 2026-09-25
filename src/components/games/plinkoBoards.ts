export type PlinkoBoard = 'tower' | 'wide';
export type PlinkoRisk = 'chill' | 'classic' | 'wild';

export const PLINKO_ROWS = 10;
export const PLINKO_SLOTS = PLINKO_ROWS + 1;
export const PLINKO_CENTER_LANE = 5;
export const PLINKO_TARGET_RETURN = 1.05;

// The wide board is a reflected random walk. A player can move the dropper,
// but its displayed paytable is normalized for that lane so aiming at an edge
// cannot silently multiply the expected Snow Coin return.
const WIDE_BASE: Record<PlinkoRisk, number[]> = {
  chill: [2, 1.5, 1.25, 1.1, 1, .85, 1, 1.1, 1.25, 1.5, 2],
  classic: [5, 2.5, 1.5, 1, .65, .45, .65, 1, 1.5, 2.5, 5],
  wild: [10, 4, 2, .8, .3, .15, .3, .8, 2, 4, 10],
};

export const plinkoSlotCenter = (slot: number) => 2.5 + (slot + .5) * (95 / PLINKO_SLOTS);

export const reflectPlinkoPath = (decisions: readonly boolean[], startLane: number): boolean[] => {
  let halfLane = startLane * 2;
  return decisions.map((right) => {
    const next = halfLane + (right ? 1 : -1);
    const actualRight = next < 0 ? true : next > PLINKO_ROWS * 2 ? false : right;
    halfLane += actualRight ? 1 : -1;
    return actualRight;
  });
};

export const plinkoSlotFromPath = (path: readonly boolean[], startLane: number) =>
  startLane + path.reduce((sum, right) => sum + (right ? 1 : -1), 0) / 2;

export const widePlinkoProbabilities = (startLane: number): number[] => {
  let positions = Array.from({ length: PLINKO_ROWS * 2 + 1 }, (_, halfLane) => Number(halfLane === startLane * 2));
  for (let row = 0; row < PLINKO_ROWS; row += 1) {
    const next = positions.map(() => 0);
    positions.forEach((chance, halfLane) => {
      if (!chance) return;
      next[halfLane === 0 ? 1 : halfLane - 1] += chance / 2;
      next[halfLane === PLINKO_ROWS * 2 ? halfLane - 1 : halfLane + 1] += chance / 2;
    });
    positions = next;
  }
  return Array.from({ length: PLINKO_SLOTS }, (_, slot) => positions[slot * 2]);
};

export const widePlinkoMultipliers = (risk: PlinkoRisk, startLane: number): number[] => {
  const base = WIDE_BASE[risk];
  const chances = widePlinkoProbabilities(startLane);
  const unscaledReturn = chances.reduce((sum, chance, slot) => sum + chance * base[slot], 0);
  return base.map((multiplier) => Math.round(multiplier * PLINKO_TARGET_RETURN / unscaledReturn * 100) / 100);
};
