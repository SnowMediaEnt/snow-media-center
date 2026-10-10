// The channel list over a full-screen channel: ◀ with the control bar hidden
// opens it on the channel that is playing, so the viewer can pick another
// channel without leaving the picture. Categories on the left, that
// category's channels on the right, the playing one marked.
//
// Drawing only: LiveSection owns the keys and the focus (it reuses its own
// category / channel state, so a category opened here loads exactly as it
// does in the list, after the same 1 s rest). Only a window of rows around
// the highlight is drawn: "All channels" can be thousands long, and a 2 GB box
// must not lay them out. Rows from several services ('Favorites · all
// services') carry their service's name. Chrome 66: margins, no flex gap
// beyond gap-1..4, no inset.
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Play, Star, Tv } from 'lucide-react';
import { formatCount } from '@/lib/catalogCounts';
import { isLongName, TWO_LINES } from '@/lib/channelName';
import type { ChannelReport } from '@/lib/channelStatus';
import type { XtreamLiveStream } from '@/lib/xtream';
import type { ChannelRowLabels } from './channelRowLabels';
import { listWindow } from './listWindow';

export interface OverlayCategory {
  id: string;
  /** What the row shows (Favorites and All channels already translated). */
  label: string;
  count?: number;
  isHeader?: boolean;
  collapsedHeader?: boolean;
  isFav?: boolean;
}

interface Props {
  pane: 'categories' | 'channels';
  categories: OverlayCategory[];
  categoryIdx: number;
  /** More than one service: a service's categories sit indented under its header. */
  grouped: boolean;
  channels: XtreamLiveStream[];
  channelIdx: number;
  /** Heading over the channels: the category's name, or "Search". */
  channelsTitle: string;
  loading: boolean;
  /** The channel on screen (its line too: two services can share an id). */
  isPlaying: (st: XtreamLiveStream) => boolean;
  isFavorite: (st: XtreamLiveStream) => boolean;
  /** What the others reported about it (down, its category down, buffering). */
  reportOf: (st: XtreamLiveStream) => ChannelReport;
  nowTitle: (st: XtreamLiveStream) => string | undefined;
  /** Which service a row is on, in a list that mixes them. */
  serviceTag?: (st: XtreamLiveStream) => string | undefined;
  labels: ChannelRowLabels;
}

/** Rows drawn at once in each column. */
export const OVERLAY_CAT_ROWS = 9;
export const OVERLAY_CHANNEL_ROWS = 7;

// The rows are 52 px with the programme line under the name: only the small
// size fits two lines there, so a name that would wrap at the big size (over
// ~20 characters in its column) takes the small size on up to two lines, and
// a short one stays on one line. No scrolling names.
const LONG_NAME = 20;
const nameClass = (name: string | null | undefined): string =>
  (isLongName(name, LONG_NAME) ? `text-[13px] ${TWO_LINES}` : 'text-lg truncate leading-tight');

