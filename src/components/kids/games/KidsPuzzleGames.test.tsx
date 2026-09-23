import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PenguinPath, { penguinSequence } from './PenguinPath';
import WinterMatch, { createWinterCards } from './WinterMatch';

const audio = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock('../../games/shared/gameAudio', () => ({ useGameAudio: () => audio }));
const progress = { plays: 0, bestScore: 0, stars: 0, level: 1 };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); audio.play.mockClear(); });

describe('kids puzzle games', () => {
  it('keeps little-kid counting simple and advances skip-counting by tier', () => {
    expect(penguinSequence('little', 40)).toEqual([1, 2, 3, 4, 5]);
    expect(penguinSequence('kids', 1)).toEqual([2, 4, 6, 8, 10]);
    expect(penguinSequence('teens', 1)).toEqual([6, 12, 18, 24, 30]);
  });
  it('completes a penguin trail using only arrows and submits progress once', () => {
    const complete = vi.fn(); const back = vi.fn();
    render(<PenguinPath tier="little" progress={progress} onComplete={complete} onBack={back} soundOn={false}/>);
    for (const [key, count] of [['ArrowRight', 4], ['ArrowDown', 2], ['ArrowLeft', 4], ['ArrowDown', 2], ['ArrowRight', 4]] as const) {
      for (let index = 0; index < count; index++) fireEvent.keyDown(window, { key });
    }
    expect(screen.getByRole('dialog', { name: 'Trail complete' })).toBeTruthy();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith({ score: 500, stars: 3, level: 2 });
    expect(audio.play).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'ArrowDown' }); fireEvent.keyDown(window, { key: 'Enter' });
    expect(back).toHaveBeenCalledTimes(1);
  });
  it('creates exactly two cards per educational pair at every tier', () => {
    for (const tier of ['little', 'kids', 'teens'] as const) {
      const cards = createWinterCards(tier, 4);
      for (const pair of new Set(cards.map(card => card.pair))) expect(cards.filter(card => card.pair === pair)).toHaveLength(2);
      expect(cards.length).toBe(tier === 'little' ? 6 : tier === 'kids' ? 8 : 12);
    }
  });
  it('finishes a memory round once and cancels delayed completion on exit', () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const complete = vi.fn();
    const view = render(<WinterMatch tier="little" progress={progress} onComplete={complete} onBack={vi.fn()} soundOn/>);
    for (let index = 1; index <= 6; index += 2) {
      fireEvent.click(screen.getByRole('button', { name: `Hidden card ${index}` }));
      fireEvent.click(screen.getByRole('button', { name: `Hidden card ${index + 1}` }));
      act(() => { vi.advanceTimersByTime(650); });
    }
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith({ score: 540, stars: 3, level: 2 });
    view.unmount(); complete.mockClear();
    const second = render(<WinterMatch tier="little" progress={progress} onComplete={complete} onBack={vi.fn()} soundOn/>);
    for (let index = 1; index <= 6; index += 2) {
      fireEvent.click(screen.getByRole('button', { name: `Hidden card ${index}` }));
      fireEvent.click(screen.getByRole('button', { name: `Hidden card ${index + 1}` }));
      if (index !== 5) act(() => { vi.advanceTimersByTime(650); });
    }
    second.unmount(); act(() => { vi.advanceTimersByTime(1000); });
    expect(complete).not.toHaveBeenCalled();
  });
});
