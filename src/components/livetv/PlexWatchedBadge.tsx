// The watched check on Plex art: a round gold badge with a navy check in the
// top-right corner of a poster, an episode's thumbnail or a season (plex.css
// .plex-watched), the same gold check as the other libraries' posters. The
// resolution chip that shares the corner steps down under it
// (.plex-badge--under).
import { memo } from 'react';
import { Check } from 'lucide-react';
import i18n from '@/i18n';

interface Props {
  /** A season or a show: every episode in it, not one title. */
  all?: boolean;
  /** The title page's big poster. */
  large?: boolean;
}

// i18n.t, not useTranslation: hundreds of tiles may draw one, and a hook per
// badge would put a language listener on each.
const PlexWatchedBadge = memo(({ all = false, large = false }: Props) => (
  <span
    data-watched=""
    role="img"
    aria-label={i18n.t(all ? 'plex.detail.allWatched' : 'plex.detail.watchedMark')}
    className={`plex-watched${large ? ' plex-watched--lg' : ''}`}
  >
    <Check strokeWidth={3} aria-hidden="true" />
  </span>
));
PlexWatchedBadge.displayName = 'PlexWatchedBadge';
export default PlexWatchedBadge;
