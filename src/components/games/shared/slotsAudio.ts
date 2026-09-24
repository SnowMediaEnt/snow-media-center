import type { GameAudioCue } from './gameAudio';

export interface SlotSoundOutcome {
  payout: number;
  bet: number;
  freeSpins: number;
  collectorHits: number;
  triggeredCollectors: readonly string[];
}

/** The score remains server-authoritative; this only chooses the celebration. */
export function slotSoundForOutcome(outcome: SlotSoundOutcome): GameAudioCue {
  const ratio = outcome.bet > 0 ? outcome.payout / outcome.bet : 0;
  if (outcome.triggeredCollectors.includes('yellow') || ratio >= 25) return 'slotJackpot';
  if (outcome.triggeredCollectors.length > 0 || ratio >= 5) return 'slotBigWin';
  if (outcome.payout > 0) return 'slotSmallWin';
  if (outcome.freeSpins > 0) return 'bonus';
  if (outcome.collectorHits > 0) return 'collectorFeed';
  return 'lose';
}
