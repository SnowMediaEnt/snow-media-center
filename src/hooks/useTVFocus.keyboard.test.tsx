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
  /** How SnowKeyboard.show() behaves — resolving is not the same as a keyboard. */
  showMode: 'resolve' as 'resolve' | 'reject',
  deferShow: false,
  /** SnowKeyboard.show(): the ONLY way the app asks for a keyboard. */
  showCalls: 0,
  /** @capacitor/keyboard's Keyboard.hide(). */
  hideCalls: 0,
  /** SnowKeyboard.hide() — straight to InputMethodManager. */
  nativeHideCalls: 0,
  /**
   * Models a device where @capacitor/keyboard never registered. Not
   * hypothetical: the generated capacitor.settings.gradle in this repo has
   * shipped without :capacitor-keyboard, so the import resolves and there is
   * no Keyboard behind it.
   */
  keyboardPluginMissing: false,
  pending: [] as (() => void)[],
  didShow: [] as (() => void)[],
  didHide: [] as (() => void)[],
  /** SnowKeyboard's keyboardVisibility listeners. */
  visibility: [] as ((s: { visible: boolean }) => void)[],
}));

// SnowKeyboard. Since the D-pad keyboard work this is the primary route, not a
// fallback: the app asks it for every keyboard and it reports back what
// InputMethodManager actually did.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => state.native },
  registerPlugin: () => ({
    show: async () => {
      state.showCalls += 1;
      if (state.showMode === 'reject') throw new Error('show refused');
      if (state.deferShow) await new Promise<void>((resolve) => state.pending.push(resolve));
    },
    hide: async () => { state.nativeHideCalls += 1; },
    addListener: async (event: string, cb: (s: { visible: boolean }) => void) => {
      if (event === 'keyboardVisibility') state.visibility.push(cb);
      return { remove: () => {} };
    },
  }),
}));

