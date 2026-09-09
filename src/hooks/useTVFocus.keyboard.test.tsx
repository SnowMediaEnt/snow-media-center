/**
 * Regression tests for the on-screen-keyboard lifecycle in useTVFocus.
 *
 * These drive real DOM focus, real keydown events and a mocked native keyboard
 * whose show() can resolve, reject, be missing entirely, or hang — because that
 * is exactly the set of behaviours Fire TV / Android TV WebViews show, and each
 * one of them produced a field the viewer could not type in.
 */
import { render, act, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  native: true,
  showMode: 'resolve' as 'resolve' | 'reject' | 'missing',
  deferShow: false,
  showCalls: 0,
  hideCalls: 0,
  fallbackCalls: 0,
  pending: [] as (() => void)[],
  didShow: [] as (() => void)[],
  didHide: [] as (() => void)[],
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => state.native },
  registerPlugin: () => ({
    show: async () => {
      state.fallbackCalls += 1;
    },
  }),
}));

vi.mock('@capacitor/keyboard', () => {
  const Keyboard = {
    show: async () => {
      state.showCalls += 1;
      if (state.showMode === 'reject') throw new Error('show rejected');
      if (state.deferShow) await new Promise<void>((resolve) => state.pending.push(resolve));
    },
    hide: async () => {
      state.hideCalls += 1;
    },
    addListener: async (event: string, cb: () => void) => {
      (event === 'keyboardDidShow' ? state.didShow : state.didHide).push(cb);
      return { remove: () => {} };
    },
  };
  // 'missing' models a device where the plugin never registered: the import
  // succeeds but there is no Keyboard to call.
  return { get Keyboard() { return state.showMode === 'missing' ? undefined : Keyboard; } };
});

import { useTVFocus, type TVFocusNavigationMap } from '@/hooks/useTVFocus';
import { markKeyboardHidden } from '@/utils/keyboardVisibility';

/** Mirrors the billing register form: 'down' from First name skips Last name. */
const navigation: TVFocusNavigationMap = {
  'f-email': { down: 'f-pass' },
  'f-pass': { up: 'f-email', down: 'f-first' },
  'f-first': { up: 'f-pass', down: 'f-submit' },
  'f-last': { up: 'f-first', down: 'f-submit' },
  'f-submit': { up: 'f-last' },
};

interface HarnessProps {
  enabled?: boolean;
  onBack?: () => void;
  onSubmit?: () => void;
  withTextarea?: boolean;
}

const Harness = ({ enabled = true, onBack, onSubmit, withTextarea }: HarnessProps) => {
  const { containerRef, focusProps } = useTVFocus({
    enabled,
    navigation,
    initialFocusId: 'f-email',
    autoFocusOnMount: false,
    onBack,
  });
  return (
    <>
      <div ref={containerRef}>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
          <input aria-label="email" inputMode="email" enterKeyHint="next" {...focusProps('f-email')} />
          <input aria-label="password" enterKeyHint="next" {...focusProps('f-pass')} />
          <input aria-label="first" enterKeyHint="next" {...focusProps('f-first')} />
          <input aria-label="last" enterKeyHint="done" data-tv-allow-enter="true" {...focusProps('f-last')} />
          {withTextarea && <textarea aria-label="notes" {...focusProps('f-notes')} />}
          <button type="submit" {...focusProps('f-submit')}>Go</button>
        </form>
      </div>
      {/* Outside the hook's container: focus can land here without any hook
          navigation, exactly as an unrelated widget would take it. */}
      <button data-testid="outside">out</button>
    </>
  );
};


const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

const fireDidShow = async () => { await act(async () => { state.didShow.forEach((cb) => cb()); }); };
const fireDidHide = async () => { await act(async () => { state.didHide.forEach((cb) => cb()); }); };

const ok = async (el: HTMLElement, init: KeyboardEventInit = {}) => {
  await act(async () => { fireEvent.keyDown(el, { key: 'Enter', keyCode: 13, ...init }); });
  await flush();
};
const back = async (el: HTMLElement) => {
  await act(async () => { fireEvent.keyDown(el, { key: 'Escape' }); });
  await flush();
};

/** Real editing evidence: a beforeinput on the focused field. */
const typeEvidence = (el: HTMLElement) =>
  el.dispatchEvent(new (window as unknown as { InputEvent: typeof InputEvent }).InputEvent('beforeinput', { bubbles: true, cancelable: true }));

const tap = async (el: HTMLElement) => { await act(async () => { el.focus(); }); await flush(); };

beforeEach(() => {
  state.native = true;
  state.showMode = 'resolve';
  state.deferShow = false;
  state.showCalls = 0;
  state.hideCalls = 0;
  state.fallbackCalls = 0;
  state.pending = [];
  markKeyboardHidden();
});

afterEach(() => {
  cleanup();
  markKeyboardHidden();
  vi.useRealTimers();
});

