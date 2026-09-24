import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { takeIntent, INTENT_KEYS, PLAYER_INTENT_EVENT, handLiveDeeplink, type PlayerIntent } from '@/lib/appActions';
import { App as CapApp } from '@capacitor/app';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Tv, Film, ListVideo, LayoutGrid, Grid2X2, Loader2, RefreshCw, Settings as SettingsIcon, LifeBuoy, Trophy } from 'lucide-react';
import { kidsLevel } from '@/lib/kidsFilter';
// The module-level toast, not the hook: the hook subscribes its caller to
// every toast state change, which only <Toaster> needs.
import { toast } from '@/hooks/use-toast';
import {
  loadCreds,
  clearCreds,
  authenticateRouted,
  buildPlayerAccount,
  savePlayerAccount,
  clearPlayerAccount,
  bumpXtreamRefresh,
  clearLiveCatalogue,
  daysUntilExp,
  SERVERS,
  type XtreamCreds,
} from '@/lib/xtream';
import { saveLiveLayout, type LiveLayout } from '@/lib/liveLayout';
import { autoSignInPlayer, clearPlayerSignedOut, markPlayerSignedOut } from '@/lib/playerAutoSignIn';
import { useAuth } from '@/hooks/useAuth';
import { syncPlayerAccountToCloud } from '@/lib/playerAccountSync';
import { capturePlayerSignin } from '@/lib/playerSigninCapture';
import { runAfter, runWhenIdle } from '@/utils/idle';
import { enterQuiet, exitQuiet, setQuietEverywhere } from '@/utils/quietMode';
import { markReconciled, reconciledRecently, RECONCILE_EVERY_MS, RECONCILE_URGENT_MS } from '@/lib/panelReconcile';
import { usePlayerServerAlert } from '@/hooks/usePlayerServerAlert';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { useVersion } from '@/hooks/useVersion';
import { clearPlexToken } from '@/lib/plex';
import { isClaimDismissed, isClaimDone, markClaimDismissed } from '@/lib/accountClaim';
import { trackEvent, trackAlertShown, startTimer, stopTimer, hasSessionFlag } from '@/lib/analytics';
import PlayerServerAlertDialog from './livetv/PlayerServerAlertDialog';
import PlayerModeChooser from './livetv/PlayerModeChooser';
import ExpirationNoticeDialog from './livetv/ExpirationNoticeDialog';
import PlexBlockedScreen from './livetv/PlexBlockedScreen';

import LiveSection from './livetv/LiveSection';
const GuideSection = lazy(() => import('./livetv/GuideSection'));
const GameDaySection = lazy(() => import('./livetv/GameDaySection'));
const MoviesSection = lazy(() => import('./livetv/MoviesSection'));
const SeriesSection = lazy(() => import('./livetv/SeriesSection'));
const PlexSection = lazy(() => import('./livetv/PlexSection'));
const CredentialsForm = lazy(() => import('./livetv/CredentialsForm'));
const ClaimAccountCard = lazy(() => import('./livetv/ClaimAccountCard'));
const LayoutTrialPrompt = lazy(() => import('./livetv/LayoutTrialPrompt'));
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

type SectionId = 'live' | 'guide' | 'gameday' | 'vod' | 'movies' | 'series' | 'plex' | 'multi' | 'backups';

