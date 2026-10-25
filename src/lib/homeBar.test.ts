import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  chooseBarShow, chooseBarSource, emptyHintKey, filterBarItems, loadBarPrefs, saveBarPrefs, useBarPrefs,
  type BarPrefs,
} from './homeBar';
import { readMediaBarEnabled, setMediaBarEnabled } from '@/hooks/useMediaBarEnabled';
import { createOkHold } from './okHold';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

// The bar's own list, as MediaBar has it: the viewer's rows, then the shared Plex feed.
const ITEMS = [
  { id: 'h-ch', source: 'history', channel: { streamId: 1 } },
  { id: 'h-px', source: 'history' },
  { id: 'live1', source: 'live', channel: { streamId: 2 } },
  { id: 'fy1', source: 'foryou' },
  { id: 'feed1', source: 'plex' },
];
const ids = (p: BarPrefs) => filterBarItems(ITEMS, p).map((i) => i.id);

describe('content bar: every Source and Show makes a row', () => {
  it('Recommendations: everything (today), Live TV only the channels, Plex only the rest', () => {
    expect(ids({ source: 'both', show: 'recommended' })).toEqual(['h-ch', 'h-px', 'live1', 'fy1', 'feed1']);
    expect(ids({ source: 'live', show: 'recommended' })).toEqual(['h-ch', 'live1']);
    expect(ids({ source: 'plex', show: 'recommended' })).toEqual(['h-px', 'fy1', 'feed1']);
  });

  it('Continue watching: only what was being watched, from the Source asked for', () => {
    expect(ids({ source: 'both', show: 'continue' })).toEqual(['h-ch', 'h-px']);
    expect(ids({ source: 'live', show: 'continue' })).toEqual(['h-ch']);
    expect(ids({ source: 'plex', show: 'continue' })).toEqual(['h-px']);
  });

  it('says why a row is empty', () => {
    const none = { hasLines: false, hasPlex: false };
    expect(emptyHintKey({ source: 'both', show: 'favorites' }, { hasLines: true, hasPlex: true })).toBe('homeEdit.bar.emptyFavorites');
    expect(emptyHintKey({ source: 'live', show: 'favorites' }, none)).toBe('homeEdit.bar.emptyNoLive');
    expect(emptyHintKey({ source: 'plex', show: 'favorites' }, none)).toBe('homeEdit.bar.emptyMyList');
    expect(emptyHintKey({ source: 'both', show: 'continue' }, none)).toBe('homeEdit.bar.emptyContinue');
    expect(emptyHintKey({ source: 'live', show: 'recommended' }, none)).toBe('homeEdit.bar.emptyNoLive');
    expect(emptyHintKey({ source: 'plex', show: 'recommended' }, none)).toBe('homeEdit.bar.emptyNoPlex');
  });
});

describe('content bar choices: kept per profile', () => {
  it('defaults to Live TV and Plex, Recommendations; each profile keeps its own', () => {
    expect(loadBarPrefs('main')).toEqual({ source: 'both', show: 'recommended' });
    saveBarPrefs({ source: 'live', show: 'favorites' }, 'main');
    saveBarPrefs({ source: 'plex', show: 'continue' }, 'abc123');
    expect(loadBarPrefs('main')).toEqual({ source: 'live', show: 'favorites' });
    expect(loadBarPrefs('abc123')).toEqual({ source: 'plex', show: 'continue' });
    localStorage.setItem('smc-home-bar-v1:junk', '{"source":"tv","show":7}');
    expect(loadBarPrefs('junk')).toEqual({ source: 'both', show: 'recommended' });
  });

  it('Off is the bar\'s own switch; picking a Source again switches it back on', () => {
    setMediaBarEnabled(true);
    const { result } = renderHook(() => useBarPrefs());
    act(() => chooseBarSource('off'));
    expect(readMediaBarEnabled()).toBe(false);
    expect(result.current.source).toBe('off');
    act(() => chooseBarSource('plex'));
    expect(readMediaBarEnabled()).toBe(true);
    expect(result.current.source).toBe('plex');
    act(() => chooseBarShow('continue'));
    expect(result.current.show).toBe('continue');
    expect(loadBarPrefs()).toEqual({ source: 'plex', show: 'continue' });
  });
});

describe('OK hold (tiles and the bar)', () => {
  it('let go in time is a press; held, the menu, and the release after it is nothing', () => {
    vi.useFakeTimers();
    const hold = createOkHold<number>(600);
    const onHold = vi.fn();
    expect(hold.press(2, onHold)).toBe(true);
    vi.advanceTimersByTime(300);
    expect(hold.release()).toBe(2); // a press
    expect(onHold).not.toHaveBeenCalled();

    hold.press(1, onHold);
    expect(hold.press(1, onHold)).toBe(false); // a repeat while held
    vi.advanceTimersByTime(600);
    expect(onHold).toHaveBeenCalledWith(1);
    expect(hold.release()).toBeNull(); // the lift of the hold opens nothing

    hold.press(3, onHold);
    hold.cancel(); // moved away
    vi.advanceTimersByTime(1000);
    expect(onHold).toHaveBeenCalledTimes(1);
    expect(hold.release()).toBeNull();
  });
});
