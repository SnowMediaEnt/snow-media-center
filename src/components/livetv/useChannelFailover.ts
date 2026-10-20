/**
 * When a channel is down, play it from the viewer's other service.
 *
 * A box often has two lines (a DreamStreams line and a Vibez line, say), and
 * the same channel is usually on both. When the channel being watched (full
 * screen, or in the preview box) fails to start, this looks the same channel
 * up on the other lines (lib/channelMatch) and, the first time, tunes it
 * there by itself with a short note. Rules:
 * - One automatic switch per channel the viewer picked: if the copy fails
 *   too, the normal error screen shows, saying it was tried on both. No
 *   ping-pong between two dead copies.
 * - The error screen offers "Try on <service>" when a copy exists but the
 *   switch is off (Settings › Playback) or already used. Retry stays.
 * - Reporting stays as it was: LiveSection signals the failed channel on its
 *   own line; the copy is a different stream on a different line.
 * - Nothing new goes to any server. The only request is the other line's
 *   channel list (the one search and "All channels" ask for), and only after
 *   a failure; xtream keeps it for the visit (see listOf for the rest).
 *
 * LiveSection owns playing; this only says what to play. It hands in what
 * the native player shows (`watching`) and the player's error.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import i18n from '@/i18n';
import { toast } from '@/hooks/use-toast';
import { trackEvent } from '@/lib/analytics';
import { isChannelFailure } from '@/lib/channelStatus';
import { findSameChannel } from '@/lib/channelMatch';
import { loadFailoverOn, noteLiveLineCount } from '@/lib/channelFailover';
import { lineKey } from '@/lib/favoritesSync';
import { lineLabel } from '@/lib/liveLines';
import { hasLiveStreams, serverDisplayName, type XtreamCreds, type XtreamLiveStream } from '@/lib/xtream';

export type FailoverWhere = 'full' | 'box';

export interface LineChannel {
  stream: XtreamLiveStream;
  line: XtreamCreds;
}

/** What the native player is showing, and where. */
export interface FailoverWatch extends LineChannel {
  where: FailoverWhere;
}

export interface FailoverOptions {
  lines: XtreamCreds[];
  watching: FailoverWatch | null;
  /** The native player's error (useNativePlayer). */
  error: { code?: string; message?: string } | null;
  /** A line's whole channel list (xtream's getLiveStreams, kept for the visit). */
  fetchAll: (line: XtreamCreds) => Promise<XtreamLiveStream[]>;
  /** A whole list already in hand (search's), so nothing is asked for. */
  known?: (line: XtreamCreds) => XtreamLiveStream[] | undefined;
  /** Channels never offered (a hidden category's, adult ones). */
  skip?: (st: XtreamLiveStream, line: XtreamCreds) => boolean;
  /** The line a stream from a list belongs to (LiveSection's lineFor). */
  lineOf: (st: XtreamLiveStream) => XtreamCreds;
  /** Play this, full screen or in the box. */
  play: (to: LineChannel, where: FailoverWhere) => void;
  /** The demo: never. */
  off?: boolean;
}

export interface ChannelFailover {
  /** The service the error screen offers ("Try on Vibez"), or null. */
  offer: string | null;
  /** Which of the error screen's buttons the remote is on. */
  focus: 'retry' | 'offer';
  /** "ESPN didn't play on DreamStreams or on Vibez.", once both failed. */
  triedBoth: string | null;
  /** Looking for a copy to switch to (the error screen says so). */
  looking: boolean;
  /** The "Try on…" button. */
  tryOffer: () => void;
  /** Keys on the error screen: ◀ ▶ between Retry and "Try on…", OK on it. True when used. */
  onKey: (e: KeyboardEvent) => boolean;
  /** OK on the channel whose copy the preview box shows: that copy (null otherwise). */
  redirect: (st: XtreamLiveStream) => XtreamLiveStream | null;
  /** While a copy plays full screen: where the viewer's own channel is in `list`, else -1. */
  standInIndex: (list: XtreamLiveStream[]) => number;
}

const noop = () => {};
export const IDLE_FAILOVER: ChannelFailover = {
  offer: null, focus: 'retry', triedBoth: null, looking: false,
  tryOffer: noop, onKey: () => false, redirect: () => null, standInIndex: () => -1,
};

/** How a service is named to the viewer (the group header's name, brand-spelled). */
const serviceName = (line: XtreamCreds): string => serverDisplayName(lineLabel(line));
const chKey = (line: XtreamCreds, id: number): string => `${lineKey(line)}|${id}`;

// ---- looking a channel up on another line ---------------------------------

// A whole line-up is megabytes. xtream keeps it once asked for (free to ask
// again), but a small box drops kept lists early; asking the panel for it on
// every failure would be a full download each time. So a list this had to
// download is not downloaded again for this long: a failure in between finds
// nothing on that line and shows the error as before.
const REFETCH_MS = 10 * 60_000;
const fetchedAt = new Map<string, number>();

