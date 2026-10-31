import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDashboardSize, saveDashboardSize } from '@/lib/dashboardSize';
import { useMailNotify, saveMailNotify } from '@/lib/snowMail';
import { peekIntent, clearIntent, takeIntent, INTENT_KEYS, SCREEN_INTENT_EVENT } from '@/lib/appActions';
import { isDemo, isHowtoCapture } from '@/lib/demoMode';
import { AlertTriangle, Bell, Bot, Home, Image, KeyRound, Languages, RefreshCw, Settings as SettingsIcon, Smartphone, UsersRound } from 'lucide-react';
import { BAR_SHOWS, BAR_SOURCES, chooseBarShow, chooseBarSource, useBarPrefs } from '@/lib/homeBar';
import { loadSavedTiles, saveTiles } from '@/lib/homeTiles';
import { openProfiles } from '@/lib/profilesUi';
import { loadProfiles, pinsAvailable, PROFILES_EVENT } from '@/lib/profiles';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { PHONE_REMOTE_EVENT, connectedPhones, isPaired, setTypingHintEnabled, typingHintEnabled, unpairAllPhones } from '@/lib/phoneRemote';
import { getPreferredTier, loadAiTiers, setPreferredTier, type AiTier, type AiTierInfo } from '@/lib/aiTiers';
import { useAuth } from '@/hooks/useAuth';
import MediaManager from '@/components/MediaManager';
import AppUpdater from '@/components/AppUpdater';
import AppAlertsManager from '@/components/AppAlertsManager';
import ApkCacheViewer from '@/components/ApkCacheViewer';
import AdminAIPanel from '@/components/AdminAIPanel';
import { useAdminRole } from '@/hooks/useAdminRole';
import { useMediaBarEnabled } from '@/hooks/useMediaBarEnabled';
import { useDeviceAlerts } from '@/hooks/useDeviceAlerts';
import { useFeatureFlag, setFeatureFlag } from '@/hooks/useFeatureFlag';
import { useToast } from '@/hooks/use-toast';
import { SUPPORTED_LANGUAGES, LANG_STORAGE_KEY } from '@/i18n';
import { BackButton } from '@/components/ui/BackButton';
import { openScreen } from '@/lib/appActions';
import { trackEvent } from '@/lib/analytics';
import { keepInView } from '@/utils/keepInView';
import type { PageFocus } from '@/components/settings/SettingsRows';
import { useSettingsStates, type SettingsPage } from '@/components/settings/useSettingsStates';
import AccountPage from '@/components/settings/AccountPage';
import HomeScreenPage from '@/components/settings/HomeScreenPage';
import NotificationsPage from '@/components/settings/NotificationsPage';
import LanguagePage from '@/components/settings/LanguagePage';
import ProfilesPage from '@/components/settings/ProfilesPage';
import RemotePage from '@/components/settings/RemotePage';

const ReviewDialog = lazy(() => import('@/components/review/ReviewDialog'));

interface SettingsProps {
  onBack: () => void;
  layoutMode?: 'grid' | 'row';
  onLayoutChange?: (mode: 'grid' | 'row') => void;
  /** Opens another screen (the review's "Need help?" line opens the tickets). */
  onNavigate?: (view: string) => void;
}

/** Each menu row: its icon and its name (one key, so a rename is one string). */
const ROW_ICON: Record<SettingsPage, typeof Home> = {
  account: KeyRound, home: Home, backgrounds: Image, profiles: UsersRound, remote: Smartphone,
  notifications: Bell, language: Languages, updates: RefreshCw, alerts: AlertTriangle, ai: Bot,
};

/** The How-to guide's hooks on the menu rows (data-howto; literals, so its check finds them).
 *  The content bar's hook is the Home screen row: the guide's "switches" picture shows
 *  Notifications' two switches, with the row that holds the content bar beside them. */
const ROW_HOWTO: Partial<Record<SettingsPage, string>> = { home: 'set.contentBar', updates: 'set.updatesTab' };

/** Pages whose rows the remote walks with Settings' own keys; the others are panels with keys of their own. */
const LIST_PAGES: ReadonlySet<SettingsPage> = new Set<SettingsPage>(['account', 'home', 'profiles', 'remote', 'notifications', 'language']);

