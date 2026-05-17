import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Image, RefreshCw, AlertTriangle, Bot, Tv } from 'lucide-react';
import MediaManager from '@/components/MediaManager';
import AppUpdater from '@/components/AppUpdater';
import AppAlertsManager from '@/components/AppAlertsManager';
import ApkCacheViewer from '@/components/ApkCacheViewer';
import AdminAIPanel from '@/components/AdminAIPanel';
import { useAdminRole } from '@/hooks/useAdminRole';
import { useMediaBarEnabled } from '@/hooks/useMediaBarEnabled';

interface SettingsProps {
  onBack: () => void;
  layoutMode?: 'grid' | 'row';
  onLayoutChange?: (mode: 'grid' | 'row') => void;
}

type SettingsFocus =
  | 'back'
  | 'tab-media'
  | 'tab-updates'
  | 'tab-alerts'
  | 'media-content'
  | 'updates-content'
  | 'alerts-content';

const Settings = ({ onBack }: SettingsProps) => {
  const { isAdmin } = useAdminRole();
  const [mediaBarEnabled, setMediaBarEnabledState] = useMediaBarEnabled();
  const [activeTab, setActiveTab] = useState('media');
  const [focusedElement, setFocusedElement] = useState<SettingsFocus>('back');
  const [mediaManagerActive, setMediaManagerActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMediaManagerActive(false);
  }, [activeTab]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (mediaManagerActive) {
        if (event.key === 'Escape' || event.key === 'Backspace' ||
            event.keyCode === 4 || event.which === 4) {
          const target = event.target as HTMLElement;
          const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
          if (isTyping && event.key === 'Backspace') return;
        }
        return;
      }

      if (focusedElement === 'updates-content') {
        if (event.key === 'ArrowUp') {
          const active = document.activeElement as HTMLElement | null;
          if (active?.matches('[data-app-updater-btn="check"]') ||
              active?.matches('[data-app-updater-btn="download"]')) {
            event.preventDefault();
            event.stopPropagation();
            setFocusedElement('tab-updates');
          }
          return;
        }
        if (event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 4) {
          event.preventDefault();
          event.stopPropagation();
          setFocusedElement('tab-updates');
          return;
        }
        if (event.key === 'ArrowDown') {
          const active = document.activeElement as HTMLElement | null;
          if (active?.matches('[data-app-updater-btn="check"]') ||
              active?.matches('[data-app-updater-btn="download"]')) {
            event.preventDefault();
            event.stopPropagation();
            const apkBtn = document.querySelector('[data-apk-cache-first]') as HTMLElement | null;
            if (apkBtn) {
              apkBtn.focus();
              apkBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
          }
          return;
        }
        return;
      }

      const target = event.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (event.key === 'Escape' || event.keyCode === 4 || event.code === 'GoBack' ||
          (event.key === 'Backspace' && !isTyping)) {
        event.preventDefault();
        event.stopPropagation();
        onBack();
        return;
      }

      if (event.key === 'Backspace' && isTyping) return;
      if (isTyping) return;

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }

      const tabs: SettingsFocus[] = isAdmin
        ? ['tab-media', 'tab-updates', 'tab-alerts']
        : ['tab-media', 'tab-updates'];
      const currentTabIdx = tabs.indexOf(focusedElement as SettingsFocus);

      switch (event.key) {
        case 'ArrowLeft':
          if (currentTabIdx > 0) setFocusedElement(tabs[currentTabIdx - 1]);
          break;
        case 'ArrowRight':
          if (currentTabIdx >= 0 && currentTabIdx < tabs.length - 1) {
            setFocusedElement(tabs[currentTabIdx + 1]);
          }
          break;
        case 'ArrowUp':
          if (currentTabIdx >= 0) setFocusedElement('back');
          break;
        case 'ArrowDown':
          if (focusedElement === 'back') {
            setFocusedElement('tab-media');
          } else if (focusedElement === 'tab-media' && activeTab === 'media') {
            setMediaManagerActive(true);
          } else if (focusedElement === 'tab-updates' && activeTab === 'updates') {
            setFocusedElement('updates-content');
            setTimeout(() => {
              const btn = document.querySelector('[data-app-updater-btn="check"]') as HTMLElement | null;
              btn?.focus();
              btn?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 30);
          } else if (focusedElement === 'tab-alerts' && activeTab === 'alerts') {
            setFocusedElement('alerts-content');
          }
          break;
        case 'Enter':
        case ' ':
          if (focusedElement === 'back') onBack();
          else if (focusedElement === 'tab-media') setActiveTab('media');
          else if (focusedElement === 'tab-updates') setActiveTab('updates');
          else if (focusedElement === 'tab-alerts') setActiveTab('alerts');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [focusedElement, activeTab, onBack, mediaManagerActive, isAdmin]);

  useEffect(() => {
    const scrollAllToTop = () => {
      containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      document
        .querySelectorAll<HTMLElement>('.tv-scroll-container')
        .forEach((el) => el.scrollTo({ top: 0, behavior: 'smooth' }));
    };

    if (focusedElement === 'back' || focusedElement.startsWith('tab-')) {
      const topAnchor = document.getElementById('settings-top');
      topAnchor?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      scrollAllToTop();
      return;
    }

    const el = document.querySelector(`[data-settings-focus="${focusedElement}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusedElement]);

  const isFocused = (id: string) => focusedElement === id && !mediaManagerActive;
  const focusRing = (id: string) => isFocused(id)
    ? 'scale-110 ring-4 ring-brand-gold shadow-[0_0_28px_rgba(255,200,80,0.85)] brightness-125 z-10'
    : '';

  const handleMediaManagerBack = () => {
    setMediaManagerActive(false);
    setFocusedElement('tab-media');
  };

  const tabColsClass = isAdmin ? 'grid-cols-4' : 'grid-cols-2';

  return (
    <div ref={containerRef} className="tv-scroll-container tv-safe text-white" style={{ paddingTop: '2vh' }}>
      <div className="max-w-4xl mx-auto pb-16">
        <div id="settings-top" className="scroll-mt-4" />
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-start w-full">
            <Button
              data-settings-focus="back"
              onClick={onBack}
              variant="gold"
              size="lg"
              className={`transition-all duration-200 ${focusRing('back')}`}
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back to Home
            </Button>
          </div>
          <div className="text-center mt-4">
            <h1 className="text-4xl font-bold text-white mb-2">Settings</h1>
            <p className="text-xl text-blue-200">Customize your Snow Media Center experience</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className={`grid w-full ${tabColsClass} bg-slate-800/50 border-slate-600`}>
            <TabsTrigger
              data-settings-focus="tab-media"
              value="media"
              className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${focusRing('tab-media')}`}
            >
              <Image className="w-4 h-4 mr-2" />
              Media Manager
            </TabsTrigger>
            <TabsTrigger
              data-settings-focus="tab-updates"
              value="updates"
              className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${focusRing('tab-updates')}`}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Updates
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger
                data-settings-focus="tab-alerts"
                value="alerts"
                className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${focusRing('tab-alerts')}`}
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                App Alerts
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger
                value="ai"
                className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200`}
              >
                <Bot className="w-4 h-4 mr-2" />
                AI
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="media" className="mt-6">
            <Card className="bg-gradient-to-br from-purple-600 to-purple-800 border-purple-500 p-6">
              <h2 className="text-2xl font-bold text-white mb-6">Media Manager</h2>
              <MediaManager
                onBack={handleMediaManagerBack}
                embedded={true}
                isActive={mediaManagerActive}
              />
            </Card>
          </TabsContent>

          <TabsContent value="updates" className="mt-6 space-y-4">
            <Card className="bg-gradient-to-br from-orange-600 to-orange-800 border-orange-500 p-6">
              <AppUpdater />
            </Card>

            <ApkCacheViewer />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="alerts" className="mt-6">
              <Card data-settings-focus="alerts-content" className="bg-gradient-to-br from-yellow-700 to-yellow-900 border-yellow-600 p-6">
                <AppAlertsManager />
              </Card>
            </TabsContent>
          )}
          {isAdmin && (
            <TabsContent value="ai" className="mt-6">
              <AdminAIPanel />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
};

export default Settings;
