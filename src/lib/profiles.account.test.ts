// Profiles and the account: sign-in, sign-out, a session that can't be
// refreshed, pulls, deletes, the grown-up pad. A small in-memory
// viewer_profiles stands in for the account.
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Row { user_id: string; id: string; name: string; avatar: string; kids_level: string | null; pin_hash: string | null; position: number; updated_at: string }

const h = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  authCb: null as null | ((event: string, session: unknown) => void),
  rows: [] as Row[],
  upserts: [] as Row[],
  selects: 0,
  deleteFails: false,
  invokes: [] as unknown[],
}));

vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => {
    const filters: Record<string, string> = {};
    let op: 'select' | 'delete' = 'select';
    const q = {
      select: () => { h.selects += 1; return q; },
      eq: (c: string, v: string) => { filters[c] = v; return q; },
      like: () => q,
      delete: () => { op = 'delete'; return q; },
      upsert: (row: Row) => {
        h.upserts.push(row);
        if (table === 'viewer_profiles') h.rows = [...h.rows.filter((r) => !(r.user_id === row.user_id && r.id === row.id)), row];
        return Promise.resolve({ error: null });
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        if (op === 'delete') {
          if (table !== 'viewer_profiles') return Promise.resolve({ error: null }).then(res, rej);
          if (h.deleteFails) return Promise.resolve({ error: { message: 'offline' } }).then(res, rej);
          h.rows = h.rows.filter((r) => !(r.user_id === filters.user_id && r.id === filters.id));
          return Promise.resolve({ error: null }).then(res, rej);
        }
        const data = table === 'viewer_profiles' ? h.rows.filter((r) => r.user_id === filters.user_id) : [];
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return q;
  };
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: h.session } }),
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => { h.authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      },
      from,
      functions: { invoke: async (_name: string, opts: unknown) => { h.invokes.push(opts); return { data: { ok: true, emailed: true }, error: null }; } },
    },
  };
});

const TOKEN = 'sb-falmwzhvxoefvkfsiylp-auth-token';
const flush = () => new Promise((r) => setTimeout(r, 0));

async function fresh() {
  vi.resetModules();
  const v = await import('./viewer');
  const p = await import('./profiles');
  const k = await import('./kidsFilter');
  return { v, p, k };
}

const profile = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, avatar: 'blue', kidsLevel: null, pinHash: null, position: 1, t: 1000, ...extra });

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  h.session = null; h.authCb = null; h.rows = []; h.upserts = []; h.selects = 0; h.deleteFails = false; h.invokes = [];
});

