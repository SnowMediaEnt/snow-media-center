import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { ArrowLeft, ArrowRight, Check, X, ChevronRight, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openPlayerSection } from '@/lib/appActions';
import { TUTORIAL_CHAPTERS, type TutorialChapter, type TutorialDeepLink } from '@/data/tutorialContent';
import { trackEvent } from '@/lib/analytics';
import { kidsLevel } from '@/lib/kidsFilter';
import { kidsBlockedView } from '@/lib/kidsGameNavigation';
import HowtoShot from '@/components/howto/HowtoShot';
import i18n from '@/i18n';
import { useTouchUI } from '@/lib/phoneMode';

interface HowToGuideProps {
  onClose: () => void;
  onNavigate?: (view: string) => void;
}

type View = 'chapters' | 'slides';

/** Chapters finished on this box (localStorage, a per-viewer convenience). */
const DONE_KEY = 'smc-howto-done-v1';

/** A slim 40 px control: outline at rest, the tv-ring (data-focused) its one highlight. */
const BTN = 'tv-ring h-10 px-4 rounded-lg border border-white/25 bg-white/[0.06] text-white text-sm font-bold inline-flex items-center whitespace-nowrap transition-transform duration-150 data-[focused=true]:scale-[1.04] data-[focused=true]:z-10 data-[focused=true]:bg-white/15';

/** Support tools a Kids profile's Support does not have (Support.tsx). */
const KIDS_CLOSED_EVENTS = new Set(['support:open-tickets', 'support:open-cleaner', 'support:open-posts', 'support:open-device']);

/** A "Take me there" a Kids profile may follow. The chapters stay readable;
 *  only the jump to Main Apps, the Dashboard, tickets and the like is gone. */
const kidsMayFollow = (dl: TutorialDeepLink): boolean =>
  dl.kind === 'view' ? !kidsBlockedView(dl.view)
  : dl.kind === 'player' ? !kidsBlockedView('livetv')
  : !KIDS_CLOSED_EVENTS.has(dl.event);

