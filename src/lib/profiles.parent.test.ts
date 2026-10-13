// The Parent PIN: the account's lock on Profiles. Kept on the box and in
// viewer_parent_pin (a small in-memory table stands in for the account),
// checked with the same pauses as a profile's PIN, and reset by email with
// the new PIN going along with the code.
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ParentRow { user_id: string; pin_hash: string; updated_at: string }

const h = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  authCb: null as null | ((event: string, session: unknown) => void),
  parent: {} as Record<string, ParentRow>,
  profiles: [] as Array<Record<string, unknown>>,
  invokes: [] as Array<{ name: string; body: Record<string, unknown> }>,
  verify: { ok: true } as Record<string, unknown>,
}));

vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => {
    const filters: Record<string, string> = {};
    let op: 'select' | 'delete' = 'select';
    const q = {
      select: () => q,
      eq: (c: string, v: string) => { filters[c] = v; return q; },
      like: () => q,
      delete: () => { op = 'delete'; return q; },
      upsert: (row: Record<string, unknown>) => {
        if (table === 'viewer_parent_pin') h.parent[String(row.user_id)] = row as unknown as ParentRow;
        if (table === 'viewer_profiles') h.profiles = [...h.profiles.filter((r) => !(r.user_id === row.user_id && r.id === row.id)), row];
        return Promise.resolve({ error: null });
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        if (op === 'delete') {
          if (table === 'viewer_parent_pin') delete h.parent[filters.user_id];
          return Promise.resolve({ error: null }).then(res, rej);
        }
        const data = table === 'viewer_parent_pin' ? (h.parent[filters.user_id] ? [h.parent[filters.user_id]] : [])
          : table === 'viewer_profiles' ? h.profiles.filter((r) => r.user_id === filters.user_id) : [];
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
      functions: {
        invoke: async (name: string, opts: { body: Record<string, unknown> }) => {
          h.invokes.push({ name, body: opts.body });
          if (opts.body.action === 'request') return { data: { ok: true, emailed: true, email: 'ow•••••@example.com' }, error: null };
          return { data: h.verify, error: null };
        },
      },
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
  h.session = null; h.authCb = null; h.parent = {}; h.profiles = []; h.invokes = []; h.verify = { ok: true };
});

describe('the Parent PIN on the box', () => {
  it('is hashed with the account, checked, and pauses after five wrong tries', async () => {
    h.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    await p.initProfiles();
    expect(p.hasParentPin()).toBe(false);
    p.setParentPin('2468');
    expect(p.hasParentPin()).toBe(true);
    const stored = JSON.parse(localStorage.getItem('smc-parent-pin:u1')!);
    expect(stored.h).toBe(p.hashPin(p.PARENT_PIN_ID, '2468', 'u1'));
    // Not the same lock as a profile's PIN with the same digits.
    expect(stored.h).not.toBe(p.hashPin('main', '2468', 'u1'));
    expect(p.checkParentPin('0000')).toBe(false);
    expect(p.pinFailures(p.PARENT_PIN_ID)).toBe(1);
    expect(p.checkParentPin('2468')).toBe(true);
    expect(p.pinFailures(p.PARENT_PIN_ID)).toBe(0);
    for (let i = 0; i < 5; i++) p.checkParentPin('1111');
    expect(p.parentPinLockedFor()).toBeGreaterThan(0);
    // Paused: even the right one waits.
    expect(p.checkParentPin('2468')).toBe(false);
  });

  it('is asked for on a signed-in account, can be put off only without a Kids profile, and never signed out', async () => {
    const { p, v } = await fresh();
    v.__setViewerForTests('device');
    expect(p.parentPinDue()).toBe(false);
    p.putOffParentPin();
    expect(localStorage.getItem('smc-parent-pin-later:device')).toBeNull();
    v.__setViewerForTests('u1');
    expect(p.parentPinDue()).toBe(true);
    p.putOffParentPin();
    expect(p.parentPinDue()).toBe(false);
    // A Kids profile: no putting it off any more.
    p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' });
    expect(p.parentPinCanWait()).toBe(false);
    expect(p.parentPinDue()).toBe(true);
    p.setParentPin('1234');
    expect(p.parentPinDue()).toBe(false);
  });
});

describe('the Parent PIN on the account', () => {
  it('goes up when made, comes down to another box, and a turn-off elsewhere clears it', async () => {
    h.session = { user: { id: 'u1' } };
    let { p } = await fresh();
    await p.initProfiles();
    await p.pullProfiles();
    expect(p.parentPinKnown()).toBe(true);
    p.setParentPin('1357');
    await flush();
    expect(h.parent.u1?.pin_hash).toBe(p.hashPin(p.PARENT_PIN_ID, '1357', 'u1'));

    // Another box: it hears of it on its first pull.
    localStorage.clear(); sessionStorage.clear();
    ({ p } = await fresh());
    expect(p.parentPinKnown()).toBe(false);
    await p.initProfiles();
    await p.pullProfiles();
    expect(p.hasParentPin()).toBe(true);
    expect(p.checkParentPin('1357')).toBe(true);

    // Turned off on the first box: gone from the account, so gone here.
    delete h.parent.u1;
    await p.pullProfiles();
    expect(p.hasParentPin()).toBe(false);
  });

  it('a change made offline goes up on the next pull unless the account changed it since', async () => {
    h.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    // Made on this box, never uploaded (offline then), newer than the account's.
    localStorage.setItem('smc-parent-pin:u1', JSON.stringify({ h: p.hashPin(p.PARENT_PIN_ID, '1111', 'u1'), t: 5000, up: true, known: true }));
    h.parent.u1 = { user_id: 'u1', pin_hash: p.hashPin(p.PARENT_PIN_ID, '2222', 'u1'), updated_at: new Date(4000).toISOString() };
    await p.initProfiles();
    await p.pullProfiles();
    expect(h.parent.u1.pin_hash).toBe(p.hashPin(p.PARENT_PIN_ID, '1111', 'u1'));
    // The account changed it later than this box's (older) offline change: the account's stands.
    localStorage.setItem('smc-parent-pin:u1', JSON.stringify({ h: p.hashPin(p.PARENT_PIN_ID, '3333', 'u1'), t: 6000, up: true, known: true }));
    h.parent.u1 = { user_id: 'u1', pin_hash: p.hashPin(p.PARENT_PIN_ID, '4444', 'u1'), updated_at: new Date(7000).toISOString() };
    await p.pullProfiles();
    expect(p.checkParentPin('4444')).toBe(true);
    expect(h.parent.u1.pin_hash).toBe(p.hashPin(p.PARENT_PIN_ID, '4444', 'u1'));
  });
});

describe('grown-up checks take the Parent PIN', () => {
  it('the grown-up pad takes it, and its wrong tries count against the Parent PIN too', async () => {
    h.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    await p.initProfiles();
    expect(p.grownUpPinExists()).toBe(false);
    p.setParentPin('9753');
    expect(p.grownUpPinExists()).toBe(true);
    expect(p.checkGrownUpPin('9753')).toBe(true);
    for (let i = 0; i < 5; i++) expect(p.checkGrownUpPin('0000')).toBe(false);
    expect(p.parentPinLockedFor()).toBeGreaterThan(0);
    // The pad is no way round the Parent PIN's pause.
    expect(p.checkParentPin('9753')).toBe(false);
  });

  it("a grown-up profile's own pad from a Kids profile takes its PIN or the Parent PIN", async () => {
    h.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    await p.initProfiles();
    const dad = p.setPin(p.createProfile({ name: 'Dad', avatar: 'gold', kidsLevel: null })!.id, '1111')!;
    p.setParentPin('2222');
    expect(p.checkPinOrParent(dad, '1111')).toBe(true);
    expect(p.checkPinOrParent(dad, '2222')).toBe(true);
    expect(p.checkPinOrParent(dad, '3333')).toBe(false);
    expect(p.pinFailures(dad.id)).toBe(1);
    expect(p.pinFailures(p.PARENT_PIN_ID)).toBe(1);
  });

  it("signed out on a Kids profile: that account's Parent PIN alone holds its limits", async () => {
    h.session = { user: { id: 'u1' } };
    localStorage.setItem(TOKEN, JSON.stringify({ user: { id: 'u1' } }));
    const { p, k } = await fresh();
    localStorage.setItem('smc-profiles-v1:u1', JSON.stringify([profile('main', { position: 0 }), profile('mia', { kidsLevel: 'kids' })]));
    localStorage.setItem('smc-last-profile:u1', 'mia');
    await p.initProfiles();
    p.setParentPin('8642');
    localStorage.removeItem(TOKEN); h.session = null;
    h.authCb?.('SIGNED_OUT', null);
    expect(k.kidsLevel()).toBe('kids');
    // No grown-up profile has a PIN; the Parent PIN is enough to hold it.
    expect(p.grownUpsWithPin()).toEqual([]);
    expect(p.kidsHoldNeedsGrownUp()).toBe(true);
    expect(p.checkGrownUpPin('0000')).toBe(false);
    expect(p.checkGrownUpPin('8642')).toBe(true);
  });
});

describe('Forgot the Parent PIN', () => {
  it('asks for a code, and the new PIN goes with it: the account never has none', async () => {
    h.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    await p.initProfiles();
    expect(await p.requestPinReset(p.PARENT_PIN_ID)).toEqual({ ok: false, reason: 'no_pin' });
    expect(h.invokes).toHaveLength(0);
    p.setParentPin('1111');
    await flush();
    for (let i = 0; i < 3; i++) p.checkParentPin('0000');
    const r = await p.requestPinReset(p.PARENT_PIN_ID);
    expect(r.ok).toBe(true);
    expect(h.invokes[0].body).toEqual({ action: 'request', profile_id: '__parent__' });
    // No new PIN: nothing is sent.
    expect(await p.verifyPinReset(p.PARENT_PIN_ID, '123456')).toEqual({ ok: false, reason: 'bad_pin' });
    expect(h.invokes).toHaveLength(1);
    // A wrong code: the old PIN stands.
    h.verify = { ok: false, reason: 'wrong_code', left: 4 };
    expect(await p.verifyPinReset(p.PARENT_PIN_ID, '000000', '5555')).toEqual({ ok: false, reason: 'wrong_code', left: 4 });
    expect(p.checkParentPin('1111')).toBe(true);
    h.verify = { ok: true };
    expect(await p.verifyPinReset(p.PARENT_PIN_ID, '123456', '5555')).toEqual({ ok: true });
    expect(h.invokes[2].body).toEqual({ action: 'verify', profile_id: '__parent__', code: '123456', new_pin_hash: p.hashPin(p.PARENT_PIN_ID, '5555', 'u1') });
    expect(p.checkParentPin('1111')).toBe(false);
    expect(p.checkParentPin('5555')).toBe(true);
    expect(p.pinFailures(p.PARENT_PIN_ID)).toBe(0);
  });
});
