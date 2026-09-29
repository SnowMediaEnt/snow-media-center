// The full-screen channel's control bar (PlayerControlBar): which buttons it
// has and in what order, which of them are greyed out, what they are called,
// and how the D-pad steps along them. One place, so the bar that is drawn and
// the key handler in LiveSection (which moves the highlight and acts on OK)
// can't drift apart. Kept free of React so the rules can be tested alone.

export type BarControlId =
  | 'prev' | 'rew' | 'play' | 'fwd' | 'golive' | 'next'
  | 'rec' | 'cc' | 'audio' | 'vol' | 'stats';

export interface LiveBarContext {
  /** The stream can seek (a live channel rarely can). */
  seekable: boolean;
  /** Rewind live TV is on for this channel (on-box buffer or panel catch-up). */
  rewind: boolean;
  /** The channel can be recorded here (native app, not Kids, not demo). */
  record: boolean;
}

/**
 * The buttons, left to right. Stats is always last.
 * - Plain: previous channel, back 10 s, play/pause, forward 10 s, next channel,
 *   subtitles, audio, volume, stats. Back / forward stay in the row but are
 *   greyed out unless the stream can seek (nothing changes for a bar without
 *   rewind).
 * - Rewind on: Go live joins after forward 10 s.
 * - Record on: Record follows next channel.
 * All eleven fit the 960 px screen (w-12 buttons, w-16 Play, about 680 px).
 */
export function liveBarOrder(ctx: Pick<LiveBarContext, 'rewind' | 'record'>): BarControlId[] {
  return [
    'prev', 'rew', 'play', 'fwd',
    ...(ctx.rewind ? (['golive'] as BarControlId[]) : []),
    'next',
    ...(ctx.record ? (['rec'] as BarControlId[]) : []),
    'cc', 'audio', 'vol', 'stats',
  ];
}

/**
 * Buttons that are greyed out and skipped by ◀ ▶: back / forward when there
 * is nothing to seek in (rewind on always has something), subtitles and audio
 * when the stream has no choice to offer.
 */
export function liveBarDisabled(
  id: BarControlId,
  s: Pick<LiveBarContext, 'seekable' | 'rewind'> & { subtitles: number; audios: number },
): boolean {
  if (id === 'rew' || id === 'fwd') return !s.seekable && !s.rewind;
  if (id === 'golive') return !s.rewind;
  if (id === 'cc') return s.subtitles === 0;
  if (id === 'audio') return s.audios <= 1;
  return false;
}

export interface LiveBarLabelState {
  isPaused: boolean;
  /** This channel is being recorded now. */
  recording?: boolean;
  /** The stats panel is showing. */
  statsOn?: boolean;
  /** Volume, in percent: the volume button names it. */
  volumePct?: number;
}

/**
 * The name a button carries: its aria-label and hover title, and the line the
 * bar shows under the highlighted button. It follows the button's state
 * (Pause/Play, Stop recording, the volume level).
 */
export function liveBarLabel(id: BarControlId, s: LiveBarLabelState): string {
  switch (id) {
    case 'prev': return 'Previous channel';
    case 'next': return 'Next channel';
    case 'rew': return 'Back 10s';
    case 'fwd': return 'Forward 10s';
    case 'golive': return 'Go live';
    case 'rec': return s.recording ? 'Stop recording' : 'Record';
    case 'play': return s.isPaused ? 'Play' : 'Pause';
    case 'cc': return 'Subtitles';
    case 'audio': return 'Audio';
    case 'vol': return s.volumePct == null ? 'Volume' : `Volume ${Math.round(s.volumePct)}%`;
    case 'stats': return s.statsOn ? 'Hide stats' : 'Stats';
    default: return '';
  }
}

/**
 * The next button left (-1) or right (+1) of `cur`, skipping disabled ones.
 * Stops at either end. A focus no longer in the row (Go live after rewind
 * turned off, Record after the channel changed) lands on Play.
 */
export function moveBarFocus(
  order: BarControlId[],
  cur: BarControlId,
  dir: 1 | -1,
  disabled: (id: BarControlId) => boolean,
): BarControlId {
  const at = order.indexOf(cur);
  if (at < 0) return order.includes('play') ? 'play' : (order[0] ?? cur);
  for (let step = 1; step <= order.length; step++) {
    const next = at + dir * step;
    if (next < 0 || next >= order.length) return cur;
    const cand = order[next];
    if (!disabled(cand)) return cand;
  }
  return cur;
}
