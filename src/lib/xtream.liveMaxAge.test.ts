import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLiveStreams, type XtreamCreds } from './xtream';

// A panel whose event channels are renamed between two requests.
let names = ['MLB 07: Mets vs Braves'];
const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => names.map((name, i) => ({ stream_id: i + 1, name })) }));
const calls = () => fetchMock.mock.calls.length;

let n = 0;
const line = (): XtreamCreds => ({ host: `http://live${++n}.test`, username: 'u', password: 'p' } as unknown as XtreamCreds);

beforeEach(() => {
  fetchMock.mockClear();
  names = ['MLB 07: Mets vs Braves'];
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('the kept live channel lists', () => {
  it('a caller that wants a recent list gets one; everyone else keeps the one they had', async () => {
    const c = line();
    const fresh = { maxAgeMs: 10 * 60_000 };
    await getLiveStreams(c);
    await getLiveStreams(c, undefined, fresh);
    expect(calls()).toBe(1);
    names = ['MLB 07: Yankees vs Red Sox'];
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect((await getLiveStreams(c)).map((s) => s.name)).toEqual(['MLB 07: Mets vs Braves']);
    expect(calls()).toBe(1);
    expect((await getLiveStreams(c, undefined, fresh)).map((s) => s.name)).toEqual(['MLB 07: Yankees vs Red Sox']);
    expect(calls()).toBe(2);
    // The new list is the kept one now.
    expect((await getLiveStreams(c)).map((s) => s.name)).toEqual(['MLB 07: Yankees vs Red Sox']);
    expect(calls()).toBe(2);
  });
});
