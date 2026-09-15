export type GameSuit = 'S' | 'H' | 'D' | 'C';
export type GameCardValue = { rank: string; suit: GameSuit };

export interface GameFairInfo {
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

export type GameAccent = 'ice' | 'plum' | 'emerald' | 'sapphire' | 'ruby' | 'teal';
