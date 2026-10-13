/**
 * The on-screen keyboard path in useTVFocus, as restored to its 1.6.x shape:
 * OK on a field asks Capacitor's Keyboard.show(), arrows and Back put it
 * away, and the one addition — the keyboard's Enter / Next moves to the
 * next field once something was typed, and lands on the button after the
 * last one.
 */
import { render, act, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  native: true,
  showCalls: 0,
  hideCalls: 0,
  didHide: [] as (() => void)[],
  // Keys the box itself delivers (the remote, its on-screen keyboard).
  deviceKey: false,
}));

vi.mock('@/utils/deviceKey', () => ({ isDeviceKey: () => state.deviceKey, platformRaisesKeyboard: () => state.deviceKey }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => state.native },
}));

vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    show: async () => { state.showCalls += 1; },
    hide: async () => { state.hideCalls += 1; },
    addListener: async (event: string, cb: () => void) => {
      if (event === 'keyboardDidHide') state.didHide.push(cb);
      return { remove: async () => {} };
    },
  },
}));

import { useTVFocus } from './useTVFocus';

const onBack = vi.fn();

function Form({ allowEnterOnPassword = false }: { allowEnterOnPassword?: boolean }) {
  // jsdom has no layout, so the spatial search finds nothing: lay the
  // column out explicitly, as the sign-in form does.
  const { containerRef, focusProps } = useTVFocus({
    initialFocusId: 'user',
    onBack,
    navigation: { user: { down: 'pass' }, pass: { up: 'user', down: 'signin' }, signin: { up: 'pass' } },
  });
  return (
    <div ref={containerRef}>
      <input {...focusProps('user')} data-testid="user" />
      <input {...focusProps('pass')} data-testid="pass" type="password" data-tv-allow-enter={allowEnterOnPassword ? 'true' : undefined} />
      <button {...focusProps('signin')} data-testid="signin">Sign in</button>
    </div>
  );
}

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const raf = async () => { await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); }); };

const okOn = (el: Element) => fireEvent.keyDown(el, { key: 'Enter', keyCode: 13 });
/** Time passing while the viewer types: longer than the Enter echo window. */
const later = async () => { await act(async () => { vi.advanceTimersByTime(1000); }); };
const keyboardEnter = (el: Element) => {
  // Amazon's keyboard delivers its Enter as a keydown then a keyup.
  const kd = fireEvent.keyDown(el, { key: 'Enter', keyCode: 13 });
  fireEvent.keyUp(el, { key: 'Enter', keyCode: 13 });
  return kd;
};

