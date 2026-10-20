// Down channels: which Live TV channels aren't working right now, from what
// every box sees (see the channel-status edge function). A channel row shows
// ⚠️ when its "host|stream_id" is in the list.
//
// Light on purpose: while Live TV (its list, the Guide, Game Day) is on
// screen the box asks for the list of down channels on its own lines — a
// handful of short keys — every minute, only while the app is on screen, and
// not while a stream plays on a low-memory box (quiet mode) or full screen
// (the caller passes `active`). And when the viewer opens a channel, a list
// older than OPEN_FRESH_MS is asked for again first (openWhenFresh, waiting
// OPEN_WAIT_MS at most), so a channel marked a minute ago warns before it
// plays.
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
// And a channel OFF THE AIR (migration 20261020120000): a box asked for its
// stream and the provider said it isn't there (HTTP 404 / 410, or 5xx again
// and again) before any picture. One such box marks it down for everyone at
// once, until a box plays it fine ('ok', after 12 s) or a viewer says it
// works ('clear'); 7 days at most. It shows as "Off the air" (an older
// server, or an older app, shows it as down).
// All of them live in ONE set of keys, so a screen holds one thing:
//   "host|stream_id"      the channel is down
//   "host|off:<stream_id>" …and it is down because it is off the air
//   "host|cat:<id>"       the category is down
//   "host|buf:<stream_id>" the channel was reported buffering
//
// A service the viewer added from elsewhere (lib/outsideSource) is not ours:
// its host is never sent here (no list, no signals, no reports), so its
// channels never show a down or buffering mark.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getDeviceId } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';
import { normalizeHost } from '@/lib/favoritesSync';
import type { XtreamCreds } from '@/lib/xtream';
import { lineReportFields } from '@/lib/lineInfo';
import { isOutsideHost, isOutsideLine } from '@/lib/outsideSource';
import { setPausableInterval } from '@/utils/pausableInterval';

export const POLL_MS = 60_000;
/** Opening a channel: a list older than this is asked for again first… */
export const OPEN_FRESH_MS = 15_000;
/** …waiting this long at most: playback is never held up longer. */
export const OPEN_WAIT_MS = 1_000;
const SIGNAL_EVERY_MS = 10 * 60_000;
/** A viewer's own report or clear: only a double press is dropped. */
const MANUAL_EVERY_MS = 5_000;
/** The server never sends more; a longer list is a flood, not an outage,
 *  and is ignored (the last good list stays). */
export const MAX_DOWN_CHANNELS = 500;
export const MAX_BUFFERING_CHANNELS = 500;
export const MAX_DOWN_CATEGORIES = 100;
export const MAX_OFFAIR_CHANNELS = 500;
export const CHANNEL_STATUS_EVENT = 'smc-channel-status:changed';

export const channelStatusKey = (host: string, streamId: number): string => `${normalizeHost(host)}|${streamId}`;
export const categoryStatusKey = (host: string, categoryId: string | number): string => `${normalizeHost(host)}|cat:${categoryId}`;
export const bufferingStatusKey = (host: string, streamId: number): string => `${normalizeHost(host)}|buf:${streamId}`;
export const offairStatusKey = (host: string, streamId: number): string => `${normalizeHost(host)}|off:${streamId}`;

/** What the others said about a channel: off the air (a box got the
 *  provider's "not here"), down (a viewer's report, two boxes' failures, or
 *  the admin), its whole category down, reported buffering, or nothing. */
export type ChannelReport = 'offair' | 'down' | 'category' | 'buffering' | null;

let down = new Set<string>();
let hostsKey = '';
let fetchedAt = 0;
/** The lines the screen on show asks about (useDownChannels), whether or
 *  not a list came back yet: what openWhenFresh asks for. */
let wantedHosts: string[] = [];
/** When openWhenFresh last asked: offline (or the server slow), the next
 *  channels opened in the same OPEN_FRESH_MS don't each wait again. */
let openAskedAt = 0;
let inflight: Promise<void> | null = null;
let inflightKey = '';
/** A different set of lines asked while a list was on its way. */
let nextKey = '';

const emit = () => { try { window.dispatchEvent(new CustomEvent(CHANNEL_STATUS_EVENT)); } catch { /* ignore */ } };

