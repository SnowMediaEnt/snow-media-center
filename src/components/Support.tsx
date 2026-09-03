import { useState, useEffect, lazy, Suspense, useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  Gauge,
  LifeBuoy,
  Video,
  MessageCircle,
  HelpCircle,
  Brain,
  MessageSquare,
  GraduationCap,
  MonitorSmartphone,
} from 'lucide-react';
import SpeedTest from '@/components/SpeedTest';
import BufferingGuide from '@/components/BufferingGuide';
import DownloadProgress from '@/components/DownloadProgress';

import { useAppData } from '@/hooks/useAppData';
import { useDeviceInstalledApps } from '@/hooks/useDeviceInstalledApps';
import { useToast } from '@/hooks/use-toast';
import { generatePackageName } from '@/utils/downloadApk';
import type { AppData } from '@/hooks/useAppData';
import { useTVFocus, TVFocusNavigationMap } from '@/hooks/useTVFocus';
import { trackAppLaunch, trackEvent } from '@/lib/analytics';
import { hideKeyboardForDpad } from '@/utils/dpadKeyboard';
import { snapAllTVScrollToTop } from '@/utils/tvScroll';
import { useUnreadTickets } from '@/hooks/useUnreadTickets';
import { BackButton, BACK_ROW } from '@/components/ui/BackButton';

const SupportVideos = lazy(() => import('@/components/SupportVideos'));
const SupportTicketSystem = lazy(() => import('@/components/SupportTicketSystem'));
const CommunityChat = lazy(() => import('@/components/CommunityChat'));
const ChatCommunity = lazy(() => import('@/components/ChatCommunity'));
const HowToGuide = lazy(() => import('@/components/HowToGuide'));
const RemoteSupport = lazy(() => import('@/components/RemoteSupport'));

interface SupportProps {
  onBack: () => void;
  onNavigate?: (section: string) => void;
  onOpenMainApps?: () => void;
}

type Tab = 'help' | 'ai' | 'community';
type HelpView = 'menu' | 'videos' | 'tickets' | 'remote';

/** DOM order of the Help cards. The D-pad map below is derived from this plus
 *  the live column count, so the two stay in step if a card is added. */
const HELP_IDS = [
  'help-howto',
  'help-speedtest',
  'help-guide',
  'help-videos',
  'help-tickets',
  'help-remote',
] as const;

/** Matches the `md:` breakpoint the card grid switches columns at. */
const HELP_TWO_COL = '(min-width: 768px)';

