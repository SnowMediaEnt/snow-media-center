import { memo, useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Store, Video, MessageCircle, Settings as SettingsIcon, User, LogIn, Smartphone, Shield } from 'lucide-react';
import NewsTicker from '@/components/NewsTicker';
import MediaBar from '@/components/MediaBar';
import HomeClock from '@/components/HomeClock';
import smeLogo from '@/assets/sme-logo.png';
import easterEggImg from '@/assets/easter-egg.png';
import PinnedAppsPopup from '@/components/PinnedAppsPopup';
import AppAlertDialog from '@/components/AppAlertDialog';
import { useAppAlerts, type AppAlert } from '@/hooks/useAppAlerts';
import { useDeviceInstalledApps } from '@/hooks/useDeviceInstalledApps';
import { generatePackageName } from '@/utils/downloadApk';
import { useAuth } from '@/hooks/useAuth';
import { useAdminRole } from '@/hooks/useAdminRole';
import { useVersion } from '@/hooks/useVersion';
import { useNavigate } from 'react-router-dom';
import { useNavigation } from '@/hooks/useNavigation';
import { useToast } from '@/hooks/use-toast';
import { useDynamicBackground } from '@/hooks/useDynamicBackground';
import { usePinnedApps, PinnedApp } from '@/hooks/usePinnedApps';
import { useAppData } from '@/hooks/useAppData';
import { InstalledApp } from '@/data/installedApps';

