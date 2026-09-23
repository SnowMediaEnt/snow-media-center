import { useState, useEffect, useRef } from 'react';
import { takeIntent, INTENT_KEYS } from '@/lib/appActions';
import { kidsLevel } from '@/lib/kidsFilter';

/** A Kids profile's backgrounds are kept child-friendly by the server. */
const kidsBody = (): { kids_level?: string } => { const l = kidsLevel(); return l ? { kids_level: l } : {}; };
import { Button } from '@/components/ui/button';
import { isDemo } from '@/lib/demoMode';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Upload, Trash2, Eye, EyeOff, Loader2, Monitor } from 'lucide-react';
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

const MediaManager = ({ onBack, embedded = false, isActive = true }: MediaManagerProps) => {
  const { assets, loading, uploadAsset, toggleAssetActive, deleteAsset, getAssetUrl } = useMediaAssets();
  const { user, session } = useAuth();
  const { profile, checkCredits, deductCredits, fetchProfile } = useUserProfile();
  const { toast } = useToast();
  
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
  const getFocusClass = (id: FocusElement) => 
    focusedElement === id 
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
        if (focusedElement.startsWith('asset-')) {
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

      // Calculate grid columns (3 columns)
      const gridCols = 3;

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
          } else if (focusedElement.startsWith('asset-')) {
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
          } else if (focusedElement.startsWith('asset-')) {
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
          } else if (focusedElement.startsWith('asset-toggle-')) {
            const itemId = focusedElement.replace('asset-toggle-', '');
            setFocusedElement(`asset-delete-${itemId}`);
          } else if (focusedElement.startsWith('asset-')) {
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
          } else if (focusedElement.startsWith('asset-delete-')) {
            const itemId = focusedElement.replace('asset-delete-', '');
            setFocusedElement(`asset-toggle-${itemId}`);
          } else if (focusedElement.startsWith('asset-')) {
            const currentIndex = parseInt(focusedElement.replace('asset-', ''));
            if (currentIndex % gridCols !== 0) setFocusedElement(`asset-${currentIndex - 1}`);
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
          } else if (focusedElement.startsWith('asset-')) {
            const currentIndex = parseInt(focusedElement.replace('asset-', ''));
            const item = galleryItems[currentIndex];
            if (item) setFocusedElement(`asset-toggle-${item.id}`);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [focusedElement, galleryItems, onBack, isActive]);


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
  }, [focusedElement]);

  useEffect(() => {
    const stored = saveAnonGallery(anonGallery);
    if (stored.length !== anonGallery.length) {
      setAnonGallery(stored);
      if (activeAnonId && !stored.some((i) => i.id === activeAnonId)) { setActiveAnonId(null); applyBackground(null); }
    }
  }, [anonGallery]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { saveAnonActiveId(activeAnonId); }, [activeAnonId]);

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
  const premiumTier = tiers?.premium ?? null;
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
        title: "Upload successful",
        description: `${file.name} has been uploaded successfully.`,
      });
      
      // Reset form
      setUploadForm({ assetType: 'background', section: 'home', description: '' });
      event.target.value = '';
    } catch (error) {
      console.error('Upload error details:', error);
      toast({
        title: "Upload failed",
        description: `Failed to upload ${file.name}. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
        title: currentStatus ? "Asset deactivated" : "Asset activated",
        description: `Asset is now ${!currentStatus ? 'active' : 'inactive'}.`,
      });
    
    } catch (error) {
      toast({
        title: "Failed to update",
        description: "Could not update asset status.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string, filePath: string, name: string) => {
    // Note: window.confirm is unreliable on Android TV WebViews — proceed directly.
    try {
      await deleteAsset(id, filePath);
      toast({
        title: "Asset deleted",
        description: `${name} has been deleted.`,
      });
    } catch (error: any) {
      console.error('[MediaManager] Delete failed:', error);
      toast({
        title: "Delete failed",
        description: error?.message || "Failed to delete asset. Please try again.",
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
        toast({ title: 'Background cleared', description: 'Default background restored.' });
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
      toast({ title: 'Background set', description: item.name });
    } catch (error) {
      console.error('[MediaManager] Activate failed:', error);
      toast({
        title: 'Failed to set background',
        description: 'Please try again.',
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
      toast({ title: 'Asset deleted', description: item.name });
    } catch (error: any) {
      console.error('[MediaManager] Delete failed:', error);
      toast({
        title: 'Delete failed',
        description: error?.message || 'Please try again.',
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
        title: "Prompt required",
        description: "Please enter a description for the image you want to generate.",
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
        title: "Content Policy Violation",
        description: "Your request contains inappropriate content and cannot be processed. Please create family-friendly wallpaper descriptions only.",
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

    const tier: AiTier = opts?.tier ?? effectiveTier;
    const premiumGems = premiumTier?.gems ?? 0;
    if (tier === 'premium' && anonMode) {
      toast({ title: 'Sign in for Premium', description: 'Premium images need a signed-in account with Snow Gems.' });
      return;
    }
    // Premium is charged by the server; the free tier is charged here as before.
    const imageCost = tier === 'premium' ? premiumGems : imageConfig.credits * 0.01;
    const isOwnerAdmin = user?.email?.toLowerCase() === 'joshua.perez@snowmediaent.com';
    if (!anonMode && !isOwnerAdmin && !checkCredits(imageCost)) {
      toast({
        title: "Insufficient Snow Gems",
        description: `You need ${imageCost.toFixed(2)} Snow Gems to generate an image. Your balance: ${profile?.credits?.toFixed(2) || '0.00'}`,
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
        title: "Now generating image",
        description: "Please wait...",
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
          title: 'Not enough Snow Gems',
          description: result?.details || `Premium needs ${premiumGems} Snow Gems. Top up from the Dashboard.`,
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
        throw new Error((result?.error === 'kids_blocked' ? result.details : null) || result?.error || result?.details || 'Failed to generate image');
      }

      // Anonymous = ephemeral: can't write to media_assets (RLS), but DO NOT
      // open a browser/new tab. On Android WebView, window.open() with a
      // data: URL launches the external system browser and traps the user.
      // Instead, append to the in-app anonGallery so the image renders right
      // here in the same grid the user navigates with the D-pad.
      if (anonMode) {
        const id = `anon-${Date.now()}`;
        const newImage: AnonImage = { id, dataUrl: result.image, name: generatePrompt.slice(0, 60) || 'AI image' };
        setAnonGallery((prev) => [newImage, ...prev].slice(0, ANON_MAX_IMAGES));
        toast({
          title: 'Image ready!',
          description: 'Added to your gallery. Sign in to save it permanently.',
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
        throw new Error('Session expired during generation. Please sign in and try again.');
      }

      const base64Response = await fetch(result.image);
      const blob = await base64Response.blob();
      const fileName = `ai-generated-${Date.now()}.jpg`;
      const file = new File([blob], fileName, { type: 'image/jpeg' });

      await uploadAsset(file, 'background', uploadForm.section, `AI Generated: ${generatePrompt}`);

      if (result.isAdmin) {
        toast({
          title: "Image complete!",
          description: `Your AI-generated background is ready. (Admin: free)`,
        });
      } else if (tier === 'premium') {
        // Charged server-side; only refresh the balance and say what happened.
        await fetchProfile();
        toast({ title: 'Premium image complete!', description: describeReceipt(result) ?? 'Your background is ready.' });
      } else {
        const creditDeducted = await deductCredits(imageCost, `AI Image Generation - ${generatePrompt}`);
        if (!creditDeducted) {
          toast({
            title: "Snow Gem deduction failed",
            description: "Image generated but couldn't deduct Snow Gems. Contact support.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Image complete!",
            description: `Your AI-generated background is ready. ${imageCost.toFixed(2)} Snow Gems used.`,
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
        title: "Generation failed",
        description: `Failed to generate image: ${error.message}`,
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
  const autoPromptRef = useRef<string | null>(null);
  useEffect(() => {
    const p = takeIntent(INTENT_KEYS.wallpaper);
    if (p) { autoPromptRef.current = p; setGeneratePrompt(p); }
  }, []);
  useEffect(() => {
    if (!autoPromptRef.current || generatePrompt !== autoPromptRef.current) return;
    autoPromptRef.current = null;
    const t = setTimeout(() => { void handleGenerateImage(); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatePrompt]);

  const handleCompare = async () => {
    const prompt = generatePrompt.trim();
    if (!prompt || comparing || generating) return;
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (!currentSession?.user) {
      toast({ title: 'Sign in to compare', description: 'The comparison needs a signed-in account.' });
      return;
    }
    const isOwnerAdmin = user?.email?.toLowerCase() === 'joshua.perez@snowmediaent.com';
    const standardCost = imageConfig.credits * 0.01;
    if (!isOwnerAdmin && !checkCredits(standardCost)) {
      toast({ title: 'Insufficient Snow Gems', description: `The Standard side costs ${standardCost.toFixed(2)} Snow Gems.`, variant: 'destructive' });
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
      ? 'The Premium side was your free sample.'
      : premium.ok && premium.body?.charged_gems
        ? `${premium.body.charged_gems} Snow Gems used for the Premium side.`
        : null;
    setCompare({
      prompt,
      free: freeImage,
      premium: premiumImage,
      freeError: freeImage ? null : String((free.body?.error === 'kids_blocked' ? free.body.details : null) || free.body?.error || free.body?.details || 'Standard did not answer.'),
      premiumError: premiumImage ? null : String(premium.body?.details || premium.body?.error || 'Premium did not answer.'),
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
        title: which === 'premium' ? 'Premium is now your level' : 'Standard is now your level',
        description: which === 'premium' && premiumTier
          ? `Saved. Premium images cost ${premiumTier.gems} Snow Gems each; switch back any time.`
          : 'Saved. Switch to Premium any time from the button next to Generate.',
      });
      setCompare(null);
      setGeneratePrompt('');
      setFocusedElement('generate-btn');
      setTimeout(() => galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) {
      toast({ title: 'Could not save it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
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
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-400 mx-auto mb-4" />
          <p className="text-xl text-blue-200">Loading media assets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? '' : 'tv-scroll-container tv-safe bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white'}>
      <div className={embedded ? '' : 'max-w-6xl mx-auto'}>
        {!embedded && (
          <div className="flex items-center mb-8">
            <BackButton
              onClick={onBack}
              label="Back to Home"
              focused={focusedElement === 'back'}
              className="mr-6"
            />
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">Media Manager</h1>
              <p className="text-xl text-blue-200">Upload and manage backgrounds, icons, and assets</p>
            </div>
          </div>
        )}

        {/* AI Generation Section — hidden in the website demo (uploads stay). */}
        {!isDemo() && (
        <Card className="bg-gradient-to-br from-purple-600 to-purple-800 border-purple-500 p-6 mb-6">
          <h2 className="text-2xl font-bold text-white mb-4">Generate Background with AI</h2>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="text-white">
                <div className="flex items-center gap-2 mb-2">
                  <Monitor className="w-4 h-4" />
                  <span className="text-sm text-purple-200">
                    Detected: {screenInfo.width}x{screenInfo.height} ({screenInfo.ratio})
                  </span>
                </div>
                <p className="text-sm text-purple-200">
                  {effectiveTier === 'premium' && premiumTier
                    ? `Premium: ${premiumTier.gems} Snow Gems per image - ${premiumTier.blurb ?? premiumTier.model}`
                    : `Cost: ${(imageConfig.credits * 0.01).toFixed(2)} Snow Gems - ${imageConfig.description}`}
                </p>
                {user && profile && (
                  <p className="text-sm text-purple-200">
                    Your balance: {profile.credits.toFixed(2)} Snow Gems
                  </p>
                )}
              </div>
              {!isAuthenticated && (
                <p className="text-sm text-purple-200 italic">Sign in to save your AI images.</p>
              )}
            </div>
            <div className="flex gap-4">
              <div className="flex-1" data-focus-id="prompt-input">
                <Label htmlFor="generate-prompt" className="text-white mb-2 block">Describe the background you want</Label>
                <Input
                  id="generate-prompt"
                  ref={promptInputRef}
                  value={generatePrompt}
                  onChange={(e) => setGeneratePrompt(e.target.value)}
                  placeholder="e.g., A serene mountain landscape at sunset with purple sky"
                  className={`bg-white/10 border-white/20 text-white placeholder:text-white/60 transition-all ${hasUserNavigated && focusedElement === 'prompt-input' ? 'ring-4 ring-brand-ice' : ''}`}
                  disabled={generating}
                />
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                <Button
                  onClick={() => handleGenerateImage()}
                  disabled={generating || comparing || !generatePrompt.trim() || (isAuthenticated && profile && profile.credits < tierCost)}
                  data-focus-id="generate-btn"
                  className={`bg-white/20 border-white/30 text-white hover:bg-white/30 transition-all ${getFocusClass('generate-btn')}`}
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    'Generate'
                  )}
                </Button>
                {premiumTier && (
                  <Button
                    type="button"
                    onClick={toggleTier}
                    disabled={generating || comparing}
                    data-focus-id="tier-btn"
                    title="Switch between Standard and Premium"
                    className={`transition-all ${effectiveTier === 'premium'
                      ? 'text-black border-0 [background:var(--gradient-gold)] hover:brightness-110'
                      : 'bg-white/10 border border-white/30 text-white hover:bg-white/20'} ${getFocusClass('tier-btn')}`}
                  >
                    {effectiveTier === 'premium' ? `Premium · ${premiumTier.gems} gems` : `Standard · ${(imageConfig.credits * 0.01).toFixed(0)} gem`}
                  </Button>
                )}
                {compareAvailable && (
                  <Button
                    type="button"
                    onClick={() => void handleCompare()}
                    disabled={generating || comparing || !generatePrompt.trim()}
                    data-focus-id="compare-btn"
                    className={`bg-brand-ice/20 border border-brand-ice/50 text-white hover:bg-brand-ice/30 transition-all ${getFocusClass('compare-btn')}`}
                  >
                    {comparing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    See the difference · free once
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
        )}

        {/* Standard against Premium, same prompt, side by side. */}
        {compare && (
          <Card className="bg-gradient-to-br from-brand-navy/85 via-[#12204a]/85 to-slate-950/90 border-brand-ice/20 shadow-xl rounded-3xl p-6 mb-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <h2 className="text-2xl font-quicksand font-bold text-white">Standard or Premium?</h2>
              <p className="text-sm text-brand-ice/80 truncate max-w-full">"{compare.prompt}"</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(['free', 'premium'] as const).map((side) => {
                const img = side === 'free' ? compare.free : compare.premium;
                const err = side === 'free' ? compare.freeError : compare.premiumError;
                const id = side === 'free' ? 'compare-keep-free' : 'compare-keep-premium';
                const title = side === 'free' ? 'Standard' : 'Premium';
                return (
                  <div key={side} className={`rounded-2xl overflow-hidden border ${side === 'premium' ? 'border-brand-gold/60' : 'border-white/15'} bg-black/30`}>
                    <div className="aspect-video bg-black/50 flex items-center justify-center">
                      {img ? (
                        <img src={img} alt={`${title} result`} className="w-full h-full object-cover" />
                      ) : comparing ? (
                        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
                      ) : (
                        <p className="text-sm text-white/60 px-4 text-center">{err}</p>
                      )}
                    </div>
                    <div className="p-4 flex items-center justify-between gap-3">
                      <div>
                        <p className={`font-quicksand font-bold ${side === 'premium' ? 'text-brand-gold' : 'text-white'}`}>{title}</p>
                        <p className="text-xs text-white/60">
                          {side === 'premium' && premiumTier ? `${premiumTier.gems} gems per image after this` : `${(imageConfig.credits * 0.01).toFixed(0)} gem per image`}
                        </p>
                      </div>
                      <Button
                        type="button"
                        onClick={() => void keepFromCompare(side)}
                        disabled={!img || comparing}
                        data-focus-id={id}
                        className={`${side === 'premium'
                          ? 'text-black border-0 [background:var(--gradient-gold)] hover:brightness-110'
                          : 'bg-white/15 border border-white/30 text-white hover:bg-white/25'} ${getFocusClass(id)}`}
                      >
                        Keep {title}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
              <p className="text-sm text-brand-ice/80">
                {compare.note ?? 'Standard costs its normal gems. Premium here is your free sample.'}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => { setCompare(null); setFocusedElement('generate-btn'); }}
                data-focus-id="compare-close"
                className={`border-white/25 bg-white/5 text-white ${getFocusClass('compare-close')}`}
              >
                Close
              </Button>
            </div>
          </Card>
        )}

        {/* Upload Section */}
        <Card className="bg-gradient-to-br from-blue-600 to-blue-800 border-blue-500 p-6 mb-8">
          <h2 className="text-2xl font-bold text-white mb-4">Upload New Asset</h2>
          <div className="grid grid-cols-1 md:grid-cols-1 gap-4 mb-4">
            <div data-focus-id="asset-type">
              <Label htmlFor="asset-type" className="text-white mb-2 block">Asset Type</Label>
              <Select value={uploadForm.assetType} onValueChange={(value) => setUploadForm({...uploadForm, assetType: value as MediaAsset['asset_type']})}>
                <SelectTrigger className={`bg-white/10 border-white/20 text-white transition-all rounded-md ${focusedElement === 'asset-type' ? 'ring-4 ring-brand-ice scale-105' : ''}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600">
                  <SelectItem value="background">Background</SelectItem>
                  <SelectItem value="icon">Icon</SelectItem>
                  <SelectItem value="logo">Logo</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div data-focus-id="file-input">
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={`bg-white/20 border-white/30 text-white hover:bg-white/30 transition-all rounded-md ${focusedElement === 'file-input' ? 'ring-4 ring-brand-ice scale-105' : ''}`}
            >
              {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Choose File
            </Button>
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
          </div>
        </Card>


        {/* Gallery — medium thumbnails, 3 per row on a TV. Each card has its
            own ACTIVATE (set as background) + DELETE controls, both D-pad
            focusable with a bright brand-ice highlight ring. */}
        <div ref={galleryRef} className="space-y-4">
          <h3 className="text-2xl font-bold text-white mb-4">
            Your Assets {galleryItems.length > 0 && (
              <span className="text-base font-normal text-blue-200">
                ({galleryItems.length})
              </span>
            )}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4">
            {galleryItems.map((item, index) => {
              const isFocused = focusedElement === `asset-${index}`;
              const isToggleFocused = focusedElement === `asset-toggle-${item.id}`;
              const isDeleteFocused = focusedElement === `asset-delete-${item.id}`;
              return (
                <Card
                  key={item.id}
                  data-focus-id={`asset-${index}`}
                  className={`relative bg-gradient-to-br from-muted to-background border-border p-3 transition-all overflow-hidden ${
                    item.isActive ? 'ring-2 ring-green-500' : ''
                  } ${isFocused ? 'ring-4 ring-brand-ice scale-105 z-10' : ''}`}
                >
                  {/* Active indicator badge */}
                  {item.isActive && (
                    <div className="absolute top-2 right-2 z-10 bg-green-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded shadow">
                      Background
                    </div>
                  )}

                  {/* Medium-sized thumbnail — fixed aspect, contained */}
                  <div className="aspect-video bg-muted rounded mb-2 overflow-hidden max-h-40">
                    <img
                      src={item.url}
                      alt={item.name}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>

                  <h4 className="text-sm font-semibold text-foreground mb-1 truncate">{item.name}</h4>
                  <p className="text-xs text-muted-foreground mb-2">
                    {item.kind === 'anon' ? 'Session only · sign in to save' : `${item.asset.asset_type} · ${item.asset.section}`}
                  </p>

                  <div className="flex items-center justify-between gap-2">
                    <Button
                      size="sm"
                      type="button"
                      data-focus-id={`asset-toggle-${item.id}`}
                      onClick={() => handleActivateItem(item)}
                      className={`flex-1 text-xs transition-all ${
                        item.isActive
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : 'bg-brand-ice/20 hover:bg-brand-ice/30 text-white border border-brand-ice/40'
                      } ${isToggleFocused ? 'ring-4 ring-brand-ice scale-105' : ''}`}
                    >
                      {item.isActive ? (
                        <><Eye className="w-3 h-3 mr-1" /> Active</>
                      ) : (
                        <><EyeOff className="w-3 h-3 mr-1" /> Activate</>
                      )}
                    </Button>

                    <Button
                      size="sm"
                      type="button"
                      variant="destructive"
                      data-focus-id={`asset-delete-${item.id}`}
                      className={`transition-all ${isDeleteFocused ? 'ring-4 ring-brand-ice scale-105' : ''}`}
                      onClick={(e) => { e.stopPropagation(); handleDeleteItem(item); }}
                      aria-label={`Delete ${item.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>


        {assets.length === 0 && anonGallery.length === 0 && (
          <div className="text-center py-12">
            <Upload className="w-16 h-16 text-slate-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-slate-300 mb-2">No assets uploaded yet</h3>
            <p className="text-slate-400">Upload your first image to get started</p>
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
            <AlertDialogTitle className="text-white">Heads up — you're not signed in</AlertDialogTitle>
            <AlertDialogDescription className="text-blue-100">
              This image won't be saved to your account. Sign in to keep your AI-generated images permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="bg-slate-700 text-white hover:bg-slate-600 border-slate-600">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={() => {
                setShowAnonWarning(false);
                navigate('/auth');
              }}
            >
              Sign in
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-purple-600 text-white hover:bg-purple-700"
              onClick={() => {
                setShowAnonWarning(false);
                handleGenerateImage(true);
              }}
            >
              Generate anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default MediaManager;