// @capacitor/keyboard is used for the lifecycle events and for one of the two
// hide routes. It is NEVER used to raise a keyboard — a TV in non-touch mode
// ignores that request, which is the whole reason SnowKeyboard exists.
vi.mock('@capacitor/keyboard', () => {
  const Keyboard = {
    hide: async () => {
      state.hideCalls += 1;
    },
    addListener: async (event: string, cb: () => void) => {
      (event === 'keyboardDidShow' ? state.didShow : state.didHide).push(cb);
      return { remove: () => {} };
    },
  };
  return { get Keyboard() { return state.keyboardPluginMissing ? undefined : Keyboard; } };
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
/**
 * Android reporting a change the page never asked for. Back closing a docked
 * IME is handled entirely inside Android, so this is the ONLY way the page can
 * learn the keyboard has gone.
 */
const fireNativeVisibility = async (visible: boolean) => {
  await act(async () => { state.visibility.forEach((cb) => cb({ visible })); });
};

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
  state.nativeHideCalls = 0;
  state.keyboardPluginMissing = false;
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

  it('a refused native show leaves the field focused and immediately retryable', async () => {
    state.showMode = 'reject';
    const { getByLabelText } = render(<Harness />);
    const email = getByLabelText('email') as HTMLInputElement;
    await tap(email);
    await ok(email);
    // The rejection is swallowed, not propagated: a device that refuses the
    // request must not cost the viewer the field.
    expect(state.showCalls).toBe(1);
    expect(document.activeElement).toBe(email);
    await ok(email);
    expect(state.showCalls).toBe(2);
  });

  it('on the web (no native platform) OK focuses the field and asks nothing of Android', async () => {
    state.native = false;
    const { getByLabelText } = render(<Harness />);
    const email = getByLabelText('email') as HTMLInputElement;
    await tap(email);
    await ok(email);
    expect(state.showCalls).toBe(0);
    expect(document.activeElement).toBe(email);
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

  it('a keyboard Android closed by itself is reported, so the very next Back leaves the screen', async () => {
    // The failure this pins down: with the IME docked, Back is handled inside
    // Android — it hides the keyboard and swallows the key, and JavaScript sees
    // nothing at all. Without SnowKeyboard's keyboardVisibility event the page
    // went on believing a keyboard it could no longer see was up, so the next
    // Back was spent "closing" it and the viewer had to press Back twice to
    // leave the screen.
    const onBack = vi.fn();
    const { getByLabelText } = render(<Harness onBack={onBack} />);
    const email = getByLabelText('email') as HTMLInputElement;

    await tap(email);
    await fireDidShow();                 // a keyboard is genuinely up, and the page knows
    await fireNativeVisibility(false);   // Android closed it: no didHide, no JS key

    // Nothing left to close, so this Back LEAVES THE SCREEN rather than being
    // swallowed as "close the keyboard" — which is what used to cost a second
    // press. The fail-safe dismiss still fires on the way out (the field is
    // focused); what matters is that the press was not consumed.
    await back(email);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Back dismisses even when NOTHING ever reported the keyboard (the Fire OS 7 case)', async () => {
    // THE bug. @capacitor/keyboard detects the keyboard only through Android 11
    // window-inset animations, and most Fire TV sticks are Fire OS 7, which is
    // Android 9. There, keyboardDidShow never fires, so the page's "is a
    // keyboard up?" gate answered no while the viewer was looking at one — and
    // Back navigated away and left the keyboard sitting over the next screen.
    // On every text field in the app.
    //
    // No fireDidShow and no fireNativeVisibility here on purpose: this is a
    // device that reports nothing at all. Leaving the field must still dismiss.
    const onBack = vi.fn();
    const { getByLabelText } = render(<Harness onBack={onBack} />);
    const email = getByLabelText('email') as HTMLInputElement;

    await tap(email);
    await ok(email);          // keyboard is up on the device; nothing says so
    await back(email);

    expect(state.hideCalls).toBe(1);
    expect(state.nativeHideCalls).toBe(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Back on a non-field does not ask the keyboard to hide', async () => {
    // The fail-safe above must not turn every Back in the app into a native
    // call. Only leaving an editable field is a reason to dismiss.
    const onBack = vi.fn();
    const { getByLabelText } = render(<Harness onBack={onBack} />);
    const submit = getByLabelText('email').parentElement!.querySelector('button[type="submit"]') as HTMLButtonElement;

    await tap(submit);
    await back(submit);
    expect(state.hideCalls).toBe(0);
    expect(state.nativeHideCalls).toBe(0);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Back still dismisses when @capacitor/keyboard was never registered', async () => {
    // capacitor.settings.gradle has shipped without :capacitor-keyboard, so
    // Keyboard.hide() is not merely slow — it is not there. SnowKeyboard.hide()
    // is the route that has to survive that.
    state.keyboardPluginMissing = true;
    const onBack = vi.fn();
    const { getByLabelText } = render(<Harness onBack={onBack} />);
    const email = getByLabelText('email') as HTMLInputElement;

    await tap(email);
    await fireDidShow();
    await back(email);
    expect(state.hideCalls).toBe(0);        // the plugin genuinely is not there
    expect(state.nativeHideCalls).toBe(1);  // SnowKeyboard covered it
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

  it('a keyboard raised for another hook\'s field is ignored until focus is on this hook\'s own field', async () => {
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

    // While the other hook's field holds focus, hook A neither claims the
    // keyboard nor acts on Back at all.
    await back(bField);
    expect(onBackA).not.toHaveBeenCalled();
    expect(state.hideCalls).toBe(0);

    // Focus moves onto hook A's own field with the keyboard still on screen, so
    // it is now A's to close; only the press after that leaves the screen.
    await tap(aField);
    await back(aField);
    expect(state.hideCalls).toBe(1);
    expect(onBackA).not.toHaveBeenCalled();
    await fireDidHide();
    await act(async () => { vi.setSystemTime(Date.now() + 600); });
    await back(document.body);
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
  it('unmounting during a delayed show never asks for a second keyboard', async () => {
    state.deferShow = true;
    const { getByLabelText, unmount } = render(<Harness />);
    const email = getByLabelText('email');
    await tap(email);
    await ok(email);
    expect(state.showCalls).toBe(1);
    unmount();
    await act(async () => { state.pending.forEach((r) => r()); });
    await flush();
    expect(state.showCalls).toBe(1);
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
    expect(state.showCalls).toBe(1);
    expect(document.activeElement).not.toBe(email);
  });

  it('focus lost to an unrelated element during a delayed show cancels the fallback and is not stolen back', async () => {
    state.deferShow = true;
    const { getByLabelText, getByTestId } = render(<Harness />);
    const email = getByLabelText('email') as HTMLInputElement;
    const outside = getByTestId('outside') as HTMLButtonElement;
    await tap(email);
    await ok(email);
    expect(state.showCalls).toBe(1);
    // No hook navigation at all: something else simply took focus.
    await act(async () => { outside.focus(); });
    await act(async () => { state.pending.forEach((r) => r()); });
    await flush();
    expect(state.showCalls).toBe(1);
    expect(document.activeElement).toBe(outside);
  });

  it('disabling the hook during a delayed show cancels the fallback', async () => {
    state.deferShow = true;
    const { getByLabelText, rerender } = render(<Harness />);
    const email = getByLabelText('email');
    await tap(email);
    await ok(email);
    expect(state.showCalls).toBe(1);
    await act(async () => { rerender(<Harness enabled={false} />); });
    await act(async () => { state.pending.forEach((r) => r()); });
    await flush();
    expect(state.showCalls).toBe(1);
  });

  it('a show that never settles stops blocking retries once the request deadline lapses', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.deferShow = true;
    const { getByLabelText } = render(<Harness />);
    const email = getByLabelText('email');
    await tap(email);
    await ok(email);
    await ok(email);
    expect(state.showCalls).toBe(1); // still pending: no duplicate request
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    await ok(email);
    expect(state.showCalls).toBe(2); // retryable again
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
