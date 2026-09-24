import { describe, expect, it } from 'vitest';
import { homeCardIds, kidsBlockedView, profileGameView } from './kidsGameNavigation';

describe('profile game navigation', () => {
  it.each(['little', 'kids', 'teen'] as const)('gives %s profiles their own home lounge', (level) => {
    expect(homeCardIds(true, level)).toEqual(['player', 'kids-games', 'support']);
    expect(homeCardIds(false, level)).toEqual(['kids-games', 'support']);
    for (const view of ['games', 'game-slots', 'game-blackjack', 'game-plinko', 'game-dice-lounge']) {
      expect(profileGameView(view, level)).toBe('kids-games');
    }
    expect(profileGameView('kids-games', level)).toBe('kids-games');
    expect(profileGameView('livetv', level)).toBe('livetv');
  });

  it('keeps adult home and game routes, and rejects the kids lounge', () => {
    expect(homeCardIds(true, null)).toEqual(['player', 'apps', 'support', 'store']);
    expect(homeCardIds(false, null)).toEqual(['apps', 'support', 'store']);
    expect(profileGameView('games', null)).toBe('games');
    expect(profileGameView('game-blackjack', null)).toBe('game-blackjack');
    expect(profileGameView('kids-games', null)).toBe('home');
    expect(profileGameView('kids-game-snowball', null)).toBe('home');
  });

  it.each(['little', 'kids', 'teen'] as const)('sends %s profiles home from grown-up screens, whoever asks', (level) => {
    const grownUp = ['apps', 'store', 'user', 'credits', 'giveaway', 'community', 'media', 'chat',
      'admin-support', 'support-tickets', 'ai-conversations', 'create-ai-conversation', 'account-signin'];
    for (const view of grownUp) {
      expect(kidsBlockedView(view)).toBe(true);
      expect(profileGameView(view, level)).toBe('home');
    }
    // Their own screens stay open, Settings included (the short, safe one).
    for (const view of ['home', 'livetv', 'support', 'support-videos', 'settings', 'kids-games']) {
      expect(kidsBlockedView(view)).toBe(false);
      expect(profileGameView(view, level)).toBe(view);
    }
  });

  it('leaves every screen open to a grown-up profile', () => {
    for (const view of ['apps', 'store', 'user', 'credits', 'support-tickets', 'account-signin', 'settings']) {
      expect(profileGameView(view, null)).toBe(view);
    }
  });
});
