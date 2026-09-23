import { beforeEach, describe, expect, it, vi } from 'vitest';

let providerUuid: string | null = 'provider-uuid';
vi.mock('@/lib/xtream', () => ({ loadPlayerAccount: vi.fn(async () => null) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async () => (providerUuid ? { data: { ok: true, uuid: providerUuid }, error: null } : { data: { ok: false }, error: null })),
    },
  },
}));

beforeEach(() => { localStorage.clear(); providerUuid = 'provider-uuid'; });

describe('isOwnPlexAccount', () => {
  it('own account only when it is known and not the provider account', async () => {
    const { isOwnPlexAccount } = await import('./plexProvider');
    expect(await isOwnPlexAccount('customer-uuid')).toBe(true);
    expect(await isOwnPlexAccount('provider-uuid')).toBe(false);
    expect(await isOwnPlexAccount(undefined)).toBe(false);
  });

  it('unknown provider account counts as shared', async () => {
    providerUuid = null;
    const { isOwnPlexAccount } = await import('./plexProvider');
    expect(await isOwnPlexAccount('customer-uuid')).toBe(false);
  });

  it('a provider-linked box is shared whatever the account', async () => {
    localStorage.setItem('snow-plex-provider-v1', '1');
    const { isOwnPlexAccount } = await import('./plexProvider');
    expect(await isOwnPlexAccount('customer-uuid')).toBe(false);
  });
});