beforeEach(() => {
  state.native = true;
  state.showCalls = 0;
  state.hideCalls = 0;
  state.didHide = [];
  state.deviceKey = false;
  onBack.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useTVFocus keyboard (1.6.x path + Enter moves down)', () => {
  it('OK on a highlighted field asks the platform for the keyboard', async () => {
    const { getByTestId } = render(<Form />);
    await raf();
    const user = getByTestId('user') as HTMLInputElement;
    expect(document.activeElement).toBe(user);
    okOn(user);
    await flush();
    expect(state.showCalls).toBe(1);
    expect(document.activeElement).toBe(user);
  });

  it('OK again on an empty field asks again, never skips it', async () => {
    const { getByTestId } = render(<Form />);
    await raf();
    const user = getByTestId('user') as HTMLInputElement;
    okOn(user); await flush();
    okOn(user); await flush();
    expect(state.showCalls).toBe(2);
    expect(document.activeElement).toBe(user);
  });

  it('typing then Enter moves to the next field and takes the keyboard along', async () => {
    const { getByTestId } = render(<Form />);
    await raf();
    const user = getByTestId('user') as HTMLInputElement;
    const pass = getByTestId('pass') as HTMLInputElement;
    okOn(user); await flush();
    fireEvent.input(user, { target: { value: 'jane' } });
    await later();
    const kd = keyboardEnter(user);
    await flush();
    expect(kd).toBe(false); // prevented: nothing submits
    expect(document.activeElement).toBe(pass);
    expect(pass.dataset.tvFocused).toBe('true');
    expect(state.showCalls).toBe(2);
    expect(state.hideCalls).toBe(0);
  });

  it('Enter after the last field puts the keyboard away and lands on the button', async () => {
    const { getByTestId } = render(<Form />);
    await raf();
    const user = getByTestId('user') as HTMLInputElement;
    const pass = getByTestId('pass') as HTMLInputElement;
    const signin = getByTestId('signin');
    okOn(user); await flush();
    fireEvent.input(user, { target: { value: 'jane' } });
    await later();
    keyboardEnter(user); await flush();
    fireEvent.input(pass, { target: { value: 'secret' } });
    await later();
    keyboardEnter(pass); await flush();
    expect(state.hideCalls).toBe(1);
    expect(document.activeElement).toBe(signin);
    expect(signin.dataset.tvFocused).toBe('true');
  });

  it("the keyboard's parting Enter after the last field does not press the button or re-open", async () => {
    const { getByTestId } = render(<Form />);
    await raf();
    const user = getByTestId('user') as HTMLInputElement;
    const pass = getByTestId('pass') as HTMLInputElement;
    const signin = getByTestId('signin');
    const clicks = vi.fn();
    signin.addEventListener('click', clicks);
    okOn(user); await flush();
    fireEvent.input(user, { target: { value: 'jane' } });
    await later();
    keyboardEnter(user); await flush();
    fireEvent.input(pass, { target: { value: 'secret' } });
    await later();
    keyboardEnter(pass); await flush();
    expect(document.activeElement).toBe(signin);
    // The echo, a moment later, on the button.
    await act(async () => { vi.advanceTimersByTime(150); });
    fireEvent.keyDown(signin, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(clicks).not.toHaveBeenCalled();
    expect(state.showCalls).toBe(2);
    // A real press after the grace period does press it.
    await later();
    fireEvent.keyDown(signin, { key: 'Enter', keyCode: 13 });
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('the platform advancing focus itself (native Next) is followed, and Enter then finishes', async () => {
    const { getByTestId } = render(<Form />);
    await raf();
    const user = getByTestId('user') as HTMLInputElement;
    const pass = getByTestId('pass') as HTMLInputElement;
    okOn(user); await flush();
    fireEvent.input(user, { target: { value: 'jane' } });
    act(() => { pass.focus(); });
    expect(pass.dataset.tvFocused).toBe('true');
    fireEvent.input(pass, { target: { value: 'secret' } });
    await later();
    keyboardEnter(pass); await flush();
    expect(state.hideCalls).toBe(1);
    expect(document.activeElement).toBe(getByTestId('signin'));
  });

  it('an allow-enter field: OK opens the keyboard, Enter once typed is left to the form', async () => {
    const { getByTestId } = render(<Form allowEnterOnPassword />);
    await raf();
    const pass = getByTestId('pass') as HTMLInputElement;
    act(() => { pass.focus(); });
    expect(okOn(pass)).toBe(false);
    await flush();
    expect(state.showCalls).toBe(1);
    fireEvent.input(pass, { target: { value: 'secret' } });
    await later();
    const kd = keyboardEnter(pass);
    expect(kd).toBe(true);
    expect(document.activeElement).toBe(pass);
    expect(state.hideCalls).toBe(0);
  });

  it('Back while typing closes the keyboard, stays on the field, and does not leave the screen', async () => {
    const { getByTestId } = render(<Form />);
    await raf();
    const user = getByTestId('user') as HTMLInputElement;
    okOn(user); await flush();
    fireEvent.input(user, { target: { value: 'ja' } });
    fireEvent.keyDown(user, { key: 'Escape', keyCode: 27 });
    await flush();
    expect(state.hideCalls).toBe(1);
    expect(document.activeElement).not.toBe(user);
    expect(user.dataset.tvFocused).toBe('true');
    expect(onBack).not.toHaveBeenCalled();
    // The keyboard's parting Enter must not raise it again.
    fireEvent.keyDown(document.body, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(state.showCalls).toBe(1);
    // ...but a real press a moment later opens it once more, on the same field.
    await act(async () => { vi.advanceTimersByTime(800); });
    fireEvent.keyDown(document.body, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(state.showCalls).toBe(2);
    expect(document.activeElement).toBe(user);
    // And after Back the field is "open it", not "next": Enter re-asked, did not skip.
    expect(user.dataset.tvFocused).toBe('true');
  });

  it('a keyboardDidHide report makes the next Enter re-open rather than skip', async () => {
    const { getByTestId } = render(<Form />);
    await raf();
    await flush();
    const user = getByTestId('user') as HTMLInputElement;
    okOn(user); await flush();
    fireEvent.input(user, { target: { value: 'jane' } });
    act(() => { state.didHide.forEach((cb) => cb()); });
    await later();
    keyboardEnter(user); await flush();
    expect(state.showCalls).toBe(2);
    expect(document.activeElement).toBe(user);
  });

  it('arrows leave the field with the keyboard put away, and the new field is only highlighted', async () => {
    const { getByTestId } = render(<Form />);
    await raf();
    const user = getByTestId('user') as HTMLInputElement;
    const pass = getByTestId('pass') as HTMLInputElement;
    okOn(user); await flush();
    fireEvent.keyDown(user, { key: 'ArrowDown' });
    await flush();
    expect(state.hideCalls).toBe(1);
    expect(state.showCalls).toBe(1);
    expect(pass.dataset.tvFocused).toBe('true');
  });

  it('on the web nothing native is asked for', async () => {
    state.native = false;
    const { getByTestId } = render(<Form />);
    await raf();
    okOn(getByTestId('user')); await flush();
    expect(state.showCalls).toBe(0);
  });
});

describe('useTVFocus keyboard on a Fire TV (the platform opens Amazon\'s keyboard itself)', () => {
  const reportOk = () => act(() => { window.dispatchEvent(new Event('smc:okkey')); });
  const tick = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

  it("the keyboard's Enter as Back closes it is not OK: the keyboard stays away and the box keeps focus (owner, 1.9.0)", async () => {
    state.deviceKey = true;
    const { getByTestId } = render(<Form />);
    await raf();
    await flush();
    const user = getByTestId('user') as HTMLInputElement;
    // The screen opened on Username, so the box has focus and the platform raised the keyboard.
    expect(document.activeElement).toBe(user);
    keyboardEnter(user); await flush();
    await later();
    expect(state.showCalls).toBe(0);
    expect(state.hideCalls).toBe(1);
    expect(user.dataset.tvFocused).toBe('true');
    // Kept: with nothing focused the WebView would focus the first box and raise the keyboard.
    expect(document.activeElement).toBe(user);
    // And again: it never comes back by itself.
    keyboardEnter(user); await flush();
    await later();
    expect(state.showCalls).toBe(0);
  });

  it("the remote's OK (reported by Android) still opens the keyboard, even when the report is late", async () => {
    state.deviceKey = true;
    const { getByTestId } = render(<Form />);
    await raf();
    await flush();
    const user = getByTestId('user') as HTMLInputElement;
    reportOk();
    okOn(user); await flush();
    expect(state.showCalls).toBe(1);
    await later();
    // A report landing just after its Enter.
    okOn(user);
    reportOk();
    await later();
    await flush();
    expect(state.showCalls).toBe(2);
  });

  it('typed, then Back: the keyboard goes and the highlight stays, never jumping to Password', async () => {
    state.deviceKey = true;
    const { getByTestId } = render(<Form />);
    await raf();
    await flush();
    const user = getByTestId('user') as HTMLInputElement;
    const pass = getByTestId('pass') as HTMLInputElement;
    fireEvent.input(user, { target: { value: 'jane' } });
    await later();
    keyboardEnter(user); await flush();
    await later();
    expect(state.showCalls).toBe(0);
    expect(state.hideCalls).toBe(1);
    expect(user.dataset.tvFocused).toBe('true');
    expect(pass.dataset.tvFocused).not.toBe('true');
    expect(document.activeElement).not.toBe(pass);
  });

  it('the second time too: OK opens the keyboard, typing, Back -> still no jump to Password', async () => {
    state.deviceKey = true;
    const { getByTestId } = render(<Form />);
    await raf();
    await flush();
    const user = getByTestId('user') as HTMLInputElement;
    const pass = getByTestId('pass') as HTMLInputElement;
    keyboardEnter(user); await flush(); // first Back: keyboard's own Enter
    await later();
    reportOk();
    okOn(user); await flush(); // the viewer's OK
    expect(state.showCalls).toBe(1);
    fireEvent.input(user, { target: { value: 'jane' } });
    await later();
    keyboardEnter(user); await flush(); // Back again
    await later();
    expect(state.showCalls).toBe(1);
    expect(user.dataset.tvFocused).toBe('true');
    expect(document.activeElement).not.toBe(pass);
  });

  it('typed in the last field, then Back: the keyboard goes and the highlight lands on Sign in, which is not pressed', async () => {
    state.deviceKey = true;
    const onSignIn = vi.fn();
    function SignInForm() {
      const { containerRef, focusProps } = useTVFocus({
        initialFocusId: 'pass',
        navigation: { user: { down: 'pass' }, pass: { up: 'user', down: 'signin' }, signin: { up: 'pass' } },
      });
      return (
        <div ref={containerRef}>
          <input {...focusProps('user')} data-testid="user" />
          <input {...focusProps('pass')} data-testid="pass" type="password" />
          <button {...focusProps('signin')} data-testid="signin" onClick={onSignIn}>Sign in</button>
        </div>
      );
    }
    const { getByTestId } = render(<SignInForm />);
    await raf();
    await flush();
    const pass = getByTestId('pass') as HTMLInputElement;
    fireEvent.input(pass, { target: { value: 'secret' } });
    await later();
    keyboardEnter(pass); await flush();
    expect(getByTestId('signin').dataset.tvFocused).toBe('true');
    // The keyboard's parting Enter lands on the button: swallowed.
    keyboardEnter(getByTestId('signin')); await flush();
    expect(onSignIn).not.toHaveBeenCalled();
    expect(state.showCalls).toBe(0);
  });

  it('a Back that reaches the page means the keyboard is already down: it leaves the screen, even from a focused box', async () => {
    state.deviceKey = true;
    const { getByTestId } = render(<Form />);
    await raf();
    await flush();
    const user = getByTestId('user') as HTMLInputElement;
    reportOk();
    okOn(user); await flush();
    fireEvent.input(user, { target: { value: 'jane' } });
    await later();
    fireEvent.keyDown(user, { key: 'Escape', keyCode: 27 });
    await flush();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('the platform focusing the box again right after the keyboard went is quiet, and OK opens it at once', async () => {
    state.deviceKey = true;
    const { getByTestId } = render(<Form />);
    await raf();
    await flush();
    const user = getByTestId('user') as HTMLInputElement;
    keyboardEnter(user); await flush();
    await tick(200);
    expect(state.hideCalls).toBe(1);
    act(() => { user.blur(); user.focus(); }); // the WebView, as the keyboard window closes
    expect(user.readOnly).toBe(true);
    // The remote's OK on it (a Fire TV's WebView opens the keyboard itself, the page sees no key).
    reportOk();
    expect(user.readOnly).toBe(false);
  });

  it('a held OK repeating is not read as the keyboard closing', async () => {
    state.deviceKey = true;
    const { getByTestId } = render(<Form />);
    await raf();
    await flush();
    const user = getByTestId('user') as HTMLInputElement;
    reportOk();
    okOn(user); await flush();
    await tick(500);
    fireEvent.keyDown(user, { key: 'Enter', keyCode: 13, repeat: true });
    await later();
    expect(state.hideCalls).toBe(0);
  });

  it('a keyboard timer still pending when the screen closes does nothing afterwards', async () => {
    state.deviceKey = true;
    const { getByTestId, unmount } = render(<Form />);
    await raf();
    await flush();
    keyboardEnter(getByTestId('user'));
    unmount();
    await later();
    expect(state.hideCalls).toBe(0);
  });
});
