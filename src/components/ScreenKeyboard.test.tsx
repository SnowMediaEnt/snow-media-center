/**
 * Regression cover for the browser-preview on-screen keyboard.
 *
 * These assert real DOM behaviour: the overlay is rendered, keys type into the
 * field, Next hands over to the following field, Back closes it, and none of it
 * exists on the installed Android app.
 */
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isNative = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNative() } }));

import ScreenKeyboard from './ScreenKeyboard';
import { closeScreenKeyboard, openScreenKeyboard, isScreenKeyboardOpen } from '@/lib/screenKeyboard';

const Form = () => (
  <form onSubmit={(e) => e.preventDefault()}>
    <input id="u" aria-label="Username" defaultValue="" />
    <input id="p" aria-label="Password" type="password" defaultValue="" />
  </form>
);

const keyEl = (label: string) => screen.getByRole('button', { name: label });
const rowsOf = () => document.querySelector('[data-screen-keyboard]');

beforeEach(() => {
  isNative.mockReturnValue(false);
  // jsdom has no real pointer; desktop-preview gate reads matchMedia.
  window.matchMedia = ((q: string) => ({
    matches: q.includes('hover: hover'),
    media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    onchange: null, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return document.body; } });
});

afterEach(() => { closeScreenKeyboard(); cleanup(); vi.clearAllMocks(); });

describe('browser on-screen keyboard', () => {
  it('renders nothing until a field asks for it, then shows a key grid', () => {
    render(<><Form /><ScreenKeyboard /></>);
    expect(rowsOf()).toBeNull();
    act(() => { openScreenKeyboard(document.getElementById('u')); });
    expect(rowsOf()).not.toBeNull();
    expect(keyEl('key q')).toBeTruthy();
  });

  it('does not exist on the installed native app', () => {
    isNative.mockReturnValue(true);
    render(<><Form /><ScreenKeyboard /></>);
    expect(openScreenKeyboard(document.getElementById('u'))).toBe(false);
    expect(rowsOf()).toBeNull();
  });

  it('OK on a key types it, Shift capitalises, Delete removes the last character', async () => {
    render(<><Form /><ScreenKeyboard /></>);
    const u = document.getElementById('u') as HTMLInputElement;
    act(() => { openScreenKeyboard(u); });
    fireEvent.click(keyEl('key s'));
    fireEvent.click(keyEl('key m'));
    expect(u.value).toBe('sm');
    fireEvent.click(keyEl('Shift'));
    fireEvent.click(keyEl('key C'));
    expect(u.value).toBe('smC');
    fireEvent.click(keyEl('Delete'));
    expect(u.value).toBe('sm');
    await waitFor(() => expect(isScreenKeyboardOpen()).toBe(true));
  });

  it('arrow keys move a single visible highlight and OK types the highlighted key', () => {
    render(<><Form /><ScreenKeyboard /></>);
    const u = document.getElementById('u') as HTMLInputElement;
    act(() => { openScreenKeyboard(u); });
    const highlighted = () =>
      document.querySelectorAll('[data-screen-keyboard] button.scale-110');
    expect(highlighted()).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(highlighted()).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(u.value).toBe('w');
  });

  it('Next moves to the following field and keeps what was already typed', () => {
    render(<><Form /><ScreenKeyboard /></>);
    const u = document.getElementById('u') as HTMLInputElement;
    const p = document.getElementById('p') as HTMLInputElement;
    act(() => { openScreenKeyboard(u); });
    fireEvent.click(keyEl('key a'));
    fireEvent.click(keyEl('Next'));
    fireEvent.click(keyEl('key b'));
    expect(u.value).toBe('a');
    expect(p.value).toBe('b');
    expect(p.type).toBe('password');
    expect(isScreenKeyboardOpen()).toBe(true);
  });

  it('Back closes the keyboard without bubbling the key to the screen behind it', () => {
    const onBack = vi.fn();
    window.addEventListener('keydown', onBack);
    render(<><Form /><ScreenKeyboard /></>);
    act(() => { openScreenKeyboard(document.getElementById('u')); });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(isScreenKeyboardOpen()).toBe(false);
    expect(rowsOf()).toBeNull();
    window.removeEventListener('keydown', onBack);
  });

  it('closes itself when the field it was typing into disappears', async () => {
    const { unmount } = render(<Form />);
    render(<ScreenKeyboard />);
    act(() => { openScreenKeyboard(document.getElementById('u')); });
    expect(isScreenKeyboardOpen()).toBe(true);
    unmount();
    await waitFor(() => expect(isScreenKeyboardOpen()).toBe(false));
  });
});
