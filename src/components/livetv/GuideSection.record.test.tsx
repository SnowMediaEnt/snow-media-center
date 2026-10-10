/**
 * Scheduled recordings from the Guide (TRACKER 25.12): the remote's Menu key
 * on a channel opens the Record dialog in programme mode (the channel's
 * programmes, padded times, the extra-stream line); OK pressed briefly still
 * plays (a held OK saves a favourite: GuideSection.hold.test.tsx); a schedule
 * carries no stream address or login; scheduled programmes get a red dot; and
 * a Kids profile, the demo and a build without the recorder don't offer it.
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCategory, XtreamLiveStream } from '@/lib/xtream';
import { clockLabel } from '@/lib/recordSchedule';

configure({ asyncUtilTimeout: 4000 });

const line = { host: 'http://h.test', username: 'someuser', password: 'secretpw', output: 'm3u8' as const };
const nowS = Math.floor(Date.now() / 1000);
/** Three programmes on channel 301: on now, in 50 minutes, in 110 minutes (true UTC timestamps). */
const PROGRAMMES = [
  { title: 'Morning Show', s: nowS - 600, e: nowS + 3000 },
  { title: 'The News', s: nowS + 3000, e: nowS + 6600 },
  { title: 'Late Film', s: nowS + 6600, e: nowS + 10200 },
];

const api = vi.hoisted(() => ({
  categories: [] as XtreamCategory[],
  streams: {} as Record<string, XtreamLiveStream[]>,
  schedules: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ fn: string; opts?: Record<string, unknown> }>,
  plan: 2 as number | null,
  buffer: false,
  scheduleError: null as (Error & { code?: string; data?: unknown }) | null,
}));

vi.mock('@/lib/xtream', async (orig) => {
  const real = await orig<typeof import('@/lib/xtream')>();
  return {
    ...real,
    getLiveCategories: async () => api.categories,
    getLiveStreams: async (_c: unknown, categoryId?: string) => api.streams[String(categoryId)] ?? [],
    getShortEpg: async () => ({
      epg_listings: PROGRAMMES.map((p) => ({ title: btoa(p.title), start: '', end: '', start_timestamp: String(p.s), stop_timestamp: String(p.e) })),
    }),
    loadPlayerAccount: async () => (api.plan === null ? null : { host: 'http://h.test', username: 'someuser', password: 'secretpw', maxConnections: api.plan }),
  };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/capacitor/SnowPlayer', () => ({
  hasNativePlayer: () => true,
  SnowPlayer: {
    timeshiftStatus: async () => { api.calls.push({ fn: 'timeshiftStatus' }); return { state: api.buffer ? 'capturing' : 'off' }; },
    timeshiftWipe: async () => { api.calls.push({ fn: 'timeshiftWipe' }); },
  },
}));
vi.mock('@/capacitor/SnowRecorder', () => ({
  RECORDINGS_CHANGED_EVENT: 'smc-recordings:changed',
  notifyRecordingsChanged: () => { window.dispatchEvent(new CustomEvent('smc-recordings:changed')); },
  hasRecorder: () => true,
  SnowRecorder: {
    getVolumes: async () => ({ volumes: [{ id: 'box', label: 'This box', removable: false, freeBytes: 40 * 1024 ** 3, totalBytes: 64 * 1024 ** 3 }] }),
    listSchedules: async () => ({ schedules: api.schedules }),
    active: async () => ({ jobs: [] }),
    schedule: async (o: Record<string, unknown>) => {
      api.calls.push({ fn: 'schedule', opts: o });
      if (api.scheduleError) throw api.scheduleError;
      return { id: 'new', exact: true };
    },
    start: async (o: Record<string, unknown>) => { api.calls.push({ fn: 'start', opts: o }); return { id: 'r1', name: 'x', volumeLabel: 'This box' }; },
  },
}));
vi.mock('@/hooks/useLiveRewind', () => ({ panelOffset: async () => 0 }));
vi.mock('@/hooks/useNativePlayer', () => ({ useNativePlayer: () => ({ buffering: false, error: null, retry: () => {} }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: (t: unknown) => { api.calls.push({ fn: 'toast', opts: t as Record<string, unknown> }); } }));
vi.mock('./BufferingDiagnostics', () => ({ default: () => null }));
vi.mock('./VideoPlayer', () => ({ default: () => <div data-testid="video" /> }));
vi.mock('@tanstack/react-virtual', async () => {
  const { useMemo } = await import('react');
  return {
    useVirtualizer: ({ count, estimateSize, getItemKey }: { count: number; estimateSize: (i: number) => number; getItemKey?: (i: number) => number | string }) => {
      const items = useMemo(
        () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey ? getItemKey(index) : index, start: index * estimateSize(index), size: estimateSize(index) })),
        [count, estimateSize, getItemKey],
      );
      return { getVirtualItems: () => items, getTotalSize: () => count * estimateSize(0), measure: () => {} };
    },
  };
});

