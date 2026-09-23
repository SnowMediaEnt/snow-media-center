import { beforeEach, describe, expect, it, vi } from 'vitest';

let answer: Record<string, unknown> | null = { ok: true, uuid: 'provider-uuid', usernames: ['provider', 'snowowner', 'snowlink'] };
vi.mock('@/lib/xtream', () => ({ loadPlayerAccount: vi.fn(async () => null) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: vi.fn(async () => ({ data: answer, error: null })) } },
}));

beforeEach(() => {
  localStorage.clear();
  answer = { ok: true, uuid: 'provider-uuid', usernames: ['provider', 'snowowner', 'snowlink'] };
});

describe('isOwnPlexAccount', () => {
  it('own only when on none of the shared accounts', async () => {
    const { isOwnPlexAccount } = await import('./plexProvider');
    expect(await isOwnPlexAccount({ uuid: 'c1', username: 'JaneDoe' })).toBe(true);
    expect(await isOwnPlexAccount({ uuid: 'provider-uuid', username: 'provider' })).toBe(false);
  });

  it('boxes the Hub linked to the owner or link account are shared', async () => {
    const { isOwnPlexAccount } = await import('./plexProvider');
    expect(await isOwnPlexAccount({ uuid: 'o1', username: 'SnowOwner' })).toBe(false);
    expect(await isOwnPlexAccount({ uuid: 'l1', username: 'snowlink' })).toBe(false);
  });

  it('unknown or incomplete answers count as shared', async () => {
    const { isOwnPlexAccount } = await import('./plexProvider');
    answer = { ok: true, uuid: 'provider-uuid' }; // an older function without the Hub's accounts
    expect(await isOwnPlexAccount({ uuid: 'c1', username: 'JaneDoe' })).toBe(false);
    answer = null;
    expect(await isOwnPlexAccount({ uuid: 'c1', username: 'JaneDoe' })).toBe(false);
    expect(await isOwnPlexAccount({ uuid: 'c1' })).toBe(false);
  });

  it('a provider-linked box is shared whatever the account', async () => {
    localStorage.setItem('snow-plex-provider-v1', '1');
    const { isOwnPlexAccount } = await import('./plexProvider');
    expect(await isOwnPlexAccount({ uuid: 'c1', username: 'JaneDoe' })).toBe(false);
  });
});
