// The strip above the Plex rails: whatever poster is highlighted, described.
// Cover art, where it came from, title, rating, year, runtime, certificate,
// resolution, genres, a two-line summary, and how much is left for anything
// partly watched. Nothing here is focusable — it only reflects the rails.
//
// The faint backdrop wash behind the strip is skipped on low-memory devices:
// a 640px art image per highlight change is exactly the kind of decode a
// 1GB stick cannot afford while it is also loading a row of posters.
import { memo, useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import PlexImage from './PlexImage';
import { resolutionLabel, type PlexItem } from '@/lib/plex';
import { tileCaption, resumeFraction } from '@/lib/plexLibraryRows';

export interface PlexHighlight {
  item: PlexItem;
  /** Row title the item was highlighted in ("Continue Watching"). */
  from?: string;
}

interface Props {
  highlight: PlexHighlight | null;
  base: string;
  token: string;
}

const runtime = (ms?: number): string => {
  if (!ms || ms <= 0) return '';
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
};

const timeLeft = (it: PlexItem): string => {
  if (!it.duration || !it.viewOffset) return '';
  const left = Math.max(0, Math.round((it.duration - it.viewOffset) / 60000));
  const h = Math.floor(left / 60);
  const m = left % 60;
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m left` : `${m}m left`;
};

const kindLabel = (it: PlexItem): string =>
  it.type === 'show' ? 'SERIES' : it.type === 'episode' ? 'EPISODE' : 'MOVIE';

const lowMemory = (): boolean => {
  try { return document.documentElement.classList.contains('native-low-memory'); } catch { return false; }
};

const PlexHighlightStrip = memo(({ highlight, base, token }: Props) => {
  // The art wash only for the item that has been highlighted for a moment —
  // arrowing quickly along a rail must not fire an art request per tile.
  const [washFor, setWashFor] = useState<PlexItem | null>(null);
  const item = highlight?.item ?? null;
  useEffect(() => {
    if (!item || !item.art || lowMemory()) { setWashFor(null); return; }
    const t = window.setTimeout(() => setWashFor(item), 350);
    return () => window.clearTimeout(t);
  }, [item]);

  if (!item) {
    return (
      <div className="relative flex-shrink-0 h-[176px] px-6 pt-4 flex items-end">
        <p className="text-sm font-nunito text-brand-ice/60 pb-2">Highlight a title to see what it is.</p>
      </div>
    );
  }

  const cap = tileCaption(item);
  const res = resolutionLabel(item.videoResolution);
  const left = timeLeft(item);
  const progress = resumeFraction(item);
  const dur = runtime(item.duration);
  const episodeLine = item.type === 'episode' && cap.line2 ? `${cap.line2} · ${item.title}` : null;

  return (
    <div className="relative flex-shrink-0 h-[176px] overflow-hidden">
      {washFor && washFor.art && (
        <div className="plex-wash absolute inset-0 pointer-events-none" aria-hidden="true">
          <PlexImage base={base} path={washFor.art} token={token} w={640} h={360} focusExempt className="w-full h-full object-cover opacity-40" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(10,15,26,1) 0%, rgba(10,15,26,0.75) 40%, rgba(10,15,26,0.2) 100%), linear-gradient(0deg, rgba(10,15,26,1) 0%, rgba(10,15,26,0) 60%)' }} />
        </div>
      )}
      <div className="relative h-full flex gap-5 px-6 pt-4">
        <div className="relative w-[100px] h-[150px] flex-shrink-0 rounded-lg overflow-hidden bg-black/40 border border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
          <PlexImage base={base} path={item.thumb} token={token} w={140} h={210} className="w-full h-full object-cover" priority />
          {res ? (
            <div className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/75 text-xs font-bold font-nunito ${res === '4K' ? 'text-brand-gold' : 'text-white/85'}`}>{res}</div>
          ) : null}
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-xs font-quicksand font-semibold tracking-[0.12em] text-brand-gold uppercase truncate">
            {highlight?.from ? `${highlight.from} · ` : ''}{kindLabel(item)}
          </p>
          <h2 className="mt-1 text-2xl font-quicksand font-bold text-white truncate leading-tight">{cap.line1}</h2>
          {episodeLine && <p className="text-sm font-nunito text-brand-ice/80 truncate">{episodeLine}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-nunito text-brand-ice/80">
            {item.rating != null && item.rating > 0 && (
              <span className="flex items-center gap-1 text-brand-gold font-bold"><Star className="w-3.5 h-3.5 fill-brand-gold" />{item.rating.toFixed(1)}</span>
            )}
            {item.year ? <span>{item.year}</span> : null}
            {dur ? <span>{dur}</span> : null}
            {item.contentRating ? <span className="px-1.5 rounded border border-white/25 text-xs text-white/90 leading-5">{item.contentRating}</span> : null}
            {item.genres && item.genres.length > 0 ? <span className="truncate">{item.genres.join(' · ')}</span> : null}
          </div>
          {item.summary ? (
            <p className="mt-2 text-sm font-nunito text-white/75 leading-snug line-clamp-2 max-w-3xl">{item.summary}</p>
          ) : null}
          {progress != null && (
            <div className="mt-2 flex items-center gap-3 text-sm font-nunito text-brand-ice/80">
              <span className="w-40 h-[3px] rounded-full bg-white/20 overflow-hidden">
                <span className="block h-full bg-brand-gold" style={{ width: `${Math.round(progress * 100)}%` }} />
              </span>
              {left ? <span>{left}</span> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

PlexHighlightStrip.displayName = 'PlexHighlightStrip';
export default PlexHighlightStrip;
