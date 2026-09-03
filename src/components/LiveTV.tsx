import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Tv, Film, ListVideo, LayoutGrid, Grid2X2, Loader2, RefreshCw, Settings as SettingsIcon, LifeBuoy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  loadCreds,
  clearCreds,
  authenticateRouted,
  buildPlayerAccount,
  savePlayerAccount,
  clearPlayerAccount,
  bumpXtreamRefresh,
  daysUntilExp,
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
const BackupsSection = lazy(() => import('./livetv/BackupsSection'));
import { isDemo } from '@/lib/demoMode';
import { DEMO_LIVE_CREDS } from '@/data/liveTvDemo';
import { BackButton, BACK_ROW } from '@/components/ui/BackButton';

// Demo latch (?demo=1) — module scope like PlexSection. Every demo behavior
// below lives behind this flag so non-demo sessions stay byte-for-byte equal.
const DEMO = isDemo();


interface Props {
  onBack: () => void;
  onNavigate?: (view: string) => void;
}

type SectionId = 'live' | 'guide' | 'movies' | 'series' | 'plex' | 'multi' | 'backups';

const Player = memo(({ onBack, onNavigate }: Props) => {

  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();

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
  // Demo: never query server-targeted alerts for the canned demo account.
  const { alert: serverAlert, dismiss: dismissServerAlert } = usePlayerServerAlert(DEMO ? null : serverLabel);
  const serverAlertOpenRef = useRef(false);
  useEffect(() => { serverAlertOpenRef.current = !!serverAlert; }, [serverAlert]);
  // Same treatment for the expiry notice — see the keydown handler.
  const expNoticeOpenRef = useRef(false);

  // ── Expiration awareness (in-Player dialog + Plex block) ──────────────
  const { account: playerAccount, days: playerDays } = usePlayerAccount();
  const acctServerLabel = playerAccount?.serverLabel || serverLabel || 'your';
  const plexBlocked =
    playerAccount !== null && playerDays !== null && playerDays < 0;

  // Safety net: shell must never mount with a stray fullscreen/multiview flag
  // (only the active player is allowed to set these). Clear on entry so a
  // reload while the class was set never leaks a hidden chrome / black window.
  useEffect(() => {
    document.documentElement.classList.remove('snowplayer-fullscreen');
    document.documentElement.classList.remove('snowplayer-multiview');
  }, []);

  // Expiration dialog — once per day per state (warn|expired).
  const [expNoticeKind, setExpNoticeKind] = useState<'warn' | 'expired' | null>(null);
  useEffect(() => { expNoticeOpenRef.current = !!expNoticeKind; }, [expNoticeKind]);
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
      // Demo: skip storage entirely and present the canned account so the
      // visitor lands straight in the lineup — no sign-in form, no creds I/O.
      const c = DEMO ? DEMO_LIVE_CREDS : await loadCreds();
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
    // Demo: no panel contact, no sign-in capture, no cloud sync.
    if (DEMO) return;
    if (!creds || refreshedRef.current) return;
    refreshedRef.current = true;
    const cancel = runWhenIdle(() => {
      (async () => {
        try {
          const res = await authenticateRouted(creds.username, creds.password);
          // Expired/disabled/banned lines: sign-in stays refused, but the
          // panel DID authenticate the account — so keep recording the TRUE
          // state (fresh expDate/status) instead of bailing. This is what lets
          // a renewal surface the moment the panel flips the line back active.
          if (!res.ok && !(res.authedButBlocked && res.server && res.creds)) return;
          if (!res.server || !res.creds) return;
          // Guard: bail if creds changed/cleared during the reconcile so we
          // don't clobber a fresh sign-out or account switch.
          const nowCreds = await loadCreds();
          if (!nowCreds || nowCreds.username !== creds.username || nowCreds.host !== creds.host) return;
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
      { id: 'backups', label: 'Backups', icon: LifeBuoy },
    ];
    if (mode === 'movies') return [
      { id: 'plex', label: 'Plex', icon: Film },
      // Demo: Movies/Series render too — xtream.ts serves them from the
      // canned catalog (liveTvDemo.ts) when isDemo() is latched.
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

  // Keep the sidebar ring in sync with the rendered section — e.g. when
  // Backups is entered directly from the mode chooser.
  useEffect(() => {
    const i = sections.findIndex((s) => s.id === section);
    if (i >= 0 && i !== sectionIdx) setSectionIdx(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const enterMode = useCallback((m: 'live' | 'movies' | 'backups') => {
    if (m === 'backups') {
      // Backups lands in the normal Live shell with the Backups section
      // selected — no new top-level mode.
      setMode('live');
      setSection('backups');
      setPane('content');
      if (!DEMO) { try { trackEvent('mode_enter', 'player', { mode: 'backups' }); } catch { /* ignore */ } }
      return;
    }
    setMode(m);
    setSection(m === 'live' ? 'live' : 'plex');
    setSectionIdx(0);
    setPane('sections');
    if (!DEMO) { try { trackEvent('mode_enter', 'player', { mode: m }); } catch { /* ignore */ } }
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
    if (!DEMO) { try { trackEvent('player_open', 'player', { has_creds: !!creds }); } catch { /* ignore */ } }
  }, [credsLoaded, creds]);

  // mode_enter — also fire when the user changes SECTION inside a mode
  // (e.g. Live TV → Guide, or Movies & Shows → Plex/Movies/Series).
  const lastSectionRef = useRef<SectionId | null>(null);
  useEffect(() => {
    if (mode === 'choose') { lastSectionRef.current = null; return; }
    if (lastSectionRef.current === section) return;
    lastSectionRef.current = section;
    if (!DEMO) { try { trackEvent('mode_enter', 'player', { mode: section }); } catch { /* ignore */ } }
  }, [section, mode]);


  // Content-Bar deep-link: land straight in Movies & Shows (PlexSection
  // consumes the payload itself — do not remove it here).
  useEffect(() => {
    try {
      if (sessionStorage.getItem('smc-plex-deeplink')) enterMode('movies');
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Demo account notice — shown whenever an account-management action is
  // attempted in demo mode (sign out, change credentials, switch account).
  const demoAccountNote = useCallback(() => {
    toast({
      title: 'Live demo',
      description: 'The demo is pre-loaded with a demo account — sign-in and account switching work in the installed app.',
    });
  }, [toast]);

  const signOut = useCallback(async () => {
    // Demo: the demo account is pre-loaded — nothing to sign out of.
    if (DEMO) { demoAccountNote(); return; }
    await clearCreds();
    await clearPlayerAccount();
    setCreds(null);
    setAccountFormOpen(false);
    setSettingsOpen(false);
    toast({ title: 'Signed out', description: 'Sign in again to use the Player.' });
  }, [toast, demoAccountNote]);

  // Refresh channel list (categories + currently visible category).
  // Cheap: bumps a nonce that cache-busts player_api.php and tells the
  // visible section to refetch — does NOT eagerly load every category.
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Both timers below fire after the Player can be gone. Without these refs the
  // "Updating channels…" / "Channels updated!" toasts popped up over the HOME
  // screen for a Player that had already closed.
  const refreshToastTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (refreshToastTimerRef.current) window.clearTimeout(refreshToastTimerRef.current);
  }, []);
  const refreshChannels = useCallback(() => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    if (!DEMO) { try { trackEvent('update_channels', 'player', { server: serverLabel }); } catch { /* ignore */ } }
    const updatingId = toast({
      title: 'Updating channels…',
      description: 'Fetching the latest list from the server.',
    });
    bumpXtreamRefresh();
    if (refreshToastTimerRef.current) window.clearTimeout(refreshToastTimerRef.current);
    refreshToastTimerRef.current = window.setTimeout(() => {
      refreshToastTimerRef.current = null;
      try { (updatingId as any)?.dismiss?.(); } catch { /* ignore */ }
      toast({ title: 'Channels updated!', description: 'You now have the latest channels.' });
      setIsRefreshing(false);
    }, 1400) as unknown as number;
  }, [isRefreshing, toast, serverLabel]);


  // Auto-refresh once whenever the Player opens with valid creds.
  const autoRefreshedRef = useRef(false);
  useEffect(() => {
    if (!creds || autoRefreshedRef.current) return;
    autoRefreshedRef.current = true;
    // Defer a tick so the child sections have mounted their listeners.
    const t = window.setTimeout(() => { refreshChannels(); }, 250);
    return () => window.clearTimeout(t);
  }, [creds, refreshChannels]);

  const showCredsForm = !DEMO && mode === 'live' && (!creds || accountFormOpen);
  // Demo: the settings hub exposes sign-out / change-credentials / switch-account,
  // none of which apply to a fixed demo account — never mount it.
  const showSettings = !DEMO && !!creds && settingsOpen && !accountFormOpen;

  const onSwitchAccount = useCallback((c: XtreamCreds) => {
    if (DEMO) return; // demo account is fixed
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

  // [Back, Update, Settings] — Settings is hidden in demo, so 2 there.
  const HEADER_COUNT = DEMO ? 2 : 3;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // AccountInfoScreen owns the keyboard while open.
      if (settingsOpen && creds && !accountFormOpen) return;
      // Demo: movies mode also runs the three-pane shell, so it needs this nav.
      if (modeRef.current !== 'live' && !(DEMO && modeRef.current === 'movies')) return;
      // Player server-alert popup owns the keyboard while open.
      if (serverAlertOpenRef.current) return;
      // So does the expiry notice. Without this, one Back press dismissed the
      // dialog AND was handled here, throwing the viewer out of Live TV
      // entirely — two actions from one press.
      if (expNoticeOpenRef.current) return;
      if (showCredsFormRef.current) {
        if (e.defaultPrevented) return;
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
          else if (idx === 2 && !DEMO) setSettingsOpen(true);
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
    return (
      <>
        <PlayerModeChooser onPick={enterMode} onBack={onBack} />
      </>
    );
  }

  // Movies & Shows = full-page Plex for real users (unchanged). Demo falls
  // through to the shared three-pane shell so the canned Movies & Series
  // sections (liveTvDemo fixtures via xtream.ts) are browsable too.
  if (mode === 'movies' && !DEMO) {
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
            username={playerAccount?.username ?? null}
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
          onChangeCredentials={() => { if (DEMO) demoAccountNote(); else setAccountFormOpen(true); }}
          onSwitchAccount={onSwitchAccount}
        />
      </Suspense>
    );
  }


  return (
    <div className="h-screen overflow-hidden flex flex-col text-white bg-black/70">
      <div data-player-chrome="" style={{ position: 'fixed', bottom: 4, right: 8, fontSize: 12, opacity: 0.5, color: '#fff', pointerEvents: 'none', zIndex: 50 }}>v1.6.6</div>

      {serverAlert && serverLabel && (
        <PlayerServerAlertDialog
          alert={serverAlert}
          serverLabel={serverLabel}
          onDismiss={dismissServerAlert}
        />
      )}


      {/* Header */}
      <div data-player-chrome="" className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/30">
        <div className="flex items-center gap-3">
          <BackButton
            onClick={leaveMode}
            label="Back"
            className="h-12 rounded-xl"
            data-player-header-btn=""
            focused={pane === 'header' && headerIdx === 0}
          />
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
            data-focused={pane === 'header' && headerIdx === 1 ? 'true' : 'false'}
            className={`tv-ring h-12 px-5 rounded-xl transition-transform duration-150 ease-out ${pane === 'header' && headerIdx === 1 ? 'scale-105 z-10' : ''}`}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Updating…' : 'Update Channels'}
          </Button>
          {/* Demo: no settings entry point — the demo account is fixed and
              the hub only exposes credential management. */}
          {!DEMO && (
            <Button
              variant="gold"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              data-focused={pane === 'header' && headerIdx === 2 ? 'true' : 'false'}
              className={`tv-ring tv-ring-contrast h-12 px-5 rounded-xl transition-transform duration-150 ease-out ${pane === 'header' && headerIdx === 2 ? 'scale-105 z-10' : ''}`}
            >
              <SettingsIcon className="w-4 h-4 mr-2" />
              Settings
            </Button>
          )}
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
                  tv-ring relative flex items-center gap-3 ${collapsed ? 'px-1 py-3 justify-center' : 'px-3 py-3'} rounded-xl cursor-pointer
                  ${isFocused ? 'bg-brand-gold/25 scale-[1.02] z-10' : ''}
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

        {section === 'backups' && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <BackupsSection
              isActive={pane === 'content'}
              onExitLeft={onExitLeft}
              onExitUp={onExitUp}
              serverLabel={serverLabel}
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
          )
        )}
      </div>
      {expNoticeKind && (
        <ExpirationNoticeDialog
          open={true}
          serverLabel={acctServerLabel}
          username={playerAccount?.username ?? null}
          days={playerDays ?? 0}
          onDismiss={dismissExpNotice}
        />
      )}
    </div>
  );
});


Player.displayName = 'Player';
export default Player;
