import { memo, useEffect, useRef, useState } from 'react';
import {
  SkipBack, SkipForward, Play, Pause, Rewind, FastForward,
  Subtitles, AudioLines, Tv, Radio,
} from 'lucide-react';
import type { VideoController, VideoTrackInfo } from './VideoPlayer';

export type BarControlId = 'prev' | 'rew' | 'play' | 'fwd' | 'next' | 'cc' | 'audio';

interface Props {
  visible: boolean;
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
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const fmtClock = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const fmtMs = (ms: number) => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad2(m)}:${pad2(s)}`;
};

const PlayerControlBar = memo(({
  visible, focus, isPaused, controller, tracksTick,
  categoryName, channelLogo, channelNum, channelName,
  nowTitle, nowStart, nowEnd, nextTitle,
  subMenuOpen, audioMenuOpen, subMenuFocus, audioMenuFocus,
}: Props) => {
  // 1Hz clock + progress tick.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [visible]);

  const subs: VideoTrackInfo[] = controller?.getSubtitleTracks() ?? [];
  const auds: VideoTrackInfo[] = controller?.getAudioTracks() ?? [];
  // Touch tracksTick so React re-renders when caller signals a track update.
  void tracksTick;

  const seekable = !!controller?.isSeekable();

  const total = nowStart && nowEnd && nowEnd > nowStart ? nowEnd - nowStart : 0;
  const elapsed = total ? Math.max(0, Math.min(total, now - (nowStart || 0))) : 0;
  const progressPct = total ? (elapsed / total) * 100 : 0;

  if (!visible) return null;

  const controls: { id: BarControlId; icon: JSX.Element; label: string; disabled?: boolean }[] = [
    { id: 'prev',  icon: <SkipBack className="w-6 h-6" />,    label: 'Previous channel' },
    { id: 'rew',   icon: <Rewind className="w-6 h-6" />,      label: 'Rewind 10s', disabled: !seekable },
    { id: 'play',  icon: isPaused ? <Play className="w-7 h-7 fill-current" /> : <Pause className="w-7 h-7 fill-current" />, label: isPaused ? 'Play' : 'Pause' },
    { id: 'fwd',   icon: <FastForward className="w-6 h-6" />, label: 'Forward 10s', disabled: !seekable },
    { id: 'next',  icon: <SkipForward className="w-6 h-6" />, label: 'Next channel' },
    { id: 'cc',    icon: <Subtitles className="w-6 h-6" />,   label: 'Subtitles', disabled: subs.length === 0 },
    { id: 'audio', icon: <AudioLines className="w-6 h-6" />,  label: 'Audio',     disabled: auds.length <= 1 },
  ];

  const renderButton = (c: typeof controls[number]) => {
    const focused = focus === c.id;
    const base = 'tv-focusable home-focus-surface flex items-center justify-center rounded-full transition-transform duration-150';
    const size = c.id === 'play' ? 'w-16 h-16' : 'w-12 h-12';
    const visualState = focused
      ? 'bg-brand-gold text-brand-navy scale-110 shadow-[0_0_20px_rgba(245,200,80,0.55)]'
      : c.disabled
        ? 'bg-white/5 text-white/30'
        : 'bg-white/10 text-white hover:bg-white/20';
    return (
      <button
        key={c.id}
        type="button"
        aria-label={c.label}
        title={c.label}
        data-focused={focused ? 'true' : 'false'}
        className={`${base} ${size} ${visualState}`}
      >
        {c.icon}
      </button>
    );
  };

  return (
    <>
      {/* Top-left: category */}
      <div className="absolute top-4 left-6 z-10 pointer-events-none animate-fade-in">
        {categoryName && (
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 text-brand-ice font-nunito text-sm">
            <Tv className="w-4 h-4 text-brand-gold" /> {categoryName}
          </span>
        )}
      </div>

      {/* Top-right: clock */}
      <div className="absolute top-4 right-6 z-10 pointer-events-none animate-fade-in">
        <span className="px-3 py-1.5 rounded-full bg-black/60 text-white font-quicksand font-bold text-base tabular-nums">
          {fmtClock(new Date(now))}
        </span>
      </div>

      {/* Bottom overlay */}
      <div className="absolute left-0 right-0 bottom-0 z-10 px-8 pt-16 pb-6 bg-gradient-to-t from-black/95 via-black/75 to-transparent animate-fade-in pointer-events-none">
        {/* Top row: logo + meta + LIVE */}
        <div className="flex items-start gap-4 max-w-6xl mx-auto pointer-events-auto">
          <div className="w-16 h-16 rounded-xl bg-black/60 flex items-center justify-center overflow-hidden flex-shrink-0 border border-white/10">
            {channelLogo
              ? <img src={channelLogo} alt="" loading="lazy" decoding="async" className="w-full h-full object-contain" />
              : <Tv className="w-8 h-8 text-brand-ice/60" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-quicksand font-bold text-white truncate">
                {channelNum != null ? `${channelNum} · ` : ''}{channelName}
              </h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-600 text-white text-[10px] font-bold tracking-wider">
                <Radio className="w-3 h-3" /> LIVE
              </span>
            </div>
            {nowTitle && (
              <p className="text-brand-ice/90 font-nunito truncate">
                {nowTitle}
                {nowStart && nowEnd && (
                  <span className="text-brand-ice/60 ml-2 text-xs tabular-nums">
                    {pad2(new Date(nowStart).getHours())}:{pad2(new Date(nowStart).getMinutes())} – {pad2(new Date(nowEnd).getHours())}:{pad2(new Date(nowEnd).getMinutes())}
                  </span>
                )}
              </p>
            )}
            {nextTitle && (
              <p className="text-xs text-brand-ice/60 font-nunito truncate mt-0.5">
                Next: {nextTitle}
              </p>
            )}
          </div>
        </div>

        {/* Progress */}
        <div className="max-w-6xl mx-auto mt-4 pointer-events-auto">
          <div className="h-1.5 bg-white/15 rounded-full overflow-hidden">
            <div className="h-full bg-brand-gold transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          {total > 0 && (
            <div className="flex justify-between text-[11px] text-brand-ice/70 font-nunito tabular-nums mt-1">
              <span>{fmtMs(elapsed)}</span>
              <span>{fmtMs(total)}</span>
            </div>
          )}
        </div>

        {/* Centered control row */}
        <div className="max-w-6xl mx-auto mt-5 flex items-center justify-center gap-3 pointer-events-auto">
          {controls.map(renderButton)}
        </div>

        {/* Hint */}
        <p className="text-center text-[11px] text-brand-ice/50 font-nunito mt-3 pointer-events-none">
          Left / Right: select · Enter: activate · Up or Back: hide bar
        </p>
      </div>

      {/* Subtitles menu */}
      {subMenuOpen && (
        <div className="absolute right-8 bottom-32 z-20 w-64 rounded-xl bg-black/90 border border-white/15 p-2 animate-fade-in pointer-events-auto">
          <p className="text-xs font-quicksand font-semibold text-brand-ice/70 px-2 py-1">Subtitles</p>
          {[{ id: -1, label: 'Off', active: subs.every(s => !s.active) } as { id: number; label: string; active: boolean }]
            .concat(subs.map(s => ({ id: s.id, label: s.label, active: s.active })))
            .map((row, i) => {
              const idx = i - 1; // -1 = Off (focus = -1), others = 0..n
              const focused = subMenuFocus === idx;
              return (
                <div
                  key={`${row.id}-${row.label}`}
                  data-focused={focused ? 'true' : 'false'}
                  className={`px-3 py-2 rounded-lg font-nunito text-sm flex items-center justify-between ${
                    focused ? 'bg-brand-gold/25 ring-2 ring-brand-gold text-white' : 'text-brand-ice'
                  }`}
                >
                  <span className="truncate">{row.label}</span>
                  {row.active && <span className="text-[10px] text-brand-gold">●</span>}
                </div>
              );
            })}
        </div>
      )}

      {/* Audio menu */}
      {audioMenuOpen && (
        <div className="absolute right-8 bottom-32 z-20 w-64 rounded-xl bg-black/90 border border-white/15 p-2 animate-fade-in pointer-events-auto">
          <p className="text-xs font-quicksand font-semibold text-brand-ice/70 px-2 py-1">Audio</p>
          {auds.map((a, i) => {
            const focused = audioMenuFocus === i;
            return (
              <div
                key={`${a.id}-${a.label}`}
                data-focused={focused ? 'true' : 'false'}
                className={`px-3 py-2 rounded-lg font-nunito text-sm flex items-center justify-between ${
                  focused ? 'bg-brand-gold/25 ring-2 ring-brand-gold text-white' : 'text-brand-ice'
                }`}
              >
                <span className="truncate">{a.label}</span>
                {a.active && <span className="text-[10px] text-brand-gold">●</span>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
});

PlayerControlBar.displayName = 'PlayerControlBar';
export default PlayerControlBar;
