import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const inserts: Array<{ table: string; rows: unknown }> = [];
const updates: string[] = [];
const upserts: string[] = [];
let native = false;

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native } }));
vi.mock('@capacitor/app', () => ({ App: { getInfo: async () => ({ version: '1.7.7' }) } }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => false }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (table: string) => ({
      insert: (rows: unknown) => { inserts.push({ table, rows }); return Promise.resolve({ error: null }); },
      update: () => { updates.push(table); return { eq: () => Promise.resolve({ error: null }) }; },
      upsert: () => { upserts.push(table); return Promise.resolve({ error: null }); },
    }),
  },
}));

const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  inserts.length = 0; updates.length = 0; upserts.length = 0;
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => { native = false; });

describe('analytics', () => {
  it('records nothing outside the installed app', async () => {
    native = false;
    const a = await import('./analytics');
    a.initAnalytics();
    await settle();
    a.trackEvent('x', 'y');
    a.trackCrash('boom');
    await settle();
    expect(inserts).toEqual([]);
  });

  it('starts a new session when the app comes back after 30+ minutes away', async () => {
    native = true;
    const a = await import('./analytics');
    a.initAnalytics();
    await settle();
    const sessions = () => inserts.filter((i) => i.table === 'analytics_sessions').length;
    expect(sessions()).toBe(1);
    const setVis = (v: string) => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
    const t0 = Date.now();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(t0);
    setVis('hidden'); window.dispatchEvent(new Event('visibilitychange'));
    now.mockReturnValue(t0 + 10 * 60_000);
    setVis('visible'); window.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(sessions()).toBe(1); // ten minutes away: same session
    now.mockReturnValue(t0 + 11 * 60_000);
    setVis('hidden'); window.dispatchEvent(new Event('visibilitychange'));
    now.mockReturnValue(t0 + 45 * 60_000);
    setVis('visible'); window.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(sessions()).toBe(2);
    now.mockRestore();
  });
  it('sends the installed version, and never updates sessions or upserts devices', async () => {
    native = true;
    const a = await import('./analytics');
    a.initAnalytics();
    await settle();
    for (let i = 0; i < 20; i++) a.trackEvent(`e${i}`, 'test'); // a full batch flushes at once
    await settle();
    const session = inserts.find((i) => i.table === 'analytics_sessions');
    expect((session?.rows as { app_version: string }).app_version).toBe('1.7.7');
    const events = inserts.filter((i) => i.table === 'analytics_events').flatMap((i) => i.rows as Array<{ app_version: string }>);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.app_version === '1.7.7')).toBe(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(updates).toEqual([]);
    expect(upserts).toEqual([]);
  });

});
