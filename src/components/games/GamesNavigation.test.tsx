import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Games from '@/components/Games';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

// Deterministic: no live game server, no socket, fixed balance.
vi.mock('@/hooks/useGameSocket', () => ({
  useGameSocket: () => ({ status: 'connected', balance: 5000, errorMessage: null }),
}));

const onBack = vi.fn();
const onOpenGame = vi.fn();

const renderHub = () => {
  sessionStorage.clear();
  return render(<Games onBack={onBack} onOpenGame={onOpenGame} />);
};

const tile = (index: number) => document.querySelector<HTMLElement>(`[data-game-focus="${index}"]`)!;

beforeEach(() => {
  onBack.mockClear();
  onOpenGame.mockClear();
  localStorage.clear();
  document.documentElement.dir = 'ltr';
});

afterEach(() => {
  document.documentElement.dir = 'ltr';
});

describe('Games hub D-pad navigation', () => {
  it('renders all nine games plus Back and the reduced-FX control', () => {
    renderHub();
    expect(screen.getByText('games.hub.gameDailySpinName')).toBeTruthy();
    expect(screen.getByText('games.hub.gameCasinoHoldemName')).toBeTruthy();
    expect(screen.getByText('games.hub.gamePlinkoName')).toBeTruthy();
    expect(screen.getByText('games.hub.gameTvTriviaName')).toBeTruthy();
    expect(screen.getByText('games.hub.gameDiceLoungeName')).toBeTruthy();
    expect(screen.getByRole('button', { name: /games\.hub\.gameBlackjackName/ })).toBe(tile(3));
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    for (let i = 0; i <= 10; i++) expect(tile(i)).toBeTruthy();
  });

  it('keeps exactly one focused tile as the D-pad moves', () => {
    renderHub();
    tile(1).focus();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.querySelectorAll('[data-tv-focused="true"]').length).toBe(1);
    expect(tile(2).getAttribute('data-tv-focused')).toBe('true');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(tile(5).getAttribute('data-tv-focused')).toBe('true');
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(tile(2).getAttribute('data-tv-focused')).toBe('true');
    expect(document.querySelectorAll('[data-tv-focused="true"]').length).toBe(1);
  });

  it('follows the mirrored visual order when the lounge is in RTL', () => {
    document.documentElement.dir = 'rtl';
    renderHub();
    tile(1).focus();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(tile(2).getAttribute('data-tv-focused')).toBe('true');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(tile(1).getAttribute('data-tv-focused')).toBe('true');
  });

  it('consumes arrows at graph boundaries so native TV focus cannot drift', () => {
    renderHub();
    act(() => tile(0).focus());

    expect(fireEvent.keyDown(window, { key: 'ArrowLeft' })).toBe(false);
    expect(fireEvent.keyDown(window, { key: 'ArrowUp' })).toBe(false);
    expect(document.activeElement).toBe(tile(0));

    act(() => tile(10).focus());
    expect(fireEvent.keyDown(window, { key: 'ArrowRight' })).toBe(false);
    expect(fireEvent.keyDown(window, { key: 'ArrowDown' })).toBe(false);
    expect(document.activeElement).toBe(tile(10));
  });

  it('yields arrows to a global modal without moving lobby focus', () => {
    renderHub();
    act(() => tile(2).focus());
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);

    expect(fireEvent.keyDown(window, { key: 'ArrowRight' })).toBe(true);
    expect(document.activeElement).toBe(tile(2));
    modal.remove();
  });

  it('opens the focused game once per OK press and remembers it', () => {
    renderHub();
    tile(3).focus();
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    expect(onOpenGame).toHaveBeenCalledTimes(1);
    expect(onOpenGame).toHaveBeenCalledWith('game-blackjack');
    expect(sessionStorage.getItem('snow-games-last-focus-v1')).toBe('3');
  });

  it('opens Roulette with DPAD_CENTER from the remote', () => {
    renderHub();
    tile(5).focus();
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 23 });
    expect(onOpenGame).toHaveBeenCalledWith('game-roulette');
  });

  it('opens the new free-play games from the third row', () => {
    renderHub();
    tile(7).focus();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onOpenGame).toHaveBeenCalledWith('game-plinko');
  });

  it('leaves hardware Back to the app shell instead of handling it twice', () => {
    renderHub();
    tile(1).focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 4 });
    expect(onBack).not.toHaveBeenCalled();
  });

  it('still leaves the hub through the visible Back button', () => {
    renderHub();
    act(() => tile(0).focus());
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onOpenGame).not.toHaveBeenCalled();
  });

  it('toggles reduced FX from the footer control without opening a game', () => {
    renderHub();
    tile(10).focus();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onOpenGame).not.toHaveBeenCalled();
    expect(localStorage.getItem('snow-games-reduced-fx-v1')).toBe('true');
  });
});
