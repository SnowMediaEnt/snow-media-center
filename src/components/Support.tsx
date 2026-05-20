import { useState, useEffect, lazy, Suspense, useCallback } from 'react';
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
  }, []);

  const downloadApp = useCallback(() => {
    setShowGuide(false);
    toast({ title: 'Open Main Apps', description: 'Install the app from the Main Apps screen.' });
    onNavigate?.('apps');
  }, [onNavigate, toast]);


  // Hierarchical back: speedtest/guide overlays handled by their own onClose;
  // sub-views in Help tab pop back to the menu before exiting Support.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (e.key === 'Backspace' && isTyping) return;
      if (!(e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.code === 'GoBack')) return;

      if (showSpeedTest) {
        e.preventDefault(); e.stopPropagation();
        setShowSpeedTest(false);
        return;
      }
      if (showGuide) {
        e.preventDefault(); e.stopPropagation();
        setShowGuide(false);
        return;
      }
      if (tab === 'help' && helpView !== 'menu') {
        e.preventDefault(); e.stopPropagation();
        setHelpView('menu');
        return;
      }
      // Otherwise let CommunityChat / ChatCommunity / parent handle it
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [tab, helpView, showSpeedTest, showGuide]);

  // Focus the currently-selected tab trigger whenever `tab` changes.
  // Embedded sub-components (ChatCommunity / CommunityChat) auto-focus their
  // own internals on mount, which previously stole focus and left the user
  // with no visible cursor. We re-grab focus on the tab trigger across a few
  // animation frames to outrun that, so the glow stays visible and ArrowLeft/
  // Right keeps cycling tabs.
  useEffect(() => {
    if (showSpeedTest || showGuide) return;
    if (tab === 'help' && helpView !== 'menu') return;

    const focusTab = () => {
      const el = document.querySelector<HTMLElement>(`[data-focus-id="tab-${tab}"]`);
      if (el) {
        el.focus();
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    focusTab();
    const t1 = window.setTimeout(focusTab, 50);
    const t2 = window.setTimeout(focusTab, 200);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [tab, helpView, showSpeedTest, showGuide]);

  // D-pad navigation: ArrowLeft/Right cycles tabs from anywhere inside
  // Support; ArrowUp/Down moves through Help buttons when on the Help tab.
  useEffect(() => {
    if (showSpeedTest || showGuide) return;
    if (tab === 'help' && helpView !== 'menu') return;

    const tabIds: Tab[] = ['help', 'ai', 'community'];
    const helpIds = ['help-speedtest', 'help-guide', 'help-videos', 'help-tickets'];
    const supportOwnedIds = new Set(['support-back', ...helpIds, ...tabIds.map((id) => `tab-${id}`)]);

    const focusEl = (id: string) => {
      const el = document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
      if (el) {
        el.focus();
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };

    const handler = (e: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      // Never hijack typing fields
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;

      const currentId = target.getAttribute?.('data-focus-id');
      const onTab = currentId?.startsWith('tab-');
      const onHelp = !!currentId && helpIds.includes(currentId);

      // Left/Right cycles the Support tabs only while focus is on Support's
      // own chrome. Embedded screens (AI chat, community, tickets) keep their
      // own horizontal D-pad controls.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!currentId || !supportOwnedIds.has(currentId)) return;
        e.preventDefault();
        e.stopPropagation();
        const idx = Math.max(0, tabIds.indexOf(tab));
        const next = e.key === 'ArrowRight'
          ? (idx + 1) % tabIds.length
          : (idx - 1 + tabIds.length) % tabIds.length;
        setTab(tabIds[next]);
        requestAnimationFrame(() => focusEl(`tab-${tabIds[next]}`));
        return;
      }

      if (e.key === 'ArrowDown') {
        if (currentId === 'support-back') {
          e.preventDefault();
          focusEl(`tab-${tab}`);
          return;
        }
        if (onTab && tab === 'help') {
          e.preventDefault();
          focusEl(helpIds[0]);
          return;
        }
        if (onHelp) {
          e.preventDefault();
          const idx = helpIds.indexOf(currentId!);
          if (idx < helpIds.length - 1) focusEl(helpIds[idx + 1]);
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        if (onTab) {
          e.preventDefault();
          focusEl('support-back');
          return;
        }
        if (onHelp) {
          e.preventDefault();
          const idx = helpIds.indexOf(currentId!);
          if (idx > 0) focusEl(helpIds[idx - 1]);
          else focusEl(`tab-${tab}`);
        }
      }
    };
    // Capture phase so we intercept before embedded components handle it
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [tab, helpView, showSpeedTest, showGuide]);

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
    <div className="tv-scroll-container tv-safe">
      <div className="max-w-6xl mx-auto pb-16">
        <div className="flex flex-col items-center mb-6">
          <div className="flex items-center w-full justify-start">
            <Button
              onClick={onBack}
              variant="gold"
              size="lg"
              tabIndex={0}
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
          <TabsList className="grid w-full grid-cols-3 mb-6 bg-slate-800/50 border border-slate-600 p-1 gap-1 h-auto">
            <TabsTrigger
              value="help"
              data-focus-id="tab-help"
              className="text-white text-center text-lg py-3 min-w-0 transition-all duration-200 outline-none data-[state=active]:bg-brand-gold data-[state=active]:text-slate-900 data-[state=active]:shadow-[0_0_22px_rgba(255,200,60,0.65)] focus-visible:ring-4 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus:scale-105"
            >
              <HelpCircle className="w-5 h-5 mr-2" />
              Help
            </TabsTrigger>
            <TabsTrigger
              value="ai"
              data-focus-id="tab-ai"
              className="text-white text-center text-lg py-3 min-w-0 transition-all duration-200 outline-none data-[state=active]:bg-purple-600 data-[state=active]:shadow-[0_0_22px_rgba(168,85,247,0.7)] focus-visible:ring-4 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus:scale-105"
            >
              <Brain className="w-5 h-5 mr-2" />
              AI Chat
            </TabsTrigger>
            <TabsTrigger
              value="community"
              data-focus-id="tab-community"
              className="text-white text-center text-lg py-3 min-w-0 transition-all duration-200 outline-none data-[state=active]:bg-green-600 data-[state=active]:shadow-[0_0_22px_rgba(34,197,94,0.7)] focus-visible:ring-4 focus-visible:ring-green-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus:scale-105"
            >
              <MessageSquare className="w-5 h-5 mr-2" />
              Community
            </TabsTrigger>
          </TabsList>


          <TabsContent value="help" className="mt-0">
            <div className="flex flex-col gap-4 max-w-2xl mx-auto">
              <Button
                onClick={() => setShowSpeedTest(true)}
                variant="outline"
                size="lg"
                tabIndex={0}
                data-focus-id="help-speedtest"
                className="bg-cyan-700/60 border-cyan-400/70 text-white hover:bg-cyan-600/70 focus-visible:ring-2 focus-visible:ring-cyan-300 justify-start text-xl py-8 shadow-md"
              >
                <Gauge className="w-7 h-7 mr-4" />
                Speedtest
                <span className="ml-auto text-sm text-cyan-100">
                  Test your internet speed
                </span>
              </Button>
              <Button
                onClick={() => setShowGuide(true)}
                variant="outline"
                size="lg"
                tabIndex={0}
                data-focus-id="help-guide"
                className="bg-purple-700/60 border-purple-400/70 text-white hover:bg-purple-600/70 focus-visible:ring-2 focus-visible:ring-purple-300 justify-start text-xl py-8 shadow-md"
              >
                <LifeBuoy className="w-7 h-7 mr-4" />
                Buffering Guide
                <span className="ml-auto text-sm text-purple-100">
                  Step-by-step buffering fixes
                </span>
              </Button>
              <Button
                onClick={() => setHelpView('videos')}
                variant="outline"
                size="lg"
                tabIndex={0}
                data-focus-id="help-videos"
                className="bg-blue-700/60 border-blue-400/70 text-white hover:bg-blue-600/70 focus-visible:ring-2 focus-visible:ring-blue-300 justify-start text-xl py-8 shadow-md"
              >
                <Video className="w-7 h-7 mr-4" />
                Support Videos
                <span className="ml-auto text-sm text-blue-100">
                  Tutorials and walkthroughs
                </span>
              </Button>
              <Button
                onClick={() => setHelpView('tickets')}
                variant="outline"
                size="lg"
                tabIndex={0}
                data-focus-id="help-tickets"
                className="bg-orange-700/60 border-orange-400/70 text-white hover:bg-orange-600/70 focus-visible:ring-2 focus-visible:ring-orange-300 justify-start text-xl py-8 shadow-md"
              >
                <MessageCircle className="w-7 h-7 mr-4" />
                Submit a Ticket
                <span className="ml-auto text-sm text-orange-100">
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
          onNavigateToChat={() => setTab('ai')}
        />
      )}
    </div>
  );
};

export default Support;
