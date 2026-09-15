import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dealCasinoHoldem = vi.fn();
const callCasinoHoldem = vi.fn();
const foldCasinoHoldem = vi.fn();
const dealBlackjack = vi.fn();
const hit = vi.fn();
const stand = vi.fn();
const double = vi.fn();

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useGameSocket', () => ({ useGameSocket: () => ({ balance: 1000, status: 'connected' }) }));
vi.mock('@/lib/gameSocket', () => ({
  gameSocket: {
    dealCasinoHoldem: (...a: unknown[]) => dealCasinoHoldem(...a),
    callCasinoHoldem: (...a: unknown[]) => callCasinoHoldem(...a),
    foldCasinoHoldem: (...a: unknown[]) => foldCasinoHoldem(...a),
    dealBlackjack: (...a: unknown[]) => dealBlackjack(...a),
    hit: (...a: unknown[]) => hit(...a),
    stand: (...a: unknown[]) => stand(...a),
    double: (...a: unknown[]) => double(...a),
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${v.multiplier ?? ''}:${v.cost ?? v.ante ?? ''}` : k),
  }),
}));

import CasinoHoldem from './CasinoHoldem';
import Blackjack from './Blackjack';

const holdemDealAck = {
  ok: true,
  status: 'decision',
  playerHole: ['AS', 'KD'],
  flop: ['2C', '7H', 'TS'],
  callCost: 20,
  raiseOptions: [{ multiplier: 2, cost: 20 }],
  balance: 500,
  serverSeedHash: 'hash',
};

const holdemDeal = () => screen.getByRole('button', { name: /games\.casinoHoldem\.dealButton/ });
const holdemFold = () => screen.queryByRole('button', { name: /games\.casinoHoldem\.fold/ });

const openModal = () => {
  const modal = document.createElement('div');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('data-test-modal', 'true');
  document.body.appendChild(modal);
  return modal;
};

beforeEach(() => {
  [dealCasinoHoldem, callCasinoHoldem, foldCasinoHoldem, dealBlackjack, hit, stand, double]
    .forEach((m) => m.mockReset());
});
afterEach(() => {
  document.querySelectorAll('[data-test-modal="true"]').forEach((n) => n.remove());
  vi.restoreAllMocks();
});

describe('terminal round reconciliation', () => {
  it("Hold'em recovers to a usable betting state when the server confirms the round is gone", async () => {
    const onBack = vi.fn();
    dealCasinoHoldem.mockResolvedValue(holdemDealAck);
    callCasinoHoldem.mockResolvedValue({ ok: false, error: 'no_active_round' });
    render(<CasinoHoldem onBack={onBack} />);
    fireEvent.click(holdemDeal());
    await waitFor(() => expect(holdemFold()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /games\.casinoHoldem\.callOption/ }));
    // Back to the bet phase: no stranded decision, Deal usable again.
    await waitFor(() => expect(holdemFold()).toBeNull());
    expect(holdemDeal()).not.toBeNull();

    // And Back is no longer blocked by a phantom committed hand.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
  });

  it("Hold'em treats a transport failure as unknown and keeps the hand", async () => {
    const onBack = vi.fn();
    dealCasinoHoldem.mockResolvedValue(holdemDealAck);
    callCasinoHoldem.mockRejectedValue(new Error('timeout'));
    render(<CasinoHoldem onBack={onBack} />);
    fireEvent.click(holdemDeal());
    await waitFor(() => expect(holdemFold()).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /games\.casinoHoldem\.callOption/ }));
    await waitFor(() => expect(screen.queryByText(/tableUnreachable/)).not.toBeNull());
    expect(holdemFold()).not.toBeNull();
  });

  it('Blackjack recovers when a hit is answered with no_active_round', async () => {
    dealBlackjack.mockResolvedValue({
      ok: true, status: 'playing', playerCards: ['5H', '6D'], dealerCards: ['KS'],
      playerTotal: 11, canHit: true, canStand: true, balance: 900,
    });
    hit.mockResolvedValue({ ok: false, error: 'no_active_round' });
    render(<Blackjack onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /games\.blackjack\.dealWithBet/ }));
    const hitBtn = await waitFor(() => screen.getByRole('button', { name: /games\.blackjack\.hit/ }));
    fireEvent.click(hitBtn);
    await waitFor(() => expect(screen.queryByRole('button', { name: /games\.blackjack\.hit/ })).toBeNull());
    expect(screen.getByRole('button', { name: /games\.blackjack\.dealWithBet/ })).not.toBeNull();
  });
});

describe('a global modal over an active game', () => {
  it("takes Back, OK and arrows away from the Hold'em table without changing it", async () => {
    const onBack = vi.fn();
    dealCasinoHoldem.mockResolvedValue(holdemDealAck);
    render(<CasinoHoldem onBack={onBack} />);
    fireEvent.click(holdemDeal());
    await waitFor(() => expect(holdemFold()).not.toBeNull());
    const focusedBefore = document.activeElement;

    openModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onBack).not.toHaveBeenCalled();
    expect(callCasinoHoldem).not.toHaveBeenCalled();
    expect(foldCasinoHoldem).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(focusedBefore);
    expect(holdemFold()).not.toBeNull();
  });
});