async function refresh(allHosts: string[], force = false): Promise<void> {
  const hosts = allHosts.filter((h) => !isOutsideHost(h));
  if (!hosts.length) return;
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
      const r = data as { ok?: boolean; down?: unknown; buffering?: unknown; categories?: unknown; offair?: unknown } | null;
      if (!r?.ok || !Array.isArray(r.down) || r.down.length > MAX_DOWN_CHANNELS) return;
      // Older servers send down channels only.
      const buffering = Array.isArray(r.buffering) ? r.buffering : [];
      const categories = Array.isArray(r.categories) ? r.categories : [];
      const offair = Array.isArray(r.offair) ? r.offair : [];
      if (buffering.length > MAX_BUFFERING_CHANNELS || categories.length > MAX_DOWN_CATEGORIES || offair.length > MAX_OFFAIR_CHANNELS) return;
      // The lines asked about get this answer; another screen's lines (the
      // Guide asks for its one service, the list for all) keep theirs.
      const asked = new Set(hosts);
      const next = new Set([...down].filter((k) => !asked.has(k.slice(0, k.lastIndexOf('|')))));
      for (const k of r.down) next.add(String(k));
      // "host|id" from the server → this box's prefixed keys.
      const split = (k: unknown): [string, string] | null => {
        const s = String(k);
        const at = s.lastIndexOf('|');
        return at > 0 && at < s.length - 1 ? [s.slice(0, at), s.slice(at + 1)] : null;
      };
      for (const k of buffering) { const p = split(k); if (p) next.add(`${p[0]}|buf:${p[1]}`); }
      for (const k of categories) { const p = split(k); if (p) next.add(`${p[0]}|cat:${p[1]}`); }
      // Off the air: down too, whatever the down list says.
      for (const k of offair) { const p = split(k); if (p) { next.add(`${p[0]}|${p[1]}`); next.add(`${p[0]}|off:${p[1]}`); } }
      hostsKey = key; fetchedAt = Date.now();
      const same = next.size === down.size && [...next].every((k) => down.has(k));
      down = next;
      if (!same) emit();
    } catch { /* offline: keep the last list */ } finally { inflight = null; }
  })();
  return inflight;
}

/** The down channels on these lines, kept fresh while `active`. */
export function useDownChannels(lines: Array<Pick<XtreamCreds, 'host'> & Partial<Pick<XtreamCreds, 'outside' | 'm3u'>>>, active: boolean): Set<string> {
  const [set, setSet] = useState(down);
  const hosts = [...new Set(lines.filter((l) => !isOutsideLine(l)).map((l) => normalizeHost(l.host)).filter(Boolean))].sort();
  const hostsSig = hosts.join(',');
  useEffect(() => {
    const on = () => setSet(down);
    window.addEventListener(CHANNEL_STATUS_EVENT, on);
    return () => window.removeEventListener(CHANNEL_STATUS_EVENT, on);
  }, []);
  useEffect(() => {
    if (!active || !hostsSig || isDemo()) return;
    const hs = hostsSig.split(',');
    wantedHosts = hs;
    const tick = () => { if (document.visibilityState !== 'hidden') void refresh(hs); };
    tick();
    const stop = setPausableInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { stop(); document.removeEventListener('visibilitychange', tick); };
  }, [active, hostsSig]);
  return set;
}

/**
 * Before a channel opens (OK in a list, the Guide, a search, Recently
 * watched, Game Day, Multi-Screen): `go` runs once the list is fresh, so a
 * channel marked a minute ago is warned about before it plays. At once when
 * the list is younger than OPEN_FRESH_MS (or there is none to ask: the demo,
 * an outside service, no Live TV screen asked yet); else after a fresh list,
 * or after OPEN_WAIT_MS at most, whichever comes first. Never throws; `go`
 * runs exactly once.
 *
 * `go` gets the list as it stands when it was asked for again (newer than
 * what the screen last drew: check the channel against this one), or null
 * when nothing was asked (what the screen holds is current).
 */
export function openWhenFresh(host: string, go: (fresh: Set<string> | null) => void): void {
  const h = normalizeHost(host || '');
  const hosts = [...new Set([...wantedHosts, h])].filter((x) => x && !isOutsideHost(x)).sort();
  const now = Date.now();
  const fresh = now - fetchedAt < OPEN_FRESH_MS && !!hostsKey && hosts.every((x) => hostsKey.split(',').includes(x));
  if (isDemo() || !wantedHosts.length || !h || isOutsideHost(h) || fresh || now - openAskedAt < OPEN_FRESH_MS) { go(null); return; }
  openAskedAt = now;
  let done = false;
  const once = () => { if (done) return; done = true; window.clearTimeout(timer); go(down); };
  const timer = window.setTimeout(once, OPEN_WAIT_MS);
  refresh(hosts, true).then(once, once);
}

/** Down: reported down itself (off the air included), or (given its
 *  category) its whole category is. */
export const isChannelDown = (set: Set<string>, host: string, streamId: number, categoryId?: string | number | null): boolean =>
  set.size > 0 && (set.has(channelStatusKey(host, streamId)) || set.has(offairStatusKey(host, streamId))
    || (categoryId != null && categoryId !== '' && set.has(categoryStatusKey(host, categoryId))));

/** Off the air (its provider said the stream isn't there). */
export const isChannelOffAir = (set: Set<string>, host: string, streamId: number): boolean =>
  set.size > 0 && set.has(offairStatusKey(host, streamId));

export const isCategoryDown = (set: Set<string>, host: string, categoryId: string | number | null | undefined): boolean =>
  set.size > 0 && categoryId != null && categoryId !== '' && set.has(categoryStatusKey(host, categoryId));

/** Reported buffering (whatever else is said about it). */
export const isChannelBuffering = (set: Set<string>, host: string, streamId: number): boolean =>
  set.size > 0 && set.has(bufferingStatusKey(host, streamId));

