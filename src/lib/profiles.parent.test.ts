// The Parent PIN: the account's lock on Profiles. Kept on the box and in
// viewer_parent_pin (src/test/fakeViewerAccount stands in for the account,
// with Postgres's compare-and-swap behaviour), checked with the same pauses
// as a profile's PIN, made only by a grown-up, and reset by email with the
// new PIN going along with the code.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { account, resetAccount } from '@/test/fakeViewerAccount';

vi.mock('@/integrations/supabase/client', async () => ({ supabase: (await import('@/test/fakeViewerAccount')).supabase }));

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
const stored = (acc = 'u1') => JSON.parse(localStorage.getItem(`smc-parent-pin:${acc}`) || 'null');

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  resetAccount();
});

describe('the Parent PIN on the box', () => {
  it('is hashed with the account, checked, and pauses after five wrong tries', async () => {
    account.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    await p.initProfiles();
    await p.pullProfiles();
    expect(p.hasParentPin()).toBe(false);
    p.setParentPin('2468');
    expect(p.hasParentPin()).toBe(true);
    expect(stored().h).toBe(p.hashPin(p.PARENT_PIN_ID, '2468', 'u1'));
    // Not the same lock as a profile's PIN with the same digits.
    expect(stored().h).not.toBe(p.hashPin('main', '2468', 'u1'));
    expect(p.checkParentPin('0000')).toBe(false);
    expect(p.pinFailures(p.PARENT_PIN_ID)).toBe(1);
    expect(p.checkParentPin('2468')).toBe(true);
    expect(p.pinFailures(p.PARENT_PIN_ID)).toBe(0);
    for (let i = 0; i < 5; i++) p.checkParentPin('1111');
    expect(p.parentPinLockedFor()).toBeGreaterThan(0);
    // Paused: even the right one waits.
    expect(p.checkParentPin('2468')).toBe(false);
  });

  it('is asked for only once a signed-in account has a Kids profile, and never signed out', async () => {
    const { p, v } = await fresh();
    v.__setViewerForTests('device');
    expect(p.parentPinDue()).toBe(false);
    p.putOffParentPin();
    expect(localStorage.getItem('smc-parent-pin-later:device')).toBeNull();
    v.__setViewerForTests('u1');
    // No Kids profile: never asked (owner, 2026-10-16).
    expect(p.parentPinDue()).toBe(false);
    // A Kids profile: the grown-up has to have one.
    p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' });
    expect(p.parentPinCanWait()).toBe(false);
    expect(p.parentPinDue()).toBe(true);
    p.setParentPin('1234');
    expect(p.parentPinDue()).toBe(false);
  });

  it('is never made from a Kids profile or its held limits, and on an account with Kids it takes a proof', async () => {
    const { p, v } = await fresh();
    v.__setViewerForTests('u1');
    expect(p.parentPinCanBeMade()).toBe(true);
    expect(p.parentPinProof()).toBe('none');
    const mia = p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' })!;
    // Kids on the account: a code emailed to it, or a grown-up profile's own PIN when one has one.
    expect(p.parentPinProof()).toBe('email');
    p.setPin('main', '9999');
    expect(p.parentPinProof()).toBe('grownup');
    p.pickProfile(mia.id);
    expect(p.parentPinCanBeMade()).toBe(false);
    // Back on "Me": the hold is gone with the pick, and it can be made again.
    p.pickProfile('main');
    expect(p.parentPinCanBeMade()).toBe(true);
    // Signed out: no PINs at all.
    v.__setViewerForTests('device');
    expect(p.parentPinCanBeMade()).toBe(false);
  });
});

