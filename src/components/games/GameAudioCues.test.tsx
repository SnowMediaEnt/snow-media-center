import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  play: vi.fn(),
  claimDailySpin: vi.fn(),
  refreshBalance: vi.fn(),
  dealVideoPoker: vi.fn(),
  drawVideoPoker: vi.fn(),
  spinRoulette: vi.fn(),
  dealCasinoHoldem: vi.fn(),
  callCasinoHoldem: vi.fn(),
  foldCasinoHoldem: vi.fn(),
}));

vi.mock('./shared/gameAudio', () => ({
  useGameAudio: () => ({ play: mocks.play }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useGameSocket', () => ({
  useGameSocket: () => ({ balance: 5000, status: 'connected' }),
}));
vi.mock('@/lib/gameSocket', () => ({
  gameSocket: {
    claimDailySpin: (...args: unknown[]) => mocks.claimDailySpin(...args),
    refreshBalance: (...args: unknown[]) => mocks.refreshBalance(...args),
    dealVideoPoker: (...args: unknown[]) => mocks.dealVideoPoker(...args),
    drawVideoPoker: (...args: unknown[]) => mocks.drawVideoPoker(...args),
    spinRoulette: (...args: unknown[]) => mocks.spinRoulette(...args),
    dealCasinoHoldem: (...args: unknown[]) => mocks.dealCasinoHoldem(...args),
    callCasinoHoldem: (...args: unknown[]) => mocks.callCasinoHoldem(...args),
    foldCasinoHoldem: (...args: unknown[]) => mocks.foldCasinoHoldem(...args),
  },
}));
vi.mock('@/integrations/supabase/client', () => {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: null }),
  };
  return { supabase: { from: () => query } };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (
      values ? `${key}:${values.amount ?? values.prize ?? values.bet ?? ''}` : key
    ),
  }),
}));

import CasinoHoldem from './CasinoHoldem';
import DailySpin from './DailySpin';
import Roulette from './Roulette';
import VideoPoker from './VideoPoker';

const card = (rank: string, suit: 'S' | 'H' | 'D' | 'C') => ({ rank, suit });
const outcomeCues = () => mocks.play.mock.calls
  .map(([cue]) => cue as string)
  .filter((cue) => cue !== 'select');

describe('authoritative game audio cues', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    localStorage.setItem('snow-games-reduced-fx-v1', 'true');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem('snow-games-reduced-fx-v1');
  });

  it('sounds a Daily Spin landing and jackpot once, after the wheel settles', async () => {
    mocks.claimDailySpin.mockResolvedValue({ ok: true, index: 4, prize: 2000 });
    render(<DailySpin onBack={() => {}} />);

    const spin = await waitFor(() => {
      const button = screen.getByRole('button', { name: 'games.dailySpin.spin' });
      expect(button.getAttribute('aria-disabled')).toBeNull();
      return button;
    });
    fireEvent.click(spin);

    await waitFor(() => expect(outcomeCues()).toEqual(['reelStop', 'bonus']), { timeout: 5000 });
  });

  it('sounds each successful video-poker deal/draw and its outcome once', async () => {
    const dealt = [card('A', 'S'), card('K', 'D'), card('7', 'H'), card('4', 'C'), card('2', 'S')];
    const drawn = [card('J', 'S'), card('J', 'D'), card('7', 'H'), card('4', 'C'), card('2', 'S')];
    mocks.dealVideoPoker.mockResolvedValue({ ok: true, hand: dealt });
    mocks.drawVideoPoker.mockResolvedValue({
      ok: true,
      hand: drawn,
      rank: 'Jacks or Better',
      payout: 20,
      net: 10,
      win: true,
    });
    render(<VideoPoker onBack={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /games\.videoPoker\.dealWithBet/ }));
    const draw = await waitFor(() => screen.getByRole('button', { name: 'games.videoPoker.draw' }));
    expect(outcomeCues()).toEqual(['card']);
    fireEvent.click(draw);

    await waitFor(() => expect(outcomeCues()).toEqual(['card', 'card', 'win']));
  });

  it('sounds the roulette wheel landing and settled loss once', async () => {
    mocks.spinRoulette.mockResolvedValue({
      ok: true,
      result: { number: 17, color: 'black' },
      bets: [{ type: 'red', selection: null, amount: 10, won: false, payout: 0 }],
      totalBet: 10,
      totalPayout: 0,
      net: -10,
    });
    render(<Roulette onBack={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'games.roulette.betRed' }));
    fireEvent.click(screen.getByRole('button', { name: /games\.roulette\.spin/ }));

    await waitFor(() => expect(outcomeCues()).toEqual(['reelStop', 'lose']), { timeout: 5000 });
  });

  it("sounds Hold'em cards and a folded loss without replaying on rerender", async () => {
    mocks.dealCasinoHoldem.mockResolvedValue({
      ok: true,
      status: 'decision',
      playerHole: [card('A', 'S'), card('K', 'D')],
      flop: [card('2', 'C'), card('7', 'H'), card('10', 'S')],
      callCost: 20,
      raiseOptions: [{ multiplier: 2, cost: 20 }],
      balance: 4900,
    });
    mocks.foldCasinoHoldem.mockResolvedValue({
      ok: true,
      status: 'folded',
      playerHole: [card('A', 'S'), card('K', 'D')],
      dealerHole: [card('Q', 'H'), card('J', 'D')],
      community: [card('2', 'C'), card('7', 'H'), card('10', 'S'), card('4', 'D'), card('9', 'S')],
      net: -10,
    });
    const view = render(<CasinoHoldem onBack={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /games\.casinoHoldem\.dealButton/ }));
    const fold = await waitFor(() => screen.getByRole('button', { name: 'games.casinoHoldem.fold' }));
    expect(outcomeCues()).toEqual(['card']);
    fireEvent.click(fold);

    await waitFor(() => expect(outcomeCues()).toEqual(['card', 'card', 'lose']));
    view.rerender(<CasinoHoldem onBack={() => {}} />);
    expect(outcomeCues()).toEqual(['card', 'card', 'lose']);
  });

  it('keeps a successful deal acknowledgement silent after unmount', async () => {
    let resolveDeal: (value: unknown) => void = () => {};
    mocks.dealVideoPoker.mockImplementation(() => new Promise((resolve) => { resolveDeal = resolve; }));
    const view = render(<VideoPoker onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /games\.videoPoker\.dealWithBet/ }));
    view.unmount();

    resolveDeal({ ok: true, hand: [card('A', 'S'), card('K', 'D')] });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(outcomeCues()).toEqual([]);
  });
});
