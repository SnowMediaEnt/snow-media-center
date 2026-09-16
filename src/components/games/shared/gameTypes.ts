/** Shared vocabulary for the Snow Casino games. Types only — no behaviour. */
export type GameSuit = 'S' | 'H' | 'D' | 'C';

export interface GameCardValue {
  rank: string;
  suit: GameSuit;
}

export interface GameFairInfo {
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

/** Per-game accent used for trim, glow and artwork. */
export type GameAccent = 'ice' | 'plum' | 'emerald' | 'sapphire' | 'ruby' | 'teal' | 'amber' | 'violet' | 'cobalt';
