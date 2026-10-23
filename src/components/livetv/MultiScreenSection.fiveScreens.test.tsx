/**
 * 5 screens and the line's live connections (owner, 2026-10-23): the
 * 3-screen layout's big screen with four small ones along the bottom; a
 * warning before a screen that would take its line past the plan's limit
 * (add anyway, don't add, or message the other TVs on the line); a mark by
 * each screen's name while its line is full (F) or over (O); and, on a
 * low-memory box, a word before the fifth stream at once.
 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Slot = { url: string | null; buffering: boolean; error: string | null; retries: number; bufferingSince: number | null };
const ms = vi.hoisted(() => ({ load: vi.fn(), close: vi.fn(), focus: vi.fn(), rect: vi.fn(), stop: vi.fn() }));
const h = vi.hoisted(() => ({
  /** What each line's panel says (user_info), by host. */
  panel: {} as Record<string, Record<string, unknown>>,
  asked: [] as string[],
  account: null as null | Record<string, unknown>,
}));

vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => true }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: h.account }) }));
vi.mock('@/lib/favoritesSync', () => ({ loadFavoritesForLine: () => new Map(), lineKey: (c: { host: string; username: string }) => `${c.host}|${c.username}`, normalizeHost: (x: string) => x }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/hooks/useMultiScreenPlayers', async () => {
  const { useCallback, useState } = await import('react');
  const blank: Slot = { url: null, buffering: false, error: null, retries: 0, bufferingSince: null };
  const ids = ['ms1', 'ms2', 'ms3', 'ms4', 'ms5'];
  const empty = () => Object.fromEntries(ids.map((id) => [id, blank])) as Record<string, Slot>;
  return {
    MS_SLOT_IDS: ids,
    useMultiScreenPlayers: () => {
      const [slots, setSlots] = useState<Record<string, Slot>>(empty);
      const loadSlot = useCallback(async (sid: string, url: string) => { ms.load(sid, url); setSlots((s) => ({ ...s, [sid]: { ...blank, url } })); }, []);
      const closeSlot = useCallback(async (sid: string) => { ms.close(sid); setSlots((s) => ({ ...s, [sid]: blank })); }, []);
      const applyRect = useCallback(async (sid: string, r: unknown) => { ms.rect(sid, r); }, []);
      const focusAudio = useCallback(async (sid: string | null) => { ms.focus(sid); }, []);
      const stopAll = useCallback(async () => { ms.stop(); setSlots(empty()); }, []);
      return { slots, loadSlot, closeSlot, applyRect, focusAudio, stopAll };
    },
  };
});
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }],
  getLiveStreams: async () => [
    { stream_id: 11, name: 'Alpha News', num: 1, category_id: '1' },
    { stream_id: 22, name: 'Bravo Sports', num: 2, category_id: '1' },
    { stream_id: 33, name: 'Charlie Music', num: 3, category_id: '1' },
    { stream_id: 44, name: 'Delta Movies', num: 4, category_id: '1' },
    { stream_id: 55, name: 'Echo Kids', num: 5, category_id: '1' },
  ],
  getShortEpg: async () => ({ epg_listings: [] }),
  buildNativeLiveUrl: (c: { host: string }, id: number) => `native://${c.host.replace('http://', '')}/${id}`,
  authenticate: async (c: { host: string }) => { h.asked.push(c.host); return { user_info: h.panel[c.host] ?? {} }; },
}));

import MultiScreenSection from './MultiScreenSection';

// Five screens filled by the remote, each after a picker and a settle: long on a busy machine.
vi.setConfig({ testTimeout: 60_000 });
import { __resetLineReadingsForTests, freshLineReading } from './multiScreenLines';

const lineA = { host: 'http://a.test', username: 'u', password: 'p', output: 'ts' } as never;
const lineB = { host: 'http://b.test', username: 'v', password: 'q', output: 'ts' } as never;
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const qa = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
const text = () => document.body.textContent ?? '';
// A channel goes on after the channel reports (openWhenFresh, a second at most): room for a busy machine.
const SLOW = { timeout: 4000 };
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const tile = (i: number) => q(`[data-ms-tile="${i}"]`);
const marks = (m: 'full' | 'over') => qa(`[data-ms-line-mark="${m}"]`);
const GRID = { width: 960, height: 540 };