describe('the Parent PIN on the account', () => {
  it('a first one is inserted; another box hears it; turned off elsewhere, it goes here too', async () => {
    account.session = { user: { id: 'u1' } };
    let { p } = await fresh();
    await p.initProfiles();
    await p.pullProfiles();
    expect(p.parentPinKnown()).toBe(true);
    p.setParentPin('1357');
    await flush();
    expect(account.parent.u1.pin_hash).toBe(p.hashPin(p.PARENT_PIN_ID, '1357', 'u1'));
    expect(account.parentWrites.map((w) => w.op)).toEqual(['insert']);
    // The server's time, not the box's: nothing it sends carries one.
    expect(account.parentWrites.every((w) => !w.payload || !('updated_at' in w.payload))).toBe(true);
    expect(stored().base).toBe(account.parent.u1.updated_at);

    // Another box: it hears of it on its first pull.
    localStorage.clear(); sessionStorage.clear();
    ({ p } = await fresh());
    expect(p.parentPinKnown()).toBe(false);
    await p.initProfiles();
    await p.pullProfiles();
    expect(p.hasParentPin()).toBe(true);
    expect(p.checkParentPin('1357')).toBe(true);

    // Turned off on the first box: gone from the account, so gone here.
    delete account.parent.u1;
    await p.pullProfiles();
    expect(p.hasParentPin()).toBe(false);
  });

  it('two boxes making a first one: the second insert fails and that box takes the account\'s', async () => {
    account.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    await p.initProfiles();
    await p.pullProfiles();
    // Another box got there first, after this one last asked.
    account.parent.u1 = { user_id: 'u1', pin_hash: p.hashPin(p.PARENT_PIN_ID, '2580', 'u1'), updated_at: '2029-12-31T00:00:00.000Z' };
    p.setParentPin('1111');
    await flush(); await flush();
    expect(account.parent.u1.pin_hash).toBe(p.hashPin(p.PARENT_PIN_ID, '2580', 'u1'));
    expect(p.checkParentPin('2580')).toBe(true);
    expect(p.checkParentPin('1111')).toBe(false);
    expect(stored().up).toBe(false);
  });

  it('a change goes up only against the row this box last saw: when the account changed it since, the account\'s stands', async () => {
    account.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    await p.initProfiles();
    await p.pullProfiles();
    p.setParentPin('1111');
    await flush();
    const seen = account.parent.u1.updated_at;
    // Changed here: compare and swap against what this box saw.
    p.setParentPin('2222');
    await flush();
    expect(account.parentWrites[1]).toMatchObject({ op: 'update', filters: { user_id: 'u1', updated_at: seen } });
    expect(account.parent.u1.pin_hash).toBe(p.hashPin(p.PARENT_PIN_ID, '2222', 'u1'));
    // Offline, a change here; meanwhile a reset on another box (later on the server).
    account.offline = true;
    p.setParentPin('3333');
    await flush();
    account.offline = false;
    account.parent.u1 = { user_id: 'u1', pin_hash: p.hashPin(p.PARENT_PIN_ID, '4444', 'u1'), updated_at: '2031-01-01T00:00:00.000Z' };
    await p.pullProfiles();
    expect(account.parent.u1.pin_hash).toBe(p.hashPin(p.PARENT_PIN_ID, '4444', 'u1'));
    expect(p.checkParentPin('4444')).toBe(true);
  });

  it('offline, a box that never heard from the account: a PIN made there never beats the account\'s', async () => {
    account.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    account.parent.u1 = { user_id: 'u1', pin_hash: p.hashPin(p.PARENT_PIN_ID, '2580', 'u1'), updated_at: '2029-01-01T00:00:00.000Z' };
    account.offline = true;
    await p.initProfiles();
    await p.pullProfiles();
    expect(p.parentPinKnown()).toBe(false);
    // Even if something made one here then (the screens don't), it is only ever inserted.
    p.setParentPin('1111');
    await flush();
    expect(stored()).toMatchObject({ known: false, base: null, up: true });
    account.offline = false;
    await p.pullProfiles();
    expect(account.parent.u1.pin_hash).toBe(p.hashPin(p.PARENT_PIN_ID, '2580', 'u1'));
    expect(p.parentPinKnown()).toBe(true);
    expect(p.checkParentPin('2580')).toBe(true);
    expect(p.checkParentPin('1111')).toBe(false);
  });

  it('a request that never answers gives up after 8 seconds, and the box still hasn\'t heard', async () => {
    vi.useFakeTimers();
    try {
      account.session = { user: { id: 'u1' } };
      const { p } = await fresh();
      await p.initProfiles();
      account.hang = true;
      let done = false;
      void p.pullProfiles().then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(7000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2000);
      expect(done).toBe(true);
      expect(p.parentPinKnown()).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

describe('grown-up checks take the Parent PIN', () => {
  it('the grown-up pad takes it, and its wrong tries count against the Parent PIN too', async () => {
    account.session = { user: { id: 'u1' } };
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
    account.session = { user: { id: 'u1' } };
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
    account.session = { user: { id: 'u1' } };
    localStorage.setItem(TOKEN, JSON.stringify({ user: { id: 'u1' } }));
    const { p, k } = await fresh();
    localStorage.setItem('smc-profiles-v1:u1', JSON.stringify([profile('main', { position: 0 }), profile('mia', { kidsLevel: 'kids' })]));
    localStorage.setItem('smc-last-profile:u1', 'mia');
    await p.initProfiles();
    p.setParentPin('8642');
    localStorage.removeItem(TOKEN); account.session = null;
    account.authCb?.('SIGNED_OUT', null);
    expect(k.kidsLevel()).toBe('kids');
    // No grown-up profile has a PIN; the Parent PIN is enough to hold it.
    expect(p.grownUpsWithPin()).toEqual([]);
    expect(p.kidsHoldNeedsGrownUp()).toBe(true);
    expect(p.checkGrownUpPin('0000')).toBe(false);
    expect(p.checkGrownUpPin('8642')).toBe(true);
  });

  it("another account signed in over a held Kids profile: only the held account's PINs count, not the new one's", async () => {
    const { p, v } = await fresh();
    v.__setViewerForTests('P');
    const mia = p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' })!;
    p.setParentPin('2580');
    p.pickProfile(mia.id);
    // Signed in to (or signed up for) account K, which the kid controls.
    v.__setViewerForTests('K');
    p.setPin('main', '1111');
    p.setParentPin('0000');
    localStorage.setItem('smc-kids-hold', JSON.stringify({ level: 'kids', acc: 'P' }));
    expect(p.grownUpAccount()).toBe('P');
    expect(p.kidsHoldNeedsGrownUp()).toBe(true);
    expect(p.parentPinCanBeMade()).toBe(false);
    expect(p.grownUpsWithPin()).toEqual([]);
    expect(p.checkGrownUpPin('1111')).toBe(false);
    expect(p.checkGrownUpPin('0000')).toBe(false);
    expect(p.checkGrownUpPin('2580')).toBe(true);
  });
});

describe('Forgot the Parent PIN, and making a first one by email', () => {
  it('asks for a code, and the new PIN goes with it: the account never has none', async () => {
    account.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    await p.initProfiles();
    expect(await p.requestPinReset(p.PARENT_PIN_ID)).toEqual({ ok: false, reason: 'no_pin' });
    expect(account.invokes).toHaveLength(0);
    p.setParentPin('1111');
    await flush();
    for (let i = 0; i < 3; i++) p.checkParentPin('0000');
    const r = await p.requestPinReset(p.PARENT_PIN_ID);
    expect(r.ok).toBe(true);
    expect(account.invokes[0]).toEqual({ action: 'request', profile_id: '__parent__' });
    // No new PIN: nothing is sent.
    expect(await p.verifyPinReset(p.PARENT_PIN_ID, '123456')).toEqual({ ok: false, reason: 'bad_pin' });
    expect(account.invokes).toHaveLength(1);
    // A wrong code: the old PIN stands.
    account.verifyFails = { ok: false, reason: 'wrong_code', left: 4 };
    expect(await p.verifyPinReset(p.PARENT_PIN_ID, '000000', '5555')).toEqual({ ok: false, reason: 'wrong_code', left: 4 });
    expect(p.checkParentPin('1111')).toBe(true);
    account.verifyFails = null;
    expect(await p.verifyPinReset(p.PARENT_PIN_ID, '123456', '5555')).toEqual({ ok: true });
    expect(account.invokes[2]).toEqual({ action: 'verify', profile_id: '__parent__', code: '123456', new_pin_hash: p.hashPin(p.PARENT_PIN_ID, '5555', 'u1') });
    expect(p.checkParentPin('1111')).toBe(false);
    expect(p.checkParentPin('5555')).toBe(true);
    // The account's new row is the one the box changes against next.
    expect(stored()).toMatchObject({ base: account.parent.u1.updated_at, up: false, known: true });
  });

  it('with none yet, the code is the proof for making the first one, once the account has answered', async () => {
    account.session = { user: { id: 'u1' } };
    const { p } = await fresh();
    await p.initProfiles();
    account.offline = true;
    expect(await p.requestPinReset(p.PARENT_PIN_ID, true)).toEqual({ ok: false, reason: 'network' });
    account.offline = false;
    expect((await p.requestPinReset(p.PARENT_PIN_ID, true)).ok).toBe(true);
    expect(await p.verifyPinReset(p.PARENT_PIN_ID, '123456', '7531')).toEqual({ ok: true });
    expect(account.parent.u1.pin_hash).toBe(p.hashPin(p.PARENT_PIN_ID, '7531', 'u1'));
    expect(p.checkParentPin('7531')).toBe(true);
    // Made: asking to make one now is moot.
    expect(await p.requestPinReset(p.PARENT_PIN_ID, true)).toEqual({ ok: false, reason: 'has_pin' });
  });
});
