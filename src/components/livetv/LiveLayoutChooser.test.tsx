import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

import LiveLayoutChooser from './LiveLayoutChooser';

const picked = () => document.querySelector('[data-live-layout-card][data-focused="true"]')?.getAttribute('data-live-layout-card');
const saved = () => localStorage.getItem('snow-livetv-layout');
const press = (key: string) => act(() => { fireEvent.keyDown(window, { key }); });
const HINT = 'OK Keep it';

// The first-open "pick a look" on a phone (Tronix 9520eec): a card is
// tapped, no remote hints on a touch screen, one card per row upright. The
// default stays the TV's (sideways a phone draws the TV layout).
describe('the first-open Live TV layout chooser', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { cleanup(); __setPhoneModeForTests({ touch: false, phone: false }); });

  it('a TV: four cards in a row (the Guide the fourth), the remote hints shown, Back keeps the default', () => {
    const onDone = vi.fn();
    render(<LiveLayoutChooser onDone={onDone} />);
    expect(picked()).toBe('compact');
    expect(document.querySelector('.grid-cols-4')).toBeTruthy();
    expect(document.body.textContent).toContain(HINT);
    press('Escape');
    expect(saved()).toBe('compact');
    expect(onDone).toHaveBeenCalledWith('compact');
  });

  it('a phone upright: one card per row, no remote hints, a tap keeps the one tapped', () => {
    __setPhoneModeForTests({ touch: true, phone: true, portrait: true });
    const onDone = vi.fn();
    render(<LiveLayoutChooser onDone={onDone} />);
    expect(document.querySelector('.grid-cols-1')).toBeTruthy();
    expect(document.body.textContent).not.toContain(HINT);
    act(() => { fireEvent.click(document.querySelector('[data-live-layout-card="grid"]')!); });
    expect(saved()).toBe('grid');
    expect(onDone).toHaveBeenCalledWith('grid');
  });

  it('a phone sideways: the TV screen, without the remote hints', () => {
    __setPhoneModeForTests({ touch: true, phone: true, portrait: false });
    render(<LiveLayoutChooser onDone={vi.fn()} />);
    expect(document.querySelector('.grid-cols-4')).toBeTruthy();
    expect(document.body.textContent).not.toContain(HINT);
  });
});
