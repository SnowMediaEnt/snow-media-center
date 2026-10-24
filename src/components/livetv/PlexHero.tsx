// The top of a Plex rails page, drawn as the Apple TV app draws it (Snow TV
// tvOS: PlexSection.heroInfo and the library / Discover page titles):
//   PlexHeroInfo   Home: the highlighted title, large, a line of facts
//                  (year · certificate · runtime, or the episode), and one
//                  line of its summary, over its art (PlexBackdrop).
//   PlexPageTitle  Discover, the season, a library: the page's own name.
// Both sit above the Plex scroller, so the rails scroll under them and they
// never move.
//
// PlexHeroInfo follows the highlight through the backdrop's settle bus
// (plexBackdrop.onPlexHero): a held D-pad re-renders nothing here until the
// highlight rests, and then only these few lines of text. Its box has a fixed
// height (plex.css), so a title with no summary never moves the rails.
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlexItem } from '@/lib/plex';
import { onPlexHero, setPlexHero } from '@/lib/plexBackdrop';
import { heroFacts, tileCaption } from '@/lib/plexLibraryRows';

export const PlexHeroInfo = memo(() => {
  // Re-drawn in a new language (the facts come from i18n.t).
  useTranslation();
  // Starts empty: the title from another page must not show here. Home's
  // rails name their first title once they land, and the highlight after that.
  const [it, setIt] = useState<PlexItem | null>(null);
  useEffect(() => {
    setPlexHero(null);
    return onPlexHero(setIt);
  }, []);
  if (!it) return <div data-plex-hero="" className="plex-hero" aria-hidden="true" />;
  const cap = tileCaption(it);
  const facts = heroFacts(it);
  // A list payload may come without the summary: the genres say something.
  const about = it.summary || (it.genres && it.genres.length ? it.genres.slice(0, 4).join(', ') : '');
  return (
    <div data-plex-hero="" className="plex-hero">
      <div className="plex-hero-title font-montserrat truncate">{cap.line1}</div>
      {facts.length > 0 && <div className="plex-hero-meta font-nunito truncate">{facts.join('  ·  ')}</div>}
      {about ? <p className="plex-hero-sum font-nunito">{about}</p> : null}
    </div>
  );
});
PlexHeroInfo.displayName = 'PlexHeroInfo';

export const PlexPageTitle = memo(({ title }: { title: string }) => (
  <div data-plex-page-title="" className="plex-page-title font-montserrat truncate">{title}</div>
));
PlexPageTitle.displayName = 'PlexPageTitle';
