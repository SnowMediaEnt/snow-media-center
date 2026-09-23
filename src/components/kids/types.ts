export type KidsTier = 'little' | 'kids' | 'teens';

export interface KidsProgress {
  plays: number;
  bestScore: number;
  stars: number;
  level: number;
}

export interface KidsGameResult {
  score: number;
  stars: number;
  level?: number;
}

export interface KidsGameProps {
  tier: KidsTier;
  progress: KidsProgress;
  onComplete: (result: KidsGameResult) => void;
  onBack: () => void;
  soundOn: boolean;
}
