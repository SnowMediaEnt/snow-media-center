/**
 * Live TV → Settings: at 960×540 the last rows (Sign Out) sit below the fold.
 * The menu must scroll to keep the remote highlight on screen, and go back to
 * the top when the highlight returns to the first row.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useBillingEnabled', () => ({ useBillingEnabled: () => false }));

import SettingsHub from './SettingsHub';

// A 540 px screen; the menu starts under a 73 px header. Each row is 60 px
// tall with 12 px between rows, drawn from the menu's scroll position.
const VIEW_H = 540;
const PANE_TOP = 73;
const ROW_H = 60;
const ROW_STEP = 72;
const rect = (top: number, height: number) =>
  ({ top, bottom: top + height, height, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

const realRect = HTMLElement.prototype.getBoundingClientRect;
let pane: HTMLElement | null = null;

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEW_H });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (pane && this === pane) return rect(PANE_TOP, VIEW_H - PANE_TOP);
    if (pane && this.parentElement?.parentElement === pane) {
      const i = Array.from(this.parentElement.children).indexOf(this);
      return rect(PANE_TOP + 24 + i * ROW_STEP - pane.scrollTop, ROW_H);
    }
    return realRect.call(this);
  };
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
  pane = null;
});

const down = () => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
});

describe('SettingsHub menu scrolling', () => {
  it('scrolls Sign Out into view when the highlight reaches it, and back to the top', () => {
    const { container } = render(
      <SettingsHub onBack={vi.fn()} onSignOut={vi.fn()} onChangeCredentials={vi.fn()} onSwitchAccount={vi.fn()} />,
    );
    const signOut = container.querySelector('[data-howto="hub.signOut"]') as HTMLElement;
    pane = signOut.parentElement!.parentElement as HTMLElement;
    expect(pane.scrollTop).toBe(0);

    // Account Info is highlighted first; Sign Out is the 7th row, 6 presses down.
    for (let i = 0; i < 6; i++) down();
    expect(signOut.getAttribute('data-focused')).toBe('true');
    const r = signOut.getBoundingClientRect();
    expect(pane.scrollTop).toBeGreaterThan(0);
    expect(r.bottom).toBeLessThanOrEqual(VIEW_H);
    expect(r.top).toBeGreaterThanOrEqual(PANE_TOP);

    // Down wraps to Back (in the header), then the first row: the menu is back at the top.
    down();
    down();
    expect(pane.scrollTop).toBe(0);
  });
});
