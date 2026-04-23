import React, { createContext, useContext, useCallback, useRef, useState, useEffect } from 'react';

interface FocusableElement {
  id: string;
  ref: React.RefObject<HTMLElement>;
  section?: string;
  row?: number;
  col?: number;
}

interface FocusContextType {
  currentFocusId: string | null;
  registerFocusable: (element: FocusableElement) => void;
  unregisterFocusable: (id: string) => void;
  setFocus: (id: string) => void;
  moveFocus: (direction: 'up' | 'down' | 'left' | 'right') => void;
  focusFirst: () => void;
  focusById: (id: string) => void;
}

const FocusContext = createContext<FocusContextType | null>(null);

export const useFocusContext = () => {
  const context = useContext(FocusContext);
  if (!context) {
    throw new Error('useFocusContext must be used within a FocusProvider');
  }
  return context;
};

interface FocusProviderProps {
  children: React.ReactNode;
  enabled?: boolean;
  onBack?: () => void;
}

export const FocusProvider: React.FC<FocusProviderProps> = ({ 
  children, 
  enabled = true,
  onBack 
}) => {
  const [currentFocusId, setCurrentFocusId] = useState<string | null>(null);
  const elementsRef = useRef<Map<string, FocusableElement>>(new Map());

  const registerFocusable = useCallback((element: FocusableElement) => {
    elementsRef.current.set(element.id, element);
    // Auto-focus first element if nothing focused
    if (!currentFocusId && elementsRef.current.size === 1) {
      setCurrentFocusId(element.id);
    }
  }, [currentFocusId]);

  const unregisterFocusable = useCallback((id: string) => {
    elementsRef.current.delete(id);
    if (currentFocusId === id) {
      // Focus next available element
      const elements = Array.from(elementsRef.current.keys());
      setCurrentFocusId(elements[0] || null);
    }
  }, [currentFocusId]);

  const setFocus = useCallback((id: string) => {
    if (elementsRef.current.has(id)) {
      setCurrentFocusId(id);
    }
  }, []);

  const focusById = useCallback((id: string) => {
    setFocus(id);
  }, [setFocus]);

  const focusFirst = useCallback(() => {
    const elements = Array.from(elementsRef.current.keys());
    if (elements.length > 0) {
      setCurrentFocusId(elements[0]);
    }
  }, []);

  // Spatial navigation using nearest-neighbor algorithm
  const findNearestElement = useCallback((
    direction: 'up' | 'down' | 'left' | 'right'
  ): string | null => {
    const currentElement = currentFocusId ? elementsRef.current.get(currentFocusId) : null;
    if (!currentElement?.ref.current) return null;

    const currentRect = currentElement.ref.current.getBoundingClientRect();
    const currentCenterX = currentRect.left + currentRect.width / 2;
    const currentCenterY = currentRect.top + currentRect.height / 2;

    let bestCandidate: string | null = null;
    let bestScore = Infinity;

    elementsRef.current.forEach((element, id) => {
      if (id === currentFocusId || !element.ref.current) return;

      const rect = element.ref.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Check if element is in the correct direction
      let isInDirection = false;
      let distance = 0;
      let perpendicularDistance = 0;

      switch (direction) {
        case 'up':
          isInDirection = centerY < currentCenterY - 10;
          distance = currentCenterY - centerY;
          perpendicularDistance = Math.abs(centerX - currentCenterX);
          break;
        case 'down':
          isInDirection = centerY > currentCenterY + 10;
          distance = centerY - currentCenterY;
          perpendicularDistance = Math.abs(centerX - currentCenterX);
          break;
        case 'left':
          isInDirection = centerX < currentCenterX - 10;
          distance = currentCenterX - centerX;
          perpendicularDistance = Math.abs(centerY - currentCenterY);
          break;
        case 'right':
          isInDirection = centerX > currentCenterX + 10;
          distance = centerX - currentCenterX;
          perpendicularDistance = Math.abs(centerY - currentCenterY);
          break;
      }

      if (!isInDirection) return;

      // Score: prefer elements closer in the primary direction with less perpendicular offset
      // Weight perpendicular distance more heavily to stay in "lanes"
      const score = distance + (perpendicularDistance * 2);

      if (score < bestScore) {
        bestScore = score;
        bestCandidate = id;
      }
    });

    return bestCandidate;
  }, [currentFocusId]);

  const moveFocus = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    const nextId = findNearestElement(direction);
    if (nextId) {
      setCurrentFocusId(nextId);
    }
  }, [findNearestElement]);

  // Scroll focused element into view
  useEffect(() => {
    if (!currentFocusId) return;
    
    const element = elementsRef.current.get(currentFocusId);
    if (element?.ref.current) {
      element.ref.current.scrollIntoView({
        behavior: 'auto',
        block: 'center',
        inline: 'nearest',
      });
    }
  }, [currentFocusId]);

  // Global keyboard handler - CRITICAL: preventDefault on all arrow keys
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || 
                       target.tagName === 'TEXTAREA' || 
                       target.isContentEditable;

      // Handle back/escape
      if (event.key === 'Escape' || event.key === 'Backspace' || 
          event.keyCode === 4 || event.code === 'GoBack') {
        if (!isTyping || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onBack?.();
          return;
        }
      }

      // Allow normal typing behavior
      if (isTyping && !['ArrowUp', 'ArrowDown'].includes(event.key)) {
        return;
      }

      // CRITICAL: preventDefault on ALL arrow keys to stop WebView scrolling
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
            // Click the focused element
            const element = elementsRef.current.get(currentFocusId || '');
            element?.ref.current?.click();
          }
          break;
      }
    };

    // Capture phase to intercept before any child handlers
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [enabled, moveFocus, currentFocusId, onBack]);

  return (
    <FocusContext.Provider value={{
      currentFocusId,
      registerFocusable,
      unregisterFocusable,
      setFocus,
      moveFocus,
      focusFirst,
      focusById,
    }}>
      {children}
    </FocusContext.Provider>
  );
};
