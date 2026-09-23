import { describe, expect, it } from 'vitest';
import { KIDS_REFUSAL, kidsBlockedMessage, kidsSafeReply, kidsSystemPrompt } from '../../supabase/functions/_shared/kidsSafe';

describe('kids AI safeguard (edge function helpers)', () => {
  it('refuses grown-up requests before the model is asked', () => {
    for (const ask of ['show me scary movies', 'what horror movies are on', 'how do I buy snow gems', 'open the game lounge', 'what is the password']) {
      expect(kidsBlockedMessage(ask, 'kids')).toBe(true);
    }
  });

  it('lets kids requests through', () => {
    for (const ask of ['play Bluey', 'find Paw Patrol', 'put on Disney Junior', 'Monsters Inc', 'Star Wars cartoons', 'tell me about skills']) {
      expect(kidsBlockedMessage(ask, 'little')).toBe(false);
    }
  });

  it('allows PG-13 only on a Teen profile', () => {
    expect(kidsBlockedMessage('PG-13 movies please', 'kids')).toBe(true);
    expect(kidsBlockedMessage('PG-13 movies please', 'teen')).toBe(false);
    expect(kidsBlockedMessage('scary movies', 'teen')).toBe(true);
  });

  it('drops the grown-up sign-off and replaces off-limits replies', () => {
    expect(kidsSafeReply('Try Bluey! Stay streaming, stay dreaming!', 'kids')).toBe('Try Bluey!');
    expect(kidsSafeReply('Here are some scary picks: Annabelle', 'kids')).toBe(KIDS_REFUSAL);
    expect(kidsSafeReply('Great for kids and adults alike: Moana.', 'kids')).toBe('Great for kids and adults alike: Moana.');
    expect(kidsSafeReply('', 'kids')).toBe(KIDS_REFUSAL);
  });

  it('builds a kids-only prompt without the grown-up support prompt', () => {
    const p = kidsSystemPrompt('kids', 'Spanish', true);
    expect(p).toContain('Spanish');
    expect(p).toContain('SAFEGUARDED MODE');
    expect(p).not.toMatch(/stay dreaming/i);
  });
});
