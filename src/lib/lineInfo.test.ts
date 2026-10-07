// The "Line:" line on tickets and reports: username, service, connections
// in use / allowed, expiry. Asked fresh (≤ 3 s) or reused under a minute
// old; never the password, the host or a stream URL.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  authenticate: vi.fn(),
  creds: null as unknown,
  saved: [] as unknown[],
  account: null as unknown,
}));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  authenticate: h.authenticate,
  loadCreds: async () => h.creds,
  loadSavedAccounts: async () => h.saved,
  loadPlayerAccount: async () => h.account,
}));

const dream = { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'hunter2-secret', output: 'ts' as const, serverLabel: 'Dreamstreams' };
const vibez = { host: 'https://strmz.xyz', username: 'amy@x', password: 'pw-vibez-secret', output: 'm3u8' as const, serverLabel: 'Vibez' };
const panel = (active: string, max: string, exp: string | null = '1796083200') =>
  ({ user_info: { username: 'jsmith', password: 'hunter2-secret', auth: 1, active_cons: active, max_connections: max, exp_date: exp } });

beforeEach(async () => {
  vi.useRealTimers();
  h.authenticate.mockReset();
  h.creds = null; h.saved = []; h.account = null;
  (await import('./lineInfo')).__resetLineInfoForTests();
});

describe('the line on a ticket', () => {
  it('names the line in use, its service, its connections and expiry', async () => {
    h.creds = dream;
    h.authenticate.mockResolvedValue(panel('2', '3'));
    const { buildLineInfoLines } = await import('./lineInfo');
    expect(await buildLineInfoLines()).toBe('Line: jsmith (DreamStreams) · connections 2/3 · expires 2026-12-01');
  });

  it('lists each saved line when none is in use', async () => {
    h.saved = [{ id: 'a', addedAt: 1, ...dream }, { id: 'b', addedAt: 2, ...vibez }];
    h.authenticate.mockImplementation(async (c: { username: string }) => (c.username === 'jsmith' ? panel('1', '2', null) : panel('0', '1', null)));
    const { buildLineInfoLines } = await import('./lineInfo');
    expect((await buildLineInfoLines()).split('\n')).toEqual([
      'Line: jsmith (DreamStreams) · connections 1/2',
      'Line: amy@x (Vibez) · connections 0/1',
    ]);
  });

  it('a panel that does not answer in time: the username, connections unknown, and no long wait', async () => {
    h.creds = dream;
    h.authenticate.mockImplementation(() => new Promise(() => undefined));
    const { buildLineInfoLines } = await import('./lineInfo');
    const started = Date.now();
    expect(await buildLineInfoLines(50)).toBe('Line: jsmith (DreamStreams) · connections unknown');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('a failed panel answer: connections unknown', async () => {
    h.creds = dream;
    h.authenticate.mockRejectedValue(new Error('HTTP 500'));
    const { buildLineInfoLines } = await import('./lineInfo');
    expect(await buildLineInfoLines()).toBe('Line: jsmith (DreamStreams) · connections unknown');
  });

  it('reuses an answer under a minute old, asks again after', async () => {
    h.creds = dream;
    h.authenticate.mockResolvedValue(panel('1', '3'));
    const { buildLineInfoLines, LINE_FRESH_MS } = await import('./lineInfo');
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    await buildLineInfoLines();
    await buildLineInfoLines();
    expect(h.authenticate).toHaveBeenCalledTimes(1);
    spy.mockReturnValue(now + LINE_FRESH_MS + 1);
    await buildLineInfoLines();
    expect(h.authenticate).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('reuses the sign-in check’s fresh answer without asking the panel', async () => {
    h.creds = dream;
    h.account = { ...dream, expDate: null, status: 'Active', isTrial: false, maxConnections: 4, activeCons: 1, createdAt: null, lastCheckedAt: Date.now() };
    const { buildLineInfoLines } = await import('./lineInfo');
    expect(await buildLineInfoLines()).toBe('Line: jsmith (DreamStreams) · connections 1/4');
    expect(h.authenticate).not.toHaveBeenCalled();
  });

  it('never carries the password, the host or a URL', async () => {
    h.creds = dream;
    h.authenticate.mockResolvedValue(panel('2', '3'));
    const { buildLineInfoLines, lineReportFields } = await import('./lineInfo');
    const text = await buildLineInfoLines();
    const fields = JSON.stringify(await lineReportFields(dream));
    for (const out of [text, fields]) {
      expect(out).not.toContain('hunter2');
      expect(out).not.toContain('dstreams.xyz');
      expect(out).not.toMatch(/https?:\/\//);
    }
    expect(JSON.parse(fields)).toEqual({ line_user: 'jsmith', active_cons: 2, max_cons: 3 });
  });

  it('no line on the box: nothing', async () => {
    const { buildLineInfoLines } = await import('./lineInfo');
    expect(await buildLineInfoLines()).toBe('');
  });
});

describe('the app info block on every ticket', () => {
  it('adds the line under the app and device lines, without the password', async () => {
    h.creds = dream;
    h.authenticate.mockResolvedValue(panel('2', '3'));
    const { withAppInfo } = await import('./appInfo');
    const text = await withAppInfo('My channel froze');
    expect(text).toContain('Line: jsmith (DreamStreams) · connections 2/3');
    expect(text.indexOf('App: ')).toBeLessThan(text.indexOf('Line: '));
    expect(text.endsWith('My channel froze')).toBe(true);
    expect(text).not.toContain('hunter2');
  });

  it('a report about a channel names that channel’s line', async () => {
    h.creds = dream;
    h.authenticate.mockResolvedValue(panel('0', '1', null));
    const { withAppInfo } = await import('./appInfo');
    const text = await withAppInfo('Issue: Channel down', { lines: [vibez] });
    expect(text).toContain('Line: amy@x (Vibez) · connections 0/1');
    expect(text).not.toContain('jsmith');
    expect(text).not.toContain('pw-vibez');
  });
});
