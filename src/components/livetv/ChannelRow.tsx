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


const formatTime = (ms?: number) => {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

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
        flex items-center gap-4 px-4 py-3 rounded-xl cursor-pointer
        transition-transform duration-150 will-change-transform
        ${isFocused
          ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-[1.02] shadow-[0_0_18px_2px_rgba(245,200,80,0.35)]'
          : isPlaying ? 'bg-brand-gold/10 border border-brand-gold/30' : 'bg-white/5 hover:bg-white/10 border border-transparent'}
      `}
    >
      <span className={`w-8 text-right font-quicksand font-bold tabular-nums text-sm ${isFocused ? 'text-brand-gold' : 'text-brand-ice/60'}`}>
        {channel.num ?? ''}
      </span>


      <div className="w-14 h-14 rounded-lg bg-black/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {showIcon ? (
          <>
            {!iconLoaded && <div className="absolute w-14 h-14 rounded-lg bg-white/5 animate-pulse" />}
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
          <Tv className="w-7 h-7 text-brand-ice/60" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-quicksand font-semibold truncate ${isFocused ? 'text-white' : 'text-brand-ice'}`}>
            {channel.name}
          </span>
          {isPlaying && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-brand-gold/30 text-brand-gold font-nunito font-semibold flex-shrink-0">
              <Radio className="w-3 h-3 animate-pulse" /> ON AIR
            </span>
          )}
          <Star
            className={`w-4 h-4 ml-auto flex-shrink-0 transition-colors ${
              isFavorite ? 'text-brand-gold fill-brand-gold' : isFocused ? 'text-brand-ice/40' : 'text-transparent'
            }`}
          />
        </div>
        {now ? (
          <>
            <p className="text-xs text-brand-ice/70 truncate font-nunito mt-0.5">
              {now.title}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-brand-gold/80 rounded-full" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-[10px] text-brand-ice/50 font-nunito tabular-nums flex-shrink-0">
                {formatTime(now.start)}–{formatTime(now.end)}
              </span>
            </div>
          </>
        ) : (
          <p className="text-xs text-brand-ice/40 truncate font-nunito mt-0.5 italic">No information</p>
        )}
      </div>
    </div>
  );
});

ChannelRow.displayName = 'ChannelRow';
export default ChannelRow;
