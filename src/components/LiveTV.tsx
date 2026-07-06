import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Tv, Film, ListVideo, LayoutGrid, Grid2X2, Loader2, RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  loadCreds,
  clearCreds,
  authenticateRouted,
  buildPlayerAccount,
  savePlayerAccount,
  clearPlayerAccount,
  bumpXtreamRefresh,
  SERVERS,
  type XtreamCreds,
} from '@/lib/xtream';
import { useAuth } from '@/hooks/useAuth';
import { syncPlayerAccountToCloud } from '@/lib/playerAccountSync';
import { capturePlayerSignin } from '@/lib/playerSigninCapture';
import { runWhenIdle } from '@/utils/idle';
import { usePlayerServerAlert } from '@/hooks/usePlayerServerAlert';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { clearPlexToken } from '@/lib/plex';
import { trackEvent, trackAlertShown } from '@/lib/analytics';
import PlayerServerAlertDialog from './livetv/PlayerServerAlertDialog';
import PlayerModeChooser from './livetv/PlayerModeChooser';
import ExpirationNoticeDialog from './livetv/ExpirationNoticeDialog';
import PlexBlockedScreen from './livetv/PlexBlockedScreen';

import LiveSection from './livetv/LiveSection';
const GuideSection = lazy(() => import('./livetv/GuideSection'));
const MoviesSection = lazy(() => import('./livetv/MoviesSection'));
const SeriesSection = lazy(() => import('./livetv/SeriesSection'));
const PlexSection = lazy(() => import('./livetv/PlexSection'));
const CredentialsForm = lazy(() => import('./livetv/CredentialsForm'));
const SettingsHub = lazy(() => import('./livetv/SettingsHub'));
const MultiScreenSection = lazy(() => import('./livetv/MultiScreenSection'));


interface Props {
  onBack: () => void;
  onNavigate?: (view: string) => void;
}

type SectionId = 'live' | 'guide' | 'movies' | 'series' | 'plex' | 'multi';

