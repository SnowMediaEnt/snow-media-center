// Recently watched, as a panel: over the full-screen picture (▶ with the bar
// hidden) or over Live TV's list (▶ at its right edge). Newest first; the
// channel on screen marked. Drawing only: useRecentPanel owns the keys and
// the focus, LiveSection the channel change.
//
// The highlighted row shows its Remove (▶ moves onto it, OK takes the channel
// off; hold OK on the row does the same). Over the picture it lets a little
// of it through, as the channel list over the picture does; over the list it
// is solid, so the rows behind never show through it.
//
// Only a window of rows around the highlight is drawn (10 rows at most
// anyway). Chrome 66: margins, no flex gap beyond gap-1..4, no inset.
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { History, Play, Tv, X } from 'lucide-react';
import { isLongName, TWO_LINES } from '@/lib/channelName';
import type { RecentChannel } from '@/lib/recentChannels';
import { listWindow } from './listWindow';

interface Props {
  items: RecentChannel[];
  focus: number;
  /** The highlight is on the focused row's Remove. */
  onRemove: boolean;
  /** recentChannelId of the channel on screen. */
  playingId: string | null;
  /** Over the full-screen picture, or over Live TV's list. */
  over: 'picture' | 'list';
  /** With more than one service, each row says which one it is on. */
  serviceOf?: (c: RecentChannel) => string | undefined;
}

/** Rows drawn at once. */
export const RECENT_PANEL_ROWS = 7;

// A name that would wrap at the row's size is drawn a step smaller on up to
// two lines (lib/channelName); no scrolling names.
const LONG_NAME = 26;
const nameClass = (name: string): string =>
  (isLongName(name, LONG_NAME) ? `text-[13px] ${TWO_LINES}` : 'text-lg truncate leading-tight');

const RecentChannelsPanel = memo(({ items, focus, onRemove, playingId, over, serviceOf }: Props) => {
  const { t } = useTranslation();
  const win = listWindow(items.length, focus, RECENT_PANEL_ROWS);
  const place = over === 'picture' ? 'absolute z-30 bg-black/90' : 'fixed z-[55] bg-[#0b1220] shadow-2xl';
  return (
    <div
      data-recent-panel={over}
      role="region"
      aria-label={t('live.recent.title')}
      className={`${place} right-0 top-0 bottom-0 flex flex-col border-l border-white/10 text-white animate-fade-in pointer-events-auto`}
      style={{ width: 440 }}
    >
      <div className="flex items-center flex-shrink-0 px-5 pt-6 pb-3">
        <History className="w-5 h-5 mr-2 text-brand-gold flex-shrink-0" />
        <p className="flex-1 min-w-0 truncate text-sm uppercase tracking-wide font-quicksand font-bold text-brand-gold">{t('live.recent.title')}</p>
        {items.length > 0 && (
          <span className="ml-2 text-sm font-nunito tabular-nums text-brand-ice/60">{Math.min(focus + 1, items.length)} / {items.length}</span>
        )}
      </div>

      {win.start > 0 && <p className="text-center text-brand-ice/50 text-sm leading-none pb-1">▲</p>}
      <div className="flex-1 min-h-0 px-3 space-y-1">
        {items.length === 0 && (
          <p className="px-3 py-4 text-lg font-nunito text-brand-ice/70">{t('live.recent.empty')}</p>
        )}
        {items.slice(win.start, win.end).map((c, j) => {
          const i = win.start + j;
          const focused = i === focus;
          const rowFocused = focused && !onRemove;
          const removeFocused = focused && onRemove;
          const playing = c.id === playingId;
          const service = serviceOf?.(c);
          const sub = [service, c.category].filter(Boolean).join(' · ');
          return (
            <div
              key={c.id}
              data-recent-row={c.id}
              data-focused={rowFocused ? 'true' : 'false'}
              className={`tv-ring flex items-center px-3 rounded-xl ${rowFocused ? 'bg-brand-gold/25 z-10' : focused ? 'bg-white/10' : playing ? 'bg-white/5' : ''}`}
              style={{ height: 56 }}
            >
              <span className="w-10 flex-shrink-0 text-base font-nunito tabular-nums text-brand-ice/60">{c.num ?? ''}</span>
              <div className="w-10 h-10 mr-3 flex-shrink-0 rounded-lg bg-black/60 flex items-center justify-center overflow-hidden">
                {c.icon
                  ? <img src={c.icon} alt="" loading="lazy" decoding="async" className="w-full h-full object-contain" />
                  : <Tv className="w-5 h-5 text-brand-ice/50" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-nunito ${nameClass(c.name)} ${rowFocused ? 'text-white font-semibold' : playing ? 'text-brand-gold font-semibold' : 'text-brand-ice'}`}>
                  {c.name}
                </p>
                <p className="truncate text-sm leading-tight font-nunito text-brand-ice/60">{sub || ' '}</p>
              </div>
              {playing && <Play className="w-4 h-4 ml-2 text-brand-gold fill-brand-gold flex-shrink-0" aria-label={t('live.overlay.playing')} />}
              {focused && (
                <span
                  data-recent-remove={c.id}
                  data-focused={removeFocused ? 'true' : 'false'}
                  aria-label={t('live.recent.removeNamed', { name: c.name })}
                  className={`tv-ring ml-2 flex items-center flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-nunito font-semibold ${removeFocused ? 'bg-brand-gold text-brand-navy z-10' : 'bg-white/10 text-brand-ice/80'}`}
                >
                  <X className="w-4 h-4 mr-1" />
                  {t('live.recent.remove')}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {win.end < items.length && <p className="text-center text-brand-ice/50 text-sm leading-none pb-1">▼</p>}
      <p className="flex-shrink-0 px-5 pt-2 pb-4 text-sm font-nunito text-brand-ice/60">
        {onRemove ? t('live.recent.hintRemove') : t('live.recent.hint')}
      </p>
    </div>
  );
});

RecentChannelsPanel.displayName = 'RecentChannelsPanel';
export default RecentChannelsPanel;
