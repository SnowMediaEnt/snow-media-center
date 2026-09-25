// One poster in a Plex rail or grid: cover art, resolution chip, resume
// progress, and a one- or two-line caption UNDER the art rather than over it.
// Shared by the Home rails, the library rails and the filtered grid so the
// three cannot drift apart again.
import { memo } from 'react';
import PlexImage from './PlexImage';
import { POSTER_TILE_H, POSTER_TILE_W, resolutionLabel, type PlexItem } from '@/lib/plex';

const POSTER_GRID_W = 280;
const POSTER_GRID_H = 420;
import { tileCaption, resumeFraction } from '@/lib/plexLibraryRows';
import { revealPlexTile } from '@/lib/plexReveal';

interface Props {
  item: PlexItem;
  base: string;
  token: string;
  focused: boolean;
  /** Rail tiles are fixed-width; grid tiles fill their column. */
  width?: 'rail' | 'fill';
  onClick?: () => void;
  /** Like onClick, but handed the item: lets a rail pass ONE stable handler
   *  to every tile instead of a fresh closure per tile per render, so a
   *  cursor move does not re-render a hundred memoised tiles. */
  onSelect?: (item: PlexItem) => void;
  /** Start loading this poster now (the next few tiles along a rail). */
  eager?: boolean;
  /** The focused tile scrolls itself into view. Rails need it; the grid's
   *  own scroller handles the grid. */
  scrollIntoView?: boolean;
}

const PlexPosterTile = memo(({ item, base, token, focused, width = 'rail', onClick, onSelect, eager = false, scrollIntoView = true }: Props) => {
  const label = resolutionLabel(item.videoResolution);
  const cap = tileCaption(item);
  const progress = resumeFraction(item);
  return (
    <div
      // Not the browser's scrollIntoView: it also scrolled the boxes around
      // the Plex screen, which then sat partly above the TV (plexReveal.ts).
      ref={(el) => { if (scrollIntoView && focused && el) revealPlexTile(el); }}
      onClick={onSelect ? () => onSelect(item) : onClick}
      className={`plex-tile cursor-pointer ${width === 'rail' ? 'flex-shrink-0 w-[104px]' : 'plex-tile--fill w-full'}`}
    >
      {/* The 2:3 box is drawn with padding-bottom, not aspect-ratio: `aspect-ratio`
          is Chrome 88, and on the Chromium 66 WebView of the older boxes a box
          sized only by it is 0 px tall until its image lands — so every poster
          arrival grew a tile and re-laid the whole rail column, forty times over
          the first ten seconds. Padding sizes the box before any image exists.
          The focus marker sits on the ART, not the tile: the lift, ring and
          shadow belong to the poster (plex.css), and a data-focused tile picked
          up the global square safety-net ring around poster and caption both. */}
      <div
        data-focused={focused ? 'true' : 'false'}
        className="plex-art tv-ring h-0"
        style={{ paddingBottom: '150%' }}
      >
        {/* Grid tiles are drawn about twice as wide as rail tiles; asking for
            the rail size there upscaled every poster into a blur. Rails keep
            POSTER_TILE_W/H, which the settle screen preloads. */}
        <PlexImage base={base} path={item.thumb} token={token}
          w={width === 'fill' ? POSTER_GRID_W : POSTER_TILE_W} h={width === 'fill' ? POSTER_GRID_H : POSTER_TILE_H}
          eager={eager} className="absolute inset-0 w-full h-full object-cover" />
        <span className="plex-sheen" aria-hidden="true" />
        {label ? (
          <div className={`plex-badge font-nunito ${label === '4K' ? 'text-brand-gold' : 'text-white/85'}`}>
            {label}
          </div>
        ) : null}
        {progress != null && (
          // Inline width, no CSS features — this has to paint on a Chromium 66 WebView.
          <div className="plex-progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      <div className={`plex-cap font-nunito font-semibold truncate ${focused ? 'text-brand-gold' : 'text-white/90'}`}>
        {cap.line1}
      </div>
      {cap.line2 ? (
        <div className="plex-sub font-nunito text-brand-ice/60 truncate">{cap.line2}</div>
      ) : null}
    </div>
  );
});

PlexPosterTile.displayName = 'PlexPosterTile';
export default PlexPosterTile;
