// Panels keep usernames lowercase, but people (and phone keyboards) type
// capitals. Sign-in tries the lowercase name first and the typed one only
// if the panel refuses the lowercase one.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ get: vi.fn(), invoke: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  CapacitorHttp: { get: h.get },
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: h.invoke } } }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => false }));

import { authenticateRouted } from './xtream';

const ok = { status: 200, data: { user_info: { auth: 1, status: 'Active' } } };
const no = { status: 200, data: { user_info: { auth: 0 } } };
const userIn = (call: unknown[]) => decodeURIComponent(String((call[0] as { url: string }).url)).match(/username=([^&]+)/)?.[1];

beforeEach(() => { h.get.mockReset(); h.invoke.mockReset(); });

describe('Live TV sign-in: username case', () => {
  it('signs in with the lowercase name when capitals were typed', async () => {
    h.get.mockResolvedValue(ok);
    const r = await authenticateRouted('  JohnSmith ', 'pw');
    expect(r.ok).toBe(true);
    expect(r.creds?.username).toBe('johnsmith');
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(userIn(h.get.mock.calls[0])).toBe('johnsmith');
  });

  it('falls back to the name exactly as typed when the lowercase one is refused', async () => {
    h.get.mockResolvedValueOnce(no).mockResolvedValueOnce(ok);
    const r = await authenticateRouted('JohnSmith', 'pw');
    expect(r.ok).toBe(true);
    expect(r.creds?.username).toBe('JohnSmith');
    expect(h.get.mock.calls.map(userIn)).toEqual(['johnsmith', 'JohnSmith']);
  });

  it('asks only once when the name is already lowercase', async () => {
    h.get.mockResolvedValue(no);
    const r = await authenticateRouted('johnsmith', 'pw');
    expect(r.ok).toBe(false);
    expect(h.get).toHaveBeenCalledTimes(1);
  });
});
