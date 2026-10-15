import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  auth: { user: { id: 'validated-player' } },
  socket: { balance: 1000, status: 'connected' },
  get: vi.fn(), start: vi.fn(), action: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => harness.auth }));
vi.mock('@/hooks/useGameSocket', () => ({ useGameSocket: () => harness.socket }));
vi.mock('@/lib/gameSocket', () => ({
  gameSocket: { getArcadeSession: harness.get, startArcadeSession: harness.start, arcadeAction: harness.action },
  newArcadeRequestId: () => '12345678-1234-4234-8234-123456789012',
}));
vi.mock('./shared/gameAudio', () => ({ useGameAudio: () => ({ play: vi.fn(), muted: false, toggleMuted: vi.fn() }) }));
vi.mock('./shared/useReducedGameFx', () => ({ useReducedGameFx: () => ({ reducedFx: true, toggleReducedFx: vi.fn() }) }));
import DiceLounge from './DiceLounge';
import TVTrivia from './TVTrivia';

const dice = { ok: true, game: 'dice', status: 'active', sessionId: 'round-dice', version: 0,
  bet: 100, balance: 900, dice: [6,6,6,6,6], holds: Array(5).fill(false), rollsUsed: 1,
  category: 'five-kind', score: 50, multiplier: 6 };
const trivia = { ok: true, game: 'trivia', status: 'active', sessionId: 'round-trivia', version: 0,
  bet: 25, balance: 975, mode: 'snow', difficulty: 'standard', questionIndex: 0, total: 10,
  score: 0, correctCount: 0, streak: 0, bestStreak: 0, selectedAnswer: null,
  question: { id: 'opaque-question', category: 'snow', categoryLabel: 'Snow Media · Devices',
    prompt: 'Which button selects the highlighted item?', answers: ['OK','Back','Home','Menu'] } };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  harness.get.mockReset().mockResolvedValue({ ok: true, status: 'ready' });
  harness.start.mockReset(); harness.action.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe('verified coin rounds on a TV remote', () => {
  it('uses server dice, sends only player choices, pays once, and keeps the selected bet for the next round', async () => {
    harness.start.mockResolvedValue(dice);
    harness.action.mockResolvedValue({ ...dice, status: 'settled', version: 1, payout: 600, net: 500, balance: 1500 });
    render(<DiceLounge onBack={() => {}} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '100' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ROLL ALL DICE' })); });
    act(() => { vi.advanceTimersByTime(160); });
    expect(harness.start.mock.calls[0][0]).toEqual({ game: 'dice', requestId: expect.any(String), bet: 100 });
    expect(screen.getAllByRole('button', { name: /Die [1-5], 6/ })).toHaveLength(5);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'BANK 600 COINS' }));
      fireEvent.click(screen.getByRole('button', { name: 'BANK 600 COINS' }));
    });
    expect(harness.action).toHaveBeenCalledTimes(1);
    expect(harness.action).toHaveBeenCalledWith({ game: 'dice', sessionId: 'round-dice', version: 0, action: 'bank' });
    expect(screen.getByRole('status').textContent).toContain('Round net +500');
    fireEvent.click(screen.getByRole('button', { name: 'NEXT ROUND' }));
    expect(screen.getByRole('button', { name: '100' }).className).toContain('is-selected');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'ROLL ALL DICE' }));
  });

  it('retries a timed-out first roll with the same request ID', async () => {
    harness.start.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(dice);
    render(<DiceLounge onBack={() => {}} />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ROLL ALL DICE' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ROLL ALL DICE' })); });
    act(() => { vi.advanceTimersByTime(160); });
    expect(harness.start.mock.calls[0][0].requestId).toBe(harness.start.mock.calls[1][0].requestId);
    expect(screen.getAllByRole('button', { name: /Die [1-5], 6/ })).toHaveLength(5);
  });

  it('restores an unfinished dice round without placing another bet', async () => {
    harness.get.mockResolvedValue({ ...dice, version: 1, rollsUsed: 2 });
    render(<DiceLounge onBack={() => {}} />);
    await act(async () => {});
    expect(harness.start).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'FINAL ROLL' })).toBeTruthy();
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/Die 1, 6/);
  });

  it('starts trivia explicitly and waits for server grading before showing correctness', async () => {
    harness.start.mockResolvedValue(trivia);
    let reply: (value: unknown) => void = () => {};
    harness.action.mockImplementation(() => new Promise((resolve) => { reply = resolve; }));
    render(<TVTrivia onBack={() => {}} />);
    await act(async () => {});
    expect(harness.start).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('aria-label')).toContain('mode');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start Challenge' })); });
    expect(harness.start.mock.calls[0][0]).toMatchObject({ game: 'trivia', bet: 25, mode: 'snow', difficulty: 'standard' });
    const answer = screen.getByRole('button', { name: 'A. OK' });
    fireEvent.click(answer); fireEvent.click(answer);
    expect(harness.action).toHaveBeenCalledTimes(1);
    expect(harness.action.mock.calls[0][0]).toEqual({ game: 'trivia', sessionId: 'round-trivia', version: 0,
      action: 'answer', questionId: 'opaque-question', answerIndex: 0 });
    expect(screen.queryByRole('button', { name: /correct answer/ })).toBeNull();
    await act(async () => { reply({ ...trivia, version: 1, selectedAnswer: 0, score: 150, correctCount: 1, streak: 1,
      question: { ...trivia.question, correct: 0, fact: 'The center OK button selects the highlighted item.' } }); });
    expect(screen.getByRole('button', { name: 'A. OK, correct answer' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next Question' }));
  });

  it('restores the final trivia result with the server coin return and net', async () => {
    harness.get.mockResolvedValue({ ...trivia, status: 'settled', version: 19, questionIndex: 9,
      selectedAnswer: 0, score: 1500, correctCount: 10, streak: 10, bestStreak: 10, payout: 100, net: 75,
      question: { ...trivia.question, correct: 0, fact: 'Verified explanation.' } });
    render(<TVTrivia onBack={() => {}} />);
    await act(async () => {});
    expect(screen.getByLabelText('Trivia results').textContent).toContain('Round net +75');
    expect(harness.action).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Play Another Round' }));
  });
});