const down = (k: string, extra: Partial<KeyboardEventInit> = {}) => act(() => { fireEvent.keyDown(document.body, { key: k, ...extra }); });
const up = (k: string) => act(() => { fireEvent.keyUp(document.body, { key: k }); });
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
/** The remote's Menu key (KEYCODE_MENU), pressed and let go; the dialog reads the schedules first. */
const menu = async () => {
  act(() => { fireEvent.keyDown(document.body, { key: 'ContextMenu', keyCode: 82 }); });
  act(() => { fireEvent.keyUp(document.body, { key: 'ContextMenu', keyCode: 82 }); });
  await sleep(50);
};
const dialog = () => document.querySelector('[data-record-dialog]');
const fullscreen = () => document.documentElement.classList.contains('snowplayer-fullscreen');
const progRows = () => Array.from(document.querySelectorAll('[data-record-programme]')).map((n) => n.textContent);
const calls = (fn: string) => api.calls.filter((c) => c.fn === fn).map((c) => c.opts);

async function freshGuide() {
  vi.resetModules();
  const { default: Guide } = await import('./GuideSection');
  const kids = await import('@/lib/kidsFilter');
  return { Guide, kids };
}

/** The Guide on News with channel 301's programmes loaded and the row focused. */
async function openGuide(Guide: React.ComponentType<Record<string, unknown>>) {
  render(<Guide creds={line} isActive onExitLeft={() => {}} />);
  await waitFor(() => expect(document.body.textContent).toContain('News Channel'));
  await waitFor(() => expect(document.body.textContent).toContain('Late Film'));
  await sleep(50);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  api.categories = [{ category_id: '1', category_name: 'News' }];
  api.streams = { 1: [{ stream_id: 301, name: 'News Channel', category_id: '1' }] };
  api.schedules = [];
  api.calls = [];
  api.plan = 2;
  api.buffer = false;
  api.scheduleError = null;
});
afterEach(() => { document.documentElement.className = ''; sessionStorage.clear(); });

