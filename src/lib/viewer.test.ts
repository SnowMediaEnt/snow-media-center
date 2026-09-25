import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
}));

describe('viewer: what the box kept before signing in', () => {
  it('belongs to a signed-in account\'s main profile only', async () => {
    const v = await import('./viewer');
    v.__setViewerForTests('device');
    expect(v.deviceKeyToCarry()).toBeNull();
    v.__setViewerForTests('device:p:ab');
    expect(v.deviceKeyToCarry()).toBeNull();
    v.__setViewerForTests('u1');
    expect(v.deviceKeyToCarry()).toBe('device');
    // A profile made on the box comes over with bringBoxProfiles instead.
    v.__setViewerForTests('u1:p:ab');
    expect(v.deviceKeyToCarry()).toBeNull();
  });
});
