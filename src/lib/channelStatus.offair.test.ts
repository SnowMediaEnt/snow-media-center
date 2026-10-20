// A channel off the air (offair-status): what a box sends when its provider
// said the stream isn't there, how it shows here at once, how the list from
// the server carries it, the minute's poll, and the fresh look before a
// channel opens.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const calls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const server = vi.hoisted(() => ({
  list: { ok: true, down: [] as string[], offair: [] as string[] } as Record<string, unknown>,
  /** Hold the list's answer until this resolves. */
  hold: null as Promise<void> | null,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async (_n: string, { body }: { body: Record<string, unknown> }) => {
        calls.push(body);
        if (body.op === 'list' && server.hold) await server.hold;
        return body.op === 'list' ? { data: server.list, error: null } : { data: { ok: true }, error: null };
      }),
    },
  },
}));
vi.mock('@/lib/analytics', () => ({ getDeviceId: () => 'device-12345678' }));
vi.mock('@/lib/lineInfo', () => ({ lineReportFields: vi.fn(async () => ({ line_user: 'jsmith', active_cons: 1, max_cons: 2 })) }));

const line = { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'hunter2-secret', output: 'ts' as const, serverLabel: 'Dreamstreams' };
const H = 'dstreams.xyz:8080';
const flush = () => new Promise((r) => setTimeout(r, 0));
const lists = () => calls.filter((c) => c.op === 'list');
const signals = () => calls.filter((c) => c.op === 'signal');

beforeEach(async () => {
  calls.length = 0;
  server.list = { ok: true, down: [], offair: [] };
  server.hold = null;
  (await import('./channelStatus')).__setDownForTests([]);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('an off-the-air signal', () => {
  it('marks the channel here at once as off the air, and sends the status number only (no line, no address)', async () => {
    const m = await import('./channelStatus');
    const { result } = renderHook(() => m.useDownChannels([], false));
    act(() => { m.signalChannel(line.host, 101, 'ESPN', 'offair', line, 404); });
    // Before anything was sent: this box just saw it.
    expect(signals()).toEqual([]);
    expect(m.channelReport(result.current, line.host, 101)).toBe('offair');
    expect(m.isChannelDown(result.current, line.host, 101)).toBe(true);
    expect(m.isChannelOffAir(result.current, line.host, 101)).toBe(true);
    await vi.waitFor(() => expect(signals()).toHaveLength(1));
    expect(signals()[0]).toEqual({ op: 'signal', host: H, stream_id: 101, name: 'ESPN', kind: 'offair', device_id: 'device-12345678', http_status: 404 });
    expect(JSON.stringify(calls)).not.toContain('hunter2');
  });

  it('is never sent without a status the provider answered with (400-599)', async () => {
    const m = await import('./channelStatus');
    m.signalChannel(line.host, 102, 'ESPN', 'offair', line, null);
    m.signalChannel(line.host, 103, 'ESPN', 'offair', line, 302);
    await flush();
    expect(signals()).toEqual([]);
  });

  it('never for an outside service’s line', async () => {
    const m = await import('./channelStatus');
    m.signalChannel('http://their.example', 5, 'X', 'offair', { ...line, host: 'http://their.example', outside: true } as never, 404);
    await flush();
    expect(signals()).toEqual([]);
  });

  it('a box that played it fine clears it here at once, and a later off-the-air answer goes again', async () => {
    const m = await import('./channelStatus');
    const { result } = renderHook(() => m.useDownChannels([], false));
    m.signalChannel(H, 7, 'CNN', 'offair', undefined, 503);
    m.signalChannel(H, 7, 'CNN', 'ok');
    await vi.waitFor(() => expect(m.channelReport(result.current, H, 7)).toBeNull());
    // Off the air again within ten minutes: sent again (the ok let it go).
    m.signalChannel(H, 7, 'CNN', 'offair', undefined, 404);
    await vi.waitFor(() => expect(signals().map((c) => c.kind)).toEqual(['offair', 'ok', 'offair']));
    expect(m.channelReport(result.current, H, 7)).toBe('offair');
    // A viewer's "It's working now" ends it too.
    m.signalChannel(H, 7, 'CNN', 'clear');
    await vi.waitFor(() => expect(m.channelReport(result.current, H, 7)).toBeNull());
  });

  it('a second failure in ten minutes is not sent again, but still shows here', async () => {
    const m = await import('./channelStatus');
    m.signalChannel(H, 8, 'TNT', 'offair', undefined, 404);
    m.__setDownForTests([]); // the list came back without it meanwhile
    m.signalChannel(H, 8, 'TNT', 'offair', undefined, 404);
    expect(m.channelReport(new Set([m.channelStatusKey(H, 8), m.offairStatusKey(H, 8)]), H, 8)).toBe('offair');
  });
});

describe('the list from the server', () => {
  it('reads the channels off the air: down for this box, and said as "off the air"', async () => {
    server.list = { ok: true, down: [`${H}|101`, `${H}|102`], offair: [`${H}|101`] };
    const m = await import('./channelStatus');
    const { result } = renderHook(() => m.useDownChannels([{ host: line.host }], true));
    await vi.waitFor(() => expect(m.channelReport(result.current, H, 101)).toBe('offair'));
    expect(m.channelReport(result.current, H, 102)).toBe('down');
  });

  it('an older server (no offair list) shows them as down', async () => {
    server.list = { ok: true, down: [`${H}|101`] };
    const m = await import('./channelStatus');
    const { result } = renderHook(() => m.useDownChannels([{ host: line.host }], true));
    await vi.waitFor(() => expect(m.channelReport(result.current, H, 101)).toBe('down'));
  });

  it('a list for one service leaves another service’s marks alone', async () => {
    const m = await import('./channelStatus');
    m.__setDownForTests(['strmz.xyz|9', 'strmz.xyz|off:9']);
    server.list = { ok: true, down: [], offair: [] };
    const { result } = renderHook(() => m.useDownChannels([{ host: line.host }], true));
    await vi.waitFor(() => expect(lists()).toHaveLength(1));
    await act(async () => { await flush(); });
    expect(m.channelReport(result.current, 'strmz.xyz', 9)).toBe('offair');
  });
});

describe('asking every minute', () => {
  it('asks again after 60 s while the screen is on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const m = await import('./channelStatus');
    expect(m.POLL_MS).toBe(60_000);
    renderHook(() => m.useDownChannels([{ host: 'poll.example' }], true));
    await vi.waitFor(() => expect(lists()).toHaveLength(1));
    await act(async () => { vi.advanceTimersByTime(59_000); });
    expect(lists()).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(2_000); });
    await vi.waitFor(() => expect(lists()).toHaveLength(2));
  });

  it('not while the app is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const m = await import('./channelStatus');
    renderHook(() => m.useDownChannels([{ host: 'hidden.example' }], true));
    await vi.waitFor(() => expect(lists()).toHaveLength(1));
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { vi.advanceTimersByTime(61_000); });
    expect(lists()).toHaveLength(1);
    vis.mockRestore();
  });
});

