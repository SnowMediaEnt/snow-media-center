import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BuildSnowWorld from './BuildSnowWorld';
import { patternFor, patternLengthFor } from './BeatBlizzard';

vi.mock('@/components/games/shared/gameAudio', () => ({ useGameAudio: () => ({ play: vi.fn() }) }));
afterEach(cleanup);

describe('creative kids games', () => {
  it('completes a creative world only after its required scene pieces are placed', () => {
    const onComplete = vi.fn();
    render(<BuildSnowWorld tier="kids" progress={{ plays: 0, bestScore: 0, stars: 0, level: 1 }} onComplete={onComplete} onBack={vi.fn()} soundOn={false} />);
    const finish = screen.getByRole('button', { name: 'Finish world' }) as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    fireEvent.click(screen.getByRole('gridcell', { name: /Spot 1:/ }));
    const cabin = screen.getByRole('gridcell', { name: /Spot 2:/ });
    fireEvent.click(cabin); fireEvent.click(cabin);
    expect(finish.disabled).toBe(false);
    fireEvent.click(finish); fireEvent.click(finish);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({ score: 300, stars: 3, level: 2 });
    expect(screen.getByRole('button', { name: 'New world' })).toBeTruthy();
  });

  it('grows each Simon-style sequence by one beat across levels', () => {
    expect([0, 1, 2].map(round => patternLengthFor('little', 1, round))).toEqual([1, 2, 3]);
    expect([0, 1, 2].map(round => patternLengthFor('little', 2, round))).toEqual([2, 3, 4]);
    expect([0, 1, 2].map(round => patternLengthFor('little', 3, round))).toEqual([3, 4, 5]);
    expect(patternLengthFor('little', 20, 2)).toBe(5);
    expect(patternFor(1, 2).slice(0, 1)).toEqual(patternFor(1, 1));
    expect(patternFor(1, 3).slice(0, 2)).toEqual(patternFor(1, 2));
    expect(patternFor(2, 3)).not.toEqual(patternFor(1, 3));
  });
});
