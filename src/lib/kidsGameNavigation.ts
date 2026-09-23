import type { KidsLevel } from '@/lib/kidsFilter';

export type HomeCardId = 'player' | 'apps' | 'support' | 'store' | 'kids-games';

/** Keep the lounge choice tied to the active viewer, including restored views. */
export function profileGameView(view: string, level: KidsLevel | null): string {
  if (level && (view === 'games' || view.startsWith('game-'))) return 'kids-games';
  if (!level && (view === 'kids-games' || view.startsWith('kids-game-'))) return 'home';
  return view;
}

export function homeCardIds(playerEnabled: boolean, level: KidsLevel | null): HomeCardId[] {
  const cards: HomeCardId[] = playerEnabled ? ['player'] : [];
  return level ? [...cards, 'kids-games', 'support'] : [...cards, 'apps', 'support', 'store'];
}
