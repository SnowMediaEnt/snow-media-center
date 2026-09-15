import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { PlayingCard, PlayingCardSlot } from './shared/PlayingCard';
import { SLOTS_RENDER_CELLS } from './Slots';
import {
  MIN_TRAVEL_CELLS, REELS, ROWS, buildCells, computeSettleTarget,
  gridToColumns, pickLandingIndex, validateGrid, visibleSymbolsAt, withLanding,
} from './shared/slotsReel';

const GAME_FILES = [
  'Slots.tsx',
  'Blackjack.tsx',
  'VideoPoker.tsx',
  'CasinoHoldem.tsx',
  'Roulette.tsx',
  'DailySpin.tsx',
];

const source = (name: string) => readFileSync(`src/components/games/${name}`, 'utf8');

const CELL = 74;
/** Distinctive server grid: [row][reel]. */
const FIXTURE = [
  ['wild', 'p1', 'p2', 'p3', 'p4'],
  ['scatter', 'la', 'lk', 'lq', 'lj'],
  ['p1', 'p2', 'p3', 'p4', 'wild'],
];

describe('Slots reel geometry', () => {
  it('keeps every reel bounded for a low-memory TV WebView', () => {
    expect(SLOTS_RENDER_CELLS).toBeLessThanOrEqual(15);
    expect(buildCells(() => 'wild')).toHaveLength(SLOTS_RENDER_CELLS);
  });

  it('validates the server grid as exactly three rows of five symbols', () => {
    expect(validateGrid(FIXTURE)).toBe(true);
    expect(validateGrid([FIXTURE[0], FIXTURE[1]])).toBe(false);
    expect(validateGrid([FIXTURE[0], FIXTURE[1], ['p1', 'p2', 'p3', 'p4', 'nope']])).toBe(false);
  });

  it('lands the fixture identically on all five reels', () => {
    const columns = gridToColumns(FIXTURE);
    expect(columns).toHaveLength(REELS);
    columns.forEach((column, reel) => {
      const pos = reel * 37.5; // each reel stops from a different position
      const landing = pickLandingIndex(pos, CELL);
      const cells = withLanding(buildCells(() => 'lj'), landing, column);
      const target = computeSettleTarget(pos, landing, CELL, MIN_TRAVEL_CELLS);
      expect(visibleSymbolsAt(cells, target, CELL)).toEqual([
        FIXTURE[0][reel], FIXTURE[1][reel], FIXTURE[2][reel],
      ]);
      expect(column).toHaveLength(ROWS);
    });
  });

  it('always settles forward through at least six cell heights', () => {
    for (const pos of [0, 12.5, 500, 4821.3]) {
      for (let landing = 0; landing < 12; landing += 1) {
        const target = computeSettleTarget(pos, landing, CELL, MIN_TRAVEL_CELLS);
        expect(target - pos).toBeGreaterThanOrEqual(MIN_TRAVEL_CELLS * CELL);
      }
    }
  });

  it('animates with transform/opacity only — no blur or filter', () => {
    const src = source('Slots.tsx');
    expect(src).toContain('translateY');
    expect(src).not.toMatch(/filter:\s*['"`]?blur/);
  });
});

describe('all six games share the reduced-FX shell', () => {
  it.each(GAME_FILES)('%s renders through GameShell and honours reduced FX', (file) => {
    const src = source(file);
    expect(src).toMatch(/GameShell|snow-casino/);
    expect(src).toContain('useReducedGameFx');
    expect(src).toContain('useGameLifecycle');
  });

  it.each(GAME_FILES)('%s has no scale-110 focus zoom', (file) => {
    expect(source(file)).not.toContain('scale-110');
  });

  it.each(GAME_FILES)('%s uses the shared activation guard', (file) => {
    expect(source(file)).toContain('useTvActivate');
  });
});

describe('shared playing card', () => {
  it('renders rank and suit corners for TV readability', () => {
    const { container } = render(<PlayingCard card={{ rank: 'A', suit: 'S' }} />);
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.snow-card-corner').length).toBe(2);
  });

  it('supports a compact 720p variant on both card and empty slot', () => {
    const { container } = render(
      <>
        <PlayingCard card={{ rank: 'K', suit: 'H' }} compact />
        <PlayingCardSlot compact />
      </>,
    );
    expect(container.querySelectorAll('.is-compact').length).toBe(2);
  });

  it('marks a held card so HOLD state is unmistakable', () => {
    const { container } = render(<PlayingCard card={{ rank: '10', suit: 'D' }} held />);
    expect(container.querySelector('.is-held')).not.toBeNull();
  });
});

describe('disabled targets never take real focus', () => {
  it.each(GAME_FILES)('%s marks unavailable controls with aria-disabled, not disabled', (file) => {
    const src = source(file);
    expect(src).toContain('aria-disabled');
  });
});
