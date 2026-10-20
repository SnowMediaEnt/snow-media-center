import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ demo: false, calls: [] as string[], wipeFails: false, stopFails: false, cancelFails: false, outsideFails: false }));
vi.mock('@/lib/xtream', () => ({
  clearCreds: async () => { h.calls.push('creds'); },
  clearPlayerAccount: async () => { h.calls.push('account'); },
  loadCreds: async () => ({ host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw', output: 'm3u8' }),
}));
// An outside service the line added goes with it (lib/outsideActions).
vi.mock('@/lib/outsideActions', () => ({
  forgetOutsideOwnedBy: async (line: { username: string }) => { h.calls.push(`outside:${line.username}`); if (h.outsideFails) throw new Error('storage'); },
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
    // No id = every schedule.
    cancelSchedule: async (opts?: { id?: string }) => { h.calls.push(opts?.id ? `cancel:${opts.id}` : 'cancel-schedules'); if (h.cancelFails) throw new Error('older app'); },
  },
  notifyRecordingsChanged: () => { h.calls.push('recordings-changed'); },
}));

import { signOutPlayer } from './playerSignOut';

beforeEach(() => { h.demo = false; h.calls = []; h.wipeFails = false; h.stopFails = false; h.cancelFails = false; h.outsideFails = false; });

describe('signOutPlayer', () => {
  it('wipes the rewind buffer, stops every recording, cancels every schedule, then clears the line and its account, and marks it signed out on purpose (no quiet sign-in back)', async () => {
    await signOutPlayer();
    expect(h.calls).toEqual(['wipe', 'stop-all', 'cancel-schedules', 'recordings-changed', 'outside:jsmith', 'creds', 'account', 'signed-out']);
  });

  it('still signs out when the app has no rewind or recorder plugin (older build)', async () => {
    h.wipeFails = true;
    h.stopFails = true;
    h.cancelFails = true;
    await signOutPlayer();
    expect(h.calls).toEqual(['wipe', 'stop-all', 'cancel-schedules', 'recordings-changed', 'outside:jsmith', 'creds', 'account', 'signed-out']);
  });

  it('cancels the schedules even when stopping recordings failed', async () => {
    h.stopFails = true;
    await signOutPlayer();
    expect(h.calls).toContain('cancel-schedules');
  });

  it('takes away the outside service the line added, before the line itself; a failure there never blocks sign-out', async () => {
    h.outsideFails = true;
    await signOutPlayer();
    expect(h.calls).toEqual(['wipe', 'stop-all', 'cancel-schedules', 'recordings-changed', 'outside:jsmith', 'creds', 'account', 'signed-out']);
  });

  it('does nothing in demo mode', async () => {
    h.demo = true;
    await signOutPlayer();
    expect(h.calls).toEqual([]);
  });
});
