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
  window.localStorage.removeItem('snow-blackjack-variant-v1');
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

  it('Blackjack transfers real and visual focus to Play Again after the dealer reveal', async () => {
    dealBlackjack.mockResolvedValue({
      ok: true,
      status: 'win',
      bet: 10,
      playerHand: [{ rank: 'K', suit: 'S' }, { rank: 'Q', suit: 'H' }],
      dealerHand: [{ rank: '9', suit: 'C' }, { rank: '8', suit: 'D' }],
      playerTotal: 20,
      dealerTotal: 17,
      net: 10,
    });
    render(<Blackjack onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /games\.blackjack\.dealWithBet/ }));

    // Down has no destination until the reveal finishes. It must not cancel
    // the scheduled handoff to Play Again and leave the remote on Back.
    await waitFor(() => expect(screen.getByRole('button', { name: /games\.blackjack\.playAgain/ }).getAttribute('aria-disabled')).toBe('true'));
    fireEvent.keyDown(window, { key: 'ArrowDown' });

    const again = await waitFor(
      () => {
        const button = screen.getByRole('button', { name: /games\.blackjack\.playAgain/ });
        expect(button.getAttribute('aria-disabled')).toBeNull();
        expect(button.dataset.tvFocused).toBe('true');
        expect(document.activeElement).toBe(button);
        return button;
      },
      { timeout: 1500 },
    );

    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyUp(window, { key: 'Enter' });
    await waitFor(() => expect(again.isConnected).toBe(false));
    expect(screen.getByRole('button', { name: /games\.blackjack\.dealWithBet/ })).not.toBeNull();
  });

  it('Blackjack sends the selected table and reveals a sealed double card only after the dealer', async () => {
    dealBlackjack.mockResolvedValue({
      ok: true,
      status: 'player_turn',
      bet: 10,
      variant: 'double_reveal',
      playerHand: [{ rank: '5', suit: 'H' }, { rank: '6', suit: 'D' }],
      dealerUp: [{ rank: '9', suit: 'S' }],
      playerTotal: 11,
      dealerUpTotal: 9,
      canHit: true,
      canStand: true,
      canDouble: true,
    });
    double.mockResolvedValue({
      ok: true,
      status: 'win',
      bet: 20,
      variant: 'double_reveal',
      playerHand: [
        { rank: '5', suit: 'H' },
        { rank: '6', suit: 'D' },
        { rank: 'K', suit: 'C' },
      ],
      dealerHand: [
        { rank: '9', suit: 'S' },
        { rank: '7', suit: 'C' },
        { rank: '10', suit: 'D' },
      ],
      playerTotal: 21,
      dealerTotal: 26,
      net: 20,
      doubled: true,
      doubleCardFaceDown: true,
      doubleCardIndex: 2,
      preDoublePlayerTotal: 11,
    });

    render(<Blackjack onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Double Reveal/ }));
    fireEvent.click(screen.getByRole('button', { name: /games\.blackjack\.dealWithBet/ }));
    await waitFor(() => expect(dealBlackjack).toHaveBeenCalledWith(
      10,
      expect.any(String),
      'double_reveal',
    ));

    const doubleButton = await waitFor(() => screen.getByRole('button', { name: /games\.blackjack\.double/ }));
    fireEvent.click(doubleButton);
    expect(await screen.findByText(/your double card is sealed/i)).not.toBeNull();
    expect(screen.getByText('11+?')).not.toBeNull();

    const again = screen.getByRole('button', { name: /games\.blackjack\.playAgain/ });
    expect(again.getAttribute('aria-disabled')).toBe('true');
    await waitFor(() => {
      expect(screen.queryByText(/your double card is sealed/i)).toBeNull();
      expect(screen.getAllByText('21').length).toBeGreaterThan(0);
      expect(again.getAttribute('aria-disabled')).toBeNull();
    }, { timeout: 3500 });
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
      ok: true, status: 'player_turn', playerHand: ['5H', '6D'], dealerUp: ['KS'], dealerHand: ['KS'],
      playerTotal: 11, canHit: true, canStand: true, canDouble: false, balance: 900,
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
