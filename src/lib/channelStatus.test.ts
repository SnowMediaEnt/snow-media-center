import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ op: string; kind?: string; host?: string }> = [];
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async (_n: string, { body }: { body: { op: string; kind?: string; host?: string } }) => {
        calls.push(body);
        return body.op === 'list' ? { data: { ok: true, down: ['dstreams.xyz:8080|7'] }, error: null } : { data: { ok: true }, error: null };
      }),
    },
  },
}));
vi.mock('@/lib/analytics', () => ({ getDeviceId: () => 'device-12345678' }));

beforeEach(async () => { calls.length = 0; (await import('./channelStatus')).__setDownForTests([]); });

describe('channelStatus', () => {
  it('keys channels by normalised host', async () => {
    const m = await import('./channelStatus');
    m.__setDownForTests(['dstreams.xyz:8080|7']);
    const set = new Set(['dstreams.xyz:8080|7']);
    expect(m.isChannelDown(set, 'http://DStreams.xyz:8080/', 7)).toBe(true);
    expect(m.isChannelDown(set, 'dstreams.xyz:8080', 8)).toBe(false);
  });

  it('sends each kind of signal for a channel at most once in ten minutes', async () => {
    const m = await import('./channelStatus');
    m.signalChannel('http://strmz.xyz', 5, 'ESPN', 'fail');
    m.signalChannel('http://strmz.xyz', 5, 'ESPN', 'fail');
    m.signalChannel('http://strmz.xyz', 5, 'ESPN', 'down');
    await Promise.resolve();
    expect(calls.filter((c) => c.op === 'signal').map((c) => c.kind)).toEqual(['fail', 'down']);
    expect(calls[0].host).toBe('strmz.xyz');
  });

  it('a channel that played fine drops off the list here straight away', async () => {
    const m = await import('./channelStatus');
    m.__setDownForTests(['strmz.xyz|9']);
    const seen: number[] = [];
    window.addEventListener(m.CHANNEL_STATUS_EVENT, () => seen.push(1));
    m.signalChannel('strmz.xyz', 9, 'CNN', 'ok');
    expect(seen.length).toBe(1);
  });
});

describe('channelStatus: a viewer’s own report and clear', () => {
  it('shows a report on this box at once and clears it at once', async () => {
    const m = await import('./channelStatus');
    const seen: number[] = [];
    window.addEventListener(m.CHANNEL_STATUS_EVENT, () => seen.push(1));
    m.signalChannel('strmz.xyz', 11, 'TNT', 'down');
    expect(seen.length).toBe(1);
    m.signalChannel('strmz.xyz', 11, 'TNT', 'clear');
    expect(seen.length).toBe(2);
    await Promise.resolve();
    expect(calls.filter((c) => c.op === 'signal').map((c) => c.kind)).toEqual(['down', 'clear']);
  });
});

describe('channelStatus: a flooded list', () => {
  it('ignores a list longer than the server ever sends, and keeps the last one', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    const m = await import('./channelStatus');
    m.__setDownForTests(['strmz.xyz|3']);
    const invoke = vi.mocked(supabase.functions.invoke);
    invoke.mockImplementationOnce(async () => ({
      data: { ok: true, down: Array.from({ length: m.MAX_DOWN_CHANNELS + 1 }, (_, i) => `strmz.xyz|${i + 100}`) }, error: null,
    }) as never);
    const { act, renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => m.useDownChannels([{ host: 'strmz.xyz' }], true));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('channel-status', { body: { op: 'list', hosts: ['strmz.xyz'] } }));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect([...result.current]).toEqual(['strmz.xyz|3']);
  });
});

describe('channelStatus: a viewer with lines on several hosts', () => {
  it('asks again for every line when the saved lines arrive while the first list is on its way', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    const m = await import('./channelStatus');
    const invoke = vi.mocked(supabase.functions.invoke);
    let answerFirst: (v: unknown) => void = () => undefined;
    invoke.mockImplementationOnce(((_n: string, { body }: { body: { op: string } }) => {
      calls.push(body);
      return new Promise((r) => { answerFirst = r; });
    }) as never);
    invoke.mockImplementationOnce(((_n: string, { body }: { body: { op: string } }) => {
      calls.push(body);
      return Promise.resolve({ data: { ok: true, down: ['a.example|1', 'b.example|2'] }, error: null });
    }) as never);
    const { act, renderHook } = await import('@testing-library/react');
    const { result, rerender } = renderHook(({ lines }) => m.useDownChannels(lines, true), {
      initialProps: { lines: [{ host: 'a.example' }] },
    });
    rerender({ lines: [{ host: 'a.example' }, { host: 'b.example' }] });
    await act(async () => { answerFirst({ data: { ok: true, down: ['a.example|1'] }, error: null }); });
    await vi.waitFor(() => expect([...result.current].sort()).toEqual(['a.example|1', 'b.example|2']));
    expect(calls.filter((c) => c.op === 'list').map((c) => (c as { hosts?: string[] }).hosts)).toEqual([['a.example'], ['a.example', 'b.example']]);
  });

  it('does not let the first, shorter answer wipe the other lines’ ⚠️ on a second visit', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    const m = await import('./channelStatus');
    m.__setDownForTests(['b.example|2']);
    const invoke = vi.mocked(supabase.functions.invoke);
    let answerFirst: (v: unknown) => void = () => undefined;
    let answerSecond: (v: unknown) => void = () => undefined;
    invoke.mockImplementationOnce((() => new Promise((r) => { answerFirst = r; })) as never);
    invoke.mockImplementationOnce((() => new Promise((r) => { answerSecond = r; })) as never);
    const seen: string[][] = [];
    const { act, renderHook } = await import('@testing-library/react');
    const { result, rerender } = renderHook(({ lines }) => { const s = m.useDownChannels(lines, true); seen.push([...s]); return s; }, {
      initialProps: { lines: [{ host: 'a.example' }] },
    });
    rerender({ lines: [{ host: 'a.example' }, { host: 'b.example' }] });
    await act(async () => { answerFirst({ data: { ok: true, down: [] }, error: null }); });
    expect([...result.current]).toEqual(['b.example|2']);
    await act(async () => { answerSecond({ data: { ok: true, down: ['b.example|2', 'a.example|4'] }, error: null }); });
    await vi.waitFor(() => expect([...result.current].sort()).toEqual(['a.example|4', 'b.example|2']));
    expect(seen.every((s) => s.includes('b.example|2'))).toBe(true);
  });
});

describe('channelStatus: polling', () => {
  it('does not ask while inactive (full screen passes false)', async () => {
    const m = await import('./channelStatus');
    const { renderHook } = await import('@testing-library/react');
    renderHook(() => m.useDownChannels([{ host: 'c.example' }], false));
    await Promise.resolve();
    expect(calls.filter((c) => c.op === 'list')).toEqual([]);
  });
});

describe('channelStatus: which player errors mark a channel', () => {
  it('counts a stream failure, not this box’s audio decoder or a load it refused', async () => {
    const m = await import('./channelStatus');
    expect(m.isChannelFailure({ code: 'ERROR_CODE_IO_BAD_HTTP_STATUS' })).toBe(true);
    expect(m.isChannelFailure({ code: 'RECONNECT_EXHAUSTED' })).toBe(true);
    expect(m.isChannelFailure({ code: 'AUDIO_DECODE' })).toBe(false);
    expect(m.isChannelFailure({})).toBe(false);
    expect(m.isChannelFailure(null)).toBe(false);
  });
});