describe('a Kids profile never falls to a grown-up one by itself', () => {
  it('offline at start: the stored session is still the account, and its Kids profile stays on', async () => {
    localStorage.setItem(TOKEN, JSON.stringify({ user: { id: 'u1' } }));
    localStorage.setItem('smc-profiles-v1:u1', JSON.stringify([profile('main', { position: 0 }), profile('mia', { kidsLevel: 'kids' })]));
    localStorage.setItem('smc-last-profile:u1', 'mia');
    const { v, p, k } = await fresh();
    p.bootProfilesSync();
    expect(k.kidsLevel()).toBe('kids');
    await p.initProfiles();
    expect(v.viewerAccountId()).toBe('u1');
    expect(v.viewerAccountConfirmed()).toBe(false);
    expect(p.activeProfile().id).toBe('mia');
    expect(k.kidsLevel()).toBe('kids');
    // The failed refresh reports a null session without signing out.
    h.authCb?.('INITIAL_SESSION', null);
    expect(v.viewerAccountId()).toBe('u1');
    expect(k.kidsLevel()).toBe('kids');
    // An unconfirmed account's (empty) answer is never taken for its list.
    await flush();
    expect(h.selects).toBe(0);
    expect(p.loadProfiles('u1').map((x) => x.id)).toEqual(['main', 'mia']);
  });

  it('signed out on a Kids profile: its limits stay until a grown-up of that account says so', async () => {
    h.session = { user: { id: 'u1' } };
    localStorage.setItem(TOKEN, JSON.stringify({ user: { id: 'u1' } }));
    const { v, p, k } = await fresh();
    const pin = p.hashPin('main', '1111', 'u1');
    const list = [profile('main', { position: 0, pinHash: pin }), profile('mia', { kidsLevel: 'kids' })];
    localStorage.setItem('smc-profiles-v1:u1', JSON.stringify(list));
    localStorage.setItem('smc-last-profile:u1', 'mia');
    await p.initProfiles();
    expect(p.activeProfile().id).toBe('mia');
    expect(k.kidsLevel()).toBe('kids');

    localStorage.removeItem(TOKEN);
    h.session = null;
    h.authCb?.('SIGNED_OUT', null);
    expect(v.viewerAccountId()).toBeNull();
    // The box's own "Me", with the Kids limits kept, and a restart on Home.
    expect(p.activeProfile().id).toBe('main');
    expect(p.activeProfile().kidsLevel).toBe('kids');
    expect(k.kidsLevel()).toBe('kids');
    expect(p.takeProfileRestart()).toBe(true);
    expect(p.takeProfileRestart()).toBe(false);
    // A cold start now: still Kids.
    p.bootProfilesSync();
    expect(k.kidsLevel()).toBe('kids');

    expect(p.kidsHoldNeedsGrownUp()).toBe(true);
    expect(p.grownUpsWithPin().map((x) => x.id)).toEqual(['main']);
    expect(p.checkGrownUpPin('2222')).toBe(false);
    expect(p.checkGrownUpPin('1111')).toBe(true);
    expect(p.pickProfile('main')).toBe('reload');
    expect(k.kidsLevel()).toBeNull();
    expect(p.activeProfile().kidsLevel).toBeNull();
    expect(p.kidsHoldNeedsGrownUp()).toBe(false);
  });

  it('the profile in use deleted on another box: the box falls to main with the Kids limits kept', async () => {
    h.session = { user: { id: 'u1' } };
    const { p, k } = await fresh();
    localStorage.setItem('smc-profiles-v1:u1', JSON.stringify([profile('main', { position: 0 }), profile('mia', { kidsLevel: 'little' })]));
    localStorage.setItem('smc-last-profile:u1', 'mia');
    localStorage.setItem('smc-profiles-pulled:u1', '5000');
    h.rows = [];
    // Another profile is on the account, Mia isn't any more.
    h.rows.push({ user_id: 'u1', id: 'leo', name: 'Leo', avatar: 'green', kids_level: null, pin_hash: null, position: 2, updated_at: new Date(6000).toISOString() });
    await p.initProfiles();
    await p.pullProfiles();
    expect(p.loadProfiles().map((x) => x.id)).toEqual(['main', 'leo']);
    expect(p.activeProfile().id).toBe('main');
    expect(k.kidsLevel()).toBe('little');
    expect(p.takeProfileRestart()).toBe(true);
    // Same account: its own PINs decide (main has none), so a pick ends it.
    expect(p.kidsHoldNeedsGrownUp()).toBe(false);
    expect(p.pickProfile('main')).toBe('reload');
    expect(k.kidsLevel()).toBeNull();
  });

  it("signed out on a Kids profile: one of the box's own Kids profiles is no way round that account's PIN", async () => {
    h.session = { user: { id: 'u1' } };
    localStorage.setItem(TOKEN, JSON.stringify({ user: { id: 'u1' } }));
    const { p, k } = await fresh();
    localStorage.setItem('smc-profiles-v1:u1', JSON.stringify([
      profile('main', { position: 0, pinHash: p.hashPin('main', '1111', 'u1') }), profile('mia', { kidsLevel: 'little' }),
    ]));
    localStorage.setItem('smc-last-profile:u1', 'mia');
    // Made on the box before it was signed in: a Kids profile and "Me", no PINs.
    localStorage.setItem('smc-profiles-v1:device', JSON.stringify([profile('main', { position: 0 }), profile('leo', { kidsLevel: 'teen' })]));
    await p.initProfiles();
    localStorage.removeItem(TOKEN); h.session = null;
    h.authCb?.('SIGNED_OUT', null);
    expect(p.kidsHoldNeedsGrownUp()).toBe(true);
    // Leo is another Kids profile: fine, and the limits are his.
    p.pickProfile('leo');
    expect(k.kidsLevel()).toBe('teen');
    // On to the box's "Me" still takes the signed-out account's grown-up.
    expect(p.kidsHoldNeedsGrownUp()).toBe(true);
    p.bootProfilesSync();
    expect(p.kidsHoldNeedsGrownUp()).toBe(true);
    expect(p.checkGrownUpPin('1111')).toBe(true);
    p.pickProfile('main');
    expect(k.kidsLevel()).toBeNull();
    expect(p.kidsHoldNeedsGrownUp()).toBe(false);
  });

  it("offline at start: the account's list is pulled once its session comes through", async () => {
    localStorage.setItem(TOKEN, JSON.stringify({ user: { id: 'u1' } }));
    const { v, p } = await fresh();
    await p.initProfiles();
    await flush();
    expect(h.selects).toBe(0);
    h.rows = [{ user_id: 'u1', id: 'leo', name: 'Leo', avatar: 'green', kids_level: 'kids', pin_hash: null, position: 1, updated_at: new Date(6000).toISOString() }];
    h.session = { user: { id: 'u1' } };
    h.authCb?.('TOKEN_REFRESHED', h.session);
    expect(v.viewerAccountConfirmed()).toBe(true);
    await flush();
    expect(h.selects).toBe(1);
    expect(p.loadProfiles().map((x) => x.id)).toEqual(['main', 'leo']);
    // Once: later refreshes don't pull again.
    h.authCb?.('TOKEN_REFRESHED', h.session);
    await flush();
    expect(h.selects).toBe(1);
  });
});