const HowToGuide = ({ onClose, onNavigate }: HowToGuideProps) => {
  const { t } = useTranslation();
  // A phone or tablet: tap and swipe wording where a line speaks of the
  // remote (the key's "…Touch" twin, Tronix 6105df9); else the TV's.
  const touch = useTouchUI();
  const tt = (key: string): string => (touch && i18n.exists(`${key}Touch`) ? t(`${key}Touch`) : t(key));
  const [view, setView] = useState<View>('chapters');
  const [chapterIdx, setChapterIdx] = useState(0);
  const [slideIdx, setSlideIdx] = useState(0);
  // Which footer button in the slides view is focused: 0=Back 1=Next 2=DeepLink
  const [footerFocus, setFooterFocus] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const chapterRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const footerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [chapterFocus, setChapterFocus] = useState(0);

  const chapter: TutorialChapter | undefined = TUTORIAL_CHAPTERS[chapterIdx];
  const slide = chapter?.slides[slideIdx];
  const slidesLen = chapter?.slides.length ?? 0;
  const isLast = slidesLen > 0 && slideIdx === slidesLen - 1;
  const deepLink = slide?.deepLink && (!kidsLevel() || kidsMayFollow(slide.deepLink)) ? slide.deepLink : undefined;
  const hasDeepLink = !!deepLink;

  // Analytics
  useEffect(() => {
    try { trackEvent('tutorial_open', 'support'); } catch { void 0; }
  }, []);

  useEffect(() => {
    if (view === 'slides' && chapter) {
      try { trackEvent('tutorial_chapter', 'support', { chapter: chapter.id }); } catch { void 0; }
    }
  }, [view, chapter]);

  const openChapter = useCallback((idx: number) => {
    setChapterIdx(idx);
    setSlideIdx(0);
    setFooterFocus(1); // default focus on Next
    setView('slides');
  }, []);

  const backToChapters = useCallback(() => {
    setView('chapters');
    setSlideIdx(0);
  }, []);

  const handleDone = useCallback(() => {
    if (chapter) {
      try { trackEvent('tutorial_complete', 'support', { chapter: chapter.id }); } catch { void 0; }
    }
    backToChapters();
  }, [chapter, backToChapters]);

  const goNext = useCallback(() => {
    if (isLast) { handleDone(); return; }
    setSlideIdx((i) => Math.min(slidesLen - 1, i + 1));
  }, [isLast, slidesLen, handleDone]);

  const goPrev = useCallback(() => {
    if (slideIdx === 0) { backToChapters(); return; }
    setSlideIdx((i) => Math.max(0, i - 1));
  }, [slideIdx, backToChapters]);

  const handleDeepLink = useCallback(() => {
    const dl = deepLink;
    if (!dl) return;
    onClose();
    setTimeout(() => {
      if (dl.kind === 'view') {
        onNavigate?.(dl.view);
      } else if (dl.kind === 'player') {
        if (onNavigate) openPlayerSection(dl.section, onNavigate);
      } else if (dl.kind === 'event') {
        try { window.dispatchEvent(new CustomEvent(dl.event)); } catch { void 0; }
      }
    }, 0);
  }, [deepLink, onClose, onNavigate]);

  // Reset footer focus to Next when slide changes
  useEffect(() => {
    setFooterFocus(1);
  }, [slideIdx]);

  // Focus commit: chapters view
  useEffect(() => {
    if (view !== 'chapters') return;
    const el = chapterRefs.current[chapterFocus];
    if (el) {
      el.focus();
      try { el.scrollIntoView({ block: 'nearest' }); } catch { void 0; }
    }
  }, [view, chapterFocus]);

  // Focus commit: slides footer
  useEffect(() => {
    if (view !== 'slides') return;
    const el = footerRefs.current[footerFocus];
    if (el) el.focus();
  }, [view, footerFocus, slideIdx]);

  // Key handler — CAPTURE
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;

      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
        (e as unknown as { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
      };

      if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4) {
        if (e.key === 'Backspace' && tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
        handled();
        if (view === 'slides') {
          if (slideIdx === 0) backToChapters();
          else setSlideIdx((i) => Math.max(0, i - 1));
        } else {
          onClose();
        }
        return;
      }

      if (view === 'chapters') {
        if (e.key === 'ArrowDown') {
          handled();
          setChapterFocus((i) => Math.min(TUTORIAL_CHAPTERS.length - 1, i + 1));
        } else if (e.key === 'ArrowUp') {
          handled();
          setChapterFocus((i) => Math.max(0, i - 1));
        } else if (e.key === 'Enter' || e.keyCode === 23 || e.keyCode === 66) {
          handled();
          openChapter(chapterFocus);
        }
        return;
      }

      // slides view
      if (e.key === 'ArrowLeft') { handled(); goPrev(); return; }
      if (e.key === 'ArrowRight') { handled(); goNext(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!hasDeepLink) {
          handled();
          return;
        }
        if (e.key === 'ArrowUp') {
          handled();
          setFooterFocus(2);
        } else if (e.key === 'ArrowDown') {
          handled();
          setFooterFocus(1);
        }
        return;
      }
      if (e.key === 'Enter' || e.keyCode === 23 || e.keyCode === 66) {
        handled();
        const el = footerRefs.current[footerFocus];
        el?.click();
        return;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [view, slideIdx, chapterFocus, footerFocus, hasDeepLink, goPrev, goNext, openChapter, backToChapters, onClose]);


  // Capacitor back
  useLayoutEffect(() => {
    let handle: { remove?: () => void } | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        handle = await App.addListener('backButton', () => {
          if (cancelled) return;
          (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
          if (view === 'slides') {
            if (slideIdx === 0) backToChapters();
            else setSlideIdx((i) => Math.max(0, i - 1));
          } else {
            onClose();
          }
        });
      } catch { void 0; }
    })();
    return () => { cancelled = true; handle?.remove?.(); };
  }, [view, slideIdx, backToChapters, onClose]);

  // Chapters finished on this box (a check on the row): a per-viewer convenience,
  // never more. Storage may be blocked; then nothing is remembered.
  const [done, setDone] = useState<string[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(DONE_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
  });
  useEffect(() => {
    if (view === 'chapters' || !chapter || !isLast) return;
    // Reaching the last slide counts as finished (Done only goes back to the list).
    setDone((cur) => {
      if (cur.includes(chapter.id)) return cur;
      const next = [...cur, chapter.id];
      try { localStorage.setItem(DONE_KEY, JSON.stringify(next)); } catch { void 0; }
      return next;
    });
  }, [view, chapter, isLast]);

  const highlights = slide?.art.highlights ?? [];
  const Icon = slide?.icon;

  return (
    // Solid navy (the brand's): at 95% black the Support screen underneath read
    // through as part of the slide. Every control is a tv-ring driven by state
    // (data-focused), the one highlight on screen; nothing at rest is filled gold.
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex flex-col text-white font-nunito [&_button:focus]:outline-none [&_button:focus-visible]:outline-none"
      style={{ backgroundColor: '#07132b', backgroundImage: 'linear-gradient(160deg, #0a2147 0%, #07132b 55%, #140a1f 100%)' }}
    >
      {/* i18n-ignore: state check, not text */}
      {view === 'chapters' && (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain tv-safe" style={{ paddingTop: '3.5vh', paddingBottom: '3vh' }}>
          <div className="w-full max-w-5xl mx-auto">
            <div className="flex items-center mb-3">
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-quicksand font-bold text-white leading-tight">{t('guides.howTo.title')}</h1>
                <p className="text-sm text-brand-ice/70 mt-0.5">{tt('guides.howTo.pickTopic')}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                tabIndex={-1}
                data-focused="false"
                className={`${BTN} ml-4`}
              >
                <X className="w-4 h-4 mr-1.5" />
                {t('common.close')}
              </button>
            </div>

            {/* One slim row per chapter, the TV's width: its icon, name, what it covers,
                how many steps, a check once finished. Margins, not flex gap. */}
            <div>
              {TUTORIAL_CHAPTERS.map((ch, idx) => {
                const ChIcon = ch.icon;
                const focused = idx === chapterFocus;
                const finished = done.includes(ch.id);
                return (
                  <button
                    key={ch.id}
                    type="button"
                    ref={(el) => { chapterRefs.current[idx] = el; }}
                    onClick={() => { setChapterFocus(idx); openChapter(idx); }}
                    onFocus={() => setChapterFocus(idx)}
                    tabIndex={-1}
                    data-focused={focused ? 'true' : 'false'}
                    data-howto-chapter={ch.id}
                    className={`tv-ring w-full h-10 ${idx > 0 ? 'mt-1' : ''} px-2 rounded-lg border flex items-center text-left transition-transform duration-150 ${focused ? 'bg-white/10 border-white/25 scale-[1.01] z-10' : 'bg-white/[0.04] border-white/10'}`}
                  >
                    <span className={`w-7 h-7 rounded-md border flex items-center justify-center flex-shrink-0 ${ch.color}`}>
                      <ChIcon className="w-4 h-4" />
                    </span>
                    <span className="ml-3 text-base font-bold text-white whitespace-nowrap">{t(ch.titleKey)}</span>
                    <span className="ml-3 flex-1 min-w-0 text-sm text-brand-ice/65 truncate">{t(ch.subtitleKey)}</span>
                    <span className="ml-3 text-xs text-white/60 whitespace-nowrap">{t('guides.howTo.slideCount', { count: ch.slides.length })}</span>
                    {finished && <Check className="w-4 h-4 ml-2 text-brand-gold flex-shrink-0" aria-label={t('guides.howTo.doneBtn')} />}
                    <ChevronRight className="w-4 h-4 ml-2 text-white/50 flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* i18n-ignore: state check, not text */}
      {view === 'slides' && chapter && slide && (
        <>
          {/* Header: Close, the chapter, which step; a thin progress line under it. */}
          <div className="tv-safe" style={{ paddingTop: '2.5vh', paddingBottom: 0 }}>
            <div className="w-full max-w-5xl mx-auto flex items-center">
              <button type="button" onClick={onClose} tabIndex={-1} data-focused="false" className={BTN}>
                <X className="w-4 h-4 mr-1.5" />
                {t('common.close')}
              </button>
              <div className="flex-1 min-w-0 text-center px-4">
                <div className="text-lg font-quicksand font-bold text-white truncate leading-tight">{t(chapter.titleKey)}</div>
                <div className="text-xs text-brand-ice/70 leading-tight">{t('guides.howTo.slideOf', { current: slideIdx + 1, total: slidesLen })}</div>
              </div>
              {/* Keeps the title centered (as wide as Close). */}
              <div className="w-[6.5rem]" aria-hidden="true" />
            </div>
            <div className="w-full max-w-5xl mx-auto mt-2 h-1 bg-white/10 rounded">
              <div className="h-1 bg-brand-gold rounded" style={{ width: `${((slideIdx + 1) / Math.max(1, slidesLen)) * 100}%` }} />
            </div>
          </div>

          {/* Content: the picture on the left, the words on the right. A flex column with
              auto margins centers the slide when there is room and lets it scroll from the
              top when a long language does not fit (justify-center would clip the top). */}
          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-contain px-6 py-2">
            <div className="w-full max-w-5xl mx-auto my-auto flex flex-row items-center" data-howto-slide="">
              <div className="flex-shrink-0" style={{ width: '60%' }}>
                <HowtoShot art={slide.art} titleKey={slide.titleKey} />
              </div>
              <div className="flex-1 min-w-0 pl-6 text-left">
                <div className="flex items-center mb-2">
                  <span className="w-7 h-7 rounded-md bg-white/10 border border-white/15 flex items-center justify-center">
                    {Icon && <Icon className="w-4 h-4 text-brand-gold" />}
                  </span>
                  <span className="ml-2 text-xs font-bold uppercase tracking-wider text-brand-ice/70">{t(chapter.titleKey)}</span>
                </div>
                {/* dir="auto": Arabic lines read right to left (their full stops and
                    quote marks land on the right side); the layout stays left to right. */}
                <h2 dir="auto" style={{ textAlign: 'start' }} className="text-2xl font-quicksand font-bold text-white leading-snug">
                  {tt(slide.titleKey)}
                </h2>
                {slide.line2Key && (
                  <p dir="auto" style={{ textAlign: 'start' }} className="text-base text-brand-ice/85 leading-relaxed mt-2">
                    {tt(slide.line2Key)}
                  </p>
                )}
                {/* The lit areas, numbered as on the picture: readable from the couch. */}
                {highlights.length > 1 && (
                  <div className="mt-3 flex flex-wrap items-center" data-howto-legend="">
                    {highlights.slice(0, 3).map((h, i) => (
                      <span key={h.id} className="inline-flex items-center mr-3 mb-1 text-sm text-white/90">
                        <span className="w-5 h-5 rounded-full bg-brand-gold text-brand-navy text-xs font-extrabold flex items-center justify-center mr-1.5">{i + 1}</span>
                        <span dir="auto">{t(h.labelKey)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer: Back, the dots, Show me (when the slide has a screen to open), Next. */}
          <div className="tv-safe" style={{ paddingTop: 0, paddingBottom: '3vh' }}>
            <div className="w-full max-w-5xl mx-auto flex items-center">
              <button
                type="button"
                ref={(el) => { footerRefs.current[0] = el; }}
                onClick={goPrev}
                onFocus={() => setFooterFocus(0)}
                tabIndex={-1}
                data-focused={footerFocus === 0 ? 'true' : 'false'}
                className={`${BTN} min-w-[7rem]`}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t('common.back')}
              </button>

              <div className="flex-1 flex items-center justify-center">
                {chapter.slides.map((_, i) => (
                  <span
                    key={i}
                    className={`rounded-full mx-1 ${i === slideIdx ? 'w-2.5 h-2.5 bg-brand-gold' : 'w-2 h-2 bg-white/25'}`}
                  />
                ))}
              </div>

              {hasDeepLink && (
                <button
                  type="button"
                  ref={(el) => { footerRefs.current[2] = el; }}
                  onClick={handleDeepLink}
                  onFocus={() => setFooterFocus(2)}
                  tabIndex={-1}
                  data-focused={footerFocus === 2 ? 'true' : 'false'}
                  className={`${BTN} mr-3 border-brand-ice/50 text-brand-ice`}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  {t(deepLink!.labelKey)}
                </button>
              )}
              <button
                type="button"
                ref={(el) => { footerRefs.current[1] = el; }}
                onClick={goNext}
                onFocus={() => setFooterFocus(1)}
                tabIndex={-1}
                data-focused={footerFocus === 1 ? 'true' : 'false'}
                className={`${BTN} min-w-[7rem] border-brand-gold/60`}
              >
                {isLast ? t('guides.howTo.doneBtn') : t('guides.howTo.nextBtn')}
                {!isLast && <ArrowRight className="w-4 h-4 ml-2" />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default HowToGuide;
