// Live TV › Snow Originals: a wall of the owner's own short videos, newest on
// top (the Hub's order). OK plays one full screen in OriginalsPlayer, which
// loads on demand. No line needed: the videos are Snow Media's own.
//
// Keys follow BackupsSection: one capture-phase window handler, gated on
// isActive, reading refs; it steps aside while the player is open, and never
// stops other handlers on arrows. One Back = one step: player → grid → menu.
import ScrollText, { ScrollLines } from '@/components/ScrollText';
import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { Snowflake, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SnowLoader from '@/components/SnowLoader';
import { useSnowOriginals } from '@/hooks/useSnowOriginals';
import { fmtDuration, forViewer, isNew, kidsOnly, type SnowOriginal } from '@/lib/snowOriginals';
import { isDemo, demoDialogMsg } from '@/lib/demoMode';

const OriginalsPlayer = lazy(() => import('./OriginalsPlayer'));

// Four columns of 200×112 tiles (16:9 at 960×540); they narrow a little while
// the side menu is open rather than run off the screen.
const COLS = 4;

interface Props {
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp?: () => void;
}

const lowMemory = (): boolean => {
  try { return document.documentElement.classList.contains('native-low-memory'); } catch { return false; }
};

const stampBack = () => {
  (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
};

/** The tile's picture. Upright posters stand in the middle of the 16:9 tile on
 *  their own blurred still (the 32-px backdrop stretched), darkened, as in the player. */
function TilePicture({ item, show }: { item: SnowOriginal; show: boolean }) {
  if (!show || !item.posterUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-800">
        <Snowflake className="w-10 h-10 text-brand-ice/40" aria-hidden="true" />
      </div>
    );
  }
  if (!item.portrait) {
    return <img src={item.posterUrl} alt="" decoding="async" className="block w-full h-full object-cover" />;
  }
  return (
    <>
      <img src={item.backdropUrl || item.posterUrl} alt="" aria-hidden="true" decoding="async"
        className="absolute top-0 left-0 w-full h-full object-cover" />
      <div className="absolute top-0 left-0 w-full h-full bg-black/40" />
      <img src={item.posterUrl} alt="" decoding="async" className="relative block h-full w-auto mx-auto" />
    </>
  );
}

const OriginalsSection = memo(({ isActive, onExitLeft, onExitUp }: Props) => {
  const { t } = useTranslation();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [demoNotice, setDemoNotice] = useState(false);
  const [focus, setFocus] = useState(0);
  // No fetch while a video plays.
  const { items, loading, offline, error, refresh } = useSnowOriginals(!!playingId);
  const visible = useMemo(() => forViewer(items), [items]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Refs mirror state so the key handler is added once and never reads stale values.
  const focusRef = useRef(focus);
  const visibleRef = useRef(visible);
  const playingRef = useRef(playingId);
  const demoNoticeRef = useRef(demoNotice);
  const errorRef = useRef(error);
  const refreshRef = useRef(refresh);
  const onExitLeftRef = useRef(onExitLeft);
  const onExitUpRef = useRef(onExitUp);
  focusRef.current = focus;
  visibleRef.current = visible;
  playingRef.current = playingId;
  demoNoticeRef.current = demoNotice;
  errorRef.current = error;
  refreshRef.current = refresh;
  onExitLeftRef.current = onExitLeft;
  onExitUpRef.current = onExitUp;

  // The list can shrink on a refetch: keep the focus on a tile.
  useEffect(() => {
    if (focus > visible.length - 1) setFocus(Math.max(0, visible.length - 1));
  }, [visible.length, focus]);

  // Keep the focused tile in view (and again on coming back from the player).
  useEffect(() => {
    if (!isActive || playingId) return;
    const el = rootRef.current?.querySelector(`[data-focus-key="orig:${focus}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [focus, isActive, playingId]);

  const onPlayerClose = useCallback((lastId: string) => {
    const i = visibleRef.current.findIndex((o) => o.id === lastId);
    if (i >= 0) setFocus(i);
    setPlayingId(null);
  }, []);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      // The player owns the remote while it is open.
      if (playingRef.current) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;

      // The demo note sits on top: OK or Back closes it, nothing moves behind it.
      if (demoNoticeRef.current) {
        e.preventDefault(); e.stopPropagation();
        if (isBack) stampBack();
        if (isBack || e.key === 'Enter' || e.key === ' ') setDemoNotice(false);
        return;
      }

      if (isBack) {
        e.preventDefault(); e.stopPropagation();
        stampBack();
        onExitLeftRef.current();
        return;
      }

      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      // Blur lingering DOM focus so WebView spatial navigation can't also move.
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();

      const list = visibleRef.current;
      const n = list.length;
      const i = Math.min(focusRef.current, Math.max(0, n - 1));
      const col = i % COLS;

      if (e.key === 'ArrowUp') {
        if (i < COLS) { onExitUpRef.current?.(); return; }
        setFocus(i - COLS);
      } else if (e.key === 'ArrowDown') {
        if (n === 0) return;
        const lastRow = Math.floor((n - 1) / COLS);
        if (Math.floor(i / COLS) >= lastRow) return;
        // Into a shorter last row: its last tile.
        setFocus(Math.min(n - 1, i + COLS));
      } else if (e.key === 'ArrowLeft') {
        if (col === 0) { onExitLeftRef.current(); return; }
        setFocus(i - 1);
      } else if (e.key === 'ArrowRight') {
        if (col < COLS - 1 && i + 1 < n) setFocus(i + 1);
      } else {
        if (n === 0) { if (errorRef.current) refreshRef.current(); return; }
        const item = list[i];
        if (!item) return;
        // The demo has no videos behind its posters.
        if (isDemo()) { setDemoNotice(true); return; }
        setPlayingId(item.id);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive]);

  if (playingId) {
    return (
      <Suspense fallback={null}>
        <OriginalsPlayer items={visible} startId={playingId} onClose={onPlayerClose} />
      </Suspense>
    );
  }

  const focused = visible[Math.min(focus, visible.length - 1)] as SnowOriginal | undefined;
  const low = lowMemory();
  const focusedRow = Math.floor(focus / COLS);
  const now = Date.now();
  const restricted = kidsOnly();

  const message = (text: string) => (
    <div className="h-full flex items-center justify-center text-center px-8">
      <p className="text-brand-ice/70 font-nunito text-xl max-w-[62%]">{text}</p>
    </div>
  );

  return (
    <div ref={rootRef} className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
      <div className="px-6 pt-4 pb-2 flex-shrink-0">
        <div className="flex items-baseline min-w-0">
          <h2 className="text-2xl font-quicksand font-bold flex items-center flex-shrink-0">
            <Snowflake className="w-6 h-6 mr-2 text-brand-gold" aria-hidden="true" /> {t('originals.browse.heading')}
          </h2>
          <p className="ml-4 min-w-0 truncate text-brand-ice/70 font-nunito text-sm">{t('originals.browse.subtitle')}</p>
        </div>

        {/* The focused video: its title and description as the owner typed them. */}
        {focused && (
          <div className="mt-3 h-[78px] rounded-2xl bg-slate-900/70 border border-white/10 px-4 py-2 overflow-hidden" data-testid="originals-strip">
            <div className="flex items-center min-w-0">
              <ScrollText text={focused.title} active className="font-quicksand font-bold text-lg text-white" />
              {isNew(focused, now) && (
                <span className="ml-2 flex-shrink-0 px-2 py-px rounded-md text-xs font-bold font-nunito bg-brand-gold text-black">{t('originals.browse.newChip')}</span>
              )}
              <span className="ml-2 flex-shrink-0 text-brand-ice/70 font-nunito text-sm">{fmtDuration(focused.durationSec)}</span>
              <span className="ml-auto pl-3 flex-shrink-0 text-brand-ice/60 font-nunito text-xs">{t('originals.browse.playHint')}</span>
            </div>
            {focused.description && (
              <ScrollLines key={focused.id} text={focused.description} maxLines={2} className="mt-1 text-brand-ice/80 font-nunito text-sm leading-snug" />
            )}
          </div>
        )}

        {offline && visible.length > 0 && (
          <div className="mt-2 flex items-center px-3 py-1 rounded-lg bg-amber-500/15 border border-amber-400/30 text-amber-100 font-nunito text-sm" role="status">
            <WifiOff className="w-4 h-4 mr-2 flex-shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{t('originals.browse.offline')}</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-6">
        {visible.length > 0 ? (
          <div className="grid grid-cols-[repeat(4,minmax(0,200px))] gap-4">
            {visible.map((it, i) => {
              const on = isActive && i === focus;
              const row = Math.floor(i / COLS);
              const showImg = !low || Math.abs(row - focusedRow) <= 1;
              return (
                <div
                  key={it.id}
                  data-focus-key={`orig:${i}`}
                  onClick={() => { setFocus(i); if (isDemo()) setDemoNotice(true); else setPlayingId(it.id); }}
                  className="min-w-0 cursor-pointer"
                >
                  <div
                    data-focused={on ? 'true' : 'false'}
                    className={`tv-ring w-full h-[112px] rounded-xl overflow-hidden bg-slate-900 transition-transform duration-150 ease-out ${on ? 'scale-105 z-10' : ''}`}
                  >
                    <TilePicture item={it} show={showImg} />
                    {it.portrait && <span className="sr-only">{t('originals.browse.uprightLabel')}</span>}
                    {isNew(it, now) && (
                      <span className="absolute top-1 left-1 px-2 py-px rounded-md text-xs font-bold font-nunito bg-brand-gold text-black">{t('originals.browse.newChip')}</span>
                    )}
                    <span className="absolute bottom-1 right-1 px-1 rounded bg-black/70 text-white text-xs font-nunito">{fmtDuration(it.durationSec)}</span>
                    {/* The ring on top of the picture (an inset shadow is drawn under it). */}
                    {on && <div className="absolute top-0 left-0 w-full h-full rounded-xl border-[3px] border-brand-gold pointer-events-none" />}
                  </div>
                  <ScrollText text={it.title} active={on} className={`mt-2 px-1 font-quicksand font-semibold text-sm ${on ? 'text-white' : 'text-brand-ice/80'}`} />
                </div>
              );
            })}
          </div>
        ) : loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-full max-w-sm"><SnowLoader size="md" label={t('originals.browse.loading')} /></div>
          </div>
        ) : error ? (
          message(t('originals.browse.loadFailed'))
        ) : (
          message(restricted ? t('originals.browse.emptyKids') : t('originals.browse.empty'))
        )}
      </div>

      {demoNotice && (
        <div className="fixed top-0 left-0 w-full h-full z-[120] flex items-center justify-center bg-black/80 px-6" role="dialog" aria-modal="true">
          <div className="max-w-md w-full rounded-3xl border border-brand-gold/40 bg-[#0b1622] p-8 text-center shadow-2xl">
            <p className="font-nunito text-white/90 text-base leading-relaxed">{demoDialogMsg()}</p>
            <button type="button" onClick={() => setDemoNotice(false)}
              className="mt-6 px-6 py-3 rounded-xl bg-brand-gold text-black font-semibold font-nunito focus:outline-none focus:ring-2 focus:ring-white">
              {t('common.ok')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

OriginalsSection.displayName = 'OriginalsSection';
export default OriginalsSection;
