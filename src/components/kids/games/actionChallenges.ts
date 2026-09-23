export type ActionTier = 'little' | 'kids' | 'teens';
export interface ActionChallenge { prompt: string; hint: string; answers: string[]; correct: number; symbol?: string }
const shapes = ['●', '▲', '■', '★', '♥', '◆'];
const names = ['circle', 'triangle', 'square', 'star', 'heart', 'diamond'];

/** A stable curriculum with rotating answer positions, so position cannot be memorized. */
export function actionChallenge(tier: ActionTier, level: number, round: number, count: number): ActionChallenge {
  const stage = Math.max(1, Math.min(99, Math.floor(level || 1)));
  const seed = (stage - 1) * 8 + round;
  let prompt: string, hint: string, answers: string[], symbol: string | undefined;
  if (tier === 'little' && seed % 2 === 0) {
    const index = Math.floor(seed / 2) % shapes.length;
    symbol = shapes[index];
    prompt = `Find the ${names[index]}`;
    hint = `Look for this shape: ${symbol}`;
    answers = [symbol, ...shapes.filter((s) => s !== symbol)].slice(0, count);
  } else if (tier === 'little') {
    const number = 1 + seed % 5;
    symbol = '● '.repeat(number).trim();
    prompt = 'How many snowballs?';
    hint = `Count them one at a time. There are ${number}.`;
    answers = [String(number), ...[1, 2, 3, 4, 5, 6, 7].filter((n) => n !== number).map(String)].slice(0, count);
  } else {
    const a = 2 + seed % (tier === 'teens' ? 11 : Math.min(15, 4 + stage));
    const b = 1 + (seed * 3) % (tier === 'teens' ? 9 : Math.min(10, 3 + stage));
    const multiply = tier === 'teens' || (stage > 4 && seed % 3 === 0);
    const subtract = !multiply && seed % 3 === 1;
    const value = multiply ? a * b : subtract ? Math.max(a, b) - Math.min(a, b) : a + b;
    prompt = multiply ? `${a} × ${b} = ?` : subtract ? `${Math.max(a, b)} − ${Math.min(a, b)} = ?` : `${a} + ${b} = ?`;
    hint = multiply ? `${a} groups of ${b} make ${value}.` : `${prompt.replace('?', String(value))}`;
    const candidates = Array.from({ length: count * 2 }, (_, i) => Math.max(0, value - 2) + i).filter((n) => n !== value);
    answers = [String(value), ...candidates.map(String)].slice(0, count);
  }
  const correct = (seed * 5 + stage) % count;
  const answer = answers.shift()!;
  answers.splice(correct, 0, answer);
  return { prompt, hint, answers, correct, symbol };
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
