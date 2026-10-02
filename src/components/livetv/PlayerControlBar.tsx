import { memo, useEffect, useRef, useState } from 'react';
import {
  SkipBack, SkipForward, Play, Pause, Rewind, FastForward,
  Subtitles, AudioLines, Tv, Radio, Volume2, VolumeX, Gauge, Circle, History, Flag,
} from 'lucide-react';
import type { VideoController, VideoTrackInfo } from './VideoPlayer';
import { useTranslation } from 'react-i18next';
import { formatTime } from '@/i18n/format';
import { volumeBar } from '@/utils/volume';
import { availableLabel, behindLabel } from '@/lib/liveRewind';
import { liveBarDisabled, liveBarLabel, type BarControlId } from './liveBar';

export type { BarControlId } from './liveBar';


interface Props {
  visible: boolean;
  /** The buttons, left to right (liveBarOrder): the key handler uses the same list. */
  order: BarControlId[];
  focus: BarControlId;
  isPaused: boolean;
  controller: VideoController | null;
  /** Re-render trigger when tracks change (subs/audios). */
  tracksTick: number;
  // Channel + EPG
  categoryName?: string;
  channelLogo?: string;
  channelNum?: number;
  channelName?: string;
  nowTitle?: string;
  nowStart?: number;
  nowEnd?: number;
  nextTitle?: string;
  // Menus
  subMenuOpen: boolean;
  audioMenuOpen: boolean;
  /** When > -2 indicates a focused menu row (or -1 = "Off"). -2 = none. */
  subMenuFocus: number;
  audioMenuFocus: number;
  // Volume
  volMenuOpen: boolean;
  /** 0..1 */
  volume: number;
  /** Stats panel showing (PlayerStatsPanel) — a plain toggle, no menu of its own. */
  statsOn?: boolean;
  /**
   * Rewind live TV (TRACKER 25): how far back it goes and where the picture
   * is. Null = rewind is off for this channel: the bar is the plain one.
   */
  rewind?: { availableSec: number; behindSec: number; archiveDays: number; note?: string } | null;
  /** This channel is being recorded now. */
  recording?: boolean;
}

