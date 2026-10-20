/**
 * The Search row over the picture (useOverlaySearch), with the box's own
 * keyboard: Amazon's covers the bottom half of the screen and goes away by
 * the box's Back, which JavaScript never sees — only keyboardDidHide — and
 * it sends a parting Enter as it goes. The highlight moves into the results
 * then (or once they come), that Enter plays nothing, the OK that opened the
 * keyboard is not its "done", and a box focusing the field by itself raises
 * no keyboard. Back: the keyboard, then a search opened here; a search the
 * list already had is the list's (its Back goes on).
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverlaySearch, OverlaySearchOptions } from './useOverlaySearch';

const kb = vi.hoisted(() => ({ didHide: [] as Array<() => void>, show: 0, hide: 0 }));
vi.mock('@capacitor/core', async (orig) => {
  const real = await orig<typeof import('@capacitor/core')>();
  return { ...real, Capacitor: { ...real.Capacitor, isNativePlatform: () => true } };
});
vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    addListener: async (event: string, cb: () => void) => {
      if (event === 'keyboardDidHide') kb.didHide.push(cb);
      return { remove: async () => { kb.didHide = kb.didHide.filter((f) => f !== cb); } };
    },
  },
}));
// Asking for the keyboard and putting it away, as the box does it (the field focused / let go).
vi.mock('@/utils/dpadKeyboard', () => ({
  focusTextInputForDpad: async (el: HTMLInputElement | null) => { el?.focus(); kb.show += 1; },
  hideKeyboardForDpad: async (el: HTMLElement | null) => { el?.blur(); kb.hide += 1; },
}));

import { OVERLAY_DISMISS_GRACE_MS, OVERLAY_OPEN_ECHO_MS, useOverlaySearch } from './useOverlaySearch';

const calls = { open: vi.fn(), leave: vi.fn(), toFirst: vi.fn(), idle: vi.fn() };
const api: { current: OverlaySearch | null } = { current: null };

function Field(props: { searchOpen: boolean; count: number }) {
  const o: OverlaySearchOptions = { ...props, open: calls.open, leave: calls.leave, toFirst: calls.toFirst, idle: calls.idle };
  const s = useOverlaySearch(o);
  api.current = s;
  return <input data-testid="f" ref={s.inputRef} readOnly={!s.typing} onFocus={s.onFieldFocus} onBlur={s.onFieldBlur} />;
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const s = () => api.current!;
const field = () => document.querySelector<HTMLInputElement>('[data-testid="f"]')!;
const key = (k: string, extra: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
/** The box's Back closing its keyboard: only the plugin's event reaches the page. */
const boxBack = () => act(() => { for (const f of [...kb.didHide]) f(); });

beforeEach(() => {
  kb.didHide = []; kb.show = 0; kb.hide = 0;
  Object.values(calls).forEach((f) => f.mockClear());
});
afterEach(() => { cleanup(); });

/** On the field, OK: the keyboard up (the search opened, as the section would). */
async function typingWith(count: number, searchOpen = false) {
  const r = render(<Field searchOpen={searchOpen} count={count} />);
  // The keyboardDidHide listener (two dynamic imports: slow under load).
  for (let i = 0; i < 200 && kb.didHide.length === 0; i++) await sleep(10);
  act(() => { s().toField(); });
  act(() => { s().start(); });
  r.rerender(<Field searchOpen count={count} />);
  await flush();
  return r;
}

