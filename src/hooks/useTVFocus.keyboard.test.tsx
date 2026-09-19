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
}));

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
