// The control bar over a Live TV film or episode (VodControlBar): which
// buttons it has, which are greyed out and what they are called. The live
// channel bar's rules (liveBar.ts) with a film's buttons: no channels, no
// Go live, no Record; back 10 s / forward 30 s like Plex and the remote's
// media keys, and Next episode for a series. Kept free of React so the rules
// can be tested alone.
import i18n from '@/i18n';
import { liveBarDisabled, liveBarLabel, type BarControlId, type LiveBarLabelState } from './liveBar';

export type VodBarId = Extract<BarControlId, 'rew' | 'play' | 'fwd' | 'next' | 'cc' | 'audio' | 'vol' | 'stats'>;

/** Seconds the back / forward buttons (and ◀ ▶ with the bar hidden) jump. */
export const VOD_BACK_SEC = 10;
export const VOD_FWD_SEC = 30;

/**
 * The buttons, left to right: back 10 s, play/pause, forward 30 s, next
 * episode (a series), subtitles, audio, volume, stats (the native player).
 * Fixed for the life of the player: Next episode on the last episode greys
 * out in its slot instead of leaving, so nothing moves under the highlight.
 */
export function vodBarOrder(ctx: { next: boolean; stats: boolean }): VodBarId[] {
  return [
    'rew', 'play', 'fwd',
    ...(ctx.next ? (['next'] as VodBarId[]) : []),
    'cc', 'audio', 'vol',
    ...(ctx.stats ? (['stats'] as VodBarId[]) : []),
  ];
}

/** Greyed out and skipped by ◀ ▶: Next on the last episode, and subtitles /
 *  audio when the film has nothing to choose from (the live bar's rule). */
export function vodBarDisabled(id: VodBarId, s: { subtitles: number; audios: number; hasNext: boolean }): boolean {
  if (id === 'next') return !s.hasNext;
  if (id === 'cc' || id === 'audio') return liveBarDisabled(id, { seekable: true, rewind: false, subtitles: s.subtitles, audios: s.audios });
  return false;
}

/** The button's name (aria-label, and the line under the highlighted one). */
export function vodBarLabel(id: VodBarId, s: LiveBarLabelState): string {
  const t = i18n.t.bind(i18n);
  if (id === 'rew') return t('plex.player.back10');
  if (id === 'fwd') return t('plex.player.forward30');
  if (id === 'next') return t('live.vod.nextEpisode');
  return liveBarLabel(id, s);
}
