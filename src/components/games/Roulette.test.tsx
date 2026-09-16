import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spinRoulette = vi.fn();

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useGameSocket', () => ({ useGameSocket: () => ({ balance: 5000, status: 'connected' }) }));
vi.mock('@/lib/gameSocket', () => ({ gameSocket: { spinRoulette: (...a: unknown[]) => spinRoulette(...a) } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import Roulette from './Roulette';

/** Straight 17 wins, red loses: enough to check both settled colourings. */
const RESULT = {
  ok: true,
  result: { number: 17, color: 'black' },
  bets: [
    { type: 'straight', selection: 17, amount: 10, won: true, payout: 360 },
    { type: 'red', selection: null, amount: 10, won: false, payout: 0 },
  ],
  totalBet: 20,
  totalPayout: 360,
  net: 340,
  fair: { serverSeedHash: 'hash', serverSeed: 'seed', clientSeed: 'c', nonce: 1 },
};

const cellFor = (name: string) => screen.getByRole('button', { name });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Roulette settled round', () => {
  beforeEach(() => {
    spinRoulette.mockReset();
    // Reduced FX keeps the landing animation short and deterministic in tests.
    localStorage.setItem('snow-games-reduced-fx-v1', 'true');
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const placeAndSpin = async () => {
    spinRoulette.mockResolvedValue(RESULT);
    render(<Roulette onBack={() => {}} />);
    fireEvent.click(cellFor('17'));
    fireEvent.click(screen.getByText('games.roulette.betRed'));
    fireEvent.click(screen.getByRole('button', { name: /games\.roulette\.spin/ }));
    await waitFor(() => expect(screen.queryByText('17')).not.toBeNull(), { timeout: 15000 });
    await waitFor(() => {
      expect(cellFor('17').className).toContain('is-won');
    }, { timeout: 15000, interval: 40 });
  };

  it('uses the visible translated names for outside-bet accessibility labels', () => {
    render(<Roulette onBack={() => {}} />);
    for (const key of ['betLow', 'betEven', 'betRed', 'betBlack', 'betOdd', 'betHigh']) {
      expect(screen.getByRole('button', { name: `games.roulette.${key}` })).toBeTruthy();
    }
    expect(document.querySelector('button[aria-label="null"]')).toBeNull();
  });

  it('keeps win/loss colouring after the spent chips are cleared', async () => {
    await placeAndSpin();
    // Live placements are gone (nothing left to undo) but the felt still shows
    // the settled snapshot with its chips and won/lost colours.
    expect(cellFor('17').className).toContain('is-won');
    expect(screen.getByText('games.roulette.betRed').closest('button')!.className).toContain('is-lost');
    expect(cellFor('17').textContent).toContain('10');
  }, 30000);

  it('drops the settled snapshot as soon as a new wager starts', async () => {
    await placeAndSpin();
    fireEvent.click(cellFor('5'));
    await waitFor(() => expect(cellFor('17').className).not.toContain('is-won'));
    expect(screen.getByText('games.roulette.betRed').closest('button')!.className).not.toContain('is-lost');
  }, 30000);

  it('drops the settled snapshot when the wheel kind changes', async () => {
    await placeAndSpin();
    fireEvent.click(screen.getByText('games.roulette.wheelAmerican'));
    await waitFor(() => expect(cellFor('17').className).not.toContain('is-won'));
  }, 30000);

  it('leaves focus on a usable control, never the disabled Spin button', async () => {
    await placeAndSpin();
    const spin = screen.getByRole('button', { name: /games\.roulette\.spin/ });
    expect(spin.getAttribute('aria-disabled')).toBe('true');
    await waitFor(() => {
      const focused = document.querySelector('[data-tv-focused="true"]') as HTMLElement | null;
      expect(focused).not.toBeNull();
      expect(focused!.getAttribute('aria-disabled')).not.toBe('true');
      expect(focused!.className).toContain('snow-rl-denom');
    }, { timeout: 4000 });
  }, 30000);

  it('Back closes fairness first and only then leaves the game', async () => {
    const onBack = vi.fn();
    spinRoulette.mockResolvedValue(RESULT);
    render(<Roulette onBack={onBack} />);
    fireEvent.click(cellFor('17'));
    fireEvent.click(screen.getByRole('button', { name: /games\.roulette\.spin/ }));
    await waitFor(() => expect(screen.queryByText('games.roulette.provablyFair')).not.toBeNull(), { timeout: 15000 });

    fireEvent.click(screen.getByText('games.roulette.provablyFair'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeNull());

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyUp(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onBack).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
  }, 30000);

  it('blocks Back while the wheel is still spinning', async () => {
    const onBack = vi.fn();
    let resolve: (value: unknown) => void = () => {};
    spinRoulette.mockImplementation(() => new Promise((r) => { resolve = r; }));
    render(<Roulette onBack={onBack} />);
    fireEvent.click(cellFor('17'));
    fireEvent.click(screen.getByRole('button', { name: /games\.roulette\.spin/ }));
    await wait(80);

    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 4 });
    expect(onBack).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('games.shared.finishSpinFirst')).not.toBeNull());
    resolve(RESULT);
  }, 30000);
});
