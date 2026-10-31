import { useState, useEffect, useRef } from 'react';
import { takeIntent, INTENT_KEYS, SCREEN_INTENT_EVENT } from '@/lib/appActions';
import { kidsLevel } from '@/lib/kidsFilter';
import { kidsImageTitle, kidsImageNotice } from '@/lib/kidsAiNotice';
import { useTranslation } from 'react-i18next';

/** A Kids profile's backgrounds are kept child-friendly by the server. */
const kidsBody = (): { kids_level?: string } => { const l = kidsLevel(); return l ? { kids_level: l } : {}; };
import { Button } from '@/components/ui/button';
import { isDemo, isHowtoCapture } from '@/lib/demoMode';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useNavigate } from 'react-router-dom';

import { Upload, Trash2, Eye, EyeOff, Loader2, Monitor, ShieldCheck, Sparkles, ChevronsUpDown } from 'lucide-react';
import { useMediaAssets, MediaAsset } from '@/hooks/useMediaAssets';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getDeviceId, trackEvent } from '@/lib/analytics';
import { loadAiTiers, getPreferredTier, setPreferredTier, premiumTrialUsed, describeReceipt, type AiTier, type AiTierPair } from '@/lib/aiTiers';
import FreeAiBlockedDialog from '@/components/FreeAiBlockedDialog';
import { BackButton, BACK_ROW } from '@/components/ui/BackButton';

interface MediaManagerProps {
  onBack: () => void;
  embedded?: boolean; // When true, hides the "Back to Home" button (used in Settings)
  isActive?: boolean; // When true and embedded, MediaManager handles its own navigation
  /** Embedded only: Left at the left edge (where Left has nothing else to do)
   *  hands the remote back to the parent — Settings' tab column. */
  onExitLeft?: () => void;
}

// Focus element types for TV navigation
type FocusElement = 
  | 'back' 
  | 'prompt-input' 
  | 'generate-btn' 
  | 'tier-btn'
  | 'compare-btn'
  | 'compare-keep-free'
  | 'compare-keep-premium'
  | 'compare-close'
  | 'asset-type' 
  | 'file-input' 
  | `asset-${number}` 
  | `asset-toggle-${string}` 
  | `asset-delete-${string}`;

// ---- Anonymous gallery persistence (localStorage) ----
type AnonImage = { id: string; dataUrl: string; name: string };
const ANON_GALLERY_KEY = 'snow-anon-gallery';
const ANON_ACTIVE_KEY = 'snow-anon-active-id';
const ANON_MAX_IMAGES = 4;
const loadAnonGallery = (): AnonImage[] => {
  try {
    const raw = localStorage.getItem(ANON_GALLERY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is AnonImage =>
      x && typeof x.id === 'string' && typeof x.dataUrl === 'string' && x.dataUrl.startsWith('data:') && typeof x.name === 'string');
  } catch { return []; }
};
const saveAnonGallery = (items: AnonImage[]) => {
  let list = items.slice(0, ANON_MAX_IMAGES);
  while (list.length > 0) {
    try { localStorage.setItem(ANON_GALLERY_KEY, JSON.stringify(list)); return list; }
    catch { list = list.slice(0, -1); }
  }
  try { localStorage.removeItem(ANON_GALLERY_KEY); } catch { /* ignore */ }
  return list;
};
const loadAnonActiveId = (): string | null => { try { return localStorage.getItem(ANON_ACTIVE_KEY); } catch { return null; } };
const saveAnonActiveId = (id: string | null) => { try { if (id) localStorage.setItem(ANON_ACTIVE_KEY, id); else localStorage.removeItem(ANON_ACTIVE_KEY); } catch { /* ignore */ } };

/** A gallery card (`asset-3`), not the type picker (`asset-type`) nor a
 *  card's buttons: "starts with asset-" took the type picker for a card, so
 *  Left on it lost the highlight (asset-NaN) and Back went down, not up. */
const isGalleryCard = (id: string): boolean => /^asset-\d+$/.test(id);

/** The upload's type, in the order OK steps through them. */
const ASSET_TYPES: MediaAsset['asset_type'][] = ['background', 'icon', 'logo', 'other'];

// Gallery: as many columns as fit at about 150 px a card — four beside
// Settings' tab column at 960x540, two on a phone, at most six on a wide
// page. The remote's Up/Down step by the same count.
const GALLERY_MIN_CARD = 140;
const GALLERY_GAP = 12;
const galleryColumnsFor = (width: number): number =>
  Math.max(2, Math.min(6, Math.floor((width + GALLERY_GAP) / (GALLERY_MIN_CARD + GALLERY_GAP))));

/** A 16:9 box. Chrome 66 has no aspect-ratio, so the padding trick; the
 *  inner layer is placed inline (position, not a class) so no focus rule
 *  can turn it back into a static box. */
const Frame169 = ({ className = '', children }: { className?: string; children: React.ReactNode }) => (
  <div className={`relative w-full overflow-hidden ${className}`} style={{ paddingBottom: '56.25%' }}>
    <div className="flex items-center justify-center" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
      {children}
    </div>
  </div>
);

