import { Clapperboard, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { TrailerTarget } from '@/lib/trailer';

interface Props {
  /** What it opens (lib/trailer: movieTrailer / seriesTrailer); null: not drawn. */
  target: TrailerTarget | null;
  /** The remote's highlight is on it (the page's own key handler moves it). */
  focused: boolean;
  /** A tap or a click: the page moves its highlight here and opens it. */
  onPress: () => void;
  /** Which page's button (data-detail-btn, the series page's keepInView). */
  detailBtn?: string;
  /** The look of the buttons beside it. */
  className?: string;
}

/**
 * "Trailer" on a film's or a series' page, on its own line under the play
 * buttons (Tronix 78d8b7d, 1039497). With the panel's video it says "Watch
 * trailer" to a screen reader and shows a clapperboard; without, "Find the
 * trailer" and a magnifier (it opens a search outside the app).
 */
export default function TrailerButton({ target, focused, onPress, detailBtn, className = '' }: Props) {
  const { t } = useTranslation();
  if (!target) return null;
  const label = target.kind === 'video' ? t('live.trailer.watch') : t('live.trailer.find');
  const Icon = target.kind === 'video' ? Clapperboard : Search;
  return (
    <Button
      type="button"
      variant="outline"
      data-trailer={target.kind}
      data-detail-btn={detailBtn}
      data-focused={focused ? 'true' : 'false'}
      aria-label={label}
      title={label}
      onClick={onPress}
      className={className}
    >
      <Icon className="w-4 h-4 mr-2" aria-hidden="true" />
      <span className="min-w-0 truncate">{t('live.trailer.openBtn')}</span>
    </Button>
  );
}