describe('opening a channel', () => {
  it('a list younger than 15 s: opens at once, nothing asked', async () => {
    const m = await import('./channelStatus');
    renderHook(() => m.useDownChannels([{ host: line.host }], true));
    await vi.waitFor(() => expect(lists()).toHaveLength(1));
    await act(async () => { await flush(); });
    const go = vi.fn();
    m.openWhenFresh(line.host, go);
    expect(go).toHaveBeenCalledWith(null);
    expect(lists()).toHaveLength(1);
  });

  it('an older list is asked for again first, and the channel marked meanwhile is in what `go` gets', async () => {
    const m = await import('./channelStatus');
    renderHook(() => m.useDownChannels([{ host: line.host }], true));
    await vi.waitFor(() => expect(lists()).toHaveLength(1));
    await act(async () => { await flush(); });
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 20_000);
    // Another box found it off the air a moment ago.
    server.list = { ok: true, down: [`${H}|101`], offair: [`${H}|101`] };
    const go = vi.fn();
    m.openWhenFresh(line.host, go);
    expect(go).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    expect(lists()).toHaveLength(2);
    const fresh = go.mock.calls[0][0] as Set<string>;
    expect(m.channelReport(fresh, line.host, 101)).toBe('offair');
  });

  it('never waits more than a second for a slow server', async () => {
    const m = await import('./channelStatus');
    renderHook(() => m.useDownChannels([{ host: line.host }], true));
    await vi.waitFor(() => expect(lists()).toHaveLength(1));
    await act(async () => { await flush(); });
    vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.now() + 20_000);
    let release: () => void = () => undefined;
    server.hold = new Promise((r) => { release = r; });
    const go = vi.fn();
    m.openWhenFresh(line.host, go);
    await act(async () => { vi.advanceTimersByTime(999); });
    expect(go).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(2); });
    expect(go).toHaveBeenCalledTimes(1);
    // The late answer does not open it a second time.
    release();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('offline (or the server slow), the next channels in the same 15 s do not each wait again', async () => {
    const m = await import('./channelStatus');
    renderHook(() => m.useDownChannels([{ host: line.host }], true));
    await vi.waitFor(() => expect(lists()).toHaveLength(1));
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 20_000);
    server.list = { ok: false };
    const first = vi.fn();
    m.openWhenFresh(line.host, first);
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    const second = vi.fn();
    m.openWhenFresh(line.host, second);
    expect(second).toHaveBeenCalledWith(null);
  });

  it('nothing to ask (no Live TV screen asked yet, an outside service): opens at once', async () => {
    const m = await import('./channelStatus');
    const go = vi.fn();
    m.openWhenFresh(line.host, go);
    expect(go).toHaveBeenCalledWith(null);
    renderHook(() => m.useDownChannels([{ host: line.host }], true));
    const outside = vi.fn();
    m.openWhenFresh('', outside);
    expect(outside).toHaveBeenCalledWith(null);
  });
});
