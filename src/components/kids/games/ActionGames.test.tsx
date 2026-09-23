import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SnowballSplash from './SnowballSplash';
import SledDash from './SledDash';
import { sledChallenge, snowballChallenge } from './actionChallenges';

vi.mock('../../games/shared/gameAudio', () => ({ useGameAudio: () => ({ play: vi.fn() }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe.each([{ name: 'Snowball', Component: SnowballSplash, challenge: snowballChallenge, label: 'Target' }, { name: 'Sled', Component: SledDash, challenge: sledChallenge, label: 'Gate' }])('$name round lifecycle', ({ Component, challenge, label }) => {
  it('saves a completed run once and ignores repeated actions during celebration', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(<Component tier="kids" progress={{ plays: 0, bestScore: 0, stars: 0, level: 1 }} onComplete={onComplete} onBack={vi.fn()} soundOn={false}/>);
    for (let round = 0; round < 8; round++) {
      const question = challenge('kids', 1, round);
      const button = screen.getByRole('button', { name: `${label} ${question.answers[question.correct]}` });
      fireEvent.click(button); fireEvent.click(button);
      act(() => vi.advanceTimersByTime(1100));
    }
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({ score: 800, stars: 3, level: 2 });
  });
  it('leaves Back navigation to the lounge and cancels delayed work on exit', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const view = render(<Component tier="little" progress={{ plays: 0, bestScore: 0, stars: 0, level: 1 }} onComplete={onComplete} onBack={vi.fn()} soundOn={false}/>);
    expect(fireEvent.keyDown(window, { key: 'Escape', cancelable: true })).toBe(true);
    const question = challenge('little', 1, 0);
    fireEvent.click(screen.getByRole('button', { name: `${label} ${question.answers[question.correct]}` }));
    view.unmount();
    act(() => vi.runAllTimers());
    expect(onComplete).not.toHaveBeenCalled();
  });
});
