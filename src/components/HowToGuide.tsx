import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { ArrowLeft, ArrowRight, X, ChevronRight, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TUTORIAL_CHAPTERS, type TutorialChapter } from '@/data/tutorialContent';
import { trackEvent } from '@/lib/analytics';

interface HowToGuideProps {
  onClose: () => void;
  onNavigate?: (view: string) => void;
}

type View = 'chapters' | 'slides';

const HowToGuide = ({ onClose, onNavigate }: HowToGuideProps) => {
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
  const hasDeepLink = !!slide?.deepLink;

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
    const dl = slide?.deepLink;
    if (!dl) return;
    onClose();
    setTimeout(() => {
      if (dl.kind === 'view') {
        onNavigate?.(dl.view);
      } else if (dl.kind === 'event') {
        try { window.dispatchEvent(new CustomEvent(dl.event)); } catch { void 0; }
      }
    }, 0);
  }, [slide, onClose, onNavigate]);

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

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col [&_button:focus]:outline-none [&_button:focus-visible]:outline-none [&_button:focus]:ring-0 [&_button:focus]:scale-[1.04] [&_button:focus]:shadow-[0_0_28px_6px_hsl(45_93%_58%/0.55)] [&_button:focus]:border-yellow-300 [&_button:focus]:z-10 [&_button]:transition-all [&_button]:duration-150"
    >
      {view === 'chapters' && (
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-8 tv-safe">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-3xl font-quicksand font-bold text-white">How to use SMC</h1>
                <p className="text-base text-brand-ice/70 font-nunito mt-1">Pick a topic — press Back anytime to leave.</p>
              </div>
              <Button
                onClick={onClose}
                variant="outline"
                size="sm"
                className="bg-slate-800/60 border-slate-500 text-white"
                data-focused="close"
              >
                <X className="w-4 h-4 mr-1" />
                Close
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {TUTORIAL_CHAPTERS.map((ch, idx) => {
                const Icon = ch.icon;
                const focused = idx === chapterFocus;
                return (
                  <button
                    key={ch.id}
                    ref={(el) => { chapterRefs.current[idx] = el; }}
                    onClick={() => { setChapterFocus(idx); openChapter(idx); }}
                    onFocus={() => setChapterFocus(idx)}
                    tabIndex={-1}
                    data-focused={focused ? 'true' : undefined}
                    className={`${ch.color} h-20 px-5 rounded-xl border shadow-md grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 text-left`}
                  >
                    <Icon className="w-7 h-7 justify-self-center" />
                    <span className="text-xl font-medium truncate text-white">{ch.title}</span>
                    <span className="text-sm justify-self-end flex items-center gap-2">
                      <span className="opacity-80">{ch.slides.length} slide{ch.slides.length === 1 ? '' : 's'}</span>
                      <ChevronRight className="w-4 h-4 opacity-70" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {view === 'slides' && chapter && slide && (
        <>
          {/* Header */}
          <div className="px-6 pt-6 pb-3 tv-safe">
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
              <Button
                onClick={onClose}
                variant="outline"
                size="sm"
                className="bg-slate-800/60 border-slate-500 text-white"
              >
                <X className="w-4 h-4 mr-1" />
                Close
              </Button>
              <div className="flex-1 min-w-0 text-center">
                <div className="text-xl font-quicksand font-bold text-white truncate">{chapter.title}</div>
                <div className="text-xs text-brand-ice/70 font-nunito">Slide {slideIdx + 1} of {slidesLen}</div>
              </div>
              {/* Width placeholder to keep title centered */}
              <div className="w-[6.5rem]" aria-hidden="true" />
            </div>
            <div className="max-w-3xl mx-auto mt-3 h-1 bg-white/10 rounded">
              <div
                className="h-1 bg-brand-gold rounded transition-all duration-200"
                style={{ width: `${slidesLen <= 1 ? 100 : (slideIdx / (slidesLen - 1)) * 100}%` }}
              />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-6">
            <div className="max-w-2xl mx-auto flex flex-col items-center justify-center text-center py-10">
              <div className="w-20 h-20 rounded-3xl bg-brand-gold/20 flex items-center justify-center mb-8">
                {(() => { const I = slide.icon; return <I className="w-10 h-10 text-brand-gold" />; })()}
              </div>
              <h2 className="text-3xl font-quicksand font-bold text-white leading-snug">
                {slide.title}
              </h2>
              {slide.line2 && (
                <p className="text-lg text-brand-ice/80 font-nunito mt-4 leading-relaxed">
                  {slide.line2}
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 pb-8 pt-4 tv-safe">
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
              <Button
                ref={(el) => { footerRefs.current[0] = el; }}
                onClick={goPrev}
                onFocus={() => setFooterFocus(0)}
                variant="outline"
                size="lg"
                tabIndex={-1}
                className="bg-slate-800/60 border-slate-500 text-white min-w-[8rem]"
              >
                <ArrowLeft className="w-5 h-5 mr-2" />
                Back
              </Button>

              {/* Dot progress */}
              <div className="flex items-center gap-2">
                {chapter.slides.map((_, i) => (
                  <span
                    key={i}
                    className={`w-2 h-2 rounded-full ${i === slideIdx ? 'bg-brand-gold' : 'bg-white/25'}`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-3">
                {hasDeepLink && (
                  <Button
                    ref={(el) => { footerRefs.current[2] = el; }}
                    onClick={handleDeepLink}
                    onFocus={() => setFooterFocus(2)}
                    variant="outline"
                    size="lg"
                    tabIndex={-1}
                    className="bg-emerald-700/60 border-emerald-400/70 text-white"
                  >
                    <ExternalLink className="w-5 h-5 mr-2" />
                    {slide.deepLink!.label}
                  </Button>
                )}
                <Button
                  ref={(el) => { footerRefs.current[1] = el; }}
                  onClick={goNext}
                  onFocus={() => setFooterFocus(1)}
                  variant="gold"
                  size="lg"
                  tabIndex={-1}
                  className="min-w-[8rem]"
                >
                  {isLast ? 'Done' : 'Next'}
                  {!isLast && <ArrowRight className="w-5 h-5 ml-2" />}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default HowToGuide;