/** The page beside the menu follows the highlight once it rests this long (no page mounts for every row passed). */
const PREVIEW_REST_MS = 250;

/**
 * What the assistant, a voice command or another screen asks Settings to open
 * (INTENT_KEYS.settings). The old tab names still work: 'media' is
 * Backgrounds, 'ui' (the old catch-all tab) is Home screen, and 'ui-home' is
 * Home screen with the remote already on its first row.
 */
const INTENT_PAGE: Record<string, SettingsPage> = {
  media: 'backgrounds', backgrounds: 'backgrounds', ui: 'home', 'ui-home': 'home', home: 'home',
  account: 'account', profiles: 'profiles', remote: 'remote', notifications: 'notifications',
  language: 'language', updates: 'updates', alerts: 'alerts', ai: 'ai',
};

const isBackKey = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.which === 4 || e.code === 'GoBack';
const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];

/**
 * Settings, from Home. Laid out like Live TV › Settings (owner, 2026-10-30:
 * "make the main settings like the settings in Live TV"): a menu column on
 * the left, each row with its state in small text under the name, and the
 * highlighted row's page on the right. OK or Right moves the remote into the
 * page; Back, or Left at its left edge / Up at its top, returns to the menu;
 * Back on the menu leaves. Only the page scrolls, never the whole screen.
 *
 * The old "UI" tab held everything (the Player account, Snow AI, the content
 * bar, the Dashboard's size, posts, alerts, the Home screen, languages); it is
 * split into short pages so each row means one thing.
 *
 * The highlight is `tv-ring` + data-focused="true", driven by state, never by
 * native .focus() on a row: ring-* and shadow-[…] classes compile into one
 * box-shadow that index.css strips on low-memory boxes (a Fire TV showed no
 * highlight at all), and focusing a row hands the browser's own focus style a
 * second highlight. The panels that own real DOM focus (Updates, App alerts,
 * AI) keep it, and lose it on the way back to the menu.
 */
