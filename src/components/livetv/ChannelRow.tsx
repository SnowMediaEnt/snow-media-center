import { memo, useState } from 'react';
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
}

const ChannelRow = memo(({ channel, index, isFocused, isPlaying, isFavorite, nowNext, onSelect, onActivate }: Props) => {
  const [iconError, setIconError] = useState(false);
  const showIcon = channel.stream_icon && !iconError;

  return (
    <div
      data-focused={isFocused ? 'true' : 'false'}
      onClick={() => onActivate(index)}
      onMouseEnter={() => onSelect(index)}
      className={`
        flex items-center gap-4 px-4 py-3 rounded-xl cursor-pointer transition-all duration-150
        ${isFocused ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-[1.01] shadow-lg' : 'bg-white/5 hover:bg-white/10'}
      `}
    >
      <div className="w-14 h-14 rounded-lg bg-black/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {showIcon ? (
          <img
            src={channel.stream_icon}
            alt=""
            loading="lazy"
            onError={() => setIconError(true)}
            className="w-full h-full object-contain"
          />
        ) : (
          <Tv className="w-7 h-7 text-brand-ice/60" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-quicksand font-semibold truncate ${isFocused ? 'text-white' : 'text-brand-ice'}`}>
            {channel.num ? `${channel.num}. ` : ''}{channel.name}
          </span>
          {isFavorite && <Star className="w-4 h-4 text-brand-gold fill-brand-gold flex-shrink-0" />}
          {isPlaying && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-brand-gold/30 text-brand-gold">
              <Radio className="w-3 h-3 animate-pulse" /> ON
            </span>
          )}
        </div>
        {nowNext?.now && (
          <p className="text-xs text-brand-ice/70 truncate font-nunito mt-0.5">
            Now: {nowNext.now.title}
          </p>
        )}
      </div>
    </div>
  );
});

ChannelRow.displayName = 'ChannelRow';
export default ChannelRow;