/** The one thing to show for a channel. Off the air outranks a down report
 *  (it says why); down outranks buffering; its own down report outranks its
 *  category's. */
export function channelReport(set: Set<string>, host: string, streamId: number, categoryId?: string | number | null): ChannelReport {
  if (set.size === 0) return null;
  if (set.has(offairStatusKey(host, streamId))) return 'offair';
  if (set.has(channelStatusKey(host, streamId))) return 'down';
  if (isCategoryDown(set, host, categoryId)) return 'category';
  if (set.has(bufferingStatusKey(host, streamId))) return 'buffering';
  return null;
}

/** Whether a native player error is the channel's fault. This box's own
 *  audio decoder failing (AUDIO_DECODE, common with Dolby audio on cheap
 *  boxes), its picture never starting while the sound played (NO_PICTURE:
 *  its decoder or surface, on an X96 say), or a load the player refused on
 *  the device before any stream was asked for (no code) says nothing about
 *  the channel. */
export const isChannelFailure = (error: { code?: string } | null | undefined): boolean =>
  !!error?.code && error.code !== 'AUDIO_DECODE' && error.code !== 'NO_PICTURE';

const lastSent = new Map<string, number>();

const changed = (next: Set<string>) => { down = next; emit(); };
const reportFields = (line: XtreamCreds | undefined) => (line ? lineReportFields(line).catch(() => null) : Promise.resolve(null));

export type ChannelSignal = 'down' | 'fail' | 'ok' | 'clear' | 'buffering' | 'offair';

/** Tell the others: 'down' (a viewer reported it), 'buffering' (a viewer
 *  reported it buffering), 'clear' (a viewer says it works: ends all of
 *  them), 'fail' (it didn't start here), 'offair' (it didn't start here
 *  because its provider answered `httpStatus`, 404 / 410 / 5xx: marks it for
 *  everyone at once), 'ok' (a channel shown as down or off the air played
 *  fine here; buffering stays). */
export function signalChannel(host: string, streamId: number, name: string, kind: ChannelSignal, line?: XtreamCreds, httpStatus?: number | null): void {
  if (isDemo() || !host || !(streamId > 0)) return;
  if (isOutsideHost(host) || isOutsideLine(line)) return;
  // A box that is offline can't tell a dead channel from its own connection.
  if ((kind === 'fail' || kind === 'offair') && typeof navigator !== 'undefined' && navigator.onLine === false) return;
  // Off the air needs the provider's own answer, a status number.
  if (kind === 'offair' && !(Number.isInteger(httpStatus) && (httpStatus as number) >= 400 && (httpStatus as number) <= 599)) return;
  const key = channelStatusKey(host, streamId);
  const buf = bufferingStatusKey(host, streamId);
  const off = offairStatusKey(host, streamId);
  // Off the air shows here at once, even when the signal itself waits (a
  // second failure within ten minutes): this box just saw it.
  if (kind === 'offair' && !(down.has(key) && down.has(off))) changed(new Set(down).add(key).add(off));
  const k = `${key}|${kind}`;
  const now = Date.now();
  const manual = kind === 'down' || kind === 'clear' || kind === 'buffering';
  if (now - (lastSent.get(k) ?? 0) < (manual ? MANUAL_EVERY_MS : SIGNAL_EVERY_MS)) return;
  lastSent.set(k, now);
  // Off the air and "played fine" undo each other: each lets the other go
  // again at once (a channel back on, then off again, within ten minutes).
  if (kind === 'offair') lastSent.delete(`${key}|ok`);
  if (kind === 'ok' || kind === 'clear') lastSent.delete(`${key}|offair`);
  // Show this box's own answer straight away.
  if (kind === 'ok' && (down.has(key) || down.has(off))) { const n = new Set(down); n.delete(key); n.delete(off); changed(n); }
  if (kind === 'clear' && (down.has(key) || down.has(buf) || down.has(off))) { const n = new Set(down); n.delete(key); n.delete(buf); n.delete(off); changed(n); }
  if (kind === 'down' && !down.has(key)) changed(new Set(down).add(key));
  if (kind === 'buffering' && !down.has(buf)) changed(new Set(down).add(buf));
  // A viewer's report carries who sent it for the Hub: the line's username
  // and connections (lib/lineInfo, ~3 s at most; never the password).
  // Off the air carries the status number only (never the address).
  void (manual && kind !== 'clear' ? reportFields(line) : Promise.resolve(null)).then((who) => supabase.functions.invoke('channel-status', {
    body: {
      op: 'signal', host: normalizeHost(host), stream_id: streamId, name: name.slice(0, 200), kind, device_id: getDeviceId(),
      ...(kind === 'offair' ? { http_status: httpStatus } : {}), ...(who ?? {}),
    },
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
  if (isOutsideHost(host) || isOutsideLine(line)) return;
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
export function __setDownForTests(keys: string[]): void { down = new Set(keys); hostsKey = ''; fetchedAt = 0; nextKey = ''; wantedHosts = []; openAskedAt = 0; lastSent.clear(); emit(); }
