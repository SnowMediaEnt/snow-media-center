import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { PlayingCard, PlayingCardSlot } from './shared/PlayingCard';
import { SLOTS_STRIP_LENGTH, buildStrip, visibleWindow } from './Slots';

const GAME_FILES = [
  'Slots.tsx',
  'Blackjack.tsx',
  'VideoPoker.tsx',
  'CasinoHoldem.tsx',
  'Roulette.tsx',
  'DailySpin.tsx',
];

const source = (name: string) => readFileSync(`src/components/games/${name}`, 'utf8');

describe('Slots reel strips', () => {
  it('keeps every strip short enough for a low-memory TV WebView', () => {
    expect(SLOTS_STRIP_LENGTH).toBeLessThanOrEqual(15);
    expect(buildStrip('wild', 'bonus', 'seven')).toHaveLength(SLOTS_STRIP_LENGTH);
  });

  it('lands the server result in the three visible rows', () => {
    const strip = buildStrip('wild', 'bonus', 'seven');
    expect(visibleWindow(strip)).toEqual(['wild', 'bonus', 'seven']);
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
