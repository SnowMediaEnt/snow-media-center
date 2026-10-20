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
 * - Event slots ("PPV 1", "NFL Game 3", a PPV / Events category's) are
 *   never switched or offered: each provider has a different event there.
 * - Nothing new goes to any server. The only requests are the other line's
 *   channel lists (the ones search and the categories ask for), and only
 *   after a failure, with the switch on and not on a low-memory box; at most
 *   one whole line-up per failure (see findOnLines).
 *
 * LiveSection owns playing; this only says what to play. It hands in what
 * the native player shows (`watching`) and the player's error.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import i18n from '@/i18n';
import { toast } from '@/hooks/use-toast';
import { trackEvent } from '@/lib/analytics';
import { isChannelFailure } from '@/lib/channelStatus';
import { channelKey, findSameChannel, isEventChannel } from '@/lib/channelMatch';
import { loadFailoverOn, noteLiveLineCount } from '@/lib/channelFailover';
import { lineKey } from '@/lib/favoritesSync';
import { lineChannelKey as chKey, lineLabel } from '@/lib/liveLines';
import { hasLiveStreams, serverDisplayName, type XtreamCategory, type XtreamCreds, type XtreamLiveStream } from '@/lib/xtream';

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
  /** A line's channel list, whole or one category's (xtream's getLiveStreams, kept for the visit). */
  fetchAll: (line: XtreamCreds, categoryId?: string) => Promise<XtreamLiveStream[]>;
  /** A whole list already in hand (search's), so nothing is asked for. */
  known?: (line: XtreamCreds) => XtreamLiveStream[] | undefined;
  /** A category's list already in hand (the pane's). */
  knownCategory?: (line: XtreamCreds, categoryId: string) => XtreamLiveStream[] | undefined;
  /** A line's categories, as listed. */
  categoriesOf?: (line: XtreamCreds) => XtreamCategory[] | undefined;
  /** The name of the category a stream is in on its line. */
  categoryName?: (st: XtreamLiveStream, line: XtreamCreds) => string | undefined;
  /** Channels never offered (a hidden category's, adult ones). */
  skip?: (st: XtreamLiveStream, line: XtreamCreds) => boolean;
  /** The line a stream from a list belongs to (LiveSection's lineFor). */
  lineOf: (st: XtreamLiveStream) => XtreamCreds;
  /** Play this, full screen or in the box. */
  play: (to: LineChannel, where: FailoverWhere) => void;
  /** The box held the copy and the failover is forgotten: put the viewer's own channel back in it. */
  release?: (original: LineChannel) => void;
  /** Live TV has the remote. Leaving it forgets the failed channel. */
  active?: boolean;
  /** The demo: never. */
  off?: boolean;
}

export interface ChannelFailover {
  /** The service the error screen offers ("Vibez"), or null. */
  offer: string | null;
  /** That button's words: "Try on Vibez", or "Try on your other DreamStreams line". */
  offerLabel: string | null;
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
  offer: null, offerLabel: null, focus: 'retry', triedBoth: null, looking: false,
  tryOffer: noop, onKey: () => false, redirect: () => null, standInIndex: () => -1,
};

/** How a service is named to the viewer (the group header's name, brand-spelled). */
const serviceName = (line: XtreamCreds): string => serverDisplayName(lineLabel(line));

// ---- looking a channel up on another line ---------------------------------

// A whole line-up is 10-50 MB to download and parse, then kept (xtream's live
// catalogue) while the player starts the copy. So: never on a low-memory box
// (only lists already in hand there), never with the switch off (the button
// is offered from lists in hand only), at most one whole line-up per failure,
// and the channel's own category on the other line (same name, a small list)
// is tried first. A line whose whole line-up this downloaded is not
// downloaded again for 10 minutes.
const REFETCH_MS = 10 * 60_000;
const fetchedAt = new Map<string, number>();

