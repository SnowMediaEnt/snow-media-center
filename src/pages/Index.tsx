import { memo, useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Store, Video, MessageCircle, Settings as SettingsIcon, User, LogIn, Smartphone, Shield, LifeBuoy, Tv } from 'lucide-react';
import NewsTicker from '@/components/NewsTicker';
// MediaBar is lazy-loaded so disabling it (or slow boot) doesn't pay its cost upfront
const MediaBar = lazy(() => import('@/components/MediaBar'));
import HomeClock from '@/components/HomeClock';
import smeLogo from '@/assets/sme-logo-512.png';
import { useCachedImage } from '@/hooks/useCachedImage';
import easterEggImg from '@/assets/easter-egg.png';
import PinnedAppsPopup from '@/components/PinnedAppsPopup';
import AppAlertDialog from '@/components/AppAlertDialog';
import ServiceExpirationBanner from '@/components/ServiceExpirationBanner';

import { useAppAlerts, type AppAlert } from '@/hooks/useAppAlerts';
import { useDeviceInstalledApps } from '@/hooks/useDeviceInstalledApps';
import { generatePackageName } from '@/utils/downloadApk';
import { useAuth } from '@/hooks/useAuth';
import { usePlayerAccountSync } from '@/hooks/usePlayerAccountSync';
import { useAdminRole } from '@/hooks/useAdminRole';
import { useVersion } from '@/hooks/useVersion';
import { useNavigate } from 'react-router-dom';
import { useNavigation } from '@/hooks/useNavigation';
import { useToast } from '@/hooks/use-toast';

import { usePinnedApps, PinnedApp } from '@/hooks/usePinnedApps';
import { useAppData } from '@/hooks/useAppData';
import { useMediaBarEnabled } from '@/hooks/useMediaBarEnabled';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { InstalledApp } from '@/data/installedApps';
import { trackAppLaunch, trackScreenView, trackEvent } from '@/lib/analytics';
import { runWhenIdle } from '@/utils/idle';
import { useTenant } from '@/contexts/TenantContext';

// Lazy-load heavy sub-views so the home screen boots faster on STB/FireTV
const InstallApps = lazy(() => import('@/components/InstallApps'));
const MediaStore = lazy(() => import('@/components/MediaStore'));
const CommunityChat = lazy(() => import('@/components/CommunityChat'));
const CreditStore = lazy(() => import('@/components/CreditStore'));
const SupportVideos = lazy(() => import('@/components/SupportVideos'));
const ChatCommunity = lazy(() => import('@/components/ChatCommunity'));
const Support = lazy(() => import('@/components/Support'));
const Settings = lazy(() => import('@/components/Settings'));
const UserDashboard = lazy(() => import('@/components/UserDashboard'));
const SupportTicketSystem = lazy(() => import('@/components/SupportTicketSystem'));
const AIConversationSystem = lazy(() => import('@/components/AIConversationSystem'));
const AdminSupportDashboard = lazy(() => import('@/components/AdminSupportDashboard'));
const Games = lazy(() => import('@/components/Games'));
const DailySpinGame = lazy(() => import('@/components/games/DailySpin'));
const SlotsGame = lazy(() => import('@/components/games/Slots'));
const BlackjackGame = lazy(() => import('@/components/games/Blackjack'));
const VideoPokerGame = lazy(() => import('@/components/games/VideoPoker'));
const RouletteGame = lazy(() => import('@/components/games/Roulette'));
const CasinoHoldemGame = lazy(() => import('@/components/games/CasinoHoldem'));
const WixBlog = lazy(() => import('@/components/WixBlog'));
const WelcomePopup = lazy(() => import('@/components/WelcomePopup'));
const MediaBarPrompt = lazy(() => import('@/components/MediaBarPrompt'));
const AutoUpdatePrompt = lazy(() => import('@/components/AutoUpdatePrompt'));
const LiveTV = lazy(() => import('@/components/LiveTV'));

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center text-white/80 font-nunito">
    Loading…
  </div>
);

const HomeActionCard = memo(({
  button,
  index,
  isFocused,
  layoutMode,
  onActivate,
  boostSize = false,
}: {
  button: { icon: typeof Smartphone; title: string; description: string; variant: 'blue' | 'purple' | 'gold' | 'navy' };
  index: number;
  isFocused: boolean;
  layoutMode: 'grid' | 'row';
  onActivate: () => void;
  boostSize?: boolean;
}) => {
  const ButtonIcon = button.icon;
  const cardStyle = layoutMode === 'grid'
    ? { width: boostSize ? 'clamp(190px, 21vw, 460px)' : 'clamp(150px, 16vw, 360px)', height: boostSize ? 'clamp(120px, 21vh, 300px)' : 'clamp(95px, 16vh, 230px)' }
    : { width: boostSize ? 'clamp(190px, 21vw, 420px)' : 'clamp(150px, 16vw, 320px)', aspectRatio: '1 / 0.88' as const };

  return (
    <Card
      tabIndex={0}
      style={cardStyle}
      data-focused={isFocused ? 'true' : 'false'}
      data-home-card={index}
      className={`
        home-focus-surface relative overflow-hidden cursor-pointer border-0 rounded-3xl flex-shrink-0 shadow-xl h-full
        ${button.variant === 'blue' ? '[background:var(--gradient-blue)]' : ''}
        ${button.variant === 'purple' ? '[background:var(--gradient-purple)]' : ''}
        ${button.variant === 'gold' ? '[background:var(--gradient-gold)]' : ''}
        ${button.variant === 'navy' ? '[background:var(--gradient-navy)]' : ''}
      `}

      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-black/20 rounded-3xl pointer-events-none" />

      <div className="relative z-10 h-full flex flex-col items-center justify-center text-center p-4">
        <div className="flex-shrink-0 mb-2" style={{
          width: layoutMode === 'grid' ? 'clamp(40px, 5vw, 84px)' : 'clamp(44px, 5.2vw, 84px)',
          aspectRatio: '1 / 1'
        }}>
          <ButtonIcon className="text-white drop-shadow-xl w-full h-full" />
        </div>
        <h3 className="font-bold mb-1 text-white leading-tight text-shadow-strong font-quicksand min-h-[2.5em] flex items-center justify-center" style={{ fontSize: 'clamp(0.875rem, 1.5vw, 1.75rem)' }}>
          {button.title}
        </h3>

        {layoutMode === 'grid' && (
          <p className="text-white/95 leading-tight text-shadow-soft font-nunito" style={{ fontSize: 'clamp(0.75rem, 1vw, 1.25rem)' }}>
            {button.description}
          </p>
        )}
      </div>
    </Card>
  );
});

