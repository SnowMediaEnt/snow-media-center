// The channel list over a full-screen channel: ◀ with the control bar hidden
// opens it on the channel that is playing, so the viewer can pick another
// channel without leaving the picture. It opens as the list alone (the
// playing one marked), its categories folded to a slim strip at its edge;
// ◀ again opens them beside it, picking one shows that list alone again, and
// Back folds them away before it closes the list (from Tronix, whose dealer
// asked: "the category column should be compressed on first left arrow,
// appear if user left arrows again").
//
// Its backdrop is black at 60%, so the picture shows through it (it was 0.9;
// owner, 2026-10-11: "no not solid black, the ability to see through it
// more"). A soft shadow under the text keeps it readable over a bright
// picture.
//
// Its first row is "Search channels" (useOverlaySearch): ▲ from the first
// channel reaches it, and OK there types a search without leaving the
// picture. The results are the list's rows under it. While the keyboard is
// up (Amazon's covers the bottom half of the screen) the list draws only the
// field and the first few results, a little smaller, in the top half; once
// it goes away the list is drawn as ever, the field still its first row.
//
// Drawing only: LiveSection owns the keys and the focus (it reuses its own
// category / channel state, so a category opened here loads exactly as it
// does in the list, after the same 1 s rest). Only a window of rows around
// the highlight is drawn: "All channels" can be thousands long, and a 2 GB box
// must not lay them out. Rows from several services ('Favorites · all
// services', a search) carry their service's name. Chrome 66: margins, no
// flex gap beyond gap-1..4, no inset.
import { memo } from 'react';
import type { FocusEvent as ReactFocusEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, ChevronRight, LayoutList, Loader2, Play, Search, Star, Tv } from 'lucide-react';
import { formatCount } from '@/lib/catalogCounts';
import { isLongName, TWO_LINES } from '@/lib/channelName';
import type { ChannelReport } from '@/lib/channelStatus';
import type { XtreamLiveStream } from '@/lib/xtream';
import type { ChannelRowLabels } from './channelRowLabels';
import { listWindow, OVERLAY_CAT_ROWS, overlayChannelWindow } from './listWindow';

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
  /** Where the highlight is; the categories column is drawn only on
   *  'categories' (a slim strip stands for it otherwise). */
  pane: 'categories' | 'channels';
  /** The categories were opened over the list: Back puts the list back (the hint says so). */
  catsBack?: boolean;
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
  /** The "Search channels" row at the top of the list (none: no such row). */
  search?: OverlaySearchRow;
}

