import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ demo: false, calls: [] as string[] }));
vi.mock('@/lib/xtream', () => ({
  clearCreds: async () => { h.calls.push('creds'); },
  clearPlayerAccount: async () => { h.calls.push('account'); },
}));
vi.mock('@/lib/playerAutoSignIn', () => ({ markPlayerSignedOut: () => { h.calls.push('signed-out'); } }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => h.demo }));

import { signOutPlayer } from './playerSignOut';

beforeEach(() => { h.demo = false; h.calls = []; });

describe('signOutPlayer', () => {
  it('clears the line and its account, and marks it signed out on purpose (no quiet sign-in back)', async () => {
    await signOutPlayer();
    expect(h.calls).toEqual(['creds', 'account', 'signed-out']);
  });

  it('does nothing in demo mode', async () => {
    h.demo = true;
    await signOutPlayer();
    expect(h.calls).toEqual([]);
  });
});
