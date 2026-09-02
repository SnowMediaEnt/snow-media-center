import { memo, useState } from 'react';
import { Film, Play, Star, Tv as TvIcon } from 'lucide-react';

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
  const [loaded, setLoaded] = useState(false);
  const showImg = image && !err;
  const Fallback = variant === 'series' ? TvIcon : Film;
  const ratingNum = rating != null && rating !== '' ? Number(rating) : null;
  const showRating = ratingNum != null && !Number.isNaN(ratingNum) && ratingNum > 0;

  return (
    <div
      data-focused={isFocused ? 'true' : 'false'}
      onMouseEnter={onFocus}
      onClick={onActivate}
      className={`
        tv-ring relative rounded-2xl overflow-hidden cursor-pointer
        transition-transform duration-200 ease-out will-change-transform
        bg-black/40 border border-white/10
        ${isFocused
          ? 'scale-[1.08] z-10'
          : 'hover:scale-[1.02]'}
      `}
      style={{ aspectRatio: '2 / 3' }}
    >
      {showImg ? (
        <>
          {!loaded && (
            <div className="absolute inset-0 bg-gradient-to-br from-brand-navy/60 to-black/80 animate-pulse" />
          )}
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setErr(true)}
            className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-brand-navy/60 to-black/80">
          <Fallback className="w-12 h-12 text-brand-ice/40" />
        </div>
      )}

      {showRating && (
        <span className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-black/75 text-xs font-nunito text-brand-gold font-semibold">
          <Star className="w-3 h-3 fill-brand-gold" /> {ratingNum!.toFixed(1)}
        </span>
      )}

      {isFocused && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 animate-fade-in pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-brand-gold/90 flex items-center justify-center shadow-lg">
            <Play className="w-6 h-6 text-brand-navy fill-brand-navy" />
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 py-2 px-3 bg-gradient-to-t from-black/95 via-black/70 to-transparent">
        <p className={`text-xs sm:text-sm font-quicksand font-semibold line-clamp-2 leading-tight ${isFocused ? 'text-brand-gold' : 'text-white'}`}>
          {title}
        </p>
        {year && (
          <p className="text-xs text-brand-ice/70 font-nunito mt-1">{year}</p>
        )}
      </div>
    </div>
  );
});

PosterCard.displayName = 'PosterCard';
export default PosterCard;