// Lazy-load heavy sub-views so the home screen boots faster on STB/FireTV
const InstallApps = lazy(() => import('@/components/InstallApps'));
const MediaStore = lazy(() => import('@/components/MediaStore'));
const CommunityChat = lazy(() => import('@/components/CommunityChat'));
const CreditStore = lazy(() => import('@/components/CreditStore'));
const SupportVideos = lazy(() => import('@/components/SupportVideos'));
const ChatCommunity = lazy(() => import('@/components/ChatCommunity'));
const Settings = lazy(() => import('@/components/Settings'));
const UserDashboard = lazy(() => import('@/components/UserDashboard'));
const SupportTicketSystem = lazy(() => import('@/components/SupportTicketSystem'));
const AIConversationSystem = lazy(() => import('@/components/AIConversationSystem'));
const AdminSupportDashboard = lazy(() => import('@/components/AdminSupportDashboard'));
const Games = lazy(() => import('@/components/Games'));
const WixBlog = lazy(() => import('@/components/WixBlog'));
const WelcomePopup = lazy(() => import('@/components/WelcomePopup'));
const AutoUpdatePrompt = lazy(() => import('@/components/AutoUpdatePrompt'));

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
}: {
  button: { icon: typeof Smartphone; title: string; description: string; variant: 'blue' | 'purple' | 'gold' | 'navy' };
  index: number;
  isFocused: boolean;
  layoutMode: 'grid' | 'row';
  onActivate: () => void;
}) => {
  const ButtonIcon = button.icon;
  const cardStyle = layoutMode === 'grid'
    ? { width: 'clamp(170px, 18vw, 400px)', height: 'clamp(125px, 21vh, 290px)' }
    : { width: 'clamp(170px, 18vw, 340px)', aspectRatio: '1 / 0.92' as const };

  return (
    <Card
      tabIndex={0}
      style={cardStyle}
      data-focused={isFocused ? 'true' : 'false'}
      data-home-card={index}
      className={`
        home-focus-surface relative overflow-hidden cursor-pointer border-0 rounded-3xl flex-shrink-0 shadow-xl
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
        <h3 className="font-bold mb-1 text-white leading-tight text-shadow-strong font-quicksand" style={{ fontSize: 'clamp(0.875rem, 1.5vw, 1.75rem)' }}>
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
  const { user } = useAuth();
  const { isAdmin } = useAdminRole();
  const { version } = useVersion();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { currentView, navigateTo, goBack, backPressCount, canGoBack } = useNavigation('home');
  const { backgroundUrl, hasBackground } = useDynamicBackground('home');
  const { pinnedApps, isPinned, pinApp, unpinApp, canPinMore } = usePinnedApps();
  const { apps } = useAppData();
  const { resolvePackageName } = useDeviceInstalledApps();
  const { getAlertForApp } = useAppAlerts();
  const [pendingAlert, setPendingAlert] = useState<{ alert: AppAlert; app: any } | null>(null);

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

  // Actually launch a pinned app — mirrors InstallApps.handleLaunch
  const performLaunchPinnedApp = useCallback(async (app: any) => {
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
  const handleLaunchPinnedApp = useCallback(async (app: any) => {
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


  const handleLayoutChange = (newMode: 'grid' | 'row') => {
    setLayoutMode(newMode);
    localStorage.setItem('snow-media-layout', newMode);
  };

  // Handle keyboard navigation for TV remote
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip navigation handling when user is typing in an input or textarea
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      
      // Allow Backspace when typing
      if (event.key === 'Backspace' && isTyping) {
        return; // Let the default behavior happen
      }
      
      // Handle both standard back buttons and Android hardware back button (but not Backspace when typing)
      if (event.key === 'Escape' || event.keyCode === 4 || event.which === 4) { // Android back button
        event.preventDefault();
        event.stopPropagation();
        
        if (currentView !== 'home') {
          goBack();
          return;
        }
      }
      
      if (currentView !== 'home') {
        return; // Let individual components handle their own navigation
      }

      // MediaBar owns the keys when active
      if (isInMediaBar) {
        return;
      }

      // Prevent default for navigation keys on home screen (only when not typing)
      if (!isTyping && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }

      // Home screen navigation
      const maxButtons = 3; // apps, store, support, chat
      
      switch (event.key) {
        case 'ArrowLeft':
          if (layoutMode === 'grid') {
            if (focusedButton === 1 || focusedButton === 3) {
              setFocusedButton(focusedButton - 1);
            } else if (focusedButton === -1) { // settings
              setFocusedButton(-2); // user/auth
            }
          } else { // row mode
            if (focusedButton > 0) {
              setFocusedButton(focusedButton - 1);
            } else if (focusedButton === 0) {
              setFocusedButton(-1); // settings
            } else if (focusedButton === -1) {
              setFocusedButton(-2); // user/auth
            }
          }
          break;
          
        case 'ArrowRight':
          if (layoutMode === 'grid') {
            if (focusedButton === 0 || focusedButton === 2) {
              setFocusedButton(focusedButton + 1);
            } else if (focusedButton === -2) { // user/auth
              setFocusedButton(-1); // settings
            }
          } else { // row mode
            if (focusedButton < maxButtons) {
              setFocusedButton(focusedButton + 1);
            } else if (focusedButton === maxButtons) {
              setFocusedButton(-1); // settings
            } else if (focusedButton === -1) {
              setFocusedButton(-2); // user/auth
            } else if (focusedButton === -2) {
              setFocusedButton(0); // back to first app
            }
          }
          break;
          
        case 'ArrowUp':
          // If on Main Apps (button 0), go into the popup
          if (focusedButton === 0 && !isInPopup) {
            setIsInPopup(true);
            setPopupFocusIndex(0);
            return;
          }
          
          if (layoutMode === 'grid') {
            if (focusedButton === 2 || focusedButton === 3) {
              setFocusedButton(focusedButton - 2);
            } else if (focusedButton >= 0) {
              // From top app row → into MediaBar
              setFocusedButton(-99);
              setIsInMediaBar(true);
            } else {
              // From top button row → into MediaBar
              setFocusedButton(-99);
              setIsInMediaBar(true);
            }
          } else { // row mode
            if (focusedButton >= 0) {
              setFocusedButton(-99);
              setIsInMediaBar(true);
            } else {
              setFocusedButton(-99);
              setIsInMediaBar(true);
            }
          }
          break;
          
        case 'ArrowDown':
          if (layoutMode === 'grid') {
            if (focusedButton === 0 || focusedButton === 1) {
              setFocusedButton(focusedButton + 2);
            } else if (focusedButton < 0) {
              setFocusedButton(0); // Go to first app
            }
          } else { // row mode - go to apps
            if (focusedButton < 0) {
              setFocusedButton(0); // Go to first app
            }
          }
          break;
          
        case 'Enter':
        case ' ':
          if (focusedButton === -2) {
            // Navigate to auth or user dashboard
            if (user) {
              navigateTo('user');
            } else {
              navigate('/auth');
            }
          } else if (focusedButton === -1) {
            // Navigate to settings
            navigateTo('settings');
          } else if (focusedButton === 0) {
            navigateTo('apps');
          } else if (focusedButton === 1) {
            navigateTo('store');
          } else if (focusedButton === 2) {
            navigateTo('support');
          } else if (focusedButton === 3) {
            navigateTo('chat');
          }
          break;
          
        case 'Escape':
        case 'Backspace':
          // Only reached on home view (non-home returned earlier above).
          // Triggers the double-press-to-exit flow in useNavigation.
          goBack();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedButton, layoutMode, currentView, user, navigate, navigateTo, goBack, isInPopup, isInMediaBar]);

  const buttons = useMemo(() => [
    {
      icon: Smartphone,
      title: 'Main Apps',
      description: 'Download APKs & Streaming Tools',
      variant: 'blue' as const
    },
    {
      icon: Store,
      title: 'Snow Media Store',
      description: 'Visit Official Store',
      variant: 'purple' as const
    },
    {
      icon: Video,
      title: 'Support Videos',
      description: 'Help & Tutorial Videos',
      variant: 'gold' as const
    },
    {
      icon: MessageCircle,
      title: 'Chat & Community',
      description: 'Connect with Admin & Users',
      variant: 'navy' as const
    }
  ], []);

  
  return (
    <div className="min-h-screen">
      {/* Lazy-loaded navigation views — Suspense gives a lightweight fallback on STB */}
      <Suspense fallback={<RouteFallback />}>
        {currentView === 'apps' && <InstallApps onBack={() => goBack()} onNavigateToChat={() => navigateTo('chat')} />}
        {currentView === 'store' && <MediaStore onBack={() => goBack()} />}
        {currentView === 'support' && <SupportVideos onBack={() => goBack()} />}
        {currentView === 'chat' && <ChatCommunity onBack={() => goBack()} onNavigate={(section) => navigateTo(section)} />}
        {currentView === 'community' && <CommunityChat onBack={() => goBack()} />}
        {currentView === 'credits' && <CreditStore onBack={() => goBack()} />}
        {currentView === 'settings' && <Settings onBack={() => goBack()} layoutMode={layoutMode} onLayoutChange={handleLayoutChange} />}
        {currentView === 'user' && <UserDashboard onViewChange={(view) => navigateTo(view)} onManageMedia={() => navigateTo('media')} onViewSettings={() => navigateTo('settings')} onCommunityChat={() => navigateTo('community')} onCreditStore={() => navigateTo('credits')} onGames={() => navigateTo('games')} />}
        {currentView === 'games' && <Games onBack={() => goBack()} />}
        {currentView === 'wix-blog' && <WixBlog onBack={() => goBack()} />}
        {currentView === 'support-tickets' && <SupportTicketSystem onBack={() => goBack()} />}
        {currentView === 'ai-conversations' && <AIConversationSystem onBack={() => goBack()} />}
        {currentView === 'create-ai-conversation' && <AIConversationSystem onBack={() => goBack()} />}
        {currentView === 'admin-support' && <AdminSupportDashboard onBack={() => goBack()} />}
      </Suspense>

      {/* Home screen content */}
      {currentView === 'home' && (
        <div className="h-screen w-screen overflow-hidden text-white relative flex flex-col">
          {/* Dynamic background image or fallback gradient */}
          {hasBackground ? (
            <div 
              className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-500"
              style={{ backgroundImage: `url(${backgroundUrl})` }}
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-blue-100/30 to-blue-200/20" />
              <div className="absolute inset-0 opacity-30">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.4),transparent_30%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(135,206,235,0.3),transparent_40%)]" />
              </div>
            </>
          )}
          {/* Dark overlay for text readability when using custom background */}
          {hasBackground && <div className="absolute inset-0 bg-black/30" />}

          {/* User/Auth Controls — safe-area-aware so X96 / T95 / FireTV overscan
              doesn't crop the buttons or overlap them with the clock. */}
          <div
            className="absolute z-20 flex flex-wrap items-center justify-end"
            style={{
              top: `max(env(safe-area-inset-top, 0px), ${
                screenHeight >= 2160 ? '2rem' : screenHeight >= 1440 ? '1.5rem' : '1rem'
              })`,
              right: `max(env(safe-area-inset-right, 0px), ${
                screenHeight >= 2160 ? '2rem' : screenHeight >= 1440 ? '1.5rem' : '1rem'
              })`,
              gap: screenHeight >= 2160 ? '1rem' : screenHeight >= 1440 ? '0.75rem' : '0.5rem',
              maxWidth: 'min(50vw, 32rem)',
            }}
          >
            {/* Admin Button - only show for admins */}
            {isAdmin && (
              <Button
                onClick={() => navigateTo('admin-support')}
                variant="purple"
                size={screenHeight >= 1440 ? "default" : "sm"}
                tabIndex={0}
                data-focused={focusedButton === -3 ? 'true' : 'false'}
                className={`tv-focusable home-focus-surface ${
                  screenHeight >= 2160 ? 'text-xl px-6 py-3' :
                  screenHeight >= 1440 ? 'text-lg px-5 py-2.5' :
                  ''
                }`}
              >
                <Shield className={`mr-2 ${
                  screenHeight >= 2160 ? 'w-6 h-6' :
                  screenHeight >= 1440 ? 'w-5 h-5' :
                  'w-4 h-4'
                }`} />
                Admin
              </Button>
            )}
            {user ? (
              <Button
                onClick={() => navigateTo('user')}
                variant="white"
                size={screenHeight >= 1440 ? "default" : "sm"}
                tabIndex={0}
                data-focused={focusedButton === -2 ? 'true' : 'false'}
                className={`tv-focusable home-focus-surface ${
                  screenHeight >= 2160 ? 'text-xl px-6 py-3' :
                  screenHeight >= 1440 ? 'text-lg px-5 py-2.5' :
                  ''
                }`}
              >
                <User className={`mr-2 text-gray-800 ${
                  screenHeight >= 2160 ? 'w-6 h-6' :
                  screenHeight >= 1440 ? 'w-5 h-5' :
                  'w-4 h-4'
                }`} />
                <span className="text-gray-800">Dashboard</span>
              </Button>
            ) : (
              <Button
                onClick={() => navigate('/auth')}
                variant="gold"
                size={screenHeight >= 1440 ? "default" : "sm"}
                tabIndex={0}
                data-focused={focusedButton === -2 ? 'true' : 'false'}
                className={`tv-focusable home-focus-surface ${
                  screenHeight >= 2160 ? 'text-xl px-6 py-3' :
                  screenHeight >= 1440 ? 'text-lg px-5 py-2.5' :
                  ''
                }`}
              >
                <LogIn className={`mr-2 ${
                  screenHeight >= 2160 ? 'w-6 h-6' :
                  screenHeight >= 1440 ? 'w-5 h-5' :
                  'w-4 h-4'
                }`} />
                Sign In
              </Button>
            )}
            <Button
              onClick={() => navigateTo('settings')}
              variant="gold"
              size={screenHeight >= 1440 ? "default" : "sm"}
              tabIndex={0}
              data-focused={focusedButton === -1 ? 'true' : 'false'}
              className={`tv-focusable home-focus-surface ${
                screenHeight >= 2160 ? 'text-xl px-6 py-3' :
                screenHeight >= 1440 ? 'text-lg px-5 py-2.5' :
                ''
              }`}
            >
              <SettingsIcon className={`mr-2 ${
                screenHeight >= 2160 ? 'w-6 h-6' :
                screenHeight >= 1440 ? 'w-5 h-5' :
                'w-4 h-4'
              }`} />
              Settings
            </Button>
          </div>

          {/* Spacer for info bar */}
          <div className="flex-shrink-0" style={{ height: '8vh' }}></div>

          {/* Header - tight container around title with RSS through middle */}
          <div className="relative z-10 flex-shrink-0 flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-shadow-strong leading-none" style={{ fontSize: 'clamp(3rem, 8vw, 10rem)', opacity: 0.3 }}>
                <span className="font-snow-media text-brand-navy">SNOW MEDIA</span>
                <span> </span>
                <span className="font-center" style={{ color: '#C9B370' }}>CENTER</span>
              </h1>
              <p className="text-brand-ice font-nunito font-medium text-shadow-soft" style={{ fontSize: 'clamp(1rem, 2vw, 2rem)', marginTop: '-4px', opacity: 0.5 }}>
                Your Premium Streaming Experience
              </p>
            </div>
            {/* News Ticker overlays middle of title h1 (above subtitle) */}
            <div className="absolute left-0 right-0 z-20" style={{ top: '38%', transform: 'translateY(-50%)' }}>
              <NewsTicker />
            </div>
          </div>

          {/* SME logo top-left */}
          <img
            src={smeLogo}
            alt="Snow Media Entertainment"
            className="absolute z-20 pointer-events-none select-none"
            style={{
              top: 'max(env(safe-area-inset-top, 0px), clamp(0.25rem, 1vh, 0.75rem))',
              left: 'max(env(safe-area-inset-left, 0px), clamp(0.5rem, 1.5vw, 1rem))',
              height: 'clamp(72px, 11vh, 140px)',
              width: 'auto',
            }}
          />

          {/* Date/Time Display - isolated to avoid re-rendering the whole home tree every second */}
          <HomeClock version={version} onUpdateClick={() => navigateTo('settings')} />

          {/* New Content Bar - pulled up so pinned apps don't block it */}
          <div style={{ marginTop: 'clamp(0.75rem, 2vh, 1.5rem)' }}>
            <MediaBar
              active={isInMediaBar}
              onExitDown={() => { setIsInMediaBar(false); setFocusedButton(0); }}
              onExitUp={() => { setIsInMediaBar(false); setFocusedButton(-2); }}
            />
          </div>

          {/* Main Content - Cards positioned at bottom */}
          <div className="relative z-10 flex-1 flex flex-col justify-end" style={{ paddingBottom: '5vh', paddingLeft: '3vw', paddingRight: '3vw' }}>
            <div 
              className={`justify-center w-full mx-auto ${layoutMode === 'grid' ? 'grid grid-cols-2' : 'flex flex-wrap'}`} 
              style={{ 
                gap: layoutMode === 'grid' ? 'clamp(1.5rem, 3vw, 4rem)' : 'clamp(2.5rem, 4.5vw, 5.5rem)',
                maxWidth: layoutMode === 'grid' ? 'clamp(500px, 55vw, 1200px)' : '95vw'
              }}
            >
              {buttons.map((button, index) => {
                const isFocused = focusedButton === index;
                const activateCard = () => {
                  if (index === 0) navigateTo('apps');
                  else if (index === 1) navigateTo('store');
                  else if (index === 2) navigateTo('support');
                  else if (index === 3) navigateTo('chat');
                };

                const cardContent = (
                  <HomeActionCard
                    button={button}
                    index={index}
                    isFocused={isFocused}
                    layoutMode={layoutMode}
                    onActivate={activateCard}
                  />
                );

                // Wrap Main Apps card (index 0) with pinned apps popup
                if (index === 0) {
                  return (
                    <div key={index} className="relative">
                      <PinnedAppsPopup
                        pinnedApps={pinnedApps}
                        apps={apps}
                        isVisible={isFocused}
                        onLaunchApp={handleLaunchPinnedApp}
                        onPinApp={handlePinFromPopup}
                        onUnpinApp={unpinApp}
                        isPinned={isPinned}
                        canPinMore={canPinMore}
                        focusedIndex={isInPopup && focusedButton === 0 ? popupFocusIndex : -1}
                        onFocusChange={(index) => setPopupFocusIndex(index)}
                        onExitFocus={() => {
                          setIsInPopup(false);
                          setPopupFocusIndex(-1);
                        }}
                      />
                      {cardContent}
                    </div>
                  );
                }
                
                return <div key={index}>{cardContent}</div>;
              })}
            </div>
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

      {/* First-launch welcome + per-version "What's New" popup */}
      <Suspense fallback={null}>
        <WelcomePopup />
      </Suspense>

      {/* Background auto-update check (native only). On by default; users can
          disable via localStorage key smc-auto-update-enabled = "false". */}
      <Suspense fallback={null}>
        <AutoUpdatePrompt />
      </Suspense>
    </div>
  );
};

export default Index;