/** The How-to guide's hooks on the buttons (data-howto; literals, so its check finds them). */
const BAR_HOWTO: Record<BarControlId, string | undefined> = {
  prev: 'bar.prev', rew: 'bar.rew', play: 'bar.play', fwd: 'bar.fwd', golive: 'bar.golive', next: 'bar.next',
  rec: 'bar.rec', report: 'bar.report', cc: 'bar.cc', audio: 'bar.audio', vol: 'bar.vol', stats: undefined,
};

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const fmtMs = (ms: number) => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad2(m)}:${pad2(s)}`;
};

export interface BarButtonProps {
  id: string;
  icon: JSX.Element;
  label: string;
  focused: boolean;
  /** Its popup menu is showing: the eye should move to the menu rows, so the
   *  button drops to an outlined marker (no ring, no scale). */
  open?: boolean;
  disabled?: boolean;
  /** "On" (this channel is recording). */
  on?: boolean;
  howto?: string;
}

/**
 * One button of a player bar, with its name under it while highlighted. The
 * channel bar and the films' bar (VodControlBar) both draw theirs with it.
 * Each button sits in a column as wide as itself: the name under the
 * highlighted one may run past the column but never widens it. Every column
 * has the name's line (invisible unless highlighted), so the row never jumps
 * as the highlight moves. Play is the big one.
 */
export function BarButton({ id, icon, label, focused, open = false, disabled = false, on = false, howto }: BarButtonProps) {
  const base = 'tv-focusable home-focus-surface flex items-center justify-center rounded-full transition-transform duration-150';
  const size = id === 'play' ? 'w-16 h-16' : 'w-12 h-12';
  const visualState = open
    ? 'bg-black/60 text-brand-gold border-2 border-brand-gold scale-100'
    : focused
      ? 'bg-brand-gold text-brand-navy scale-110'
      : disabled
        ? 'bg-white/5 text-white/30'
        : on
          ? 'bg-white/15 text-brand-gold'
          : 'bg-white/10 text-white hover:bg-white/20';
  return (
    <div data-bar-control={id} data-howto={howto} className={`flex flex-col items-center flex-shrink-0 ${id === 'play' ? 'w-16' : 'w-12'}`}>
      <div className="h-16 flex items-center justify-center">
        <button
          type="button"
          aria-label={label}
          title={label}
          data-focused={focused && !open ? 'true' : 'false'}
          className={`${base} ${size} ${visualState}`}
        >
          {icon}
        </button>
      </div>
      <span
        data-bar-name
        data-howto={focused ? 'bar.label' : undefined}
        aria-hidden="true"
        className={`mt-1 h-4 whitespace-nowrap text-center text-sm leading-4 font-quicksand font-bold ${focused ? 'text-white' : 'invisible'}`}
      >
        {focused ? label : '.'}
      </span>
    </div>
  );
}

const PlayerControlBar = memo(({
  visible, order, focus, isPaused, controller, tracksTick,
  categoryName, channelLogo, channelNum, channelName,
  nowTitle, nowStart, nowEnd, nextTitle,
  subMenuOpen, audioMenuOpen, subMenuFocus, audioMenuFocus,
  volMenuOpen, volume, statsOn = false, rewind = null, recording = false,
}: Props) => {
  // Also makes the bar redraw (button names come from liveBarLabel) when the language changes.
  const { t } = useTranslation();
  // 1Hz clock + progress tick.

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [visible]);

  const subs: VideoTrackInfo[] = controller?.getSubtitleTracks() ?? [];
  const auds: VideoTrackInfo[] = controller?.getAudioTracks() ?? [];
  // Touch tracksTick so React re-renders when caller signals a track update.
  void tracksTick;

  const seekable = !!controller?.isSeekable();

  const total = nowStart && nowEnd && nowEnd > nowStart ? nowEnd - nowStart : 0;
  const elapsed = total ? Math.max(0, Math.min(total, now - (nowStart || 0))) : 0;
  const progressPct = total ? (elapsed / total) * 100 : 0;

  const vol = volumeBar(volume);
  const volPct = vol.pct;
  const volIcon = volPct === 0 ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />;

  if (!visible) return null;

  // Rewind live TV: where the picture is against how far back it can go.
  const rw = rewind;
  const behind = rw ? rw.behindSec : 0;
  const rewound = behind >= 1;
  const rwPct = rw && rw.archiveDays === 0 && rw.availableSec > 0
    ? Math.max(0, Math.min(100, ((rw.availableSec - behind) / rw.availableSec) * 100))
    : 100;

  const iconFor = (id: BarControlId): JSX.Element => {
    switch (id) {
      case 'prev': return <SkipBack className="w-6 h-6" />;
      case 'next': return <SkipForward className="w-6 h-6" />;
      case 'rew': return <Rewind className="w-6 h-6" />;
      case 'fwd': return <FastForward className="w-6 h-6" />;
      case 'golive': return <Radio className="w-6 h-6" />;
      case 'rec': return <Circle className={`w-6 h-6 ${recording ? 'fill-red-500 text-red-500' : 'fill-red-600/80 text-red-400'}`} />;
      case 'report': return <Flag className="w-6 h-6" />;
      case 'play': return isPaused ? <Play className="w-7 h-7 fill-current" /> : <Pause className="w-7 h-7 fill-current" />;
      case 'cc': return <Subtitles className="w-6 h-6" />;
      case 'audio': return <AudioLines className="w-6 h-6" />;
      case 'vol': return volIcon;
      default: return <Gauge className="w-6 h-6" />;
    }
  };
  // The same rule the key handler in LiveSection uses to skip a button.
  const controls = order.map((id) => ({
    id,
    icon: iconFor(id),
    label: liveBarLabel(id, { isPaused, recording, statsOn, volumePct: volPct }),
    disabled: liveBarDisabled(id, { seekable, rewind: !!rw, subtitles: subs.length, audios: auds.length }),
  }));


  const renderButton = (c: typeof controls[number]) => (
    <BarButton
      key={c.id}
      id={c.id}
      icon={c.icon}
      label={c.label}
      focused={focus === c.id}
      // "Open": this button's popup menu is showing.
      open={(c.id === 'cc' && subMenuOpen) || (c.id === 'audio' && audioMenuOpen) || (c.id === 'vol' && volMenuOpen) || (c.id === 'stats' && statsOn)}
      disabled={c.disabled}
      on={c.id === 'rec' && recording}
      howto={BAR_HOWTO[c.id]}
    />
  );


  return (
    <>
      {/* Top-left: category */}
      <div className="absolute top-4 left-6 z-10 pointer-events-none animate-fade-in">
        {categoryName && (
          <span className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-black/60 text-brand-ice font-nunito text-sm">
            <Tv className="w-4 h-4 text-brand-gold" /> {categoryName}
          </span>
        )}
      </div>

      {/* Top-right: clock */}
      <div className="absolute top-4 right-6 z-10 pointer-events-none animate-fade-in">
        <span className="px-3 py-2 rounded-full bg-black/60 text-white font-quicksand font-bold text-base tabular-nums">
          {formatTime(now)}
        </span>
      </div>

      {/* Bottom overlay */}
      {/* Kept tight: the bar sits over the programme, so every row is as
          short as it can be, and the controls get their own dark pill so
          they read against any picture. */}
      <div data-howto="bar.root" className="absolute left-0 right-0 bottom-0 z-10 px-8 pt-8 pb-3 bg-gradient-to-t from-black/95 via-black/85 to-transparent animate-fade-in pointer-events-none">
        {/* Top row: logo + meta + LIVE */}
        <div className="flex items-start gap-3 max-w-6xl mx-auto pointer-events-auto" data-howto="bar.channel">
          <div className="w-12 h-12 rounded-xl bg-black/60 flex items-center justify-center overflow-hidden flex-shrink-0 border border-white/10">
            {channelLogo
              ? <img src={channelLogo} alt="" loading="lazy" decoding="async" className="w-full h-full object-contain" />
              : <Tv className="w-6 h-6 text-brand-ice/60" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-quicksand font-bold text-white truncate leading-tight">
                {channelNum != null ? `${channelNum} · ` : ''}{channelName}
              </h2>
              {rewound ? (
                <span data-rewound className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/20 text-white text-xs font-bold tracking-wider tabular-nums">
                  <History className="w-3 h-3" /> {behindLabel(behind)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-600 text-white text-xs font-bold tracking-wider">
                  <Radio className="w-3 h-3" /> {t('live.bar.liveChip')}
                </span>
              )}
              {recording && (
                <span data-rec-badge className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-600/25 text-red-300 text-xs font-bold">
                  <Circle className="w-3 h-3 fill-red-500 text-red-500" /> {t('live.bar.recChip')}
                </span>
              )}
            </div>
            {nowTitle && (
              <p className="text-brand-ice/90 font-nunito truncate">
                {nowTitle}
                {nowStart && nowEnd && (
                  <span className="text-brand-ice/70 ml-2 text-xs tabular-nums">
                    {formatTime(nowStart)} – {formatTime(nowEnd)}
                  </span>
                )}
              </p>
            )}
            {nextTitle && (
              <p className="text-xs text-brand-ice/70 font-nunito truncate mt-1">
                {t('live.bar.next', { title: nextTitle })}
              </p>
            )}
          </div>
        </div>

        {/* Progress */}
        <div className="max-w-6xl mx-auto mt-2 pointer-events-auto">
          <div className="h-1.5 bg-white/15 rounded-full overflow-hidden">
            <div className="h-full bg-brand-gold transition-[width] duration-150 ease-out" style={{ width: `${progressPct}%` }} />
          </div>
          {total > 0 && (
            <div className="flex justify-between text-xs text-brand-ice/70 font-nunito tabular-nums mt-1">
              <span>{fmtMs(elapsed)}</span>
              <span>{fmtMs(total)}</span>
            </div>
          )}
        </div>

        {/* Rewind live TV: how far back it goes, and where the picture is */}
        {rw && (
          <div data-rewind-timeline data-howto="bar.timeline" className="max-w-6xl mx-auto mt-2 flex items-center pointer-events-auto">
            <span className={`text-xs font-nunito tabular-nums flex-shrink-0 mr-3 ${rw.note ? 'text-amber-300' : 'text-brand-ice/80'}`}>
              {rw.note ?? availableLabel(rw.availableSec, rw.archiveDays)}
            </span>
            <div className="flex-1 h-1.5 bg-white/15 rounded-full overflow-hidden">
              <div className={`h-full ${rewound ? 'bg-white/70' : 'bg-red-500'}`} style={{ width: `${rwPct}%` }} />
            </div>
            <span className={`text-xs font-quicksand font-bold tabular-nums flex-shrink-0 ml-3 ${rewound ? 'text-white' : 'text-red-400'}`}>
              {behindLabel(behind)}
            </span>
          </div>
        )}

        {/* Centered control row, on its own dark pill */}
        <div className="max-w-6xl mx-auto mt-2 flex items-center justify-center pointer-events-auto">
          <div className="inline-flex items-center gap-2 rounded-full bg-black/80 border border-white/10 px-3 py-1.5">
            {controls.map(renderButton)}
          </div>
        </div>

        {/* Hint */}
        <p className="text-center text-xs text-brand-ice/60 font-nunito mt-2 pointer-events-none">
          {t('live.bar.hint')}
        </p>
      </div>

      {/* Subtitles menu */}
      {subMenuOpen && (
        <div className="absolute right-8 bottom-32 z-20 w-72 rounded-2xl bg-black/90 border border-white/15 p-2 overflow-visible animate-fade-in pointer-events-auto">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs uppercase tracking-wide font-quicksand font-semibold text-brand-ice/70">{t('live.bar.ccLabel')}</p>
            <span className="text-xs text-brand-ice/60 font-nunito">{t('live.bar.menuHint')}</span>
          </div>
          <div className="space-y-1">
            {[{ id: -1, label: t('live.bar.subsOff'), active: subs.every(s => !s.active) } as { id: number; label: string; active: boolean }]
              .concat(subs.map(s => ({ id: s.id, label: s.label, active: s.active })))
              .map((row, i) => {
                const idx = i - 1; // -1 = Off (focus = -1), others = 0..n
                const focused = subMenuFocus === idx;
                return (
                  <div
                    key={`${row.id}-${row.label}`}
                    data-focused={focused ? 'true' : 'false'}
                    className={`tv-ring px-3 py-3 rounded-xl font-nunito text-sm flex items-center justify-between ${
                      focused ? 'bg-brand-gold/20 text-white scale-[1.02] z-10' : 'text-brand-ice/90'
                    }`}
                  >
                    <span className="truncate">{row.label}</span>
                    {row.active && <span className="text-brand-gold text-xs">●</span>}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Audio menu */}
      {audioMenuOpen && (
        <div className="absolute right-8 bottom-32 z-20 w-72 rounded-2xl bg-black/90 border border-white/15 p-2 overflow-visible animate-fade-in pointer-events-auto">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs uppercase tracking-wide font-quicksand font-semibold text-brand-ice/70">{t('live.bar.audioLabel')}</p>
            <span className="text-xs text-brand-ice/60 font-nunito">{t('live.bar.menuHint')}</span>
          </div>
          <div className="space-y-1">
            {auds.map((a, i) => {
              const focused = audioMenuFocus === i;
              return (
                <div
                  key={`${a.id}-${a.label}`}
                  data-focused={focused ? 'true' : 'false'}
                  className={`tv-ring px-3 py-3 rounded-xl font-nunito text-sm flex items-center justify-between ${
                    focused ? 'bg-brand-gold/20 text-white scale-[1.02] z-10' : 'text-brand-ice/90'
                  }`}
                >
                  <span className="truncate">{a.label}</span>
                  {a.active && <span className="text-brand-gold text-xs">●</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Volume menu */}
      {volMenuOpen && (
        <div className="absolute right-8 bottom-32 z-20 w-72 rounded-2xl bg-black/90 border border-white/15 p-2 overflow-visible animate-fade-in pointer-events-auto">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs uppercase tracking-wide font-quicksand font-semibold text-brand-ice/70 flex items-center gap-2">
              {volPct === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              {t('live.bar.volLabel')}
            </p>
            <span className="text-xs text-brand-ice/60 font-nunito">{t('live.bar.volHint')}</span>
          </div>
          <div className="px-2 pb-1">
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-brand-ice/70 font-nunito">{t('live.bar.level')}</span>
              <span className={`text-sm font-quicksand font-bold tabular-nums ${vol.boost ? 'text-orange-300' : 'text-brand-gold'}`}>{vol.boost ? t('live.bar.levelBoost', { pct: volPct }) : `${volPct}%`}</span>
            </div>
            {/* 0-150%: the tick is 100%; past it the sound is boosted. */}
            <div className="relative mt-2 h-2 w-full rounded-full bg-white/15 overflow-hidden">
              <div className={`h-full ${vol.boost ? 'bg-orange-400' : 'bg-brand-gold'}`} style={{ width: `${vol.fill}%` }} />
              <div className="absolute top-0 bottom-0 w-0.5 bg-white/70" style={{ left: '66.6%' }} />
            </div>
          </div>
        </div>
      )}
    </>
  );
});

PlayerControlBar.displayName = 'PlayerControlBar';
export default PlayerControlBar;
