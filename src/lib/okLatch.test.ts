// okLatch: a held OK is one press, whatever e.repeat says (some WebViews send
// a held key's repeats with it false), and a player opened by a held OK
// ignores that OK until it is let go.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetOkLatchForTests, okIsRepeat, okPressMark, okSamePress } from './okLatch';

const ev = (type: 'keydown' | 'keyup', key = 'Enter', repeat = false) => {
  const e = new KeyboardEvent(type, { key, repeat, bubbles: true, cancelable: true });
  window.dispatchEvent(e);
  return e;
};

beforeEach(() => { __resetOkLatchForTests(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('okIsRepeat', () => {
  it('a new press is not a repeat; the held key\'s further keydowns are, even with e.repeat false', () => {
    expect(okIsRepeat(ev('keydown'))).toBe(false);
    vi.advanceTimersByTime(500);
    expect(okIsRepeat(ev('keydown'))).toBe(true);
    vi.advanceTimersByTime(50);
    expect(okIsRepeat(ev('keydown', 'Enter', true))).toBe(true);
    ev('keyup');
    expect(okIsRepeat(ev('keydown'))).toBe(false);
  });

  it('answers the same for one event however often it is asked', () => {
    const e = ev('keydown');
    expect(okIsRepeat(e)).toBe(false);
    expect(okIsRepeat(e)).toBe(false);
  });

  it('a lost keyup costs nothing: another key, or a long gap, makes the next OK new', () => {
    ev('keydown');
    ev('keydown', 'ArrowDown');
    expect(okIsRepeat(ev('keydown'))).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(okIsRepeat(ev('keydown'))).toBe(false);
  });

  it('is false for any key but OK', () => {
    ev('keydown');
    expect(okIsRepeat(ev('keydown', 'ArrowLeft', true))).toBe(false);
  });
});

describe('okSamePress (a player opened by a held OK)', () => {
  it('ignores that OK, its repeats included, until it is let go; the next press is the player\'s', () => {
    ev('keydown');                    // the OK that opened it, still down
    const mark = okPressMark();
    expect(mark.held).toBe(true);
    vi.advanceTimersByTime(500);
    expect(okSamePress(ev('keydown'), mark)).toBe(true);
    vi.advanceTimersByTime(50);
    expect(okSamePress(ev('keydown'), mark)).toBe(true);
    ev('keyup');
    expect(okSamePress(ev('keydown'), mark)).toBe(false);
  });

  it('opened with OK not down (a press already let go, a tap): the first OK counts', () => {
    ev('keydown'); ev('keyup');
    const mark = okPressMark();
    expect(mark.held).toBe(false);
    expect(okSamePress(ev('keydown'), mark)).toBe(false);
  });
});
