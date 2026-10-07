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
//
// Two more kinds of report ride on the same list (migration 20261007060000):
//   * a whole category reported down: every channel in it counts as down
//     (the box knows which channels are in which category; the server only
//     keeps the category id). Same three hours, same clear.
//   * a channel reported buffering: an amber mark and a warning before it
//     plays, for two hours. Down outranks it. Only a viewer's clear (or the
//     admin) ends it early: a box playing it fine for a few seconds says
//     little about buffering.
// All of them live in ONE set of keys, so a screen holds one thing:
//   "host|stream_id"      the channel is down
//   "host|cat:<id>"       the category is down
//   "host|buf:<stream_id>" the channel was reported buffering
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getDeviceId } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';
import { normalizeHost } from '@/lib/favoritesSync';
import type { XtreamCreds } from '@/lib/xtream';
import { lineReportFields } from '@/lib/lineInfo';
import { setPausableInterval } from '@/utils/pausableInterval';

const POLL_MS = 2 * 60_000;
const SIGNAL_EVERY_MS = 10 * 60_000;
/** A viewer's own report or clear: only a double press is dropped. */
const MANUAL_EVERY_MS = 5_000;
/** The server never sends more; a longer list is a flood, not an outage,
 *  and is ignored (the last good list stays). */
export const MAX_DOWN_CHANNELS = 500;
export const MAX_BUFFERING_CHANNELS = 500;
export const MAX_DOWN_CATEGORIES = 100;
export const CHANNEL_STATUS_EVENT = 'smc-channel-status:changed';

export const channelStatusKey = (host: string, streamId: number): string => `${normalizeHost(host)}|${streamId}`;
export const categoryStatusKey = (host: string, categoryId: string | number): string => `${normalizeHost(host)}|cat:${categoryId}`;
export const bufferingStatusKey = (host: string, streamId: number): string => `${normalizeHost(host)}|buf:${streamId}`;

/** What the others said about a channel: down (its own report, or the
 *  admin), its whole category down, reported buffering, or nothing. */
export type ChannelReport = 'down' | 'category' | 'buffering' | null;

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
      const r = data as { ok?: boolean; down?: unknown; buffering?: unknown; categories?: unknown } | null;
      if (!r?.ok || !Array.isArray(r.down) || r.down.length > MAX_DOWN_CHANNELS) return;
      // Older servers send down channels only.
      const buffering = Array.isArray(r.buffering) ? r.buffering : [];
      const categories = Array.isArray(r.categories) ? r.categories : [];
      if (buffering.length > MAX_BUFFERING_CHANNELS || categories.length > MAX_DOWN_CATEGORIES) return;
      const next = new Set(r.down.map(String));
      // "host|id" from the server → this box's prefixed keys.
      const split = (k: unknown): [string, string] | null => {
        const s = String(k);
        const at = s.lastIndexOf('|');
        return at > 0 && at < s.length - 1 ? [s.slice(0, at), s.slice(at + 1)] : null;
      };
      for (const k of buffering) { const p = split(k); if (p) next.add(`${p[0]}|buf:${p[1]}`); }
      for (const k of categories) { const p = split(k); if (p) next.add(`${p[0]}|cat:${p[1]}`); }
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

/** Down: reported down itself, or (given its category) its whole category is. */
export const isChannelDown = (set: Set<string>, host: string, streamId: number, categoryId?: string | number | null): boolean =>
  set.size > 0 && (set.has(channelStatusKey(host, streamId))
    || (categoryId != null && categoryId !== '' && set.has(categoryStatusKey(host, categoryId))));

export const isCategoryDown = (set: Set<string>, host: string, categoryId: string | number | null | undefined): boolean =>
  set.size > 0 && categoryId != null && categoryId !== '' && set.has(categoryStatusKey(host, categoryId));

/** Reported buffering (whatever else is said about it). */
export const isChannelBuffering = (set: Set<string>, host: string, streamId: number): boolean =>
  set.size > 0 && set.has(bufferingStatusKey(host, streamId));

/** The one thing to show for a channel. Down outranks buffering; its own
 *  down report outranks its category's. */
export function channelReport(set: Set<string>, host: string, streamId: number, categoryId?: string | number | null): ChannelReport {
  if (set.size === 0) return null;
  if (set.has(channelStatusKey(host, streamId))) return 'down';
  if (isCategoryDown(set, host, categoryId)) return 'category';
  if (set.has(bufferingStatusKey(host, streamId))) return 'buffering';
  return null;
}

