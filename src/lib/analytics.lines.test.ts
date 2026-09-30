import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { event_name: string; properties: Record<string, unknown> };
const inserts: Array<{ table: string; rows: unknown }> = [];
let native = false;
let demo = false;
let saved: unknown = [];
let current: unknown = null;
let savedThrows = false;
let currentThrows = false;

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native } }));
vi.mock('@capacitor/app', () => ({ App: { getInfo: async () => ({ version: '1.8.0' }) } }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => demo }));
vi.mock('@/lib/xtream', () => ({
  loadSavedAccounts: async () => { if (savedThrows) throw new Error('boom'); return saved; },
  loadCreds: async () => { if (currentThrows) throw new Error('boom'); return current; },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (table: string) => ({
      insert: (rows: unknown) => { inserts.push({ table, rows }); return Promise.resolve({ error: null }); },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      upsert: () => Promise.resolve({ error: null }),
    }),
  },
}));

const settle = () => new Promise((r) => setTimeout(r, 30));
const setUA = (ua: string) => Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
const FIRE_UA = 'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233) AppleWebKit/537.36 Chrome/70.0 Safari/537.36';

const line = (host: string, username: string) => ({ id: 'x', serverLabel: 'S', host, username, password: 'SECRET-PW', output: 'm3u8', addedAt: 1 });

/** Flush the queue, then return every event recorded so far. */
const events = async (a: typeof import('./analytics')): Promise<Row[]> => {
  const before = inserts.length;
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  window.dispatchEvent(new Event('visibilitychange'));
  await settle();
  expect(inserts.length).toBeGreaterThanOrEqual(before);
  void a;
  return inserts.filter((i) => i.table === 'analytics_events').flatMap((i) => i.rows as Row[]);
};
const lineEvents = (rows: Row[]) => rows.filter((r) => r.event_name === 'line_active');

// Every fresh module copy adds its own window listeners; drop them between tests.
const listeners: Array<[string, EventListenerOrEventListenerObject]> = [];
const realAdd = window.addEventListener.bind(window);

beforeEach(() => {
  window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => {
    listeners.push([type, fn]);
    realAdd(type, fn, o);
  }) as typeof window.addEventListener;
  inserts.length = 0;
  saved = []; current = null; savedThrows = false; currentThrows = false; demo = false; native = true;
  setUA(FIRE_UA);
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => {
  native = false;
  vi.restoreAllMocks();
  window.addEventListener = realAdd;
  for (const [t, f] of listeners.splice(0)) window.removeEventListener(t, f);
});