describe('highlighting versus a real keyboard', () => {
  it('focusing a field (tap / onFocus reentry) never claims the keyboard is up, and OK asks for it without submitting', async () => {
    const onSubmit = vi.fn();
    const { getByLabelText } = render(<Harness onSubmit={onSubmit} />);
    const email = getByLabelText('email') as HTMLInputElement;

    await tap(email);
    // The element's own onFocus re-enters focusById; only one highlight survives.
    expect(document.querySelectorAll('[data-tv-focused="true"]').length).toBe(1);
    expect(email.dataset.tvFocused).toBe('true');
    expect(state.showCalls).toBe(0);

    await ok(email);
    expect(state.showCalls).toBe(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a show that resolves without didShow stays retryable on the same field and never submits', async () => {
    const onSubmit = vi.fn();
    const { getByLabelText } = render(<Harness onSubmit={onSubmit} />);
    const last = getByLabelText('last') as HTMLInputElement; // done + allow-enter

    await tap(last);
    await ok(last);
    await ok(last);
    await ok(last);
    expect(state.showCalls).toBe(3);
    expect(document.activeElement).toBe(last);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('falls back to the forced native keyboard when show rejects', async () => {
    state.showMode = 'reject';
    const { getByLabelText } = render(<Harness />);
    const email = getByLabelText('email');
    await tap(email);
    await ok(email);
    expect(state.showCalls).toBe(1);
    expect(state.fallbackCalls).toBe(1);
  });

  it('falls back when the keyboard plugin is missing altogether', async () => {
    state.showMode = 'missing';
    const { getByLabelText } = render(<Harness />);
    const email = getByLabelText('email');
    await tap(email);
    await ok(email);
    expect(state.showCalls).toBe(0);
    expect(state.fallbackCalls).toBe(1);
  });
});

describe('native visibility association', () => {
  it('didShow after a tap on an empty field makes Back close the keyboard first, then leave on the next press', async () => {
    const onBack = vi.fn();
    const { getByLabelText } = render(<Harness onBack={onBack} />);
    const email = getByLabelText('email') as HTMLInputElement;

    await tap(email);          // no activate(), no OK press
    await fireDidShow();       // the platform raised a keyboard anyway

    await back(email);
    expect(state.hideCalls).toBe(1);
    expect(onBack).not.toHaveBeenCalled();

    await fireDidHide();
    // Back de-bounces the WebView's duplicate press, so let the window pass.
    await act(async () => { vi.setSystemTime(Date.now() + 600); });
    await back(document.body);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('tapping from one field to another while the keyboard stays up keeps Back on "close the keyboard"', async () => {
    const onBack = vi.fn();
    const { getByLabelText } = render(<Harness onBack={onBack} />);
    const email = getByLabelText('email') as HTMLInputElement;
    const password = getByLabelText('password') as HTMLInputElement;

    await tap(email);
    await fireDidShow();   // platform keyboard is up for Username
    await tap(password);   // tap transfer: no typing, and no NEW didShow (true -> true)

    await back(password);
    expect(state.hideCalls).toBe(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('an OK sent as DPAD_CENTER (keyCode 23) opens the keyboard', async () => {
    const onSubmit = vi.fn();
    const { getByLabelText } = render(<Harness onSubmit={onSubmit} />);
    const last = getByLabelText('last') as HTMLInputElement; // allow-enter + done
    await tap(last);
    await ok(last, { key: 'Select', keyCode: 23 });
    expect(state.showCalls).toBe(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });



  it('Backspace edits while a field is being typed in and never leaves the screen', async () => {
    const onBack = vi.fn();
    const { getByLabelText } = render(<Harness onBack={onBack} />);
    const email = getByLabelText('email') as HTMLInputElement;
    await tap(email);
    await act(async () => { fireEvent.keyDown(email, { key: 'Backspace' }); });
    expect(onBack).not.toHaveBeenCalled();
  });

  it('a keyboard raised for another hook\'s field does not count as open here', async () => {
    const onBackA = vi.fn();
    const { getByTestId } = render(
      <div>
        <div data-testid="a"><Harness onBack={onBackA} /></div>
        <div data-testid="b"><Harness enabled={false} /></div>
      </div>,
    );
    const bField = getByTestId('b').querySelector('input[aria-label="email"]') as HTMLInputElement;
    const aField = getByTestId('a').querySelector('input[aria-label="email"]') as HTMLInputElement;

    await tap(bField);
    await fireDidShow();                 // belongs to the disabled hook's field
    await act(async () => { typeEvidence(bField); });

    await tap(aField);
    await back(aField);                  // hook A must treat this as Back, not "close keyboard"
    expect(onBackA).toHaveBeenCalledTimes(1);
  });
});

describe('Next / Done sequence', () => {
  const walk = async (from: HTMLElement) => { await ok(from); };

  it('Next follows the form order Email -> Password -> First -> Last even though "down" skips Last', async () => {
    const onSubmit = vi.fn();
    const { getByLabelText } = render(<Harness onSubmit={onSubmit} />);
    const email = getByLabelText('email') as HTMLInputElement;

    await tap(email);
    await fireDidShow();
    await walk(email);
    expect(document.activeElement).toBe(getByLabelText('password'));
    expect(state.hideCalls).toBe(0); // no hide between editable fields

    await fireDidShow();
    await walk(getByLabelText('password'));
    expect(document.activeElement).toBe(getByLabelText('first'));

    await fireDidShow();
    await walk(getByLabelText('first'));
    expect(document.activeElement).toBe(getByLabelText('last')); // NOT the submit button
    expect(onSubmit).not.toHaveBeenCalled();

    await fireDidShow();
    await walk(getByLabelText('last')); // done + allow-enter
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Next transfers fields without requesting a hide, and a native didHide afterwards is honoured', async () => {
    const onBack = vi.fn();
    const { getByLabelText } = render(<Harness onBack={onBack} />);
    const email = getByLabelText('email') as HTMLInputElement;
    await tap(email);
    await fireDidShow();
    await ok(email);                    // Next -> password
    const password = getByLabelText('password') as HTMLInputElement;
    expect(document.activeElement).toBe(password);
    expect(state.hideCalls).toBe(0);    // no hide was ever asked for
    // The platform keyboard stayed up through the transfer, so Back closes it
    // rather than leaving the form.
    await back(password);
    expect(state.hideCalls).toBe(1);
    expect(onBack).not.toHaveBeenCalled();
    // A real didHide now arrives; the next Back leaves the screen.
    await fireDidHide();
    await act(async () => { vi.setSystemTime(Date.now() + 600); });
    await back(document.body);
    expect(onBack).toHaveBeenCalledTimes(1);
  });


  it('composition keys never submit or move the highlight', async () => {
    const onSubmit = vi.fn();
    const { getByLabelText } = render(<Harness onSubmit={onSubmit} />);
    const last = getByLabelText('last') as HTMLInputElement;
    await tap(last);
    await fireDidShow();
    await ok(last, { isComposing: true });
    await ok(last, { keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(last);
  });

  it('a plain textarea keeps ordinary multiline editing', async () => {
    const onSubmit = vi.fn();
    const { getByLabelText } = render(<Harness withTextarea onSubmit={onSubmit} />);
    const notes = getByLabelText('notes') as HTMLTextAreaElement;
    await tap(notes);
    await fireDidShow();
    const event = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
    await act(async () => { notes.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(notes);
  });
});

describe('cancellation of in-flight requests', () => {
  it('unmounting during a delayed show never reaches the native fallback', async () => {
    state.deferShow = true;
    const { getByLabelText, unmount } = render(<Harness />);
    const email = getByLabelText('email');
    await tap(email);
    await ok(email);
    expect(state.showCalls).toBe(1);
    unmount();
    await act(async () => { state.pending.forEach((r) => r()); });
    await flush();
    expect(state.fallbackCalls).toBe(0);
  });

  it('moving the highlight during a delayed show abandons that request', async () => {
    state.deferShow = true;
    const { getByLabelText } = render(<Harness />);
    const email = getByLabelText('email') as HTMLInputElement;
    await tap(email);
    await ok(email);
    await act(async () => { fireEvent.keyDown(email, { key: 'ArrowDown' }); });
    await flush();
    await act(async () => { state.pending.forEach((r) => r()); });
    await flush();
    expect(state.fallbackCalls).toBe(0);
    expect(document.activeElement).not.toBe(email);
  });

  it('OK pressed twice while a show is in flight makes only one native request', async () => {
    state.deferShow = true;
    const { getByLabelText } = render(<Harness />);
    const email = getByLabelText('email');
    await tap(email);
    await ok(email);
    await ok(email);
    expect(state.showCalls).toBe(1);
  });
});

describe('field state preservation', () => {
  it('keeps the caller\'s inputMode and the viewer\'s caret when asking for the keyboard', async () => {
    const { getByLabelText } = render(<Harness />);
    const email = getByLabelText('email') as HTMLInputElement;
    await act(async () => {
      email.value = 'hello';
      email.focus();
      email.setSelectionRange(2, 2);
    });
    await flush();
    await ok(email);
    expect(email.getAttribute('inputmode')).toBe('email');
    expect(email.selectionStart).toBe(2);
    expect(email.value).toBe('hello');
  });

  it('typed characters, spaces and Backspace survive ordinary editing', async () => {
    const { getByLabelText } = render(<Harness />);
    const email = getByLabelText('email') as HTMLInputElement;
    await tap(email);
    for (const key of ['b', 'o', 'b', ' ', 'b']) {
      await act(async () => {
        fireEvent.keyDown(email, { key });
        typeEvidence(email);
        email.value += key;
        fireEvent.input(email);
      });
    }
    await act(async () => {
      fireEvent.keyDown(email, { key: 'Backspace' });
      email.value = email.value.slice(0, -1);
      fireEvent.input(email);
    });
    expect(email.value).toBe('bob ');
  });
});
