/**
 * The Guide and a channel off the air (offair-status): its row says "Off the
 * air" (Large: in words; Compact: the ⚠️ on the row, the words for the
 * highlighted channel at the top), and OK asks first (Watch anyway / Pick
 * another) before it is handed to Live TV, the reports asked for again first
 * when they are more than a few seconds old.
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCategory, XtreamLiveStream } from '@/lib/xtream';

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

const line = { host: 'http://h', username: 'u', password: 'p' };
const api = vi.hoisted(() => ({
  categories: [] as XtreamCategory[],
  streams: {} as Record<string, XtreamLiveStream[]>,
  /** A category's list held back until the test lets it go. */
  gate: null as Promise<void> | null,
}));
vi.mock('@/lib/xtream', async (orig) => {
  const real = await orig<typeof import('@/lib/xtream')>();
  const now = () => Math.floor(Date.now() / 1000);
  return {
    ...real,
    getLiveCategories: async () => api.categories,
    getLiveStreams: async (_c: unknown, categoryId?: string) => {
      if (api.gate) await api.gate;
      return api.streams[String(categoryId)] ?? [];
    },
    getShortEpg: async (_c: unknown, streamId: number) => ({
      epg_listings: [{ title: btoa(`Show ${streamId}`), start: '', end: '', start_timestamp: String(now() - 600), stop_timestamp: String(now() + 3000) }],
    }),
  };
});
// The down-channel reports: the real lib/channelStatus, this fake server.
const server = vi.hoisted(() => ({ list: { ok: true, down: [] as string[], offair: [] as string[] } as Record<string, unknown>, asked: 0, hold: null as Promise<void> | null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async (_n: string, { body }: { body: { op: string } }) => {
        if (body.op === 'list') { server.asked += 1; if (server.hold) await server.hold; }
        return { data: body.op === 'list' ? server.list : { ok: true }, error: null };
      }),
    },
  },
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), getDeviceId: () => 'device-12345678' }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => false }));
vi.mock('@/hooks/useNativePlayer', () => ({ useNativePlayer: () => ({ buffering: false, error: null, retry: () => {} }) }));
vi.mock('./BufferingDiagnostics', () => ({ default: () => null }));
vi.mock('./VideoPlayer', () => ({ default: ({ src }: { src: string | null }) => <div data-testid="video" data-src={src ?? ''} /> }));
// jsdom has no layout: every row is "on screen".
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

// A press: down and up (OK acts on release; held, it saves a favourite).
const key = (k: string) => act(() => { fireEvent.keyDown(document.body, { key: k }); fireEvent.keyUp(document.body, { key: k }); });
const rowNames = () => [...document.querySelectorAll('[data-guide-name]')].map((el) => el.textContent);
/** The grid row with the highlight (a row's own div, not a category chip). */
const highlighted = () => [...document.querySelectorAll('div[data-focused="true"]')].map((el) => el.textContent ?? '').join(' | ');
const seeRow = (name: string) => waitFor(() => expect(rowNames()).toContain(name));
const deeplink = () => JSON.parse(sessionStorage.getItem('smc-live-deeplink') || 'null');

async function freshGuide() {
  vi.resetModules();
  return (await import('./GuideSection')).default;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // These cover the Large Guide (the chips, 72 px rows); GuideSection.compact covers Compact.
  localStorage.setItem('snow-view-size', 'large');
  server.list = { ok: true, down: ['h|301'], offair: ['h|301'] };
  server.asked = 0;
  server.hold = null;
  api.categories = [{ category_id: '1', category_name: 'News' }, { category_id: '2', category_name: 'PPV / EVENTS' }];
  api.streams = {
    1: [{ stream_id: 301, name: 'News Channel', category_id: '1' }],
    2: [
      { stream_id: 401, name: 'LIVE EVENT 01 - 4pm Prelims Fight Night 332', category_id: '2', num: 1 },
      { stream_id: 402, name: 'LIVE EVENT 02 - 8pm Fight Night 332 Stone v Rivers', category_id: '2', num: 2 },
    ],
  };
});
afterEach(() => { sessionStorage.clear(); api.gate = null; vi.restoreAllMocks(); });

const warning = () => document.querySelector('[data-channel-warning]');
const realNow = Date.now.bind(Date);

