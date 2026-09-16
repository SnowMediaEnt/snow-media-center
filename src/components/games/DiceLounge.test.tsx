import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useGameSocket', () => ({
  useGameSocket: () => ({ balance: 12345, status: 'connected' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import DiceLounge, { rollDice, scoreDice, type DieValue } from './DiceLounge';

const finishRoll = () => {
  act(() => { vi.advanceTimersByTime(800); });
};

const faceFrom = (button: HTMLElement): number => {
  const match = button.getAttribute('aria-label')?.match(/Die \d, ([1-6])/);
  if (!match) throw new Error(`No die face in label: ${button.getAttribute('aria-label')}`);
  return Number(match[1]);
};

describe('Dice Lounge scoring', () => {
  it.each([
    [[6, 6, 6, 6, 6], 'five-kind', 50],
    [[1, 2, 3, 4, 5], 'large-straight', 40],
    [[1, 2, 3, 4, 6], 'small-straight', 30],
    [[2, 2, 2, 5, 5], 'full-house', 25],
    [[4, 4, 4, 4, 2], 'four-kind', 18],
    [[3, 3, 3, 1, 6], 'three-kind', 16],
    [[2, 2, 5, 5, 6], 'two-pair', 14],
    [[4, 4, 1, 2, 6], 'pair', 8],
    [[1, 2, 4, 5, 6], 'high-roll', 18],
  ] as const)('scores %j as %s', (dice, key, points) => {
    expect(scoreDice(dice)).toMatchObject({ key, score: points });
  });

  it('preserves held dice and rolls every open die exactly once', () => {
    const values: DieValue[] = [1, 2, 3, 4, 5];
    const held = [true, false, true, false, false];
    const faces = [6, 5, 4];
    let draw = 0;
    expect(rollDice(values, held, () => faces[draw++] as Exclude<DieValue, 0>)).toEqual([1, 6, 3, 5, 4]);
    expect(draw).toBe(3);
  });
});

describe('Dice Lounge TV round', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    act(() => { vi.runOnlyPendingTimers(); });
    vi.useRealTimers();
  });

  it('rolls, holds one die through a reroll, banks, and starts the next round', () => {
    render(<DiceLounge onBack={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'ROLL ALL DICE' }));
    expect(screen.getByRole('button', { name: 'ROLLING…' }).getAttribute('data-busy')).toBe('true');
    finishRoll();

    const dice = screen.getAllByRole('button', { name: /Die [1-5], [1-6]/ });
    expect(dice).toHaveLength(5);
    const firstFace = faceFrom(dice[0]);
    fireEvent.click(dice[0]);
    expect(dice[0].getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'ROLL 2 OF 3' }));
    finishRoll();
    const rerolledDice = screen.getAllByRole('button', { name: /Die [1-5], [1-6]/ });
    expect(faceFrom(rerolledDice[0])).toBe(firstFace);
    expect(rerolledDice[0].getAttribute('aria-label')).toContain('held');

    fireEvent.click(screen.getByRole('button', { name: /BANK \d+ POINTS/ }));
    expect(screen.getByRole('status').textContent).toContain('ROUND BANKED');
    expect(screen.getByRole('button', { name: 'NEXT ROUND' })).toBeTruthy();
    expect(screen.getByLabelText('Session score').textContent).toContain('ROUND1');

    fireEvent.click(screen.getByRole('button', { name: 'NEXT ROUND' }));
    expect(screen.getByRole('button', { name: 'ROLL ALL DICE' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /waiting for the first roll/ })).toHaveLength(5);
    expect(screen.getByLabelText('Session score').textContent).toContain('ROUND2');
  });

  it('moves focus across dice with the D-pad and activates hold once with OK', () => {
    render(<DiceLounge onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'ROLL ALL DICE' }));
    finishRoll();

    const dice = screen.getAllByRole('button', { name: /Die [1-5], [1-6]/ });
    expect(document.activeElement).toBe(dice[0]);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(dice[1]);

    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyUp(window, { key: 'Enter' });
    expect(dice[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('blocks Back only while the one-shot roll animation is active', () => {
    const onBack = vi.fn();
    render(<DiceLounge onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'ROLL ALL DICE' }));

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByText('The dice are still rolling.')).toBeTruthy();
    fireEvent.keyUp(window, { key: 'Escape' });

    finishRoll();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(window, { key: 'Escape' });
  });
});
