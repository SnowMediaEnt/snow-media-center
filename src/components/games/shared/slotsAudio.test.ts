import { describe, expect, it } from 'vitest';
import { slotSoundForOutcome } from './slotsAudio';

const outcome = { payout: 0, bet: 100, freeSpins: 0, collectorHits: 0, triggeredCollectors: [] as string[] };

describe('slot outcome sounds', () => {
  it('escalates with the size and kind of the win', () => {
    expect(slotSoundForOutcome({ ...outcome, payout: 100 })).toBe('slotSmallWin');
    expect(slotSoundForOutcome({ ...outcome, payout: 600 })).toBe('slotBigWin');
    expect(slotSoundForOutcome({ ...outcome, payout: 2600 })).toBe('slotJackpot');
    expect(slotSoundForOutcome({ ...outcome, payout: 100, triggeredCollectors: ['red'] })).toBe('slotBigWin');
    expect(slotSoundForOutcome({ ...outcome, payout: 100, triggeredCollectors: ['yellow'] })).toBe('slotJackpot');
  });

  it('keeps free spins, collector feeds, and losses distinct', () => {
    expect(slotSoundForOutcome({ ...outcome, freeSpins: 5 })).toBe('bonus');
    expect(slotSoundForOutcome({ ...outcome, collectorHits: 1 })).toBe('collectorFeed');
    expect(slotSoundForOutcome(outcome)).toBe('lose');
  });
});
