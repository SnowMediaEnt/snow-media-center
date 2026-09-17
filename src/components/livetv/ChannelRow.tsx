import { memo, useRef, useState } from 'react';
import { Tv, Star, Radio } from 'lucide-react';
import type { XtreamLiveStream, EpgNowNext } from '@/lib/xtream';

interface Props {
  channel: XtreamLiveStream;
  index: number;
  isFocused: boolean;
  isPlaying: boolean;
  isFavorite: boolean;
  nowNext?: EpgNowNext;
  onSelect: (index: number) => void;
  onActivate: (index: number) => void;
  onLongPress?: (index: number) => void;
}

// One slim row in the channel list: number, logo, name and what is on now,
// with a short progress line at the right edge. The row is 56px tall inside a
// 60px slot (see ROW_HEIGHT in LiveSection) — the two must stay in step, the
// D-pad scroll math is written against that slot height.
const ChannelRow = memo(({ channel, index, isFocused, isPlaying, isFavorite, nowNext, onSelect, onActivate, onLongPress }: Props) => {
  const [iconError, setIconError] = useState(false);
  const [iconLoaded, setIconLoaded] = useState(false);
  const showIcon = channel.stream_icon && !iconError;

  // Touch long-press → report. Mouse clicks still activate normally.
  const lpTimerRef = useRef<number | null>(null);
  const lpFiredRef = useRef(false);
  const startLongPress = () => {
    lpFiredRef.current = false;
    if (lpTimerRef.current) window.clearTimeout(lpTimerRef.current);
    lpTimerRef.current = window.setTimeout(() => {
      lpFiredRef.current = true;
      onLongPress?.(index);
    }, 600) as unknown as number;
  };
  const cancelLongPress = () => {
    if (lpTimerRef.current) { window.clearTimeout(lpTimerRef.current); lpTimerRef.current = null; }
  };

  const now = nowNext?.now;
  const progress = (() => {
    if (!now) return 0;
    return Math.min(100, Math.max(0, ((Date.now() - now.start) / (now.end - now.start)) * 100));
  })();

  return (
    <div
      data-focused={isFocused ? 'true' : 'false'}
      onClick={() => { if (!lpFiredRef.current) onActivate(index); }}
      onMouseEnter={() => onSelect(index)}
      onTouchStart={() => { onSelect(index); startLongPress(); }}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onTouchCancel={cancelLongPress}
      onContextMenu={(e) => { e.preventDefault(); onLongPress?.(index); }}
      className={`
        tv-ring h-14 flex items-center gap-3 px-3 rounded-xl cursor-pointer min-w-0 w-full overflow-hidden
        ${isFocused
          ? 'bg-white/10'
          : isPlaying ? 'bg-brand-gold/10' : 'hover:bg-white/5'}
      `}
    >
      <span className={`w-6 text-right font-nunito tabular-nums text-xs flex-shrink-0 ${isFocused ? 'text-brand-gold' : 'text-white/45'}`}>
        {channel.num ?? ''}
      </span>

      <div className="relative w-9 h-9 rounded-lg bg-black/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {showIcon ? (
          <>
            {!iconLoaded && <div className="absolute inset-0 rounded-lg bg-white/5 animate-pulse" />}
            <img
              src={channel.stream_icon}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={() => setIconLoaded(true)}
              onError={() => setIconError(true)}
              className={`w-full h-full object-contain transition-opacity duration-200 ${iconLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          </>
        ) : (
          <Tv className="w-5 h-5 text-brand-ice/60" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`font-quicksand font-semibold text-base truncate ${isFocused ? 'text-white' : 'text-white/90'}`}>
            {channel.name}
          </span>
          {isPlaying && (
            <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-brand-gold text-black font-nunito font-bold flex-shrink-0 leading-4">
              <Radio className="w-3 h-3" /> LIVE
            </span>
          )}
          {isFavorite && <Star className="w-3.5 h-3.5 text-brand-gold fill-brand-gold flex-shrink-0" />}
        </div>
        <p className={`text-xs font-nunito truncate ${now ? 'text-brand-ice/75' : 'text-brand-ice/50 italic'}`}>
          {now ? now.title : 'No information'}
        </p>
      </div>

      {now ? (
        <div className="w-14 h-[2px] rounded-full bg-white/15 overflow-hidden flex-shrink-0" aria-hidden="true">
          <div className="h-full bg-brand-gold" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </div>
  );
});

ChannelRow.displayName = 'ChannelRow';
export default ChannelRow;