/** For tests: forget the downloads made. */
export function __resetFailoverForTests(): void { fetchedAt.clear(); }

async function listOf(line: XtreamCreds, opts: FailoverOptions): Promise<XtreamLiveStream[] | null> {
  const known = opts.known?.(line);
  if (known && known.length) return known;
  const k = lineKey(line);
  let kept = false;
  try { kept = hasLiveStreams(line); } catch { /* ignore */ }
  if (!kept) {
    if (Date.now() - (fetchedAt.get(k) ?? 0) < REFETCH_MS) return null;
    fetchedAt.set(k, Date.now());
  }
  try { return await opts.fetchAll(line); } catch { return null; }
}

/**
 * The viewer's channel on one of `lines`, the first that has it, in the
 * order given. The channel's own line gives the channel itself (going back
 * to it needs no lookup). Null when none has it.
 */
async function findOnLines(original: LineChannel, lines: XtreamCreds[], opts: FailoverOptions): Promise<LineChannel | null> {
  const ownKey = lineKey(original.line);
  for (const line of lines) {
    if (lineKey(line) === ownKey) return { stream: original.stream, line: original.line };
    const list = await listOf(line, opts);
    if (!list) continue;
    const skip = opts.skip;
    const hit = findSameChannel(original.stream, list, { skip: skip ? (st) => skip(st, line) : undefined });
    if (hit) return { stream: hit, line };
  }
  return null;
}

// ---- the hook --------------------------------------------------------------

/** One channel the viewer picked, and what became of it. */
interface Pick {
  original: LineChannel;
  origKey: string;
  /** What plays under this pick now (the original, or the copy). */
  curKey: string;
  /** What this just asked LiveSection to play: arriving, it is still this pick. */
  expectKey: string | null;
  where: FailoverWhere;
  /** The other service's copy it went to (by itself or by the button). */
  copy: LineChannel | null;
  autoUsed: boolean;
  /** The lines it failed on, in order. */
  tried: XtreamCreds[];
  reported: boolean;
  /** Bumped per failure: an older lookup's answer is dropped. */
  gen: number;
  /** Lookups done, by the line that failed. */
  found: Map<string, LineChannel | null>;
}

interface View {
  offer: LineChannel | null;
  focus: 'retry' | 'offer';
  triedBoth: string | null;
  looking: boolean;
}
const EMPTY_VIEW: View = { offer: null, focus: 'retry', triedBoth: null, looking: false };