/** Whether a native player error is the channel's fault. This box's own
 *  audio decoder failing (AUDIO_DECODE, common with Dolby audio on cheap
 *  boxes) or a load the player refused on the device before any stream was
 *  asked for (no code) says nothing about the channel. */
export const isChannelFailure = (error: { code?: string } | null | undefined): boolean =>
  !!error?.code && error.code !== 'AUDIO_DECODE';

const lastSent = new Map<string, number>();

const changed = (next: Set<string>) => { down = next; emit(); };
const reportFields = (line: XtreamCreds | undefined) => (line ? lineReportFields(line).catch(() => null) : Promise.resolve(null));

/** Tell the others: 'down' (a viewer reported it), 'buffering' (a viewer
 *  reported it buffering), 'clear' (a viewer says it works: ends both),
 *  'fail' (it didn't start here), 'ok' (a channel shown as down played fine
 *  here; buffering stays). */
export function signalChannel(host: string, streamId: number, name: string, kind: 'down' | 'fail' | 'ok' | 'clear' | 'buffering', line?: XtreamCreds): void {
  if (isDemo() || !host || !(streamId > 0)) return;
  // A box that is offline can't tell a dead channel from its own connection.
  if (kind === 'fail' && typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const k = `${channelStatusKey(host, streamId)}|${kind}`;
  const now = Date.now();
  const manual = kind === 'down' || kind === 'clear' || kind === 'buffering';
  if (now - (lastSent.get(k) ?? 0) < (manual ? MANUAL_EVERY_MS : SIGNAL_EVERY_MS)) return;
  lastSent.set(k, now);
  const key = channelStatusKey(host, streamId);
  const buf = bufferingStatusKey(host, streamId);
  // Show this box's own answer straight away.
  if (kind === 'ok' && down.has(key)) { const n = new Set(down); n.delete(key); changed(n); }
  if (kind === 'clear' && (down.has(key) || down.has(buf))) { const n = new Set(down); n.delete(key); n.delete(buf); changed(n); }
  if (kind === 'down' && !down.has(key)) changed(new Set(down).add(key));
  if (kind === 'buffering' && !down.has(buf)) changed(new Set(down).add(buf));
  // A viewer's report carries who sent it for the Hub: the line's username
  // and connections (lib/lineInfo, ~3 s at most; never the password).
  void (manual && kind !== 'clear' ? reportFields(line) : Promise.resolve(null)).then((who) => supabase.functions.invoke('channel-status', {
    body: { op: 'signal', host: normalizeHost(host), stream_id: streamId, name: name.slice(0, 200), kind, device_id: getDeviceId(), ...(who ?? {}) },
  })).then(() => {
    // A report can tip a channel over: look again soon.
    if (kind !== 'ok' && hostsKey) window.setTimeout(() => { void refresh(hostsKey.split(','), true); }, 5_000);
  }, () => undefined);
}

/** The same for a whole category: 'down' (a viewer reported every channel
 *  in it down), 'clear' (a viewer says it works), 'ok' (one of its channels
 *  played fine here, so it is not all down). */
export function signalCategory(host: string, categoryId: string | number, name: string, kind: 'down' | 'clear' | 'ok', line?: XtreamCreds): void {
  const id = String(categoryId ?? '');
  if (isDemo() || !host || !id) return;
  const key = categoryStatusKey(host, id);
  const k = `${key}|${kind}`;
  const now = Date.now();
  if (now - (lastSent.get(k) ?? 0) < (kind === 'ok' ? SIGNAL_EVERY_MS : MANUAL_EVERY_MS)) return;
  lastSent.set(k, now);
  if ((kind === 'ok' || kind === 'clear') && down.has(key)) { const n = new Set(down); n.delete(key); changed(n); }
  if (kind === 'down' && !down.has(key)) changed(new Set(down).add(key));
  void (kind === 'down' ? reportFields(line) : Promise.resolve(null)).then((who) => supabase.functions.invoke('channel-status', {
    body: { op: 'signal_category', host: normalizeHost(host), category_id: id, name: name.slice(0, 200), kind, device_id: getDeviceId(), ...(who ?? {}) },
  })).then(() => {
    if (kind !== 'ok' && hostsKey) window.setTimeout(() => { void refresh(hostsKey.split(','), true); }, 5_000);
  }, () => undefined);
}

/** Tests only. */
export function __setDownForTests(keys: string[]): void { down = new Set(keys); hostsKey = ''; fetchedAt = 0; nextKey = ''; lastSent.clear(); emit(); }