beforeEach(() => {
  for (const f of Object.values(ms)) f.mockReset();
  __resetLineReadingsForTests();
  h.panel = {};
  h.asked = [];
  h.account = null;
  document.documentElement.classList.remove('native-low-memory');
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const st = this.style;
    let r = { x: 0, y: 0, width: GRID.width, height: GRID.height };
    if (st.position === 'absolute' && st.width.endsWith('%')) {
      const f = (v: string, of: number) => (parseFloat(v) / 100) * of;
      r = { x: f(st.left, GRID.width), y: f(st.top, GRID.height), width: f(st.width, GRID.width), height: f(st.height, GRID.height) };
    }
    return { ...r, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.classList.remove('native-low-memory'); document.body.innerHTML = ''; });

const mount = (creds = lineA, onMessageLine?: () => void) => {
  const r = render(<MultiScreenSection creds={creds} isActive onExitLeft={() => {}} onExitUp={() => {}} onMessageLine={onMessageLine} />);
  return { again: (c: never) => r.rerender(<MultiScreenSection creds={c} isActive onExitLeft={() => {}} onExitUp={() => {}} onMessageLine={onMessageLine} />) };
};
/** The layout chooser: 0 = 2 side by side, 2 = 3 screens, 4 = 5 screens. */
const choose = async (n: number) => {
  await waitFor(() => expect(text()).toContain('5 Screens'));
  for (let i = 0; i < n; i++) key('ArrowRight');
  key('Enter');
  await settle();
};
/** OK on the highlighted empty screen, then the News channel at `row` and OK. */
const pick = async (row: number) => {
  key('Enter'); await settle();
  key('ArrowDown'); await settle(400); // Favorites -> News; its list loads once the highlight rests
  key('ArrowRight'); await settle(100);
  for (let i = 0; i < row; i++) key('ArrowDown');
  key('Enter');
  await settle(150);
};
const addChannel = async (row: number, loads: number) => {
  await pick(row);
  await waitFor(() => expect(ms.load).toHaveBeenCalledTimes(loads), SLOW);
  await settle(50);
};

describe('Multi-Screen: 5 screens', () => {
  it('is offered as "5 Screens, 1 Big + 4 Small": the big screen and four small ones along the bottom, all five filled with the remote; OK on a small one swaps it in', async () => {
    h.panel['http://a.test'] = { max_connections: 10, active_cons: 0 };
    mount();
    await waitFor(() => expect(text()).toContain('1 Big + 4 Small'));
    expect(q('[data-layout-card="5"]')).toBeTruthy();
    // No device note on a box with memory to spare.
    expect(q('[data-weak-box]')).toBeNull();
    await choose(4);
    expect(qa('[data-ms-tile]')).toHaveLength(5);
    expect(q('[data-ms-swap-hint]')).toBeTruthy();

    await addChannel(0, 1); // the big screen
    key('ArrowDown');
    await addChannel(1, 2);
    for (let i = 2; i <= 4; i++) {
      key('ArrowRight');
      await addChannel(i, i + 1);
    }
    expect(ms.load.mock.calls.map(([sid, url]) => [sid, url])).toEqual([
      ['ms1', 'native://a.test/11'], ['ms2', 'native://a.test/22'], ['ms3', 'native://a.test/33'],
      ['ms4', 'native://a.test/44'], ['ms5', 'native://a.test/55'],
    ]);
    // The highlight walked along the bottom row; the sound never left the big screen.
    expect(tile(4)?.getAttribute('data-focused')).toBe('true');
    expect(ms.focus.mock.calls.map(([sid]) => sid).filter((sid) => sid && sid !== 'ms1')).toEqual([]);
    // Under the limit: no mark by any name; no warning was shown.
    expect(qa('[data-ms-line-mark]')).toHaveLength(0);
    expect(q('[data-line-limit]')).toBeNull();
    // ▶ past the last small screen goes nowhere.
    key('ArrowRight');
    expect(tile(4)?.getAttribute('data-focused')).toBe('true');

    // OK (let go) on the last small screen: it goes big, the big one's channel takes its place.
    ms.load.mockClear(); ms.focus.mockClear();
    key('Enter'); act(() => { fireEvent.keyUp(window, { key: 'Enter' }); });
    await waitFor(() => expect(ms.load).toHaveBeenCalledWith('ms1', 'native://a.test/55'), SLOW);
    expect(ms.load).toHaveBeenCalledWith('ms5', 'native://a.test/11');
    expect(ms.focus).toHaveBeenCalledWith('ms1');
    expect(tile(0)?.textContent).toContain('Echo Kids');
    // ▲ back to the big screen.
    key('ArrowUp');
    expect(tile(0)?.getAttribute('data-focused')).toBe('true');
  });
});

describe('Multi-Screen: the line\'s connections', () => {
  it('F by the names when the line is exactly full; a warning before a screen that would go over: Don\'t add adds nothing, Add anyway adds it and the mark turns to O; closing one brings F back', async () => {
    h.panel['http://a.test'] = { max_connections: 2, active_cons: 0 };
    mount();
    await choose(2); // 3 screens
    await addChannel(0, 1);
    expect(qa('[data-ms-line-mark]')).toHaveLength(0); // 1 of 2: under
    key('ArrowDown');
    await addChannel(1, 2);
    // 2 of 2: full, on both screens of the line.
    await waitFor(() => expect(marks('full')).toHaveLength(2));
    expect(marks('full')[0].getAttribute('aria-label')).toBe('Line full');
    expect(marks('full')[0].querySelector('text')?.textContent).toBe('F');
    expect(tile(0)?.querySelector('[data-ms-line-mark]')).toBeTruthy();

    // A third: over the limit, so it asks first.
    key('ArrowRight');
    await pick(2);
    await waitFor(() => expect(q('[data-line-limit="over"]')).toBeTruthy(), SLOW);
    expect(text()).toContain('Over this line\'s limit');
    expect(text()).toContain('the line would have 3 streams playing, and it allows 2');
    expect(ms.load).toHaveBeenCalledTimes(2);
    // Nobody else on the line: nobody to message.
    expect(q('[data-line-choice="message"]')).toBeNull();
    // The highlight starts on Don't add: an OK out of habit adds nothing.
    expect(q('[data-line-choice="cancel"]')?.getAttribute('data-focused')).toBe('true');
    key('Enter');
    await settle();
    expect(q('[data-line-limit]')).toBeNull();
    expect(text()).not.toContain('Add a channel to screen'); // the picker went with it
    expect(ms.load).toHaveBeenCalledTimes(2);
    expect(tile(2)?.textContent).toContain('Add channel');

    // Again, and Add anyway: it plays, and every screen on the line says O.
    await pick(2);
    await waitFor(() => expect(q('[data-line-limit="over"]')).toBeTruthy(), SLOW);
    key('ArrowDown');
    expect(q('[data-line-choice="add"]')?.getAttribute('data-focused')).toBe('true');
    key('Enter');
    await waitFor(() => expect(ms.load).toHaveBeenCalledTimes(3), SLOW);
    await waitFor(() => expect(marks('over')).toHaveLength(3));
    expect(marks('over')[0].getAttribute('aria-label')).toBe('Over the line\'s limit');
    expect(marks('over')[0].querySelector('text')?.textContent).toBe('O');
    expect(marks('full')).toHaveLength(0);

    // Close that screen (the remote's Menu → Close screen): back to F.
    key('ContextMenu'); await settle();
    key('ArrowDown'); key('ArrowDown'); key('Enter');
    await waitFor(() => expect(ms.close).toHaveBeenCalledWith('ms3'));
    await waitFor(() => expect(marks('full')).toHaveLength(2));
    expect(marks('over')).toHaveLength(0);
    // The panel was asked once for all of it (no loop on it).
    expect(h.asked).toEqual(['http://a.test']);
  });

  it('other TVs on the line count too, the mark follows the panel\'s count when it changes, and "Message the other TVs on this line" opens their messages', async () => {
    h.panel['http://a.test'] = { max_connections: 3, active_cons: 0 };
    const onMessageLine = vi.fn();
    mount(lineA, onMessageLine);
    await choose(0); // 2 side by side
    await addChannel(0, 1);
    key('ArrowRight');
    await addChannel(1, 2);
    expect(qa('[data-ms-line-mark]')).toHaveLength(0); // 2 of 3

    // Another TV starts watching: the panel's next word (its count includes our two).
    h.panel['http://a.test'] = { max_connections: 3, active_cons: 3 };
    __resetLineReadingsForTests();
    await act(async () => { await freshLineReading(lineA, 2); });
    await waitFor(() => expect(marks('full')).toHaveLength(2));
    // And another: over.
    h.panel['http://a.test'] = { max_connections: 3, active_cons: 4 };
    __resetLineReadingsForTests();
    await act(async () => { await freshLineReading(lineA, 2); });
    await waitFor(() => expect(marks('over')).toHaveLength(2));
    // They stop: nothing again.
    h.panel['http://a.test'] = { max_connections: 3, active_cons: 2 };
    __resetLineReadingsForTests();
    await act(async () => { await freshLineReading(lineA, 2); });
    await waitFor(() => expect(qa('[data-ms-line-mark]')).toHaveLength(0));

    // Two other TVs on it now; changing a screen's channel adds no stream: no warning.
    h.panel['http://a.test'] = { max_connections: 3, active_cons: 3 };
    __resetLineReadingsForTests();
    await act(async () => { await freshLineReading(lineA, 2); });
    key('ContextMenu'); await settle();
    key('Enter'); await settle(); // Change channel
    key('ArrowDown'); await settle(400);
    key('ArrowRight'); await settle(100);
    key('ArrowDown'); key('ArrowDown'); key('Enter');
    await waitFor(() => expect(ms.load).toHaveBeenLastCalledWith('ms2', 'native://a.test/33'), SLOW);
    expect(q('[data-line-limit]')).toBeNull();

    // Back to the layouts and 3 screens: the third screen would make 4 on a line of 3.
    await settle(400);
    key('Escape'); await settle();
    await choose(2);
    await addChannel(0, 4);
    key('ArrowDown');
    await addChannel(1, 5); // ours 2 + the other TV's 1 = 3: full, allowed
    await waitFor(() => expect(marks('full')).toHaveLength(2));
    key('ArrowRight');
    await pick(2);
    await waitFor(() => expect(q('[data-line-limit="over"]')).toBeTruthy(), SLOW);
    expect(text()).toContain('Other TVs on the line are using 1.');
    key('ArrowDown'); key('ArrowDown');
    expect(q('[data-line-choice="message"]')?.textContent).toBe('Message the other TVs on this line (your screens stop)');
    key('Enter');
    expect(onMessageLine).toHaveBeenCalledTimes(1);
    await settle();
    expect(q('[data-line-limit]')).toBeNull();
    expect(ms.load).toHaveBeenCalledTimes(5);
  });

  it('counted per line: a screen from another line is not held against this one, and keeps its own mark', async () => {
    h.panel['http://a.test'] = { max_connections: 1, active_cons: 0 };
    h.panel['http://b.test'] = { max_connections: 5, active_cons: 0 };
    const m = mount(lineA);
    await choose(0);
    await addChannel(0, 1);
    await waitFor(() => expect(marks('full')).toHaveLength(1)); // line A: 1 of 1
    // Live TV switched to line B: the next screen comes from B.
    m.again(lineB);
    await settle();
    key('ArrowRight');
    await addChannel(1, 2);
    expect(q('[data-line-limit]')).toBeNull(); // B has 1 of 5
    expect(ms.load).toHaveBeenLastCalledWith('ms2', 'native://b.test/22');
    expect(tile(0)?.querySelector('[data-ms-line-mark="full"]')).toBeTruthy();
    expect(tile(1)?.querySelector('[data-ms-line-mark]')).toBeNull();
  });

  it('the panel silent: what Account info shows for the line (its limit) still guards it', async () => {
    h.account = { host: 'http://a.test', username: 'u', maxConnections: 1, activeCons: 0 };
    mount(lineA);
    await choose(0);
    await addChannel(0, 1);
    await waitFor(() => expect(marks('full')).toHaveLength(1));
    key('ArrowRight');
    await pick(1);
    await waitFor(() => expect(q('[data-line-limit="over"]')).toBeTruthy(), SLOW);
    expect(text()).toContain('the line would have 2 streams playing, and it allows 1');
    key('Escape'); // Back: Don't add
    await settle();
    expect(q('[data-line-limit]')).toBeNull();
    expect(ms.load).toHaveBeenCalledTimes(1);
    expect(qa('[data-ms-tile]')).toHaveLength(2); // still on the screens, not the layouts
  });
});

// Last in the file: "Add anyway" on the fifth screen holds for the rest of the run.
describe('Multi-Screen: five at once on a low-memory box', () => {
  it('the 5-screen card says so, and the fifth screen asks first; once added anyway, not again', async () => {
    document.documentElement.classList.add('native-low-memory');
    h.panel['http://a.test'] = { max_connections: 10, active_cons: 0 };
    mount();
    await waitFor(() => expect(q('[data-weak-box]')).toBeTruthy());
    expect(q('[data-layout-card="5"] [data-weak-box]')).toBeTruthy();
    expect(q('[data-layout-card="4"] [data-weak-box]')).toBeNull();
    await choose(4);
    await addChannel(0, 1);
    key('ArrowDown');
    await addChannel(1, 2);
    key('ArrowRight'); await addChannel(2, 3);
    key('ArrowRight'); await addChannel(3, 4); // four: no question
    key('ArrowRight');
    await pick(4);
    await waitFor(() => expect(q('[data-line-limit="device"]')).toBeTruthy(), SLOW);
    expect(text()).toContain('A lot for this device');
    expect(text()).not.toContain('Over this line\'s limit');
    key('ArrowDown'); key('Enter'); // Add anyway
    await waitFor(() => expect(ms.load).toHaveBeenCalledTimes(5), SLOW);
    expect(ms.load).toHaveBeenLastCalledWith('ms5', 'native://a.test/55');

    // Closed and filled again: not asked a second time.
    key('ContextMenu'); await settle();
    key('ArrowDown'); key('ArrowDown'); key('Enter');
    await waitFor(() => expect(ms.close).toHaveBeenCalledWith('ms5'));
    await settle(); // the screen's refs catch up (a passive effect) before the next key
    await addChannel(3, 6);
    expect(q('[data-line-limit]')).toBeNull();
  });
});
