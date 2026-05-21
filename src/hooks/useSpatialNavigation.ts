import { useCallback, useEffect, useRef } from 'react';

interface SpatialNavOptions {
  enabled?: boolean;
  onBack?: () => void;
  onSelect?: () => void;
  focusableSelector?: string;
  initialFocusId?: string;
}

interface ElementPosition {
  id: string;
  element: HTMLElement;
  rect: DOMRect;
  centerX: number;
  centerY: number;
}

/**
 * Hook for spatial D-pad navigation using nearest-neighbor algorithm.
 * This is a standalone alternative to FocusContext for components that need
 * their own isolated navigation scope.
 */
export const useSpatialNavigation = ({
  enabled = true,
  onBack,
  onSelect,
  focusableSelector = '[data-focus-id]',
  initialFocusId,
}: SpatialNavOptions = {}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentFocusRef = useRef<string | null>(initialFocusId || null);

  const getElements = useCallback((): ElementPosition[] => {
    if (!containerRef.current) return [];

    const elements = containerRef.current.querySelectorAll(focusableSelector);
    return Array.from(elements)
      .filter(el => {
        const htmlEl = el as HTMLElement;
        return !htmlEl.hasAttribute('disabled') && 
               htmlEl.getAttribute('aria-disabled') !== 'true' &&
               htmlEl.offsetParent !== null; // Is visible
      })
      .map(el => {
        const htmlEl = el as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();
        return {
          id: htmlEl.getAttribute('data-focus-id') || '',
          element: htmlEl,
          rect,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        };
      });
  }, [focusableSelector]);

  const setVisualFocus = useCallback((id: string) => {
    const elements = getElements();
    
    // Remove focus from all
    elements.forEach(({ element }) => {
      element.setAttribute('data-focused', 'false');
    });

    // Set focus on target
    const target = elements.find(e => e.id === id);
    if (target) {
      target.element.setAttribute('data-focused', 'true');
      target.element.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
      currentFocusRef.current = id;
    }
  }, [getElements]);

  const findNearest = useCallback((direction: 'up' | 'down' | 'left' | 'right'): string | null => {
    const elements = getElements();
    const currentId = currentFocusRef.current;
    
    const current = elements.find(e => e.id === currentId);
    if (!current) {
      // No current focus, return first element
      return elements[0]?.id || null;
    }

    let bestCandidate: ElementPosition | null = null;
    let bestScore = Infinity;

    for (const candidate of elements) {
      if (candidate.id === currentId) continue;

      let isInDirection = false;
      let distance = 0;
      let perpDistance = 0;

      const dx = candidate.centerX - current.centerX;
      const dy = candidate.centerY - current.centerY;

      switch (direction) {
        case 'up':
          isInDirection = dy < -10;
          distance = Math.abs(dy);
          perpDistance = Math.abs(dx);
          break;
        case 'down':
          isInDirection = dy > 10;
          distance = Math.abs(dy);
          perpDistance = Math.abs(dx);
          break;
        case 'left':
          isInDirection = dx < -10;
          distance = Math.abs(dx);
          perpDistance = Math.abs(dy);
          break;
        case 'right':
          isInDirection = dx > 10;
          distance = Math.abs(dx);
          perpDistance = Math.abs(dy);
          break;
      }

      if (!isInDirection) continue;

      // Prefer elements in same "lane" (lower perpendicular distance)
      const score = distance + perpDistance * 2;

      if (score < bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    return bestCandidate?.id || null;
  }, [getElements]);

  const moveFocus = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    const nextId = findNearest(direction);
    if (nextId) {
      setVisualFocus(nextId);
    }
  }, [findNearest, setVisualFocus]);

  const focusFirst = useCallback(() => {
    const elements = getElements();
    if (elements.length > 0) {
      setVisualFocus(elements[0].id);
    }
  }, [getElements, setVisualFocus]);

  const focusById = useCallback((id: string) => {
    setVisualFocus(id);
  }, [setVisualFocus]);

  const triggerSelect = useCallback(() => {
    const currentId = currentFocusRef.current;
    const elements = getElements();
    const current = elements.find(e => e.id === currentId);
    if (current) {
      current.element.click();
      onSelect?.();
    }
  }, [getElements, onSelect]);

  // Keyboard handler
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || 
                       target.tagName === 'TEXTAREA' || 
                       target.isContentEditable;

      // Handle back
      if (event.key === 'Escape' || event.key === 'Backspace' || 
          event.keyCode === 4 || event.code === 'GoBack') {
        if (!isTyping || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onBack?.();
          return;
        }
      }

      // Allow typing
      if (isTyping && !['ArrowUp', 'ArrowDown'].includes(event.key)) {
        return;
      }

      // CRITICAL: preventDefault on arrow keys
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          event.stopPropagation();
          moveFocus('up');
          break;
        case 'ArrowDown':
          event.preventDefault();
          event.stopPropagation();
          moveFocus('down');
          break;
        case 'ArrowLeft':
          event.preventDefault();
          event.stopPropagation();
          moveFocus('left');
          break;
        case 'ArrowRight':
          event.preventDefault();
          event.stopPropagation();
          moveFocus('right');
          break;
        case 'Enter':
        case ' ':
          if (!isTyping) {
            event.preventDefault();
            triggerSelect();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [enabled, moveFocus, triggerSelect, onBack]);

  // Initialize focus
  useEffect(() => {
    if (enabled && initialFocusId) {
      setVisualFocus(initialFocusId);
    } else if (enabled) {
      // Small delay to let elements render
      const timer = setTimeout(focusFirst, 100);
      return () => clearTimeout(timer);
    }
  }, [enabled, initialFocusId, setVisualFocus, focusFirst]);

  return {
    containerRef,
    currentFocusId: currentFocusRef.current,
    moveFocus,
    focusFirst,
    focusById,
    setFocus: setVisualFocus,
  };
};

/**
 * Simple focus ring class generator
 */
export const getFocusClasses = (isFocused: boolean, baseClass = '') => {
  return `${baseClass} ${isFocused ? 'ring-4 ring-brand-ice ring-offset-2 ring-offset-slate-800 scale-105 z-10' : ''}`.trim();
};
