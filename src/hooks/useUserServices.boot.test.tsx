/**
 * Start-up reads of the viewer's services: no auth/v1/user round-trip, one
 * customers lookup shared with the Player's cloud sync, and a first read
 * that waits for that sync's write instead of reading the rows twice.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as string[],
  getUser: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'ilike', 'order', 'limit', 'not', 'in']) b[m] = () => b;
    b.maybeSingle = async () => { h.calls.push(`${table}:get1`); return { data: table === 'customers' ? { id: 'c1' } : null, error: null }; };
    b.then = (res: (v: unknown) => unknown) => {
      h.calls.push(`${table}:get`);
      const data = table === 'customer_services'
        ? [{ id: 's1', service_type: 'IPTV', service_name: 'Dreamstreams', expiration_date: null, tied_apps: null, renewal_status: null, notes: null }]
        : [];
      return Promise.resolve({ data, error: null }).then(res);
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
      auth: {
        getUser: h.getUser,
        getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      },
    },
  };
});
let scheduled: Array<() => void> = [];
vi.mock('@/utils/idle', () => ({
  runWhenIdle: (fn: () => void) => { fn(); return () => {}; },
  runAfter: (_ms: number, fn: () => void) => { scheduled.push(fn); return () => { scheduled = scheduled.filter((f) => f !== fn); }; },
  onFirstInteraction: (fn: () => void) => { fn(); return () => {}; },
}));

import { useMyUserServices, ensureCustomerRow, trackServicesWrite, __resetUserServicesForTests } from './useUserServices';

const settle = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };

beforeEach(() => { __resetUserServicesForTests(); h.calls = []; h.getUser.mockReset(); scheduled = []; });

describe('useMyUserServices at start-up', () => {
  it('waits before reading, reads once for many components, and never asks auth/v1/user', async () => {
    const a = renderHook(() => useMyUserServices());
    const b = renderHook(() => useMyUserServices());
    await settle();
    expect(h.calls).toEqual([]); // deferred
    expect(scheduled).toHaveLength(1);
    await act(async () => { scheduled[0](); });
    await settle();
    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.calls.filter((c) => c.startsWith('customers'))).toHaveLength(1);
    expect(h.calls.filter((c) => c.startsWith('customer_devices'))).toHaveLength(1);
    expect(h.calls.filter((c) => c.startsWith('customer_services'))).toHaveLength(1);
    expect(b.result.current.services.map((s) => s.id)).toEqual(['s1']);
    a.unmount(); b.unmount();
  });

  it('an app launched early reads at once (ensureLoaded)', async () => {
    const a = renderHook(() => useMyUserServices());
    await act(async () => { a.result.current.ensureLoaded(); });
    await settle();
    expect(h.calls.filter((c) => c.startsWith('customer_services'))).toHaveLength(1);
    expect(scheduled).toHaveLength(0); // the deferred read was dropped
    a.unmount();
  });

  it('shares the customers lookup with the cloud sync and waits for its write', async () => {
    let finishWrite: () => void = () => {};
    const a = renderHook(() => useMyUserServices());
    // The Player's sync starts: its own customers lookup …
    const id = ensureCustomerRow('u1', 'x@y.z');
    trackServicesWrite(new Promise<void>((r) => { finishWrite = r; }));
    await act(async () => { scheduled[0](); });
    await settle();
    expect(await id).toBe('c1');
    // … is the only one, and the services read has not run yet.
    expect(h.calls.filter((c) => c.startsWith('customers'))).toHaveLength(1);
    expect(h.calls.filter((c) => c.startsWith('customer_services'))).toHaveLength(0);
    // The sync's refresh comes while the read waits: it is that read.
    window.dispatchEvent(new CustomEvent('userServicesRefresh', { detail: { servicesOnly: true } }));
    await act(async () => { finishWrite(); });
    await settle();
    expect(h.calls.filter((c) => c.startsWith('customer_services'))).toHaveLength(1);
    expect(h.calls.filter((c) => c.startsWith('customers'))).toHaveLength(1);
    a.unmount();
  });

  it('a refresh after the first read reads only the services', async () => {
    const a = renderHook(() => useMyUserServices());
    await act(async () => { scheduled[0](); });
    await settle();
    h.calls = [];
    await act(async () => { window.dispatchEvent(new CustomEvent('userServicesRefresh', { detail: { servicesOnly: true } })); });
    await settle();
    expect(h.calls).toEqual(['customer_services:get']);
    a.unmount();
  });
});