HomeActionCard.displayName = 'HomeActionCard';

// ---------------------------------------------------------------------------
// Memoised home-screen subtrees. Each takes only the props it needs (especially
// `isFocused` booleans rather than the raw `focusedButton` index), so a D-pad
// move only re-renders the slot whose focus actually flipped — not the entire
// home tree. This is the FireTV main-thread fix.
// ---------------------------------------------------------------------------

type ScreenTier = 'xl' | 'lg' | 'md';

const getScreenTier = (h: number): ScreenTier => (h >= 2160 ? 'xl' : h >= 1440 ? 'lg' : 'md');

interface HomeHeaderProps {
  tier: ScreenTier;
  isAdmin: boolean;
  hasUser: boolean;
  isAdminFocused: boolean;
  isAuthFocused: boolean;
  isSettingsFocused: boolean;
  adminLabel: string;
  dashboardLabel: string;
  signInLabel: string;
  settingsLabel: string;
  onOpenAdmin: () => void;
  onOpenUser: () => void;
  onOpenAuth: () => void;
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
}

const HomeHeader = memo((props: HomeHeaderProps) => {
  const {
    tier, isAdmin, hasUser,
    isAdminFocused, isAuthFocused, isSettingsFocused,
    adminLabel, dashboardLabel, signInLabel, settingsLabel,
    onOpenAdmin, onOpenUser, onOpenAuth, onOpenSettings, onOpenDashboard,
  } = props;

  const btnClass = tier === 'xl' ? 'text-xl px-6 py-3' : tier === 'lg' ? 'text-lg px-5 py-2.5' : '';
  const iconClass = tier === 'xl' ? 'w-6 h-6' : tier === 'lg' ? 'w-5 h-5' : 'w-4 h-4';
  const btnSize = tier === 'md' ? 'sm' : 'default';
  const inset = tier === 'xl' ? '2rem' : tier === 'lg' ? '1.5rem' : '1rem';
  const gap = tier === 'xl' ? '1rem' : tier === 'lg' ? '0.75rem' : '0.5rem';

  return (
    <div
      className="absolute z-20 flex flex-wrap items-center justify-end"
      style={{
        top: `max(env(safe-area-inset-top, 0px), ${inset})`,
        right: `max(env(safe-area-inset-right, 0px), ${inset})`,
        gap,
        maxWidth: 'min(50vw, 32rem)',
      }}
    >
      <ServiceExpirationBanner onOpenDashboard={onOpenDashboard} />

      {isAdmin && (
        <Button
          onClick={onOpenAdmin}
          variant="purple"
          size={btnSize}
          tabIndex={0}
          data-focused={isAdminFocused ? 'true' : 'false'}
          className={`tv-focusable home-focus-surface ${btnClass}`}
        >
          <Shield className={`mr-2 ${iconClass}`} />
          {adminLabel}
        </Button>
      )}
      {hasUser ? (
        <Button
          onClick={onOpenUser}
          variant="white"
          size={btnSize}
          tabIndex={0}
          data-focused={isAuthFocused ? 'true' : 'false'}
          className={`tv-focusable home-focus-surface ${btnClass}`}
        >
          <User className={`mr-2 text-gray-800 ${iconClass}`} />
          <span className="text-gray-800">{dashboardLabel}</span>
        </Button>
      ) : (
        <Button
          onClick={onOpenAuth}
          variant="gold"
          size={btnSize}
          tabIndex={0}
          data-focused={isAuthFocused ? 'true' : 'false'}
          className={`tv-focusable home-focus-surface ${btnClass}`}
        >
          <LogIn className={`mr-2 text-gray-400 ${iconClass}`} />
          <span style={{ color: '#333333' }}>{signInLabel}</span>
        </Button>
      )}
      <Button
        onClick={onOpenSettings}
        variant="gold"
        size={btnSize}
        tabIndex={0}
        data-focused={isSettingsFocused ? 'true' : 'false'}
        className={`tv-focusable home-focus-surface ${btnClass}`}
      >
        <SettingsIcon className={`mr-2 ${iconClass}`} />
        {settingsLabel}
      </Button>
    </div>
  );
});
HomeHeader.displayName = 'HomeHeader';

