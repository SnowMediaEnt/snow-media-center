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
          <TabsList className="grid w-full grid-cols-3 mb-6 bg-slate-800/50 border-slate-600">
            <TabsTrigger
              value="help"
              className="text-white data-[state=active]:bg-brand-gold text-center text-lg py-3"
            >
              <HelpCircle className="w-5 h-5 mr-2" />
              Help
            </TabsTrigger>
            <TabsTrigger
              value="ai"
              className="text-white data-[state=active]:bg-purple-600 text-center text-lg py-3"
            >
              <Brain className="w-5 h-5 mr-2" />
              AI Chat
            </TabsTrigger>
            <TabsTrigger
              value="community"
              className="text-white data-[state=active]:bg-green-600 text-center text-lg py-3"
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
                className="bg-cyan-600/20 border-cyan-500/50 text-cyan-100 hover:bg-cyan-600/30 justify-start text-xl py-8"
              >
                <Gauge className="w-7 h-7 mr-4" />
                Speedtest
                <span className="ml-auto text-sm text-cyan-200/70">
                  Test your internet speed
                </span>
              </Button>
              <Button
                onClick={() => setShowGuide(true)}
                variant="outline"
                size="lg"
                tabIndex={0}
                className="bg-purple-600/20 border-purple-500/50 text-purple-100 hover:bg-purple-600/30 justify-start text-xl py-8"
              >
                <LifeBuoy className="w-7 h-7 mr-4" />
                Buffering Guide
                <span className="ml-auto text-sm text-purple-200/70">
                  Step-by-step buffering fixes
                </span>
              </Button>
              <Button
                onClick={() => setHelpView('videos')}
                variant="outline"
                size="lg"
                tabIndex={0}
                className="bg-blue-600/20 border-blue-500/50 text-blue-100 hover:bg-blue-600/30 justify-start text-xl py-8"
              >
                <Video className="w-7 h-7 mr-4" />
                Support Videos
                <span className="ml-auto text-sm text-blue-200/70">
                  Tutorials and walkthroughs
                </span>
              </Button>
              <Button
                onClick={() => setHelpView('tickets')}
                variant="outline"
                size="lg"
                tabIndex={0}
                className="bg-orange-600/20 border-orange-500/50 text-orange-100 hover:bg-orange-600/30 justify-start text-xl py-8"
              >
                <MessageCircle className="w-7 h-7 mr-4" />
                Submit a Ticket
                <span className="ml-auto text-sm text-orange-200/70">
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
              <CommunityChat onBack={onBack} />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>

      {showSpeedTest && <SpeedTest onClose={() => setShowSpeedTest(false)} />}
      {showGuide && <BufferingGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
};

export default Support;