const Settings = ({ onBack, onNavigate }: SettingsProps) => {
  const { t, i18n } = useTranslation();
  const { isAdmin: hasAdminRole } = useAdminRole();
  // Website demo: never surface admin tooling (even to a signed-in admin) and
  // hide Updates entirely — APK self-updating is a device-only concern.
  const demo = isDemo();
  const { profile: currentProfile } = useActiveProfile();
  // A Kids profile gets a short Settings: the content bar, backgrounds (kept
  // kids-safe by the server), switching profile, the phone remote and the
  // language. No account, no updates and no admin tools, even on an admin's account.
  const kids = !!currentProfile.kidsLevel;
  const isAdmin = hasAdminRole && !demo && !kids;
  // The How-to pictures show the row a real box has (developer build only).
  const showUpdates = (!demo || isHowtoCapture()) && !kids;

  const rows: SettingsPage[] = kids
    ? ['home', 'backgrounds', 'profiles', 'remote', 'language']
    : [
      'account', 'home', 'backgrounds', 'profiles', 'remote', 'notifications', 'language',
      ...(showUpdates ? ['updates' as const] : []),
      ...(isAdmin ? ['alerts' as const, 'ai' as const] : []),
    ];

  const [mediaBarEnabled, setMediaBarEnabledState] = useMediaBarEnabled();
  // Home screen (grown-up profiles): what the content bar shows, and the tiles.
  const { source: barSource, show: barShow } = useBarPrefs();
  const cycleBarSource = () => chooseBarSource(BAR_SOURCES[(BAR_SOURCES.indexOf(barSource) + 1) % BAR_SOURCES.length]);
  const cycleBarShow = () => chooseBarShow(BAR_SHOWS[(BAR_SHOWS.indexOf(barShow) + 1) % BAR_SHOWS.length]);
  const { toast } = useToast();
  const resetHomeTiles = () => {
    const had = loadSavedTiles() !== null;
    saveTiles(null);
    toast({ title: i18n.t('homeEdit.settings.resetTitle'), description: had ? i18n.t('homeEdit.settings.resetDesc') : i18n.t('homeEdit.settings.resetAlreadyDesc') });
  };
  const dashboardSize = useDashboardSize();
  const mailNotify = useMailNotify();
  const deviceAlerts = useDeviceAlerts();
  const { enabled: playerEnabled } = useFeatureFlag('player_enabled', true);
  const [profilesList, setProfilesList] = useState(() => loadProfiles());
  useEffect(() => {
    const on = () => setProfilesList(loadProfiles());
    window.addEventListener(PROFILES_EVENT, on);
    return () => window.removeEventListener(PROFILES_EVENT, on);
  }, []);
  // Phone remote: pairing lives here (Settings › Phone remote).
  const [remoteTick, setRemoteTick] = useState(0);
  const remotePhonesRef = useRef(-1);
  useEffect(() => {
    const on = () => setRemoteTick((n) => n + 1);
    window.addEventListener(PHONE_REMOTE_EVENT, on);
    // Phones drop off the count by time alone (no event): look every 15 s,
    // but re-render all of Settings only when the count actually changed.
    const id = window.setInterval(() => { if (connectedPhones() !== remotePhonesRef.current) on(); }, 15_000);
    return () => { window.removeEventListener(PHONE_REMOTE_EVENT, on); window.clearInterval(id); };
  }, []);
  void remoteTick;
  const remotePhones = connectedPhones();
  remotePhonesRef.current = remotePhones;
  const remotePaired = isPaired();
  const remoteHint = typingHintEnabled();
  const unpair = () => { void unpairAllPhones(); toast({ title: i18n.t('settings.toast.unpairedTitle'), description: i18n.t('settings.toast.unpairedDesc') }); };
  // Snow AI level for AI Chat and voice commands: Free (included) or Premium
  // (the top model, Snow Gems a message). Premium needs a signed-in account.
  const { user } = useAuth();
  const [aiTier, setAiTierState] = useState<AiTier>(() => getPreferredTier('chat'));
  const [aiPremium, setAiPremium] = useState<AiTierInfo | null>(null);
  useEffect(() => {
    let alive = true;
    void loadAiTiers().then((tiers) => { if (alive) setAiPremium(tiers.chat.premium); });
    return () => { alive = false; };
  }, []);
  const aiTierShown = !!aiPremium && !demo && !kids;
  const canPremium = aiTierShown && !!user;
  // "Rate Snow Media Center" any time: grown-up profiles on a signed-in box
  // (the review is saved to the account), never in the website demo.
  const rateShown = !kids && !demo && !!user;
  const [reviewOpen, setReviewOpen] = useState(false);
  const openReview = () => {
    setReviewOpen(true);
    try { trackEvent('review_prompt_shown', 'review', { source: 'settings' }); } catch { /* never blocks */ }
  };
  const toggleAiTier = () => {
    // i18n.t, not t: the key handler that calls this may hold an older render.
    if (!canPremium) { toast({ title: i18n.t('settings.toast.aiSignInTitle'), description: i18n.t('settings.toast.aiSignInDesc') }); return; }
    const next: AiTier = aiTier === 'premium' ? 'free' : 'premium';
    setPreferredTier('chat', next);
    setAiTierState(next);
  };
  const [currentLang, setCurrentLang] = useState<string>(i18n.language || 'en');
  useEffect(() => {
    const onChange = (lng: string) => setCurrentLang(lng);
    i18n.on('languageChanged', onChange);
    return () => { i18n.off('languageChanged', onChange); };
  }, [i18n]);
  const handleLanguageSelect = (code: string) => {
    i18n.changeLanguage(code);
    try { localStorage.setItem(LANG_STORAGE_KEY, code); } catch { /* ignore */ }
  };
  const toggleDeviceAlerts = async (next: boolean) => {
    try {
      const result = await deviceAlerts.setEnabled(next);
      if (next && !result.enabled) {
        // Android 13+ and the viewer said no. Nothing was switched on, so say
        // that rather than leaving a toggle that looks on but shows nothing.
        toast({
          title: i18n.t('settings.toast.notifBlockedTitle'),
          description: i18n.t('settings.toast.notifBlockedDesc'),
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: next ? i18n.t('settings.toast.alertsOnTitle') : i18n.t('settings.toast.alertsOffTitle'),
        description: next ? i18n.t('settings.toast.alertsOnDesc') : i18n.t('settings.toast.alertsOffDesc'),
      });
    } catch (e) {
      toast({ title: i18n.t('settings.toast.alertsFailTitle'), description: (e as Error).message, variant: 'destructive' });
    }
  };
  const togglePlayer = async (next: boolean) => {
    try {
      await setFeatureFlag('player_enabled', next);
      toast({ title: next ? i18n.t('settings.toast.playerOnTitle') : i18n.t('settings.toast.playerOffTitle'), description: i18n.t('settings.toast.playerDesc') });
    } catch (e) {
      toast({ title: i18n.t('settings.toast.updateFailTitle'), description: (e as Error).message, variant: 'destructive' });
    }
  };
  const { account: playerAccount } = usePlayerAccount();

  /** The items of a list page, top to bottom, as the remote walks them. */
  const pageItems = (p: SettingsPage): string[] => {
    switch (p) {
      // The Player account panel's sign-out sits above the rows (Up from the first row).
      case 'account': return [
        ...(playerAccount ? ['ui-player-signout'] : []),
        ...(aiTierShown ? ['ui-ai-tier'] : []),
        ...(rateShown ? ['ui-rate-app'] : []),
        ...(isAdmin ? ['ui-player-toggle'] : []),
      ];
      // A Kids profile keeps its own Home as it is: the content bar's switch only.
      case 'home': return kids
        ? ['ui-content-bar-toggle']
        : ['ui-content-bar-toggle', 'ui-home-bar-source', 'ui-home-bar-show', 'ui-dashboard-size-toggle', 'ui-home-tiles-reset'];
      case 'notifications': return ['ui-mail-notify-toggle', ...(deviceAlerts.supported ? ['ui-device-alerts-toggle'] : [])];
      case 'language': return SUPPORTED_LANGUAGES.map((l) => `ui-language-${l.code}`);
      case 'profiles': return ['profiles-switch', ...(kids ? [] : ['profiles-manage', ...(pinsAvailable() ? ['profiles-parent'] : [])])];
      case 'remote': return ['remote-hint', 'remote-unpair'];
      default: return [];
    }
  };
  /** Where the remote lands in a list page. */
  const firstItem = (p: SettingsPage): string | null => {
    const items = pageItems(p);
    // Into the rows, not onto Sign out: Right then OK must never start a sign-out.
    if (p === 'account') return items.find((i) => i !== 'ui-player-signout') ?? items[0] ?? null;
    // On the language in use (the How-to picture of each language starts there too).
    if (p === 'language') return items.find((i) => currentLang.startsWith(i.replace('ui-language-', ''))) ?? items[0];
    return items[0] ?? null;
  };

  // Opened on a page (the assistant's "open Phone remote", "Set up profiles"):
  // that row highlighted with its page beside it; 'ui-home' puts the remote in the page.
  const resolveIntent = (asked: string | null): { page: SettingsPage; enter: boolean } | null => {
    const page = asked ? INTENT_PAGE[asked] : undefined;
    if (!page || !rows.includes(page)) return null;
    return { page, enter: asked === 'ui-home' && !kids };
  };
  const [opened] = useState(() => resolveIntent(peekIntent(INTENT_KEYS.settings)));
  const [menuIdx, setMenuIdx] = useState(() => (opened ? rows.indexOf(opened.page) + 1 : 1)); // 0 = Back
  const [shown, setShown] = useState<SettingsPage>(() => opened?.page ?? rows[0]);
  const [pane, setPane] = useState<'menu' | 'page'>(() => (opened?.enter ? 'page' : 'menu'));
  // The row the remote is on inside a list page.
  const [item, setItem] = useState<string | null>(() => (opened?.enter ? firstItem(opened.page) : null));
  useEffect(() => { clearIntent(INTENT_KEYS.settings); }, []);
  // The rows change under the remote (admin rights arrive, a profile switch): stay on the menu.
  const rowCount = rows.length;
  useEffect(() => { setMenuIdx((i) => Math.min(i, rowCount)); }, [rowCount]);
  const shownPage: SettingsPage = rows.includes(shown) ? shown : rows[0];

  // Sign out of the Player: OK once arms it ("press OK again"), OK again does it.
  const [signOutArmed, setSignOutArmed] = useState(false);
  useEffect(() => {
    if (!signOutArmed) return;
    if (item !== 'ui-player-signout' || pane !== 'page') { setSignOutArmed(false); return; }
    const timer = window.setTimeout(() => setSignOutArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [signOutArmed, item, pane]);

  const containerRef = useRef<HTMLDivElement>(null);
  const toMenu = useCallback(() => {
    // A control in the page may hold real DOM focus (Updates, App alerts, AI);
    // let go of it so it can't answer keys meant for the menu.
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && containerRef.current?.contains(active) && typeof active.blur === 'function') active.blur();
    setPane('menu');
    setItem(null);
    setSignOutArmed(false);
  }, []);

  /** The remote goes into a page (OK / Right on its row, a tap in it, an intent). */
  const enterPage = (p: SettingsPage) => {
    setShown(p);
    if (LIST_PAGES.has(p)) {
      const first = firstItem(p);
      // A page with nothing to pick (My account, signed out) keeps the remote on the menu.
      if (!first) return;
      setItem(first);
      setPane('page');
      return;
    }
    setItem(null);
    setPane('page');
    if (p === 'updates') {
      // The updater's buttons take real DOM focus (their own keys move it).
      window.setTimeout(() => {
        const btn = document.querySelector<HTMLElement>('[data-app-updater-btn="check"], [data-app-updater-btn="download"]')
          ?? document.querySelector<HTMLElement>('[data-apk-cache-first]');
        btn?.focus();
        btn?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 30);
    }
  };

  // The same asked for while Settings is already open (a voice command, the
  // assistant): navigating here changed nothing, so switch pages now rather
  // than on the next visit. The highlight goes to that row.
  const intentRef = useRef<(asked: string | null) => void>(() => {});
  intentRef.current = (asked) => {
    const want = resolveIntent(asked);
    if (!want) return;
    toMenu();
    setMenuIdx(rows.indexOf(want.page) + 1);
    setShown(want.page);
    if (want.enter) enterPage(want.page);
  };
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== 'settings') return;
      intentRef.current(takeIntent(INTENT_KEYS.settings));
    };
    window.addEventListener(SCREEN_INTENT_EVENT, on);
    return () => window.removeEventListener(SCREEN_INTENT_EVENT, on);
  }, []);

  // The page follows the highlight once it rests (Back keeps the last page).
  const restingOn = menuIdx >= 1 ? rows[menuIdx - 1] : undefined;
  useEffect(() => {
    if (pane !== 'menu' || !restingOn || restingOn === shown) return;
    const timer = window.setTimeout(() => setShown(restingOn), PREVIEW_REST_MS);
    return () => window.clearTimeout(timer);
  }, [restingOn, pane, shown]);

  /** What OK does on an item of a list page. */
  const activate = (id: string) => {
    if (id === 'ui-player-signout') {
      if (!signOutArmed) { setSignOutArmed(true); return; }
      setSignOutArmed(false);
      document.querySelector<HTMLElement>('[data-settings-focus="ui-player-signout"]')?.click();
      return;
    }
    if (id === 'ui-ai-tier') toggleAiTier();
    else if (id === 'ui-rate-app') openReview();
    else if (id === 'ui-player-toggle') void togglePlayer(!playerEnabled);
    else if (id === 'ui-content-bar-toggle') setMediaBarEnabledState(!mediaBarEnabled);
    else if (id === 'ui-dashboard-size-toggle') saveDashboardSize(dashboardSize === 'large' ? 'compact' : 'large');
    else if (id === 'ui-home-bar-source') cycleBarSource();
    else if (id === 'ui-home-bar-show') cycleBarShow();
    else if (id === 'ui-home-tiles-reset') resetHomeTiles();
    else if (id === 'ui-mail-notify-toggle') saveMailNotify(!mailNotify);
    else if (id === 'ui-device-alerts-toggle') { if (!deviceAlerts.busy) void toggleDeviceAlerts(!deviceAlerts.status.enabled); }
    else if (id.startsWith('ui-language-')) handleLanguageSelect(id.replace('ui-language-', ''));
    else if (id === 'profiles-switch') openProfiles('pick');
    else if (id === 'profiles-manage') openProfiles('manage');
    else if (id === 'profiles-parent') openProfiles('parent');
    else if (id === 'remote-hint') setTypingHintEnabled(!typingHintEnabled());
    else if (id === 'remote-unpair') unpair();
  };

  // One window listener for the screen's life, reading the latest render
  // through a ref: it stays ahead of the embedded panels' own listeners (they
  // re-register as they change), so a Back the Backgrounds page hands back to
  // the menu is never read again by the menu as "leave Settings".
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    // Bail when any Radix modal dialog is open — let it trap the D-pad.
    if (document.querySelector('[role="alertdialog"][data-state="open"], [role="dialog"][data-state="open"]')) return;
    const target = e.target as HTMLElement;
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    const back = isBackKey(e);
    const stop = () => { e.preventDefault(); e.stopPropagation(); };

    if (pane === 'menu') {
      if (typing) return;
      if (back) { stop(); onBack(); return; }
      if (!NAV_KEYS.includes(e.key)) return;
      stop();
      if (e.key === 'ArrowDown') setMenuIdx((i) => Math.min(rows.length, i + 1));
      else if (e.key === 'ArrowUp') setMenuIdx((i) => Math.max(0, i - 1));
      else if (e.key === 'ArrowLeft') return; // the menu is the left edge
      else if (menuIdx === 0) { if (e.key !== 'ArrowRight') onBack(); }
      else if (!e.repeat) enterPage(rows[menuIdx - 1]);
      return;
    }

    // Backgrounds: the media manager has the remote (isActive); its own Back
    // and Left edge hand it back (onBack / onExitLeft).
    if (shownPage === 'backgrounds') return;

    if (shownPage === 'alerts' || shownPage === 'ai') {
      // Left moves the caret in a text field; anywhere else it goes back to the menu.
      const inField = typing || target.tagName === 'SELECT';
      if (back || e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && !inField)) { stop(); toMenu(); }
      // Everything else belongs to the panel's own controls.
      return;
    }

    if (shownPage === 'updates') {
      const active = document.activeElement as HTMLElement | null;
      if (back) { stop(); toMenu(); return; }
      if (e.key === 'ArrowLeft') {
        // Left is taken where a button has a neighbor on its left (Clear all,
        // a row's Delete, "Update anyway"); from everything else it goes back.
        if (!active?.matches('[data-apk-clear-all], [data-apk-row-delete], [data-app-updater-btn="anyway"]')) { stop(); toMenu(); }
        return;
      }
      const inApkCache = !!active?.closest('[data-apk-cache-root]');
      if (e.key === 'ArrowDown') {
        // From the updater's button (or lost focus) into the cache list; inside
        // the cache its own handlers move between the rows.
        const apkBtn = inApkCache ? null : document.querySelector<HTMLElement>('[data-apk-cache-first]');
        if (apkBtn) { stop(); apkBtn.focus(); apkBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        return;
      }
      if (e.key === 'ArrowUp') {
        if (inApkCache) {
          // Only leave the cache from its top row (Refresh / Clear all).
          if (active?.matches('[data-apk-cache-first], [data-apk-clear-all]')) {
            stop();
            const updBtn = document.querySelector<HTMLElement>('[data-app-updater-btn="check"], [data-app-updater-btn="download"]');
            if (updBtn) { updBtn.focus(); updBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } else toMenu();
          }
          return;
        }
        stop(); toMenu();
      }
      return;
    }

    // A list page: Up / Down walk its items; the language tiles keep Left /
    // Right between them; Left elsewhere, Up at the top and Back go to the menu.
    if (typing) return;
    if (!back && !NAV_KEYS.includes(e.key)) return;
    stop();
    const order = pageItems(shownPage);
    const at = item ? order.indexOf(item) : -1;
    const tile = (i: number) => !!order[i]?.startsWith('ui-language-');
    if (back) toMenu();
    else if (e.key === 'ArrowUp') { if (at <= 0) toMenu(); else setItem(order[at - 1]); }
    else if (e.key === 'ArrowDown') { if (at >= 0 && at < order.length - 1) setItem(order[at + 1]); }
    else if (e.key === 'ArrowLeft') { if (tile(at) && tile(at - 1)) setItem(order[at - 1]); else toMenu(); }
    else if (e.key === 'ArrowRight') { if (tile(at) && tile(at + 1)) setItem(order[at + 1]); }
    else if (item && !e.repeat) activate(item);
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []);

  // Follow the highlight down the menu (an admin's ten rows, a bigger text size).
  const menuScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = menuScrollRef.current;
    if (!node || pane !== 'menu') return;
    if (menuIdx <= 1) { node.scrollTop = 0; return; }
    const el = node.querySelector<HTMLElement>('[data-focused="true"]');
    if (el) keepInView(node, el, 24);
  }, [menuIdx, pane]);
  // Only the page scrolls: to the top for a new page, then after the remote.
  const pageScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (pageScrollRef.current) pageScrollRef.current.scrollTop = 0; }, [shownPage]);
  useEffect(() => {
    const node = pageScrollRef.current;
    if (!node || !item) return;
    const el = node.querySelector<HTMLElement>(`[data-settings-focus="${item}"]`);
    if (el) keepInView(node, el, 12);
  }, [item]);

  const inPage = pane === 'page';
  const f: PageFocus = {
    attrs: (id) => ({ 'data-settings-focus': id, 'data-focused': inPage && item === id ? 'true' : 'false' }),
    is: (id) => inPage && item === id,
    pick: (id) => { setItem(id); setPane('page'); },
  };

  // Each row's state line; read again when the remote comes back to the menu.
  const states = useSettingsStates({
    kids,
    profile: currentProfile,
    phones: remotePhones,
    paired: remotePaired,
    deviceAlertsOn: deviceAlerts.supported ? deviceAlerts.status.enabled : null,
    language: currentLang,
  }, pane);

  const page = (() => {
    switch (shownPage) {
      case 'account': return (
        <AccountPage
          f={f} hasPlayerAccount={!!playerAccount} signOutArmed={signOutArmed}
          aiTierShown={aiTierShown} aiTier={aiTier} canPremium={canPremium} aiPremium={aiPremium} onToggleAiTier={toggleAiTier}
          rateShown={rateShown} onRate={openReview}
          isAdmin={isAdmin} playerEnabled={playerEnabled} onTogglePlayer={(next) => void togglePlayer(next)}
        />
      );
      case 'home': return (
        <HomeScreenPage
          f={f} kids={kids}
          mediaBarEnabled={mediaBarEnabled} onToggleBar={() => setMediaBarEnabledState(!mediaBarEnabled)}
          largeDashboard={dashboardSize === 'large'} onToggleDashboard={() => saveDashboardSize(dashboardSize === 'large' ? 'compact' : 'large')}
          barSource={barSource} barShow={barShow} onCycleSource={cycleBarSource} onCycleShow={cycleBarShow} onResetTiles={resetHomeTiles}
        />
      );
      // No panel around it and no second title: its own slim panels sit straight in the page.
      case 'backgrounds': return <MediaManager onBack={toMenu} onExitLeft={toMenu} embedded={true} isActive={inPage} />;
      case 'profiles': return <ProfilesPage f={f} kids={kids} profiles={profilesList} currentId={currentProfile.id} />;
      case 'remote': return (
        <RemotePage f={f} phones={remotePhones} paired={remotePaired} typingHint={remoteHint} onToggleHint={() => setTypingHintEnabled(!remoteHint)} onUnpair={unpair} />
      );
      case 'notifications': return (
        <NotificationsPage
          f={f} mailNotify={mailNotify} onToggleMail={() => saveMailNotify(!mailNotify)}
          // The How-to pictures show the row a box has (on the web it can't do anything).
          alertsShown={deviceAlerts.supported || isHowtoCapture()} alertsOn={deviceAlerts.status.enabled} alertsBusy={deviceAlerts.busy}
          alertsBlocked={!!deviceAlerts.status.channelBlocked} onToggleAlerts={() => void toggleDeviceAlerts(!deviceAlerts.status.enabled)}
        />
      );
      case 'language': return <LanguagePage f={f} current={currentLang} onPick={handleLanguageSelect} />;
      case 'updates': return (
        <div className="space-y-3">
          <section {...f.attrs('updates-content')} data-focused={inPage ? 'true' : 'false'} className="tv-ring rounded-2xl bg-slate-800/55 border border-white/10 p-5">
            <AppUpdater />
          </section>
          <ApkCacheViewer />
        </div>
      );
      case 'alerts': return (
        <section {...f.attrs('alerts-content')} data-focused={inPage ? 'true' : 'false'} className="tv-ring rounded-2xl bg-slate-800/55 border border-white/10 p-5">
          <AppAlertsManager />
        </section>
      );
      case 'ai': return (
        <div {...f.attrs('ai-content')} data-focused={inPage ? 'true' : 'false'} className="tv-ring rounded-2xl">
          <AdminAIPanel />
        </div>
      );
      default: return null;
    }
  })();

  return (
    <div ref={containerRef} className="h-screen overflow-hidden flex flex-col text-white bg-black/70">
      <div className="flex items-center px-6 py-4 border-b border-white/10 bg-black/30">
        <BackButton
          data-settings-focus="back"
          onClick={onBack}
          label={t('common.backToHome')}
          focused={!inPage && menuIdx === 0}
        />
        <div className="flex items-center ml-3 min-w-0">
          <SettingsIcon className="w-7 h-7 text-brand-gold mr-2 shrink-0" />
          <h1 className="text-2xl font-quicksand font-bold text-white truncate">{t('settings.title')}</h1>
        </div>
      </div>

      {/* Margins, not flex gap: older box WebViews (Chrome < 84) ignore gap. */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row p-4 lg:p-6">
        <div ref={menuScrollRef} className="md:w-64 lg:w-72 shrink-0 overflow-auto mb-4 md:mb-0 md:mr-4 lg:mr-5">
          {/* Eight rows of name + state fit 960×540 without scrolling: keep them this short. */}
          <div className="space-y-1" data-settings-menu data-howto="set.tabs">
            {rows.map((id, i) => {
              const Icon = ROW_ICON[id];
              const focused = !inPage && menuIdx === i + 1;
              // The page on the right is this row's: a quiet gold edge, so the
              // viewer can tell where the remote came from while it is in the page.
              const current = inPage && id === shownPage;
              return (
                <div
                  key={id}
                  data-settings-focus={`row-${id}`}
                  data-settings-row={id}
                  data-focused={focused ? 'true' : 'false'}
                  data-howto={ROW_HOWTO[id]}
                  onClick={() => { setMenuIdx(i + 1); toMenu(); enterPage(id); }}
                  className={`tv-ring flex items-center rounded-xl px-3.5 py-1.5 border cursor-pointer ${current ? 'bg-brand-gold/15 border-brand-gold/50' : 'bg-slate-900/60 border-white/10'} ${focused ? 'scale-[1.02] z-10' : ''}`}
                >
                  <Icon className="w-[18px] h-[18px] mr-2.5 text-brand-gold shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p data-settings-label className="text-sm leading-5 font-quicksand font-semibold truncate">{t(`settings.hub.rows.${id}`)}</p>
                    {/* Always one line tall, so the rows don't jump while a state is read. */}
                    <p data-settings-state className="text-xs leading-4 font-nunito text-brand-ice/70 truncate">{states[id] || ' '}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* A tap or air-mouse click in the page takes the remote into it, as OK would. */}
        <div
          className="flex-1 min-w-0 min-h-0 flex flex-col"
          data-settings-preview={inPage ? 'false' : 'true'}
          data-settings-page={shownPage}
          onClickCapture={() => { if (!inPage) enterPage(shownPage); }}
        >
          <h2 className="text-base font-quicksand font-semibold text-brand-ice/90 mb-2 truncate">{t(`settings.hub.rows.${shownPage}`)}</h2>
          <div ref={pageScrollRef} className={`flex-1 min-h-0 overflow-auto pb-4 transition-opacity duration-150 ${inPage ? '' : 'opacity-80'}`}>
            {page}
          </div>
        </div>
      </div>
      {reviewOpen && (
        <Suspense fallback={null}>
          <ReviewDialog
            source="settings"
            onClose={() => setReviewOpen(false)}
            onOpenSupport={onNavigate ? () => { setReviewOpen(false); openScreen('tickets', onNavigate); } : undefined}
          />
        </Suspense>
      )}
    </div>
  );
};

export default Settings;
