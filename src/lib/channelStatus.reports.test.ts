// A whole category reported down, and channels reported buffering: what a
// box makes of the list, what it shows, and what it sends.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const answer = vi.hoisted(() => ({ list: { ok: true, down: [] as string[], buffering: [] as string[], categories: [] as string[] } as Record<string, unknown> }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async (_n: string, { body }: { body: Record<string, unknown> }) => {
        calls.push(body);
        return body.op === 'list' ? { data: answer.list, error: null } : { data: { ok: true }, error: null };
      }),
    },
  },
}));
vi.mock('@/lib/analytics', () => ({ getDeviceId: () => 'device-12345678' }));
vi.mock('@/lib/lineInfo', () => ({
  lineReportFields: vi.fn(async (c: { username: string }) => ({ line_user: c.username, active_cons: 2, max_cons: 3 })),
}));

const line = { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'hunter2-secret', output: 'ts' as const, serverLabel: 'Dreamstreams' };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  calls.length = 0;
  answer.list = { ok: true, down: [], buffering: [], categories: [] };
  (await import('./channelStatus')).__setDownForTests([]);
});

describe('channelReport: one thing to show per channel', () => {
  it('expands a category reported down to every channel in it', async () => {
    const m = await import('./channelStatus');
    const set = new Set([m.categoryStatusKey('dstreams.xyz:8080', '12')]);
    expect(m.channelReport(set, 'http://DStreams.xyz:8080/', 101, '12')).toBe('category');
    expect(m.channelReport(set, 'dstreams.xyz:8080', 999, 12)).toBe('category');
    expect(m.isChannelDown(set, 'dstreams.xyz:8080', 101, '12')).toBe(true);
    // Another category, or the same id on another service: untouched.
    expect(m.channelReport(set, 'dstreams.xyz:8080', 101, '13')).toBeNull();
    expect(m.channelReport(set, 'strmz.xyz', 101, '12')).toBeNull();
    // A channel with no category (a handed-over link) is not caught by it.
    expect(m.channelReport(set, 'dstreams.xyz:8080', 101)).toBeNull();
    expect(m.isCategoryDown(set, 'dstreams.xyz:8080', '12')).toBe(true);
  });

  it('down outranks buffering, and its own report outranks its category’s', async () => {
    const m = await import('./channelStatus');
    const h = 'strmz.xyz';
    expect(m.channelReport(new Set([m.bufferingStatusKey(h, 5)]), h, 5, '1')).toBe('buffering');
    expect(m.channelReport(new Set([m.bufferingStatusKey(h, 5), m.categoryStatusKey(h, '1')]), h, 5, '1')).toBe('category');
    expect(m.channelReport(new Set([m.bufferingStatusKey(h, 5), m.categoryStatusKey(h, '1'), m.channelStatusKey(h, 5)]), h, 5, '1')).toBe('down');
    // Buffering alone is not down.
    expect(m.isChannelDown(new Set([m.bufferingStatusKey(h, 5)]), h, 5, '1')).toBe(false);
    expect(m.isChannelBuffering(new Set([m.bufferingStatusKey(h, 5)]), h, 5)).toBe(true);
  });
});

describe('the list from the server', () => {
  it('reads buffering channels and down categories next to down channels', async () => {
    answer.list = { ok: true, down: ['strmz.xyz|1'], buffering: ['strmz.xyz|2'], categories: ['strmz.xyz|44'] };
    const m = await import('./channelStatus');
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => m.useDownChannels([{ host: 'https://strmz.xyz' }], true));
    await vi.waitFor(() => expect(result.current.size).toBe(3));
    expect(m.channelReport(result.current, 'strmz.xyz', 1)).toBe('down');
    expect(m.channelReport(result.current, 'strmz.xyz', 2)).toBe('buffering');
    expect(m.channelReport(result.current, 'strmz.xyz', 3, '44')).toBe('category');
  });

  it('an older server (down only) still works', async () => {
    answer.list = { ok: true, down: ['old.example|9'] };
    const m = await import('./channelStatus');
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => m.useDownChannels([{ host: 'old.example' }], true));
    await vi.waitFor(() => expect([...result.current]).toEqual(['old.example|9']));
  });

  it('ignores a flood of categories and keeps the last list', async () => {
    const m = await import('./channelStatus');
    m.__setDownForTests(['flood.example|3']);
    answer.list = { ok: true, down: [], categories: Array.from({ length: m.MAX_DOWN_CATEGORIES + 1 }, (_, i) => `flood.example|${i}`) };
    const { act, renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => m.useDownChannels([{ host: 'flood.example' }], true));
    await vi.waitFor(() => expect(calls.some((c) => c.op === 'list')).toBe(true));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect([...result.current]).toEqual(['flood.example|3']);
  });
});

