import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import AppearanceScreen from './AppearanceScreen';
import { LIVE_ROW_SIZE_KEY, loadLiveRowSize } from '@/lib/liveRows';

// Player Settings › Appearance › Channel rows (lib/liveRows): Normal or Slim,
// under the layouts, only with a layout that draws channel rows (Classic,
// Compact); remembered on the box.

const key = (k: string) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
});
const group = (kind: string) => document.querySelector(`[data-appearance-group="${kind}"]`);
const focused = () => document.querySelector('[data-focused="true"]')?.textContent ?? '';

beforeEach(() => localStorage.clear());

describe('Appearance › Channel rows', () => {
  it('sits under the layouts with Compact chosen, Normal picked until Slim is', () => {
    localStorage.setItem('snow-livetv-layout', 'compact');
    render(<AppearanceScreen onBack={() => {}} />);
    const rows = group('liveRows');
    expect(rows).not.toBeNull();
    expect(rows?.textContent).toContain('Channel rows');
    const chips = Array.from(rows!.querySelectorAll('[data-selected]'));
    expect(chips.map((c) => c.textContent)).toEqual(['Normal', 'Slim — more channels']);
    expect(chips[0].getAttribute('data-selected')).toBe('true');
    // Right under the layouts.
    const kinds = Array.from(document.querySelectorAll('[data-appearance-group]')).map((g) => g.getAttribute('data-appearance-group'));
    expect(kinds.slice(0, 3)).toEqual(['liveLayout', 'liveRows', 'viewSize']);
  });

  it('Slim is chosen with the remote and remembered on the box', () => {
    localStorage.setItem('snow-livetv-layout', 'classic');
    render(<AppearanceScreen onBack={() => {}} />);
    key('ArrowDown');
    expect(focused()).toBe('Normal');
    key('ArrowRight');
    expect(focused()).toBe('Slim — more channels');
    key('Enter');
    expect(localStorage.getItem(LIVE_ROW_SIZE_KEY)).toBe('slim');
    expect(loadLiveRowSize()).toBe('slim');
    expect(group('liveRows')?.querySelector('[data-selected="true"]')?.textContent).toBe('Slim — more channels');
    // Down again: the next row (Size), as before.
    key('ArrowDown');
    expect(group('viewSize')?.querySelector('[data-focused="true"]')).not.toBeNull();
  });

  it('is not offered with the Vibez wall or the Guide (they draw no channel rows)', () => {
    localStorage.setItem('snow-livetv-layout', 'grid');
    const { unmount } = render(<AppearanceScreen onBack={() => {}} />);
    expect(group('liveRows')).toBeNull();
    key('ArrowDown');
    expect(group('viewSize')?.querySelector('[data-focused="true"]')).not.toBeNull();
    unmount();
    localStorage.setItem('snow-livetv-layout', 'guide');
    render(<AppearanceScreen onBack={() => {}} />);
    expect(group('liveRows')).toBeNull();
  });
});
