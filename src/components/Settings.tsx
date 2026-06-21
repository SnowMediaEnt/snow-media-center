import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Image, RefreshCw, AlertTriangle, Bot, Tv, Sliders, Languages, Check } from 'lucide-react';
import MediaManager from '@/components/MediaManager';
import AppUpdater from '@/components/AppUpdater';
import AppAlertsManager from '@/components/AppAlertsManager';
import ApkCacheViewer from '@/components/ApkCacheViewer';
import AdminAIPanel from '@/components/AdminAIPanel';
import PlayerAccountCard from '@/components/PlayerAccountCard';
import { useAdminRole } from '@/hooks/useAdminRole';
import { useMediaBarEnabled } from '@/hooks/useMediaBarEnabled';
import { useFeatureFlag, setFeatureFlag } from '@/hooks/useFeatureFlag';
import { useToast } from '@/hooks/use-toast';
import { SUPPORTED_LANGUAGES, LANG_STORAGE_KEY } from '@/i18n';
import { useTenant } from '@/contexts/TenantContext';

interface SettingsProps {
  onBack: () => void;
  layoutMode?: 'grid' | 'row';
  onLayoutChange?: (mode: 'grid' | 'row') => void;
}

type SettingsFocus =
  | 'back'
  | 'tab-media'
  | 'tab-ui'
  | 'tab-updates'
  | 'tab-alerts'
  | 'media-content'
  | 'ui-content-bar-toggle'
  | 'updates-content'
  | 'alerts-content';

