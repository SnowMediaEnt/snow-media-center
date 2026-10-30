/**
 * The shared reads: app_alerts, feature_flags and the app catalog are each
 * read ONCE however many components want them, over ONE realtime channel
 * that stays up until the last of those components unmounts (the old
 * fixed-name channels were removed for everyone by the first to leave).
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  selects: [] as string[],
  invokes: [] as string[],
  channels: [] as Array<{ topic: string; cb: ((p: Record<string, unknown>) => void) | null; removed: boolean }>,
  alertRows: [] as Array<Record<string, unknown>>,
  flagRows: [] as Array<{ key: string; enabled: boolean }>,
  appRows: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/integrations/supabase/client', () => {
  const rowsFor = (table: string) =>
    table === 'app_alerts' ? h.alertRows : table === 'feature_flags' ? h.flagRows : table === 'apps' ? h.appRows : [];
  // A thenable query builder: every filter returns itself; awaiting it answers.
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'or', 'in', 'order', 'limit', 'ilike', 'not']) {
      b[m] = () => b;
    }
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      h.selects.push(table);
      return Promise.resolve({ data: rowsFor(table), error: null }).then(res, rej);
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
      functions: { invoke: async (name: string) => { h.invokes.push(name); return { data: { ok: true, added: 0, removed: 0 }, error: null }; } },
      channel: (topic: string) => {
        const entry = { topic, cb: null as ((p: Record<string, unknown>) => void) | null, removed: false };
        h.channels.push(entry);
        const ch = {
          on: (_e: string, _f: unknown, cb: (p: Record<string, unknown>) => void) => { entry.cb = cb; return ch; },
          subscribe: () => ch,
          __entry: entry,
        };
        return ch;
      },
      removeChannel: (ch: { __entry: { removed: boolean } }) => { ch.__entry.removed = true; return Promise.resolve('ok'); },
      auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    },
  };
});
vi.mock('@/utils/idle', () => ({
  runWhenIdle: (fn: () => void) => { fn(); return () => {}; },
  runAfter: (_ms: number, fn: () => void) => { fn(); return () => {}; },
  onFirstInteraction: (fn: () => void) => { fn(); return () => {}; },
}));
vi.mock('@/utils/pausableInterval', () => ({ setPausableInterval: () => () => {} }));
vi.mock('@/hooks/useUserServices', async (orig) => {
  const real = await orig<typeof import('@/hooks/useUserServices')>();
  return { ...real, useMyUserServices: () => ({ customerId: null, devices: [], services: [], loading: false, refetch: async () => {}, ensureLoaded: () => {} }) };
});

import { appAlertsQuery } from '@/lib/appAlertsStore';
import { featureFlagsQuery } from '@/lib/featureFlagStore';
import { useAppAlerts } from '@/hooks/useAppAlerts';
import { useBroadcastAlert } from '@/hooks/useBroadcastAlert';
import { usePreEventAlert } from '@/hooks/usePreEventAlert';
import { usePlayerServerAlert } from '@/hooks/usePlayerServerAlert';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { usePlayerFlagSync } from '@/hooks/usePlayerFlagSync';
import { useAppData, __resetAppDataForTests } from '@/hooks/useAppData';
import { playerFlag } from '@/lib/playerFlags';

const settle = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };
const live = (prefix: string) => h.channels.filter((c) => c.topic.startsWith(prefix) && !c.removed);

beforeEach(() => {
  appAlertsQuery.__reset();
  featureFlagsQuery.__reset();
  __resetAppDataForTests();
  localStorage.clear();
  h.selects = []; h.invokes = []; h.channels = [];
  h.alertRows = [
    { id: 'a1', app_match: 'Kodi', title: 'Kodi down', message: 'm', severity: 'warning', active: true, source: 'admin', created_at: '', updated_at: '2026-01-01' },
    { id: 'b1', app_match: 'all', title: 'Hello all', message: 'm', severity: 'info', active: true, source: 'admin', created_at: '', updated_at: '2026-01-02' },
    { id: 'p1', app_match: 'Vibez', title: 'Vibez notice', message: 'm', severity: 'critical', active: true, source: 'player_server', created_at: '', updated_at: '2026-01-03' },
    { id: 'e1', app_match: '__pre_event__', title: 'PPV Tonight', message: 'm', severity: 'critical', active: false, source: 'pre_event', created_at: '', updated_at: '2026-01-04' },
  ];
  h.flagRows = [{ key: 'giveaway_enabled', enabled: true }, { key: 'video_surface_view', enabled: false }];
  h.appRows = [{ id: 'x', name: 'Kodi', is_available: true, is_featured: false, category: 'main' }];
});

describe('app_alerts: one read for every alert surface', () => {
  it('four hooks, two of them twice: one select, one channel, each hook its own rows', async () => {
    const a = renderHook(() => useAppAlerts());
    const a2 = renderHook(() => useAppAlerts());
    const b = renderHook(() => useBroadcastAlert());
    const p = renderHook(() => usePreEventAlert());
    const s = renderHook(() => usePlayerServerAlert('Vibez'));
    await settle();

    expect(h.selects.filter((t) => t === 'app_alerts')).toHaveLength(1);
    expect(live('app_alerts_changes')).toHaveLength(1);
    expect(a.result.current.getAlertForApp('Kodi 21')?.id).toBe('a1');
    expect(a.result.current.getAlertForApp('anything')).toBeNull(); // 'all' is a boot popup only
    expect(a.result.current.alerts.map((x) => x.id)).not.toContain('e1'); // off
    expect(b.result.current.alert?.id).toBe('b1');
    expect(p.result.current.row).toMatchObject({ id: 'e1', active: false, title: 'PPV Tonight' });
    expect(s.result.current.alert?.id).toBe('p1');
    a2.unmount(); b.unmount(); p.unmount(); s.unmount(); a.unmount();
  });

  it('the channel survives one subscriber unmounting, and a change reaches the others', async () => {
    const a = renderHook(() => useAppAlerts());
    const b = renderHook(() => useAppAlerts());
    await settle();
    a.unmount();
    expect(live('app_alerts_changes')).toHaveLength(1);

    h.alertRows = [...h.alertRows, { id: 'a2', app_match: 'Plex', title: 'Plex', message: 'm', severity: 'info', active: true, source: 'admin', created_at: '', updated_at: '2026-01-05' }];
    await act(async () => { live('app_alerts_changes')[0].cb?.({ eventType: 'INSERT' }); });
    await settle();
    expect(b.result.current.getAlertForApp('Plex')?.id).toBe('a2');

    b.unmount();
    expect(live('app_alerts_changes')).toHaveLength(0);
  });

  it('a refetch during a read is followed by one more read (a write is never missed)', async () => {
    const a = renderHook(() => useAppAlerts());
    await settle();
    h.selects = [];
    await act(async () => { await Promise.all([appAlertsQuery.refetch(), appAlertsQuery.refetch(), appAlertsQuery.refetch()]); });
    expect(h.selects.filter((t) => t === 'app_alerts')).toHaveLength(2);
    a.unmount();
  });
});

describe('feature_flags: one read for every flag', () => {
  it('three flags + the player switches: one select, one channel', async () => {
    const g = renderHook(() => useFeatureFlag('giveaway_enabled', false));
    const p = renderHook(() => useFeatureFlag('player_enabled', true));
    const r = renderHook(() => useFeatureFlag('review_prompt', true));
    const s = renderHook(() => usePlayerFlagSync());
    await settle();

    expect(h.selects.filter((t) => t === 'feature_flags')).toHaveLength(1);
    expect(live('feature_flags')).toHaveLength(1);
    expect(g.result.current.enabled).toBe(true);
    expect(p.result.current.enabled).toBe(true); // no row: the default
    expect(playerFlag('video_surface_view')).toBe(false);
    g.unmount(); p.unmount(); r.unmount(); s.unmount();
  });

  it('two components on the same flag: one unmounting leaves the other its channel', async () => {
    const a = renderHook(() => useFeatureFlag('giveaway_enabled', false));
    const b = renderHook(() => useFeatureFlag('giveaway_enabled', false));
    await settle();
    a.unmount();
    expect(live('feature_flags')).toHaveLength(1);
    act(() => { live('feature_flags')[0].cb?.({ eventType: 'UPDATE', new: { key: 'giveaway_enabled', enabled: false }, old: {} }); });
    expect(b.result.current.enabled).toBe(false);
    b.unmount();
    expect(live('feature_flags')).toHaveLength(0);
  });
});

describe('app catalog: one loader', () => {
  it('three screens: one select, one sync call, the same array for all', async () => {
    const a = renderHook(() => useAppData());
    const b = renderHook(() => useAppData());
    const c = renderHook(() => useAppData());
    await settle();
    await settle();
    expect(h.selects.filter((t) => t === 'apps')).toHaveLength(1);
    expect(h.invokes.filter((n) => n === 'sync-apps-from-php')).toHaveLength(1);
    expect(a.result.current.apps.map((x) => x.name)).toEqual(['Kodi']);
    expect(b.result.current.apps).toBe(a.result.current.apps);
    expect(c.result.current.apps).toBe(a.result.current.apps);

    // Back on a screen later: the catalog stands, no new sync.
    a.unmount(); b.unmount(); c.unmount();
    const d = renderHook(() => useAppData());
    await settle();
    expect(h.invokes.filter((n) => n === 'sync-apps-from-php')).toHaveLength(1);
    expect(h.selects.filter((t) => t === 'apps')).toHaveLength(1);
    d.unmount();
  });
});
