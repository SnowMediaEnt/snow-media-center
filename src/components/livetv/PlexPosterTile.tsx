// One poster in a Plex rail or grid: cover art, resolution chip, resume
// progress, the watched check, and a one- or two-line caption UNDER the art
// rather than over it. Drawn as the Apple TV app draws its Plex tiles
// (plex.css): a 2:3 poster, or for Continue Watching a wide 16:9 still;
// focused, it lifts, rings in gold and shows a gold play disc.
// Shared by the Home rails, the library rails and the filtered grid so the
// three cannot drift apart again.
// A finger held on it opens its menu (Recommend to others, plexRecommendHold);
// on Discover's "Recommended by viewers" it shows how many viewers did.
import { memo } from 'react';
import { Play, ThumbsUp } from 'lucide-react';
import i18n from '@/i18n';
import PlexImage from './PlexImage';
import PlexWatchedBadge from './PlexWatchedBadge';
import { tapIsHoldLift, tileHoldProps } from './plexRecommendHold';
import { POSTER_TILE_H, POSTER_TILE_W, resolutionLabel, type PlexItem } from '@/lib/plex';
import { tileCaption, resumeFraction } from '@/lib/plexLibraryRows';
import { revealPlexTile } from '@/lib/plexReveal';

const POSTER_GRID_W = 280;
const POSTER_GRID_H = 420;
// A wide still is drawn 200 × 112 (plex.css .plex-tile--wide); asked for at
// twice that, a little less on a low-memory box.
const LOW_MEMORY = typeof document !== 'undefined' && document.documentElement.classList.contains('native-low-memory');
const WIDE_W = LOW_MEMORY ? 320 : 400;
const WIDE_H = LOW_MEMORY ? 180 : 225;

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
  /** This viewer watched it (plexProgress.plexItemWatched; a show: every
   *  episode). Worked out by the list, once for all its tiles. */
  watched?: boolean;
  /** A wide 16:9 still (its art) instead of the poster: Continue Watching. */
  wide?: boolean;
}

const PlexPosterTile = memo(({ item, base, token, focused, width = 'rail', onClick, onSelect, eager = false, scrollIntoView = true, watched = false, wide = false }: Props) => {
  const label = resolutionLabel(item.videoResolution);
  const cap = tileCaption(item);
  const progress = resumeFraction(item);
  const recs = item.recommenders ?? 0;
  return (
    <div
      // Not the browser's scrollIntoView: it also scrolled the boxes around
      // the Plex screen, which then sat partly above the TV (plexReveal.ts).
      ref={(el) => { if (scrollIntoView && focused && el) revealPlexTile(el); }}
      {...tileHoldProps(item)}
      // The lift of a finger whose hold just opened the menu is not a tap.
      onClick={() => { if (tapIsHoldLift()) return; if (onSelect) onSelect(item); else onClick?.(); }}
      className={`plex-tile cursor-pointer ${width === 'rail' ? (wide ? 'plex-tile--wide' : 'plex-tile--rail') : 'plex-tile--fill w-full'}`}
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
        style={{ paddingBottom: wide ? '56.25%' : '150%' }}
      >
        {/* Grid tiles are drawn about twice as wide as rail tiles; asking for
            the rail size there upscaled every poster into a blur. Rails keep
            POSTER_TILE_W/H, which the settle screen preloads. */}
        {/* A wide still is the title's art (an episode's: its show's), as
            on the Apple TV; with none, the poster cropped. */}
        <PlexImage base={base} path={wide ? item.art || item.thumb : item.thumb} token={token}
          w={wide ? WIDE_W : width === 'fill' ? POSTER_GRID_W : POSTER_TILE_W} h={wide ? WIDE_H : width === 'fill' ? POSTER_GRID_H : POSTER_TILE_H}
          eager={eager} className="absolute inset-0 w-full h-full object-cover" />
        <span className="plex-sheen" aria-hidden="true" />
        {watched ? <PlexWatchedBadge all={item.type === 'show'} /> : null}
        {/* Top-left, clear of the watched check and the resolution chip
            (top-right) and the resume bar (bottom). i18n.t, not a hook: a
            rail draws dozens of these. */}
        {recs > 0 ? (
          <span className="plex-recs font-nunito" role="img" aria-label={i18n.t('plex.recommend.count', { count: recs })}>
            <ThumbsUp aria-hidden="true" />{recs}
          </span>
        ) : null}
        {label ? (
          <div className={`plex-badge${watched ? ' plex-badge--under' : ''} font-nunito ${label === '4K' ? 'text-brand-gold' : 'text-white/85'}`}>
            {label}
          </div>
        ) : null}
        {progress != null && (
          // Inline width, no CSS features — this has to paint on a Chromium 66 WebView.
          <div className="plex-progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {/* The focused poster's play disc (a still has its progress bar and
            its picture to say what OK does). */}
        {focused && !wide ? <span className="plex-play" style={{ position: 'absolute' }} aria-hidden="true"><Play className="fill-current" /></span> : null}
      </div>
      <div className={`plex-cap font-montserrat font-semibold truncate ${focused ? 'text-brand-gold' : 'text-white'}`}>
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