const Player = memo(({ onBack, onNavigate }: Props) => {

  const { user, loading: authLoading } = useAuth();

  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  const [credsLoaded, setCredsLoaded] = useState(false);
  // When true, the user has explicitly opened the Account form even though
  // valid creds already exist (i.e. to change account).
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  // Read-only "Account info" view, shown from the header Account button.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The assistant can open Player Settings straight on a screen.
  const [settingsInitialView, setSettingsInitialView] = useState<'appearance' | undefined>(undefined);
  // "Finish your Snow Media account": opened right after a Live TV sign-in
  // when Snow Media has no account for that line yet.
  const [claimOpen, setClaimOpen] = useState(false);
  const claimOpenRef = useRef(claimOpen);
  useEffect(() => { claimOpenRef.current = claimOpen; }, [claimOpen]);

  const [section, setSection] = useState<SectionId>('live');
  const [mode, setMode] = useState<'choose' | 'live' | 'movies'>('choose');
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [pane, setPane] = useState<'header' | 'sections' | 'content'>('sections');
  // Trying a Live TV layout picked in Appearance: Live TV shows in it, and
  // after a few seconds asks Keep / Change.
  const [layoutTrial, setLayoutTrial] = useState<{ prev: LiveLayout; next: LiveLayout; ask: boolean } | null>(null);
  useEffect(() => {
    if (!layoutTrial || layoutTrial.ask) return;
    const t = window.setTimeout(() => {
      // Already watching a channel full screen (Vibez plays on OK): they have
      // their answer; keep it rather than ask over the picture.
      if (document.documentElement.classList.contains('snowplayer-fullscreen')) { setLayoutTrial(null); return; }
      setLayoutTrial((lt) => (lt ? { ...lt, ask: true } : lt));
    }, 3000);
    return () => window.clearTimeout(t);
  }, [layoutTrial]);
  // enterMode is declared further down; reached through a ref.
  const enterModeRef = useRef<(m: 'live' | 'movies' | 'backups') => void>(() => {});
  const tryLayout = useCallback((prev: LiveLayout, next: LiveLayout) => {
    saveLiveLayout(next);
    setLayoutTrial({ prev, next, ask: false });
    setSettingsOpen(false);
    setSettingsInitialView(undefined);
    enterModeRef.current('live');
    setPane('content');
  }, []);
  const keepLayout = useCallback(() => setLayoutTrial(null), []);
  const changeLayout = useCallback(() => {
    setLayoutTrial((lt) => { if (lt) saveLiveLayout(lt.prev); return null; });
    setSettingsInitialView('appearance');
    setSettingsOpen(true);
  }, []);
  const trialAsking = !!layoutTrial?.ask;
  // Left Live TV before the question came up: the new layout simply stays.
  useEffect(() => {
    if (layoutTrial && (section !== 'live' || mode !== 'live' || settingsOpen)) setLayoutTrial(null);
  }, [layoutTrial, section, mode, settingsOpen]);
  const [headerIdx, setHeaderIdx] = useState(0);
  // Where to return when leaving the header via Down.
  const headerReturnPaneRef = useRef<'sections' | 'content'>('sections');

  const serverLabel = creds?.serverLabel ?? SERVERS.find(s => s.host === creds?.host)?.label ?? null;
  // Demo: never query server-targeted alerts for the canned demo account.
  // While Plex is open an app alert placed on "Plex" shows here too.
  // A new visit each time Live TV or Plex is entered: an alert shows every
  // time its section opens, like the popup Main Apps shows on launch.
  const [modeVisit, setModeVisit] = useState(0);
  useEffect(() => { setModeVisit((v) => v + 1); }, [mode]);
  const { alert: serverAlert, dismiss: dismissServerAlert, appLabel: serverAlertApp } = usePlayerServerAlert(DEMO ? null : serverLabel, mode === 'movies' ? ['Plex'] : [], modeVisit);
  // Read by the enterMode callbacks, which must not take serverLabel as a
  // dependency (they are handed to memoised children).
  const serverLabelRef = useRef(serverLabel);
  useEffect(() => { serverLabelRef.current = serverLabel; }, [serverLabel]);
  const serverAlertOpenRef = useRef(false);
  useEffect(() => { serverAlertOpenRef.current = !!serverAlert; }, [serverAlert]);
  // Same treatment for the expiry notice — see the keydown handler.
  const expNoticeOpenRef = useRef(false);

  // ── Expiration awareness (in-Player dialog + Plex block) ──────────────
  const { account: playerAccount, days: playerDays } = usePlayerAccount();
  const { version: appVersion } = useVersion();
  const acctServerLabel = playerAccount?.serverLabel || serverLabel || 'your';
  const plexBlocked =
    playerAccount !== null && playerDays !== null && playerDays < 0;
  // Read by the delayed panel reconcile, which decides how recent is recent.
  const plexBlockedRef = useRef(plexBlocked); plexBlockedRef.current = plexBlocked;
  const playerDaysRef = useRef(playerDays); playerDaysRef.current = playerDays;

  // Safety net: shell must never mount with a stray fullscreen/multiview flag
  // (only the active player is allowed to set these). Clear on entry so a
  // reload while the class was set never leaks a hidden chrome / black window.
  useEffect(() => {
    document.documentElement.classList.remove('snowplayer-fullscreen');
    document.documentElement.classList.remove('snowplayer-multiview');
  }, []);

  // Quiet while the Player is open, on every box. Quiet mode pauses the
  // home screen's background jobs (the two alert polls, the mail poll, the
  // apps poll, the hourly update check) and used to apply only while a
  // stream was playing on a low-memory box — so while someone browsed Plex
  // on a 4 GB box, all of it kept running under the rails. None of it is
  // for the Player; the Player's own server alerts ride a realtime channel.
  useEffect(() => {
    try { setQuietEverywhere(true); enterQuiet('player-open'); } catch { /* ignore */ }
    return () => { try { exitQuiet('player-open'); setQuietEverywhere(false); } catch { /* ignore */ } };
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
  // The signed-in user is read when the job runs, not a dependency: auth
  // often finishes loading a moment after the creds, and re-running this
  // effect then cancelled the pending job for good (the one-shot flag was
  // already set).
  const userRef = useRef(user); userRef.current = user;
  // Whether Plex's player is up (reported by PlexSection).
  const [plexFullscreen, setPlexFullscreen] = useState(false);
  useEffect(() => {
    // Demo: no panel contact, no sign-in capture, no cloud sync.
    if (DEMO) return;
    if (!creds || refreshedRef.current) return;
    // Twelve seconds, not two and a half: this is a panel round-trip with a
    // twenty-second timeout, an edge function and a customer_services write,
    // and at two and a half seconds it landed inside Plex's settle screen
    // on every Player open. Nothing on screen waits for it — except a viewer
    // on the "expired" screen, who may have just renewed: theirs runs now.
    const cancel = runAfter(plexBlockedRef.current ? 0 : 12000, () => {
      // Marked when it runs, so a cancelled wait is simply scheduled again.
      refreshedRef.current = true;
      (async () => {
        try {
          const urgent = plexBlockedRef.current || (playerDaysRef.current !== null && playerDaysRef.current <= 7);
          if (reconciledRecently(urgent ? RECONCILE_URGENT_MS : RECONCILE_EVERY_MS)) return;
          markReconciled();
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
          const u = userRef.current;
          if (u?.id && u.email) {
            void syncPlayerAccountToCloud(u.id, u.email, acc);
          }
        } catch { /* swallow — background refresh is best-effort */ }
      })();
    });
    return cancel;
  }, [creds]);

  const onExitLeft = useCallback(() => setPane('sections'), []);
  // Game Day's Watch: the channel has been handed to Live TV; show it.
  const onGameDayWatch = useCallback(() => { setSection('live'); setPane('content'); }, []);
  const onExitUp = useCallback(() => {
    headerReturnPaneRef.current = 'content';
    setPane('header');
  }, []);

  const sections = useMemo<{ id: SectionId; label: string; icon: typeof Tv }[]>(() => {
    if (mode === 'live') return [
      { id: 'live',  label: 'Live TV', icon: Tv },
      { id: 'guide', label: 'Guide',   icon: LayoutGrid },
      // Today's big games and the channel each is on. Not on a Kids profile
      // (its channels are the kids ones); a Teens profile has it.
      ...(kidsLevel() === 'little' || kidsLevel() === 'kids' ? [] : [{ id: 'gameday' as SectionId, label: 'Game Day', icon: Trophy }]),
      // The line's movies, with Plex pinned first for everything else.
      { id: 'vod',   label: 'VOD',     icon: Film },
      { id: 'multi', label: 'Multi-Screen', icon: Grid2X2 },
      // Admin-published PPV and movie feeds carry no rating: never on a Kids
      // profile, whatever its age.
      ...(kidsLevel() ? [] : [{ id: 'backups' as SectionId, label: 'Backups', icon: LifeBuoy }]),
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

  // Fresh channel lists once per Player open, done BEFORE any Live section
  // mounts. It used to run 250 ms after Live TV opened: the section had
  // already asked for its categories, so the refresh threw that answer away
  // and fetched it again, and it also expired the weekly channel count, so
  // the full line-up was downloaded and counted on every open. Bumping here,
  // while nothing is listening yet, makes the first request the fresh one.
  const autoRefreshedRef = useRef(false);
  // Plex opened from the VOD list: leaving Plex returns there, not to the
  // mode chooser.
  const plexFromVodRef = useRef(false);
  const enterMode = useCallback((m: 'live' | 'movies' | 'backups') => {
    plexFromVodRef.current = false;
    // Backups are not on a Kids profile (see sections); Live TV instead.
    if (m === 'backups' && kidsLevel()) m = 'live';
    if (m !== 'movies' && !autoRefreshedRef.current) {
      autoRefreshedRef.current = true;
      bumpXtreamRefresh();
    }
    if (m === 'backups') {
      // Backups lands in the normal Live shell with the Backups section
      // selected — no new top-level mode.
      setMode('live');
      setSection('backups');
      setPane('content');
      if (!DEMO) { try { trackEvent('mode_enter', 'player', { mode: 'backups', service: serverLabelRef.current }); } catch { /* ignore */ } }
      return;
    }
    setMode(m);
    setSection(m === 'live' ? 'live' : 'plex');
    setSectionIdx(0);
    // Live TV opens with the highlight already on its categories, not on
    // the far-left menu.
    setPane(m === 'live' ? 'content' : 'sections');
    if (!DEMO) { try { trackEvent('mode_enter', 'player', { mode: m, service: serverLabelRef.current }); } catch { /* ignore */ } }
  }, []);
  enterModeRef.current = enterMode;
  const leaveMode = useCallback(() => {
    if (modeRef.current === 'movies' && plexFromVodRef.current) {
      plexFromVodRef.current = false;
      setMode('live');
      setSection('vod');
      setPane('content');
      return;
    }
    setMode('choose');
    setSectionIdx(0);
    setPane('sections');
  }, []);
  const openPlexFromVod = useCallback(() => {
    enterMode('movies');
    plexFromVodRef.current = true;
  }, [enterMode]);

  // What the assistant or a voice command asked for. The channel to play or
  // report and the Plex title are handed on through sessionStorage (read by
  // LiveSection / PlexSection when they mount) and an event (for when they
  // are already on screen).
  const applyIntent = useCallback((intent: PlayerIntent) => {
    const sec = intent.section ?? 'live';
    if (sec === 'movies') { enterMode('movies'); if (intent.plex) setPane('content'); }
    else if (sec === 'backups') enterMode('backups');
    else {
      enterMode('live');
      if (sec === 'guide' || sec === 'multi' || sec === 'gameday') { setSection(sec); setPane('content'); }
    }
    const hand = (key: string, event: string, value: unknown) => {
      try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent(event, { detail: value })); } catch { /* ignore */ }
    };
    if (intent.report) hand('smc-live-report', 'smc:live-report', intent.report);
    if (intent.play) hand('smc-live-play', 'smc:live-play', intent.play);
    if (intent.plex) hand('smc-plex-voice', 'smc:plex-voice', intent.plex);
    if (intent.deeplink) handLiveDeeplink(intent.deeplink);
    // Player Settings (sign-out, the line's password, billing) is a grown-up's.
    if (intent.settings && !kidsLevel()) { setSettingsInitialView(intent.settings === 'appearance' ? 'appearance' : undefined); setSettingsOpen(true); }
  }, [enterMode]);
  const applyIntentRef = useRef(applyIntent);
  applyIntentRef.current = applyIntent;
  // Already open: act on it now (the stored copy is for a Player that opens).
  useEffect(() => {
    const on = (e: Event) => {
      if (!playerOpenRef.current) return;
      const intent = (e as CustomEvent<PlayerIntent>).detail;
      if (!intent) return;
      takeIntent(INTENT_KEYS.player);
      applyIntentRef.current(intent);
    };
    window.addEventListener(PLAYER_INTENT_EVENT, on);
    return () => window.removeEventListener(PLAYER_INTENT_EVENT, on);
  }, []);

  // player_open — once per LiveTV mount.
  const playerOpenRef = useRef(false);
  useEffect(() => {
    if (!credsLoaded || playerOpenRef.current) return;
    playerOpenRef.current = true;
    // The assistant's "open Live TV / the Guide / Plex / Appearance", or a
    // channel to report: read once, act once the Player knows its sign-in.
    const intent = takeIntent<PlayerIntent>(INTENT_KEYS.player, true);
    if (intent && creds) applyIntentRef.current(intent);
    if (!DEMO) {
      try {
        trackEvent('player_open', 'player', {
          has_creds: !!creds,
          service: serverLabel,
          // Did they browse the content bar this run, or come straight here?
          content_bar_used: hasSessionFlag('content_bar'),
        });
      } catch { /* ignore */ }
    }
  }, [credsLoaded, creds, serverLabel]);

  // mode_enter — also fire when the user changes SECTION inside a mode
  // (e.g. Live TV → Guide, or Movies & Series → Plex/Movies/Series).
  const lastSectionRef = useRef<SectionId | null>(null);
  useEffect(() => {
    if (mode === 'choose') { lastSectionRef.current = null; return; }
    if (lastSectionRef.current === section) return;
    lastSectionRef.current = section;
    if (!DEMO) { try { trackEvent('mode_enter', 'player', { mode: section, service: serverLabel }); } catch { /* ignore */ } }
  }, [section, mode, serverLabel]);

  // Time spent in each part of the Player — Live TV, Movies & Series, the
  // Guide, Multi-Screen, Backups — one timer restarted on every move, closed
  // on the way out. The mode chooser itself is not a place anyone stays, so
  // it is not timed.
  useEffect(() => {
    if (DEMO || mode === 'choose') return;
    try { startTimer('player_section', 'mode_dwell', 'player', { mode: section, service: serverLabel }); } catch { /* ignore */ }
    return () => { try { stopTimer('player_section'); } catch { /* ignore */ } };
  }, [section, mode, serverLabel]);


  // Content-Bar deep-link: land straight in Movies & Series (PlexSection
  // consumes the payload itself — do not remove it here).
  useEffect(() => {
    try {
      if (sessionStorage.getItem('smc-plex-deeplink')) enterMode('movies');
      // A channel from the content bar: LiveSection plays it on mount.
      else if (sessionStorage.getItem('smc-live-deeplink')) enterMode('live');
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
    // Signed out on purpose: the next open asks, instead of signing back in.
    markPlayerSignedOut();
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
  // Read through a ref so the callback keeps its identity while the toast
  // timer flips `isRefreshing` — every effect that lists it as a dep (the
  // shell keydown listener among them) was torn down and re-registered twice
  // per Player open.
  const isRefreshingRef = useRef(isRefreshing);
  useEffect(() => { isRefreshingRef.current = isRefreshing; }, [isRefreshing]);
  const refreshChannels = useCallback(() => {
    if (isRefreshingRef.current) return;
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
  }, [toast, serverLabel]);


  // The live lists are only worth keeping while Live TV is on screen. Leaving
  // for the chooser or Plex, closing the Player, or changing account drops
  // them; a full line-up is tens of MB of objects on a 1-2 GB box.
  useEffect(() => { if (mode !== 'live') clearLiveCatalogue(); }, [mode]);
  useEffect(() => () => clearLiveCatalogue(), []);

  // No line on this box, but the viewer's billing or Snow Media account has
  // one: sign the Player in with it before asking (see playerAutoSignIn.ts).
  // Once per Player open, after auth has settled; the form shows if nothing
  // works, and never after a deliberate sign-out.
  // 'idle' until it runs, 'done' after; the spinner covers the wait so the
  // form never appears and is then pulled away mid-typing.
  const [autoSignIn, setAutoSignIn] = useState<'idle' | 'running' | 'done'>(DEMO ? 'done' : 'idle');
  const autoCancelRef = useRef(false);
  useEffect(() => () => { autoCancelRef.current = true; }, []);
  // Auth normally settles in a moment; don't wait on it for ever.
  const [authWaitOver, setAuthWaitOver] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setAuthWaitOver(true), 5000);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (autoSignIn !== 'idle' || !credsLoaded) return;
    if (creds) { setAutoSignIn('done'); return; }
    if (authLoading && !authWaitOver) return;
    setAutoSignIn('running');
    const timer = window.setTimeout(() => {
      autoCancelRef.current = true;
      setAutoSignIn('done');
    }, 15000);
    void autoSignInPlayer(user?.id ?? null, () => autoCancelRef.current)
      .then((c) => {
        if (autoCancelRef.current || !c) return;
        clearPlayerSignedOut();
        setCreds((cur) => cur ?? c);
      })
      .catch(() => { /* the form shows */ })
      .finally(() => {
        window.clearTimeout(timer);
        if (!autoCancelRef.current) setAutoSignIn('done');
      });
  }, [autoSignIn, credsLoaded, creds, authLoading, authWaitOver, user?.id]);
  const autoSigningIn = autoSignIn !== 'done';

  const showCredsForm = !DEMO && mode === 'live' && (!creds || accountFormOpen);
  // Demo: the settings hub exposes sign-out / change-credentials / switch-account,
  // none of which apply to a fixed demo account — never mount it.
  const showSettings = !DEMO && !kidsLevel() && !!creds && settingsOpen && !accountFormOpen;

  const onSwitchAccount = useCallback((c: XtreamCreds) => {
    if (DEMO) return; // demo account is fixed
    clearLiveCatalogue();
    setCreds(c);
    setSettingsOpen(false);
    setAccountFormOpen(false);
  }, []);


  // Keyboard for shell (header pane + sections pane; content pane is owned by child)
  const paneRef = useRef(pane);
  const sectionIdxRef = useRef(sectionIdx);
  const headerIdxRef = useRef(headerIdx);
  const showCredsFormRef = useRef(showCredsForm);
  // Set by CredentialsForm while it is showing a full-screen child.
  const credsChildOpenRef = useRef(false);
  useEffect(() => { paneRef.current = pane; }, [pane]);
  useEffect(() => { sectionIdxRef.current = sectionIdx; }, [sectionIdx]);
  useEffect(() => { headerIdxRef.current = headerIdx; }, [headerIdx]);
  useEffect(() => { showCredsFormRef.current = showCredsForm; }, [showCredsForm]);

  // [Back, Update, Settings] — Settings is hidden in demo and on a Kids
  // profile (it holds sign-out, the line's password and billing), so 2 there.
  const HEADER_COUNT = DEMO || kidsLevel() ? 2 : 3;

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
      // And the "finish your account" card after sign-in. Its own handler is
      // registered later than this one, so a swallowed arrow here moved the
      // highlight in the background while the card sat still on top.
      if (claimOpenRef.current) return;
      if (showCredsFormRef.current) {
        // A full-screen sign-up child is mounted inside the form and owns its
        // own Back. Without this, one press both closed the child AND called
        // leaveMode(), dropping the viewer out of the Player mid-purchase.
        if (credsChildOpenRef.current) return;
        if (e.defaultPrevented) return;
        // Ask the DOM where focus actually is, not where the event says it came
        // from. Our own Capacitor backButton listener synthesizes this Escape on
        // document.body, so e.target is BODY even while the viewer is typing in
        // the sign-in form — and this handler concluded "not typing" and called
        // leaveMode(), tearing the form down on the first Back.
        const isField = (n: HTMLElement | null) =>
          !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable);
        const typing = isField(e.target as HTMLElement | null)
          || isField(document.activeElement as HTMLElement | null);
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
      // The first-open Live TV layout chooser owns the remote while it is up.
      if ((window as unknown as { __liveLayoutChooserOpen?: boolean }).__liveLayoutChooserOpen) return;

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
        } else if (e.key === 'ArrowDown') {
          // Return focus to the player area where the user came from.
          setPane(headerReturnPaneRef.current);
        } else if (e.key === 'ArrowUp') {
          // Already at the very top: stay there. Up used to drop the
          // highlight back into the pane below, so a second press — or an
          // accidental one — bounced the viewer out of the menu they had
          // just reached. Swallowed, exactly like Up at the top of a list.
        } else if (e.key === 'Enter' || e.key === ' ') {
          const idx = headerIdxRef.current;
          if (idx === 0) leaveMode();
          else if (idx === 1) refreshChannels();
          else if (idx === 2 && !DEMO && !kidsLevel()) setSettingsOpen(true);
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
  }, []);

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




  // Stable props for PlexSection. It is memoised, and three inline arrows
  // here re-rendered all of Plex on every Player render: the server-alert
  // fetch, the account refresh, each toast, each auth event.
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => { onNavigateRef.current = onNavigate; }, [onNavigate]);
  // Same for Live TV and the Guide: the raw prop is a new arrow on every home
  // screen render, which re-rendered both memoised sections behind playback.
  const navigateViaRef = useCallback((view: string) => { onNavigateRef.current?.(view); }, []);
  const plexNeedLiveTV = useCallback(() => enterMode('live'), [enterMode]);
  const plexOpenBufferingGuide = useCallback(() => {
    try {
      sessionStorage.setItem('smc-open-buffering-guide', '1');
      const w = window as unknown as { __playerOwnsBack?: boolean; __overlayHandledBackAt?: number; __bufferingGuideOpen?: boolean };
      w.__playerOwnsBack = false;
      w.__overlayHandledBackAt = 0;
      w.__bufferingGuideOpen = true;
    } catch { /* ignore */ }
    onNavigateRef.current?.('support');
    // Event fallback for other callers / late listeners.
    setTimeout(() => { window.dispatchEvent(new CustomEvent('support:open-buffering-guide')); }, 80);
  }, []);
  const plexOpenSupport = useCallback(() => {
    try {
      const w = window as unknown as { __playerOwnsBack?: boolean; __overlayHandledBackAt?: number };
      w.__playerOwnsBack = false;
      w.__overlayHandledBackAt = 0;
    } catch { /* ignore */ }
    onNavigateRef.current?.('support');
  }, []);

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

  // Movies & Series = full-page Plex for real users (unchanged). Demo falls
  // through to the shared three-pane shell so the canned Movies & Series
  // sections (liveTvDemo fixtures via xtream.ts) are browsable too.
  if (mode === 'movies' && !DEMO) {
    // A server alert waits while a film is playing (the player owns every key
    // and would leave it undismissable over the picture) and while the
    // expired-line screen or the expiry notice is up.
    const movieAlertShown = !!serverAlert && !expNoticeKind && !plexBlocked && !plexFullscreen;
    return (
      <div className="h-screen overflow-hidden flex flex-col text-white bg-black/70">
        {plexBlocked ? (
          <PlexBlockedScreen serverLabel={acctServerLabel} onBack={leaveMode} />
        ) : (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <PlexSection
              // A Player-level notice on top owns the remote. Its key listener
              // cannot stop Plex's (both sit on window), so without this one OK
              // both dismissed the notice and opened the title under it.
              isActive={!claimOpen && !expNoticeKind && !movieAlertShown}
              onFullscreenChange={setPlexFullscreen}
              onExitLeft={leaveMode}
              onExitUp={leaveMode}
              onNeedLiveTV={plexNeedLiveTV}
              onOpenBufferingGuide={plexOpenBufferingGuide}
              onOpenSupport={plexOpenSupport}
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
        {/* Alerts placed on Plex (and on the viewer's line) were fetched in
            Movies & Series but only ever drawn in the Live TV shell. */}
        {movieAlertShown && serverAlert && (
          <PlayerServerAlertDialog
            alert={serverAlert}
            serverLabel={serverAlertApp ?? serverLabel ?? 'Plex'}
            onDismiss={dismissServerAlert}
          />
        )}
      </div>
    );
  }


  // Sign-in screen — shown when no creds OR user opened account form
  if (showCredsForm && autoSigningIn && !accountFormOpen) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-white bg-black/70">
        <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
        <p className="mt-4 text-lg font-nunito text-brand-ice/80">Signing you in with your account…</p>
      </div>
    );
  }

  if (showCredsForm) {
    return (
      <div className="min-h-screen text-white bg-black/70">
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
          <CredentialsForm
            initial={creds}
            onChildOpenChange={(open) => { credsChildOpenRef.current = open; }}
            onSaved={(c) => {
              // A background auto sign-in must not save over this one.
              autoCancelRef.current = true;
              clearPlayerSignedOut();
              setCreds(c);
              setAccountFormOpen(false);
            }}
            onNeedProfile={() => { if (!isClaimDismissed()) setClaimOpen(true); }}
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
          initialView={settingsInitialView}
          onBack={() => { setSettingsOpen(false); setSettingsInitialView(undefined); }}
          onSignOut={() => { void signOut(); }}
          onChangeCredentials={() => { if (DEMO) demoAccountNote(); else setAccountFormOpen(true); }}
          onSwitchAccount={onSwitchAccount}
          onTryLayout={tryLayout}
        />
      </Suspense>
    );
  }


  return (
    <div className="h-screen overflow-hidden flex flex-col text-white bg-black/70">
      {/* Pinned to the overscan-safe corner, not the physical edge — a flush
          4/8px offset was clipped on TVs that still crop the picture. */}
      <div
        style={{
          position: 'fixed',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5vh)',
          right: 'calc(env(safe-area-inset-right, 0px) + 1.5vw)',
          fontSize: 12,
          opacity: 0.5,
          color: '#fff',
          pointerEvents: 'none',
          zIndex: 50,
        }}
      >
        v{appVersion}
      </div>

      {serverAlert && serverLabel && (
        <PlayerServerAlertDialog
          alert={serverAlert}
          serverLabel={serverAlertApp ?? serverLabel}
          onDismiss={dismissServerAlert}
        />
      )}


      {/* Header */}
      <div data-player-chrome="" className="flex items-center justify-between px-5 py-2 border-b border-white/10 bg-black/30">
        <div className="flex items-center gap-3">
          <BackButton
            onClick={leaveMode}
            label="Back"
            className="h-10 rounded-lg"
            data-player-header-btn=""
            focused={pane === 'header' && headerIdx === 0}
          />
          <div className="flex items-center gap-2">
            <Tv className="w-5 h-5 text-brand-gold" />
            <h1 className="text-xl font-quicksand font-bold text-white">Player</h1>
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
            className={`tv-ring h-10 px-4 rounded-lg transition-transform duration-150 ease-out ${pane === 'header' && headerIdx === 1 ? 'scale-105 z-10' : ''}`}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Updating…' : 'Update Channels'}
          </Button>
          {/* Demo: no settings entry point — the demo account is fixed and
              the hub only exposes credential management. */}
          {!DEMO && !kidsLevel() && (
            <Button
              variant="gold"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              data-focused={pane === 'header' && headerIdx === 2 ? 'true' : 'false'}
              className={`tv-ring tv-ring-contrast h-10 px-4 rounded-lg transition-transform duration-150 ease-out ${pane === 'header' && headerIdx === 2 ? 'scale-105 z-10' : ''}`}
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
                  ${isFocused ? 'bg-brand-gold/25 scale-[1.02] z-10' : 'hover:bg-white/5'}
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
            isActive={pane === 'content' && !claimOpen && !trialAsking}
            onExitLeft={onExitLeft}
            onExitUp={onExitUp}
            onBack={onBack}
            onNavigate={navigateViaRef}
          />
        )}

        {section === 'guide' && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <GuideSection
              creds={creds!}
              isActive={pane === 'content' && !claimOpen}
              onExitLeft={onExitLeft}
              onExitUp={onExitUp}
              onNavigate={navigateViaRef}
            />
          </Suspense>
        )}

        {section === 'gameday' && creds && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <GameDaySection
              creds={creds}
              isActive={pane === 'content' && !claimOpen}
              onExitLeft={onExitLeft}
              onExitUp={onExitUp}
              onWatch={onGameDayWatch}
            />
          </Suspense>
        )}

        {section === 'multi' && creds && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <MultiScreenSection
              creds={creds}
              isActive={pane === 'content' && !claimOpen}
              onExitLeft={onExitLeft}
              onExitUp={onExitUp}
            />
          </Suspense>
        )}

        {/* Backups are a member perk: a box with no line never gets here
            (showCredsForm sends it to sign-in first), and an expired line is
            paused the same way Plex is. */}
        {section === 'backups' && (
          plexBlocked ? (
            <PlexBlockedScreen feature="Backups" serverLabel={acctServerLabel} onBack={onExitLeft} />
          ) : (
            <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
              <BackupsSection
                isActive={pane === 'content' && !claimOpen}
                onExitLeft={onExitLeft}
                onExitUp={onExitUp}
                serverLabel={serverLabel}
              />
            </Suspense>
          )
        )}


        {section === 'vod' && creds && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <MoviesSection
              creds={creds}
              isActive={pane === 'content' && !claimOpen}
              onExitLeft={onExitLeft}
              onExitUp={onExitUp}
              onOpenPlex={openPlexFromVod}
            />
          </Suspense>
        )}

        {section === 'movies' && creds && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <MoviesSection
              creds={creds!}
              isActive={pane === 'content' && !claimOpen}
              onExitLeft={onExitLeft}
              onExitUp={onExitUp}
            />
          </Suspense>
        )}
        {section === 'series' && creds && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <SeriesSection
              creds={creds!}
              isActive={pane === 'content' && !claimOpen}
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
                isActive={pane === 'content' && !claimOpen && !expNoticeKind && !serverAlert}
                onExitLeft={onExitLeft}
                onExitUp={onExitUp}
                onNeedLiveTV={plexNeedLiveTV}
                onOpenBufferingGuide={plexOpenBufferingGuide}
                onOpenSupport={plexOpenSupport}
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
      {trialAsking && layoutTrial && (
        <Suspense fallback={null}>
          <LayoutTrialPrompt layout={layoutTrial.next} onKeep={keepLayout} onChange={changeLayout} />
        </Suspense>
      )}
      {claimOpen && playerAccount && !isClaimDone(playerAccount) && (
        <Suspense fallback={null}>
          <ClaimAccountCard
            open={true}
            account={playerAccount}
            onClose={(outcome, email) => {
              setClaimOpen(false);
              if (outcome === 'notnow') markClaimDismissed();
              if (outcome === 'done') {
                toast({
                  title: "You're all set",
                  description: email ? `Your Snow Media account is ready (${email}).` : 'Saved. Add an email any time to get a Snow Media account.',
                });
              }
            }}
          />
        </Suspense>
      )}
    </div>
  );
});


Player.displayName = 'Player';
export default Player;
