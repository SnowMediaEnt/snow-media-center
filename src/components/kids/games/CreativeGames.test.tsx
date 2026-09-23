import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BuildSnowWorld from './BuildSnowWorld';
import { patternFor } from './BeatBlizzard';

vi.mock('@/components/games/shared/gameAudio', () => ({ useGameAudio: () => ({ play: vi.fn() }) }));
afterEach(cleanup);

describe('creative kids games', () => {
  it('completes a world only after the age-appropriate goal and saves once', () => {
    const onComplete = vi.fn();
    render(<BuildSnowWorld tier="kids" progress={{ plays: 0, bestScore: 0, stars: 0, level: 1 }} onComplete={onComplete} onBack={vi.fn()} soundOn={false} />);
    const finish = screen.getByRole('button', { name: 'Finish world' }) as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    for (const spot of [1, 2, 3]) fireEvent.click(screen.getByRole('gridcell', { name: new RegExp(`Spot ${spot}:`) }));
    const cabin = screen.getByRole('gridcell', { name: /Spot 4:/ });
    fireEvent.click(cabin); fireEvent.click(cabin);
    expect(finish.disabled).toBe(false);
    fireEvent.click(finish); fireEvent.click(finish);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({ score: 450, stars: 3, level: 2 });
    expect(screen.getByRole('button', { name: 'New world' })).toBeTruthy();
  });

  it('gives rhythm rounds different, non-static directions', () => {
    const a = patternFor(1, 0, 4);
    const b = patternFor(1, 1, 4);
    expect(a).toHaveLength(4);
    expect(new Set(a).size).toBe(4);
    expect(a).not.toEqual(b);
  });
});
