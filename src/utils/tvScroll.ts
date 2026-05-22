export const snapAllTVScrollToTop = (extraElements: Array<HTMLElement | null | undefined> = []) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const snapElement = (el: HTMLElement | Element | null | undefined) => {
    if (!(el instanceof HTMLElement)) return;
    const previousScrollBehavior = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollTop = 0;
    el.scrollLeft = 0;
    try {
      el.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
    window.setTimeout(() => {
      el.style.scrollBehavior = previousScrollBehavior;
    }, 90);
  };

  const snapWindow = () => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlScrollBehavior = html.style.scrollBehavior;
    const previousBodyScrollBehavior = body.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    body.style.scrollBehavior = 'auto';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    html.scrollTop = 0;
    body.scrollTop = 0;
    window.setTimeout(() => {
      html.style.scrollBehavior = previousHtmlScrollBehavior;
      body.style.scrollBehavior = previousBodyScrollBehavior;
    }, 90);
  };

  const snap = () => {
    snapWindow();
    const elements = new Set<Element | HTMLElement | null | undefined>([
      document.scrollingElement,
      document.documentElement,
      document.body,
      ...extraElements,
      ...Array.from(document.querySelectorAll<HTMLElement>('[data-app-scroll-root], .tv-scroll-container, .tv-safe-scroll')),
    ]);
    elements.forEach(snapElement);
  };

  snap();
  requestAnimationFrame(snap);
  requestAnimationFrame(() => requestAnimationFrame(snap));
  [80, 180, 360, 700].forEach((delay) => window.setTimeout(snap, delay));
};