// Down channels: which Live TV channels aren't working right now, from what
// every box sees (see the channel-status edge function). A channel row shows
// ⚠️ when its "host|stream_id" is in the list.
//
// Light on purpose: while Live TV is open the box asks for the list of down
// channels on its own lines — a handful of short keys — every three minutes,
// and only while the app is on screen. It sends a signal when a viewer reports
// a channel down, when a channel fails to start, and when a channel shown as
// down plays fine; each at most once per channel every ten minutes.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getDeviceId } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';
import { normalizeHost } from '@/lib/favoritesSync';
import type { XtreamCreds } from '@/lib/xtream';

const POLL_MS = 3 * 60_000;
const SIGNAL_EVERY_MS = 10 * 60_000;
export const CHANNEL_STATUS_EVENT = 'smc-channel-status:changed';

export const channelStatusKey = (host: string, streamId: number): string => `${normalizeHost(host)}|${streamId}`;

let down = new Set<string>();
let hostsKey = '';
let fetchedAt = 0;
let inflight: Promise<void> | null = null;

const emit = () => { try { window.dispatchEvent(new CustomEvent(CHANNEL_STATUS_EVENT)); } catch { /* ignore */ } };

async function refresh(hosts: string[], force = false): Promise<void> {
  const key = hosts.join(',');
  if (!force && key === hostsKey && Date.now() - fetchedAt < POLL_MS - 5_000) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke('channel-status', { body: { op: 'list', hosts } });
      if (error) return;
      const r = data as { ok?: boolean; down?: unknown } | null;
      if (!r?.ok || !Array.isArray(r.down)) return;
      const next = new Set(r.down.map(String));
      hostsKey = key; fetchedAt = Date.now();
      const same = next.size === down.size && [...next].every((k) => down.has(k));
      down = next;
      if (!same) emit();
    } catch { /* offline: keep the last list */ } finally { inflight = null; }
  })();
  return inflight;
}

/** The down channels on these lines, kept fresh while `active`. */
export function useDownChannels(lines: Pick<XtreamCreds, 'host'>[], active: boolean): Set<string> {
  const [set, setSet] = useState(down);
  const hosts = [...new Set(lines.map((l) => normalizeHost(l.host)).filter(Boolean))].sort();
  const hostsSig = hosts.join(',');
  useEffect(() => {
    const on = () => setSet(down);
    window.addEventListener(CHANNEL_STATUS_EVENT, on);
    return () => window.removeEventListener(CHANNEL_STATUS_EVENT, on);
  }, []);
  useEffect(() => {
    if (!active || !hostsSig || isDemo()) return;
    const hs = hostsSig.split(',');
    const tick = () => { if (document.visibilityState !== 'hidden') void refresh(hs); };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [active, hostsSig]);
  return set;
}

export const isChannelDown = (set: Set<string>, host: string, streamId: number): boolean =>
  set.size > 0 && set.has(channelStatusKey(host, streamId));

const lastSent = new Map<string, number>();

/** Tell the others: 'down' (a viewer reported it), 'fail' (it didn't start
 *  here), 'ok' (a channel shown as down played fine here). */
export function signalChannel(host: string, streamId: number, name: string, kind: 'down' | 'fail' | 'ok'): void {
  if (isDemo() || !host || !(streamId > 0)) return;
  // A box that is offline can't tell a dead channel from its own connection.
  if (kind === 'fail' && typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const k = `${channelStatusKey(host, streamId)}|${kind}`;
  const now = Date.now();
  if (now - (lastSent.get(k) ?? 0) < SIGNAL_EVERY_MS) return;
  lastSent.set(k, now);
  const key = channelStatusKey(host, streamId);
  if (kind === 'ok' && down.delete(key)) emit();
  void supabase.functions.invoke('channel-status', {
    body: { op: 'signal', host: normalizeHost(host), stream_id: streamId, name: name.slice(0, 200), kind, device_id: getDeviceId() },
  }).then(() => {
    // A report can tip a channel over: look again soon.
    if (kind !== 'ok' && hostsKey) window.setTimeout(() => { void refresh(hostsKey.split(','), true); }, 5_000);
  }, () => undefined);
}

/** Tests only. */
export function __setDownForTests(keys: string[]): void { down = new Set(keys); lastSent.clear(); emit(); }