describe('line_active', () => {
  it('sends one event per saved line at start, exactly as stored, with no password', async () => {
    saved = [line('http://dstreams.xyz:8080', 'Bob'), line('https://strmz.xyz', 'alice_1')];
    const a = await import('./analytics');
    a.initAnalytics();
    await settle();
    const rows = await events(a);
    const le = lineEvents(rows);
    expect(le.map((r) => r.properties)).toEqual([
      { line_host: 'http://dstreams.xyz:8080', line_user: 'Bob' },
      { line_host: 'https://strmz.xyz', line_user: 'alice_1' },
    ]);
    expect(JSON.stringify(rows)).not.toContain('SECRET-PW');
    expect(JSON.stringify(rows)).not.toMatch(/password/i);
    // the start app_open comes before the line events
    const names = rows.map((r) => r.event_name);
    expect(names.indexOf('app_open')).toBeLessThan(names.indexOf('line_active'));
  });

  it('de-duplicates the signed-in line against saved lines, and includes it when not saved', async () => {
    saved = [line('https://strmz.xyz', 'a'), line('https://strmz.xyz', 'a'), line('https://strmz.xyz', 'b')];
    current = { host: 'https://strmz.xyz', username: 'a', password: 'SECRET-PW', output: 'ts' };
    let a = await import('./analytics');
    a.initAnalytics();
    await settle();
    expect(lineEvents(await events(a)).map((r) => r.properties.line_user)).toEqual(['a', 'b']);

    inserts.length = 0; vi.resetModules();
    current = { host: 'http://other.tv:80', username: 'c', password: 'SECRET-PW', output: 'ts' };
    a = await import('./analytics');
    a.initAnalytics();
    await settle();
    expect(lineEvents(await events(a)).map((r) => r.properties.line_user)).toEqual(['a', 'b', 'c']);
  });

  it('sends nothing when signed out', async () => {
    const a = await import('./analytics');
    a.initAnalytics();
    await settle();
    const rows = await events(a);
    expect(lineEvents(rows)).toEqual([]);
    expect(rows.some((r) => r.event_name === 'app_open')).toBe(true);
  });

  it('a resume after 10 minutes sends nothing; after 31 minutes it sends again', async () => {
    saved = [line('https://strmz.xyz', 'a')];
    const t0 = Date.now();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(t0);
    const a = await import('./analytics');
    a.initAnalytics();
    await settle();
    const setVis = (v: string) => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); window.dispatchEvent(new Event('visibilitychange')); };
    const count = () => lineEvents(inserts.filter((i) => i.table === 'analytics_events').flatMap((i) => i.rows as Row[])).length;
    now.mockReturnValue(t0 + 1000); setVis('hidden'); await settle();
    now.mockReturnValue(t0 + 10 * 60_000); setVis('visible'); await settle();
    setVis('hidden'); await settle();
    expect(count()).toBe(1);
    now.mockReturnValue(t0 + 11 * 60_000); setVis('hidden'); await settle();
    now.mockReturnValue(t0 + 11 * 60_000 + 31 * 60_000); setVis('visible'); await settle();
    setVis('hidden'); await settle();
    expect(count()).toBe(2);
  });

  it('a throwing line reader never throws and app_open is still sent', async () => {
    savedThrows = true; currentThrows = true;
    const a = await import('./analytics');
    expect(() => a.initAnalytics()).not.toThrow();
    await settle();
    const rows = await events(a);
    expect(rows.some((r) => r.event_name === 'app_open')).toBe(true);
    expect(lineEvents(rows)).toEqual([]);
  });

  it('a garbage saved list is ignored', async () => {
    saved = 'not-a-list'; current = { host: 5, username: null };
    const a = await import('./analytics');
    a.initAnalytics();
    await settle();
    const rows = await events(a);
    expect(rows.some((r) => r.event_name === 'app_open')).toBe(true);
    expect(lineEvents(rows)).toEqual([]);
  });

  it('demo and web send nothing', async () => {
    saved = [line('https://strmz.xyz', 'a')];
    demo = true;
    let a = await import('./analytics');
    a.initAnalytics();
    await settle();
    expect(inserts).toEqual([]);

    demo = false; native = false; vi.resetModules();
    a = await import('./analytics');
    a.initAnalytics();
    await settle();
    expect(inserts).toEqual([]);
  });
});

describe('device_model / form_factor on app_open', () => {
  it('are on the start app_open', async () => {
    const a = await import('./analytics');
    a.initAnalytics();
    await settle();
    const open = (await events(a)).find((r) => r.event_name === 'app_open');
    expect(open?.properties).toMatchObject({ device_model: 'AFTMM', form_factor: 'tv' });
  });

  it('are on the resume app_open too', async () => {
    const t0 = Date.now();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(t0);
    const a = await import('./analytics');
    a.initAnalytics();
    await settle();
    const setVis = (v: string) => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); window.dispatchEvent(new Event('visibilitychange')); };
    setVis('hidden');
    now.mockReturnValue(t0 + 40 * 60_000); setVis('visible'); await settle();
    setVis('hidden'); await settle();
    const rows = inserts.filter((i) => i.table === 'analytics_events').flatMap((i) => i.rows as Row[]);
    const resumed = rows.find((r) => r.event_name === 'app_open' && r.properties.resumed === true);
    expect(resumed?.properties).toMatchObject({ device_model: 'AFTMM', form_factor: 'tv' });
  });
});
