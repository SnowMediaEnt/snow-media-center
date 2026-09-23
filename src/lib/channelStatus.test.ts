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
