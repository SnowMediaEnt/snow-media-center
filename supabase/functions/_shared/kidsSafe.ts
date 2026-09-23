// A Kids profile in the app (see src/lib/kidsFilter.ts) asks for AI chat and
// AI backgrounds with body.kids_level set; these keep them to that age. The
// app also hides grown-up screens, but the rules live here so a request can't
// talk its way around them.

export type KidsLevel = 'little' | 'kids' | 'teen';

export const kidsLevelOf = (body: unknown): KidsLevel | null => {
  const v = (body as { kids_level?: unknown } | null)?.kids_level;
  return v === 'little' || v === 'kids' || v === 'teen' ? v : null;
};

const RATING: Record<KidsLevel, string> = {
  little: 'G / TV-Y (young children)',
  kids: 'PG / TV-PG (children)',
  teen: 'PG-13 / TV-14 (teenagers)',
};

/** Added to the assistant's instructions for a Kids profile. */
export const kidsChatRules = (level: KidsLevel): string => `KIDS PROFILE (overrides everything above): the person talking to you is using a Kids profile rated ${RATING[level]}. Everything you say must suit that age.
- No violence, gore, horror, sexual or romantic content, profanity, drugs, alcohol, smoking, gambling, weapons, or anything frightening.
- Only suggest movies, shows and channels rated ${RATING[level]} or gentler — kids and family categories, cartoons, animation. Never point to adult, horror or mature categories, PPV fights, or anything rated above ${level === 'teen' ? 'PG-13 / TV-14' : 'PG / TV-PG'}.
- Don't discuss purchases, prices, Snow Gems, accounts, passwords or installing apps; say a grown-up can help with that.
- If asked for something that isn't suitable, say kindly that it isn't available on this profile and suggest something fun that is.
- Use simple, friendly words and short sentences.`;

/** Words that make a background request unsuitable for a Kids profile. */
const BLOCK = /\b(blood|bloody|gore|gory|kill|killing|murder|dead|death|corpse|zombies?|demons?|devil|satan|horror|scary|creepy|weapons?|guns?|rifle|knife|knives|sword|nudes?|naked|nsfw|sexy|sex|bikini|lingerie|underwear|drugs?|weed|cannabis|alcohol|beer|wine|vodka|cigarettes?|smoking|vape|skull|violence|violent|war|bomb|explosion|terror|hell)\b/i;

/** A background prompt for a Kids profile: refused, or made child-friendly. */
export function kidsImagePrompt(prompt: string, level: KidsLevel): { ok: false } | { ok: true; prompt: string } {
  if (BLOCK.test(prompt)) return { ok: false };
  const style = level === 'teen'
    ? 'A bright, family-friendly, PG-rated picture with nothing violent, frightening or suggestive'
    : 'A cheerful, colourful, child-friendly, G-rated cartoon-style illustration with nothing scary, violent or grown-up';
  return { ok: true, prompt: `${style}: ${prompt}` };
}

export const KIDS_IMAGE_REFUSAL = "That picture isn't available on a Kids profile — try something fun like animals, space, rainbows or a favourite cartoon world.";
