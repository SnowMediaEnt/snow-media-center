import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) },
}));

import TVTrivia, { TRIVIA_QUESTIONS, TRIVIA_SESSION_LENGTH, createTriviaSession } from './TVTrivia';

const answerButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-trivia-answer]'));

const visibleQuestion = () => {
  const heading = screen.getByRole('heading', { level: 2 });
  const question = TRIVIA_QUESTIONS.find((candidate) => candidate.prompt === heading.textContent);
  if (!question) throw new Error(`Question not found: ${heading.textContent ?? ''}`);
  return question;
};

const answerCorrectly = () => {
  const question = visibleQuestion();
  fireEvent.click(answerButtons()[question.correct]);
  return question;
};

const answerIncorrectly = () => {
  const question = visibleQuestion();
  const wrong = question.correct === 0 ? 1 : 0;
  fireEvent.click(answerButtons()[wrong]);
  return question;
};

describe('TV Trivia', () => {
  beforeEach(() => {
    localStorage.clear();
    // Stable sessions make the assertions repeatable while still exercising
    // the real category-balanced session builder.
    vi.spyOn(Math, 'random').mockReturnValue(0.31);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.dir = 'ltr';
    document.querySelectorAll('[data-test-modal="true"]').forEach((node) => node.remove());
  });

  it('builds a ten-question session containing every family-friendly category', () => {
    const session = createTriviaSession();
    expect(session).toHaveLength(TRIVIA_SESSION_LENGTH);
    expect(new Set(session.map((question) => question.category))).toEqual(
      new Set(['science', 'screen', 'world', 'music', 'sports', 'nature']),
    );
    expect(new Set(session.map((question) => question.id)).size).toBe(TRIVIA_SESSION_LENGTH);
  });

  it('starts with readable session status and makes clear that play is coin-free', async () => {
    render(<TVTrivia onBack={() => {}} />);
    expect(screen.getByText('Question 1 of 10')).toBeTruthy();
    expect(screen.getByText(/Free play · no Snow Coins used/)).toBeTruthy();
    expect(answerButtons()).toHaveLength(4);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    await waitFor(() => expect(document.activeElement).toBe(answerButtons()[0]));
  });

  it('scores correct answers, grows a streak, and resets the streak after a miss', () => {
    render(<TVTrivia onBack={() => {}} />);

    const first = answerCorrectly();
    expect(screen.getByText(first.fact)).toBeTruthy();
    expect(screen.getByLabelText('Score 100')).toBeTruthy();
    expect(screen.getByLabelText('Streak 1')).toBeTruthy();
    expect(answerButtons()[first.correct].className).toContain('is-correct');

    fireEvent.click(screen.getByRole('button', { name: 'Next Question' }));
    answerCorrectly();
    expect(screen.getByLabelText('Score 225')).toBeTruthy();
    expect(screen.getByLabelText('Streak 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next Question' }));
    answerIncorrectly();
    expect(screen.getByLabelText('Score 225')).toBeTruthy();
    expect(screen.getByLabelText('Streak 0')).toBeTruthy();
    expect(screen.getByText('Not quite')).toBeTruthy();
  });

  it('keeps one managed focus cursor while moving through the two-by-two answer grid', async () => {
    render(<TVTrivia onBack={() => {}} />);
    await waitFor(() => expect(document.activeElement).toBe(answerButtons()[0]));

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(answerButtons()[1]);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(answerButtons()[3]);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(answerButtons()[1]);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /FX Full/ }));
    expect(document.querySelectorAll('[data-tv-focused="true"]')).toHaveLength(1);
  });

  it('moves with the mirrored answer grid in RTL', async () => {
    document.documentElement.dir = 'rtl';
    render(<TVTrivia onBack={() => {}} />);
    await waitFor(() => expect(document.activeElement).toBe(answerButtons()[0]));

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(answerButtons()[1]);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(answerButtons()[0]);
  });

  it('activates an answer once for DPAD_CENTER and ignores a held repeat', () => {
    render(<TVTrivia onBack={() => {}} />);
    const question = visibleQuestion();
    act(() => answerButtons()[question.correct].focus());

    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 23 });
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 23, repeat: true });
    fireEvent.keyUp(window, { key: 'Unidentified', keyCode: 23 });

    expect(screen.getByLabelText('Score 100')).toBeTruthy();
    expect(screen.getByText(/^Correct!/)).toBeTruthy();
  });

  it('yields arrows and OK completely while a global modal owns input', async () => {
    render(<TVTrivia onBack={() => {}} />);
    await waitFor(() => expect(document.activeElement).toBe(answerButtons()[0]));
    const focusedBefore = document.activeElement;
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('data-test-modal', 'true');
    document.body.appendChild(modal);

    expect(fireEvent.keyDown(window, { key: 'ArrowRight' })).toBe(true);
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyUp(window, { key: 'Enter' });
    expect(document.activeElement).toBe(focusedBefore);
    expect(screen.queryByText(/^Correct!/)).toBeNull();
    expect(screen.queryByText('Not quite')).toBeNull();
  });

  it('hands one TV Back press to the lounge callback', () => {
    const onBack = vi.fn();
    render(<TVTrivia onBack={onBack} />);
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 4 });
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 4, repeat: true });
    fireEvent.keyUp(window, { key: 'Unidentified', keyCode: 4 });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('finishes a session and starts a clean rematch without any backend state', () => {
    render(<TVTrivia onBack={() => {}} />);
    for (let index = 0; index < TRIVIA_SESSION_LENGTH; index += 1) {
      answerCorrectly();
      fireEvent.click(screen.getByRole('button', { name: index === TRIVIA_SESSION_LENGTH - 1 ? 'See Results' : 'Next Question' }));
    }

    expect(screen.getByRole('heading', { level: 2, name: 'Perfect game!' })).toBeTruthy();
    expect(screen.getByText(/10 of 10/)).toBeTruthy();
    expect(screen.getByLabelText('Score 2,125')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Play Another Round/ }));
    expect(screen.getByText('Question 1 of 10')).toBeTruthy();
    expect(screen.getByLabelText('Score 0')).toBeTruthy();
    expect(screen.getByLabelText('Streak 0')).toBeTruthy();
  });
});
