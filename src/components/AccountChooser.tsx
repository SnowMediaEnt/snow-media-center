import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Card } from '@/components/ui/card';
import { Tv, Globe, Loader2 } from 'lucide-react';
import { BackButton } from '@/components/ui/BackButton';
import { useAuth } from '@/hooks/useAuth';
import type { XtreamCreds } from '@/lib/xtream';

// The Player's own sign-in form — reused verbatim. Its submit() already does
// authenticateRouted → saveCreds → buildPlayerAccount/savePlayerAccount →
// upsertSavedAccount → capturePlayerSignin('signin') → (cloud sync if a
// website user exists) → trackEvent('livetv_signin'). Nothing extra is
// persisted here; LiveTV rehydrates from the same storage via loadCreds().
const CredentialsForm = lazy(() => import('@/components/livetv/CredentialsForm'));

interface AccountChooserProps {
  onBack: () => void;
  /** Called AFTER CredentialsForm has persisted the Player sign-in. */
  onPlayerSignedIn: () => void;
}

const FOCUS_RING = 'ring-4 ring-brand-gold scale-105 shadow-[0_0_22px_rgba(185,162,121,0.75)] brightness-110';
const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];

type BackFlagsWindow = Window & { __playerOwnsBack?: boolean; __overlayHandledBackAt?: number };

/**
 * "My Account" sign-in view ('account-signin').
 *
 * Reached from Home when there is no website user and no Player account
 * (shows the two-card chooser), and from the dashboard's Player Account
 * section when there is no Player account yet. When a WEBSITE user is already
 * signed in, the chooser is skipped: the Player form opens directly and Cancel
 * returns to the dashboard (the website card would only bounce — /auth sends
 * signed-in users straight back to '/').
 *
 * Focus slots (choose mode): 0 = Back, 1 = Dreamstreams / Vibez card,
 * 2 = Website account card.
 *
 * Back handling:
 * - Chooser cards: DOM Back → Index.tsx's global handler (goBack); native
 *   hardware Back → useNavigation's listener (goBack).
 * - Player form open: CredentialsForm's useTVFocus owns the D-pad. DOM Back
 *   (web / older WebViews) → useTVFocus.onBack → onCancel. Native hardware
 *   Back on Fire TV / Android TV is NOT delivered as a keydown, so — mirroring
 *   LiveTV — we set window.__playerOwnsBack while the form is open (so
 *   useNavigation's listener bails) and register our own backButton listener
 *   that synthesizes an Escape keydown, which useTVFocus turns into onCancel
 *   (a first press while typing only hides the keyboard, exactly like the
 *   Player). The on-screen Cancel button does the same.
 */