const lowMemoryBox = (): boolean => {
  try { return document.documentElement.classList.contains('native-low-memory'); } catch { return false; }
};
const kept = (line: XtreamCreds, categoryId?: string): boolean => {
  try { return hasLiveStreams(line, categoryId); } catch { return false; }
};
const settle = <T,>(p: Promise<T>): Promise<T | null> => p.then((v) => v, () => null);
const filled = (list: XtreamLiveStream[] | null | undefined): XtreamLiveStream[] | null => (list && list.length ? list : null);

/** The category on `line` named as the channel's own is ("Sports"), or null. */
function sameCategoryId(line: XtreamCreds, categoryName: string | undefined, opts: FailoverOptions): string | null {
  const want = categoryName ? channelKey(categoryName).key : '';
  if (!want) return null;
  const cat = opts.categoriesOf?.(line)?.find((c) => channelKey(c.category_name).key === want);
  return cat ? String(cat.category_id) : null;
}

/**
 * The viewer's channel on one of `lines`, the first that has it, in the
 * order given. The channel's own line gives the channel itself (going back
 * to it needs no lookup). Null when none has it, and always for an event
 * slot. `mayDownload`: lists not in hand may be asked for (see above).
 */
async function findOnLines(original: LineChannel, lines: XtreamCreds[], opts: FailoverOptions, mayDownload: boolean): Promise<LineChannel | null> {
  const ownKey = lineKey(original.line);
  const ownCategory = opts.categoryName?.(original.stream, original.line);
  if (isEventChannel(original.stream.name, ownCategory)) return null;
  let wholeLeft = mayDownload ? 1 : 0;
  for (const line of lines) {
    if (lineKey(line) === ownKey) return { stream: original.stream, line: original.line };
    const skip = opts.skip;
    const look = (list: XtreamLiveStream[] | null): LineChannel | null => {
      const hit = list ? findSameChannel(original.stream, list, {
        skip: skip ? (st) => skip(st, line) : undefined,
        categoryOf: (st) => opts.categoryName?.(st, line),
      }) : null;
      return hit ? { stream: hit, line } : null;
    };
    // The whole line-up in hand (search's, or xtream's kept copy) answers for this line.
    const whole = filled(opts.known?.(line)) ?? (kept(line) ? filled(await settle(opts.fetchAll(line))) : null);
    if (whole) {
      const hit = look(whole);
      if (hit) return hit;
      continue;
    }
    // The channel's own category there: in hand, else asked for (small).
    const catId = sameCategoryId(line, ownCategory, opts);
    if (catId) {
      const inHand = filled(opts.knownCategory?.(line, catId)) ?? (kept(line, catId) ? filled(await settle(opts.fetchAll(line, catId))) : null);
      const hit = look(inHand ?? (mayDownload ? filled(await settle(opts.fetchAll(line, catId))) : null));
      if (hit) return hit;
    }
    // The whole line-up, downloaded: once per failure.
    const k = lineKey(line);
    if (wholeLeft > 0 && Date.now() - (fetchedAt.get(k) ?? 0) >= REFETCH_MS) {
      wholeLeft--;
      fetchedAt.set(k, Date.now());
      const hit = look(filled(await settle(opts.fetchAll(line))));
      if (hit) return hit;
    }
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
  /** Lookups done, by the line that failed (and whether downloads were allowed). */
  found: Map<string, LineChannel | null>;
}

interface View {
  offer: LineChannel | null;
  /** The line that failed, the one "Try on…" is away from. */
  from: XtreamCreds | null;
  focus: 'retry' | 'offer';
  triedBoth: string | null;
  looking: boolean;
}
const EMPTY_VIEW: View = { offer: null, from: null, focus: 'retry', triedBoth: null, looking: false };

/** Nothing on screen for this long (the Recordings screen, a layout without a box): the failed channel is forgotten. */
const FORGET_MS = 3000;

// Two lines on one service ("DreamStreams" and "DreamStreams") are named as
// "your other DreamStreams line", not "from DreamStreams" on DreamStreams.
const sameService = (a: XtreamCreds, b: XtreamCreds): boolean => serviceName(a) === serviceName(b);
const noteText = (channel: string, from: XtreamCreds, to: XtreamCreds): string => (sameService(from, to)
  ? i18n.t('live.failover.noteSameService', { channel, service: serviceName(from) })
  : i18n.t('live.failover.note', { channel, service: serviceName(from), other: serviceName(to) }));
const triedBothText = (channel: string, a: XtreamCreds, b: XtreamCreds): string => (sameService(a, b)
  ? i18n.t('live.failover.triedBothSameService', { channel, service: serviceName(a) })
  : i18n.t('live.failover.triedBoth', { channel, service: serviceName(a), other: serviceName(b) }));
const tryOnText = (from: XtreamCreds | null, to: XtreamCreds): string => (from && sameService(from, to)
  ? i18n.t('live.failover.tryOnSameService', { service: serviceName(to) })
  : i18n.t('live.failover.tryOn', { other: serviceName(to) }));

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
  const active = opts.active !== false;

  // Forget the failed channel. A box that held its copy gets the viewer's own
  // channel back, so it is tried afresh the next time it is on screen (it may
  // well be back) instead of the box quietly keeping the other service's.
  const forget = useCallback(() => {
    const p = pickRef.current;
    if (!p) return;
    pickRef.current = null;
    setView(EMPTY_VIEW);
    if (p.where === 'box' && p.copy && p.curKey === chKey(p.copy.line, p.copy.stream.stream_id)) optsRef.current.release?.(p.original);
  }, [setView]);
  // Leaving Live TV, or nothing on screen for a while.
  useEffect(() => { if (!active) forget(); }, [active, forget]);
  useEffect(() => {
    if (watchKey || !active) return;
    const t = window.setTimeout(forget, FORGET_MS);
    return () => window.clearTimeout(t);
  }, [watchKey, active, forget]);

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
    try { toast({ title: noteText(p.original.stream.name, from, to.line), duration: 5000 }); } catch { /* ignore */ }
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
    const triedBoth = other ? triedBothText(pick.original.stream.name, pick.original.line, other) : null;
    const switchOn = loadFailoverOn() && !pick.autoUsed;
    setView({ offer: null, from: cur.line, focus: 'retry', triedBoth, looking: switchOn });

    // Lines not yet tried first, in the pane's order; then the ones that
    // failed already (going back is the viewer's call, by the button).
    const tried = new Set(pick.tried.map((l) => lineKey(l)));
    const order = o.lines.filter((l) => lineKey(l) !== failedKey);
    order.sort((a, b) => Number(tried.has(lineKey(a))) - Number(tried.has(lineKey(b))));
    const mayDownload = switchOn && !lowMemoryBox();
    const foundKey = `${failedKey}|${mayDownload}`;
    const lookup = pick.found.has(foundKey)
      ? Promise.resolve(pick.found.get(foundKey) ?? null)
      : findOnLines(pick.original, order, o, mayDownload).catch(() => null);
    void lookup.then((to) => {
      pick.found.set(foundKey, to);
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

  // ◀ ▶ belong to the two buttons while both are shown (they no longer open
  // the channel list or Recently watched from behind the error).
  const onKey = useCallback((e: KeyboardEvent): boolean => {
    const v = viewRef.current;
    if (!v.offer) return false;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const focus = e.key === 'ArrowRight' ? 'offer' : 'retry';
      if (v.focus !== focus) setView({ ...v, focus });
      return true;
    }
    if ((e.key === 'Enter' || e.key === ' ') && v.focus === 'offer') { if (!e.repeat) tryOffer(); return true; }
    return false;
  }, [setView, tryOffer]);

  // Picking the failed channel while its copy plays (in the box, full screen,
  // over the picture): the copy, already playing, so nothing restarts.
  const redirect = useCallback((st: XtreamLiveStream): XtreamLiveStream | null => {
    const p = pickRef.current;
    if (!p || !p.copy || p.curKey !== chKey(p.copy.line, p.copy.stream.stream_id)) return null;
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
    offerLabel: view.offer ? tryOnText(view.from, view.offer.line) : null,
    focus: view.offer ? view.focus : 'retry',
    triedBoth: view.triedBoth,
    looking: view.looking,
    tryOffer,
    onKey,
    redirect,
    standInIndex,
  }), [view, tryOffer, onKey, redirect, standInIndex]);
}