describe('the viewer key', () => {
  it('follows a sign-in after the first resolve', async () => {
    await fresh();
    const w = await import('./watchHistory');
    expect(await w.currentViewer()).toBe('device');
    h.session = { user: { id: 'u1' } };
    h.authCb?.('SIGNED_IN', h.session);
    expect(await w.currentViewer()).toBe('u1');
  });
});

describe('the grown-up pad', () => {
  it("one grown-up's PIN is not a wrong try for another; wrong ones count against the pad", async () => {
    h.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    await p.initProfiles();
    localStorage.setItem('smc-profiles-v1:u1', JSON.stringify([
      profile('main', { position: 0, pinHash: p.hashPin('main', '1111') }),
      profile('mom', { pinHash: p.hashPin('mom', '2222') }),
      profile('mia', { kidsLevel: 'kids' }),
    ]));
    for (let i = 0; i < 6; i++) expect(p.checkGrownUpPin('2222')).toBe(true);
    expect(p.pinFailures('main')).toBe(0);
    expect(p.pinLockedFor('main')).toBe(0);
    for (let i = 0; i < 5; i++) expect(p.checkGrownUpPin('0000')).toBe(false);
    expect(p.pinFailures('main')).toBe(0);
    expect(p.grownUpPadLockedFor()).toBeGreaterThan(0);
    expect(p.checkGrownUpPin('1111')).toBe(false);
  });
});

