// Live TV on a phone held upright (or a narrow tablet held upright): one
// phone screen, whatever layout was chosen for the TV. The video on top at
// full width, 16:9; what is in it; the Player's sections as chips
// (PlayerTabsSlot, from LiveTV.tsx); search and the categories as one row of
// chips; then the channels in slim rows that scroll by finger, filling the
// rest. A tap on a channel plays it in the box (with sound); a tap on the
// box, or on its full screen button, goes full screen.
//
// LiveSection keeps every piece of state and hands the pieces in (the
// preview box, the channel list, the dialogs): this file is only the upright
// arrangement. Ported from Tronix (4369a23, b033d02).
import { memo, useContext, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, ChevronRight, Film, Loader2, Maximize, Search, Star, Tv } from 'lucide-react';
import { formatCount } from '@/lib/catalogCounts';
import { PlayerTabsSlot, keepChipInView } from './playerTabs';

/** One category chip (LiveSection's visible categories, labelled). */
export interface UprightCategory {
  id: string;
  label: string;
  isHeader?: boolean;
  collapsedHeader?: boolean;
  isFav?: boolean;
  count?: number | null;
  loading?: boolean;
  down?: boolean;
}

interface Props {
  /** The first-open layout chooser, when it is up. */
  layoutChooser: ReactNode;
  /** The box's ref: the native player draws through it. */
  previewBoxRef: (el: HTMLDivElement | null) => void;
  /** What the box shows while a channel is in it (LiveSection's preview). */
  previewBox: ReactNode;
  nativePreviewActive: boolean;
  /** The channel in the box, if any. */
  inBox: { name: string; num?: number } | null;
  /** What is on it now. */
  boxNowTitle?: string;
  /** Full screen with the channel in the box. */
  onFullScreen: () => void;
  searchOpen: boolean;
  searchQuery: string;
  searchInputRef: RefObject<HTMLInputElement>;
  onSearchToggle: () => void;
  onSearchChange: (q: string) => void;
  /** Recordings (a chip before the categories), when there are any. */
  showRecordings: boolean;
  recordingNow: boolean;
  onOpenRecordings: () => void;
  categoriesLoading: boolean;
  categories: UprightCategory[];
  categoryIdx: number;
  onPickCategory: (i: number) => void;
  channelList: ReactNode;
  /** The dialogs (Report, Record, the channel warning). */
  children?: ReactNode;
}

/** A chip of the upright rows; the open one gold-edged. */
const chip = (on: boolean) => `flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-nunito border ${on
  ? 'bg-brand-gold/25 border-brand-gold text-white font-semibold'
  : 'bg-white/5 border-white/10 text-brand-ice'}`;

