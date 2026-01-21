import { useEffect, useCallback, useRef } from 'react';

/**
 * Hook to automatically scroll focused elements into view for TV navigation.
 * Call scrollIntoView when the focused element changes.
 */
export const useTVScrollIntoView = () => {
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollIntoView = useCallback((element: HTMLElement | null) => {
    if (!element) return;

    // Clear any pending scroll
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // Small delay to allow layout to settle
    scrollTimeoutRef.current = setTimeout(() => {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }, 50);
  }, []);

  const scrollFocusedIntoView = useCallback(() => {
    const focused = document.activeElement as HTMLElement;
    if (focused && focused !== document.body) {
      scrollIntoView(focused);
    }
  }, [scrollIntoView]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  return {
    scrollIntoView,
    scrollFocusedIntoView,
  };
};

/**
 * Hook to scroll an element by ref into view when a dependency changes.
 */
export const useTVFocusScroll = <T>(
  elementRef: React.RefObject<HTMLElement>,
  dependency: T
) => {
  useEffect(() => {
    if (elementRef.current) {
      elementRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [dependency, elementRef]);
};
