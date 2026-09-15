import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dealCasinoHoldem = vi.fn();
const callCasinoHoldem = vi.fn();
const foldCasinoHoldem = vi.fn();

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
// The live balance is deliberately stale/optimistic: the ack must win.
vi.mock('@/hooks/useGameSocket', () => ({ useGameSocket: () => ({ balance: 1000, status: 'connected' }) }));
vi.mock('@/lib/gameSocket', () => ({
  gameSocket: {
    dealCasinoHoldem: (...a: unknown[]) => dealCasinoHoldem(...a),
    callCasinoHoldem: (...a: unknown[]) => callCasinoHoldem(...a),
    foldCasinoHoldem: (...a: unknown[]) => foldCasinoHoldem(...a),
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${v.multiplier ?? ''}:${v.cost ?? v.ante ?? ''}` : k),
  }),
}));

import CasinoHoldem from './CasinoHoldem';

/**
 * Deal ack: after the ante the server says only 45 chips remain, so the 2x call
 * (20) is affordable and the 3x raise (60) is not — even though the live
 * balance would suggest both are payable.
 */
const dealAck = {
  ok: true,
  status: 'decision',
  playerHole: ['AS', 'KD'],
  flop: ['2C', '7H', 'TS'],
  callCost: 20,
  raiseOptions: [{ multiplier: 2, cost: 20 }, { multiplier: 3, cost: 60 }],
  balance: 45,
  serverSeedHash: 'hash',
};

const dealButton = () => screen.getByRole('button', { name: /games\.casinoHoldem\.dealButton/ });
const callButton = () => screen.getByRole('button', { name: /games\.casinoHoldem\.callOption/ });
const raiseButton = () => screen.getByRole('button', { name: /games\.casinoHoldem\.raiseOption/ });

const dealHand = async () => {
  dealCasinoHoldem.mockResolvedValue(dealAck);
  render(<CasinoHoldem onBack={() => {}} />);
  fireEvent.click(dealButton());
  await waitFor(() => expect(screen.queryByRole('button', { name: /games\.casinoHoldem\.fold/ })).not.toBeNull());
};

describe("Casino Hold'em decision phase", () => {
  beforeEach(() => {
    dealCasinoHoldem.mockReset();
    callCasinoHoldem.mockReset();
    foldCasinoHoldem.mockReset();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('uses the deal ack balance for affordability, not the live balance', async () => {
    await dealHand();
    expect(callButton().getAttribute('aria-disabled')).toBeNull();
    expect(raiseButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('focuses the first affordable option once the hand is dealt', async () => {
    await dealHand();
    await waitFor(() => expect(callButton().dataset.tvFocused).toBe('true'));
    expect(raiseButton().dataset.tvFocused).toBe('false');
    expect(document.activeElement).toBe(callButton());
  });

  it('never activates the unaffordable raise', async () => {
    await dealHand();
    fireEvent.click(raiseButton());
    expect(callCasinoHoldem).not.toHaveBeenCalled();
  });

  it('falls back to Fold when nothing is affordable', async () => {
    dealCasinoHoldem.mockResolvedValue({ ...dealAck, balance: 0 });
    render(<CasinoHoldem onBack={() => {}} />);
    fireEvent.click(dealButton());
    const fold = await waitFor(() => screen.getByRole('button', { name: /games\.casinoHoldem\.fold/ }));
    await waitFor(() => expect(fold.dataset.tvFocused).toBe('true'));
    expect(callButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps a committed hand mounted when Back is pressed mid-decision', async () => {
    const onBack = vi.fn();
    dealCasinoHoldem.mockResolvedValue(dealAck);
    render(<CasinoHoldem onBack={onBack} />);
    fireEvent.click(dealButton());
    await waitFor(() => expect(screen.queryByRole('button', { name: /games\.casinoHoldem\.fold/ })).not.toBeNull());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /games\.casinoHoldem\.fold/ })).not.toBeNull();
  });

  it('ignores a stale deal ack that resolves after a newer hand started', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    dealCasinoHoldem
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue({ ...dealAck, balance: 45 });
    render(<CasinoHoldem onBack={() => {}} />);
    fireEvent.click(dealButton());
    // A second press starts a new hand epoch; the first ack must be discarded.
    fireEvent.click(dealButton());
    resolveFirst({ ...dealAck, balance: 900 });
    await new Promise((r) => setTimeout(r, 80));
    // The stale ack's generous balance must not unlock the 3x raise.
    expect(raiseButton().getAttribute('aria-disabled')).toBe('true');
    expect(callButton().getAttribute('aria-disabled')).toBeNull();
  });
});
