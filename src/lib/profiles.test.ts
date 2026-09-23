import { beforeEach, describe, expect, it, vi } from 'vitest';

const upserts: unknown[] = [];
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({ upsert: (row: unknown) => { upserts.push(row); return Promise.resolve({ error: null }); } }),
    functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
  },
}));

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear(); upserts.length = 0;
  const p = await import('./profiles');
  const v = await import('./viewer');
  p.__resetProfilesForTests();
  v.__setViewerForTests('device');
});

describe('profiles', () => {
  it('opens straight to Home with one profile; asks once there is a choice, not again in the same run', async () => {
    const p = await import('./profiles');
    expect(p.loadProfiles().map((x) => x.id)).toEqual(['main']);
    expect((await p.initProfiles()).needsPick).toBe(false);
    p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' });
    sessionStorage.clear();
    p.__resetProfilesForTests();
    expect((await p.initProfiles()).needsPick).toBe(true);
    expect(p.pickProfile('main')).toBe('same');
    p.__resetProfilesForTests();
    expect((await p.initProfiles()).needsPick).toBe(false);
  });

  it('switching moves the per-person settings and the viewer key', async () => {
    const p = await import('./profiles');
    const v = await import('./viewer');
    const k = await import('./kidsFilter');
    await p.initProfiles();
    localStorage.setItem('snow-media-layout', 'grid');
    localStorage.setItem('snow-livetv-hidden:line', '["1"]');
    const kid = p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' })!;
    expect(p.pickProfile(kid.id)).toBe('reload');
    expect(localStorage.getItem('snow-media-layout')).toBeNull();
    expect(localStorage.getItem('snow-livetv-hidden:line')).toBeNull();
    expect(v.viewerKey()).toBe(`device:p:${kid.id}`);
    expect(k.kidsLevel()).toBe('kids');
    localStorage.setItem('snow-media-layout', 'row');
    p.pickProfile('main');
    expect(localStorage.getItem('snow-media-layout')).toBe('grid');
    expect(localStorage.getItem('snow-livetv-hidden:line')).toBe('["1"]');
    expect(v.viewerKey()).toBe('device');
    expect(k.kidsLevel()).toBeNull();
    p.pickProfile(kid.id);
    expect(localStorage.getItem('snow-media-layout')).toBe('row');
  });

  it('checks a PIN, counts wrong ones and pauses after five', async () => {
    const p = await import('./profiles');
    const dad = p.createProfile({ name: 'Dad', avatar: 'blue', kidsLevel: null })!;
    const withPin = p.setPin(dad.id, '1234')!;
    expect(withPin.pinHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.checkPin(withPin, '0000')).toBe(false);
    expect(p.pinFailures(dad.id)).toBe(1);
    expect(p.checkPin(withPin, '1234')).toBe(true);
    expect(p.pinFailures(dad.id)).toBe(0);
    for (let i = 0; i < 5; i++) p.checkPin(withPin, '9999');
    expect(p.pinLockedFor(dad.id)).toBeGreaterThan(0);
    expect(p.checkPin(withPin, '1234')).toBe(false);
    expect(p.grownUpsWithPin().map((x) => x.id)).toEqual([dad.id]);
  });

  it('deleting a profile drops its stash and falls back to main', async () => {
    const p = await import('./profiles');
    await p.initProfiles();
    const kid = p.createProfile({ name: 'Leo', avatar: 'green', kidsLevel: 'little' })!;
    p.pickProfile(kid.id);
    localStorage.setItem(`snow-plex-progress:device:p:${kid.id}`, '{}');
    p.pickProfile('main');
    expect(localStorage.getItem(`smc-pstash:${kid.id}:snow-media-layout`)).toBeNull();
    p.deleteProfile(kid.id);
    expect(p.loadProfiles().map((x) => x.id)).toEqual(['main']);
    expect(localStorage.getItem(`snow-plex-progress:device:p:${kid.id}`)).toBeNull();
  });
});

describe('viewer keys on the account', () => {
  it('prefixes a profile\'s rows and keeps the main profile\'s plain', async () => {
    const v = await import('./viewer');
    v.__setViewerForTests('u1');
    expect(v.cloudItemKey('55')).toBe('55');
    expect(v.fromCloudItemKey('p:ab:55')).toBeNull();
    v.__setViewerForTests('u1:p:ab');
    expect(v.viewerAccountId()).toBe('u1');
    expect(v.cloudItemKey('55')).toBe('p:ab:55');
    expect(v.fromCloudItemKey('p:ab:55')).toBe('55');
    expect(v.fromCloudItemKey('55')).toBeNull();
  });
});