export function useChannelFailover(opts: FailoverOptions): ChannelFailover {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const pickRef = useRef<Pick | null>(null);
  const [view, setViewState] = useState<View>(EMPTY_VIEW);
  const viewRef = useRef(view);
  const setView = useCallback((v: View) => { viewRef.current = v; setViewState(v); }, []);

  // The settings page offers the switch only with more than one line.
  const lineCount = opts.lines.length;
  useEffect(() => { if (!opts.off) noteLiveLineCount(lineCount); }, [lineCount, opts.off]);

  const w = opts.watching;
  const watchKey = w ? chKey(w.line, w.stream.stream_id) : '';
  const watchWhere = w?.where ?? null;
  const watchKeyRef = useRef(watchKey);
  watchKeyRef.current = watchKey;
  const errorRef = useRef(opts.error);
  errorRef.current = opts.error;

  // Something else on screen ends the pick. Not: what this just started (the
  // copy, or the original again from the button), the same stream moving
  // between the box and full screen, or nothing on screen for a moment.
  useEffect(() => {
    const p = pickRef.current;
    const cur = optsRef.current.watching;
    if (!p || !watchKey || !cur) return;
    if (watchKey === p.curKey || watchKey === p.expectKey) {
      p.curKey = watchKey;
      p.expectKey = null;
      p.where = cur.where;
      return;
    }
    // Back from full screen on the copy, the list highlights the viewer's own
    // channel and the box starts it: the box keeps the copy instead of
    // starting again the channel that just failed.
    const copyKey = p.copy ? chKey(p.copy.line, p.copy.stream.stream_id) : '';
    if (cur.where === 'box' && watchKey === p.origKey && p.copy && p.curKey === copyKey) {
      p.expectKey = copyKey;
      optsRef.current.play(p.copy, 'box');
      return;
    }
    pickRef.current = null;
    setView(EMPTY_VIEW);
  }, [watchKey, watchWhere, setView]);

  // Switch to `to`: by itself (`auto`, with the note) or by the button.
  const go = useCallback((p: Pick, to: LineChannel, auto: boolean, from: XtreamCreds) => {
    const toKey = chKey(to.line, to.stream.stream_id);
    if (toKey !== p.origKey) p.copy = to;
    p.expectKey = toKey;
    setView(EMPTY_VIEW);
    optsRef.current.play(to, p.where);
    if (!auto) return;
    try {
      toast({
        title: i18n.t('live.failover.note', { channel: p.original.stream.name, service: serviceName(from), other: serviceName(to.line) }),
        duration: 5000,
      });
    } catch { /* ignore */ }
  }, [setView]);

  // A channel that won't start (not an audio warning, not buffering: see
  // isChannelFailure). Keyed on the error itself, never on what is on
  // screen: for one render after a channel change the last channel's error
  // is still there, and the new channel has not failed.
  useEffect(() => {
    const err = opts.error;
    const o = optsRef.current;
    const cur = o.watching;
    if (!isChannelFailure(err) || !cur || o.off || o.lines.length < 2) return;
    const key = chKey(cur.line, cur.stream.stream_id);
    let p = pickRef.current;
    if (!p || (key !== p.curKey && key !== p.expectKey)) {
      p = {
        original: { stream: cur.stream, line: cur.line }, origKey: key, curKey: key, expectKey: null, where: cur.where,
        copy: null, autoUsed: false, tried: [], reported: false, gen: 0, found: new Map(),
      };
      pickRef.current = p;
    }
    const pick = p;
    pick.curKey = key;
    pick.expectKey = null;
    const failedKey = lineKey(cur.line);
    if (!pick.tried.some((l) => lineKey(l) === failedKey)) pick.tried.push(cur.line);
    const gen = ++pick.gen;
    const other = pick.tried.find((l) => lineKey(l) !== lineKey(pick.original.line));
    const triedBoth = other
      ? i18n.t('live.failover.triedBoth', { channel: pick.original.stream.name, service: serviceName(pick.original.line), other: serviceName(other) })
      : null;
    setView({ offer: null, focus: 'retry', triedBoth, looking: loadFailoverOn() && !pick.autoUsed });

    // Lines not yet tried first, in the pane's order; then the ones that
    // failed already (going back is the viewer's call, by the button).
    const tried = new Set(pick.tried.map((l) => lineKey(l)));
    const order = o.lines.filter((l) => lineKey(l) !== failedKey);
    order.sort((a, b) => Number(tried.has(lineKey(a))) - Number(tried.has(lineKey(b))));
    const lookup = pick.found.has(failedKey)
      ? Promise.resolve(pick.found.get(failedKey) ?? null)
      : findOnLines(pick.original, order, o).catch(() => null);
    void lookup.then((to) => {
      pick.found.set(failedKey, to);
      if (pickRef.current !== pick || pick.gen !== gen) return;
      // Only while that very failure is on screen: Retry pressed meanwhile,
      // or another channel, and the viewer has taken over.
      const still = errorRef.current === err && watchKeyRef.current === key;
      const auto = !!to && still && loadFailoverOn() && !pick.autoUsed && !tried.has(lineKey(to.line));
      if (!pick.reported) {
        pick.reported = true;
        try { trackEvent('live_failover', 'player', { found: !!to, auto }); } catch { /* ignore */ }
      }
      if (auto && to) {
        pick.autoUsed = true;
        go(pick, to, true, cur.line);
        return;
      }
      setView({ ...viewRef.current, offer: to, looking: false });
    });
  }, [opts.error, go, setView]);

  const tryOffer = useCallback(() => {
    const p = pickRef.current;
    const to = viewRef.current.offer;
    if (!p || !to) return;
    go(p, to, false, optsRef.current.watching?.line ?? p.original.line);
  }, [go]);

  const onKey = useCallback((e: KeyboardEvent): boolean => {
    const v = viewRef.current;
    if (!v.offer) return false;
    if (e.key === 'ArrowRight' && v.focus === 'retry') { setView({ ...v, focus: 'offer' }); return true; }
    if (e.key === 'ArrowLeft' && v.focus === 'offer') { setView({ ...v, focus: 'retry' }); return true; }
    if ((e.key === 'Enter' || e.key === ' ') && v.focus === 'offer') { if (!e.repeat) tryOffer(); return true; }
    return false;
  }, [setView, tryOffer]);

  const redirect = useCallback((st: XtreamLiveStream): XtreamLiveStream | null => {
    const p = pickRef.current;
    if (!p || !p.copy || p.where !== 'box' || p.curKey !== chKey(p.copy.line, p.copy.stream.stream_id)) return null;
    return chKey(optsRef.current.lineOf(st), st.stream_id) === p.origKey ? p.copy.stream : null;
  }, []);

  const standInIndex = useCallback((list: XtreamLiveStream[]): number => {
    const p = pickRef.current;
    if (!p || !p.copy || p.curKey !== chKey(p.copy.line, p.copy.stream.stream_id)) return -1;
    const lineOf = optsRef.current.lineOf;
    return list.findIndex((st) => st.stream_id === p.original.stream.stream_id && chKey(lineOf(st), st.stream_id) === p.origKey);
  }, []);

  return useMemo<ChannelFailover>(() => ({
    offer: view.offer ? serviceName(view.offer.line) : null,
    focus: view.offer ? view.focus : 'retry',
    triedBoth: view.triedBoth,
    looking: view.looking,
    tryOffer,
    onKey,
    redirect,
    standInIndex,
  }), [view, tryOffer, onKey, redirect, standInIndex]);
}
