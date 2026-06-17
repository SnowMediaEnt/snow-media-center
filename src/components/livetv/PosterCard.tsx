import { memo, useState } from 'react';
import { Film, Star, Tv as TvIcon } from 'lucide-react';

interface Props {
  title: string;
  image?: string;
  rating?: string | number;
  year?: string;
  isFocused: boolean;
  variant?: 'movie' | 'series';
  onFocus?: () => void;
  onActivate?: () => void;
}

const PosterCard = memo(({ title, image, rating, year, isFocused, variant = 'movie', onFocus, onActivate }: Props) => {
  const [err, setErr] = useState(false);
  const showImg = image && !err;
  const Fallback = variant === 'series' ? TvIcon : Film;

  return (
    <div
      data-focused={isFocused ? 'true' : 'false'}
      onMouseEnter={onFocus}
      onClick={onActivate}
      className={`
        relative rounded-xl overflow-hidden cursor-pointer transition-all duration-150
        bg-black/40 border border-white/10
        ${isFocused ? 'ring-2 ring-brand-gold scale-[1.04] shadow-2xl shadow-brand-gold/30 z-10' : 'hover:scale-[1.02]'}
      `}
      style={{ aspectRatio: '2 / 3' }}
    >
      {showImg ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          onError={() => setErr(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-brand-navy/60 to-black/80">
          <Fallback className="w-12 h-12 text-brand-ice/40" />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/95 via-black/70 to-transparent">
        <p className="text-xs sm:text-sm font-quicksand font-semibold text-white line-clamp-2 leading-tight">
          {title}
        </p>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-brand-ice/80 font-nunito">
          {rating != null && rating !== '' && (
            <span className="flex items-center gap-0.5">
              <Star className="w-3 h-3 text-brand-gold fill-brand-gold" /> {Number(rating).toFixed(1)}
            </span>
          )}
          {year && <span>{year}</span>}
        </div>
      </div>
    </div>
  );
});

PosterCard.displayName = 'PosterCard';
export default PosterCard;