const WatermarkTitle = memo(({ tagline, mediaBarEnabled, displayName, isSnowMedia }: { tagline: string; mediaBarEnabled: boolean; displayName: string; isSnowMedia: boolean }) => (
  <div className="relative z-10 flex-shrink-0 flex items-center justify-center">
    <div className="text-center home-watermark">
      <h1 className="text-shadow-strong leading-none" style={{ fontSize: 'clamp(3rem, 8vw, 10rem)', opacity: 0.3 }}>
        {isSnowMedia ? (
          <>
            <span className="font-snow-media text-brand-navy">SNOW MEDIA</span>
            <span> </span>
            <span className="font-center" style={{ color: '#C9B370' }}>CENTER</span>
          </>
        ) : (
          <span className="font-center text-white">{displayName.toUpperCase()}</span>
        )}
      </h1>
      {tagline && (
        <p className="text-brand-ice font-nunito font-medium text-shadow-soft" style={{ fontSize: 'clamp(1rem, 2vw, 2rem)', marginTop: '-4px', opacity: 0.5 }}>
          {tagline}
        </p>
      )}
    </div>
    {mediaBarEnabled && (
      <div
        className="absolute left-0 right-0 z-20"
        style={{ top: '38%', transform: 'translateY(-50%)' }}
      >
        <NewsTicker compact />
      </div>
    )}
  </div>
));
WatermarkTitle.displayName = 'WatermarkTitle';

const LogoButton = memo(({ isFocused, onActivate, onFocus, logoUrl, displayName, isSnowMedia }: { isFocused: boolean; onActivate: () => void; onFocus: () => void; logoUrl: string | null; displayName: string; isSnowMedia: boolean }) => {
  // Cached + auto-refreshing tenant logo (no-op for null URLs).
  const cachedRemote = useCachedImage(logoUrl);
  const remoteSrc = cachedRemote ?? logoUrl ?? null; // fall back to direct URL while cache warms
  const showImage = !!remoteSrc || isSnowMedia;
  const imgSrc = remoteSrc || smeLogo;
  return (
    <button
      type="button"
      onClick={onActivate}
      onFocus={onFocus}
      tabIndex={0}
      data-focused={isFocused ? 'true' : 'false'}
      aria-label={displayName}
      className="absolute z-20 select-none p-0 bg-transparent border-0 outline-none cursor-pointer transition-transform duration-200 hover:scale-105 data-[focused=true]:scale-110"
      style={{
        top: 'max(env(safe-area-inset-top, 0px), clamp(0.25rem, 1vh, 0.75rem))',
        left: 'max(env(safe-area-inset-left, 0px), clamp(0.5rem, 1.5vw, 1rem))',
        height: 'clamp(72px, 11vh, 140px)',
      }}
    >
      {showImage ? (
        <img
          src={imgSrc}
          alt={displayName}
          className="h-full w-auto pointer-events-none select-none"
          draggable={false}
        />
      ) : (
        <span
          className="h-full flex items-center text-white font-bold font-quicksand text-shadow-strong pointer-events-none select-none"
          style={{ fontSize: 'clamp(1.25rem, 2.2vw, 2rem)' }}
        >
          {displayName}
        </span>
      )}
    </button>
  );
});
LogoButton.displayName = 'LogoButton';

// Memoised route switch — isolated so D-pad focus changes on the home screen
// don't re-evaluate the 22-gate `currentView ===` ladder. Only re-renders when
// `currentView`, navigation callbacks, or layoutMode actually change.
interface RouteSwitchProps {
  currentView: string;
  goBack: () => void;
  navigateTo: (view: string) => void;
  layoutMode: 'grid' | 'row';
  onLayoutChange: (mode: 'grid' | 'row') => void;
  features: {
    games: boolean;
    wix_store: boolean;
    ai: boolean;
    support_videos: boolean;
    community: boolean;
  };
}

const RouteSwitch = memo(({ currentView, goBack, navigateTo, layoutMode, onLayoutChange, features }: RouteSwitchProps) => (
  <Suspense fallback={<RouteFallback />}>
    {currentView === 'apps' && <InstallApps onBack={goBack} onNavigateToChat={() => navigateTo('support')} />}
    {currentView === 'store' && features.wix_store && <MediaStore onBack={goBack} />}
    {currentView === 'support' && <Support onBack={goBack} onNavigate={(section) => navigateTo(section)} />}
    {currentView === 'support-videos' && features.support_videos && <SupportVideos onBack={goBack} />}
    {currentView === 'chat' && features.ai && <ChatCommunity onBack={goBack} onNavigate={(section) => navigateTo(section)} />}
    {currentView === 'community' && features.community && <CommunityChat onBack={goBack} />}
    {currentView === 'credits' && <CreditStore onBack={goBack} />}
    {currentView === 'settings' && <Settings onBack={goBack} layoutMode={layoutMode} onLayoutChange={onLayoutChange} />}
    {currentView === 'user' && <UserDashboard onViewChange={(view) => navigateTo(view)} onManageMedia={() => navigateTo('media')} onViewSettings={() => navigateTo('settings')} onCommunityChat={() => navigateTo('community')} onCreditStore={() => navigateTo('credits')} onGames={() => navigateTo('games')} />}
    {currentView === 'games' && features.games && <Games onBack={goBack} onOpenGame={(view) => navigateTo(view)} />}
    {currentView === 'game-daily-spin' && features.games && <DailySpinGame onBack={goBack} />}
    {currentView === 'game-slots' && features.games && <SlotsGame onBack={goBack} />}
    {currentView === 'game-blackjack' && features.games && <BlackjackGame onBack={goBack} />}
    {currentView === 'game-video-poker' && features.games && <VideoPokerGame onBack={goBack} />}
    {currentView === 'game-roulette' && features.games && <RouletteGame onBack={goBack} />}
    {currentView === 'game-casino-holdem' && features.games && <CasinoHoldemGame onBack={goBack} />}
    {currentView === 'wix-blog' && <WixBlog onBack={goBack} />}
    {currentView === 'support-tickets' && <SupportTicketSystem onBack={goBack} />}
    {currentView === 'ai-conversations' && features.ai && <AIConversationSystem onBack={goBack} />}
    {currentView === 'create-ai-conversation' && features.ai && <AIConversationSystem onBack={goBack} />}
    {currentView === 'admin-support' && <AdminSupportDashboard onBack={goBack} />}
    {currentView === 'livetv' && <LiveTV onBack={goBack} />}
  </Suspense>
));
RouteSwitch.displayName = 'RouteSwitch';

