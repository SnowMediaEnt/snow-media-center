import { useState, useEffect, lazy, Suspense, useCallback, useMemo } from 'react';
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
} from 'lucide-react';
import SpeedTest from '@/components/SpeedTest';
import BufferingGuide from '@/components/BufferingGuide';
import { useAppData } from '@/hooks/useAppData';
import { useToast } from '@/hooks/use-toast';
import { generatePackageName } from '@/utils/downloadApk';
import type { AppData } from '@/hooks/useAppData';
import { useTVFocus, TVFocusNavigationMap } from '@/hooks/useTVFocus';

const SupportVideos = lazy(() => import('@/components/SupportVideos'));
const SupportTicketSystem = lazy(() => import('@/components/SupportTicketSystem'));
const CommunityChat = lazy(() => import('@/components/CommunityChat'));
const ChatCommunity = lazy(() => import('@/components/ChatCommunity'));

interface SupportProps {
  onBack: () => void;
  onNavigate?: (section: string) => void;
  onOpenMainApps?: () => void;
}

type Tab = 'help' | 'ai' | 'community';
type HelpView = 'menu' | 'videos' | 'tickets';

const Support = ({ onBack, onNavigate }: SupportProps) => {
  const [tab, setTab] = useState<Tab>('help');
  const [helpView, setHelpView] = useState<HelpView>('menu');
  const [showSpeedTest, setShowSpeedTest] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [downloadingApp, setDownloadingApp] = useState<AppData | null>(null);
  const { apps } = useAppData();
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
      await AppManager.launch({ packageName });
    } catch (err) {
      console.error('[Support] launch failed:', err);
      toast({ title: 'Launch failed', description: `Could not launch ${app.name}.`, variant: 'destructive' });
    }
  }, [toast]);

  const openAppSettings = useCallback(async (app: AppData) => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { AppManager } = await import('@/capacitor/AppManager');
      const packageName = app.packageName || generatePackageName(app.name);
      await AppManager.openAppSettings({ packageName });
    } catch (err) {
      console.error('[Support] openAppSettings failed:', err);
    }
  // Download in place (mirrors Main Apps) so the user stays inside the
  // Buffering Guide and doesn't lose their progress mid-flow.
  const downloadApp = useCallback((app: AppData) => {
    setDownloadingApp(app);
  }, []);

    onNavigate?.('apps');
  }, [onNavigate, toast]);


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
      const input = document.querySelector<HTMLElement>('[data-focus-id="ai-input"]');
      window.dispatchEvent(new CustomEvent('chat-community:focus-ai-input'));
      if (input) {
        input.focus({ preventScroll: true });
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }
    }
    if (childTab === 'community') {
      const room = document.querySelector<HTMLElement>('[data-tv-focus-id="room-general"]');
      if (room) {
        room.focus({ preventScroll: true });
        room.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }
    }
    return false;
  }, []);

  const supportNavigation = useMemo<TVFocusNavigationMap>(() => ({
    'support-back': { down: `tab-${tab}` },
    'tab-help': { up: 'support-back', right: 'tab-ai', left: 'tab-community', down: 'help-speedtest' },
    'tab-ai': {
      up: 'support-back', right: 'tab-community', left: 'tab-help',
      down: () => { focusIntoChild('ai'); return null; },
    },
    'tab-community': {
      up: 'support-back', right: 'tab-help', left: 'tab-ai',
      down: () => { focusIntoChild('community'); return null; },
    },
    'help-speedtest': { up: 'tab-help', down: 'help-guide' },
    'help-guide': { up: 'help-speedtest', down: 'help-videos' },
    'help-videos': { up: 'help-guide', down: 'help-tickets' },
    'help-tickets': { up: 'help-videos' },
  }), [tab, focusIntoChild]);

  // When a sub-view (videos / tickets) or overlay (speedtest / guide) is open,
  // the child component owns D-pad + Back. Disabling the parent focus manager
  // here prevents its Back handler from firing first and exiting Support
  // straight to the Home screen.
  const supportFocusActive = !showSpeedTest && !showGuide && helpView === 'menu';
  const supportFocus = useTVFocus({
    initialFocusId: `tab-${tab}`,
    focusableSelector: '[data-support-tv-focus-id]',
    navigation: supportNavigation,
    onBack,
    enabled: supportFocusActive,
  });


  useEffect(() => {
    if (showSpeedTest || showGuide || helpView !== 'menu') return;
    const timer = window.setTimeout(() => supportFocus.focusById(`tab-${tab}`), 80);
    return () => window.clearTimeout(timer);
  }, [helpView, showGuide, showSpeedTest, supportFocus.focusById, tab]);

  // Listen for "escape up" requests from embedded child components so they
  // can hand focus back to the Support tab row via the D-pad.
  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent<{ tab?: Tab }>).detail?.tab ?? tab;
      supportFocus.focusById(`tab-${target}`);
    };
    const openTickets = () => { setTab('help'); setHelpView('tickets'); };
    window.addEventListener('support:focus-tab', handler as EventListener);
    window.addEventListener('support:open-tickets', openTickets);
    return () => {
      window.removeEventListener('support:focus-tab', handler as EventListener);
      window.removeEventListener('support:open-tickets', openTickets);
    };
  }, [supportFocus, tab]);


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

  return (
    <div ref={supportFocus.containerRef} className="tv-scroll-container tv-safe">
      <div className="max-w-6xl mx-auto pb-16">
        <div className="flex flex-col items-center mb-6">
          <div className="flex items-center w-full justify-start">
            <Button
              onClick={onBack}
              variant="gold"
              size="lg"
              data-support-tv-focus-id="support-back"
              className="transition-all duration-200"
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back to Home
            </Button>
          </div>
          <div className="text-center mt-4">
            <h1 className="text-4xl font-bold text-white mb-2">Support</h1>
            <p className="text-xl text-blue-200">
              Get help, chat with AI, or connect with the community
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="w-full">
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
            <div className="grid grid-cols-1 gap-4 max-w-2xl mx-auto">
              <Button
                onClick={() => setShowSpeedTest(true)}
                variant="outline"
                size="lg"
                tabIndex={0}
                data-support-tv-focus-id="help-speedtest"
                className="bg-cyan-700/60 border-cyan-400/70 text-white hover:bg-cyan-600/70 h-20 px-6 shadow-md grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 text-left"
              >
                <Gauge className="w-7 h-7 justify-self-center" />
                <span className="text-xl font-medium truncate">Speedtest</span>
                <span className="text-sm text-cyan-100 justify-self-end">
                  Test your internet speed
                </span>
              </Button>
              <Button
                onClick={() => setShowGuide(true)}
                variant="outline"
                size="lg"
                tabIndex={0}
                data-support-tv-focus-id="help-guide"
                className="bg-purple-700/60 border-purple-400/70 text-white hover:bg-purple-600/70 h-20 px-6 shadow-md grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 text-left"
              >
                <LifeBuoy className="w-7 h-7 justify-self-center" />
                <span className="text-xl font-medium truncate">Buffering Guide</span>
                <span className="text-sm text-purple-100 justify-self-end">
                  Step-by-step buffering fixes
                </span>
              </Button>
              <Button
                onClick={() => setHelpView('videos')}
                variant="outline"
                size="lg"
                tabIndex={0}
                data-support-tv-focus-id="help-videos"
                className="bg-blue-700/60 border-blue-400/70 text-white hover:bg-blue-600/70 h-20 px-6 shadow-md grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 text-left"
              >
                <Video className="w-7 h-7 justify-self-center" />
                <span className="text-xl font-medium truncate">Support Videos</span>
                <span className="text-sm text-blue-100 justify-self-end">
                  Tutorials and walkthroughs
                </span>
              </Button>
              <Button
                onClick={() => setHelpView('tickets')}
                variant="outline"
                size="lg"
                tabIndex={0}
                data-support-tv-focus-id="help-tickets"
                className="bg-orange-700/60 border-orange-400/70 text-white hover:bg-orange-600/70 h-20 px-6 shadow-md grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 text-left"
              >
                <MessageCircle className="w-7 h-7 justify-self-center" />
                <span className="text-xl font-medium truncate">Submit a Ticket</span>
                <span className="text-sm text-orange-100 justify-self-end">
                  Contact Snow Media Support
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
          onClose={() => setShowGuide(false)}
          apps={apps}
          appStatuses={new Map()}
          onLaunch={launchApp}
          onDownload={downloadApp}
          onOpenAppSettings={openAppSettings}
          onNavigateToChat={() => { setTab('help'); setHelpView('tickets'); }}

        />
      )}
    </div>
  );
};

export default Support;