/** The Search row: the field where a search is typed over the picture. */
export interface OverlaySearchRow {
  /** The highlight is on it. */
  focused: boolean;
  /** The keyboard is up on it: the field and the first results in the top half. */
  typing: boolean;
  /** A search is open: the field shows what is typed, the list is its results. */
  open: boolean;
  query: string;
  /** Back leaves the search (it was opened here) rather than closing the list. */
  backLeaves: boolean;
  inputRef: RefObject<HTMLInputElement>;
  onChange: (q: string) => void;
  onFocus: (e: ReactFocusEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}

// How many rows each column draws, and the channels' window with its Search
// row (overlayChannelWindow): listWindow.ts, which LiveSection reads too.
const ROW_H = 52;
const TYPING_FIELD_H = 44;
const TYPING_ROW_H = 40;

/** Its columns (px): the categories, the channels; the strip that stands for
 *  the categories while they are folded away. */
export const OVERLAY_CATS_W = 240;
export const OVERLAY_CHANNELS_W = 420;
export const OVERLAY_STRIP_W = 40;
/** Black at 60% lets the picture through; this shadow keeps the text readable over it. */
export const OVER_PICTURE_TEXT_SHADOW = '0 1px 2px rgba(0, 0, 0, 0.8)';

// The rows are 52 px with the programme line under the name: only the small
// size fits two lines there, so a name that would wrap at the big size (over
// ~20 characters in its column) takes the small size on up to two lines, and
// a short one stays on one line. No scrolling names.
const LONG_NAME = 20;
const nameClass = (name: string | null | undefined): string =>
  (isLongName(name, LONG_NAME) ? `text-[13px] ${TWO_LINES}` : 'text-lg truncate leading-tight');

/** The Search row: a field in the list's first place. Read-only until OK
 *  opens the keyboard on it (useOverlaySearch), so a box that focuses it by
 *  itself raises no keyboard. */
const SearchRow = ({ s, count }: { s: OverlaySearchRow; count: number }) => {
  const { t } = useTranslation();
  return (
    <div
      data-overlay-search=""
      data-focused={s.focused ? 'true' : 'false'}
      // A tap here is not a tap on the picture (which brings the bar up).
      onClick={(e) => e.stopPropagation()}
      className={`tv-ring flex items-center px-3 rounded-xl overflow-hidden border ${
        s.typing ? 'border-brand-gold bg-black/60 z-10' : s.focused ? 'border-transparent bg-brand-gold/25 z-10' : 'border-white/15 bg-black/30'}`}
      style={{ height: s.typing ? TYPING_FIELD_H : ROW_H }}
    >
      <span className="w-10 flex-shrink-0 flex items-center"><Search className="w-5 h-5 text-brand-gold" /></span>
      <input
        ref={s.inputRef}
        data-overlay-search-input=""
        type="text"
        value={s.query}
        readOnly={!s.typing}
        tabIndex={-1}
        onChange={(e) => s.onChange(e.target.value)}
        onFocus={s.onFocus}
        onBlur={s.onBlur}
        placeholder={s.open || s.typing ? t('live.list.searchPlaceholder') : t('live.list.searchChannelsBtn')}
        aria-label={t('live.list.searchChannelsBtn')}
        className={`flex-1 min-w-0 bg-transparent border-0 p-0 font-nunito text-lg focus:outline-none ${
          s.focused || s.typing ? 'text-white placeholder:text-white/90' : 'text-brand-ice placeholder:text-brand-ice'}`}
      />
      {s.typing && s.query && count > 0 && (
        <span className="ml-2 flex-shrink-0 text-sm font-nunito tabular-nums text-brand-ice/85">{formatCount(count)}</span>
      )}
    </div>
  );
};

/** The categories folded away: a slim strip at the list's edge with their name. */
const CategoriesStrip = () => {
  const { t } = useTranslation();
  return (
    <div
      data-overlay-cats-strip
      className="flex-shrink-0 flex flex-col items-center pt-6 border-r border-white/10 overflow-hidden"
      style={{ width: OVERLAY_STRIP_W }}
    >
      <LayoutList className="w-5 h-5 text-brand-gold flex-shrink-0" />
      <span
        className="mt-3 text-sm uppercase tracking-wide font-quicksand font-bold text-brand-gold/80 whitespace-nowrap"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {t('live.overlay.categoriesTitle')}
      </span>
    </div>
  );
};

const FullscreenChannelOverlay = memo(({
  pane, catsBack, categories, categoryIdx, grouped, channels, channelIdx, channelsTitle, loading,
  isPlaying, isFavorite, reportOf, nowTitle, serviceTag, labels, search,
}: Props) => {
  const { t } = useTranslation();
  const cw = listWindow(categories.length, categoryIdx, OVERLAY_CAT_ROWS);
  // The categories are drawn only while the highlight is in them.
  const onCats = pane === 'categories';
  const typing = !!search?.typing;
  const onSearch = !onCats && !!search?.focused;
  // The list's places: the Search row first (when there is one), then the
  // channels. While typing: the field and the first few results only.
  const lead = search ? 1 : 0;
  const chw = overlayChannelWindow(channels.length, channelIdx, search ? { onSearch, typing } : null);
  const { searchShown, from, to } = chw;
  const emptyText = loading
    ? (search?.open ? t('live.list.loadingCatalog') : t('live.list.loadingChannels'))
    : search?.open
      ? (search.query ? t('live.list.noMatch') : t('live.list.typeToSearch'))
      : onCats ? t('live.overlay.openCategoryHint') : t('live.overlay.noChannels');
  const hint = onCats ? (catsBack ? t('live.overlay.hintCategoriesBack') : t('live.overlay.hintCategories'))
    : typing ? t('live.overlay.hintSearchTyping')
      : onSearch
        ? (search?.open ? (search.backLeaves ? t('live.overlay.hintSearchField') : t('live.overlay.hintSearchFieldClose')) : t('live.overlay.hintSearchRow'))
        : search?.open && search.backLeaves ? t('live.overlay.hintSearchResults') : t('live.overlay.hintChannels');

  return (
    <div
      data-channel-overlay
      data-overlay-cats={onCats ? 'open' : 'folded'}
      data-overlay-typing={typing ? 'true' : undefined}
      className="absolute left-0 top-0 bottom-0 z-30 flex bg-black/60 border-r border-white/10 animate-fade-in pointer-events-auto"
      style={{ width: (onCats ? OVERLAY_CATS_W : OVERLAY_STRIP_W) + OVERLAY_CHANNELS_W, textShadow: OVER_PICTURE_TEXT_SHADOW }}
    >
      {/* Categories (folded to a strip until ◀ opens them) */}
      {!onCats ? <CategoriesStrip /> : (
      <div className="flex-shrink-0 flex flex-col border-r border-white/10 pt-6 pb-4 px-3 bg-white/5" style={{ width: OVERLAY_CATS_W }}>
        <p className="px-2 pb-3 text-sm uppercase tracking-wide font-quicksand font-bold text-brand-gold">{t('live.overlay.categoriesTitle')}</p>
        {cw.start > 0 && <p className="text-center text-brand-ice/75 text-sm leading-none pb-1">▲</p>}
        <div className="space-y-1">
          {categories.slice(cw.start, cw.end).map((c, j) => {
            const i = cw.start + j;
            const focused = i === categoryIdx;
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
                    : focused ? 'text-base font-nunito font-semibold text-white' : 'text-base font-nunito text-brand-ice'}`}
                >
                  {c.label}
                </span>
                {!c.isHeader && c.count != null && c.count > 0 && (
                  <span className="ml-2 flex-shrink-0 text-xs font-nunito tabular-nums text-brand-ice/85">{formatCount(c.count)}</span>
                )}
              </div>
            );
          })}
        </div>
        {cw.end < categories.length && <p className="text-center text-brand-ice/75 text-sm leading-none pt-1">▼</p>}
      </div>
      )}

      {/* Channels (the Search row first). While typing: no heading (the
          field says it), the rows a little smaller, the hint under them. */}
      <div className={`flex-1 min-w-0 flex flex-col ${typing ? 'pt-3' : 'pt-6'} pb-3 px-3`}>
        {!typing && (
          <div className="flex items-center px-2 pb-3">
            <p className="flex-1 min-w-0 truncate text-sm uppercase tracking-wide font-quicksand font-bold text-brand-gold">{channelsTitle}</p>
            {loading && <Loader2 className="w-4 h-4 ml-2 animate-spin text-brand-gold flex-shrink-0" />}
            {!loading && channels.length > 0 && (
              <span className="ml-2 text-sm font-nunito tabular-nums text-brand-ice/85">
                {onSearch ? formatCount(channels.length) : `${channelIdx + 1} / ${channels.length}`}
              </span>
            )}
          </div>
        )}
        {chw.start > 0 && <p className="text-center text-brand-ice/75 text-sm leading-none pb-1">▲</p>}
        <div className={`${typing ? '' : 'flex-1 min-h-0 '}space-y-1`}>
          {searchShown && search && <SearchRow s={search} count={channels.length} />}
          {channels.length === 0 && (
            <p className={`px-3 font-nunito text-brand-ice/90 ${typing ? 'py-2 text-base' : 'py-4 text-lg'}`}>{emptyText}</p>
          )}
          {channels.slice(from, to).map((st, j) => {
            const i = from + j;
            const focused = !onCats && !onSearch && !typing && i === channelIdx;
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
                style={{ height: typing ? TYPING_ROW_H : ROW_H }}
              >
                <span className={`w-10 flex-shrink-0 font-nunito tabular-nums text-brand-ice/85 ${typing ? 'text-sm' : 'text-base'}`}>{st.num ?? ''}</span>
                <div className={`${typing ? 'w-8 h-8' : 'w-10 h-10'} mr-3 flex-shrink-0 rounded-lg bg-black/60 flex items-center justify-center overflow-hidden`}>
                  {st.stream_icon
                    ? <img src={st.stream_icon} alt="" loading="lazy" decoding="async" className="w-full h-full object-contain" />
                    : <Tv className="w-5 h-5 text-brand-ice/75" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-nunito ${typing ? 'text-sm truncate leading-tight' : nameClass(st.name)} ${focused ? 'text-white font-semibold' : playing ? 'text-brand-gold font-semibold' : 'text-brand-ice'}`}>
                    {st.name}
                  </p>
                  <p className={`truncate leading-tight font-nunito ${typing ? 'text-xs' : 'text-sm'} ${flagged ? flagText : 'text-brand-ice/85'}`}>
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
        {!typing && chw.end < channels.length + lead && <p className="text-center text-brand-ice/75 text-sm leading-none pb-1">▼</p>}
        {/* Typing: one line, so it stays above the keyboard with the results. */}
        <p data-overlay-hint="" className={`px-2 pt-2 text-sm font-nunito text-brand-ice/85${typing ? ' truncate' : ''}`}>{hint}</p>
      </div>
    </div>
  );
});

FullscreenChannelOverlay.displayName = 'FullscreenChannelOverlay';
export default FullscreenChannelOverlay;
