import type { KidsLevel } from '@/lib/kidsFilter';

export type HomeCardId = 'player' | 'apps' | 'support' | 'store' | 'kids-games';

/** Grown-up screens a Kids profile never opens, whoever asks: a How-to link,
 *  the assistant, a phone remote or a restored view. Main Apps, the Store,
 *  the Dashboard and everything it leads to (Snow Gems, giveaway, community,
 *  media), tickets, admin, the account's AI conversations and sign-in. The
 *  games are mapped to the Kids lounge instead, and Settings stays open (a
 *  Kids profile gets its short, safe Settings). */
const KIDS_HOME_ONLY: ReadonlySet<string> = new Set([
  'apps', 'store', 'user', 'credits', 'giveaway', 'community', 'media', 'chat',
  'admin-support', 'support-tickets', 'ai-conversations', 'create-ai-conversation', 'account-signin',
]);

/** Whether a view is one a Kids profile is sent home from. */
export const kidsBlockedView = (view: string): boolean => KIDS_HOME_ONLY.has(view);

/** Keep the lounge choice tied to the active viewer, including restored views. */
export function profileGameView(view: string, level: KidsLevel | null): string {
  if (level && (view === 'games' || view.startsWith('game-'))) return 'kids-games';
  if (level && KIDS_HOME_ONLY.has(view)) return 'home';
  if (!level && (view === 'kids-games' || view.startsWith('kids-game-'))) return 'home';
  return view;
}

export function homeCardIds(playerEnabled: boolean, level: KidsLevel | null): HomeCardId[] {
  const cards: HomeCardId[] = playerEnabled ? ['player'] : [];
  return level ? [...cards, 'kids-games', 'support'] : [...cards, 'apps', 'support', 'store'];
}