describe('pulls', () => {
  it('Forgot PIN: a PIN already cleared on the account is cleared here, not uploaded again', async () => {
    h.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    await p.initProfiles();
    const dad = p.createProfile({ name: 'Dad', avatar: 'gold', kidsLevel: null })!;
    const withPin = p.setPin(dad.id, '1234')!;
    await flush();
    // Support clears it from the Hub.
    h.rows = h.rows.map((r) => (r.id === dad.id ? { ...r, pin_hash: null, updated_at: new Date(withPin.t + 1000).toISOString() } : r));
    h.upserts = [];
    for (let i = 0; i < 3; i++) p.checkPin(withPin, '0000');
    const r = await p.requestPinReset(dad.id);
    expect(r).toEqual({ ok: false, reason: 'no_pin' });
    expect(p.getProfile(dad.id)?.pinHash).toBeNull();
    expect(p.pinFailures(dad.id)).toBe(0);
    expect(h.upserts.some((u) => u.id === dad.id && u.pin_hash)).toBe(false);
    expect(h.rows.find((x) => x.id === dad.id)?.pin_hash).toBeNull();
    expect(h.invokes).toHaveLength(0);
  });

  it('a delete that failed is not undone by the next pull, and is sent again', async () => {
    h.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    await p.initProfiles();
    const leo = p.createProfile({ name: 'Leo', avatar: 'green', kidsLevel: null })!;
    await flush();
    await p.pullProfiles();
    expect(h.rows.map((r) => r.id)).toContain(leo.id);
    h.deleteFails = true;
    p.deleteProfile(leo.id);
    await flush();
    expect(h.rows.map((r) => r.id)).toContain(leo.id);
    h.deleteFails = false;
    await p.pullProfiles();
    await flush();
    expect(p.loadProfiles().map((x) => x.id)).toEqual(['main']);
    expect(h.rows.map((r) => r.id)).not.toContain(leo.id);
    await p.pullProfiles();
    expect(localStorage.getItem('smc-profiles-deleted:u1')).toBeNull();
  });

  it('an empty account after the first pull: profiles from before it were deleted elsewhere, not uploaded again', async () => {
    h.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    localStorage.setItem('smc-profiles-v1:u1', JSON.stringify([profile('main', { position: 0 }), profile('leo', { t: 1000 })]));
    localStorage.setItem('smc-profiles-pulled:u1', '5000');
    await p.initProfiles();
    await p.pullProfiles();
    expect(p.loadProfiles().map((x) => x.id)).toEqual(['main']);
    expect(h.upserts.some((u) => u.id === 'leo')).toBe(false);
  });

  it('"Who\'s watching?" is not asked again in a run where someone was picked', async () => {
    const { p } = await fresh();
    localStorage.setItem('smc-profiles-v1:device', JSON.stringify([profile('main', { position: 0 }), profile('mia', { kidsLevel: 'kids' })]));
    expect((await p.initProfiles()).needsPick).toBe(true);
    expect(p.pickProfile('main')).toBe('same');
    expect((await p.initProfiles()).needsPick).toBe(false);
  });
});

describe("this box's profiles, brought to the account", () => {
  it('moves them, with their history on the box', async () => {
    localStorage.setItem('smc-profiles-v1:device', JSON.stringify([profile('main', { position: 0 }), profile('mia', { kidsLevel: 'kids' })]));
    localStorage.setItem('snow-watch-history:device:p:mia', '[1]');
    localStorage.setItem('snow-watch-history:device', '[2]');
    h.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    await p.initProfiles();
    expect(p.boxProfilesToBring().map((x) => x.id)).toEqual(['mia']);
    expect(p.bringBoxProfiles()).toBe(1);
    await flush();
    expect(p.loadProfiles('u1').map((x) => x.id)).toEqual(['main', 'mia']);
    expect(p.loadProfiles('u1').find((x) => x.id === 'mia')?.kidsLevel).toBe('kids');
    expect(p.loadProfiles('device').map((x) => x.id)).toEqual(['main']);
    expect(localStorage.getItem('snow-watch-history:u1:p:mia')).toBe('[1]');
    expect(localStorage.getItem('snow-watch-history:device:p:mia')).toBeNull();
    expect(localStorage.getItem('snow-watch-history:device')).toBe('[2]');
    expect(h.upserts.some((u) => u.id === 'mia')).toBe(true);
    expect(p.boxProfilesToBring()).toEqual([]);
  });
});

describe('switching with storage nearly full', () => {
  it('moves a big setting rather than copying it, so it is not lost', async () => {
    const { p } = await fresh();
    await p.initProfiles();
    const kid = p.createProfile({ name: 'Leo', avatar: 'green', kidsLevel: 'kids' })!;
    const big = 'x'.repeat(2000);
    localStorage.setItem('snow-active-bg', big);
    // Room for one copy of it, not two.
    const LIMIT = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
      .reduce((n, key) => n + key.length + (localStorage.getItem(key) ?? '').length, 0) + 1000;
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      let used = 0;
      for (let i = 0; i < this.length; i++) { const k2 = this.key(i)!; if (k2 !== key) used += k2.length + (this.getItem(k2) ?? '').length; }
      if (used + key.length + value.length > LIMIT) throw new DOMException('full', 'QuotaExceededError');
      real.call(this, key, value);
    });
    try {
      p.pickProfile(kid.id);
      expect(localStorage.getItem('smc-pstash:main:snow-active-bg')).toBe(big);
      p.pickProfile('main');
      expect(localStorage.getItem('snow-active-bg')).toBe(big);
    } finally { spy.mockRestore(); }
  });
});
