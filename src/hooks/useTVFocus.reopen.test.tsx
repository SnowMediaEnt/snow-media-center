/**
 * Invariant probe: after Back dismisses the keyboard on a focused field,
 * NOTHING may re-request the keyboard or put focus back on the field — not in
 * the same tick, not on the next frames, not on the events the dismiss itself
 * produces (blur/focusout, keyboardDidHide, resize).
 */
import { render, act, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  showCalls: 0, hideCalls: 0, nativeHideCalls: 0,
  didShow: [] as (() => void)[], didHide: [] as (() => void)[],
  visibility: [] as ((s: { visible: boolean }) => void)[],
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({
    show: async () => { state.showCalls += 1; },
    hide: async () => { state.nativeHideCalls += 1; },
    addListener: async (event: string, cb: (s: { visible: boolean }) => void) => {
      if (event === 'keyboardVisibility') state.visibility.push(cb);
      return { remove: () => {} };
    },
  }),
}));
vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    hide: async () => { state.hideCalls += 1; },
    addListener: async (event: string, cb: () => void) => {
      (event === 'keyboardDidShow' ? state.didShow : state.didHide).push(cb);
      return { remove: () => {} };
    },
  },
}));

import { useTVFocus, type TVFocusNavigationMap } from '@/hooks/useTVFocus';
import { useFocusRecovery, focusAttrs } from '@/components/billing/shared';

const navigation: TVFocusNavigationMap = {
  'f-user': { down: 'f-pass' }, 'f-pass': { up: 'f-user', down: 'f-submit' }, 'f-submit': { up: 'f-pass' },
};

// Mirrors BillingAuthForm: useTVFocus + useFocusRecovery + focusAttrs, the
// exact stack a stranger from the ad types into.
const Harness = ({ onBack }: { onBack?: () => void }) => {
  const { containerRef, currentFocusId, focusById } = useTVFocus({
    navigation, initialFocusId: 'f-user', autoFocusOnMount: false, onBack,
  });
  useFocusRecovery(containerRef, currentFocusId, focusById, 'f-user');
  return (
    <div ref={containerRef}>
      <form onSubmit={(e) => e.preventDefault()}>
        <input aria-label="user" {...focusAttrs(currentFocusId, 'f-user')} />
        <input aria-label="pass" type="password" data-tv-allow-enter="true" {...focusAttrs(currentFocusId, 'f-pass')} />
        <button type="submit" {...focusAttrs(currentFocusId, 'f-submit')}>Sign in</button>
      </form>
    </div>
  );
};

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const frames = async (n = 3) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); }); };

beforeEach(() => { state.showCalls = 0; state.hideCalls = 0; state.nativeHideCalls = 0; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('no re-open after Back', () => {
  it("the keyboard's own Enter arriving right after a Back-dismiss is swallowed: no re-open, no re-focus, no submit", async () => {
    // What the Fire TV actually does: Amazon's keyboard emits its editor
    // action as it dismisses, Chromium delivers it as a plain Enter, and by
    // then the field is blurred so it lands on <body>. Without the grace
    // guard, activate() fell back to the highlighted field and re-opened the
    // keyboard — "it closed for a split second then came straight back".
    const onBack = vi.fn();
    const { getByLabelText } = render(<Harness onBack={onBack} />);
    const user = getByLabelText('user') as HTMLInputElement;
    await act(async () => { user.focus(); }); await flush();
    await act(async () => { fireEvent.keyDown(user, { key: 'Enter', keyCode: 13 }); }); await flush();
    expect(state.showCalls).toBe(1);
    await act(async () => { fireEvent.keyDown(user, { key: 'Escape' }); }); await flush();
    expect(document.activeElement).not.toBe(user);

    for (const init of [{ key: 'Enter', keyCode: 13 }, { key: 'Select', keyCode: 23 }, { key: ' ', keyCode: 32 }]) {
      await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })); });
      await flush();
    }
    // And one that still targets the input, as it would if the action landed
    // before the blur took effect.
    await act(async () => { fireEvent.keyDown(user, { key: 'Enter', keyCode: 13 }); }); await flush();

    expect(state.showCalls).toBe(1);
    expect(document.activeElement).not.toBe(user);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('a real OK after the grace period re-opens the keyboard on the highlighted field', async () => {
    // The guard must not cost the viewer the ability to get the keyboard back.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { getByLabelText } = render(<Harness />);
    const user = getByLabelText('user') as HTMLInputElement;
    await act(async () => { user.focus(); }); await flush();
    await act(async () => { fireEvent.keyDown(user, { key: 'Enter', keyCode: 13 }); }); await flush();
    await act(async () => { fireEvent.keyDown(user, { key: 'Escape' }); }); await flush();
    expect(state.showCalls).toBe(1);

    await act(async () => { vi.advanceTimersByTime(800); vi.setSystemTime(Date.now() + 800); });
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true })); });
    await flush();
    expect(state.showCalls).toBe(2);
    expect(document.activeElement).toBe(user);
  });

  it('arrow keys are not delayed by the grace period', async () => {
    const { getByLabelText } = render(<Harness />);
    const user = getByLabelText('user') as HTMLInputElement;
    await act(async () => { user.focus(); }); await flush();
    await act(async () => { fireEvent.keyDown(user, { key: 'Enter', keyCode: 13 }); }); await flush();
    await act(async () => { fireEvent.keyDown(user, { key: 'Escape' }); }); await flush();
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); });
    await flush();
    expect(document.activeElement).toBe(getByLabelText('pass'));
  });

  it('Back on a focused field does not re-request the keyboard on later frames', async () => {
    const onBack = vi.fn();
    const { getByLabelText } = render(<Harness onBack={onBack} />);
    const user = getByLabelText('user') as HTMLInputElement;

    await act(async () => { user.focus(); }); await flush();
    await act(async () => { fireEvent.keyDown(user, { key: 'Enter', keyCode: 13 }); }); await flush();
    expect(state.showCalls).toBe(1);                    // OK opened it
    await act(async () => { state.didShow.forEach((cb) => cb()); });

    await act(async () => { fireEvent.keyDown(user, { key: 'Escape' }); }); await flush();
    expect(state.hideCalls + state.nativeHideCalls).toBeGreaterThan(0);   // dismiss ran
    expect(onBack).not.toHaveBeenCalled();

    // Now the events the dismiss itself produces on a device.
    await act(async () => { state.didHide.forEach((cb) => cb()); });
    await act(async () => { state.visibility.forEach((cb) => cb({ visible: false })); });
    await act(async () => { window.dispatchEvent(new Event('resize')); });
    await frames(4);

    expect(state.showCalls).toBe(1);                    // NOT re-requested
    expect(document.activeElement).not.toBe(user);      // NOT re-focused
    expect(document.activeElement).not.toBe(getByLabelText('pass'));
  });

  it('a synthesized Escape echo (Capacitor backButton) after the dismiss is swallowed, not treated as a second Back', async () => {
    const onBack = vi.fn();
    const { getByLabelText } = render(<Harness onBack={onBack} />);
    const user = getByLabelText('user') as HTMLInputElement;
    await act(async () => { user.focus(); }); await flush();
    await act(async () => { fireEvent.keyDown(user, { key: 'Enter', keyCode: 13 }); }); await flush();
    await act(async () => { fireEvent.keyDown(user, { key: 'Escape' }); }); await flush();
    // LiveTV's backButton listener synthesizes this within the same press.
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    });
    await flush(); await frames(2);
    expect(state.showCalls).toBe(1);
    expect(onBack).not.toHaveBeenCalled();
  });
});