describe('the keyboard over the picture', () => {
  it('OK on the field opens the search and the keyboard there; the list\'s timer waits', async () => {
    await typingWith(3);
    expect(calls.open).toHaveBeenCalledTimes(1);
    expect(s().typing).toBe(true);
    expect(s().owned).toBe(true);
    expect(document.activeElement).toBe(field());
    expect(field().readOnly).toBe(false);
    expect(kb.show).toBe(1);
    expect(calls.idle).toHaveBeenLastCalledWith(false);
  });

  it('the box\'s Back (keyboardDidHide): into the results, the field let go, its parting Enter is no press', async () => {
    await typingWith(3);
    expect(kb.didHide.length).toBe(1);
    boxBack();
    expect(s().typing).toBe(false);
    expect(s().onField).toBe(false);
    expect(calls.toFirst).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(field());
    expect(calls.idle).toHaveBeenLastCalledWith(true);
    expect(s().partingOk()).toBe(true);
    await sleep(OVERLAY_DISMISS_GRACE_MS + 50);
    expect(s().partingOk()).toBe(false);
  });

  it('no results yet when it went away: the highlight stays on the field and moves into them once they come', async () => {
    const r = await typingWith(0);
    boxBack();
    expect(s().onField).toBe(true);
    expect(calls.toFirst).not.toHaveBeenCalled();
    r.rerender(<Field searchOpen count={2} />);
    expect(s().onField).toBe(false);
    expect(calls.toFirst).toHaveBeenCalledTimes(1);
  });

  it('…unless the viewer moved on meanwhile', async () => {
    const r = await typingWith(0);
    boxBack();
    act(() => { s().offField(); }); // ◀ to the categories, say
    r.rerender(<Field searchOpen count={2} />);
    expect(calls.toFirst).not.toHaveBeenCalled();
  });

  it('the OK that opened it, echoed as Enter, is not its "done"; the keyboard\'s Enter later is', async () => {
    await typingWith(3);
    const echo = key('Enter', { keyCode: 13 });
    act(() => { expect(s().typingKey(echo)).toBe(true); });
    expect(echo.defaultPrevented).toBe(true);
    expect(s().typing).toBe(true);
    await sleep(OVERLAY_OPEN_ECHO_MS + 50);
    act(() => { expect(s().typingKey(key('Enter', { keyCode: 13 }))).toBe(true); });
    expect(s().typing).toBe(false);
    expect(s().onField).toBe(false);
    await flush();
    expect(kb.hide).toBe(1);
  });

  it('letters, Backspace and ◀ ▶ stay the field\'s: taken from the list, never prevented', async () => {
    await typingWith(3);
    for (const k of ['a', ' ', 'Backspace', 'ArrowLeft', 'ArrowRight', 'Unidentified']) {
      const e = key(k, k === 'Unidentified' ? { keyCode: 229 } : {});
      act(() => { expect(s().typingKey(e)).toBe(true); });
      expect(e.defaultPrevented).toBe(false);
    }
    expect(s().typing).toBe(true);
  });

  it('▲ puts it away and stays on the field; ▼ goes into the results', async () => {
    await typingWith(3);
    act(() => { s().typingKey(key('ArrowUp')); });
    expect(s().typing).toBe(false);
    expect(s().onField).toBe(true);
    act(() => { s().start(); });
    act(() => { s().typingKey(key('ArrowDown')); });
    expect(s().onField).toBe(false);
  });

  it('a box focusing the field by itself gets no keyboard: the focus is given back', async () => {
    render(<Field searchOpen={false} count={0} />);
    await flush();
    act(() => { field().focus(); });
    expect(document.activeElement).not.toBe(field());
    expect(field().readOnly).toBe(true);
  });

  it('typing nowhere: keys are not the field\'s, and the search\'s Back is not taken', async () => {
    render(<Field searchOpen={false} count={0} />);
    await flush();
    act(() => {
      expect(s().typingKey(key('a'))).toBe(false);
      expect(s().back()).toBe(false);
    });
  });
});

describe('Back and closing', () => {
  it('Back: the keyboard first, then the search opened here (the list as it was)', async () => {
    await typingWith(3);
    act(() => { expect(s().back()).toBe(true); });
    expect(s().typing).toBe(false);
    expect(calls.leave).not.toHaveBeenCalled();
    act(() => { expect(s().back()).toBe(true); });
    expect(calls.leave).toHaveBeenCalledTimes(1);
    expect(s().onField).toBe(true);
  });

  it('a search the list already had: OK edits it, Back after the keyboard is the list\'s own', async () => {
    await typingWith(3, true);
    expect(calls.open).not.toHaveBeenCalled();
    expect(s().owned).toBe(false);
    act(() => { s().back(); }); // the keyboard
    act(() => { expect(s().back()).toBe(false); });
    expect(calls.leave).not.toHaveBeenCalled();
  });

  it('the list closing puts the keyboard away and says whether its search goes too', async () => {
    await typingWith(3);
    let owned = false;
    act(() => { owned = s().end(); });
    expect(owned).toBe(true);
    expect(s().typing).toBe(false);
    expect(s().onField).toBe(false);
    await flush();
    expect(kb.hide).toBe(1);
    cleanup();
    await typingWith(3, true);
    act(() => { owned = s().end(); });
    expect(owned).toBe(false);
  });

  it('the search closed some other way: the keyboard goes, nothing of it is kept', async () => {
    const r = await typingWith(3);
    r.rerender(<Field searchOpen={false} count={0} />);
    expect(s().typing).toBe(false);
    expect(s().owned).toBe(false);
    expect(document.activeElement).not.toBe(field());
  });

  it('Escape while typing (a keyboard that sends Back to the page) is the keyboard\'s Back', async () => {
    await typingWith(3);
    const e = key('Escape');
    act(() => { expect(s().typingKey(e)).toBe(true); });
    expect(e.defaultPrevented).toBe(true);
    expect(s().typing).toBe(false);
    expect(s().onField).toBe(false);
    expect((window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt).toBeGreaterThan(0);
  });

});
