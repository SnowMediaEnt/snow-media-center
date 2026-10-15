/**
 * The Player Account card's "Sign out of player" (Settings -> UI, and the
 * Snow Media dashboard) is the Player's own sign-out: before 2026-10-14 it only
 * cleared the login, left no "signed out on purpose" note, and the next Live TV
 * open signed the box straight back in with the store (billing) account.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ signOutPlayer: vi.fn(async () => {}) }));
vi.mock('@/lib/playerSignOut', () => ({ signOutPlayer: h.signOutPlayer }));
vi.mock('@/hooks/usePlayerAccount', () => ({
  usePlayerAccount: () => ({
    account: { host: 'http://h', username: 'jane', password: 'secret', serverLabel: 'DreamStreams', status: 'Active', expDate: null, createdAt: null, maxConnections: 2, activeCons: 0, isTrial: false },
    state: { severity: 'ok', show: false, label: '' },
    days: 30,
  }),
}));

import PlayerAccountCard from './PlayerAccountCard';

describe('Player Account card sign-out', () => {
  it('signs the Player out on purpose (no quiet sign-in back with the store account)', async () => {
    render(<PlayerAccountCard />);
    await act(async () => { fireEvent.click(screen.getByText(/Sign out of player/i)); await Promise.resolve(); });
    expect(h.signOutPlayer).toHaveBeenCalledTimes(1);
  });
});
