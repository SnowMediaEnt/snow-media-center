export type ActionTier = 'little' | 'kids' | 'teens';
export interface ActionChallenge {
  prompt: string;
  hint: string;
  answers: string[];
  correct: number;
  symbol?: string;
  kind?: 'color' | 'shape';
  clueColor?: string;
}

const colors = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange'];
export const SNOWBALL_COLORS: Record<string, string> = {
  Red: '#e95167', Blue: '#2a95e0', Yellow: '#ffd34f',
  Green: '#4ebd87', Purple: '#a777d8', Orange: '#f59c4a',
};
const shapes = [
  { name: 'circle', glyph: '●' }, { name: 'triangle', glyph: '▲' },
  { name: 'square', glyph: '■' }, { name: 'star', glyph: '★' },
  { name: 'heart', glyph: '♥' }, { name: 'diamond', glyph: '◆' },
];
const mixes = [
  { first: 'Red', second: 'Yellow', result: 'Orange' },
  { first: 'Blue', second: 'Yellow', result: 'Green' },
  { first: 'Red', second: 'Blue', result: 'Purple' },
];

function choices(answer: string, pool: string[], count: number, seed: number) {
  const others = pool.filter(item => item !== answer);
  const offset = seed % others.length;
  const answers = [answer, ...Array.from({ length: count - 1 }, (_, index) => others[(offset + index) % others.length])];
  const correct = (seed * 5 + 1) % count;
  answers.splice(correct, 0, answers.shift()!);
  return { answers, correct };
}

/** Snowball Splash teaches colors and shapes, not arithmetic. */
export function snowballChallenge(tier: ActionTier, level: number, round: number): ActionChallenge {
  const seed = (Math.max(1, level) - 1) * 8 + round;
  if (tier === 'teens' || (tier === 'kids' && level >= 3 && round % 3 === 2)) {
    const mix = mixes[seed % mixes.length];
    return {
      prompt: `Mix ${mix.first} and ${mix.second}. Which color appears?`,
      hint: `Mix ${mix.first.toLowerCase()} and ${mix.second.toLowerCase()} to make ${mix.result.toLowerCase()}.`,
      kind: 'color', ...choices(mix.result, colors, 6, seed),
    };
  }
  if (round % 2 === 1) {
    const shape = shapes[seed % shapes.length];
    return {
      prompt: `Find the ${shape.name}!`, hint: `Look for this shape: ${shape.glyph}`,
      kind: 'shape', symbol: shape.glyph,
      ...choices(shape.glyph, shapes.map(item => item.glyph), 6, seed),
    };
  }
  const color = colors[seed % colors.length];
  return {
    prompt: `Splash the ${color.toUpperCase()} snowball!`,
    hint: `Look for the ${color.toLowerCase()} snowball.`,
    kind: 'color', clueColor: color,
    ...choices(color, colors, 6, seed),
  };
}

const pictureWords = [
  { picture: '☀️', word: 'SUN' }, { picture: '🐈', word: 'CAT' },
  { picture: '🐕', word: 'DOG' }, { picture: '🐟', word: 'FISH' },
  { picture: '🌲', word: 'TREE' }, { picture: '⭐', word: 'STAR' },
  { picture: '🌙', word: 'MOON' }, { picture: '🧢', word: 'HAT' },
];
const missingLetters = [
  { picture: '❄️', word: 'SN_W', answer: 'O' },
  { picture: '🌲', word: 'TR_E', answer: 'E' },
  { picture: '🐟', word: 'F_SH', answer: 'I' },
  { picture: '⭐', word: 'ST_R', answer: 'A' },
  { picture: '🌙', word: 'M_ON', answer: 'O' },
  { picture: '🧢', word: 'H_T', answer: 'A' },
  { picture: '🐈', word: 'C_T', answer: 'A' },
  { picture: '📖', word: 'B_OK', answer: 'O' },
];
const wordMeanings = [
  { clue: 'quick', answer: 'FAST' }, { clue: 'silent', answer: 'QUIET' },
  { clue: 'chilly', answer: 'COLD' }, { clue: 'joyful', answer: 'HAPPY' },
  { clue: 'enormous', answer: 'HUGE' }, { clue: 'brave', answer: 'BOLD' },
  { clue: 'tiny', answer: 'SMALL' }, { clue: 'tired', answer: 'SLEEPY' },
];

/** Sled Dash is a reading and vocabulary game, with age-appropriate gates. */
export function sledChallenge(tier: ActionTier, level: number, round: number): ActionChallenge {
  const seed = (Math.max(1, level) - 1) * 8 + round;
  const curriculumIndex = (round + (Math.max(1, level) - 1) * 3) % 8;
  if (tier === 'teens') {
    const item = wordMeanings[curriculumIndex];
    return {
      prompt: `Which word means “${item.clue}”?`, hint: `${item.answer.toLowerCase()} means ${item.clue}.`,
      ...choices(item.answer, wordMeanings.map(entry => entry.answer), 3, seed),
    };
  }
  if (tier === 'kids' && round % 2 === 1) {
    const item = missingLetters[curriculumIndex];
    return {
      prompt: `Finish the picture word: ${item.word}`, symbol: item.picture,
      hint: `The missing letter is ${item.answer}.`,
      ...choices(item.answer, ['A', 'E', 'I', 'O', 'U'], 3, seed),
    };
  }
  const item = pictureWords[curriculumIndex];
  return {
    prompt: 'Which word matches this picture?', symbol: item.picture,
    hint: `Look for the word ${item.word.toLowerCase()}.`,
    ...choices(item.word, pictureWords.map(entry => entry.word), 3, seed),
  };
}

export function actionKey(event: KeyboardEvent): 'left' | 'right' | 'up' | 'down' | 'ok' | 'back' | null {
  if (event.key === 'ArrowLeft' || event.keyCode === 21) return 'left';
  if (event.key === 'ArrowRight' || event.keyCode === 22) return 'right';
  if (event.key === 'ArrowUp' || event.keyCode === 19) return 'up';
  if (event.key === 'ArrowDown' || event.keyCode === 20) return 'down';
  if (['Enter', ' ', 'Select'].includes(event.key) || [23, 66].includes(event.keyCode)) return 'ok';
  if (['Escape', 'Backspace', 'BrowserBack', 'GoBack'].includes(event.key) || event.keyCode === 4) return 'back';
  return null;
}
