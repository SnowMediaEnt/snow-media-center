import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

import { loadSnowTriviaQuestions, SNOW_MEDIA_TRIVIA_FALLBACK } from './triviaQuestions';

const publishedQuestion = {
  id: 'snow-published-device-tip',
  topic: 'devices',
  categoryLabel: 'Snow Media · Devices',
  prompt: 'Which control moves the highlight around a television interface?',
  answers: ['The D-pad', 'The mute key', 'The power cable', 'The HDMI port'],
  correct: 0,
  fact: 'The directional pad moves focus between controls on a television screen.',
  points: 125,
};

describe('Snow Media trivia question loader', () => {
  beforeEach(() => {
    localStorage.clear();
    invoke.mockReset();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('merges validated published rows with the bundled offline bank', async () => {
    invoke.mockResolvedValue({
      data: { ok: true, questions: [publishedQuestion], updatedAt: '2026-09-15T19:00:00.000Z' },
      error: null,
    });

    const result = await loadSnowTriviaQuestions();

    expect(invoke).toHaveBeenCalledWith('trivia-questions', { body: { limit: 100 } });
    expect(result.source).toBe('network');
    expect(result.questions.find((question) => question.id === publishedQuestion.id)).toMatchObject({
      category: 'snow',
      topic: 'devices',
      points: 125,
      origin: 'published',
    });
    expect(result.questions.length).toBe(SNOW_MEDIA_TRIVIA_FALLBACK.length + 1);
  });

  it('uses its sanitized cache without making a request while offline', async () => {
    invoke.mockResolvedValue({ data: { ok: true, questions: [publishedQuestion] }, error: null });
    await loadSnowTriviaQuestions();
    invoke.mockClear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

    const result = await loadSnowTriviaQuestions();

    expect(invoke).not.toHaveBeenCalled();
    expect(result.source).toBe('cache');
    expect(result.questions.find((question) => question.id === publishedQuestion.id)?.origin).toBe('cached');
  });

  it('rejects malformed remote rows and always keeps the bundled bank playable', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        questions: [{ ...publishedQuestion, answers: ['Only one answer'], correct: 9 }],
      },
      error: null,
    });

    const result = await loadSnowTriviaQuestions();

    expect(result.source).toBe('bundled');
    expect(result.questions).toHaveLength(SNOW_MEDIA_TRIVIA_FALLBACK.length);
    expect(result.questions.every((question) => question.origin === 'bundled')).toBe(true);
  });
});
