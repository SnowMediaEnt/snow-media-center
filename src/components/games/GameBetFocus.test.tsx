import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  balance: null as number | null,
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/hooks/useGameSocket', () => ({
  useGameSocket: () => ({ balance: state.balance, status: 'connected' }),
}));
vi.mock('@/lib/gameSocket', () => ({ gameSocket: {} }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import Blackjack from './Blackjack';
import CasinoHoldem from './CasinoHoldem';
import VideoPoker from './VideoPoker';

type GameName = 'blackjack' | 'holdem';

const renderGame = (game: GameName) => {
  if (game === 'blackjack') render(<Blackjack onBack={() => {}} />);
  else render(<CasinoHoldem onBack={() => {}} />);
};

const dealButton = (game: GameName) => screen.getByRole('button', {
  name: game === 'blackjack'
    ? /games\.blackjack\.dealWithBet/
    : /games\.casinoHoldem\.(dealButton|loadingChips)/,
});

const backButton = (game: GameName) => screen.getByRole('button', {
  name: game === 'blackjack' ? 'games.blackjack.back' : 'games.casinoHoldem.back',
});

describe.each<GameName>(['blackjack', 'holdem'])('%s betting focus safety', (game) => {
  beforeEach(() => {
    state.user = { id: 'u1' };
    state.balance = 1000;
  });

  it.each([
    { label: 'balance is loading', user: { id: 'u1' }, balance: null },
    { label: 'the player is signed out', user: null, balance: 1000 },
    { label: 'the minimum wager is unaffordable', user: { id: 'u1' }, balance: 5 },
  ])('keeps real and visual focus on Back when $label', async ({ user, balance }) => {
    state.user = user;
    state.balance = balance;
    renderGame(game);

    const deal = dealButton(game);
    const back = backButton(game);
    await waitFor(() => expect(document.activeElement).toBe(back));

    expect(deal.getAttribute('aria-disabled')).toBe('true');
    expect(deal.dataset.tvFocused).toBe('false');
    expect(back.dataset.focused).toBe('true');
  });
});

describe('video poker betting navigation', () => {
  beforeEach(() => {
    state.user = { id: 'u1' };
    state.balance = 1000;
  });

  it('moves Right from the largest chip directly to Deal', async () => {
    render(<VideoPoker onBack={() => {}} />);
    const largestChip = screen.getByRole('button', { name: '100' });
    const deal = screen.getByRole('button', { name: /games\.videoPoker\.dealWithBet/ });

    act(() => largestChip.focus());
    expect(largestChip.dataset.tvFocused).toBe('true');
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    await waitFor(() => expect(document.activeElement).toBe(deal));
    expect(deal.dataset.tvFocused).toBe('true');
  });
});