const Support = ({ onBack, onNavigate }: SupportProps) => {
  const { unreadCount: unreadTicketCount } = useUnreadTickets();
  const [tab, setTab] = useState<Tab>('help');
  const [helpView, setHelpView] = useState<HelpView>('menu');
  const [childFocusActive, setChildFocusActive] = useState(false);
  const [showSpeedTest, setShowSpeedTest] = useState(false);
  // Synchronous handoff from the Plex player's "Buffering?" shortcut: LiveTV
  // sets this flag BEFORE navigating to Support so the guide opens in the
  // same commit (no setTimeout race with the CustomEvent fallback).
  const [showGuide, setShowGuide] = useState<boolean>(() => {
    try {
      if (sessionStorage.getItem('smc-open-buffering-guide') === '1') {
        sessionStorage.removeItem('smc-open-buffering-guide');
        return true;
      }
    } catch { /* ignore */ }
    return false;
  });
  const [showHowTo, setShowHowTo] = useState<boolean>(() => {
    try {
      if (sessionStorage.getItem('smc-open-howto') === '1') {
        sessionStorage.removeItem('smc-open-howto');
        return true;
      }
    } catch { /* ignore */ }
    return false;
  });
  // Origin of the guide open — 'plex-movie' means close should return to Plex.
  const [guideOrigin, setGuideOrigin] = useState<string | null>(() => {
    try { return sessionStorage.getItem('smc-guide-origin'); } catch { return null; }
  });
  const [downloadingApp, setDownloadingApp] = useState<AppData | null>(null);
  const [helpCols, setHelpCols] = useState<number>(() => {
    try { return window.matchMedia(HELP_TWO_COL).matches ? 2 : 1; } catch { return 2; }
  });
  const supportTopRef = useRef<HTMLDivElement>(null);
  const { apps } = useAppData();
  const { resolvePackageName, isPackageInstalled } = useDeviceInstalledApps();
  const { toast } = useToast();


  // Minimal launch / download handlers for the buffering guide. Full
  // install + progress UX still lives in Main Apps — we route downloads
  // back there so the user sees the standard download dialog.
  const launchApp = useCallback(async (app: AppData) => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) {
        toast({ title: 'Launch unavailable', description: 'App launching only works on Android.' });
        return;
      }
      const { AppManager } = await import('@/capacitor/AppManager');
      const packageName = app.packageName || generatePackageName(app.name);
        try { trackAppLaunch(app.name); } catch { void 0; }
      await AppManager.launch({ packageName });
    } catch (err) {
      console.error('[Support] launch failed:', err);
      toast({ title: 'Launch failed', description: `Could not launch ${app.name}.`, variant: 'destructive' });
    }
  }, [toast]);

  const openAppSettings = useCallback(async (app: AppData) => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) {
        toast({ title: 'App Info unavailable', description: 'Only works on Android devices.' });
        return;
      }
      const { AppManager } = await import('@/capacitor/AppManager');
      // Resolve the REAL installed package (handles aliases like ipvanish, surfshark, dreamstreams).
      const resolved = resolvePackageName(app.name, app.packageName) || app.packageName || generatePackageName(app.name);
      // Phase 6A: use the cached installed-apps set — no per-click native isInstalled call.
      if (!isPackageInstalled(resolved)) {
        toast({
          title: 'App not installed',
          description: `${app.name} isn't installed on this device.`,
          variant: 'destructive',
        });
        return;
      }
      await AppManager.openAppSettings({ packageName: resolved, appName: app.name });
      toast({
        title: `Opening ${app.name}`,
        description: "Tap 'Force Stop', then 'Storage' → 'Clear cache'. Press Back when done.",
      });
    } catch (err) {
      console.error('[Support] openAppSettings failed:', err);
      toast({
        title: 'Could not open App Info',
        description: `Open Android Settings → Apps → ${app.name} manually.`,
        variant: 'destructive',
      });
    }
  }, [resolvePackageName, isPackageInstalled, toast]);

  // Download in place (mirrors Main Apps) so the user stays inside the
  // Buffering Guide and doesn't lose their progress mid-flow.
  const downloadApp = useCallback((app: AppData) => {
    setDownloadingApp(app);
  }, []);



  // Back navigation is owned by child components/overlays so that pressing Back
  // inside a ticket, video, guide step, or speed test only pops one level
  // instead of exiting Support all the way to the Home screen:
  //   - SpeedTest        → handles its own Back / onClose
  //   - BufferingGuide   → steps back one at a time, then onClose
  //   - SupportVideos    → closes open video, then onBack → menu
  //   - SupportTicketSystem → pops ticket/AI/create view, then onBack → menu
  // Only when we're on the Support menu does the parent (Index) take Back to home.


  // Bridge into child components (AI Chat / Community) when pressing Down
  // from those tabs. The child components use different focus systems so
  // we can't express this in the navigation map directly.
  const focusIntoChild = useCallback((childTab: Tab) => {
    if (childTab === 'ai') {
      setChildFocusActive(true);
      window.dispatchEvent(new CustomEvent('chat-community:focus-ai-input'));
      return true;
    }
    if (childTab === 'community') {
      setChildFocusActive(true);
      window.dispatchEvent(new CustomEvent('community-chat:focus-room'));
      return true;
    }
    return false;
  }, []);

  const supportNavigation = useMemo<TVFocusNavigationMap>(() => {
    // The Help cards are laid out row-major in a `grid-cols-1 md:grid-cols-2`.
    // The map used to be a flat chain (howto → speedtest → guide → …), which
    // walked the SCREEN diagonally: Down from "How to use SMC" landed on
    // Speedtest, the card to its RIGHT. Build the map from the real column
    // count instead, so Down moves down a column and Right moves across a row.
    const nav: TVFocusNavigationMap = {
      'support-back': { down: `tab-${tab}` },
      'tab-help': { up: 'support-back', right: 'tab-ai', left: 'tab-community', down: 'help-howto' },
      'tab-ai': {
        up: 'support-back', right: 'tab-community', left: 'tab-help',
        down: () => { focusIntoChild('ai'); return null; },
      },
      'tab-community': {
        up: 'support-back', right: 'tab-help', left: 'tab-ai',
        down: () => { focusIntoChild('community'); return null; },
      },
    };
    const stay = () => null;
    HELP_IDS.forEach((id, i) => {
      const row = Math.floor(i / helpCols);
      const col = i % helpCols;
      const at = (r: number, c: number): string | undefined =>
        c >= 0 && c < helpCols ? HELP_IDS[r * helpCols + c] : undefined;
      const down = at(row + 1, col);
      const left = at(row, col - 1);
      const right = at(row, col + 1);
      nav[id] = {
        up: row === 0 ? 'tab-help' : at(row - 1, col),
        down: down ?? stay,
        left: left ?? stay,
        right: right ?? stay,
      };
    });
    return nav;
  }, [tab, focusIntoChild, helpCols]);

  // When a sub-view (videos / tickets) or overlay (speedtest / guide / how-to) is open,
  // the child component owns D-pad + Back. Disabling the parent focus manager
  // here prevents its Back handler from firing first and exiting Support
  // straight to the Home screen.
  const supportFocusActive = !showSpeedTest && !showGuide && !showHowTo && helpView === 'menu' && !childFocusActive;
  const supportFocus = useTVFocus({
    initialFocusId: 'support-back',
    focusableSelector: '[data-support-tv-focus-id]',
    navigation: supportNavigation,
    onBack,
    enabled: supportFocusActive,
    scrollBlock: 'nearest',
  });


  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia(HELP_TWO_COL); } catch { return; }
    const onChange = () => setHelpCols(mq.matches ? 2 : 1);
    onChange();
    // Chromium 66 (Fire TV) has no addEventListener on MediaQueryList.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  const scrollSupportToRealTop = useCallback(() => {
    supportTopRef.current?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
    snapAllTVScrollToTop([supportFocus.containerRef.current]);
  }, [supportFocus.containerRef]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlHeight = html.style.height;
    const previousBodyHeight = body.style.height;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    html.style.height = '100dvh';
    body.style.height = '100dvh';
    scrollSupportToRealTop();
    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      html.style.height = previousHtmlHeight;
      body.style.height = previousBodyHeight;
    };
  }, [scrollSupportToRealTop]);

  useEffect(() => {
    if (showSpeedTest || showGuide || helpView !== 'menu' || childFocusActive) return;
    const id = supportFocus.currentFocusId;
    if (id === 'support-back' || id?.startsWith('tab-')) {
      scrollSupportToRealTop();
    }
  }, [childFocusActive, helpView, scrollSupportToRealTop, showGuide, showSpeedTest, supportFocus.currentFocusId]);

  // Listen for "escape up" requests from embedded child components so they
  // can hand focus back to the Support tab row via the D-pad.
  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent<{ tab?: Tab }>).detail?.tab ?? tab;
      void hideKeyboardForDpad(document.activeElement as HTMLElement | null);
      setChildFocusActive(false);
      // Force every possible scroll owner back to absolute top. Android WebView
      // can scroll the document instead of the nested TV container after the
      // keyboard/input bar was centered, so both must be snapped.
      const snapTop = scrollSupportToRealTop;
      snapTop();
      // Re-assert focus across TWO animation frames. Re-enabling useTVFocus
      // commits state on the next frame and used to schedule its own auto-focus
      // rAF that overrode this one; we still defend against any other race by
      // re-asserting after that frame has flushed.
      requestAnimationFrame(() => {
        snapTop();
        supportFocus.focusById(`tab-${target}`, 'nearest');
        requestAnimationFrame(() => {
          supportFocus.focusById(`tab-${target}`, 'nearest');
          snapTop();
        });
      });
    };
    const openTickets = () => { setTab('help'); setHelpView('tickets'); };
    const openGuide = () => {
      try {
        const o = sessionStorage.getItem('smc-guide-origin');
        if (o) setGuideOrigin(o);
      } catch { /* ignore */ }
      setTab('help'); setHelpView('menu'); setShowGuide(true);
    };
    const openHowTo = () => { setTab('help'); setHelpView('menu'); setShowHowTo(true); };
    window.addEventListener('support:focus-tab', handler as EventListener);
    window.addEventListener('support:open-tickets', openTickets);
    window.addEventListener('support:open-buffering-guide', openGuide);
    window.addEventListener('support:open-howto', openHowTo);
    return () => {
      window.removeEventListener('support:focus-tab', handler as EventListener);
      window.removeEventListener('support:open-tickets', openTickets);
      window.removeEventListener('support:open-buffering-guide', openGuide);
      window.removeEventListener('support:open-howto', openHowTo);
    };

  }, [scrollSupportToRealTop, supportFocus, tab]);



  // If a Help sub-view is active, render it full-bleed (it has its own header)
  if (tab === 'help' && helpView === 'videos') {
    return (
      <Suspense fallback={null}>
        <SupportVideos onBack={() => setHelpView('menu')} />
      </Suspense>
    );
  }
  if (tab === 'help' && helpView === 'tickets') {
    return (
      <Suspense fallback={null}>
        <SupportTicketSystem onBack={() => setHelpView('menu')} />
      </Suspense>
    );
  }
  if (tab === 'help' && helpView === 'remote') {
    return (
      <Suspense fallback={null}>
        <RemoteSupport
          onBack={() => setHelpView('menu')}
          onOpenTickets={() => setHelpView('tickets')}
        />
      </Suspense>
    );
  }

  return (
    <div ref={supportFocus.containerRef} className="fixed inset-0 tv-scroll-container tv-safe text-white overflow-y-auto overscroll-contain">
      <div ref={supportTopRef} aria-hidden="true" className="h-0 w-full" />
      <div className={BACK_ROW}>
        <BackButton
          onClick={onBack}
          label="Back to Home"
          focusId="support-back"
          focused={supportFocus.currentFocusId === 'support-back'}
          data-support-tv-focus-id="support-back"
        />
      </div>
      <div className="max-w-6xl mx-auto pb-28" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 7rem)' }}>
        <div className="flex flex-col items-center mb-6">
          <div className="text-center mt-4">
            <h1 className="text-4xl font-bold text-white mb-2">Support</h1>
            <p className="text-xl text-blue-200">
              Get help, chat with AI, or connect with the community
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => { setChildFocusActive(false); setTab(v as Tab); }} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-16 bg-slate-800/50 border border-slate-600 p-1 gap-1 h-14 items-stretch">
            <TabsTrigger
              value="help"
              data-support-tv-focus-id="tab-help"
              className="h-full inline-flex items-center justify-center text-white text-center text-lg min-w-0 transition-all duration-200 outline-none data-[state=active]:bg-brand-gold data-[state=active]:text-slate-900 data-[state=active]:shadow-[inset_0_0_0_2px_rgba(255,255,255,0.45)]"
            >
              <HelpCircle className="w-5 h-5 mr-2" />
              Help
            </TabsTrigger>
            <TabsTrigger
              value="ai"
              data-support-tv-focus-id="tab-ai"
              className="h-full inline-flex items-center justify-center text-white text-center text-lg min-w-0 transition-all duration-200 outline-none data-[state=active]:bg-purple-600 data-[state=active]:shadow-[inset_0_0_0_2px_rgba(255,255,255,0.45)]"
            >
              <Brain className="w-5 h-5 mr-2" />
              AI Chat
            </TabsTrigger>
            <TabsTrigger
              value="community"
              data-support-tv-focus-id="tab-community"
              className="h-full inline-flex items-center justify-center text-white text-center text-lg min-w-0 transition-all duration-200 outline-none data-[state=active]:bg-green-600 data-[state=active]:shadow-[inset_0_0_0_2px_rgba(255,255,255,0.45)]"
            >
              <MessageSquare className="w-5 h-5 mr-2" />
              Community
            </TabsTrigger>
          </TabsList>



          <TabsContent value="help" className="mt-0">
            {/* Was a single 672px column inside a 1152px page, so most of a TV
                screen sat empty and the list scrolled twice as far as it needed
                to. Two columns at the page width instead. The cards are h-20
                with a grid-cols-[2.5rem_1fr_auto] interior, so they take the
                narrower column without reflowing. */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Button
                onClick={() => setShowHowTo(true)}
                variant="outline"
                size="lg"
                tabIndex={0}
                data-support-tv-focus-id="help-howto"
                className="bg-emerald-700/60 border-emerald-400/70 text-white hover:bg-emerald-600/70 h-20 px-6 shadow-md grid grid-cols-[2.5rem_1fr] content-center items-center gap-x-4 gap-y-0.5 text-left"
              >
                <GraduationCap className="w-7 h-7 row-span-2 self-center justify-self-center" />
                <span className="text-xl font-semibold truncate">How to use SMC</span>
                <span className="col-start-2 text-sm text-emerald-100/90 font-normal truncate">
                  A simple tour of every screen
                </span>
              </Button>
              <Button
                onClick={() => { try { trackEvent('speed_test_launch', 'tools'); } catch { void 0; } setShowSpeedTest(true); }}
                variant="outline"
                size="lg"
                tabIndex={0}
                data-support-tv-focus-id="help-speedtest"
                className="bg-cyan-700/60 border-cyan-400/70 text-white hover:bg-cyan-600/70 h-20 px-6 shadow-md grid grid-cols-[2.5rem_1fr] content-center items-center gap-x-4 gap-y-0.5 text-left"
              >
                <Gauge className="w-7 h-7 row-span-2 self-center justify-self-center" />
                <span className="text-xl font-semibold truncate">Speedtest</span>
                <span className="col-start-2 text-sm text-cyan-100/90 font-normal truncate">
                  Test your internet speed
                </span>
              </Button>
              <Button
                onClick={() => setShowGuide(true)}
                variant="outline"
                size="lg"
                tabIndex={0}
                data-support-tv-focus-id="help-guide"
                className="bg-purple-700/60 border-purple-400/70 text-white hover:bg-purple-600/70 h-20 px-6 shadow-md grid grid-cols-[2.5rem_1fr] content-center items-center gap-x-4 gap-y-0.5 text-left"
              >
                <LifeBuoy className="w-7 h-7 row-span-2 self-center justify-self-center" />
                <span className="text-xl font-semibold truncate">Buffering Guide</span>
                <span className="col-start-2 text-sm text-purple-100/90 font-normal truncate">
                  Step-by-step buffering fixes
                </span>
              </Button>
              <Button
                onClick={() => setHelpView('videos')}
                variant="outline"
                size="lg"
                tabIndex={0}
                data-support-tv-focus-id="help-videos"
                className="bg-blue-700/60 border-blue-400/70 text-white hover:bg-blue-600/70 h-20 px-6 shadow-md grid grid-cols-[2.5rem_1fr] content-center items-center gap-x-4 gap-y-0.5 text-left"
              >
                <Video className="w-7 h-7 row-span-2 self-center justify-self-center" />
                <span className="text-xl font-semibold truncate">Support Videos</span>
                <span className="col-start-2 text-sm text-blue-100/90 font-normal truncate">
                  Tutorials and walkthroughs
                </span>
              </Button>
              <Button
                onClick={() => setHelpView('tickets')}
                variant="outline"
                size="lg"
                tabIndex={0}
                data-support-tv-focus-id="help-tickets"
                className="relative bg-orange-700/60 border-orange-400/70 text-white hover:bg-orange-600/70 h-20 px-6 shadow-md grid grid-cols-[2.5rem_1fr] content-center items-center gap-x-4 gap-y-0.5 text-left"
              >
                <MessageCircle className="w-7 h-7 row-span-2 self-center justify-self-center" />
                <span className="text-xl font-semibold truncate flex items-center gap-3">
                  Submit a Ticket
                  {unreadTicketCount > 0 && (
                    <span className="min-w-[1.75rem] h-7 px-2 rounded-full bg-destructive text-destructive-foreground text-sm font-bold inline-flex items-center justify-center ring-2 ring-white/70">
                      {unreadTicketCount > 9 ? '9+' : unreadTicketCount}
                    </span>
                  )}
                </span>
                <span className="col-start-2 text-sm text-orange-100/90 font-normal truncate">
                  {unreadTicketCount > 0 ? 'New reply from Support' : 'Contact Snow Media Support'}
                </span>
              </Button>
              <Button
                onClick={() => setHelpView('remote')}
                variant="outline"
                size="lg"
                tabIndex={0}
                data-support-tv-focus-id="help-remote"
                className="bg-rose-700/60 border-rose-400/70 text-white hover:bg-rose-600/70 h-20 px-6 shadow-md grid grid-cols-[2.5rem_1fr] content-center items-center gap-x-4 gap-y-0.5 text-left"
              >
                <MonitorSmartphone className="w-7 h-7 row-span-2 self-center justify-self-center" />
                <span className="text-xl font-semibold truncate">Remote Access</span>
                <span className="col-start-2 text-sm text-rose-100/90 font-normal truncate">
                  A technician fixes your box live — $25
                </span>
              </Button>

            </div>
          </TabsContent>


          <TabsContent value="ai" className="mt-0">
            <Suspense fallback={null}>
              <ChatCommunity
                onBack={onBack}
                onNavigate={onNavigate}
                embedded
                lockedTab="ai"
              />
            </Suspense>
          </TabsContent>

          <TabsContent value="community" className="mt-0">
            <Suspense fallback={null}>
              <CommunityChat onBack={onBack} embedded />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>

      {showSpeedTest && <SpeedTest onClose={() => setShowSpeedTest(false)} />}
      {showGuide && (
        <BufferingGuide
          onClose={() => {
            setShowGuide(false);
            const origin = guideOrigin;
            try { sessionStorage.removeItem('smc-guide-origin'); } catch { /* ignore */ }
            setGuideOrigin(null);
            if (origin === 'plex-movie') {
              // PlexSection will consume 'smc-plex-deeplink' on mount and open
              // the movie's detail page — user presses Play to resume.
              onNavigate?.('livetv');
            }
          }}
          origin={guideOrigin}
          apps={apps}
          appStatuses={new Map()}
          onLaunch={launchApp}
          onDownload={downloadApp}
          onOpenAppSettings={openAppSettings}
          onNavigateToChat={() => { setTab('help'); setHelpView('tickets'); }}

        />
      )}
      {showHowTo && (
        <Suspense fallback={null}>
          <HowToGuide onClose={() => setShowHowTo(false)} onNavigate={onNavigate} />
        </Suspense>
      )}
      {downloadingApp && (
        <DownloadProgress
          app={downloadingApp}
          onClose={() => setDownloadingApp(null)}
          onComplete={() => setDownloadingApp(null)}
        />
      )}

    </div>
  );
};

export default Support;
