import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ demo: false, calls: [] as string[], wipeFails: false, stopFails: false }));
vi.mock('@/lib/xtream', () => ({
  clearCreds: async () => { h.calls.push('creds'); },
  clearPlayerAccount: async () => { h.calls.push('account'); },
}));
vi.mock('@/lib/playerAutoSignIn', () => ({ markPlayerSignedOut: () => { h.calls.push('signed-out'); } }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => h.demo }));
vi.mock('@/capacitor/SnowPlayer', () => ({
  SnowPlayer: { timeshiftWipe: async () => { h.calls.push('wipe'); if (h.wipeFails) throw new Error('older app'); } },
}));
vi.mock('@/capacitor/SnowRecorder', () => ({
  SnowRecorder: {
    // No id = every recording.
    stop: async (opts?: { id?: string }) => { h.calls.push(opts?.id ? `stop:${opts.id}` : 'stop-all'); if (h.stopFails) throw new Error('older app'); },
  },
  notifyRecordingsChanged: () => { h.calls.push('recordings-changed'); },
}));

import { signOutPlayer } from './playerSignOut';

beforeEach(() => { h.demo = false; h.calls = []; h.wipeFails = false; h.stopFails = false; });

describe('signOutPlayer', () => {
  it('wipes the rewind buffer, stops every recording, then clears the line and its account, and marks it signed out on purpose (no quiet sign-in back)', async () => {
    await signOutPlayer();
    expect(h.calls).toEqual(['wipe', 'stop-all', 'recordings-changed', 'creds', 'account', 'signed-out']);
  });

  it('still signs out when the app has no rewind or recorder plugin (older build)', async () => {
    h.wipeFails = true;
    h.stopFails = true;
    await signOutPlayer();
    expect(h.calls).toEqual(['wipe', 'stop-all', 'recordings-changed', 'creds', 'account', 'signed-out']);
  });

  it('does nothing in demo mode', async () => {
    h.demo = true;
    await signOutPlayer();
    expect(h.calls).toEqual([]);
  });
});