const Settings = ({ onBack }: SettingsProps) => {
  const { t, i18n } = useTranslation();
  const { isAdmin } = useAdminRole();
  const { isUniversalBuild, clearTenantCode, code: tenantCode } = useTenant();
  const [mediaBarEnabled, setMediaBarEnabledState] = useMediaBarEnabled();
  const { enabled: playerEnabled } = useFeatureFlag('player_enabled', true);
  const { toast } = useToast();
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
  const togglePlayer = async (next: boolean) => {
    try {
      await setFeatureFlag('player_enabled', next);
      toast({ title: next ? 'Player enabled' : 'Player disabled', description: 'Change applied to all devices.' });
    } catch (e) {
      toast({ title: 'Could not update', description: (e as Error).message, variant: 'destructive' });
    }
  };
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

      if (focusedElement === 'ui-content-bar-toggle') {
        if (event.key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation();
          setFocusedElement('tab-ui');
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); event.stopPropagation();
          setMediaBarEnabledState(!mediaBarEnabled);
          return;
        }
        if (event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 4) {
          event.preventDefault(); event.stopPropagation();
          setFocusedElement('tab-ui');
          return;
        }
        return;
      }

      if (focusedElement === 'updates-content') {
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
              apkBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          }
          return;
        }
        if (event.key === 'ArrowUp') {
          const active = document.activeElement as HTMLElement | null;
          const inApkCache = !!active?.closest('[data-apk-cache-root]');
          if (inApkCache) {
            event.preventDefault();
            event.stopPropagation();
            const checkBtn = document.querySelector('[data-app-updater-btn="check"], [data-app-updater-btn="download"]') as HTMLElement | null;
            if (checkBtn) {
              checkBtn.focus();
              checkBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
            return;
          }
          // Already on AppUpdater button — go back up to the tab row.
          if (active?.matches('[data-app-updater-btn="check"]') ||
              active?.matches('[data-app-updater-btn="download"]')) {
            event.preventDefault();
            event.stopPropagation();
            setFocusedElement('tab-updates');
            return;
          }
          // Fallback: any other focus inside updates content — go to tab row.
          event.preventDefault();
          event.stopPropagation();
          setFocusedElement('tab-updates');
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
        ? ['tab-media', 'tab-ui', 'tab-updates', 'tab-alerts']
        : ['tab-media', 'tab-ui', 'tab-updates'];
      const currentTabIdx = tabs.indexOf(focusedElement as SettingsFocus);

      const tabValueFor = (f: SettingsFocus): string | null => {
        if (f === 'tab-media') return 'media';
        if (f === 'tab-ui') return 'ui';
        if (f === 'tab-updates') return 'updates';
        if (f === 'tab-alerts') return 'alerts';
        return null;
      };

      switch (event.key) {
        case 'ArrowLeft':
          if (currentTabIdx > 0) {
            const next = tabs[currentTabIdx - 1];
            setFocusedElement(next);
            const v = tabValueFor(next);
            if (v) setActiveTab(v);
          }
          break;
        case 'ArrowRight':
          if (currentTabIdx >= 0 && currentTabIdx < tabs.length - 1) {
            const next = tabs[currentTabIdx + 1];
            setFocusedElement(next);
            const v = tabValueFor(next);
            if (v) setActiveTab(v);
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
          } else if (focusedElement === 'tab-ui' && activeTab === 'ui') {
            setFocusedElement('ui-content-bar-toggle');
            setTimeout(() => {
              const card = document.querySelector('[data-settings-focus="ui-content-bar-toggle"]') as HTMLElement | null;
              card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }, 30);
          } else if (focusedElement === 'tab-updates' && activeTab === 'updates') {
            setFocusedElement('updates-content');
            setTimeout(() => {
              const btn = document.querySelector('[data-app-updater-btn="check"]') as HTMLElement | null;
              btn?.focus();
              btn?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }, 30);
          } else if (focusedElement === 'tab-alerts' && activeTab === 'alerts') {
            setFocusedElement('alerts-content');
          }
          break;
        case 'Enter':
        case ' ':
          if (focusedElement === 'back') onBack();
          else if (focusedElement === 'tab-media') setActiveTab('media');
          else if (focusedElement === 'tab-ui') setActiveTab('ui');
          else if (focusedElement === 'tab-updates') setActiveTab('updates');
          else if (focusedElement === 'tab-alerts') setActiveTab('alerts');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [focusedElement, activeTab, onBack, mediaManagerActive, isAdmin, mediaBarEnabled, setMediaBarEnabledState]);

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
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedElement]);

  const isFocused = (id: string) => focusedElement === id && !mediaManagerActive;
  const backFocusRing = (id: string) => isFocused(id)
    ? 'scale-110 ring-4 ring-white shadow-[0_0_28px_rgba(255,255,255,0.85)] brightness-110 z-10'
    : '';
  const focusRing = (id: string) => isFocused(id)
    ? 'scale-110 ring-4 ring-brand-gold shadow-[0_0_28px_rgba(255,200,80,0.85)] brightness-125 z-10'
    : '';

  const handleMediaManagerBack = () => {
    setMediaManagerActive(false);
    setFocusedElement('tab-media');
  };

  const tabColsClass = isAdmin ? 'grid-cols-5' : 'grid-cols-3';

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
              className={`transition-all duration-200 ${backFocusRing('back')}`}
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              {t('common.backToHome')}
            </Button>
          </div>
          <div className="text-center mt-4">
            <h1 className="text-4xl font-bold text-white mb-2">{t('settings.title')}</h1>
            <p className="text-xl text-blue-200">{t('settings.subtitle')}</p>
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
              {t('settings.tabs.media')}
            </TabsTrigger>
            <TabsTrigger
              data-settings-focus="tab-ui"
              value="ui"
              className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${focusRing('tab-ui')}`}
            >
              <Sliders className="w-4 h-4 mr-2" />
              {t('settings.tabs.ui')}
            </TabsTrigger>
            <TabsTrigger
              data-settings-focus="tab-updates"
              value="updates"
              className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${focusRing('tab-updates')}`}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              {t('settings.tabs.updates')}
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger
                data-settings-focus="tab-alerts"
                value="alerts"
                className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${focusRing('tab-alerts')}`}
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                {t('settings.tabs.alerts')}
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger
                value="ai"
                className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200`}
              >
                <Bot className="w-4 h-4 mr-2" />
                {t('settings.tabs.ai')}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="media" className="mt-6">
            <Card className="bg-gradient-to-br from-purple-600 to-purple-800 border-purple-500 p-6">
              <h2 className="text-2xl font-bold text-white mb-6">{t('settings.mediaManagerHeading')}</h2>
              <MediaManager
                onBack={handleMediaManagerBack}
                embedded={true}
                isActive={mediaManagerActive}
              />
            </Card>
          </TabsContent>

          <TabsContent value="ui" className="mt-6 space-y-4">
            <PlayerAccountCard />
            <Card
              data-settings-focus="ui-content-bar-toggle"
              className={`bg-gradient-to-br from-slate-700 to-slate-900 border-slate-600 p-6 transition-transform duration-150 ${
                focusedElement === 'ui-content-bar-toggle'
                  ? 'scale-[1.02] shadow-[0_0_24px_hsl(var(--brand-gold)/0.7)] ring-2 ring-[hsl(var(--brand-gold))]'
                  : ''
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <Tv className="w-6 h-6 text-brand-gold mt-1 shrink-0" />
                  <div>
                    <h3 className="text-lg font-bold text-white">{t('settings.contentBar.title')}</h3>
                    <p className="text-sm text-white/70 mt-1">
                      {t('settings.contentBar.description')}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={mediaBarEnabled}
                  onCheckedChange={setMediaBarEnabledState}
                  aria-label={t('settings.contentBar.aria')}
                  className="mt-1"
                />
              </div>
            </Card>

            {isUniversalBuild && (
              <Card className="bg-gradient-to-br from-slate-700 to-slate-900 border-slate-600 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <Sliders className="w-6 h-6 text-brand-gold mt-1 shrink-0" />
                    <div>
                      <h3 className="text-lg font-bold text-white">Change reseller code</h3>
                      <p className="text-sm text-white/70 mt-1">
                        Currently active: <span className="font-mono text-brand-gold">{tenantCode}</span>. Clearing returns you to the code-entry screen on next launch.
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => { clearTenantCode(); window.location.reload(); }}
                    className="bg-slate-800 border-slate-500 text-white hover:bg-slate-700"
                  >
                    Change
                  </Button>
                </div>
              </Card>
            )}

            {isAdmin && (
              <Card className="bg-gradient-to-br from-slate-700 to-slate-900 border-slate-600 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <Tv className="w-6 h-6 text-brand-gold mt-1 shrink-0" />
                    <div>
                      <h3 className="text-lg font-bold text-white">{t('settings.player.title')}</h3>
                      <p className="text-sm text-white/70 mt-1">
                        {t('settings.player.description')}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={playerEnabled}
                    onCheckedChange={togglePlayer}
                    aria-label={t('settings.player.aria')}
                    className="mt-1"
                  />
                </div>
              </Card>
            )}

            {isAdmin && (
              <Card className="bg-gradient-to-br from-slate-700 to-slate-900 border-slate-600 p-6">
                <div className="flex items-start gap-3 mb-4">
                  <Languages className="w-6 h-6 text-brand-gold mt-1 shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-white">{t('settings.language.title')}</h3>
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-400/40">
                        {t('common.beta')}
                      </span>
                    </div>
                    <p className="text-sm text-white/70 mt-1">{t('settings.language.description')}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SUPPORTED_LANGUAGES.map((lang) => {
                    const selected = currentLang.startsWith(lang.code);
                    return (
                      <button
                        key={lang.code}
                        type="button"
                        onClick={() => handleLanguageSelect(lang.code)}
                        tabIndex={0}
                        dir={lang.code === 'ar' ? 'rtl' : 'ltr'}
                        className={`tv-focusable flex items-center justify-between gap-2 px-4 py-3 rounded-md border text-base transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:scale-[1.04] ${
                          selected
                            ? 'bg-brand-gold/20 border-brand-gold text-white'
                            : 'bg-slate-800 border-slate-500/60 text-slate-100 hover:bg-slate-700'
                        }`}
                      >
                        <span className="font-medium">{lang.nativeName}</span>
                        {selected && <Check className="w-4 h-4 text-brand-gold shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </Card>
            )}
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
