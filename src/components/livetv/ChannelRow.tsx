import { memo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Tv, Star, Radio, AlertTriangle } from 'lucide-react';
import type { XtreamLiveStream, EpgNowNext } from '@/lib/xtream';

interface Props {
  channel: XtreamLiveStream;
  index: number;
  isFocused: boolean;
  isPlaying: boolean;
  isFavorite: boolean;
  /** Down right now, by what other boxes see (lib/channelStatus). */
  isDown?: boolean;
  nowNext?: EpgNowNext;
  onSelect: (index: number) => void;
  onActivate: (index: number) => void;
  onLongPress?: (index: number) => void;
  /** classic: the tall 84px row · compact: the slim 60px row · tile: a logo
   *  tile for the grid layout, name underneath. */
  variant?: 'classic' | 'compact' | 'tile';
}

// One channel in the list, in whichever shape the layout asks for. Each
// shape's height must stay in step with the slot LiveSection gives it (see
// rowHeightFor there) — the D-pad scroll math is written against the slot.
// One shared formatter: toLocaleTimeString with options builds a new one per
// call, twice per row per render on Chromium 66.
const TIME_FMT = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });

const DOWN_LABEL = 'Reported down right now';

const ChannelRow = memo(({ channel, index, isFocused, isPlaying, isFavorite, isDown = false, nowNext, onSelect, onActivate, onLongPress, variant = 'compact' }: Props) => {
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

  const formatTime = (ms?: number) => (ms ? TIME_FMT.format(ms) : '');
  const now = nowNext?.now;
  const progress = (() => {
    if (!now) return 0;
    return Math.min(100, Math.max(0, ((Date.now() - now.start) / (now.end - now.start)) * 100));
  })();

  const handlers = {
    onClick: () => { if (!lpFiredRef.current) onActivate(index); },
    onMouseEnter: () => onSelect(index),
    onTouchStart: () => { onSelect(index); startLongPress(); },
    onTouchEnd: cancelLongPress,
    onTouchMove: cancelLongPress,
    onTouchCancel: cancelLongPress,
    onContextMenu: (e: ReactMouseEvent) => { e.preventDefault(); onLongPress?.(index); },
  };

  const logo = (size: string, iconSize: string) => (
    <div className={`relative ${size} rounded-lg bg-black/40 flex items-center justify-center flex-shrink-0 overflow-hidden`}>
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
        <Tv className={`${iconSize} text-brand-ice/60`} />
      )}
    </div>
  );

  if (variant === 'tile') {
    // A logo tile: the art fills a square-ish box on a light card the way
    // most channel logos are drawn for, the name in a band underneath.
    return (
      <div
        data-focused={isFocused ? 'true' : 'false'}
        {...handlers}
        className={`tv-ring h-full flex flex-col rounded-xl overflow-hidden cursor-pointer border ${
          isFocused ? 'border-brand-gold bg-white/10' : isPlaying ? 'border-brand-gold/40 bg-white/5' : 'border-white/10 bg-white/5'}`}
      >
        <div className="relative flex-1 min-h-0 m-2 mb-0 rounded-lg bg-white/90 overflow-hidden flex items-center justify-center">
          {showIcon ? (
            <img
              src={channel.stream_icon}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={() => setIconLoaded(true)}
              onError={() => setIconError(true)}
              className={`max-w-[85%] max-h-[85%] object-contain transition-opacity duration-200 ${iconLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          ) : (
            <Tv className="w-10 h-10 text-black/40" />
          )}
          {isPlaying && (
            <span className="absolute top-1.5 left-1.5 text-xs px-1.5 py-0.5 rounded-md bg-brand-gold text-black font-nunito font-bold leading-4">LIVE</span>
          )}
          {isFavorite && <Star className="absolute top-1.5 right-1.5 w-4 h-4 text-brand-gold fill-brand-gold" />}
          {isDown && (
            <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/70 p-0.5" title={DOWN_LABEL} aria-label={DOWN_LABEL}>
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </span>
          )}
          {now && (
            <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-black/20">
              <div className="h-full bg-brand-gold" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
        <div className="h-9 px-2 flex items-center justify-center gap-1 min-w-0">
          {channel.num != null && <span className={`text-xs font-nunito tabular-nums flex-shrink-0 ${isFocused ? 'text-brand-gold' : 'text-white/45'}`}>{channel.num}</span>}
          <span className={`text-sm font-quicksand font-semibold truncate ${isFocused ? 'text-white' : 'text-white/90'}`}>{channel.name}</span>
        </div>
      </div>
    );
  }

  if (variant === 'classic') {
    return (
      <div
        data-focused={isFocused ? 'true' : 'false'}
        {...handlers}
        className={`
          tv-ring flex items-center gap-4 px-4 py-2 rounded-xl cursor-pointer min-w-0 w-full overflow-hidden
          ${isFocused
            ? 'bg-brand-gold/25 border border-transparent scale-[1.02] z-10'
            : isPlaying ? 'bg-brand-gold/10 border border-brand-gold/30' : 'bg-white/5 hover:bg-white/10 border border-transparent'}
        `}
      >
        <span className={`w-8 text-right font-quicksand font-bold tabular-nums text-sm ${isFocused ? 'text-brand-gold' : 'text-brand-ice/70'}`}>
          {channel.num ?? ''}
        </span>
        {logo('w-14 h-14', 'w-7 h-7')}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isDown && <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" aria-label={DOWN_LABEL} />}
            <span className={`font-quicksand font-semibold truncate ${isFocused ? 'text-white' : 'text-brand-ice'}`}>
              {channel.name}
            </span>
            {isPlaying && (
              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-brand-gold/30 text-brand-gold font-nunito font-semibold flex-shrink-0">
                <Radio className="w-3 h-3 animate-pulse" /> ON AIR
              </span>
            )}
            <Star
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-colors ${
                isFavorite ? 'text-brand-gold fill-brand-gold' : isFocused ? 'text-brand-ice/40' : 'text-transparent'
              }`}
            />
          </div>
          {isDown ? (
            <p className="text-xs text-amber-300 truncate font-nunito mt-1">{DOWN_LABEL} — we&apos;re on it</p>
          ) : now ? (
            <>
              <p className="text-xs text-brand-ice/70 truncate font-nunito mt-1">{now.title}</p>
              <div className="mt-1 flex items-center gap-2">
                <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-gold/80 rounded-full" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-xs text-brand-ice/70 font-nunito tabular-nums flex-shrink-0">
                  {formatTime(now.start)}–{formatTime(now.end)}
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-brand-ice/60 truncate font-nunito mt-1 italic">No information</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-focused={isFocused ? 'true' : 'false'}
      {...handlers}
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

      {logo('w-9 h-9', 'w-5 h-5')}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {isDown && <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" aria-label={DOWN_LABEL} />}
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
        <p className={`text-xs font-nunito truncate ${isDown ? 'text-amber-300' : now ? 'text-brand-ice/75' : 'text-brand-ice/50 italic'}`}>
          {isDown ? DOWN_LABEL : now ? now.title : 'No information'}
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
