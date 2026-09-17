import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CYCLE_CELLS, MIN_TRAVEL_CELLS, RENDER_CELLS, computeSettleTarget } from './shared/slotsReel';

const spinSlots = vi.fn();

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useGameSocket', () => ({ useGameSocket: () => ({ balance: 5000, status: 'connected' }) }));
vi.mock('@/lib/gameSocket', () => ({ gameSocket: { spinSlots: (...a: unknown[]) => spinSlots(...a) } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import Slots from './Slots';

/** Distinctive 3x5 grid: no reel repeats another reel's column. */
const GRID = [
  ['p1', 'p2', 'p3', 'p4', 'la'],
  ['lk', 'lq', 'lj', 'wild', 'scatter'],
  ['p2', 'p3', 'p4', 'p1', 'lk'],
];

const ack = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  grid: GRID,
  wins: [],
  scatterCount: 0,
  totalPayout: 0,
  net: -10,
  bet: 10,
  freeSpin: false,
  freeSpinsRemaining: 0,
  multiplier: 1,
  triggeredFreeSpins: 0,
  ...extra,
});

const COLLECTORS = {
  red: { progress: 13, threshold: 15, hit: true, triggered: false, multiplier: 0, payout: 0, sources: [{ reel: 0, row: 1 }] },
  blue: { progress: 17, threshold: 24, hit: false, triggered: false, multiplier: 0, payout: 0, sources: [] },
  yellow: { progress: 0, threshold: 34, hit: true, triggered: true, multiplier: 20, payout: 200, sources: [{ reel: 3, row: 2 }] },
};

const strip = (reel: number) => screen.getByTestId(`slot-strip-${reel}`);
const reelBox = (reel: number) => strip(reel).parentElement as HTMLElement;
const travel = (reel: number) => Number(strip(reel).dataset.travel ?? '0');
const spinButton = () => screen.getByRole('button', { name: /games\.slots\.spin/ });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const expectLanded = () => {
  for (let reel = 0; reel < 5; reel += 1) {
    expect(reelBox(reel).dataset.reelSymbols).toBe([GRID[0][reel], GRID[1][reel], GRID[2][reel]].join(','));
  }
};

/** Real rAF drives the reels, so landings are awaited rather than ticked. */
const waitForLanding = () => waitFor(() => {
  expect(reelBox(4).dataset.reelSymbols).toBeDefined();
}, { timeout: 8000, interval: 60 });

describe('Slots reel motion', () => {
  beforeEach(() => { spinSlots.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders a bounded, recycled strip per reel', () => {
    render(<Slots onBack={() => {}} />);
    expect(RENDER_CELLS).toBeGreaterThanOrEqual(12);
    expect(RENDER_CELLS).toBeLessThanOrEqual(15);
    expect(CYCLE_CELLS).toBeLessThan(RENDER_CELLS);
    for (let reel = 0; reel < 5; reel += 1) {
      expect(strip(reel).children).toHaveLength(RENDER_CELLS);
    }
  });

  it('puts the sound toggle in the TV D-pad focus graph', () => {
    render(<Slots onBack={() => {}} />);
    const sound = screen.getByRole('button', { name: /games\.slots\.soundTurn/ });
    expect(sound.getAttribute('data-tv-focused')).toBe('false');
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(sound.getAttribute('data-tv-focused')).toBe('true');
  });

  it('always settles forward through at least six cell heights', () => {
    // Geometry contract behind the deceleration: never a reversal, never short.
    for (const pos of [0, 37.5, 512, 4321.75]) {
      for (let landing = 0; landing < CYCLE_CELLS; landing += 1) {
        const target = computeSettleTarget(pos, landing, 62);
        expect(target).toBeGreaterThanOrEqual(pos + MIN_TRAVEL_CELLS * 62);
        expect(Math.round((((target / 62) % CYCLE_CELLS) + CYCLE_CELLS) % CYCLE_CELLS)).toBe(landing);
      }
    }
  });

  it('moves immediately and only forward while a slow ack is pending', async () => {
    let resolve: (value: unknown) => void = () => {};
    spinSlots.mockImplementation(() => new Promise((r) => { resolve = r; }));
    render(<Slots onBack={() => {}} />);
    fireEvent.click(spinButton());

    await waitFor(() => expect(travel(0)).toBeGreaterThan(0), { timeout: 2000, interval: 20 });
    let last = travel(0);
    for (let i = 0; i < 6; i += 1) {
      await wait(60);
      const now = travel(0);
      expect(now).toBeGreaterThan(last); // monotonic, one visual direction only
      last = now;
    }

    // A late ack decelerates in the SAME direction and lands the server grid.
    resolve(ack());
    await waitForLanding();
    expect(travel(0)).toBeGreaterThan(last);
    expectLanded();
    expect(strip(0).children).toHaveLength(RENDER_CELLS); // no strip swap
  }, 15000);

  it('lands the exact server grid rows top/middle/bottom on a fast ack', async () => {
    spinSlots.mockResolvedValue(ack());
    render(<Slots onBack={() => {}} />);
    fireEvent.click(spinButton());
    expect(document.activeElement).toBe(spinButton());
    await waitForLanding();
    await waitFor(() => expect(spinButton().getAttribute('aria-disabled')).not.toBe('true'));
    expect(document.activeElement).toBe(spinButton());
    expect(spinButton().dataset.tvFocused).toBe('true');
    expect(travel(0)).toBeGreaterThan(0);
    expectLanded();
  }, 15000);

  it('sizes reels to the cabinet space instead of overflowing the controls', () => {
    render(<Slots onBack={() => {}} />);
    const cabinetScreen = document.querySelector('.snow-slot-screen') as HTMLElement;
    Object.defineProperty(cabinetScreen, 'clientHeight', { configurable: true, value: 210 });
    fireEvent(window, new Event('resize'));
    const reel = document.querySelector('.snow-slot-reel') as HTMLElement;
    expect(parseFloat(reel.style.height)).toBeLessThanOrEqual(210);
  });

  it('preserves the settled reel position when the TV resolution changes', async () => {
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });
    try {
      spinSlots.mockResolvedValue(ack());
      render(<Slots onBack={() => {}} />);
      fireEvent.click(spinButton());
      await waitForLanding();
      const before = travel(0);
      expect(before).toBeGreaterThan(0);

      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 });
      fireEvent(window, new Event('resize'));
      await waitFor(() => expect(travel(0)).toBeGreaterThan(before * 1.9));
      expect(travel(0)).toBeLessThan(before * 2.1);
      expectLanded();
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
    }
  }, 15000);

  it('lights only reels 0..N-1 for a three-of-a-kind win', async () => {
    spinSlots.mockResolvedValue(ack({
      totalPayout: 120,
      wins: [{ symbol: 'p1', count: 3, ways: 1, payout: 120 }],
    }));
    render(<Slots onBack={() => {}} />);
    fireEvent.click(spinButton());
    await waitForLanding();
    expectLanded();
    const lit = Array.from({ length: 5 }, (_, reel) => reelBox(reel).querySelectorAll('.snow-slot-cell__win').length);
    expect(lit[3]).toBe(0); // p1 also sits on reel 3, but a 3-win stops at reel 2
    expect(lit[4]).toBe(0);
    expect(lit[0] + lit[1] + lit[2]).toBeGreaterThan(0);
  }, 15000);

  it('shows one combined overlay for a win plus a free-spins award', async () => {
    spinSlots.mockResolvedValue(ack({
      totalPayout: 200,
      wins: [{ symbol: 'p1', count: 3, ways: 1, payout: 200 }],
      triggeredFreeSpins: 8,
      freeSpinsRemaining: 8,
    }));
    render(<Slots onBack={() => {}} />);
    fireEvent.click(spinButton());
    await waitForLanding();
    await waitFor(() => expect(document.querySelectorAll('.snow-slot-callout')).toHaveLength(1), { timeout: 3000 });
    expect(document.querySelectorAll('.snow-slot-overlay')).toHaveLength(1);
  }, 15000);

  it('shows qualitative collector heat without exposing exact counters', async () => {
    spinSlots.mockResolvedValue(ack({
      totalPayout: 200,
      basePayout: 0,
      collectorPayout: 200,
      collectors: COLLECTORS,
    }));
    render(<Slots onBack={() => {}} />);
    fireEvent.click(spinButton());
    await waitForLanding();

    expect(screen.getByTestId('slot-collector-red').textContent).not.toMatch(/13\s*\/\s*15/);
    expect(screen.getByTestId('slot-collector-blue').textContent).not.toMatch(/17\s*\/\s*24/);
    expect(screen.getByTestId('slot-collector-yellow').textContent).not.toMatch(/0\s*\/\s*34/);
    expect(screen.getByTestId('slot-collector-red').dataset.heat).toBe('near');
    expect(screen.getByTestId('slot-collector-blue').dataset.heat).toBe('hot');
    expect(screen.getByTestId('slot-collector-yellow').dataset.heat).toBe('cold');
    expect(screen.getByTestId('slot-collector-red').className).toContain('is-fed');
    expect(screen.getByTestId('slot-collector-yellow').className).toContain('is-triggered');
    expect(document.querySelectorAll('.snow-slot-relic-flight')).toHaveLength(2);
    expect(document.querySelector('.snow-slot-callout__trio')?.textContent).toContain('games.slots.collector.bonusCallout');
  }, 15000);

  it('rejects a malformed grid instead of settling on it', async () => {
    spinSlots.mockResolvedValue({ ...ack(), grid: [['p1', 'p2'], ['x', 'y']] });
    render(<Slots onBack={() => {}} />);
    fireEvent.click(spinButton());
    await waitFor(() => expect(document.querySelector('.snow-game-error')).not.toBeNull(), { timeout: 3000 });
    for (let reel = 0; reel < 5; reel += 1) {
      expect(reelBox(reel).dataset.reelSymbols).toBeUndefined();
    }
  }, 15000);

  it('schedules nothing when the ack resolves after unmount', async () => {
    let resolve: (value: unknown) => void = () => {};
    spinSlots.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args); });
    const { unmount } = render(<Slots onBack={() => {}} />);
    fireEvent.click(spinButton());
    await wait(120);
    unmount();
    resolve(ack());
    await wait(600);
    expect(errors).toHaveLength(0);
    expect(document.querySelector('[data-testid="slot-strip-0"]')).toBeNull();
    spy.mockRestore();
  }, 15000);
});
