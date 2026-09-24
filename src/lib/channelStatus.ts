// Down channels: which Live TV channels aren't working right now, from what
// every box sees (see the channel-status edge function). A channel row shows
// ⚠️ when its "host|stream_id" is in the list.
//
// Light on purpose: while Live TV is open the box asks for the list of down
// channels on its own lines — a handful of short keys — every two minutes,
// only while the app is on screen, and not while a stream plays on a
// low-memory box (quiet mode) or full screen (the caller passes `active`).
//
// One viewer's "Channel down" report marks it for every box (for up to three
// hours); a viewer holding OK on it and choosing "It's working now" clears it
// for everyone, as does a box that plays it fine. Two boxes where it failed
// to start also mark it. The box's own report or clear shows at once; the
// automatic signals go at most once per channel every ten minutes.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getDeviceId } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';
import { normalizeHost } from '@/lib/favoritesSync';
import type { XtreamCreds } from '@/lib/xtream';
import { setPausableInterval } from '@/utils/pausableInterval';

const POLL_MS = 2 * 60_000;
const SIGNAL_EVERY_MS = 10 * 60_000;
/** A viewer's own report or clear: only a double press is dropped. */
const MANUAL_EVERY_MS = 5_000;
/** The server never sends more; a longer list is a flood, not an outage,
 *  and is ignored (the last good list stays). */
export const MAX_DOWN_CHANNELS = 500;
export const CHANNEL_STATUS_EVENT = 'smc-channel-status:changed';

export const channelStatusKey = (host: string, streamId: number): string => `${normalizeHost(host)}|${streamId}`;

let down = new Set<string>();
let hostsKey = '';
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
let inflightKey = '';
/** A different set of lines asked while a list was on its way. */
let nextKey = '';

const emit = () => { try { window.dispatchEvent(new CustomEvent(CHANNEL_STATUS_EVENT)); } catch { /* ignore */ } };

async function refresh(hosts: string[], force = false): Promise<void> {
  const key = hosts.join(',');
  if (!force && key === hostsKey && Date.now() - fetchedAt < POLL_MS - 5_000) return;
  if (inflight) {
    if (inflightKey === key) return inflight;
    // The lines changed while the list was on its way (the saved lines load
    // just after the first one): ask again for the new set once it lands,
    // and don't let the old answer replace the list meanwhile.
    nextKey = key;
    return inflight.then(() => refresh(hosts, force));
  }
  inflightKey = key;
  nextKey = '';
  inflight = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke('channel-status', { body: { op: 'list', hosts } });
      if (nextKey && nextKey !== key) return;
      if (error) return;
      const r = data as { ok?: boolean; down?: unknown } | null;
      if (!r?.ok || !Array.isArray(r.down) || r.down.length > MAX_DOWN_CHANNELS) return;
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
    const stop = setPausableInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { stop(); document.removeEventListener('visibilitychange', tick); };
  }, [active, hostsSig]);
  return set;
}

export const isChannelDown = (set: Set<string>, host: string, streamId: number): boolean =>
  set.size > 0 && set.has(channelStatusKey(host, streamId));

/** Whether a native player error is the channel's fault. This box's own
 *  audio decoder failing (AUDIO_DECODE, common with Dolby audio on cheap
 *  boxes) or a load the player refused on the device before any stream was
 *  asked for (no code) says nothing about the channel. */
export const isChannelFailure = (error: { code?: string } | null | undefined): boolean =>
  !!error?.code && error.code !== 'AUDIO_DECODE';

const lastSent = new Map<string, number>();

/** Tell the others: 'down' (a viewer reported it), 'clear' (a viewer says
 *  it works), 'fail' (it didn't start here), 'ok' (a channel shown as down
 *  played fine here). */
export function signalChannel(host: string, streamId: number, name: string, kind: 'down' | 'fail' | 'ok' | 'clear'): void {
  if (isDemo() || !host || !(streamId > 0)) return;
  // A box that is offline can't tell a dead channel from its own connection.
  if (kind === 'fail' && typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const k = `${channelStatusKey(host, streamId)}|${kind}`;
  const now = Date.now();
  const manual = kind === 'down' || kind === 'clear';
  if (now - (lastSent.get(k) ?? 0) < (manual ? MANUAL_EVERY_MS : SIGNAL_EVERY_MS)) return;
  lastSent.set(k, now);
  const key = channelStatusKey(host, streamId);
  // Show this box's own answer straight away.
  if ((kind === 'ok' || kind === 'clear') && down.delete(key)) { down = new Set(down); emit(); }
  if (kind === 'down' && !down.has(key)) { down = new Set(down).add(key); emit(); }
  void supabase.functions.invoke('channel-status', {
    body: { op: 'signal', host: normalizeHost(host), stream_id: streamId, name: name.slice(0, 200), kind, device_id: getDeviceId() },
  }).then(() => {
    // A report can tip a channel over: look again soon.
    if (kind !== 'ok' && hostsKey) window.setTimeout(() => { void refresh(hostsKey.split(','), true); }, 5_000);
  }, () => undefined);
}

/** Tests only. */
export function __setDownForTests(keys: string[]): void { down = new Set(keys); hostsKey = ''; fetchedAt = 0; nextKey = ''; lastSent.clear(); emit(); }
