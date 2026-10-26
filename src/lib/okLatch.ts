// Is this OK a new press, or the same held OK still repeating?
//
// A held OK on a TV remote arrives as a stream of keydowns, and some
// WebViews send those repeats with e.repeat false (ServicesScreen's tests).
// Trusting e.repeat let a held OK that opened a film run on into the player
// and toggle pause/play over and over (owner, 1.9.8). Here an OK keydown is
// a repeat when it says so, or when no OK keyup came since the last OK
// keydown: the key never went up, so it is the same press.
//
// A keyup can go missing (the keyboard took it, the app lost focus): an OK
// that comes long after the last one, with no keyup between, is new again,
// so a lost keyup costs nothing.
//
//   okIsRepeat(e)   the OK keydown `e` is a held OK repeating (false for
//                   any other key)
//   okPressMark()   taken as a player (or a menu) opens: which press is down
//   okSamePress(e, mark)
//                   `e` belongs to the press that was down at the mark: the
//                   held OK that opened it. Ignore OK until it is let go.

/** OK on a TV remote: Enter / Space, or DPAD_CENTER (23) / ENTER (66) with no useful key. */
export const isOkKey = (e: KeyboardEvent): boolean =>
  e.key === 'Enter' || e.key === ' ' || e.keyCode === 23 || e.keyCode === 66;

/** A held key repeats every ~50 ms after ~500 ms; a gap longer than this is a new press. */
const LOST_KEYUP_MS = 900;

let down = false;
let presses = 0;
let lastDownAt = 0;
// Each OK keydown is judged once, by whoever sees it first (the listener
// below or a handler that asks before it): the answer is the same for all.
const judged = new WeakMap<KeyboardEvent, boolean>();

const now = (): number => Date.now();

function judge(e: KeyboardEvent): boolean {
  const known = judged.get(e);
  if (known !== undefined) return known;
  const t = now();
  const repeat = e.repeat || (down && t - lastDownAt < LOST_KEYUP_MS);
  if (!repeat) presses += 1;
  down = true;
  lastDownAt = t;
  judged.set(e, repeat);
  return repeat;
}

/** The OK keydown `e` is a held OK repeating, not a new press. */
export function okIsRepeat(e: KeyboardEvent): boolean {
  return isOkKey(e) && judge(e);
}

export interface OkMark { held: boolean; press: number }

/** Which OK press is down right now (none: held false). */
export function okPressMark(): OkMark {
  const held = down && now() - lastDownAt < LOST_KEYUP_MS;
  return { held, press: presses };
}

/** The OK keydown `e` is still the press that was down at `mark`. */
export function okSamePress(e: KeyboardEvent, mark: OkMark): boolean {
  if (!isOkKey(e)) return false;
  judge(e);
  return mark.held && presses === mark.press;
}

if (typeof window !== 'undefined') {
  // Any other key going down: the OK is not held any more (a held OK sends
  // only OK), even if its keyup never came.
  window.addEventListener('keydown', (e) => { if (isOkKey(e)) judge(e); else down = false; }, true);
  window.addEventListener('keyup', (e) => { if (isOkKey(e)) down = false; }, true);
  window.addEventListener('blur', () => { down = false; });
}

/** Tests only. */
export function __resetOkLatchForTests(): void {
  down = false; presses = 0; lastDownAt = 0;
}