describe('the Guide: a channel off the air', () => {
  it('Large: its row says "Off the air", in red', async () => {
    const Guide = await freshGuide();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onWatch={vi.fn()} />);
    await seeRow('News Channel');
    await waitFor(() => expect(document.querySelector('[data-guide-report="offair"]')).not.toBeNull());
    const mark = document.querySelector('[data-guide-report="offair"]')!;
    expect(mark.textContent).toBe('Off the air');
    expect(mark.getAttribute('class')).toContain('text-red-300');
  });

  it('Compact: the ⚠️ on its row, and the words at the top for the highlighted channel', async () => {
    localStorage.setItem('snow-view-size', 'compact');
    const Guide = await freshGuide();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onWatch={vi.fn()} />);
    await seeRow('News Channel');
    await waitFor(() => expect(document.querySelector('[data-guide-report="offair"]')?.getAttribute('aria-label')).toBe('Off the air'));
    await waitFor(() => expect(document.querySelector('[data-guide-head-report="offair"]')?.textContent).toBe('Off the air'));
  });

  it('OK asks first: Pick another hands nothing over; Watch anyway hands it to Live TV', async () => {
    const Guide = await freshGuide();
    const onWatch = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onWatch={onWatch} />);
    await seeRow('News Channel');
    await waitFor(() => expect(document.querySelector('[data-guide-report="offair"]')).not.toBeNull());
    await key('Enter');
    await waitFor(() => expect(warning()?.getAttribute('data-channel-warning')).toBe('offair'));
    expect(onWatch).not.toHaveBeenCalled();
    // The highlight starts on Pick another.
    await key('Enter');
    expect(warning()).toBeNull();
    expect(onWatch).not.toHaveBeenCalled();
    expect(deeplink()).toBeNull();
    // Again, and Watch anyway.
    await key('Enter');
    await waitFor(() => expect(warning()).not.toBeNull());
    await key('ArrowLeft');
    await key('Enter');
    expect(onWatch).toHaveBeenCalledTimes(1);
    expect(deeplink()).toMatchObject({ streamId: 301 });
  });

  it('marked a moment ago: the reports are asked for again before it is handed over, and it asks first', async () => {
    server.list = { ok: true, down: [], offair: [] };
    const Guide = await freshGuide();
    const onWatch = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onWatch={onWatch} />);
    await seeRow('News Channel');
    await waitFor(() => expect(server.asked).toBe(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(document.querySelector('[data-guide-report]')).toBeNull();
    // Another box found it off the air just now; this box's list is 20 s old.
    server.list = { ok: true, down: ['h|301'], offair: ['h|301'] };
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 20_000);
    await key('Enter');
    await waitFor(() => expect(warning()?.getAttribute('data-channel-warning')).toBe('offair'));
    expect(server.asked).toBe(2);
    expect(onWatch).not.toHaveBeenCalled();
  });

  it('a channel nobody reported is handed over as before', async () => {
    server.list = { ok: true, down: [], offair: [] };
    const Guide = await freshGuide();
    const onWatch = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onWatch={onWatch} />);
    await seeRow('News Channel');
    await key('Enter');
    await waitFor(() => expect(onWatch).toHaveBeenCalledTimes(1));
    expect(warning()).toBeNull();
  });
});

describe('the Guide: a hand-over waiting for the reports', () => {
  async function pending(active = true) {
    server.list = { ok: true, down: [], offair: [] };
    const Guide = await freshGuide();
    const onWatch = vi.fn();
    const view = render(<Guide creds={line as never} isActive={active} onExitLeft={vi.fn()} onWatch={onWatch} />);
    await seeRow('News Channel');
    await waitFor(() => expect(server.asked).toBe(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    let release: () => void = () => undefined;
    server.hold = new Promise((r) => { release = r; });
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 20_000);
    await key('Enter');
    expect(onWatch).not.toHaveBeenCalled();
    return {
      onWatch,
      release: () => { server.hold = null; release(); },
      leave: () => view.rerender(<Guide creds={line as never} isActive={false} onExitLeft={vi.fn()} onWatch={onWatch} />),
    };
  }
  const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

  it('Back before they come: nothing is handed over', async () => {
    const p = await pending();
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    p.release();
    await wait(1300);
    expect(p.onWatch).not.toHaveBeenCalled();
    expect(deeplink()).toBeNull();
  });

  it('the Guide losing the remote before they come: nothing is handed over', async () => {
    const p = await pending();
    act(() => { p.leave(); });
    p.release();
    await wait(1300);
    expect(p.onWatch).not.toHaveBeenCalled();
  });

  it('otherwise handed over once they come', async () => {
    const p = await pending();
    p.release();
    await waitFor(() => expect(p.onWatch).toHaveBeenCalledTimes(1));
  });
});