describe('signals', () => {
  it('a buffering report shows here at once and carries the line’s username and connections, never its password', async () => {
    const m = await import('./channelStatus');
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => m.useDownChannels([], false));
    m.signalChannel(line.host, 7, 'ESPN', 'buffering', line);
    await vi.waitFor(() => expect(m.isChannelBuffering(result.current, line.host, 7)).toBe(true));
    await vi.waitFor(() => expect(calls.some((c) => c.op === 'signal')).toBe(true));
    const sent = calls.find((c) => c.op === 'signal')!;
    expect(sent).toMatchObject({ kind: 'buffering', host: 'dstreams.xyz:8080', stream_id: 7, line_user: 'jsmith', active_cons: 2, max_cons: 3 });
    expect(JSON.stringify(calls)).not.toContain('hunter2');
  });

  it('a clear ends both down and buffering here, and carries no line', async () => {
    const m = await import('./channelStatus');
    m.__setDownForTests([m.channelStatusKey('strmz.xyz', 4), m.bufferingStatusKey('strmz.xyz', 4)]);
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => m.useDownChannels([], false));
    m.signalChannel('strmz.xyz', 4, 'TNT', 'clear', line as never);
    await vi.waitFor(() => expect(result.current.size).toBe(0));
    await flush();
    expect(calls.find((c) => c.op === 'signal')).not.toHaveProperty('line_user');
  });

  it('an automatic "played fine" leaves a buffering report alone', async () => {
    const m = await import('./channelStatus');
    m.__setDownForTests([m.bufferingStatusKey('strmz.xyz', 6)]);
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => m.useDownChannels([], false));
    m.signalChannel('strmz.xyz', 6, 'CNN', 'ok');
    await flush();
    expect(m.isChannelBuffering(result.current, 'strmz.xyz', 6)).toBe(true);
  });

  it('a category report marks the category here at once and asks the server', async () => {
    const m = await import('./channelStatus');
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => m.useDownChannels([], false));
    m.signalCategory(line.host, '12', 'NFL', 'down', line);
    await vi.waitFor(() => expect(m.isCategoryDown(result.current, line.host, '12')).toBe(true));
    await vi.waitFor(() => expect(calls.some((c) => c.op === 'signal_category')).toBe(true));
    expect(calls.find((c) => c.op === 'signal_category')).toMatchObject({
      host: 'dstreams.xyz:8080', category_id: '12', name: 'NFL', kind: 'down', device_id: 'device-12345678', line_user: 'jsmith',
    });
    expect(JSON.stringify(calls)).not.toContain('hunter2');
    // "It's working now" clears it here too.
    m.signalCategory(line.host, '12', 'NFL', 'clear');
    await vi.waitFor(() => expect(m.isCategoryDown(result.current, line.host, '12')).toBe(false));
  });

  it('a category "played fine" goes at most once in ten minutes', async () => {
    const m = await import('./channelStatus');
    m.signalCategory('strmz.xyz', '3', '', 'ok');
    m.signalCategory('strmz.xyz', '3', '', 'ok');
    await flush();
    expect(calls.filter((c) => c.op === 'signal_category')).toHaveLength(1);
  });
});
