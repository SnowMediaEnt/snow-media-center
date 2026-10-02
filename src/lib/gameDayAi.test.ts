/**
 * Game Day's search on the box: the provider's stored answer (kept ten
 * minutes), the daily scan (only id, name and category go), the quiet learn
 * signals, and the miss → Live TV play signal. Six-second timeout, never
 * throws, nothing at all in demo or on a Kids profile.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spy = vi.hoisted(() => ({
  invoke: vi.fn(async (_fn: string, _opts: { body: Record<string, unknown> }): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null })),
  track: vi.fn(),
  demo: false,
  kids: null as null | string,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: spy.invoke } } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: spy.track, getDeviceId: () => 'dev-1' }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => spy.demo }));
vi.mock('@/lib/kidsFilter', () => ({ kidsLevel: () => spy.kids }));

import {
  __resetGameDayAiForTests, fetchCachedScan, learnedCats, lineupHash, markWrong, noteLivePlay, rememberMiss, sendLearn, sendScan, shouldScan, wrongLinks,
  isWrongLink, type CachedScan,
} from './gameDayAi';

const HOST = 'dstreams.xyz';
const cachedAnswer = {
  ok: true, day: '2026-10-02', lineup_hash: 'abc', scanned_at: new Date().toISOString(),
  matches: {
    'ncaah:401': [
      { stream_id: 11, name: '#11 Boston vs Michigan', confidence: 'high', source: 'ai' },
      { stream_id: -3, name: 'bad id', confidence: 'high', source: 'ai' },
      { stream_id: 12, name: 'B1G+ 03', confidence: 'maybe', source: 'ai' },
    ],
  },
  learned: [{ league: 'ncaah', cat: 'B1G+' }, { league: 'NOT VALID!', cat: 'x' }],
};
const bodies = () => spy.invoke.mock.calls.map((c) => c[1].body);
const game = { id: 'ncaah:401', league: 'ncaah', start: new Date(Date.now() + 60 * 60_000).toISOString() };

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); __resetGameDayAiForTests();
  spy.invoke.mockReset(); spy.invoke.mockImplementation(async () => ({ data: null, error: null }));
  spy.track.mockClear(); spy.demo = false; spy.kids = null;
});
afterEach(() => { vi.useRealTimers(); });

describe('fetchCachedScan', () => {
  it('reads the provider by hostname only, keeps clean matches, and stores the learned categories', async () => {
    spy.invoke.mockResolvedValueOnce({ data: cachedAnswer, error: null });
    const scan = await fetchCachedScan(HOST);
    expect(bodies()[0]).toEqual({ op: 'cached', host: HOST });
    expect(scan?.lineupHash).toBe('abc');
    expect(scan?.matches['ncaah:401']).toEqual([{ stream_id: 11, name: '#11 Boston vs Michigan', confidence: 'high', source: 'ai' }]);
    expect([...learnedCats([HOST])]).toEqual([['b1g+', ['ncaah']]]);
  });

  it('is kept ten minutes this session; force reads it again', async () => {
    spy.invoke.mockResolvedValue({ data: cachedAnswer, error: null });
    await fetchCachedScan(HOST);
    await fetchCachedScan(HOST);
    expect(spy.invoke).toHaveBeenCalledTimes(1);
    await fetchCachedScan(HOST, true);
    expect(spy.invoke).toHaveBeenCalledTimes(2);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000);
    await fetchCachedScan(HOST);
    expect(spy.invoke).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it('gives up after six seconds and never throws', async () => {
    vi.useFakeTimers();
    spy.invoke.mockImplementation(() => new Promise(() => {}));
    const p = fetchCachedScan(HOST);
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(p).resolves.toBeNull();
    spy.invoke.mockImplementation(async () => { throw new Error('offline'); });
    await expect(fetchCachedScan(HOST, true)).resolves.toBeNull();
    spy.invoke.mockResolvedValue({ data: null, error: new Error('500') });
    await expect(fetchCachedScan(HOST, true)).resolves.toBeNull();
  });

  it('asks nothing in demo or on a Kids profile', async () => {
    spy.demo = true;
    expect(await fetchCachedScan(HOST)).toBeNull();
    spy.demo = false; spy.kids = 'kids';
    expect(await fetchCachedScan(HOST)).toBeNull();
    expect(spy.invoke).not.toHaveBeenCalled();
  });
});

describe('the daily scan', () => {
  const cands = [{ id: 11, name: '#11 Boston vs Michigan', cat: 'b1g+' }, { id: 12, name: 'B1G+ 03', cat: 'b1g+' }];
  const fresh = (hash: string, ago: number): CachedScan => ({ lineupHash: hash, scannedAt: Date.now() - ago, matches: {} });

  it('is sent when the answer is missing, old or from another line-up, and not again within half an hour', () => {
    const h = lineupHash(cands);
    expect(shouldScan(HOST, fresh(h, 60 * 60_000), h)).toBe(false);
    expect(shouldScan(HOST, fresh(h, 4 * 60 * 60_000), h)).toBe(true);
    expect(shouldScan(HOST, fresh('other', 60_000), h)).toBe(true);
    expect(shouldScan(HOST, null, h)).toBe(true);
    void sendScan(HOST, cands, h);
    expect(shouldScan(HOST, null, h)).toBe(false);
    expect(shouldScan(HOST, null, 'changed')).toBe(false);
  });

  it('the hash is the same in any order and changes with a renamed channel', () => {
    expect(lineupHash(cands)).toBe(lineupHash([...cands].reverse()));
    expect(lineupHash(cands)).not.toBe(lineupHash([cands[0], { ...cands[1], name: 'B1G+ 03: Ohio State vs Penn State' }]));
  });

  it('sends only id, name and category (never a login or a URL), and reports the result', async () => {
    spy.invoke.mockResolvedValueOnce({ data: { ok: true, scanned: true }, error: null });
    const withExtras = cands.map((c) => ({ ...c, url: 'http://dstreams.xyz:8080/live/u/secret/11.ts', password: 'secret' }));
    expect(await sendScan(HOST, withExtras, 'h1')).toBe('scanned');
    const body = bodies()[0];
    expect(body).toMatchObject({ op: 'scan', host: HOST, lineup_hash: 'h1', device_id: 'dev-1' });
    expect(body.candidates).toEqual(cands);
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(spy.track).toHaveBeenCalledWith('gameday_ai_scan', 'player', expect.objectContaining({ result: 'scanned', candidates: 2 }));
  });

  it('maps the answers: fresh, off (or paused), limit, error; a timeout is an error to analytics', async () => {
    spy.invoke.mockResolvedValueOnce({ data: { ok: true, scanned: false }, error: null });
    expect(await sendScan(HOST, cands, 'a')).toBe('fresh');
    spy.invoke.mockResolvedValueOnce({ data: { ok: true, scanned: false, busy: true }, error: null });
    expect(await sendScan(HOST, cands, 'a2')).toBe('busy');
    expect(spy.track).toHaveBeenLastCalledWith('gameday_ai_scan', 'player', expect.objectContaining({ result: 'fresh' }));
    spy.invoke.mockResolvedValueOnce({ data: { ok: false, reason: 'paused' }, error: null });
    expect(await sendScan(HOST, cands, 'b')).toBe('off');
    spy.invoke.mockResolvedValueOnce({ data: { ok: false, reason: 'limit' }, error: null });
    expect(await sendScan(HOST, cands, 'c')).toBe('limit');
    spy.invoke.mockRejectedValueOnce(new Error('x'));
    expect(await sendScan(HOST, cands, 'd')).toBe('error');
    vi.useFakeTimers();
    spy.invoke.mockImplementationOnce(() => new Promise(() => {}));
    const p = sendScan(HOST, cands, 'e');
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await p).toBe('timeout');
    expect(spy.track).toHaveBeenLastCalledWith('gameday_ai_scan', 'player', expect.objectContaining({ result: 'error' }));
  });

  it('is never sent in demo', async () => {
    spy.demo = true;
    expect(await sendScan(HOST, cands, 'h')).toBe('off');
    expect(shouldScan(HOST, null, 'h')).toBe(false);
    expect(spy.invoke).not.toHaveBeenCalled();
  });
});

describe('the play signal', () => {
  const line = { host: 'http://dstreams.xyz:8080' };

  it('a channel played after an empty list sends play only when it names the teams, once', () => {
    rememberMiss(game, ['boston', 'terriers', 'michigan', 'wolverines']);
    noteLivePlay(line, { stream_id: 5, name: 'ESPN News' }, 'US| SPORTS');
    expect(spy.invoke).not.toHaveBeenCalled();
    noteLivePlay(line, { stream_id: 11, name: '#11 Boston vs Michigan' }, 'B1G+');
    expect(bodies()).toEqual([{
      op: 'learn', host: 'dstreams.xyz', game_id: 'ncaah:401', stream_id: 11, name: '#11 Boston vs Michigan', cat: 'b1g+', source: 'play', device_id: 'dev-1',
    }]);
    noteLivePlay(line, { stream_id: 11, name: '#11 Boston vs Michigan' }, 'B1G+');
    expect(spy.invoke).toHaveBeenCalledTimes(1);
  });

  it('the category alone can name them', () => {
    rememberMiss(game, ['michigan']);
    noteLivePlay(line, { stream_id: 30, name: 'Live 03' }, 'Michigan Sports');
    expect(spy.invoke).toHaveBeenCalledTimes(1);
  });

  it('never on a Kids profile, never in demo, never with the flag off, never past the miss', () => {
    rememberMiss(game, ['michigan']);
    spy.kids = 'kids';
    noteLivePlay(line, { stream_id: 11, name: 'Boston vs Michigan' }, '');
    spy.kids = null; spy.demo = true;
    noteLivePlay(line, { stream_id: 11, name: 'Boston vs Michigan' }, '');
    spy.demo = false;
    localStorage.setItem('snow-feature-flag:gameday_ai_match', '0');
    noteLivePlay(line, { stream_id: 11, name: 'Boston vs Michigan' }, '');
    localStorage.removeItem('snow-feature-flag:gameday_ai_match');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 6 * 60 * 60_000);
    noteLivePlay(line, { stream_id: 11, name: 'Boston vs Michigan' }, '');
    vi.restoreAllMocks();
    expect(spy.invoke).not.toHaveBeenCalled();
  });

  it('a miss is not remembered on a Kids profile', () => {
    spy.kids = 'little';
    rememberMiss(game, ['michigan']);
    expect(sessionStorage.getItem('smc-gameday-miss')).toBeNull();
  });
});

describe('learn and "Not this game"', () => {
  it('a learn signal never throws, even when the call does', () => {
    spy.invoke.mockImplementation(() => { throw new Error('boom'); });
    expect(() => sendLearn({ host: HOST, gameId: 'g:1', streamId: 3, name: 'x', cat: 'y', source: 'pick' })).not.toThrow();
  });

  it('takes the link off on this box, sends wrong once, and counts it', () => {
    const link = { line: { host: 'https://dstreams.xyz:2083' }, stream: { stream_id: 11, name: '#11 Boston vs Michigan' } };
    markWrong(game, link, 'b1g+');
    expect(isWrongLink(wrongLinks(), game.id, HOST, 11)).toBe(true);
    expect(bodies()[0]).toMatchObject({ op: 'learn', host: HOST, game_id: game.id, stream_id: 11, source: 'wrong', cat: 'b1g+' });
    expect(spy.track).toHaveBeenCalledWith('gameday_ai_wrong', 'player', { league: 'ncaah' });
    markWrong(game, link, 'b1g+');
    expect(spy.invoke).toHaveBeenCalledTimes(1);
  });
});