const AccountChooser = ({ onBack, onPlayerSignedIn }: AccountChooserProps) => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const websiteUser = !!user;
  const [mode, setMode] = useState<'choose' | 'player'>('choose');
  const [focusIndex, setFocusIndex] = useState(1);

  // Guard: if this view was unmounted while a sign-in request was in flight,
  // CredentialsForm still persisted the Player sign-in, but we must not
  // navigate on behalf of a dead view.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Website user → skip the chooser, open the Player form directly (once).
  const autoOpenedRef = useRef(false);
  useLayoutEffect(() => {
    if (authLoading || !websiteUser || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    setMode('player');
  }, [authLoading, websiteUser]);

  // While the Player form is open, own native hardware Back (see JSDoc).
  useLayoutEffect(() => {
    if (mode !== 'player') return;
    const w = window as unknown as BackFlagsWindow;
    w.__playerOwnsBack = true;
    return () => { w.__playerOwnsBack = false; };
  }, [mode]);

  useEffect(() => {
    if (mode !== 'player') return;
    const w = window as unknown as BackFlagsWindow;
    let handle: { remove?: () => void } | undefined;
    let cancelled = false;
    (async () => {
      try {
        const h = await CapApp.addListener('backButton', () => {
          if (cancelled) return;
          w.__overlayHandledBackAt = Date.now();
          try {
            document.body.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Escape',
              code: 'Escape',
              keyCode: 27,
              which: 27,
              bubbles: true,
              cancelable: true,
            }));
          } catch {
            // Very old WebViews may not allow synthesizing KeyboardEvent.
            if (websiteUser) onBack(); else setMode('choose');
          }
        });
        if (cancelled) h?.remove?.();
        else handle = h;
      } catch {
        // Capacitor not available (web) — DOM Back already reaches useTVFocus.
      }
    })();
    return () => {
      cancelled = true;
      handle?.remove?.();
    };
  }, [mode, websiteUser, onBack]);

  useEffect(() => {
    if (mode !== 'choose') return;
    const handleKey = (e: KeyboardEvent) => {
      // A modal (auto-update prompt, welcome popup, dialogs) owns the keyboard.
      if (document.querySelector('[data-autoupdate-dialog="true"], [aria-modal="true"]')) return;
      const target = e.target as HTMLElement | null;
      const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isTyping) return;
      if (!NAV_KEYS.includes(e.key)) return;
      e.preventDefault();
      // The two cards sit SIDE BY SIDE (md:grid-cols-2), so Down must not walk
      // from one to the other — Right/Left cross the row, Up returns to Back.
      switch (e.key) {
        case 'ArrowDown':
          if (focusIndex === 0) setFocusIndex(1);
          break;
        case 'ArrowUp':
          if (focusIndex === 1 || focusIndex === 2) setFocusIndex(0);
          break;
        case 'ArrowRight':
          if (focusIndex === 1) setFocusIndex(2);
          break;
        case 'ArrowLeft':
          if (focusIndex === 2) setFocusIndex(1);
          break;
        case 'Enter':
        case ' ':
          if (focusIndex === 0) onBack();
          else if (focusIndex === 1) setMode('player');
          else if (focusIndex === 2) navigate('/auth');
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mode, focusIndex, onBack, navigate]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
      </div>
    );
  }

  if (mode === 'player') {
    return (
      <div className="min-h-screen text-white bg-black/70 relative">
        <p
          className="absolute left-0 right-0 z-10 text-center text-brand-ice/80 font-nunito text-sm px-6 pointer-events-none"
          style={{ top: 'max(env(safe-area-inset-top, 0px), 4vh)' }}
        >
          Dreamstreams / Vibez streaming login — this also signs you in to the Player.
        </p>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
          <CredentialsForm
            initial={null}
            onSaved={(_c: XtreamCreds) => { if (mountedRef.current) onPlayerSignedIn(); }}
            onCancel={() => { if (websiteUser) onBack(); else setMode('choose'); }}
          />
        </Suspense>
      </div>
    );
  }

  return (
    // Sized to FIT, not to scroll. The icon shares a row with the heading
    // instead of stacking above it, the copy is trimmed to what a reader on a
    // couch actually needs, and everything is measured against a short (540px
    // CSS) TV viewport. overflow-y-auto stays only as a safety valve for an
    // unusually small panel — at these sizes there is nothing to scroll.
    <div className="fixed inset-0 tv-scroll-container tv-safe text-white overflow-y-auto overscroll-contain">
      <div className="flex items-center w-full justify-start mb-4">
        <BackButton onClick={onBack} label="Back to Home" focused={focusIndex === 0} />
      </div>
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-5">
          <h1 className="text-3xl font-bold text-white leading-tight">My Account</h1>
          <p className="text-base text-blue-200">Choose how you want to sign in</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Card
            tabIndex={0}
            data-focused={focusIndex === 1 ? 'true' : 'false'}
            onFocus={() => setFocusIndex(1)}
            onMouseEnter={() => setFocusIndex(1)}
            onClick={() => setMode('player')}
            className={`tv-focusable cursor-pointer border-0 rounded-3xl p-5 [background:var(--gradient-navy)] outline-none transition-all duration-200 ${focusIndex === 1 ? FOCUS_RING : ''}`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 shrink-0 rounded-xl bg-brand-gold/20 flex items-center justify-center">
                <Tv className="w-6 h-6 text-brand-gold" />
              </div>
              <h2 className="text-xl font-bold text-white leading-tight">Sign in with Dreamstreams / Vibez</h2>
            </div>
            <p className="text-brand-ice/80 font-nunito text-sm leading-snug">
              Your STREAMING login — the same username &amp; password you use in the Player.
              Signs you into the Player too, and shows your subscription and expiry date here.
            </p>
            <p className="text-brand-ice/50 font-nunito text-xs mt-2">
              Email usernames connect to Vibez, everything else to Dreamstreams.
            </p>
          </Card>

          <Card
            tabIndex={0}
            data-focused={focusIndex === 2 ? 'true' : 'false'}
            onFocus={() => setFocusIndex(2)}
            onMouseEnter={() => setFocusIndex(2)}
            onClick={() => navigate('/auth')}
            className={`tv-focusable cursor-pointer rounded-3xl p-5 bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 outline-none transition-all duration-200 ${focusIndex === 2 ? FOCUS_RING : ''}`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 shrink-0 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <Globe className="w-6 h-6 text-blue-300" />
              </div>
              <h2 className="text-xl font-bold text-white leading-tight">Snow Media website account</h2>
            </div>
            <p className="text-slate-300 font-nunito text-sm leading-snug">
              Your WEBSITE account — purchases, support tickets, messages and Snow Gems.
              NOT your streaming login; your service keeps working either way.
            </p>
            <p className="text-slate-500 font-nunito text-xs mt-2">
              Sign in or create a free account.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AccountChooser;