const FullscreenChannelOverlay = memo(({
  pane, categories, categoryIdx, grouped, channels, channelIdx, channelsTitle, loading,
  isPlaying, isFavorite, reportOf, nowTitle, serviceTag, labels,
}: Props) => {
  const { t } = useTranslation();
  const cw = listWindow(categories.length, categoryIdx, OVERLAY_CAT_ROWS);
  const chw = listWindow(channels.length, channelIdx, OVERLAY_CHANNEL_ROWS);
  const onCats = pane === 'categories';

  return (
    <div
      data-channel-overlay
      className="absolute left-0 top-0 bottom-0 z-30 flex bg-black/90 border-r border-white/10 animate-fade-in pointer-events-auto"
      style={{ width: 660 }}
    >
      {/* Categories */}
      <div className={`flex-shrink-0 flex flex-col border-r border-white/10 pt-6 pb-4 px-3 ${onCats ? 'bg-white/5' : ''}`} style={{ width: 240 }}>
        <p className="px-2 pb-3 text-sm uppercase tracking-wide font-quicksand font-bold text-brand-gold">{t('live.overlay.categoriesTitle')}</p>
        {cw.start > 0 && <p className="text-center text-brand-ice/50 text-sm leading-none pb-1">▲</p>}
        <div className="space-y-1">
          {categories.slice(cw.start, cw.end).map((c, j) => {
            const i = cw.start + j;
            const focused = onCats && i === categoryIdx;
            const marked = !onCats && i === categoryIdx && !c.isHeader;
            return (
              <div
                key={c.id}
                data-overlay-cat={i}
                data-focused={focused ? 'true' : 'false'}
                className={`tv-ring flex items-center py-2 rounded-xl ${c.isHeader || !grouped ? 'px-3' : 'pl-6 pr-3'} ${focused ? 'bg-brand-gold/25 z-10' : c.isHeader ? 'bg-white/10' : ''}`}
              >
                {c.isHeader && (c.collapsedHeader
                  ? <ChevronRight className="w-4 h-4 mr-2 text-brand-gold flex-shrink-0" />
                  : <ChevronDown className="w-4 h-4 mr-2 text-brand-gold flex-shrink-0" />)}
                {c.isFav && <Star className="w-4 h-4 mr-2 text-brand-gold flex-shrink-0" />}
                <span className={`flex-1 min-w-0 truncate leading-snug ${
                  c.isHeader ? 'font-quicksand font-bold uppercase text-sm text-brand-gold'
                    : focused ? 'text-base font-nunito font-semibold text-white'
                      : marked ? 'text-base font-nunito font-semibold text-brand-gold' : 'text-base font-nunito text-brand-ice'}`}
                >
                  {c.label}
                </span>
                {!c.isHeader && c.count != null && c.count > 0 && (
                  <span className="ml-2 flex-shrink-0 text-xs font-nunito tabular-nums text-brand-ice/60">{formatCount(c.count)}</span>
                )}
              </div>
            );
          })}
        </div>
        {cw.end < categories.length && <p className="text-center text-brand-ice/50 text-sm leading-none pt-1">▼</p>}
      </div>

      {/* Channels */}
      <div className="flex-1 min-w-0 flex flex-col pt-6 pb-3 px-3">
        <div className="flex items-center px-2 pb-3">
          <p className="flex-1 min-w-0 truncate text-sm uppercase tracking-wide font-quicksand font-bold text-brand-gold">{channelsTitle}</p>
          {loading && <Loader2 className="w-4 h-4 ml-2 animate-spin text-brand-gold flex-shrink-0" />}
          {!loading && channels.length > 0 && (
            <span className="ml-2 text-sm font-nunito tabular-nums text-brand-ice/60">{channelIdx + 1} / {channels.length}</span>
          )}
        </div>
        {chw.start > 0 && <p className="text-center text-brand-ice/50 text-sm leading-none pb-1">▲</p>}
        <div className="flex-1 min-h-0 space-y-1">
          {channels.length === 0 && (
            <p className="px-3 py-4 text-lg font-nunito text-brand-ice/70">
              {loading ? t('live.list.loadingChannels') : onCats ? t('live.overlay.openCategoryHint') : t('live.overlay.noChannels')}
            </p>
          )}
          {channels.slice(chw.start, chw.end).map((st, j) => {
            const i = chw.start + j;
            const focused = !onCats && i === channelIdx;
            const playing = isPlaying(st);
            const report = reportOf(st);
            const flagged = report !== null;
            const flagText = report === 'buffering' ? 'text-amber-300' : 'text-red-300';
            const flagLabel = report === 'buffering' ? labels.buffering : report === 'category' ? labels.categoryDown : labels.down;
            const now = nowTitle(st);
            const service = serviceTag?.(st);
            return (
              <div
                key={`${st.stream_id}-${i}`}
                data-overlay-channel={st.stream_id}
                data-focused={focused ? 'true' : 'false'}
                className={`tv-ring flex items-center px-3 rounded-xl overflow-hidden ${focused ? 'bg-brand-gold/25 z-10' : playing ? 'bg-white/10' : ''}`}
                style={{ height: 52 }}
              >
                <span className="w-10 flex-shrink-0 text-base font-nunito tabular-nums text-brand-ice/60">{st.num ?? ''}</span>
                <div className="w-10 h-10 mr-3 flex-shrink-0 rounded-lg bg-black/60 flex items-center justify-center overflow-hidden">
                  {st.stream_icon
                    ? <img src={st.stream_icon} alt="" loading="lazy" decoding="async" className="w-full h-full object-contain" />
                    : <Tv className="w-5 h-5 text-brand-ice/50" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-nunito ${nameClass(st.name)} ${focused ? 'text-white font-semibold' : playing ? 'text-brand-gold font-semibold' : 'text-brand-ice'}`}>
                    {st.name}
                  </p>
                  <p className={`truncate text-sm leading-tight font-nunito ${flagged ? flagText : 'text-brand-ice/60'}`}>
                    {service ? <span className="text-brand-gold/80">{service}{flagged || now ? ' · ' : ''}</span> : null}
                    {flagged ? flagLabel : (now || (service ? '' : ' '))}
                  </p>
                </div>
                {flagged && <AlertTriangle className={`w-4 h-4 ml-2 flex-shrink-0 ${report === 'buffering' ? 'text-amber-400' : 'text-red-400'}`} aria-label={flagLabel} />}
                {isFavorite(st) && <Star className="w-4 h-4 ml-2 text-brand-gold fill-brand-gold flex-shrink-0" aria-label={t('live.overlay.favorite')} />}
                {playing && <Play className="w-4 h-4 ml-2 text-brand-gold fill-brand-gold flex-shrink-0" aria-label={t('live.overlay.playing')} />}
              </div>
            );
          })}
        </div>
        {chw.end < channels.length && <p className="text-center text-brand-ice/50 text-sm leading-none pb-1">▼</p>}
        <p className="px-2 pt-2 text-sm font-nunito text-brand-ice/60">
          {onCats ? t('live.overlay.hintCategories') : t('live.overlay.hintChannels')}
        </p>
      </div>
    </div>
  );
});

FullscreenChannelOverlay.displayName = 'FullscreenChannelOverlay';
export default FullscreenChannelOverlay;
