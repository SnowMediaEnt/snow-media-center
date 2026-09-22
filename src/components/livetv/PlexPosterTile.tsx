// One poster in a Plex rail or grid: cover art, resolution chip, resume
// progress, and a one- or two-line caption UNDER the art rather than over it.
// Shared by the Home rails, the library rails and the filtered grid so the
// three cannot drift apart again.
import { memo } from 'react';
import PlexImage from './PlexImage';
import { POSTER_TILE_H, POSTER_TILE_W, resolutionLabel, type PlexItem } from '@/lib/plex';
import { tileCaption, resumeFraction } from '@/lib/plexLibraryRows';

interface Props {
  item: PlexItem;
  base: string;
  token: string;
  focused: boolean;
  /** Rail tiles are fixed-width; grid tiles fill their column. */
  width?: 'rail' | 'fill';
  onClick?: () => void;
  /** The focused tile scrolls itself into view. Rails need it; the grid's
   *  own scroller handles the grid. */
  scrollIntoView?: boolean;
}

const PlexPosterTile = memo(({ item, base, token, focused, width = 'rail', onClick, scrollIntoView = true }: Props) => {
  const label = resolutionLabel(item.videoResolution);
  const cap = tileCaption(item);
  const progress = resumeFraction(item);
  return (
    <div
      ref={(el) => { if (scrollIntoView && focused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
      onClick={onClick}
      data-focused={focused ? 'true' : 'false'}
      className={`plex-tile cursor-pointer ${width === 'rail' ? 'flex-shrink-0 w-[104px]' : 'w-full'}`}
    >
      <div className={`tv-ring relative aspect-[2/3] rounded-lg overflow-hidden bg-black/40 border border-white/10 ${focused ? 'scale-[1.05] z-10' : ''}`}>
        <PlexImage base={base} path={item.thumb} token={token} w={POSTER_TILE_W} h={POSTER_TILE_H} className="w-full h-full object-cover" />
        {label ? (
          <div className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/75 text-xs font-bold font-nunito ${label === '4K' ? 'text-brand-gold' : 'text-white/85'}`}>
            {label}
          </div>
        ) : null}
        {progress != null && (
          // Inline width, no CSS features — this has to paint on a Chromium 66 WebView.
          <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-black/60">
            <div className="h-full bg-brand-gold" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      <div className={`mt-1.5 px-0.5 text-xs font-nunito font-semibold truncate ${focused ? 'text-brand-gold' : 'text-white/90'}`}>
        {cap.line1}
      </div>
      {cap.line2 ? (
        <div className="px-0.5 text-xs font-nunito text-brand-ice/70 truncate">{cap.line2}</div>
      ) : null}
    </div>
  );
});

PlexPosterTile.displayName = 'PlexPosterTile';
export default PlexPosterTile;