type LaunchableApp = {
  id?: string;
  name: string;
  icon?: string;
  packageName?: string | null;
  package_name?: string | null;
};

const Index = () => {
  const [focusedButton, setFocusedButton] = useState(0); // -3: logo, -2: auth/user, -1: settings, 0-3: main apps
  const [logoClickCount, setLogoClickCount] = useState(0);
  const [showEasterEgg, setShowEasterEgg] = useState(false);
  const [popupFocusIndex, setPopupFocusIndex] = useState(-1); // -1: not in popup, 0-6: pinned app slots
  const [isInPopup, setIsInPopup] = useState(false);
  const [isInMediaBar, setIsInMediaBar] = useState(false);
  const [layoutMode, setLayoutMode] = useState<'grid' | 'row'>(() => {
    const saved = localStorage.getItem('snow-media-layout');
    return (saved as 'grid' | 'row') || 'row'; // Default to row layout
  });
  const [screenHeight, setScreenHeight] = useState(window.innerHeight);
  const { t } = useTranslation();
  const { user } = useAuth();
  const { isAdmin } = useAdminRole();
  const { version } = useVersion();
  // Mirrors a locally-stored player account into customer_services once a
  // signed-in session is detected. Fire-and-forget; safe no-op when either
  // piece is missing.
  usePlayerAccountSync();
  const navigate = useNavigate();
  const { toast } = useToast();
  const handleRootBack = useCallback(() => {
    if (showEasterEgg) {
      setShowEasterEgg(false);
      return true;
    }
    if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) {
      return true;
    }
    if (isInPopup) {
      setIsInPopup(false);
      setPopupFocusIndex(-1);
      return true;
    }
    if (isInMediaBar) {
      setIsInMediaBar(false);
      setFocusedButton(0);
      return true;
    }
    return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
  }, [showEasterEgg, isInPopup, isInMediaBar]);
  const { currentView, navigateTo, goBack, backPressCount, canGoBack } = useNavigation('home', { onRootBack: handleRootBack });

  // Resume post-auth view (e.g., returning from /auth after Sign In on the Tickets page)
  useEffect(() => {
    try {
      const target = sessionStorage.getItem('post_auth_view');
      if (target) {
        sessionStorage.removeItem('post_auth_view');
        navigateTo(target as any);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const { pinnedApps, isPinned, pinApp, unpinApp, replacePinnedApp, canPinMore } = usePinnedApps();
  const { apps } = useAppData();
  const [mediaBarEnabled] = useMediaBarEnabled();
  const { enabled: playerEnabled } = useFeatureFlag('player_enabled', true);
  // If the player flag flips off and the user was on the (now-removed) Player card,
  // clamp focus back into the valid range.
  useEffect(() => {
    if (!playerEnabled) {
      setFocusedButton(b => (b >= 3 ? 2 : b));
    }
  }, [playerEnabled]);
  const { resolvePackageName, ensureLoaded: ensureInstalledLoaded } = useDeviceInstalledApps();
  const { getAlertForApp } = useAppAlerts();
  const [pendingAlert, setPendingAlert] = useState<{ alert: AppAlert; app: LaunchableApp } | null>(null);

  // Force the deferred native enumeration when the pinned-apps popup opens
  // (boot path defers it to idle ~800ms; if the user opens the popup first
  // we want the list ready immediately).
  useEffect(() => { if (isInPopup) ensureInstalledLoaded(); }, [isInPopup, ensureInstalledLoaded]);

  // Gate the mount of non-critical overlays (WelcomePopup, AutoUpdatePrompt)
  // until after first-frame idle so their effect chains don't pile onto boot.
  const [deferredOverlaysReady, setDeferredOverlaysReady] = useState(false);
  useEffect(() => {
    const cancel = runWhenIdle(() => setDeferredOverlaysReady(true), 2000);
    return cancel;
  }, []);

  // Handle pinning apps from popup
  const handlePinFromPopup = useCallback((app: InstalledApp) => {
    const pinnedAppData: PinnedApp = {
      id: app.id,
      name: app.name,
      icon: app.icon,
      packageName: app.packageName,
    };
    pinApp(pinnedAppData);
  }, [pinApp]);

  const handleReplacePinnedFromPopup = useCallback((slotIndex: number, app: InstalledApp) => {
    replacePinnedApp(slotIndex, {
      id: app.id,
      name: app.name,
      icon: app.icon,
      packageName: app.packageName,
    });
  }, [replacePinnedApp]);

  // Actually launch a pinned app — mirrors InstallApps.handleLaunch
  const performLaunchPinnedApp = useCallback(async (app: LaunchableApp) => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { AppManager } = await import('@/capacitor/AppManager');
      const packageName =
        resolvePackageName(app.name, app.packageName || app.package_name) ||
        app.packageName ||
        app.package_name ||
        generatePackageName(app.name);
      console.log(`[PinnedLaunch] ${app.name} → ${packageName}`);
      try { trackAppLaunch(app.name); trackEvent('pinned_app_launched', 'apps', { app: app.name, packageName }); } catch { void 0; }
      await AppManager.launch({ packageName });
      toast({
        title: 'Launching App',
        description: `Opening ${app.name}...`,
      });
    } catch (error) {
      console.error('[PinnedLaunch] error:', error);
      toast({
        title: 'Launch Failed',
        description: `Could not launch ${app.name}. Make sure it's installed.`,
        variant: 'destructive',
      });
    }
  }, [resolvePackageName, toast]);

  // Entry point used by the popup — shows alert popup first if one exists
  const handleLaunchPinnedApp = useCallback(async (app: LaunchableApp) => {
    const alert = getAlertForApp(app.name);
    if (alert) {
      setPendingAlert({ alert, app });
      return;
    }
    performLaunchPinnedApp(app);
  }, [getAlertForApp, performLaunchPinnedApp]);

  // Detect screen resolution for TV optimization (throttled via rAF)
  useEffect(() => {
    let frame = 0;
    const handleResize = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        setScreenHeight(window.innerHeight);
        frame = 0;
      });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  // Track screen views for analytics
  useEffect(() => {
    try { trackScreenView(currentView || 'home'); } catch { void 0; }
    try {
      const map: Record<string, string> = {
        store: 'store_open',
        support: 'support_open',
        community: 'community_open',
        chat: 'ai_chatbot_open',
        'ai-conversations': 'ai_chatbot_open',
      };
      const ev = map[currentView as string];
      if (ev) trackEvent(ev, 'navigation', { view: currentView });
    } catch { void 0; }
  }, [currentView]);


  // Show exit toast on home screen
  useEffect(() => {
    if (currentView === 'home' && backPressCount === 1) {
      toast({
        title: "Press back again to exit",
        description: "Press the back button again to close the app",
        duration: 1000,
      });
    }
  }, [backPressCount, currentView, toast]);


  const handleLayoutChange = useCallback((newMode: 'grid' | 'row') => {
    setLayoutMode(newMode);
    localStorage.setItem('snow-media-layout', newMode);
  }, []);

  // Easter egg — 7 logo clicks (or 7 Enter presses while focused) reveals the image.
  // Counter resets after 2 seconds of inactivity.
  const handleLogoActivate = useCallback(() => {
    setLogoClickCount((prev) => {
      const next = prev + 1;
      if (next >= 7) {
        setShowEasterEgg(true);
        return 0;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (logoClickCount === 0) return;
    const t = setTimeout(() => setLogoClickCount(0), 2000);
    return () => clearTimeout(t);
  }, [logoClickCount]);

  // Handle keyboard navigation for TV remote.
  // Phase 7 Fix 3: register ONCE; read changing values through refs so every
  // keypress doesn't tear down + re-register the native key listener.
  const focusedButtonRef = useRef(focusedButton);
  const currentViewRef = useRef(currentView);
  const userRef = useRef(user);
  const isInPopupRef = useRef(isInPopup);
  const isInMediaBarRef = useRef(isInMediaBar);
  const showEasterEggRef = useRef(showEasterEgg);
  const mediaBarEnabledRef = useRef(mediaBarEnabled); // updated below to use mediaBarVisible
  const playerEnabledRef = useRef(playerEnabled);
  const navigateToRef = useRef(navigateTo);
  const goBackRef = useRef(goBack);
  const navigateRef = useRef(navigate);
  const handleLogoActivateRef = useRef(handleLogoActivate);
  const buttonsRef = useRef<Array<{ key: 'apps' | 'support' | 'store' | 'livetv' }>>([]);

  useEffect(() => { focusedButtonRef.current = focusedButton; }, [focusedButton]);
  useEffect(() => { currentViewRef.current = currentView; }, [currentView]);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { isInPopupRef.current = isInPopup; }, [isInPopup]);
  useEffect(() => { isInMediaBarRef.current = isInMediaBar; }, [isInMediaBar]);
  useEffect(() => { showEasterEggRef.current = showEasterEgg; }, [showEasterEgg]);
  // Note: actual sync uses `mediaBarVisible` (computed below) so the keyboard
  // handler can't enter a content bar that the tenant has disabled.
  useEffect(() => { playerEnabledRef.current = playerEnabled; }, [playerEnabled]);
  useEffect(() => { navigateToRef.current = navigateTo; }, [navigateTo]);
  useEffect(() => { goBackRef.current = goBack; }, [goBack]);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);
  useEffect(() => { handleLogoActivateRef.current = handleLogoActivate; }, [handleLogoActivate]);

  // Stable callbacks for memoised children. These read the latest values from
  // refs, so their identity is constant for the life of the component — which
  // is what lets HomeHeader / RouteSwitch / MediaBar / PinnedAppsPopup skip
  // re-renders when only `focusedButton` changes.
  const stableGoBack = useCallback(() => goBackRef.current(), []);
  const stableNavigateTo = useCallback((view: string) => navigateToRef.current(view), []);
  const onOpenAdmin = useCallback(() => navigateToRef.current('admin-support'), []);
  const onOpenUser = useCallback(() => navigateToRef.current('user'), []);
  const onOpenAuth = useCallback(() => navigateRef.current('/auth'), []);
  const onOpenSettings = useCallback(() => navigateToRef.current('settings'), []);
  const onOpenDashboardFromBanner = useCallback(() => navigateToRef.current('user'), []);
  const onLogoFocus = useCallback(() => setFocusedButton(-3), []);

  // PinnedAppsPopup callbacks — stable so its memo can skip re-renders.
  const onPopupInstallApp = useCallback((app: InstalledApp) => {
    toast({
      title: 'Install ' + app.name,
      description: 'Opening Main Apps so you can download and install it.',
    });
    setIsInPopup(false);
    setPopupFocusIndex(-1);
    navigateToRef.current('apps');
  }, [toast]);
  const onPopupFocusChange = useCallback((index: number) => setPopupFocusIndex(index), []);
  const onPopupExitFocus = useCallback(() => {
    setIsInPopup(false);
    setPopupFocusIndex(-1);
  }, []);

  // MediaBar callbacks — stable so its memo can skip re-renders on focus ticks.
  const onMediaBarExitDown = useCallback(() => { setIsInMediaBar(false); setFocusedButton(0); }, []);
  const onMediaBarExitUp = useCallback(() => { setIsInMediaBar(false); setFocusedButton(-2); }, []);

  // Clock callback — stable (HomeClock already memoised).
  const onClockUpdate = useCallback(() => navigateToRef.current('settings'), []);
  const onCloseEasterEgg = useCallback(() => setShowEasterEgg(false), []);

  // Screen-height derived classes computed once per tier change, not per render.
  const screenTier = useMemo(() => getScreenTier(screenHeight), [screenHeight]);

  // Stable per-index activation callback — reads the current buttons array
  // from a ref so it stays referentially constant even when the tenant tweaks
  // which cards are present.
  const activateByIndex = useMemo(() => ({
    get: (i: number) => () => {
      const b = buttonsRef.current[i];
      if (b) navigateToRef.current(b.key);
    },
  }), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // If the auto-update modal (or any aria-modal dialog) is open, let it own the keyboard.
      if (document.querySelector('[data-autoupdate-dialog="true"], [aria-modal="true"]')) return;
      // Skip navigation handling when user is typing in an input or textarea
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Allow Backspace when typing
      if (event.key === 'Backspace' && isTyping) {
        return; // Let the default behavior happen
      }

      const currentView = currentViewRef.current;
      const focusedButton = focusedButtonRef.current;
      const isInPopup = isInPopupRef.current;
      const isInMediaBar = isInMediaBarRef.current;
      const showEasterEgg = showEasterEggRef.current;
      const mediaBarEnabled = mediaBarEnabledRef.current;
      const user = userRef.current;

      // Compute the open-dialog check at most once per keypress
      let dialogOpenChecked = false;
      let dialogOpen = false;
      const hasOpenDialog = () => {
        if (!dialogOpenChecked) {
          dialogOpen = !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
          dialogOpenChecked = true;
        }
        return dialogOpen;
      };

      // Handle both standard back buttons and Android hardware back button (but not Backspace when typing)
      if (event.key === 'Escape' || event.keyCode === 4 || event.which === 4) { // Android back button
        event.preventDefault();
        event.stopPropagation();

        if (currentView === 'home') {
          if (showEasterEgg) {
            setShowEasterEgg(false);
            return;
          }
          if (hasOpenDialog()) {
            return;
          }
          if (isInPopup) {
            setIsInPopup(false);
            setPopupFocusIndex(-1);
            return;
          }
          if (isInMediaBar) {
            setIsInMediaBar(false);
            setFocusedButton(0);
            return;
          }
        }

        if (currentView !== 'home') {
          goBackRef.current();
          return;
        }
      }

      if (currentView !== 'home') {
        return; // Let individual components handle their own navigation
      }

      // Easter egg overlay swallows Back/Escape/Enter and closes itself
      if (showEasterEgg) {
        if (['Escape', 'Backspace', 'Enter', ' '].includes(event.key) || event.keyCode === 4) {
          event.preventDefault();
          event.stopPropagation();
          setShowEasterEgg(false);
        }
        return;
      }

      // MediaBar owns the keys when active
      if (isInMediaBar) {
        return;
      }

      // Prevent default for navigation keys on home screen (only when not typing)
      if (!isTyping && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }

      // Home screen navigation — driven by the active buttons array, so when
      // tenants drop cards the indices/wrap behavior stay correct.
      const buttonsLen = buttonsRef.current.length || 1;
      const maxButtons = buttonsLen - 1;

      switch (event.key) {
        case 'ArrowLeft':
          if (focusedButton > 0) {
            setFocusedButton(focusedButton - 1);
          } else if (focusedButton === 0) {
            setFocusedButton(-1); // settings
          } else if (focusedButton === -1) {
            setFocusedButton(-2); // user/auth
          } else if (focusedButton === -2) {
            setFocusedButton(-3); // logo (easter egg)
          }
          break;

        case 'ArrowRight':
          if (focusedButton >= 0 && focusedButton < maxButtons) {
            setFocusedButton(focusedButton + 1);
          } else if (focusedButton === maxButtons) {
            setFocusedButton(-3); // wrap from last app → logo
          } else if (focusedButton === -3) {
            setFocusedButton(-2); // logo → dashboard/user
          } else if (focusedButton === -2) {
            setFocusedButton(-1); // dashboard → settings
          } else if (focusedButton === -1) {
            setFocusedButton(0); // settings → first app
          }
          break;


        case 'ArrowUp':
          // If on Main Apps (button 0), open the pinned apps popup first
          if (focusedButton === 0 && !isInPopup) {
            setIsInPopup(true);
            setPopupFocusIndex(0);
            return;
          }

          if (focusedButton >= 0) {
            if (mediaBarEnabled) {
              setFocusedButton(-99);
              setIsInMediaBar(true);
            } else {
              // No content bar — jump directly to the top row.
              // Rightmost card lands on Settings, others on Sign In / Dashboard.
              setFocusedButton(focusedButton === maxButtons ? -1 : -2);
            }
          }
          break;

        case 'ArrowDown':
          if (focusedButton < 0) {
            setFocusedButton(0); // Go to first app
          }
          break;

        case 'Enter':
        case ' ':
          if (focusedButton === -3) {
            // Easter egg: 7 clicks on the logo reveals the hidden image
            handleLogoActivateRef.current();
          } else if (focusedButton === -2) {
            // Navigate to auth or user dashboard
            if (user) {
              navigateToRef.current('user');
            } else {
              navigateRef.current('/auth');
            }
          } else if (focusedButton === -1) {
            // Navigate to settings
            navigateToRef.current('settings');
          } else if (focusedButton >= 0) {
            const b = buttonsRef.current[focusedButton];
            if (b) navigateToRef.current(b.key);
          }
          break;

        case 'Escape':
        case 'Backspace':
          // Only reached on home view (non-home returned earlier above).
          // Triggers the double-press-to-exit flow in useNavigation.
          goBackRef.current();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const { code: tenantCode, branding, isFeatureEnabled, settings } = useTenant();
  const isSnowMedia = tenantCode === 'snowmedia';
  const displayName = branding.app_display_name;
  const tagline = branding.tagline || (isSnowMedia ? t('home.tagline') : '');
  const adminLabel = t('common.admin');
  const dashboardLabel = t('common.dashboard');
  const signInLabel = t('common.signIn');
  const settingsLabel = t('common.settings');

  // Feature gates (tenant-driven). Snow Media has every feature ON so the
  // current layout (Apps / Support / Store / [Player]) is unchanged.
  const feat = useMemo(() => ({
    games: isFeatureEnabled('games'),
    wix_store: isFeatureEnabled('wix_store'),
    ai: isFeatureEnabled('ai'),
    support_videos: isFeatureEnabled('support_videos'),
    community: isFeatureEnabled('community'),
    content_bar: isFeatureEnabled('content_bar'),
  }), [isFeatureEnabled]);

  // Build home cards from features. Each card carries its target route key so
  // the keyboard handler can navigate by index without hardcoded positions.
  const buttons = useMemo(() => {
    const list: Array<{ key: 'apps' | 'support' | 'store' | 'livetv'; icon: typeof Smartphone; title: string; description: string; variant: 'blue' | 'gold' | 'purple' | 'navy' }> = [
      { key: 'apps', icon: Smartphone, title: t('home.mainApps.title'), description: t('home.mainApps.description'), variant: 'blue' },
      { key: 'support', icon: LifeBuoy, title: t('home.support.title'), description: t('home.support.description'), variant: 'gold' },
    ];
    if (feat.wix_store) {
      list.push({ key: 'store', icon: Store, title: t('home.store.title'), description: t('home.store.description'), variant: 'purple' });
    }
    if (playerEnabled) {
      list.push({ key: 'livetv', icon: Tv, title: t('home.player.title'), description: t('home.player.description'), variant: 'navy' });
    }
    return list;
  }, [playerEnabled, feat.wix_store, t]);

  // Redirect to home if the user is on a now-disabled view (e.g. tenant flips
  // a feature off, or deep-link/cached navigation into a disabled route).
  useEffect(() => {
    const blocked: Record<string, boolean> = {
      store: !feat.wix_store,
      games: !feat.games,
      'game-daily-spin': !feat.games,
      'game-slots': !feat.games,
      'game-blackjack': !feat.games,
      'game-video-poker': !feat.games,
      'game-roulette': !feat.games,
      'game-casino-holdem': !feat.games,
      chat: !feat.ai,
      'ai-conversations': !feat.ai,
      'create-ai-conversation': !feat.ai,
      'support-videos': !feat.support_videos,
      community: !feat.community,
    };
    if (blocked[currentView]) {
      goBack();
    }
  }, [currentView, feat.wix_store, feat.games, feat.ai, feat.support_videos, feat.community, goBack]);

  // Content-bar availability: even if the user previously enabled it, force
  // OFF when the tenant has the feature disabled.
  const contentBarAvailable = feat.content_bar;
  const mediaBarVisible = mediaBarEnabled && contentBarAvailable;
  useEffect(() => { mediaBarEnabledRef.current = mediaBarVisible; }, [mediaBarVisible]);

  // Sync the buttons array into a ref so the always-on keydown handler can
  // navigate by index without rebinding when cards add/remove.
  useEffect(() => {
    buttonsRef.current = buttons;
    setFocusedButton(b => (b >= buttons.length ? Math.max(0, buttons.length - 1) : b));
  }, [buttons]);

  return (
    <div className="min-h-screen">
      {/* Lazy-loaded navigation views — isolated under memo so D-pad focus
          changes on the home screen don't re-evaluate the route ladder. */}
      <RouteSwitch
        currentView={currentView}
        goBack={stableGoBack}
        navigateTo={stableNavigateTo}
        layoutMode={layoutMode}
        onLayoutChange={handleLayoutChange}
        features={feat}
      />

      {/* Home screen content */}
      {currentView === 'home' && (
        <div className="h-screen w-screen overflow-hidden text-white relative flex flex-col">
          {/* Background is provided by App.tsx (single static gradient on all devices). */}

          {/* User/Auth Controls — safe-area-aware so X96 / T95 / FireTV overscan
              doesn't crop the buttons or overlap them with the clock. */}
          <HomeHeader
            tier={screenTier}
            isAdmin={isAdmin}
            hasUser={!!user}
            isAdminFocused={focusedButton === -3}
            isAuthFocused={focusedButton === -2}
            isSettingsFocused={focusedButton === -1}
            adminLabel={adminLabel}
            dashboardLabel={dashboardLabel}
            signInLabel={signInLabel}
            settingsLabel={settingsLabel}
            onOpenAdmin={onOpenAdmin}
            onOpenUser={onOpenUser}
            onOpenAuth={onOpenAuth}
            onOpenSettings={onOpenSettings}
            onOpenDashboard={onOpenDashboardFromBanner}
          />

          {/* Spacer for info bar — kept tight so 1080p TVs (FireTV) don't push cards below the safe area */}
          <div className="flex-shrink-0" style={{ height: 'clamp(2.5rem, 5vh, 5rem)' }}></div>

          {/* Header - tight container around title. When the content menu is ON,
              the thin RSS ticker overlays through the middle of the title.
              When OFF, a thicker standalone RSS row sits below the title. */}
          <WatermarkTitle tagline={tagline} mediaBarEnabled={mediaBarVisible} displayName={displayName} isSnowMedia={isSnowMedia} />
          {!mediaBarVisible && (
            <div className="relative z-10 flex-shrink-0 mt-2">
              <NewsTicker />
            </div>
          )}

          {/* SME logo top-left — secret 7-click easter egg */}
          <LogoButton
            isFocused={focusedButton === -3}
            onActivate={handleLogoActivate}
            onFocus={onLogoFocus}
            logoUrl={branding.in_app_logo_url}
            displayName={displayName}
            isSnowMedia={isSnowMedia}
          />

          {/* Easter egg overlay */}
          {showEasterEgg && (
            <div
              className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center cursor-pointer animate-fade-in"
              onClick={onCloseEasterEgg}
              role="button"
              aria-label="Close"
            >
              <img
                src={easterEggImg}
                alt=""
                className="max-h-[92vh] max-w-[92vw] object-contain rounded-lg shadow-2xl"
                draggable={false}
              />
            </div>
          )}

          {/* Date/Time Display - isolated to avoid re-rendering the whole home tree every second */}
          <HomeClock version={version} onUpdateClick={onClockUpdate} />

          {/* Bottom region — MediaBar (if enabled) sits directly above the cards,
              so the empty space falls between the title and the bar instead of
              between the bar and the cards. */}
          <div
            className="relative z-10 flex-1 min-h-0 flex flex-col justify-end"
            style={{
              gap: 'clamp(0.75rem, 2vh, 1.5rem)',
              paddingBottom: 'max(env(safe-area-inset-bottom, 0px), clamp(1rem, 3vh, 2.5rem))',
              paddingLeft: 'max(env(safe-area-inset-left, 0px), 3vw)',
              paddingRight: 'max(env(safe-area-inset-right, 0px), 3vw)',
            }}
          >
            {mediaBarVisible && (
              <Suspense fallback={<div className="h-[180px]" />}>
                <MediaBar
                  active={isInMediaBar}
                  onExitDown={onMediaBarExitDown}
                  onExitUp={onMediaBarExitUp}
                />
              </Suspense>
            )}

            {(() => {
              // 3 cards now — always lay out in a single row for clean spacing.
              const effectiveLayout: 'grid' | 'row' = 'row';
              return (
            <div 
              className="justify-center items-stretch w-full mx-auto flex flex-nowrap"
              style={{ 
                gap: 'clamp(2rem, 5vw, 6rem)',
                maxWidth: '95vw'
              }}
            >

              {buttons.map((button, index) => {
                const isFocused = focusedButton === index;
                // Stable per-index activation derived from buttonsRef.
                const activateCard = activateByIndex.get(index);

                const cardContent = (
                  <HomeActionCard
                    button={button}
                    index={index}
                    isFocused={isFocused}
                    layoutMode={effectiveLayout}
                    onActivate={activateCard}
                    boostSize={!mediaBarVisible}
                  />
                );

                // Wrap Main Apps card (index 0) with pinned apps popup
                if (index === 0) {
                  return (
                    <div key={index} className="relative h-full">
                      <PinnedAppsPopup
                        pinnedApps={pinnedApps}
                        apps={apps}
                        isVisible={isFocused}
                        onLaunchApp={handleLaunchPinnedApp}
                        onInstallApp={onPopupInstallApp}

                        onPinApp={handlePinFromPopup}
                        onReplacePinnedApp={handleReplacePinnedFromPopup}
                        onUnpinApp={unpinApp}
                        isPinned={isPinned}
                        canPinMore={canPinMore}
                        focusedIndex={isInPopup && focusedButton === 0 ? popupFocusIndex : -1}
                        onFocusChange={onPopupFocusChange}
                        onExitFocus={onPopupExitFocus}
                      />
                      {cardContent}
                    </div>
                  );
                }
                
                return <div key={index} className="h-full">{cardContent}</div>;
              })}
            </div>
              );
            })()}
          </div>
        </div>
      )}

      <AppAlertDialog
        alert={pendingAlert?.alert ?? null}
        appName={pendingAlert?.app?.name}
        open={!!pendingAlert}
        onDismiss={() => setPendingAlert(null)}
        onContinue={() => {
          const pa = pendingAlert;
          setPendingAlert(null);
          if (pa) performLaunchPinnedApp(pa.app);
        }}
      />

      {/* First-launch welcome + per-version "What's New" popup — mounted only
          after first-frame idle so its effect chain doesn't pile onto boot. */}
      {deferredOverlaysReady && (
        <Suspense fallback={null}>
          <WelcomePopup />
        </Suspense>
      )}

      {/* First-run opt-in prompt for the home content bar. Only shows after
          the welcome popup is dismissed and only if the bar is currently OFF. */}
      {deferredOverlaysReady && currentView === 'home' && contentBarAvailable && (
        <Suspense fallback={null}>
          <MediaBarPrompt />
        </Suspense>
      )}

      {/* Background auto-update check (native only). On by default; users can
          disable via localStorage key smc-auto-update-enabled = "false". */}
      {deferredOverlaysReady && (
        <Suspense fallback={null}>
          <AutoUpdatePrompt />
        </Suspense>
      )}
    </div>
  );
};

export default Index;
