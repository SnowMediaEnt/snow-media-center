import { useEffect, useCallback, useRef } from 'react';

interface TVNavigationProps {
  enabled: boolean;
  focusableElements?: string;
  onNavigate?: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onSelect?: () => void;
  onBack?: () => void;
}

export const useTVNavigation = ({
  enabled = true,
  focusableElements = '[tabindex="0"], button, input, select, textarea, [data-tv-focusable]',
  onNavigate,
  onSelect,
  onBack
}: TVNavigationProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const getFocusableElements = useCallback(() => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll(focusableElements)
    ).filter(el => !el.hasAttribute('disabled')) as HTMLElement[];
  }, [focusableElements]);

  const moveFocus = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    const elements = getFocusableElements();
    const currentIndex = elements.findIndex(el => el === document.activeElement);
    
    if (currentIndex === -1) {
      // No element focused, focus first
      elements[0]?.focus();
      return;
    }

    let nextIndex = currentIndex;

    switch (direction) {
      case 'down':
        nextIndex = currentIndex + 1;
        if (nextIndex >= elements.length) nextIndex = 0;
        break;
      case 'up':
        nextIndex = currentIndex - 1;
        if (nextIndex < 0) nextIndex = elements.length - 1;
        break;
      case 'right':
        // For grid layouts, try to move to the right
        const currentRect = elements[currentIndex].getBoundingClientRect();
        const rightElements = elements.filter((el, idx) => {
          if (idx === currentIndex) return false;
          const rect = el.getBoundingClientRect();
          return rect.left > currentRect.left && 
                 Math.abs(rect.top - currentRect.top) < 50;
        });
        if (rightElements.length > 0) {
          rightElements[0].focus();
          return;
        }
        // Fallback to next element
        nextIndex = currentIndex + 1;
        if (nextIndex >= elements.length) nextIndex = 0;
        break;
      case 'left':
        // For grid layouts, try to move to the left
        const currentRectLeft = elements[currentIndex].getBoundingClientRect();
        const leftElements = elements.filter((el, idx) => {
          if (idx === currentIndex) return false;
          const rect = el.getBoundingClientRect();
          return rect.left < currentRectLeft.left && 
                 Math.abs(rect.top - currentRectLeft.top) < 50;
        });
        if (leftElements.length > 0) {
          leftElements[leftElements.length - 1].focus();
          return;
        }
        // Fallback to previous element
        nextIndex = currentIndex - 1;
        if (nextIndex < 0) nextIndex = elements.length - 1;
        break;
    }

    elements[nextIndex]?.focus();
    onNavigate?.(direction);
  }, [getFocusableElements, onNavigate]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        moveFocus('up');
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveFocus('down');
        break;
      case 'ArrowLeft':
        event.preventDefault();
        moveFocus('left');
        break;
      case 'ArrowRight':
        event.preventDefault();
        moveFocus('right');
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelect?.();
        // Also trigger click on focused element
        (document.activeElement as HTMLElement)?.click?.();
        break;
      case 'Escape':
      case 'Backspace':
        event.preventDefault();
        onBack?.();
        break;
    }
  }, [enabled, moveFocus, onSelect, onBack]);

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown);
    
    // Auto-focus first element when enabled
    const elements = getFocusableElements();
    if (elements.length > 0 && containerRef.current && !containerRef.current.contains(document.activeElement)) {
      elements[0].focus();
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown, getFocusableElements]);

  return {
    containerRef,
    focusFirst: () => {
      const elements = getFocusableElements();
      elements[0]?.focus();
    },
    focusLast: () => {
      const elements = getFocusableElements();
      elements[elements.length - 1]?.focus();
    }
  };
};