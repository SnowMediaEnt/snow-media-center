// Live TV's preview box, held on the channel being watched (TV remote,
// Classic and Compact). A customer coming from TiviMate wanted to look
// through the list without losing what he was watching; the owner made it
// automatic rather than a setting:
//
// - Nothing on (Live TV just opened, nothing watched yet this visit): the box
//   follows the highlight as it always has (LiveSection's preview dwell), and
//   OK goes full screen.
// - Back from watching a channel full screen, that channel stays in the box
//   ("held"): moving the highlight no longer changes it. The info panel still
//   describes the highlighted channel; the box says what is playing when the
//   two differ. OK on another channel plays that one in the box (now the one
//   held); OK on the one in the box goes full screen, on the same stream.
//
// A channel put in the box with OK is the one being watched, as upright on a
// phone (LiveSection's onRowActivate): it plays with sound, goes into Recently
// watched after the usual few seconds, its row shows LIVE, and one the others
// reported down asks first (Watch anyway plays it in the box). OK on it again
// then only goes full screen (LiveSection's fullScreen: the same stream, not
// played or counted a second time, and not asked about again).
//
// Recently watched (▶) still goes straight to full screen while a channel is
// held: it is "switch to that channel" wherever it is opened (over the
// picture too), not browsing the list, and the way back holds it in the box
// like any channel watched full screen.
//
// What lets go of it (the box follows the highlight again):
// - leaving Live TV: the section is unmounted, the next visit starts with
//   nothing on;
// - the held channel failing to play in the box (`release`: LiveSection, on
//   the native player's error for that very stream or the web preview's; it
//   also stops counting it as watched): a box stuck on an error would hide
//   every other channel's preview;
// - its service going (the account removed, another sign-in): it can't play;
// - no box any more: a layout without one (Vibez), or a touch screen, whose
//   taps already put channels in the box (tapToBox). Switching between
//   Classic and Compact keeps it: the same box, the same channel on.
// Changing category, searching, Recently watched, the categories drawer and
// the side menu keep it: looking around is the point.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { XtreamCreds, XtreamLiveStream } from '@/lib/xtream';
import { lineKey } from '@/lib/favoritesSync';

export interface HeldPreviewOptions {
  /** The remote with a preview box on screen: not a touch screen, not Vibez,
   *  not a box without a preview. */
  on: boolean;
  previewChannel: XtreamLiveStream | null;
  setPreviewChannel: (st: XtreamLiveStream) => void;
  fullscreen: boolean;
  /** The channel being watched, null when none is. */
  playingStream: XtreamLiveStream | null;
  lineFor: (st: XtreamLiveStream) => XtreamCreds;
  /** Plays it where the box is, counted as watching (playChannel with inBox). */
  play: (st: XtreamLiveStream) => void;
  /** Full screen (activateChannel). */
  fullScreen: (st: XtreamLiveStream) => void;
  /** Asks first for a channel the others reported down: true when it did (the
   *  warning is up; its Watch anyway calls `playInBox`). */
  askFirst: (st: XtreamLiveStream) => boolean;
  /** The services signed in here: a held channel whose service went is let go. */
  lines: XtreamCreds[];
}

export interface HeldPreview {
  /** A channel is held in the box. */
  held: boolean;
  /** The same, for key handlers bound once. */
  isHeld: () => boolean;
  /** OK on a channel row while held: into the box, or full screen when it is there. */
  ok: (st: XtreamLiveStream) => void;
  /** Into the box and held, without asking (Watch anyway on the warning). */
  playInBox: (st: XtreamLiveStream) => void;
  /** Lets go: the box follows the highlight again. */
  release: () => void;
}

export function useHeldPreview(opts: HeldPreviewOptions): HeldPreview {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const { on, fullscreen, playingStream, previewChannel, lines } = opts;
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  const hold = useCallback((v: boolean) => { heldRef.current = v; setHeld(v); }, []);

  const playInBox = useCallback((st: XtreamLiveStream) => {
    const o = optsRef.current;
    hold(true);
    o.setPreviewChannel(st);
    o.play(st);
  }, [hold]);

  const ok = useCallback((st: XtreamLiveStream) => {
    const o = optsRef.current;
    const inBox = o.previewChannel;
    if (inBox && inBox.stream_id === st.stream_id && lineKey(o.lineFor(inBox)) === lineKey(o.lineFor(st))) {
      o.fullScreen(st);
      return;
    }
    if (o.askFirst(st)) return;
    playInBox(st);
  }, [playInBox]);

  const isHeld = useCallback(() => heldRef.current && optsRef.current.on, []);
  const release = useCallback(() => { if (heldRef.current) hold(false); }, [hold]);

  // Watching full screen: the box (not drawn meanwhile) takes the channel on
  // screen, a zap with CH+ / CH- included, and holds it for the way back. Set
  // here rather than on the way out, so the first frame back already has it:
  // the native player keeps the same stream and only the picture moves.
  useEffect(() => {
    if (!on || !fullscreen || !playingStream) return;
    optsRef.current.setPreviewChannel(playingStream);
    hold(true);
  }, [on, fullscreen, playingStream, hold]);

  // No box any more (Vibez, a touch screen): nothing to hold.
  useEffect(() => { if (!on) release(); }, [on, release]);

  // Its service went (an account removed, another one signed in): it can't
  // play any more.
  const heldLine = held && previewChannel ? lineKey(opts.lineFor(previewChannel)) : null;
  useEffect(() => {
    if (heldLine && !lines.some((l) => lineKey(l) === heldLine)) release();
  }, [heldLine, lines, release]);

  return { held: held && on, isHeld, ok, playInBox, release };
}
