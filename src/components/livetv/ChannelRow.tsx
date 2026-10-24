import { memo, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';
import { Tv, Star, Radio, AlertTriangle } from 'lucide-react';
import i18n from '@/i18n';
import { formatTime } from '@/i18n/format';
import type { XtreamLiveStream, EpgNowNext } from '@/lib/xtream';
import { channelRowLabels, type ChannelRowLabels } from './channelRowLabels';
import type { ChannelReport } from '@/lib/channelStatus';
import { TV_WALL_NAME_H } from '@/lib/liveLayout';
import { NORMAL_ROW_H, SLIM_ROW_H } from '@/lib/liveRows';
import { channelInitials } from '@/lib/channelInitials';
import { nameClasses } from '@/lib/channelName';

// Logos a Compact wall tile has shown. Folding or unfolding the categories
// changes how many tiles a row holds, so most tiles land in another row and
// are drawn anew: a logo already shown is drawn at once, not faded in again
// (every logo on screen blinked on each ◀ ▶ between the categories and the
// tiles). And the logos that failed: a tile drawn anew shows the TV mark at
// once instead of asking a dead logo host again. Only the addresses, a
// bounded few.
const WALL_LOGOS_MAX = 1500;
const shownWallLogos = new Set<string>();
const failedWallLogos = new Set<string>();
const remember = (set: Set<string>, src: string) => {
  if (set.size >= WALL_LOGOS_MAX) set.clear();
  set.add(src);
};

// The channel number a step smaller as it grows longer, so a 4-6 digit
// number stays inside its column instead of running into the logo (the
// column is a fixed width so the logos line up). `base` is the row's size
// for up to three digits: 'xs' (12px) or 'sm' (14px, Classic).
const numSize = (num: number | string | null | undefined, base: 'xs' | 'sm' = 'xs'): string => {
  const n = String(num ?? '').length;
  if (base === 'sm') return n <= 3 ? 'text-sm' : n === 4 ? 'text-xs' : n === 5 ? 'text-[10px]' : 'text-[9px]';
  return n <= 4 ? 'text-xs' : n === 5 ? 'text-[10px]' : 'text-[9px]';
};

// A channel with no logo (or before it loads): its initials on a circle
// whose colour comes from its name, so it keeps the same one. Muted hues
// under white letters. hsl() with commas: Chromium 66 has no space syntax.
const initialsColor = (name: string | null | undefined): string => {
  let h = 0;
  for (const c of name ?? '') h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 42%, 34%)`;
};

interface Props {
  channel: XtreamLiveStream;
  index: number;
  isFocused: boolean;
  isPlaying: boolean;
  isFavorite: boolean;
  /** Down right now, by what other boxes see (lib/channelStatus). */
  isDown?: boolean;
  /** What the others reported about it (lib/channelStatus channelReport):
   *  off the air, down or its category down (red), buffering (amber). Wins
   *  over isDown. */
  report?: ChannelReport;
  nowNext?: EpgNowNext;
  onSelect: (index: number) => void;
  onActivate: (index: number) => void;
  onLongPress?: (index: number) => void;
  /** classic / compact: the normal two-line row (NORMAL_ROW_H; Classic says
   *  "On air" on the playing row, Compact "LIVE") · tile: a logo tile for the grid layout,
   *  name underneath · slim: one line per channel (lib/liveRows, either list
   *  layout) · upright: a phone held upright, the 56px row sized for a finger. */
  variant?: 'classic' | 'compact' | 'tile' | 'slim' | 'upright';
  /** The row's words, translated once by the list (channelRowLabels) instead of once per row. */
  labels?: ChannelRowLabels;
  /** Which service the channel is on, in a list that mixes them (all-services Favorites). */
  serviceTag?: string;
  /** The logo wall drawn Compact (lib/liveLayout tvWallLayout): a square
   *  logo card, the number and name under it on up to two lines, a step
   *  smaller when long (never a scrolling name). */
  compactTile?: boolean;
}

// One channel in the list, in whichever shape the layout asks for. Each
// shape's height must stay in step with the slot LiveSection gives it (see
// rowHeightFor there) — the D-pad scroll math is written against the slot.
// Times come from formatTime (i18n/format.ts), which keeps one formatter per
// language: toLocaleTimeString with options builds a new one per call, twice
// per row per render on Chromium 66.

const ChannelRow = memo(({ channel, index, isFocused, isPlaying, isFavorite, isDown = false, report, nowNext, onSelect, onActivate, onLongPress, variant = 'compact', labels, serviceTag, compactTile = false }: Props) => {
  const L = labels ?? channelRowLabels(i18n.t.bind(i18n));
  // Off the air and down (the channel or its whole category) are red;
  // buffering is amber.
  const flag: ChannelReport = report !== undefined ? report : isDown ? 'down' : null;
  const flagged = flag !== null;
  const flagLabel = flag === 'buffering' ? L.buffering : flag === 'category' ? L.categoryDown : flag === 'offair' ? L.offAir : L.down;
  const flagNote = flag === 'buffering' ? L.bufferingNote : flag === 'category' ? L.categoryDownNote : flag === 'offair' ? L.offAirNote : L.downNote;
  const flagIcon = flag === 'buffering' ? 'text-amber-400' : 'text-red-400';
  const flagText = flag === 'buffering' ? 'text-amber-300' : 'text-red-300';
  const [iconError, setIconError] = useState(() => compactTile && !!channel.stream_icon && failedWallLogos.has(channel.stream_icon));
  const [iconLoaded, setIconLoaded] = useState(() => compactTile && !!channel.stream_icon && shownWallLogos.has(channel.stream_icon));
  const showIcon = channel.stream_icon && !iconError;

  // Touch long-press → report. Mouse clicks still activate normally.
  const lpTimerRef = useRef<number | null>(null);
  const lpFiredRef = useRef(false);
  const touchingRef = useRef(false);
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

  const clock = (ms?: number) => (ms ? formatTime(ms) : '');
  const now = nowNext?.now;
  const progress = (() => {
    if (!now) return 0;
    return Math.min(100, Math.max(0, ((Date.now() - now.start) / (now.end - now.start)) * 100));
  })();

  const handlers = {
    onClick: () => { if (!lpFiredRef.current) onActivate(index); },
    onMouseEnter: () => onSelect(index),
    onTouchStart: () => { touchingRef.current = true; onSelect(index); startLongPress(); },
    // The lift of a finger that held the row: the options opened under it,
    // and the tap the browser makes of the lift would land on whatever row of
    // theirs is there. Cancelling the touchend stops it (Tronix 464aea5).
    onTouchEnd: (e: ReactTouchEvent) => { touchingRef.current = false; if (lpFiredRef.current && e.cancelable) e.preventDefault(); cancelLongPress(); },
    onTouchMove: cancelLongPress,
    onTouchCancel: () => { touchingRef.current = false; cancelLongPress(); },
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault();
      // A touch screen's own long-press: the timer above has it already.
      if (lpFiredRef.current) return;
      // The WebView's long press (~0.4-0.5 s) comes before the 600 ms timer:
      // it is the one, so the timer doesn't open the options a second time
      // and the lift doesn't tap a row under them (Tronix dd211a6).
      if (touchingRef.current) { cancelLongPress(); lpFiredRef.current = true; }
      onLongPress?.(index);
    },
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

  // The normal rows' round logo: a coloured initials circle (its colour from
  // the name, so a channel keeps it), the logo over it once it has loaded on
  // a dark disc: a missing, slow or broken logo leaves the initials, never an
  // empty box.
  const roundLogo = (
    <div
      data-row-logo=""
      className="relative w-[34px] h-[34px] rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
      style={{ backgroundColor: showIcon && iconLoaded ? 'rgba(0,0,0,0.45)' : initialsColor(channel.name) }}
    >
      {!(showIcon && iconLoaded) && (
        <span data-row-initials="" aria-hidden="true" className="font-quicksand font-bold text-[13px] leading-none text-white/95">
          {channelInitials(channel.name) || <Tv className="w-4 h-4 text-white/70" />}
        </span>
      )}
      {showIcon && (
        <img
          src={channel.stream_icon}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={(e) => { if (e.currentTarget.naturalWidth === 0) setIconError(true); else setIconLoaded(true); }}
          onError={() => setIconError(true)}
          className={`absolute top-0 left-0 right-0 bottom-0 m-auto max-w-[76%] max-h-[76%] object-contain transition-opacity duration-200 ${iconLoaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );

  if (variant === 'tile' && compactTile) {
    // The Compact wall: the square card 4px in from the tile's edges
    // (padding-top: 100% keeps it square: Chromium 66 has no aspect-ratio),
    // the number and name under it. The slot's height is worked out for
    // exactly this shape (tvWallLayout): 4px over the square, TV_WALL_NAME_H
    // under it.
    return (
      <div
        data-focused={isFocused ? 'true' : 'false'}
        data-wall-tile="compact"
        {...handlers}
        className={`tv-ring h-full flex flex-col rounded-xl overflow-hidden cursor-pointer border ${
          isFocused ? 'border-brand-gold bg-white/10' : isPlaying ? 'border-brand-gold/40 bg-white/5' : 'border-white/10 bg-white/5'}`}
      >
        <div className="mx-1 mt-1 flex-shrink-0">
          <div data-wall-logo className="relative rounded-lg bg-white/90 overflow-hidden" style={{ height: 0, paddingTop: '100%' }}>
            <div className="absolute inset-0 flex items-center justify-center">
              {showIcon ? (
                <img
                  src={channel.stream_icon}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onLoad={() => { setIconLoaded(true); if (channel.stream_icon) remember(shownWallLogos, channel.stream_icon); }}
                  onError={() => { setIconError(true); if (channel.stream_icon) remember(failedWallLogos, channel.stream_icon); }}
                  className={`max-w-[85%] max-h-[85%] object-contain transition-opacity duration-200 ${iconLoaded ? 'opacity-100' : 'opacity-0'}`}
                />
              ) : (
                <Tv className="w-8 h-8 text-black/40" />
              )}
            </div>
            {isPlaying && (
              <span className="absolute top-1 left-1 text-[10px] px-1 rounded bg-brand-gold text-black font-nunito font-bold leading-4">{L.live}</span>
            )}
            {isFavorite && <Star className="absolute top-1 right-1 w-3.5 h-3.5 text-brand-gold fill-brand-gold" />}
            {flagged && (
              <span className="absolute bottom-1 left-1 rounded-md bg-black/70 p-0.5" title={flagLabel} aria-label={flagLabel} data-report={flag}>
                <AlertTriangle className={`w-3.5 h-3.5 ${flagIcon}`} />
              </span>
            )}
            {serviceTag && <span data-service-tag="" className="absolute bottom-1 right-1 text-[9px] px-1 py-0.5 rounded bg-black/70 text-brand-gold font-quicksand font-bold uppercase leading-3">{serviceTag}</span>}
            {now && (
              <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-black/20">
                <div className="h-full bg-brand-gold" style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0 px-1.5 flex items-center" style={{ minHeight: TV_WALL_NAME_H }}>
          <p data-wall-name className={`w-full min-w-0 text-center font-quicksand font-semibold ${nameClasses(channel.name, 16, 'text-[13px]', 'text-[11px]')} ${isFocused ? 'text-white' : 'text-white/90'}`}>
            {channel.num != null && <span className={`font-nunito tabular-nums ${isFocused ? 'text-brand-gold' : 'text-white/45'}`}>{channel.num} </span>}
            {channel.name}
          </p>
        </div>
      </div>
    );
  }

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
            <span className="absolute top-1.5 left-1.5 text-xs px-1.5 py-0.5 rounded-md bg-brand-gold text-black font-nunito font-bold leading-4">{L.live}</span>
          )}
          {isFavorite && <Star className="absolute top-1.5 right-1.5 w-4 h-4 text-brand-gold fill-brand-gold" />}
          {flagged && (
            <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/70 p-0.5" title={flagLabel} aria-label={flagLabel} data-report={flag}>
              <AlertTriangle className={`w-4 h-4 ${flagIcon}`} />
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
          {serviceTag && <span data-service-tag="" className="text-[10px] px-1.5 py-0.5 rounded-md bg-brand-gold/15 text-brand-gold font-quicksand font-bold uppercase tracking-wide flex-shrink-0 leading-3">{serviceTag}</span>}
        </div>
      </div>
    );
  }

  if (variant === 'slim') {
    // One line, TiviMate style: number, logo, the name (bold, cut last, and
    // at most about half the line when what's on follows), what's on (muted,
    // cut first: it gets the room the name leaves)
    // and when it ends (the end, not "12m left": it doesn't go stale), with a
    // thin progress line along the foot. No flex gap (Chromium 66): margins.
    // The markers stay: down / buffering, the service, LIVE, the favorite
    // star. SLIM_ROW_H tall, the slot is 4px more.
    const time = now ? clock(now.end) : '';
    return (
      <div
        data-focused={isFocused ? 'true' : 'false'}
        data-row-slim=""
        {...handlers}
        style={{ height: SLIM_ROW_H }}
        className={`
          tv-ring flex items-center px-2.5 rounded-lg cursor-pointer min-w-0 w-full overflow-hidden
          ${isFocused
            ? 'bg-white/10'
            : isPlaying ? 'bg-brand-gold/10' : 'hover:bg-white/5'}
        `}
      >
        <span data-row-num="" className={`w-8 mr-2 text-right font-nunito tabular-nums whitespace-nowrap overflow-hidden flex-shrink-0 ${numSize(channel.num)} ${isFocused ? 'text-brand-gold' : 'text-white/45'}`}>
          {channel.num ?? ''}
        </span>
        {logo('w-6 h-6', 'w-3.5 h-3.5')}
        <div className="flex-1 min-w-0 ml-2 flex items-center">
          {flagged && <AlertTriangle className={`w-3.5 h-3.5 mr-1 ${flagIcon} flex-shrink-0`} aria-label={flagLabel} data-report={flag} />}
          {/* Capped when there is something to say after it, so what's on
              always gets some room (IPTV names run long: "US| ESPN 2 HD"). */}
          <span data-slim-name="" className={`min-w-0 truncate font-quicksand font-bold text-sm ${now || flagged ? 'max-w-[55%]' : ''} ${isFocused ? 'text-white' : 'text-white/90'}`}>
            {channel.name}
          </span>
          {serviceTag && <span data-service-tag="" className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-brand-gold/15 text-brand-gold font-quicksand font-bold uppercase flex-shrink-0 leading-3">{serviceTag}</span>}
          {isPlaying && (
            <span data-slim-live="" className="ml-1.5 flex items-center px-1 rounded bg-brand-gold text-black text-[10px] font-nunito font-bold leading-4 flex-shrink-0">
              <Radio className="w-2.5 h-2.5 mr-0.5" aria-hidden="true" />{L.live}
            </span>
          )}
          {isFavorite && <Star className="ml-1.5 w-3 h-3 text-brand-gold fill-brand-gold flex-shrink-0" />}
          <span data-slim-now="" className={`flex-1 min-w-0 ml-2 truncate font-nunito text-xs ${flagged ? flagText : 'text-brand-ice/60'}`}>
            {flagged ? flagLabel : now ? now.title : ''}
          </span>
          {time && (
            <span data-slim-time="" className={`ml-2 font-nunito tabular-nums text-xs flex-shrink-0 ${isFocused ? 'text-white/80' : 'text-brand-ice/55'}`}>
              –{time}
            </span>
          )}
        </div>
        {/* Along the row's foot, number to time (under the words it read as
            an underline), above the 3px focus ring. */}
        {now && (
          <div className="absolute left-2.5 right-2.5 bottom-[3px] h-[2px] rounded-full bg-white/[0.07] overflow-hidden" aria-hidden="true">
            <div className="h-full bg-brand-gold/60" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    );
  }

  if (variant === 'classic' || variant === 'compact') {
    // Normal rows, Classic and Compact alike (2026-10-24: the Tronix channel
    // list the owner likes, a little thicker, in gold), NORMAL_ROW_H tall:
    // the number; a round logo (a coloured initials circle until a logo has
    // loaded, and for a channel with none); the name, its markers and the
    // star after it, the programme's times at the line's right end (Classic;
    // Compact: when it ends, after what's on); what's on under it; and under the words, their width, how far into it. The
    // focused row a white ring on a brighter row. No flex gap (Chromium 66):
    // margins.
    const timed = !!now && !flagged;
    // Classic's wide list has the programme's times at the name line's end
    // (as Tronix's does); Compact's narrow column would cut the name to a few
    // letters for them, so it says when it ends at what's on's end instead
    // (the slim row's way: the end doesn't go stale).
    const wide = variant === 'classic';
    const timeText = `font-nunito tabular-nums whitespace-nowrap flex-shrink-0 ${isFocused ? 'text-white/85' : 'text-brand-ice/60'}`;
    return (
      <div
        data-focused={isFocused ? 'true' : 'false'}
        data-row-normal=""
        {...(variant === 'classic' ? { 'data-row-classic': '' } : { 'data-row-compact': '' })}
        {...handlers}
        style={{ height: NORMAL_ROW_H }}
        className={`
          tv-ring tv-ring-row flex items-center pl-1.5 pr-3 rounded-lg cursor-pointer min-w-0 w-full overflow-hidden
          ${isFocused
            ? 'bg-white/[0.14]'
            : isPlaying ? 'bg-brand-gold/10' : 'bg-white/[0.04] hover:bg-white/[0.08]'}
        `}
      >
        <span data-row-num="" className={`w-8 mr-2 text-right font-nunito font-semibold tabular-nums whitespace-nowrap overflow-hidden flex-shrink-0 ${numSize(channel.num, 'sm')} ${isFocused ? 'text-white' : 'text-white/55'}`}>
          {channel.num ?? ''}
        </span>
        {roundLogo}
        <div data-row-text="" className="relative flex-1 min-w-0 self-stretch ml-2.5 flex flex-col justify-center" style={{ paddingTop: 2, paddingBottom: 6 }}>
          <div className="flex items-center min-w-0 h-5">
            {flagged && <AlertTriangle className={`w-4 h-4 mr-1.5 ${flagIcon} flex-shrink-0`} aria-label={flagLabel} data-report={flag} />}
            <span data-row-name="" className={`min-w-0 font-quicksand font-bold text-base leading-5 truncate ${isFocused ? 'text-white' : 'text-white/90'}`}>
              {channel.name}
            </span>
            {isFavorite && <Star data-row-fav="" className="ml-1.5 w-3.5 h-3.5 text-brand-gold flex-shrink-0" strokeWidth={2.5} />}
            {serviceTag && <span data-service-tag="" className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-md bg-brand-gold/15 text-brand-gold font-quicksand font-bold uppercase tracking-wide flex-shrink-0 leading-3">{serviceTag}</span>}
            {isPlaying && (
              <span data-row-live="" className="ml-1.5 flex items-center text-[11px] px-1.5 rounded-md bg-brand-gold text-black font-nunito font-bold flex-shrink-0 leading-4">
                <Radio className="w-3 h-3 mr-1" aria-hidden="true" />{variant === 'classic' ? L.onAir : L.live}
              </span>
            )}
            {timed && wide && (
              <span data-row-time="" className={`ml-auto pl-3 text-[13px] leading-5 ${timeText}`}>
                {clock(now.start)}–{clock(now.end)}
              </span>
            )}
          </div>
          {flagged ? (
            <p data-row-now="" className={`text-[13px] leading-4 h-4 ${flagText} truncate font-nunito`}>{wide ? flagNote : flagLabel}</p>
          ) : now ? (
            <div className="flex items-center min-w-0 h-4">
              <span data-row-now="" className={`flex-1 min-w-0 text-[13px] leading-4 truncate font-nunito ${isFocused ? 'text-brand-ice/80' : 'text-brand-ice/60'}`}>{now.title}</span>
              {!wide && (
                <span data-row-time="" className={`ml-2 text-xs leading-4 ${timeText}`}>–{clock(now.end)}</span>
              )}
            </div>
          ) : (
            <p data-row-now="" className="text-[13px] leading-4 h-4 text-brand-ice/45 truncate font-nunito italic">{L.noInfo}</p>
          )}
          {/* Under the words, their width: how far into what's on. */}
          {timed && (
            <div data-row-progress="" className="absolute left-0 right-0 bottom-[3px] h-[2px] rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
              <div className="h-full bg-brand-gold rounded-full" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // 'upright': a phone held upright, the 56px two-line row sized for a finger
  // (the Compact row as it was before rows were thinned on a TV).
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
      <span data-row-num="" className={`w-8 text-right font-nunito tabular-nums whitespace-nowrap overflow-hidden flex-shrink-0 ${numSize(channel.num)} ${isFocused ? 'text-brand-gold' : 'text-white/45'}`}>
        {channel.num ?? ''}
      </span>

      {logo('w-9 h-9', 'w-5 h-5')}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {flagged && <AlertTriangle className={`w-4 h-4 ${flagIcon} flex-shrink-0`} aria-label={flagLabel} data-report={flag} />}
          <span className={`font-quicksand font-semibold text-base truncate ${isFocused ? 'text-white' : 'text-white/90'}`}>
            {channel.name}
          </span>
          {serviceTag && <span data-service-tag="" className="text-[10px] px-1.5 py-0.5 rounded-md bg-brand-gold/15 text-brand-gold font-quicksand font-bold uppercase tracking-wide flex-shrink-0 leading-3">{serviceTag}</span>}
          {isPlaying && (
            <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-brand-gold text-black font-nunito font-bold flex-shrink-0 leading-4">
              <Radio className="w-3 h-3" /> {L.live}
            </span>
          )}
          {isFavorite && <Star className="w-3.5 h-3.5 text-brand-gold fill-brand-gold flex-shrink-0" />}
        </div>
        <p className={`text-xs font-nunito truncate ${flagged ? flagText : now ? 'text-brand-ice/75' : 'text-brand-ice/50 italic'}`}>
          {flagged ? flagLabel : now ? now.title : L.noInfo}
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
