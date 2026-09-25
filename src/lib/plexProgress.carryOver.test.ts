import { beforeEach, describe, expect, it, vi } from 'vitest';

// Signing in goes through viewer.ts's own auth listener, as on the box when
// Live TV signs it in to the account linked to its line.
type AuthCb = (event: string, session: { user: { id: string } } | null) => void;
let authCb: AuthCb | null = null;
const upserts: Array<Record<string, unknown>> = [];
// The account's own copy, as the read before anything goes up finds it.
const cloudRows: Array<{ item_key: string; payload: unknown; watched_at: string }> = [];
vi.mock('@/integrations/supabase/client', () => {
  const read = () => {
    const q: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'like', 'not', 'order', 'limit']) q[k] = () => q;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: cloudRows.slice(), error: null }).then(ok);
    return q;
  };
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: (cb: AuthCb) => { authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      },
      from: () => ({
        ...read(),
        upsert: (row: Record<string, unknown>) => { upserts.push(row); return Promise.resolve({ error: null }); },
      }),
    },
  };
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const signIn = (id: string) => authCb!('SIGNED_IN', { user: { id } });
const stored = (viewer: string) => JSON.parse(localStorage.getItem(`snow-plex-progress:${viewer}`) || 'null');

/** plexProgress and viewer.ts as a fresh start of the app: nobody signed in. */
const fresh = async () => {
  vi.resetModules();
  const m = await import('./plexProgress');
  await (await import('./viewer')).resolveViewer();
  return m;
};

const entry = (ratingKey: string, t: number, at = 1200) =>
  ({ ratingKey, kind: 'movie', title: ratingKey, at, dur: 6000, t, done: false });

beforeEach(() => {
  localStorage.clear();
  upserts.length = 0;
  cloudRows.length = 0;
  authCb = null;
});

describe('plexProgress: what the box watched before signing in comes with it', () => {
  it('is in the account\'s Continue Watching, leaves the box, and goes up to the account', async () => {
    const m = await fresh();
    m.saveProgress({ ratingKey: 'm1', kind: 'movie', title: 'Film', at: 1200, dur: 6000 });
    await tick();
    expect(stored('device')).toHaveProperty('m1');
    expect(upserts).toEqual([]); // nobody signed in yet

    signIn('u1');
    expect(m.continueWatching().map((i) => i.ratingKey)).toEqual(['m1']);
    expect(m.resumeSeconds('m1')).toBe(1200);
    expect(stored('u1')).toHaveProperty('m1');
    expect(stored('device')).toBeNull();
    for (let i = 0; i < 5; i++) await tick();
    expect(upserts).toEqual([expect.objectContaining({ user_id: 'u1', kind: 'plex_progress', item_key: 'm1' })]);

    // Run again (the next start): nothing left to bring, nothing sent twice.
    await m.initPlexProgress();
    for (let i = 0; i < 5; i++) await tick();
    expect(upserts).toHaveLength(1);
    expect(m.progressCount()).toBe(1);

    // Signed out, the box starts again from nothing: the list is the account's.
    authCb!('SIGNED_OUT', null);
    expect(m.continueWatching()).toEqual([]);
  });

  it('the newer place wins per title, and only the newest 50 go up at once', async () => {
    const now = Date.now();
    const box: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) box[`d${i}`] = entry(`d${i}`, now - (i + 1) * 60_000);
    box.both = entry('both', now - 90 * 60_000, 900);     // older than the account's
    box.boxNewer = entry('boxNewer', now - 30_000, 2400); // newer than the account's
    localStorage.setItem('snow-plex-progress:device', JSON.stringify(box));
    localStorage.setItem('snow-plex-progress:u1', JSON.stringify({
      both: entry('both', now - 10 * 60_000, 600),
      boxNewer: entry('boxNewer', now - 20 * 60_000, 300),
      mine: entry('mine', now - 5 * 60_000, 700),
    }));
    const m = await fresh();
    signIn('u1');
    expect(m.progressCount()).toBe(63);
    expect(m.resumeSeconds('both')).toBe(600);
    expect(m.resumeSeconds('boxNewer')).toBe(2400);
    expect(m.resumeSeconds('mine')).toBe(700);
    expect(m.resumeSeconds('d59')).toBe(1200);
    for (let i = 0; i < 5; i++) await tick();
    expect(upserts).toHaveLength(50);
    expect(upserts.map((u) => u.item_key)).toEqual(['boxNewer', ...Array.from({ length: 49 }, (_, i) => `d${i}`)]);
  });

  it('signed in before this start: the list left on the box comes over when Plex starts', async () => {
    localStorage.setItem('snow-plex-progress:device', JSON.stringify({ m1: entry('m1', Date.now() - 60_000) }));
    const m = await fresh();
    m.__resetPlexProgressForTests('u1');
    await m.initPlexProgress();
    expect(m.continueWatching().map((i) => i.ratingKey)).toEqual(['m1']);
    expect(stored('device')).toBeNull();
    for (let i = 0; i < 5; i++) await tick();
    expect(upserts).toEqual([expect.objectContaining({ user_id: 'u1', item_key: 'm1' })]);
  });

  it('a newer place the account saved on another box is not overwritten by this box\'s older one', async () => {
    const now = Date.now();
    localStorage.setItem('snow-plex-progress:device', JSON.stringify({ m1: entry('m1', now - 3 * 24 * 3600_000, 600) }));
    cloudRows.push({ item_key: 'm1', payload: entry('m1', now - 3600_000, 4000), watched_at: new Date(now - 3600_000).toISOString() });
    const m = await fresh();
    signIn('u1');
    for (let i = 0; i < 5; i++) await tick();
    expect(upserts).toEqual([]);
    expect(m.resumeSeconds('m1')).toBe(4000);
  });

  it('from one account to another brings nothing across', async () => {
    const m = await fresh();
    signIn('u1');
    m.saveProgress({ ratingKey: 'm1', kind: 'movie', title: 'Film', at: 1200, dur: 6000 });
    await tick();
    signIn('u2');
    expect(m.progressCount()).toBe(0);
    expect(m.continueWatching()).toEqual([]);
    expect(stored('u1')).toHaveProperty('m1');
    expect(stored('u2')).toBeNull();
  });

  it('a profile made on the box stays the box\'s until it is brought over', async () => {
    localStorage.setItem('snow-plex-progress:device', JSON.stringify({ m1: entry('m1', Date.now() - 60_000) }));
    localStorage.setItem('snow-plex-progress:device:p:ab', JSON.stringify({ k1: entry('k1', Date.now() - 60_000) }));
    const m = await fresh();
    m.__resetPlexProgressForTests('u1:p:ab');
    await m.initPlexProgress();
    expect(m.progressCount()).toBe(0);
    expect(stored('device:p:ab')).toHaveProperty('k1');
    expect(stored('device')).toHaveProperty('m1');
  });
});
