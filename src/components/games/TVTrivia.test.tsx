import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) },
}));

const audioHarness = vi.hoisted(() => ({
  play: vi.fn(),
  toggleMuted: vi.fn(),
}));

vi.mock('./shared/gameAudio', async () => {
  const React = await import('react');
  return {
    useGameAudio: () => {
      const [muted, setMuted] = React.useState(false);
      return {
        muted,
        play: audioHarness.play,
        toggleMuted: (gesture?: { readonly isTrusted: boolean }) => {
          audioHarness.toggleMuted(gesture);
          setMuted((current) => !current);
        },
      };
    },
  };
});

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
    audioHarness.play.mockReset();
    audioHarness.toggleMuted.mockReset();
    // Stable sessions make the assertions repeatable while still exercising
    // the real category-balanced session builder.
    vi.spyOn(Math, 'random').mockReturnValue(0.31);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.dir = 'ltr';
    document.querySelectorAll('[data-test-modal="true"]').forEach((node) => node.remove());
  });

  it('builds a ten-question real-world session without Snow Media questions', () => {
    const session = createTriviaSession();
    expect(session).toHaveLength(TRIVIA_SESSION_LENGTH);
    expect(new Set(session.map((question) => question.category))).toEqual(
      new Set(['science', 'screen', 'world', 'music', 'sports', 'nature']),
    );
    expect(new Set(session.map((question) => question.id)).size).toBe(TRIVIA_SESSION_LENGTH);
  });

  it('builds a full Snow Media challenge from devices, service, app, and history questions', () => {
    const session = createTriviaSession(TRIVIA_QUESTIONS, 'snow');
    expect(session).toHaveLength(TRIVIA_SESSION_LENGTH);
    expect(session.every((question) => question.category === 'snow')).toBe(true);
    expect(new Set(session.map((question) => question.topic))).toEqual(
      new Set(['devices', 'service', 'app', 'history']),
    );
  });

  it('starts with readable session status and makes clear that play is coin-free', async () => {
    render(<TVTrivia onBack={() => {}} />);
    expect(screen.getByText('Question 1 of 10')).toBeTruthy();
    expect(screen.getByText(/Guest practice/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Snow Media.*mode/ })).toBeTruthy();
    expect(screen.getByText(/Snow Media ·/)).toBeTruthy();
    expect(answerButtons()).toHaveLength(4);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    await waitFor(() => expect(document.activeElement).toBe(answerButtons()[0]));
  });

  it('switches between the Snow Media challenge and an all-topics round', () => {
    render(<TVTrivia onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Snow Media.*mode/ }));

    expect(screen.getByRole('button', { name: /Real world random mode/ })).toBeTruthy();
    expect(screen.getByText(/Real World Random/)).toBeTruthy();
    expect(screen.getByLabelText('Score 0')).toBeTruthy();
    expect(localStorage.getItem('smc-tv-trivia-mode-v1')).toBe('mixed');
  });

  it('scores correct answers, grows a streak, and resets the streak after a miss', () => {
    render(<TVTrivia onBack={() => {}} />);

    const first = answerCorrectly();
    expect(screen.getByText(first.fact)).toBeTruthy();
    expect(screen.getByLabelText('Score 150')).toBeTruthy();
    expect(screen.getByLabelText('Streak 1')).toBeTruthy();
    expect(answerButtons()[first.correct].className).toContain('is-correct');

    fireEvent.click(screen.getByRole('button', { name: 'Next Question' }));
    answerCorrectly();
    expect(screen.getByLabelText('Score 325')).toBeTruthy();
    expect(screen.getByLabelText('Streak 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next Question' }));
    answerIncorrectly();
    expect(screen.getByLabelText('Score 325')).toBeTruthy();
    expect(screen.getByLabelText('Streak 0')).toBeTruthy();
    expect(screen.getByText('Not quite')).toBeTruthy();
  });

  it('plays exactly one resolved-answer cue and ignores a second click on that answer', () => {
    render(<TVTrivia onBack={() => {}} />);

    const first = answerCorrectly();
    fireEvent.click(answerButtons()[first.correct]);
    expect(audioHarness.play.mock.calls.filter(([cue]) => cue === 'triviaCorrect')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Next Question' }));
    const second = answerIncorrectly();
    const wrongIndex = second.correct === 0 ? 1 : 0;
    fireEvent.click(answerButtons()[wrongIndex]);
    expect(audioHarness.play.mock.calls.filter(([cue]) => cue === 'triviaCorrect')).toHaveLength(1);
    expect(audioHarness.play.mock.calls.filter(([cue]) => cue === 'triviaWrong')).toHaveLength(1);
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

  it('keeps mode, difficulty, sound, and FX controls inside one explicit TV focus graph', async () => {
    render(<TVTrivia onBack={() => {}} />);
    await waitFor(() => expect(document.activeElement).toBe(answerButtons()[0]));

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back to Lounge' }));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Snow Media.*mode/ }));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /standard difficulty/ }));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mute game sounds' }));

    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyUp(window, { key: 'Enter' });
    expect(audioHarness.toggleMuted).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Unmute game sounds' }));
    expect(document.querySelectorAll('[data-tv-focused="true"]')).toHaveLength(1);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
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

    expect(screen.getByLabelText('Score 150')).toBeTruthy();
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
      if (index === TRIVIA_SESSION_LENGTH - 1) {
        expect(audioHarness.play.mock.calls.filter(([cue]) => cue === 'win')).toHaveLength(0);
      }
      fireEvent.click(screen.getByRole('button', { name: index === TRIVIA_SESSION_LENGTH - 1 ? 'See Results' : 'Next Question' }));
    }

    expect(screen.getByRole('heading', { level: 2, name: 'Perfect game!' })).toBeTruthy();
    expect(screen.getByText(/10 of 10/)).toBeTruthy();
    expect(screen.getByLabelText('Score 2,625')).toBeTruthy();
    expect(audioHarness.play.mock.calls.filter(([cue]) => cue === 'triviaCorrect')).toHaveLength(TRIVIA_SESSION_LENGTH);
    expect(audioHarness.play.mock.calls.filter(([cue]) => cue === 'win')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Play Another Round/ }));
    expect(screen.getByText('Question 1 of 10')).toBeTruthy();
    expect(screen.getByLabelText('Score 0')).toBeTruthy();
    expect(screen.getByLabelText('Streak 0')).toBeTruthy();
  });

  it('does not add a celebratory win cue to a low-score results screen', () => {
    render(<TVTrivia onBack={() => {}} />);
    for (let index = 0; index < TRIVIA_SESSION_LENGTH; index += 1) {
      answerIncorrectly();
      fireEvent.click(screen.getByRole('button', { name: index === TRIVIA_SESSION_LENGTH - 1 ? 'See Results' : 'Next Question' }));
    }

    expect(screen.getByRole('heading', { level: 2, name: 'Ready for a rematch?' })).toBeTruthy();
    expect(audioHarness.play.mock.calls.filter(([cue]) => cue === 'triviaWrong')).toHaveLength(TRIVIA_SESSION_LENGTH);
    expect(audioHarness.play.mock.calls.filter(([cue]) => cue === 'win')).toHaveLength(0);
  });
});