describe('Guide: Menu to record a programme', () => {
  it('OK pressed briefly still plays, and it plays when OK is let go', async () => {
    const { Guide } = await freshGuide();
    await openGuide(Guide as never);
    down('Enter');
    expect(fullscreen()).toBe(false); // acts on release, so a hold can be told apart
    up('Enter');
    expect(fullscreen()).toBe(true);
    expect(dialog()).toBeNull();
  });

  it('Menu opens the dialog in programme mode with the channel\'s programmes and the padded times; nothing plays', async () => {
    const { Guide } = await freshGuide();
    await openGuide(Guide as never);
    await menu();
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain('Record a programme on News Channel');
    const t = (s: number) => clockLabel(s * 1000);
    expect(progRows()).toEqual([
      `${t(PROGRAMMES[0].s)}\u2013${t(PROGRAMMES[0].e)}Morning Show`,
      `${t(PROGRAMMES[1].s)}\u2013${t(PROGRAMMES[1].e)}The News`,
      `${t(PROGRAMMES[2].s)}\u2013${t(PROGRAMMES[2].e)}Late Film`,
    ]);
    // The extra-stream line, same words as Record now.
    expect(dialog()!.querySelector('[data-record-note]')?.textContent).toBe('Recording uses one more stream on your line (your plan allows 2 at once).');
    expect(fullscreen()).toBe(false);
    expect(dialog()).not.toBeNull();
    // Back closes it, and the Guide is as it was.
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(dialog()).toBeNull();
  });

  it('a held OK opens no dialog: it saves the channel to Favorites (the hint says Menu records)', async () => {
    const { Guide } = await freshGuide();
    await openGuide(Guide as never);
    expect(document.body.textContent).toContain('Menu: record');
    down('Enter');
    await sleep(700);
    up('Enter');
    expect(dialog()).toBeNull();
    expect(fullscreen()).toBe(false);
    expect(calls('toast')).toEqual([{ title: 'Added to Favorites', description: 'News Channel' }]);
  });

  it('a later programme is scheduled with its true UTC times and the padding; the address and login are never sent', async () => {
    const { Guide } = await freshGuide();
    await openGuide(Guide as never);
    await menu();
    // Pick "The News", go to Start, OK.
    act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    act(() => { fireEvent.keyDown(window, { key: 'ArrowDown' }); });
    act(() => { fireEvent.keyDown(window, { key: 'ArrowDown' }); });
    act(() => { fireEvent.keyDown(window, { key: 'Enter' }); });
    await sleep(20);
    const [opts] = calls('schedule');
    expect(opts).toMatchObject({
      streamId: 301, host: 'http://h.test', channel: 'News Channel', title: 'The News',
      startUtcMs: PROGRAMMES[1].s * 1000, endUtcMs: PROGRAMMES[1].e * 1000,
      padBeforeMin: 2, padAfterMin: 5, volumeId: 'box', maxConnections: 2,
    });
    const sent = JSON.stringify(opts);
    expect(sent).not.toMatch(/secretpw|someuser|\/live\/|url/i);
    expect(calls('start')).toHaveLength(0);
    expect(dialog()).toBeNull();
    const toast = calls('toast')[0] as { title: string; description: string };
    expect(toast.title).toBe('Scheduled: The News');
    expect(toast.description).toContain('Recording uses one more stream on your line (your plan allows 2 at once).');
  });

  it('the programme on now records at once, until its end plus the late padding', async () => {
    const { Guide } = await freshGuide();
    await openGuide(Guide as never);
    await menu();
    act(() => { fireEvent.keyDown(window, { key: 'ArrowDown' }); });
    act(() => { fireEvent.keyDown(window, { key: 'ArrowDown' }); });
    act(() => { fireEvent.keyDown(window, { key: 'Enter' }); });
    await sleep(20);
    expect(calls('schedule')).toHaveLength(0);
    const [opts] = calls('start') as Array<{ durationMin: number; url: string; channel: string; maxSimultaneous: number }>;
    expect(opts.channel).toBe('News Channel');
    expect(opts.url).toBe('http://h.test/live/someuser/secretpw/301.ts');
    expect(opts.durationMin).toBeGreaterThanOrEqual(55); // 50 min left + 5 late
    expect(opts.durationMin).toBeLessThanOrEqual(56);
    expect(opts.maxSimultaneous).toBe(2);
  });

  /** Menu, choose the programme on now, Start. */
  async function recordNow() {
    const { Guide } = await freshGuide();
    await openGuide(Guide as never);
    await menu();
    act(() => { fireEvent.keyDown(window, { key: 'ArrowDown' }); });
    act(() => { fireEvent.keyDown(window, { key: 'ArrowDown' }); });
    act(() => { fireEvent.keyDown(window, { key: 'Enter' }); });
    await sleep(20);
  }

  it('recording now while the rewind buffer runs wipes the buffer first, then starts, and says so', async () => {
    api.buffer = true;
    await recordNow();
    const order = api.calls.map((c) => c.fn).filter((f) => f === 'timeshiftWipe' || f === 'start');
    expect(order).toEqual(['timeshiftWipe', 'start']);
    const toast = calls('toast').pop() as { description: string };
    expect(toast.description).toContain('Rewind paused while recording');
  });

  it('with 4 streams the buffer stays; with no buffer nothing is wiped or said', async () => {
    api.buffer = true;
    api.plan = 4;
    await recordNow();
    expect(api.calls.some((c) => c.fn === 'timeshiftWipe')).toBe(false);
    expect(calls('start')).toHaveLength(1);
  });

  it('no buffer running: no wipe and no rewind note', async () => {
    await recordNow();
    expect(api.calls.some((c) => c.fn === 'timeshiftWipe')).toBe(false);
    const toast = calls('toast').pop() as { description: string };
    expect(toast.description).not.toContain('Rewind paused');
  });

  it('a refusal from the scheduler is said in words', async () => {
    api.scheduleError = Object.assign(new Error('You already have 2 recordings then. Cancel one first.'), { code: 'CONFLICT', data: { atMs: PROGRAMMES[1].s * 1000, count: 2 } });
    const { Guide } = await freshGuide();
    await openGuide(Guide as never);
    await menu();
    act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    act(() => { fireEvent.keyDown(window, { key: 'ArrowDown' }); });
    act(() => { fireEvent.keyDown(window, { key: 'ArrowDown' }); });
    act(() => { fireEvent.keyDown(window, { key: 'Enter' }); });
    await sleep(20);
    const toast = calls('toast').find((t) => (t as { variant?: string }).variant === 'destructive') as { title: string; description: string };
    expect(toast.title).toBe('Could not schedule it');
    expect(toast.description).toMatch(/^You already have 2 recordings at \d{1,2}:\d\d\s[AP]M\. Cancel one first\.$/);
  });

  it('a programme that is scheduled carries a red dot, and is marked in the dialog', async () => {
    api.schedules = [{ id: 's1', streamId: 301, channelName: 'News Channel', programmeTitle: 'The News', startUtcMs: PROGRAMMES[1].s * 1000, endUtcMs: PROGRAMMES[1].e * 1000, padBeforeMin: 2, padAfterMin: 5, volumeId: 'box', status: 'scheduled', finishedAtMs: 0 }];
    const { Guide } = await freshGuide();
    await openGuide(Guide as never);
    await waitFor(() => expect(document.querySelectorAll('[data-scheduled-dot]')).toHaveLength(1));
    await menu();
    expect(document.querySelectorAll('[aria-label="Already scheduled"]')).toHaveLength(1);
  });

  it('a Kids profile gets no dialog: Menu does nothing, OK still plays', async () => {
    const { Guide, kids } = await freshGuide();
    kids.setKidsLevel('kids');
    try {
      await openGuide(Guide as never);
      await menu();
      expect(dialog()).toBeNull();
      expect(document.body.textContent).not.toContain('Menu: record');
      down('Enter');
      up('Enter');
      expect(fullscreen()).toBe(true);
      expect(dialog()).toBeNull();
    } finally {
      kids.setKidsLevel(null);
    }
  });

  it('the demo Guide offers nothing to record', async () => {
    sessionStorage.setItem('smc-demo', '1');
    const { Guide } = await freshGuide();
    render(<Guide creds={line as never} isActive onExitLeft={() => {}} />);
    await waitFor(() => expect(document.querySelector('[data-cat-i]')).not.toBeNull());
    await sleep(100);
    expect(document.body.textContent).not.toContain('Menu: record');
    await menu();
    expect(dialog()).toBeNull();
  });
});