const MediaManager = ({ onBack, embedded = false, isActive = true, onExitLeft }: MediaManagerProps) => {
  const { assets, loading, uploadAsset, toggleAssetActive, deleteAsset, getAssetUrl } = useMediaAssets();
  const { user, session } = useAuth();
  const { profile, checkCredits, deductCredits, fetchProfile } = useUserProfile();
  const { toast } = useToast();
  const { t } = useTranslation();
  
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [screenInfo, setScreenInfo] = useState({ width: 1920, height: 1080, ratio: '16:9' });
  const [uploadForm, setUploadForm] = useState({
    assetType: 'background' as MediaAsset['asset_type'],
    section: 'home',
    description: ''
  });
  // Initial highlight starts on the prompt input so DOWN reaches Generate
  // and UP exits back to the parent menu. We only HIGHLIGHT it — we do NOT
  // call .focus() on it (that would auto-open the on-screen keyboard on TV).
  const [focusedElement, setFocusedElement] = useState<FocusElement>(embedded ? 'prompt-input' : 'back');
  // Suppresses the prompt-input visible ring until the user actually
  // navigates with the D-pad. Without this the prompt input lights up the
  // moment the user opens the AI Image Generator, before any input.
  const [hasUserNavigated, setHasUserNavigated] = useState(false);

  // Ephemeral, in-app gallery for anonymous-user generations (cannot write to
  // media_assets without auth). Lives only for the session; shown in the same
  // grid as saved assets so the user never leaves the app.
  const [anonGallery, setAnonGallery] = useState<AnonImage[]>(() => loadAnonGallery());
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [showAnonWarning, setShowAnonWarning] = useState(false);
  // Tracks which anon image is currently set as the live background (one at a time).
  const [activeAnonId, setActiveAnonId] = useState<string | null>(() => loadAnonActiveId());
  // Mirrors localStorage 'snow-active-bg' (the URL of the live background, if any).
  const [activeBgUrl, setActiveBgUrl] = useState<string | null>(() => {
    try { return localStorage.getItem('snow-active-bg'); } catch { return null; }
  });
  const navigate = useNavigate();

  const promptInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Columns in the gallery (galleryColumnsFor); 3 until it has been measured.
  const [gridCols, setGridCols] = useState(3);
  const cycleAssetType = () => setUploadForm((f) => ({
    ...f,
    assetType: ASSET_TYPES[(ASSET_TYPES.indexOf(f.assetType) + 1) % ASSET_TYPES.length],
  }));

  // Check if user is authenticated (prefer session over user state for reliability)
  const isAuthenticated = !!(session?.user || user);

  // Set/clear the global background and notify App.tsx.
  const applyBackground = (url: string | null) => {
    try {
      if (url) localStorage.setItem('snow-active-bg', url);
      else localStorage.removeItem('snow-active-bg');
    } catch { /* ignore quota */ }
    setActiveBgUrl(url);
    window.dispatchEvent(new CustomEvent('snow:bg-change', { detail: { url } }));
  };

  // Unified gallery items: anon first (newest), then saved assets.
  type GalleryItem =
    | { kind: 'anon'; id: string; url: string; name: string; isActive: boolean }
    | { kind: 'asset'; id: string; url: string; name: string; isActive: boolean; asset: MediaAsset };

  const galleryItems: GalleryItem[] = [
    ...anonGallery.map((a) => ({
      kind: 'anon' as const,
      id: a.id,
      url: a.dataUrl,
      name: a.name,
      isActive: activeAnonId === a.id,
    })),
    ...assets.map((a) => ({
      kind: 'asset' as const,
      id: a.id,
      url: getAssetUrl(a.file_path),
      name: a.name,
      isActive: a.is_active,
      asset: a,
    })),
  ];


  // Helper to get focus ring class - use rounded ring for inputs and selects
 // Only while the remote is here: Settings shows this page beside its menu, and a ring left on it would be a second highlight.
  const getFocusClass = (id: FocusElement) =>
    isActive && focusedElement === id 
      ? 'ring-4 ring-brand-ice scale-105 rounded-md' 
      : '';

  // TV Navigation - D-pad support (only when active)
  useEffect(() => {
    if (!isActive) return; // Don't handle navigation when not active
    
    const handleKeyDown = (event: KeyboardEvent) => {
      // Bail when any Radix modal dialog is open — it owns the D-pad.
      if (document.querySelector('[role="alertdialog"][data-state="open"], [role="dialog"][data-state="open"]')) {
        return;
      }
      // Flag the first user nav so we can stop suppressing the prompt-input ring.
      if (!hasUserNavigated && event.key.startsWith('Arrow')) setHasUserNavigated(true);
      const target = event.target as HTMLElement;
      const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

      
      // When typing in inputs, only handle escape/navigation keys to exit
      if (isTyping) {
        if (event.key === 'Escape') {
          event.preventDefault();
          (target as HTMLInputElement).blur();
          return;
        }
        // Allow ArrowRight to exit input and go to generate button
        if (event.key === 'ArrowRight' && focusedElement === 'prompt-input') {
          event.preventDefault();
          (target as HTMLInputElement).blur();
          setFocusedElement('generate-btn');
          return;
        }
        // Allow ArrowDown to exit input and go to Generate (then user can
        // press DOWN again to reach asset-type below).
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          (target as HTMLInputElement).blur();
          if (focusedElement === 'prompt-input') {
            setFocusedElement('generate-btn');
          }
          return;
        }

        // Allow ArrowUp to exit input back to Back button (or parent)
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          (target as HTMLInputElement).blur();
          if (focusedElement === 'prompt-input') {
            setFocusedElement(embedded ? 'prompt-input' : 'back');
          }
          return;
        }
        // Let normal typing happen
        return;
      }
      
      // Handle Android back button - hierarchical exit from nested containers
      if (event.key === 'Escape' || event.key === 'Backspace' || 
          event.keyCode === 4 || event.which === 4) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        
        // Level 1: If inside item card (toggle/delete buttons), exit to parent card first
        if (focusedElement.startsWith('asset-toggle-') || focusedElement.startsWith('asset-delete-')) {
          const itemId = focusedElement.replace('asset-toggle-', '').replace('asset-delete-', '');
          const itemIndex = galleryItems.findIndex((g) => g.id === itemId);
          if (itemIndex >= 0) {
            setFocusedElement(`asset-${itemIndex}`);
            return;
          }
        }

        // Level 2: If in gallery grid, go back to file input (upload area)
        if (isGalleryCard(focusedElement)) {
          setFocusedElement('file-input');
          return;
        }

        // Level 3: If in file input/upload area, go back to asset-type
        if (focusedElement === 'file-input') {
          setFocusedElement('asset-type');
          return;
        }

        // Level 4: If in asset-type, go back to prompt/generate area
        if (focusedElement === 'asset-type') {
          setFocusedElement('prompt-input');
          return;
        }

        // The comparison card closes first.
        if (focusedElement.startsWith('compare-keep-') || focusedElement === 'compare-close') {
          setCompare(null);
          setFocusedElement('generate-btn');
          return;
        }

        // Level 5: If at top of MediaManager (prompt-input or generate-btn), exit to parent
        if (focusedElement === 'prompt-input' || focusedElement === 'generate-btn' || focusedElement === 'tier-btn' || focusedElement === 'compare-btn' || focusedElement === 'back') {
          onBack();
          return;
        }

        // Fallback: exit to parent
        onBack();
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }

      // Down/Up walk every control in reading order (the prompt, then the
      // buttons beside it; the type, then Choose File beside it); Left/Right
      // move along a row. The gallery is gridCols across.
      switch (event.key) {
        case 'ArrowDown':
          if (focusedElement === 'back' && !embedded) {
            setFocusedElement('prompt-input');
          } else if (focusedElement === 'prompt-input') {
            setFocusedElement('generate-btn');
          } else if (focusedElement === 'generate-btn' || focusedElement === 'tier-btn' || focusedElement === 'compare-btn') {
            setFocusedElement(compare ? 'compare-keep-free' : 'asset-type');
          } else if (focusedElement.startsWith('compare-keep-') || focusedElement === 'compare-close') {
            setFocusedElement('asset-type');
          } else if (focusedElement === 'asset-type') {
            setFocusedElement('file-input');
          } else if (focusedElement === 'file-input') {
            if (galleryItems.length > 0) {
              setFocusedElement('asset-0');
            }
          } else if (focusedElement.startsWith('asset-toggle-')) {
            const itemId = focusedElement.replace('asset-toggle-', '');
            setFocusedElement(`asset-delete-${itemId}`);
          } else if (focusedElement.startsWith('asset-delete-')) {
            const itemId = focusedElement.replace('asset-delete-', '');
            const currentIndex = galleryItems.findIndex((g) => g.id === itemId);
            const nextIndex = currentIndex + gridCols;
            if (nextIndex < galleryItems.length) setFocusedElement(`asset-${nextIndex}`);
          } else if (isGalleryCard(focusedElement)) {
            const currentIndex = parseInt(focusedElement.replace('asset-', ''));
            const nextIndex = currentIndex + gridCols;
            if (nextIndex < galleryItems.length) setFocusedElement(`asset-${nextIndex}`);
          }
          break;

        case 'ArrowUp':
          if (focusedElement === 'prompt-input') {
            if (embedded) onBack();
            else setFocusedElement('back');
          } else if (focusedElement === 'generate-btn' || focusedElement === 'tier-btn' || focusedElement === 'compare-btn') {
            setFocusedElement('prompt-input');
          } else if (focusedElement.startsWith('compare-keep-') || focusedElement === 'compare-close') {
            setFocusedElement('generate-btn');
          } else if (focusedElement === 'asset-type') {
            setFocusedElement(compare ? 'compare-keep-free' : 'generate-btn');
          } else if (focusedElement === 'file-input') {
            setFocusedElement('asset-type');
          } else if (focusedElement.startsWith('asset-delete-')) {
            const itemId = focusedElement.replace('asset-delete-', '');
            setFocusedElement(`asset-toggle-${itemId}`);
          } else if (focusedElement.startsWith('asset-toggle-')) {
            const itemId = focusedElement.replace('asset-toggle-', '');
            const currentIndex = galleryItems.findIndex((g) => g.id === itemId);
            if (currentIndex >= 0) setFocusedElement(`asset-${currentIndex}`);
          } else if (isGalleryCard(focusedElement)) {
            const currentIndex = parseInt(focusedElement.replace('asset-', ''));
            const nextIndex = currentIndex - gridCols;
            if (nextIndex >= 0) setFocusedElement(`asset-${nextIndex}`);
            else setFocusedElement('file-input');
          }
          break;

        case 'ArrowRight':
          if (focusedElement === 'prompt-input') {
            setFocusedElement('generate-btn');
          } else if (focusedElement === 'generate-btn') {
            if (premiumTier) setFocusedElement('tier-btn');
          } else if (focusedElement === 'tier-btn') {
            if (compareAvailable) setFocusedElement('compare-btn');
          } else if (focusedElement === 'compare-keep-free') {
            setFocusedElement('compare-keep-premium');
          } else if (focusedElement === 'compare-keep-premium') {
            setFocusedElement('compare-close');
          } else if (focusedElement === 'asset-type') {
            // Choose File stands beside the type.
            setFocusedElement('file-input');
          } else if (focusedElement.startsWith('asset-toggle-')) {
            const itemId = focusedElement.replace('asset-toggle-', '');
            setFocusedElement(`asset-delete-${itemId}`);
          } else if (isGalleryCard(focusedElement)) {
            const currentIndex = parseInt(focusedElement.replace('asset-', ''));
            if ((currentIndex + 1) % gridCols !== 0 && currentIndex + 1 < galleryItems.length) {
              setFocusedElement(`asset-${currentIndex + 1}`);
            }
          }
          break;

        case 'ArrowLeft':
          if (focusedElement === 'generate-btn') {
            setFocusedElement('prompt-input');
          } else if (focusedElement === 'tier-btn') {
            setFocusedElement('generate-btn');
          } else if (focusedElement === 'compare-btn') {
            setFocusedElement('tier-btn');
          } else if (focusedElement === 'compare-keep-premium') {
            setFocusedElement('compare-keep-free');
          } else if (focusedElement === 'compare-close') {
            setFocusedElement('compare-keep-premium');
          } else if (focusedElement === 'file-input') {
            setFocusedElement('asset-type');
          } else if (focusedElement.startsWith('asset-delete-')) {
            const itemId = focusedElement.replace('asset-delete-', '');
            setFocusedElement(`asset-toggle-${itemId}`);
          } else if (isGalleryCard(focusedElement)) {
            const currentIndex = parseInt(focusedElement.replace('asset-', ''));
            if (currentIndex % gridCols !== 0) setFocusedElement(`asset-${currentIndex - 1}`);
            else if (embedded && onExitLeft) onExitLeft();
          } else if (embedded && onExitLeft && (focusedElement === 'prompt-input' || focusedElement === 'asset-type' || focusedElement === 'compare-keep-free')) {
            // The left edge of the panel: back to the column beside it.
            onExitLeft();
          }
          break;

        case 'Enter':
        case ' ':
          if (focusedElement === 'back' && !embedded) {
            onBack();
          } else if (focusedElement === 'prompt-input') {
            promptInputRef.current?.focus();
          } else if (focusedElement === 'generate-btn') {
            handleGenerateImage();
          } else if (focusedElement === 'tier-btn') {
            toggleTier();
          } else if (focusedElement === 'compare-btn') {
            void handleCompare();
          } else if (focusedElement === 'compare-keep-free') {
            void keepFromCompare('free');
          } else if (focusedElement === 'compare-keep-premium') {
            void keepFromCompare('premium');
          } else if (focusedElement === 'compare-close') {
            setCompare(null);
            setFocusedElement('generate-btn');
          } else if (focusedElement === 'asset-type') {
            // OK steps to the next type (a drop-down list never opened from the remote).
            cycleAssetType();
          } else if (focusedElement === 'file-input') {
            fileInputRef.current?.click();
          } else if (focusedElement.startsWith('asset-toggle-')) {
            const itemId = focusedElement.replace('asset-toggle-', '');
            const item = galleryItems.find((g) => g.id === itemId);
            if (item) handleActivateItem(item);
          } else if (focusedElement.startsWith('asset-delete-')) {
            const itemId = focusedElement.replace('asset-delete-', '');
            const item = galleryItems.find((g) => g.id === itemId);
            if (item) handleDeleteItem(item);
          } else if (isGalleryCard(focusedElement)) {
            const currentIndex = parseInt(focusedElement.replace('asset-', ''));
            const item = galleryItems[currentIndex];
            if (item) setFocusedElement(`asset-toggle-${item.id}`);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [focusedElement, galleryItems, gridCols, onBack, onExitLeft, isActive]);


  // Scroll focused element into view - always keep selector visible.
  // Topmost focus targets snap the entire page back to 0 (matches Vimeo/Store fix).
  useEffect(() => {
    const isTopButton = focusedElement === 'back';

    if (isTopButton) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      document
        .querySelectorAll<HTMLElement>('.tv-scroll-container')
        .forEach((el) => el.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    const el = document.querySelector(`[data-focus-id="${focusedElement}"]`) as HTMLElement;
    if (!el) return;

    el.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });

    // FOCUS-HIGHLIGHT SYNC: move real DOM focus to the highlighted element so
    // the ring always reflects the actual D-pad cursor. Skip the prompt input
    // so we don't auto-pop the on-screen keyboard on TV — the user opens it
    // explicitly via Enter.
    if (focusedElement !== 'prompt-input' && document.activeElement !== el) {
      try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
    // A gallery card (a plain box) and the prompt's wrapper take no focus:
    // the button that had it lets go, or it keeps its ring ([data-focus-id]:focus)
    // and two things look selected. The typed-in input itself is not touched.
    // Only our own buttons, and only while the remote is here (not, say,
    // Settings' Back button while this sits idle in its tab).
    const active = document.activeElement as HTMLElement | null;
    if (isActive && active && active !== el && active.hasAttribute('data-focus-id')
      && rootRef.current?.contains(active) && typeof active.blur === 'function') {
      active.blur();
    }
  }, [focusedElement]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const stored = saveAnonGallery(anonGallery);
    if (stored.length !== anonGallery.length) {
      setAnonGallery(stored);
      if (activeAnonId && !stored.some((i) => i.id === activeAnonId)) { setActiveAnonId(null); applyBackground(null); }
    }
  }, [anonGallery]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { saveAnonActiveId(activeAnonId); }, [activeAnonId]);

  // The gallery's column count follows its width (the grid is drawn with it,
  // and the remote's Up/Down step by it). Measured once the gallery is on
  // screen, and again when the window changes size.
  useEffect(() => {
    const measure = () => {
      const w = galleryRef.current ? galleryRef.current.clientWidth : 0;
      if (w > 0) setGridCols(galleryColumnsFor(w)); // 0: not laid out (tests): keep the count
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [loading]);

  // Detect screen resolution and optimal image size
  useEffect(() => {
    const updateScreenInfo = () => {
      const width = window.screen.width;
      const height = window.screen.height;
      const aspectRatio = width / height;
      
      let ratio = '16:9';
      if (Math.abs(aspectRatio - (4/3)) < 0.1) {
        ratio = '4:3';
      } else if (Math.abs(aspectRatio - (21/9)) < 0.1) {
        ratio = '21:9';
      } else if (Math.abs(aspectRatio - (16/10)) < 0.1) {
        ratio = '16:10';
      }
      
      setScreenInfo({ width, height, ratio });
    };
    
    updateScreenInfo();
    window.addEventListener('resize', updateScreenInfo);
    return () => window.removeEventListener('resize', updateScreenInfo);
  }, []);

  // Use highest resolution available for best quality that can be stretched
  const getOptimalImageConfig = () => {
    return {
      size: '1792x1024',
      // 100 * 0.01 = 1.00 credit per image. $5 pack = 50 images.
      credits: 100,
      // media.generate.quality says this in the viewer's language.
      description: 'High resolution (1792x1024) - highest quality available'
    };
  };

  const imageConfig = getOptimalImageConfig();

  // Two levels of image AI. Standard is the included model; Premium is the
  // top image model and costs Snow Gems, charged by the server on every
  // premium call. The comparison runs the same prompt through both, and the
  // Premium side is the account's one free sample.
  const [imageTier, setImageTier] = useState<AiTier>(() => getPreferredTier('image'));
  const [tiers, setTiers] = useState<AiTierPair | null>(null);
  const [trialUsed, setTrialUsed] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [compare, setCompare] = useState<{
    prompt: string;
    free: string | null;
    premium: string | null;
    freeError: string | null;
    premiumError: string | null;
    note: string | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadAiTiers().then((t) => { if (!cancelled) setTiers(t.image); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!user) { setTrialUsed(true); return; }
    void premiumTrialUsed('image').then((used) => { if (!cancelled) setTrialUsed(used); });
    return () => { cancelled = true; };
  }, [user]);
  // Premium (paid in Snow Gems) is for grown-ups: a Kids profile has Standard only.
  const kids = kidsLevel();
  const premiumTier = kids ? null : (tiers?.premium ?? null);
  // Premium that is switched off in the table falls back to Standard.
  const effectiveTier: AiTier = imageTier === 'premium' && premiumTier ? 'premium' : 'free';
  const tierCost = effectiveTier === 'premium' && premiumTier ? premiumTier.gems : imageConfig.credits * 0.01;
  const compareAvailable = !!premiumTier && !!user && !trialUsed;
  const toggleTier = () => {
    if (!premiumTier) return;
    const next: AiTier = effectiveTier === 'premium' ? 'free' : 'premium';
    setImageTier(next);
    setPreferredTier('image', next);
    try { trackEvent('ai_tier_select', 'ai', { feature: 'image', tier: next }); } catch { /* ignore */ }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    console.log('Attempting to upload file:', file.name, 'Type:', file.type, 'Size:', file.size);

    try {
      setUploading(true);
      await uploadAsset(file, uploadForm.assetType, uploadForm.section, uploadForm.description);
      
      toast({
        title: t('media.toast.uploadedTitle'),
        description: t('media.toast.uploadedDesc', { name: file.name }),
      });
      
      // Reset form
      setUploadForm({ assetType: 'background', section: 'home', description: '' });
      event.target.value = '';
    } catch (error) {
      console.error('Upload error details:', error);
      toast({
        title: t('media.toast.uploadFailedTitle'),
        description: t('media.toast.uploadFailedDesc', { name: file.name, error: error instanceof Error ? error.message : t('media.toast.unknownError') }),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      await toggleAssetActive(id, !currentStatus);
      toast({
        title: currentStatus ? t('media.toast.deactivatedTitle') : t('media.toast.activatedTitle'),
        description: !currentStatus ? t('media.toast.nowActiveDesc') : t('media.toast.nowInactiveDesc'),
      });
    
    } catch (error) {
      toast({
        title: t('media.toast.updateFailedTitle'),
        description: t('media.toast.updateFailedDesc'),
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string, filePath: string, name: string) => {
    // Note: window.confirm is unreliable on Android TV WebViews — proceed directly.
    try {
      await deleteAsset(id, filePath);
      toast({
        title: t('media.toast.deletedTitle'),
        description: t('media.toast.deletedDesc', { name }),
      });
    } catch (error: unknown) {
      console.error('[MediaManager] Delete failed:', error);
      toast({
        title: t('media.toast.deleteFailedTitle'),
        description: (error instanceof Error && error.message) || t('media.toast.deleteFailedDesc'),
        variant: "destructive",
      });
    }
  };

  // Unified activate/deactivate: sets (or clears) the live background and keeps
  // mutual exclusion across anon + saved assets so only ONE image is active.
  const handleActivateItem = async (item: GalleryItem) => {
    try {
      if (item.isActive) {
        // Toggle OFF — clear background and (if asset) flip DB flag off.
        if (item.kind === 'asset') {
          await toggleAssetActive(item.id, true /* currentStatus */);
        } else {
          setActiveAnonId(null);
        }
        applyBackground(null);
        toast({ title: t('media.toast.bgClearedTitle'), description: t('media.toast.bgClearedDesc') });
        return;
      }

      // Toggle ON — first deactivate any other active item (anon or asset).
      if (activeAnonId) setActiveAnonId(null);
      for (const a of assets) {
        if (a.is_active && a.id !== item.id) {
          await toggleAssetActive(a.id, true /* currentStatus -> false */);
        }
      }

      if (item.kind === 'asset') {
        await toggleAssetActive(item.id, false /* currentStatus -> true */);
      } else {
        setActiveAnonId(item.id);
      }
      applyBackground(item.url);
      toast({ title: t('media.toast.bgSetTitle'), description: item.name });
    } catch (error) {
      console.error('[MediaManager] Activate failed:', error);
      toast({
        title: t('media.toast.bgFailedTitle'),
        description: t('media.toast.tryAgainDesc'),
        variant: 'destructive',
      });
    }
  };

  // Unified delete: if the deleted item is the active background, also clear it.
  const handleDeleteItem = async (item: GalleryItem) => {
    const wasActive = item.isActive || activeBgUrl === item.url;
    try {
      if (item.kind === 'anon') {
        setAnonGallery((prev) => prev.filter((p) => p.id !== item.id));
        if (activeAnonId === item.id) setActiveAnonId(null);
      } else {
        await deleteAsset(item.id, item.asset.file_path);
      }
      if (wasActive) applyBackground(null);
      toast({ title: t('media.toast.deletedTitle'), description: item.name });
    } catch (error: unknown) {
      console.error('[MediaManager] Delete failed:', error);
      toast({
        title: t('media.toast.deleteFailedTitle'),
        description: (error instanceof Error && error.message) || t('media.toast.tryAgainDesc'),
        variant: 'destructive',
      });
      // Safety: if the file we tried to delete WAS the background, revert it
      // even on failure so a stale URL is never left pointing at nothing.
      if (wasActive) applyBackground(null);
    }
  };




  /** Reads the JSON body off a failed fetch, for the server's own wording. */
  const readFailure = async (response: Response): Promise<{ error?: string; details?: string; needed?: number | null }> => {
    try { return await response.json(); } catch { return {}; }
  };

  const handleGenerateImage = async (skipAnonWarning = false, opts?: { tier?: AiTier }) => {
    if (!generatePrompt.trim()) {
      toast({
        title: t('media.toast.promptRequiredTitle'),
        description: t('media.toast.promptRequiredDesc'),
        variant: "destructive",
      });
      return;
    }

    // Content filter for inappropriate content (word-boundary match to avoid false positives)
    const inappropriateWords = [
      'naked', 'nude', 'nudes', 'boobs', 'boobies', 'penis', 'vagina', 'nsfw',
      'porn', 'porno', 'pornographic', 'erotic', 'erotica', 'topless', 'bottomless',
      'lingerie', 'sexual', 'sexy', 'orgasm', 'fetish'
    ];

    const promptLower = generatePrompt.toLowerCase();
    const foundInappropriate = inappropriateWords.find(word =>
      new RegExp(`\\b${word}\\b`, 'i').test(promptLower)
    );

    if (foundInappropriate) {
      toast({
        title: t('media.toast.policyTitle'),
        description: t('media.toast.policyDesc'),
        variant: "destructive",
      });
      return;
    }

    // Anonymous users use the free AI tier (gated server-side).
    // Signed-in users keep the existing credit-check behavior.
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    const anonMode = !currentSession?.user;

    // Pre-generation sign-in warning: anon users must explicitly confirm
    // they're OK generating without saving to their account.
    if (anonMode && !skipAnonWarning) {
      setShowAnonWarning(true);
      return;
    }

    const tier: AiTier = kids ? 'free' : (opts?.tier ?? effectiveTier);
    const premiumGems = premiumTier?.gems ?? 0;
    if (tier === 'premium' && anonMode) {
      toast({ title: t('media.toast.premiumSignInTitle'), description: t('media.toast.premiumSignInDesc') });
      return;
    }
    // Premium is charged by the server; the free tier is charged here as before.
    const imageCost = tier === 'premium' ? premiumGems : imageConfig.credits * 0.01;
    const isOwnerAdmin = user?.email?.toLowerCase() === 'joshua.perez@snowmediaent.com';
    if (!anonMode && !isOwnerAdmin && !checkCredits(imageCost)) {
      toast({
        title: t('media.toast.insufficientTitle'),
        description: t('media.toast.insufficientDesc', { need: imageCost.toFixed(2), balance: profile?.credits?.toFixed(2) || '0.00' }),
        variant: "destructive",
      });
      return;
    }

    try {
      setGenerating(true);
      // Park focus on the prompt input BEFORE the button toggles to disabled.
      // Otherwise Android WebView jumps native focus to the next tabbable
      // element (the hidden file input), which on Fire TV auto-fires
      // ACTION_GET_CONTENT and crashes the DocumentsUI picker.
      (document.activeElement as HTMLElement | null)?.blur?.();
      setFocusedElement('prompt-input');


      const enhancedPrompt = generatePrompt;

      // Calculate optimal dimensions based on screen resolution (capped at 1536)
      const maxDim = 1536;
      const targetWidth = Math.min(screenInfo.width, maxDim);
      const targetHeight = Math.min(screenInfo.height, maxDim);
      const width = Math.round(targetWidth / 64) * 64;
      const height = Math.round(targetHeight / 64) * 64;

      toast({
        title: t('media.toast.generatingTitle'),
        description: t('media.toast.generatingDesc'),
      });

      // Authed path: send Bearer; anon path: let supabase client default to anon key.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (currentSession?.access_token) {
        headers['Authorization'] = `Bearer ${currentSession.access_token}`;
      }

      const endpoint = tier === 'premium' ? 'generate-ai-image' : 'generate-hf-image';
      const response = await fetch(`https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(tier === 'premium'
          ? { prompt: enhancedPrompt, size: imageConfig.size, tier: 'premium', device_id: getDeviceId(), ...kidsBody() }
          : { prompt: enhancedPrompt, width, height, device_id: getDeviceId(), ...kidsBody() }),
      });

      const result = await response.json().catch(() => ({}));
      try { trackEvent('ai_image_generate', 'ai', { tier, ok: response.ok }); } catch { /* ignore */ }
      if (response.status === 402) {
        toast({
          title: t('media.toast.notEnoughTitle'),
          description: result?.details || t('media.toast.notEnoughDesc', { gems: premiumGems }),
          variant: 'destructive',
        });
        return;
      }

      // Free-AI gate denied (anon only).
      if (result?.blocked) {
        setBlockedReason(result.reason ?? null);
        return;
      }

      if (!response.ok || !result?.image) {
        throw new Error((result?.error === 'kids_blocked' ? result.details : null) || result?.error || result?.details || t('media.toast.failedGeneric'));
      }

      // Anonymous = ephemeral: can't write to media_assets (RLS), but DO NOT
      // open a browser/new tab. On Android WebView, window.open() with a
      // data: URL launches the external system browser and traps the user.
      // Instead, append to the in-app anonGallery so the image renders right
      // here in the same grid the user navigates with the D-pad.
      if (anonMode) {
        const id = `anon-${Date.now()}`;
        const newImage: AnonImage = { id, dataUrl: result.image, name: generatePrompt.slice(0, 60) || t('media.gallery.aiImage') };
        setAnonGallery((prev) => [newImage, ...prev].slice(0, ANON_MAX_IMAGES));
        toast({
          title: t('media.toast.readyTitle'),
          description: t('media.toast.readyDesc'),
        });
        setGeneratePrompt('');
        (document.activeElement as HTMLElement | null)?.blur?.();
        setFocusedElement('prompt-input');
        // Scroll the gallery into view so user sees the new image immediately
        setTimeout(() => {
          galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
        return;
      }

      // Signed-in path: persist exactly as before.
      const { data: { session: uploadSession } } = await supabase.auth.getSession();
      if (!uploadSession?.user) {
        throw new Error(t('media.toast.sessionExpired'));
      }

      const base64Response = await fetch(result.image);
      const blob = await base64Response.blob();
      const fileName = `ai-generated-${Date.now()}.jpg`;
      const file = new File([blob], fileName, { type: 'image/jpeg' });

      await uploadAsset(file, 'background', uploadForm.section, `AI Generated: ${generatePrompt}`);

      if (result.isAdmin) {
        toast({
          title: t('media.toast.completeTitle'),
          description: t('media.toast.completeAdminDesc'),
        });
      } else if (tier === 'premium') {
        // Charged server-side; only refresh the balance and say what happened.
        await fetchProfile();
        toast({ title: t('media.toast.premiumCompleteTitle'), description: describeReceipt(result) ?? t('media.toast.readyShortDesc') });
      } else {
        const creditDeducted = await deductCredits(imageCost, `AI Image Generation - ${generatePrompt}`);
        if (!creditDeducted) {
          toast({
            title: t('media.toast.deductFailedTitle'),
            description: t('media.toast.deductFailedDesc'),
            variant: "destructive",
          });
        } else {
          toast({
            title: t('media.toast.completeTitle'),
            description: t('media.toast.completeDesc', { gems: imageCost.toFixed(2) }),
          });
        }
      }

      setGeneratePrompt('');
      (document.activeElement as HTMLElement | null)?.blur?.();
      setFocusedElement('prompt-input');
      // Refresh + scroll gallery so the newly-saved image shows up immediately
      setTimeout(() => {
        galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (error) {
      console.error('Generate image error:', error);
      toast({
        title: t('media.toast.failedTitle'),
        description: t('media.toast.failedDesc', { error: error.message }),
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };


  /**
   * The same prompt through both levels, side by side. The Standard side costs
   * its normal gems; the Premium side is the account's one free sample (the
   * server decides, and charges the normal Premium price if it was already
   * used). Nothing is saved until the viewer keeps one.
   */
  // The assistant's "make me a wallpaper of …": fill the prompt, then generate.
  // Asked for from the phone remote it is only filled in: Generate costs Snow
  // Gems, so it is pressed here, on the TV. Asked for while this is already
  // on screen, it is taken at once (the screen-intent event), not left to
  // generate on the next visit.
  const autoPromptRef = useRef<string | null>(null);
  const [autoTick, setAutoTick] = useState(0);
  useEffect(() => {
    const take = () => {
      const p = takeIntent(INTENT_KEYS.wallpaper);
      if (p) { autoPromptRef.current = p; setGeneratePrompt(p); setAutoTick((n) => n + 1); return; }
      const draft = takeIntent(INTENT_KEYS.wallpaperDraft);
      if (draft) setGeneratePrompt(draft);
    };
    take();
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === 'settings') take(); };
    window.addEventListener(SCREEN_INTENT_EVENT, on);
    return () => window.removeEventListener(SCREEN_INTENT_EVENT, on);
  }, []);
  useEffect(() => {
    if (!autoPromptRef.current || generatePrompt !== autoPromptRef.current) return;
    autoPromptRef.current = null;
    const t = setTimeout(() => { void handleGenerateImage(); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatePrompt, autoTick]);

  const handleCompare = async () => {
    const prompt = generatePrompt.trim();
    if (!prompt || comparing || generating || kids) return;
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (!currentSession?.user) {
      toast({ title: t('media.toast.compareSignInTitle'), description: t('media.toast.compareSignInDesc') });
      return;
    }
    const isOwnerAdmin = user?.email?.toLowerCase() === 'joshua.perez@snowmediaent.com';
    const standardCost = imageConfig.credits * 0.01;
    if (!isOwnerAdmin && !checkCredits(standardCost)) {
      toast({ title: t('media.toast.insufficientTitle'), description: t('media.toast.compareCostDesc', { gems: standardCost.toFixed(2) }), variant: 'destructive' });
      return;
    }
    setComparing(true);
    setCompare({ prompt, free: null, premium: null, freeError: null, premiumError: null, note: null });
    try { trackEvent('ai_compare', 'ai', { feature: 'image' }); } catch { /* ignore */ }
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${currentSession.access_token}` };
    const maxDim = 1536;
    const width = Math.round(Math.min(screenInfo.width, maxDim) / 64) * 64;
    const height = Math.round(Math.min(screenInfo.height, maxDim) / 64) * 64;
    const freeRun = fetch(`https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/generate-hf-image`, {
      method: 'POST', headers, body: JSON.stringify({ prompt, width, height, device_id: getDeviceId(), ...kidsBody() }),
    }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }));
    const premiumRun = fetch(`https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/generate-ai-image`, {
      method: 'POST', headers, body: JSON.stringify({ prompt, size: imageConfig.size, tier: 'premium', use_trial: true, device_id: getDeviceId(), ...kidsBody() }),
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }));
    const [free, premium] = await Promise.all([freeRun, premiumRun]);
    const freeImage = free.ok && free.body?.image ? String(free.body.image) : null;
    const premiumImage = premium.ok && premium.body?.image ? String(premium.body.image) : null;
    if (freeImage && !isOwnerAdmin) void deductCredits(standardCost, `AI Image Generation (compare) - ${prompt}`);
    if (premium.body?.trial_used) setTrialUsed(true);
    const note = premium.body?.trial_used
      ? t('media.compare.freeSampleNote')
      : premium.ok && premium.body?.charged_gems
        ? t('media.compare.gemsUsedNote', { gems: premium.body.charged_gems })
        : null;
    setCompare({
      prompt,
      free: freeImage,
      premium: premiumImage,
      freeError: freeImage ? null : String((free.body?.error === 'kids_blocked' ? free.body.details : null) || free.body?.error || free.body?.details || t('media.compare.standardNoAnswer')),
      premiumError: premiumImage ? null : String(premium.body?.details || premium.body?.error || t('media.compare.premiumNoAnswer')),
      note,
    });
    void fetchProfile();
    setComparing(false);
    setFocusedElement('compare-keep-free');
  };

  /** Saves one side of the comparison as a background, and remembers the choice as the default level. */
  const keepFromCompare = async (which: 'free' | 'premium') => {
    const image = which === 'free' ? compare?.free : compare?.premium;
    if (!compare || !image) return;
    try {
      const blob = await (await fetch(image)).blob();
      const file = new File([blob], `ai-generated-${Date.now()}.jpg`, { type: 'image/jpeg' });
      await uploadAsset(file, 'background', uploadForm.section, `AI Generated (${which === 'premium' ? 'Premium' : 'Standard'}): ${compare.prompt}`);
      setImageTier(which);
      setPreferredTier('image', which);
      try { trackEvent('ai_compare_keep', 'ai', { feature: 'image', tier: which }); } catch { /* ignore */ }
      toast({
        title: which === 'premium' ? t('media.toast.premiumLevelTitle') : t('media.toast.standardLevelTitle'),
        description: which === 'premium' && premiumTier
          ? t('media.toast.premiumLevelDesc', { gems: premiumTier.gems })
          : t('media.toast.standardLevelDesc'),
      });
      setCompare(null);
      setGeneratePrompt('');
      setFocusedElement('generate-btn');
      setTimeout(() => galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) {
      toast({ title: t('media.toast.saveFailedTitle'), description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  const groupedAssets = assets.reduce((acc, asset) => {
    const key = `${asset.asset_type}-${asset.section}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(asset);
    return acc;
  }, {} as Record<string, MediaAsset[]>);

  if (loading) {
    return (
      <div className={`${embedded ? 'py-10' : 'min-h-screen p-8'} flex items-center justify-center`}>
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-400 mx-auto mb-3" />
          <p className="text-lg text-blue-200">{t('media.loading')}</p>
        </div>
      </div>
    );
  }

  const costLine = effectiveTier === 'premium' && premiumTier
    ? t('media.generate.premiumCost', { gems: premiumTier.gems, model: premiumTier.blurb ?? premiumTier.model })
    : t('media.generate.cost', { gems: (imageConfig.credits * 0.01).toFixed(2), quality: t('media.generate.quality') });

  // The page is slim on purpose (the owner: the old boxes were "thick" and
  // "bulky"): each part is one low panel with no box inside a box, the
  // controls sit beside each other instead of under their labels, and the
  // gallery takes as many columns as the width allows. Spacing between
  // pieces in a row is margins (m-1 on each, -m-1 on the row), not flex gap,
  // which Chrome 66 lacks; the same on both sides, so Arabic needs nothing.
  return (
    <div ref={rootRef} className={embedded ? '' : 'tv-scroll-container tv-safe bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white'}>
      <div className="w-full">
        {!embedded && (
          <div className="flex items-center mb-4">
            <BackButton
              onClick={onBack}
              label={t('media.backToHome')}
              focused={focusedElement === 'back'}
              className="mr-6"
            />
            <div>
              <h1 className="text-3xl font-bold text-white">{t('media.title')}</h1>
              <p className="text-base text-blue-200">{t('media.subtitle')}</p>
            </div>
          </div>
        )}

        {/* AI background: a title line (the balance on the right), the prompt
            with its buttons beside it, one small line of cost and screen size.
            The buttons drop under the box only where there is no room for
            them (a phone, or the one-time comparison offer beside Settings'
            column). Hidden in the website demo (uploads stay); the How-to
            pictures (developer build only) show it, as a box does. */}
        {(!isDemo() || isHowtoCapture()) && (
        <section
          className="rounded-2xl border border-purple-400/40 bg-gradient-to-br from-purple-600/90 to-purple-900/90 px-4 py-3 mb-3"
          data-howto="set.wallpaper"
        >
          {/* The balance goes under the title only where both don't fit (a phone). */}
          <div className="flex flex-wrap items-center justify-between -my-0.5 mb-1.5">
            <h2 className="my-0.5 flex items-center min-w-0 text-base lg:text-lg font-semibold text-white leading-tight">
              <Sparkles className="w-4 h-4 mr-2 shrink-0 text-purple-200" />
              <span className="truncate">{t('media.generate.title')}</span>
            </h2>
            <div className="w-3 shrink-0" />
            {user && profile && (
              <span className="my-0.5 shrink-0 rounded-full bg-black/25 px-2.5 py-0.5 text-xs text-purple-100 whitespace-nowrap">
                {t('media.generate.balance', { gems: profile.credits.toFixed(2) })}
              </span>
            )}
          </div>
          {kids && (
            <div className="flex items-start rounded-lg bg-emerald-500/15 border border-emerald-300/40 px-3 py-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-emerald-300 mr-2 mt-0.5 shrink-0" />
              <p className="text-xs text-emerald-100 leading-snug">
                <span className="font-semibold text-white">{kidsImageTitle()}</span>{' '}
                {kidsImageNotice(kids)}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center -m-1">
            <div data-focus-id="prompt-input" className="m-1 min-w-0" style={{ flex: '1 1 15rem' }}>
              <Label htmlFor="generate-prompt" className="sr-only">{t('media.generate.promptLabel')}</Label>
              <Input
                id="generate-prompt"
                ref={promptInputRef}
                value={generatePrompt}
                onChange={(e) => setGeneratePrompt(e.target.value)}
                placeholder={t('media.generate.promptPlaceholder')}
                className={`h-10 bg-white/10 border-white/20 text-white placeholder:text-white/60 transition-all ${isActive && hasUserNavigated && focusedElement === 'prompt-input' ? 'ring-4 ring-brand-ice' : ''}`}
                disabled={generating}
              />
            </div>
            <Button
              onClick={() => handleGenerateImage()}
              disabled={generating || comparing || !generatePrompt.trim() || (isAuthenticated && profile && profile.credits < tierCost)}
              data-focus-id="generate-btn"
              className={`m-1 h-10 shrink-0 bg-white/20 border-white/30 text-white hover:bg-white/30 transition-all ${getFocusClass('generate-btn')}`}
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t('media.generate.generating')}
                </>
              ) : (
                t('media.generate.generateBtn')
              )}
            </Button>
            {premiumTier && (
              <Button
                type="button"
                onClick={toggleTier}
                disabled={generating || comparing}
                data-focus-id="tier-btn"
                title={t('media.generate.tierSwitchTitle')}
                className={`m-1 h-10 shrink-0 px-3 transition-all ${effectiveTier === 'premium'
                  ? 'text-black border-0 [background:var(--gradient-gold)] hover:brightness-110'
                  : 'bg-white/10 border border-white/30 text-white hover:bg-white/20'} ${getFocusClass('tier-btn')}`}
              >
                {effectiveTier === 'premium' ? t('media.generate.tierPremiumBtn', { gems: premiumTier.gems }) : t('media.generate.tierStandardBtn', { gems: (imageConfig.credits * 0.01).toFixed(0) })}
              </Button>
            )}
            {compareAvailable && (
              <Button
                type="button"
                onClick={() => void handleCompare()}
                disabled={generating || comparing || !generatePrompt.trim()}
                data-focus-id="compare-btn"
                className={`m-1 h-10 shrink-0 px-3 bg-brand-ice/20 border border-brand-ice/50 text-white hover:bg-brand-ice/30 transition-all ${getFocusClass('compare-btn')}`}
              >
                {comparing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {t('media.generate.compareBtn')}
              </Button>
            )}
          </div>
          <p className="mt-2 flex items-center min-w-0 text-xs text-purple-100/80">
            <Monitor className="w-3.5 h-3.5 mr-1.5 shrink-0" />
            <span className="truncate">
              {costLine} · {t('media.generate.detected', { width: screenInfo.width, height: screenInfo.height, ratio: screenInfo.ratio })}
              {!isAuthenticated && (
                <> · <span className="italic">{t('media.generate.signInToSave')}</span></>
              )}
            </span>
          </p>
        </section>
        )}

        {/* Standard against Premium, same prompt, side by side. */}
        {compare && (
          <section className="rounded-2xl border border-brand-ice/20 bg-gradient-to-br from-brand-navy/85 via-[#12204a]/85 to-slate-950/90 shadow-xl px-4 py-3 mb-3">
            <div className="flex items-baseline justify-between min-w-0 mb-2">
              <h2 className="shrink-0 text-base lg:text-lg font-quicksand font-bold text-white">{t('media.compare.title')}</h2>
              <div className="w-3 shrink-0" />
              <p className="min-w-0 truncate text-xs text-brand-ice/80">"{compare.prompt}"</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gridGap: GALLERY_GAP }}>
              {(['free', 'premium'] as const).map((side) => {
                const img = side === 'free' ? compare.free : compare.premium;
                const err = side === 'free' ? compare.freeError : compare.premiumError;
                const id = side === 'free' ? 'compare-keep-free' : 'compare-keep-premium';
                const title = side === 'free' ? t('media.compare.standard') : t('media.compare.premium');
                return (
                  <div key={side} className={`rounded-xl overflow-hidden border ${side === 'premium' ? 'border-brand-gold/60' : 'border-white/15'} bg-black/30`}>
                    <Frame169 className="bg-black/50">
                      {img ? (
                        <img
                          src={img}
                          alt={t('media.compare.resultAlt', { tier: title })}
                          className="w-full h-full object-cover"
                          style={{ position: 'absolute', top: 0, left: 0 }}
                        />
                      ) : comparing ? (
                        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
                      ) : (
                        <p className="text-sm text-white/60 px-4 text-center">{err}</p>
                      )}
                    </Frame169>
                    <div className="px-3 py-2 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className={`text-sm font-quicksand font-bold ${side === 'premium' ? 'text-brand-gold' : 'text-white'}`}>{title}</p>
                        <p className="text-xs text-white/60 truncate">
                          {side === 'premium' && premiumTier ? t('media.compare.premiumAfter', { gems: premiumTier.gems }) : t('media.compare.standardPer', { gems: (imageConfig.credits * 0.01).toFixed(0) })}
                        </p>
                      </div>
                      <div className="w-2 shrink-0" />
                      <Button
                        type="button"
                        onClick={() => void keepFromCompare(side)}
                        disabled={!img || comparing}
                        data-focus-id={id}
                        className={`h-9 shrink-0 px-3 ${side === 'premium'
                          ? 'text-black border-0 [background:var(--gradient-gold)] hover:brightness-110'
                          : 'bg-white/15 border border-white/30 text-white hover:bg-white/25'} ${getFocusClass(id)}`}
                      >
                        {t('media.compare.keepBtn', { tier: title })}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="min-w-0 text-xs text-brand-ice/80">
                {compare.note ?? t('media.compare.defaultNote')}
              </p>
              <div className="w-3 shrink-0" />
              <Button
                type="button"
                variant="outline"
                onClick={() => { setCompare(null); setFocusedElement('generate-btn'); }}
                data-focus-id="compare-close"
                className={`h-9 shrink-0 border-white/25 bg-white/5 text-white ${getFocusClass('compare-close')}`}
              >
                {t('common.close')}
              </Button>
            </div>
          </section>
        )}

        {/* Upload: one row — the title, the type (OK steps through them: a
            drop-down list never opened from the remote) and Choose File. */}
        <section className="rounded-2xl bg-slate-800/55 border border-white/10 px-4 py-2 mb-4" data-howto="set.wallpaper">
          <div className="flex flex-wrap items-center -m-1">
            <h2 className="m-1 flex items-center min-w-0 text-base font-semibold text-white leading-tight">
              <Upload className="w-4 h-4 mr-2 shrink-0 text-blue-300" />
              <span className="truncate">{t('media.upload.title')}</span>
            </h2>
            <div className="flex-1" />
            <Button
              type="button"
              data-focus-id="asset-type"
              onClick={cycleAssetType}
              className={`m-1 h-9 shrink-0 px-3 bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-all rounded-md ${getFocusClass('asset-type')}`}
            >
              <span className="text-white/70 font-normal mr-1.5">{t('media.upload.typeLabel')}</span>
              <span className="font-semibold">{t(`media.upload.types.${uploadForm.assetType}`)}</span>
              <ChevronsUpDown className="w-4 h-4 ml-1.5 opacity-70" />
            </Button>
            <Button
              type="button"
              data-focus-id="file-input"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={`m-1 h-9 shrink-0 px-3 bg-blue-600 hover:bg-blue-500 border border-blue-400/50 text-white transition-all rounded-md ${getFocusClass('file-input')}`}
            >
              {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              {t('media.upload.chooseFileBtn')}
            </Button>
          </div>
          {/* tabIndex=-1: keep the hidden file input out of native tab order.
              Otherwise, when generate-btn becomes disabled after a successful
              AI generation, Android WebView jumps focus to the next tabbable
              element (this input). On Fire TV, focus on a type=file input
              + the next D-pad OK auto-fires ACTION_GET_CONTENT and the
              DocumentsUI picker NPE-crashes the app. */}
          <Input
            type="file"
            ref={fileInputRef}
            accept=".jpg,.jpeg,.png,.gif,.svg,.webp,.bmp,.tiff"
            onChange={handleFileUpload}
            disabled={uploading}
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
          />
        </section>

        {/* Gallery — gridCols across (galleryColumnsFor). Each card has its
            own ACTIVATE (set as background) + DELETE controls, both D-pad
            focusable with a bright brand-ice highlight ring. */}
        <div ref={galleryRef}>
          <h3 className="flex items-baseline text-base lg:text-lg font-semibold text-white mb-2">
            {t('media.gallery.title')}
            {galleryItems.length > 0 && (
              <span className="ml-2 text-sm font-normal text-blue-200">
                ({galleryItems.length})
              </span>
            )}
          </h3>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`, gridGap: GALLERY_GAP }}>
            {galleryItems.map((item, index) => {
              const isFocused = isActive && focusedElement === `asset-${index}`;
              const isToggleFocused = isActive && focusedElement === `asset-toggle-${item.id}`;
              const isDeleteFocused = isActive && focusedElement === `asset-delete-${item.id}`;
              return (
                <div
                  key={item.id}
                  data-focus-id={`asset-${index}`}
                  className={`relative min-w-0 rounded-xl border bg-slate-900/70 p-1.5 transition-all ${
                    item.isActive ? 'border-green-500/80 ring-2 ring-green-500' : 'border-white/10'
                  } ${isFocused ? 'ring-4 ring-brand-ice scale-105 z-10' : ''}`}
                >
                  {/* Active indicator badge */}
                  {item.isActive && (
                    <div
                      className="z-10 bg-green-500 text-white text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shadow"
                      style={{ position: 'absolute', top: 10, right: 10 }}
                    >
                      {t('media.gallery.backgroundBadge')}
                    </div>
                  )}

                  <Frame169 className="rounded-lg bg-black/40">
                    <img
                      src={item.url}
                      alt={item.name}
                      className="w-full h-full object-cover"
                      style={{ position: 'absolute', top: 0, left: 0 }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </Frame169>

                  <div className="px-0.5 pt-1.5 pb-1.5 min-w-0">
                    <h4 className="text-sm font-semibold text-white truncate leading-tight">{item.name}</h4>
                    <p className="text-[11px] text-white/55 truncate leading-tight mt-0.5">
                      {item.kind === 'anon' ? t('media.gallery.sessionOnly') : `${t(`media.upload.types.${item.asset.asset_type}`, { defaultValue: item.asset.asset_type })} · ${item.asset.section}`}
                    </p>
                  </div>

                  <div className="flex items-center">
                    <Button
                      size="sm"
                      type="button"
                      data-focus-id={`asset-toggle-${item.id}`}
                      onClick={() => handleActivateItem(item)}
                      className={`flex-1 min-w-0 h-8 px-2 text-xs transition-all ${
                        item.isActive
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : 'bg-brand-ice/20 hover:bg-brand-ice/30 text-white border border-brand-ice/40'
                      } ${isToggleFocused ? 'ring-4 ring-brand-ice scale-105' : ''}`}
                    >
                      {item.isActive ? (
                        <><Eye className="w-3 h-3 mr-1" /> <span className="truncate">{t('media.gallery.activeBtn')}</span></>
                      ) : (
                        <><EyeOff className="w-3 h-3 mr-1" /> <span className="truncate">{t('media.gallery.activateBtn')}</span></>
                      )}
                    </Button>
                    <div className="w-1.5 shrink-0" />
                    <Button
                      size="sm"
                      type="button"
                      variant="destructive"
                      data-focus-id={`asset-delete-${item.id}`}
                      className={`h-8 w-8 p-0 shrink-0 transition-all ${isDeleteFocused ? 'ring-4 ring-brand-ice scale-105' : ''}`}
                      onClick={(e) => { e.stopPropagation(); handleDeleteItem(item); }}
                      aria-label={t('media.gallery.deleteAria', { name: item.name })}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {assets.length === 0 && anonGallery.length === 0 && (
          <div className="flex items-center rounded-2xl border border-dashed border-white/15 px-4 py-3">
            <Upload className="w-8 h-8 text-slate-400 mr-3 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-200">{t('media.gallery.emptyTitle')}</h3>
              <p className="text-sm text-slate-400">{t('media.gallery.emptyText')}</p>
            </div>
          </div>
        )}
      </div>
      <FreeAiBlockedDialog
        open={blockedReason !== null}
        reason={blockedReason}
        onSignIn={() => { setBlockedReason(null); window.location.href = '/auth'; }}
        onBuyCredits={() => { setBlockedReason(null); onBack(); }}
        onClose={() => setBlockedReason(null)}
      />
      <AlertDialog open={showAnonWarning} onOpenChange={setShowAnonWarning}>
        <AlertDialogContent className="bg-slate-900 border-blue-500/40 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">{t('media.anon.title')}</AlertDialogTitle>
            <AlertDialogDescription className="text-blue-100">
              {t('media.anon.body')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="bg-slate-700 text-white hover:bg-slate-600 border-slate-600">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={() => {
                setShowAnonWarning(false);
                navigate('/auth');
              }}
            >
              {t('media.anon.signIn')}
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-purple-600 text-white hover:bg-purple-700"
              onClick={() => {
                setShowAnonWarning(false);
                handleGenerateImage(true);
              }}
            >
              {t('media.anon.generateAnywayBtn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default MediaManager;