/**
 * Every Live TV sign-in goes through capturePlayerSignin('signin'): that is
 * where the box registers for its new line's messages (lib/deviceInbox),
 * at once, whatever the once-a-day memo says. A background reconcile doesn't.
 */
import { describe, expect, it, vi } from 'vitest';

const registerLine = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/deviceInbox', () => ({ registerLine }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn(async () => ({ data: { ok: true }, error: null })) } } }));
vi.mock('@/lib/analytics', () => ({ getDeviceId: () => 'device-1' }));

import { capturePlayerSignin } from './playerSigninCapture';
import type { PlayerAccount } from './xtream';

const ACC: PlayerAccount = {
  serverLabel: 'Dreamstreams', host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw', output: 'm3u8',
  expDate: null, status: 'Active', isTrial: false, maxConnections: 2, activeCons: 0, createdAt: null, lastCheckedAt: 0,
};

describe('capturePlayerSignin -> device inbox', () => {
  it('a sign-in registers the line for messages, forced; a reconcile does not', async () => {
    await capturePlayerSignin(ACC, 'Dreamstreams', 'signin');
    await vi.waitFor(() => expect(registerLine).toHaveBeenCalledTimes(1));
    expect(registerLine).toHaveBeenCalledWith(ACC, { force: true });
    await capturePlayerSignin(ACC, 'Dreamstreams', 'reconcile');
    await new Promise((r) => setTimeout(r, 20));
    expect(registerLine).toHaveBeenCalledTimes(1);
  });
});