const Player = memo(({ onBack, onNavigate }: Props) => {

  const { toast } = useToast();
  const { user } = useAuth();

  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  const [credsLoaded, setCredsLoaded] = useState(false);
  // When true, the user has explicitly opened the Account form even though
  // valid creds already exist (i.e. to change account).
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  // Read-only "Account info" view, shown from the header Account button.
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [section, setSection] = useState<SectionId>('live');
  const [mode, setMode] = useState<'choose' | 'live' | 'movies'>('choose');
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [pane, setPane] = useState<'header' | 'sections' | 'content'>('sections');
  const [headerIdx, setHeaderIdx] = useState(0);
  // Where to return when leaving the header via Down.
  const headerReturnPaneRef = useRef<'sections' | 'content'>('sections');

  const serverLabel = creds?.serverLabel ?? SERVERS.find(s => s.host === creds?.host)?.label ?? null;
  const { alert: serverAlert, dismiss: dismissServerAlert } = usePlayerServerAlert(serverLabel);
  const serverAlertOpenRef = useRef(false);
  useEffect(() => { serverAlertOpenRef.current = !!serverAlert; }, [serverAlert]);

  // ── Expiration awareness (in-Player dialog + Plex block) ──────────────
  const { account: playerAccount, days: playerDays } = usePlayerAccount();
  const acctServerLabel = playerAccount?.serverLabel || serverLabel || 'your';
  const plexBlocked =
    playerAccount !== null && playerDays !== null && playerDays < 0;

  // Expiration dialog — once per day per state (warn|expired).
  const [expNoticeKind, setExpNoticeKind] = useState<'warn' | 'expired' | null>(null);
  useEffect(() => {
    if (!credsLoaded || !creds) return;
    if (playerDays === null) return;
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    let kind: 'warn' | 'expired' | null = null;
    if (playerDays < 0) kind = 'expired';
    else if (playerDays <= 7) kind = 'warn';
    if (!kind) return;
    const key = `snow-player-exp-notice-${kind}-${ymd}`;
    try {
      if (localStorage.getItem(key) === '1') return;
    } catch { /* ignore */ }
    setExpNoticeKind(kind);
    try { trackAlertShown(`player_expiration_${kind}`); } catch { /* ignore */ }
    // trackAlertShown expects a title; pass extra props via trackEvent too.
    try { trackEvent('player_expiration_shown', 'player', { kind, days: playerDays, server: acctServerLabel }); } catch { /* ignore */ }
  }, [credsLoaded, creds, playerDays, acctServerLabel]);

  const dismissExpNotice = useCallback(() => {
    const kind = expNoticeKind;
    setExpNoticeKind(null);
    if (!kind) return;
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    try { localStorage.setItem(`snow-player-exp-notice-${kind}-${ymd}`, '1'); } catch { /* ignore */ }
  }, [expNoticeKind]);

  // On becoming blocked → sign out of Plex once per (expDate) so future
  // renewals aren't punished. Flag stored in localStorage.
  const PLEX_KICK_KEY = 'snow-plex-kicked-for-exp';
  useEffect(() => {
    if (!plexBlocked || !playerAccount) return;
    const expTag = String(playerAccount.expDate ?? 'unknown');
    try {
      if (localStorage.getItem(PLEX_KICK_KEY) === expTag) return;
      void clearPlexToken();
      localStorage.setItem(PLEX_KICK_KEY, expTag);
    } catch {
      // Fire the sign-out anyway; missing storage is not fatal.
      void clearPlexToken();
    }
  }, [plexBlocked, playerAccount]);
  // If they renew (days back >= 0), clear the flag so a future expiration re-kicks.
  useEffect(() => {
    if (!plexBlocked) {
      try { localStorage.removeItem(PLEX_KICK_KEY); } catch { /* ignore */ }
    }
  }, [plexBlocked]);



  // Load creds on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await loadCreds();
      if (cancelled) return;
      setCreds(c);
      setCredsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Background refresh: when Player opens with existing creds, re-call the
  // panel once (deferred to idle) so the local PlayerAccount picks up the
  // latest expDate/status. Also re-syncs to cloud if signed in.
  const refreshedRef = useRef(false);
  useEffect(() => {
    if (!creds || refreshedRef.current) return;
    refreshedRef.current = true;
    const cancel = runWhenIdle(() => {
      (async () => {
        try {
          const res = await authenticateRouted(creds.username, creds.password);
          if (!res.ok || !res.server || !res.creds) return;
          const acc = buildPlayerAccount(res.server, res.creds, res.userInfo);
          await savePlayerAccount(acc);
          // Reconcile capture — refreshes expiration/last_seen for every
          // player-signed-in user, even without a Supabase session. Does NOT
          // bump signin_count.
          void capturePlayerSignin(acc, res.server.label, 'reconcile');
          if (user?.id && user.email) {
            void syncPlayerAccountToCloud(user.id, user.email, acc);
          }
        } catch { /* swallow — background refresh is best-effort */ }
      })();
    }, 2500);
    return cancel;
  }, [creds, user?.id, user?.email]);

  const onExitLeft = useCallback(() => setPane('sections'), []);
  const onExitUp = useCallback(() => {
    headerReturnPaneRef.current = 'content';
    setPane('header');
  }, []);

  const sections = useMemo<{ id: SectionId; label: string; icon: typeof Tv }[]>(() => {
    if (mode === 'live') return [
      { id: 'live',  label: 'Live TV', icon: Tv },
      { id: 'guide', label: 'Guide',   icon: LayoutGrid },
      { id: 'multi', label: 'Multi-Screen', icon: Grid2X2 },
    ];
    if (mode === 'movies') return [
      { id: 'plex', label: 'Plex', icon: Film },
      ...(creds ? [
        { id: 'movies' as SectionId, label: 'Movies', icon: Film },
        { id: 'series' as SectionId, label: 'Series', icon: ListVideo },
      ] : []),
    ];
    return [];
  }, [mode, creds]);
  const sectionsRef = useRef(sections);
  useEffect(() => { sectionsRef.current = sections; }, [sections]);

  // Keep section/sectionIdx valid when the sections list changes — e.g. signing
  // out of IPTV in Movies mode shrinks [plex,movies,series] → [plex].
  useEffect(() => {
    if (mode === 'choose' || sections.length === 0) return;
    if (!sections.some((s) => s.id === section)) setSection(sections[0].id);
    if (sectionIdx > sections.length - 1) setSectionIdx(sections.length - 1);
  }, [sections, section, sectionIdx, mode]);

  const enterMode = useCallback((m: 'live' | 'movies') => {
    setMode(m);
    setSection(m === 'live' ? 'live' : 'plex');
    setSectionIdx(0);
    setPane('sections');
    try { trackEvent('mode_enter', 'player', { mode: m }); } catch { /* ignore */ }
  }, []);
  const leaveMode = useCallback(() => {
    setMode('choose');
    setSectionIdx(0);
    setPane('sections');
  }, []);

  // player_open — once per LiveTV mount.
  const playerOpenRef = useRef(false);
  useEffect(() => {
    if (!credsLoaded || playerOpenRef.current) return;
    playerOpenRef.current = true;
    try { trackEvent('player_open', 'player', { has_creds: !!creds }); } catch { /* ignore */ }
  }, [credsLoaded, creds]);

  // mode_enter — also fire when the user changes SECTION inside a mode
  // (e.g. Live TV → Guide, or Movies & Shows → Plex/Movies/Series).
  const lastSectionRef = useRef<SectionId | null>(null);
  useEffect(() => {
    if (mode === 'choose') { lastSectionRef.current = null; return; }
    if (lastSectionRef.current === section) return;
    lastSectionRef.current = section;
    try { trackEvent('mode_enter', 'player', { mode: section }); } catch { /* ignore */ }
  }, [section, mode]);


  // Content-Bar deep-link: land straight in Movies & Shows (PlexSection
  // consumes the payload itself — do not remove it here).
  useEffect(() => {
    try {
      if (sessionStorage.getItem('smc-plex-deeplink')) enterMode('movies');
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = useCallback(async () => {
    await clearCreds();
    await clearPlayerAccount();
    setCreds(null);
    setAccountFormOpen(false);
    setSettingsOpen(false);
    toast({ title: 'Signed out', description: 'Sign in again to use the Player.' });
  }, [toast]);

  // Refresh channel list (categories + currently visible category).
  // Cheap: bumps a nonce that cache-busts player_api.php and tells the
  // visible section to refetch — does NOT eagerly load every category.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshChannels = useCallback(() => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try { trackEvent('update_channels', 'player', { server: serverLabel }); } catch { /* ignore */ }
    const updatingId = toast({
      title: 'Updating channels…',
      description: 'Fetching the latest list from the server.',
    });
    bumpXtreamRefresh();
    window.setTimeout(() => {
      try { (updatingId as any)?.dismiss?.(); } catch { /* ignore */ }
      toast({ title: 'Channels updated!', description: 'You now have the latest channels.' });
      setIsRefreshing(false);
    }, 1400);
  }, [isRefreshing, toast, serverLabel]);


  // Auto-refresh once whenever the Player opens with valid creds.
  const autoRefreshedRef = useRef(false);
  useEffect(() => {
    if (!creds || autoRefreshedRef.current) return;
    autoRefreshedRef.current = true;
    // Defer a tick so the child sections have mounted their listeners.
    window.setTimeout(() => { refreshChannels(); }, 250);
  }, [creds, refreshChannels]);

  const showCredsForm = mode === 'live' && (!creds || accountFormOpen);
  const showSettings = !!creds && settingsOpen && !accountFormOpen;

  const onSwitchAccount = useCallback((c: XtreamCreds) => {
    setCreds(c);
    setSettingsOpen(false);
    setAccountFormOpen(false);
  }, []);


  // Keyboard for shell (header pane + sections pane; content pane is owned by child)
  const paneRef = useRef(pane);
  const sectionIdxRef = useRef(sectionIdx);
  const headerIdxRef = useRef(headerIdx);
  const showCredsFormRef = useRef(showCredsForm);
  useEffect(() => { paneRef.current = pane; }, [pane]);
  useEffect(() => { sectionIdxRef.current = sectionIdx; }, [sectionIdx]);
  useEffect(() => { headerIdxRef.current = headerIdx; }, [headerIdx]);
  useEffect(() => { showCredsFormRef.current = showCredsForm; }, [showCredsForm]);

  const HEADER_COUNT = 3; // [Back, Update, Settings]

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // AccountInfoScreen owns the keyboard while open.
      if (settingsOpen && creds && !accountFormOpen) return;
      if (modeRef.current !== 'live') return;
      // Player server-alert popup owns the keyboard while open.
      if (serverAlertOpenRef.current) return;

      if (showCredsFormRef.current) {
        const target = e.target as HTMLElement;
        const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        const isBack = e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace';
        if (isBack && typing) {
          // Don't act, but don't let Index's bubble handler pop the Player either.
          e.stopPropagation();
          return;
        }
        if (isBack && !typing) {
          e.preventDefault();
          e.stopPropagation();
          if (accountFormOpen && creds) setAccountFormOpen(false);
          else leaveMode();
        }
        return;
      }

      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;

      // --- Header pane owns the keyboard ---
      if (paneRef.current === 'header') {
        if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
          e.preventDefault(); e.stopPropagation();
          leaveMode();
          return;
        }
        const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
        if (!arrows.includes(e.key)) return;
        // stopImmediatePropagation + blurring any lingering DOM focus prevents
        // WebView spatial-navigation on Fire TV from also moving focus and
        // making the header ring appear "stuck" on Back.
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        const ae = document.activeElement as HTMLElement | null;
        if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();

        if (e.key === 'ArrowLeft') {
          setHeaderIdx(i => (i - 1 + HEADER_COUNT) % HEADER_COUNT);
        } else if (e.key === 'ArrowRight') {
          setHeaderIdx(i => (i + 1) % HEADER_COUNT);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          // Return focus to the player area where the user came from.
          setPane(headerReturnPaneRef.current);
        } else if (e.key === 'Enter' || e.key === ' ') {
          const idx = headerIdxRef.current;
          if (idx === 0) leaveMode();
          else if (idx === 1) refreshChannels();
          else if (idx === 2) setSettingsOpen(true);
        }
        return;
      }


      // --- Sections pane: Up at idx 0 enters the header ---
      if (paneRef.current !== 'sections') return;

      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        leaveMode();
        return;
      }

      const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!arrows.includes(e.key)) return;
      e.preventDefault();

      if (e.key === 'ArrowDown') setSectionIdx(i => Math.min(sectionsRef.current.length - 1, i + 1));
      else if (e.key === 'ArrowUp') {
        if (sectionIdxRef.current === 0) {
          headerReturnPaneRef.current = 'sections';
          setPane('header');
        } else {
          setSectionIdx(i => Math.max(0, i - 1));
        }
      }
      else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
        setSection(sectionsRef.current[sectionIdxRef.current].id);
        setPane('content');
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onBack, accountFormOpen, settingsOpen, creds, signOut, refreshChannels, leaveMode]);


  // ──────────────────────────────────────────────────────────────────────────
  // Hardware BACK on Fire TV / Android TV is captured by Capacitor's native
  // App.backButton listener and is NOT reliably delivered to the WebView as a
  // keydown. Without this, useNavigation's backButton handler pops the Player
  // view straight out to the home screen.
  //
  // While Player is mounted:
  //   1. Set window.__playerOwnsBack = true so useNavigation's listener bails.
  //   2. Register our own App.backButton listener that synthesizes an Escape
  //      keydown — existing keydown handlers (LiveSection: fullscreen → bar →
  //      channels → categories, LiveTV: sections → onBack) walk the hierarchy
  //      naturally. We also stamp __overlayHandledBackAt synchronously as a
  //      belt-and-braces guard regardless of native listener invocation order.
  // ──────────────────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    (window as unknown as { __playerOwnsBack?: boolean }).__playerOwnsBack = true;
    return () => { (window as unknown as { __playerOwnsBack?: boolean }).__playerOwnsBack = false; };
  });

  useEffect(() => {
    type W = { __playerOwnsBack?: boolean; __overlayHandledBackAt?: number };
    const w = window as unknown as W;



    let handle: { remove?: () => void } | undefined;
    let cancelled = false;
    (async () => {
      try {
        const h = await CapApp.addListener('backButton', () => {
          
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

            // Very old WebViews may not allow synthesizing KeyboardEvent —
            // fall back to a direct onBack at the top of the hierarchy.
            if (modeRef.current === 'choose') {
              onBack();
            } else if (paneRef.current === 'sections' && !settingsOpen && !accountFormOpen) {
              leaveMode();
            }
          }
        });
        if (cancelled) h?.remove?.();
        else handle = h;
      } catch {
        // Capacitor not available (web) — keydown Escape already covers it.
      }
    })();

    return () => {
      cancelled = true;
      handle?.remove?.();
    };
  }, [onBack, settingsOpen, accountFormOpen]);




  if (!credsLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white">
        <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
      </div>
    );
  }

  if (mode === 'choose') {
    return <PlayerModeChooser onPick={enterMode} onBack={onBack} />;
  }

  if (mode === 'movies') {
    return (
      <div className="h-screen overflow-hidden flex flex-col text-white bg-black/70">
        {plexBlocked ? (
          <PlexBlockedScreen serverLabel={acctServerLabel} onBack={leaveMode} />
        ) : (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <PlexSection
              isActive={true}
              onExitLeft={leaveMode}
              onExitUp={leaveMode}
              onOpenBufferingGuide={() => {
                try {
                  sessionStorage.setItem('smc-open-buffering-guide', '1');
                  const w = window as unknown as { __playerOwnsBack?: boolean; __overlayHandledBackAt?: number; __bufferingGuideOpen?: boolean };
                  w.__playerOwnsBack = false;
                  w.__overlayHandledBackAt = 0;
                  w.__bufferingGuideOpen = true;
                } catch { /* ignore */ }
                onNavigate?.('support');
                // Event fallback for other callers / late listeners.
                setTimeout(() => { window.dispatchEvent(new CustomEvent('support:open-buffering-guide')); }, 80);
              }}
              onOpenSupport={() => {
                try {
                  const w = window as unknown as { __playerOwnsBack?: boolean; __overlayHandledBackAt?: number };
                  w.__playerOwnsBack = false;
                  w.__overlayHandledBackAt = 0;
                } catch { /* ignore */ }
                onNavigate?.('support');
              }}
            />
          </Suspense>
        )}
        {expNoticeKind && (
          <ExpirationNoticeDialog
            open={true}
            serverLabel={acctServerLabel}
            days={playerDays ?? 0}
            onDismiss={dismissExpNotice}
          />
        )}
      </div>
    );
  }


  // Sign-in screen — shown when no creds OR user opened account form
  if (showCredsForm) {
    return (
      <div className="min-h-screen text-white bg-black/70">
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
          <CredentialsForm
            initial={creds}
            onSaved={(c) => {
              setCreds(c);
              setAccountFormOpen(false);
            }}
            onCancel={creds ? () => setAccountFormOpen(false) : leaveMode}
          />
        </Suspense>
      </div>
    );
  }

  // Settings hub (Account / Switch Account / Appearance).
  if (showSettings) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-white"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
        <SettingsHub
          onBack={() => setSettingsOpen(false)}
          onSignOut={() => { void signOut(); }}
          onChangeCredentials={() => setAccountFormOpen(true)}
          onSwitchAccount={onSwitchAccount}
        />
      </Suspense>
    );
  }


  return (
    <div className="h-screen overflow-hidden flex flex-col text-white bg-black/70">
      <div data-player-chrome="" style={{ position: 'fixed', bottom: 2, right: 6, fontSize: 9, opacity: 0.35, color: '#fff', pointerEvents: 'none', zIndex: 50 }}>v1.6</div>

      {serverAlert && serverLabel && (
        <PlayerServerAlertDialog
          alert={serverAlert}
          serverLabel={serverLabel}
          onDismiss={dismissServerAlert}
        />
      )}


      {/* Header */}
      <div data-player-chrome="" className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="white"
            size="sm"
            onClick={leaveMode}
            data-player-header-btn=""
            data-focused={pane === 'header' && headerIdx === 0 ? 'true' : 'false'}
            className={`tv-focusable home-focus-surface transition-transform duration-150 ${
              pane === 'header' && headerIdx === 0 ? 'scale-105' : ''
            }`}
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Tv className="w-7 h-7 text-brand-gold" />
            <h1 className="text-2xl font-quicksand font-bold text-white">Player</h1>
            {creds?.serverLabel && (
              <span className="ml-2 text-xs px-2 py-1 rounded-full bg-white/10 text-brand-ice font-nunito">
                {creds.serverLabel}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="white"
            size="sm"
            onClick={refreshChannels}
            disabled={isRefreshing}
            aria-label="Update Channels"
            data-player-header-btn=""
            data-focused={pane === 'header' && headerIdx === 1 ? 'true' : 'false'}
            className={`tv-focusable home-focus-surface transition-transform duration-150 ${
              pane === 'header' && headerIdx === 1 ? 'scale-105' : ''
            }`}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Updating…' : 'Update Channels'}
          </Button>
          <Button
            variant="gold"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            data-player-header-btn=""
            data-focused={pane === 'header' && headerIdx === 2 ? 'true' : 'false'}
            className={`tv-focusable home-focus-surface transition-transform duration-150 ${
              pane === 'header' && headerIdx === 2 ? 'scale-105' : ''
            }`}
          >
            <SettingsIcon className="w-4 h-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>



      {/* Three-pane layout */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Pane 1 — Sections */}
        <div data-player-chrome=""
          onClick={() => { if (pane !== 'sections') setPane('sections'); }}
          className={`flex-shrink-0 border-r border-white/10 p-3 space-y-2 bg-black/50 overflow-hidden ${pane === 'sections' ? 'w-44 bg-white/5' : 'w-12 cursor-pointer'}`}
        >
          {sections.map((s, i) => {
            const Icon = s.icon;
            const isFocused = pane === 'sections' && sectionIdx === i;
            const isActive = section === s.id;
            const collapsed = pane !== 'sections';
            return (
              <div
                key={s.id}
                data-focused={isFocused ? 'true' : 'false'}
                onClick={(e) => { if (collapsed) return; e.stopPropagation(); setSectionIdx(i); setSection(s.id); setPane('content'); }}
                className={`
                  flex items-center gap-3 ${collapsed ? 'px-1 py-2 justify-center' : 'px-3 py-3'} rounded-xl cursor-pointer transition-all duration-150
                  ${isFocused ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-105 shadow-lg' : ''}
                  ${!isFocused && isActive ? 'bg-white/10' : ''}
                  ${!isFocused && !isActive ? 'hover:bg-white/5' : ''}
                `}
                title={collapsed ? s.label : undefined}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-brand-gold' : 'text-brand-ice'}`} />
                {!collapsed && <span className="font-quicksand font-semibold">{s.label}</span>}
              </div>
            );
          })}
        </div>

        {section === 'live' && (
          <LiveSection
            creds={creds!}
            isActive={pane === 'content'}
            onExitLeft={onExitLeft}
            onExitUp={onExitUp}
            onBack={onBack}
            onNavigate={onNavigate}
          />
        )}

        {section === 'guide' && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <GuideSection
              creds={creds!}
              isActive={pane === 'content'}
              onExitLeft={onExitLeft}
              onExitUp={onExitUp}
              onNavigate={onNavigate}
            />
          </Suspense>
        )}

        {section === 'multi' && creds && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <MultiScreenSection
              creds={creds}
              isActive={pane === 'content'}
              onExitLeft={onExitLeft}
              onExitUp={onExitUp}
            />
          </Suspense>
        )}


        {section === 'movies' && creds && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <MoviesSection
              creds={creds!}
              isActive={pane === 'content'}
              onExitLeft={onExitLeft}
              onExitUp={onExitUp}
            />
          </Suspense>
        )}
        {section === 'series' && creds && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <SeriesSection
              creds={creds!}
              isActive={pane === 'content'}
              onExitLeft={onExitLeft}
              onExitUp={onExitUp}
            />
          </Suspense>
        )}
        {section === 'plex' && (
          plexBlocked ? (
            <PlexBlockedScreen serverLabel={acctServerLabel} onBack={onExitLeft} />
          ) : (
            <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
              <PlexSection
                isActive={pane === 'content'}
                onExitLeft={onExitLeft}
                onExitUp={onExitUp}
                onOpenBufferingGuide={() => {
                  try {
                    sessionStorage.setItem('smc-open-buffering-guide', '1');
                    const w = window as unknown as { __playerOwnsBack?: boolean; __overlayHandledBackAt?: number; __bufferingGuideOpen?: boolean };
                    w.__playerOwnsBack = false;
                    w.__overlayHandledBackAt = 0;
                    w.__bufferingGuideOpen = true;
                  } catch { /* ignore */ }
                  onNavigate?.('support');
                  setTimeout(() => { window.dispatchEvent(new CustomEvent('support:open-buffering-guide')); }, 80);
                }}
              />
            </Suspense>
          )
        )}
      </div>
      {expNoticeKind && (
        <ExpirationNoticeDialog
          open={true}
          serverLabel={acctServerLabel}
          days={playerDays ?? 0}
          onDismiss={dismissExpNotice}
        />
      )}
    </div>
  );
});


Player.displayName = 'Player';
export default Player;