const LiveUpright = memo(({
  layoutChooser, previewBoxRef, previewBox, nativePreviewActive, inBox, boxNowTitle, onFullScreen,
  searchOpen, searchQuery, searchInputRef, onSearchToggle, onSearchChange,
  showRecordings, recordingNow, onOpenRecordings,
  categoriesLoading, categories, categoryIdx, onPickCategory, channelList, children,
}: Props) => {
  const { t } = useTranslation();
  const phoneTabs = useContext(PlayerTabsSlot);
  // The open category's chip stays in view.
  const catChipsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (searchOpen) return;
    const row = catChipsRef.current;
    const el = row?.querySelector<HTMLElement>(`[data-cat-chip="${categoryIdx}"]`);
    if (row && el) keepChipInView(row, el);
  }, [categoryIdx, categories.length, searchOpen]);

  return (
    <div data-live-phone className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
      {layoutChooser}
      {/* The video, full width and 16:9 (a padding box). A tap on it (or ⛶)
          goes full screen with the channel in it. Searching with nothing in
          it, it is not drawn: an empty box over the keyboard left room for
          two and a half results. */}
      {!(searchOpen && !inBox) && (
        <div className="relative w-full flex-shrink-0" data-phone-video-frame style={{ paddingTop: '56.25%' }}>
          <div
            ref={previewBoxRef}
            data-phone-video
            onClick={inBox ? onFullScreen : undefined}
            className={`absolute top-0 left-0 w-full h-full overflow-hidden ${nativePreviewActive ? '' : 'bg-black'}`}
          >
            {inBox ? previewBox : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-brand-ice/70 font-nunito text-sm text-center px-4">
                <Tv className="w-10 h-10 text-brand-ice/40" />
                {t('live.phone.tapToWatch')}
              </div>
            )}
            {inBox && (
              <button
                type="button"
                aria-label={t('live.phone.fullScreenLabel')}
                data-phone-fullscreen
                onClick={(e) => { e.stopPropagation(); onFullScreen(); }}
                className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-black/60 border border-white/20 flex items-center justify-center"
              >
                <Maximize className="w-5 h-5 text-white" />
              </button>
            )}
          </div>
        </div>
      )}
      {/* What is in the box. */}
      {inBox && (
        <div className="flex-shrink-0 px-3 pt-2 min-w-0" data-phone-now>
          <p className="text-sm font-quicksand font-bold text-white truncate">
            {inBox.num != null ? `${inBox.num} · ` : ''}{inBox.name}
            {boxNowTitle && <span className="font-nunito font-normal text-brand-ice/75"> · {boxNowTitle}</span>}
          </p>
        </div>
      )}
      {/* The Player's sections (Live TV, Guide, …), from LiveTV.tsx. */}
      {phoneTabs}
      {/* Search, then the categories, as one row of chips. */}
      <div ref={catChipsRef} data-touch-scroll-x data-live-phone-cats className="flex-shrink-0 flex items-center gap-2 px-3 pb-2 overflow-x-auto whitespace-nowrap">
        <button
          type="button"
          aria-label={searchOpen ? t('live.list.closeSearchBtn') : t('live.list.searchChannelsBtn')}
          onClick={onSearchToggle}
          className={chip(searchOpen)}
        >
          <Search className="w-4 h-4" />
        </button>
        {searchOpen ? (
          <input
            ref={searchInputRef}
            type="text"
            autoFocus
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('live.list.searchPlaceholder')}
            className="flex-1 min-w-0 h-9 rounded-full bg-black/40 text-white border border-white/20 px-4 font-nunito text-base focus:outline-none focus:ring-2 focus:ring-brand-gold"
          />
        ) : (
          <>
            {showRecordings && (
              <button type="button" onClick={onOpenRecordings} data-recordings-chip="" className={chip(false)}>
                <Film className="w-4 h-4" />{t('live.list.recordingsBtn')}
                {recordingNow && <span className="w-2.5 h-2.5 rounded-full bg-red-500" aria-label={t('live.list.recordingNow')} />}
              </button>
            )}
            {categoriesLoading && categories.length === 0 && (
              <span className="flex-shrink-0 inline-flex items-center gap-2 text-brand-ice/70 font-nunito text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> {t('live.list.loadingCategories')}
              </span>
            )}
            {categories.map((c, i) => (
              <button
                key={c.id}
                type="button"
                data-cat-chip={i}
                data-active={!c.isHeader && i === categoryIdx ? 'true' : 'false'}
                onClick={() => onPickCategory(i)}
                className={`${chip(!c.isHeader && i === categoryIdx)}${c.isHeader ? ' uppercase tracking-wide font-quicksand font-bold text-brand-gold' : ''}`}
              >
                {c.isHeader && (c.collapsedHeader ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />)}
                {c.isFav && <Star className="w-4 h-4 text-brand-gold" />}
                <span className="max-w-[12rem] truncate">{c.label}</span>
                {c.down && <AlertTriangle className="w-4 h-4 text-red-400" aria-label={t('live.categories.downLabel')} />}
                {c.loading
                  ? <Loader2 className="w-3 h-3 animate-spin text-brand-gold" />
                  : !c.isHeader && c.count != null && c.count > 0 && <span className="text-xs tabular-nums text-brand-ice/60">{formatCount(c.count)}</span>}
              </button>
            ))}
          </>
        )}
      </div>
      {channelList}
      {children}
    </div>
  );
});
LiveUpright.displayName = 'LiveUpright';

export default LiveUpright;
