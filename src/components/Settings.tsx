import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Layout, Image, RefreshCw } from 'lucide-react';
import MediaManager from '@/components/MediaManager';
import AppUpdater from '@/components/AppUpdater';

interface SettingsProps {
  onBack: () => void;
  layoutMode: 'grid' | 'row';
  onLayoutChange: (mode: 'grid' | 'row') => void;
}

// Focus states: Settings owns all navigation, MediaManager is passive when embedded
type SettingsFocus = 
  | 'back' 
  | 'tab-layout' 
  | 'tab-media' 
  | 'tab-updates' 
  | 'layout-toggle'
  | 'media-content'; // When in media tab, this signals MediaManager should handle focus

const Settings = ({ onBack, layoutMode, onLayoutChange }: SettingsProps) => {
  const [activeTab, setActiveTab] = useState('layout');
  const [focusedElement, setFocusedElement] = useState<SettingsFocus>('back');
  const [mediaManagerActive, setMediaManagerActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // When tab changes, reset focus appropriately
  useEffect(() => {
    if (activeTab === 'media') {
      // Don't immediately enter media manager - let user press down first
      setMediaManagerActive(false);
    } else {
      setMediaManagerActive(false);
    }
  }, [activeTab]);

  // Main navigation handler for Settings shell
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // If MediaManager is active, only intercept global back to allow hierarchical exit
      if (mediaManagerActive) {
        if (event.key === 'Escape' || event.key === 'Backspace' || 
            event.keyCode === 4 || event.which === 4) {
          const target = event.target as HTMLElement;
          const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
          if (isTyping && event.key === 'Backspace') return; // Allow typing
          
          // MediaManager will call handleMediaManagerBack when it wants to exit
          // Don't intercept here - let MediaManager handle first
        }
        return; // Let MediaManager handle all other navigation
      }

      const target = event.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      
      // Handle back button globally - hierarchical exit
      if (event.key === 'Escape' || event.keyCode === 4 || event.code === 'GoBack' ||
          (event.key === 'Backspace' && !isTyping)) {
        event.preventDefault();
        event.stopPropagation();
        
        // If on a tab content element, go back to tab first
        if (focusedElement === 'layout-toggle') {
          setFocusedElement('tab-layout');
          return;
        }
        
        // Otherwise exit Settings entirely
        onBack();
        return;
      }
      
      // Allow Backspace when typing
      if (event.key === 'Backspace' && isTyping) {
        return;
      }
      
      // Skip when typing
      if (isTyping) {
        return;
      }
      
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }

      const tabs: SettingsFocus[] = ['tab-layout', 'tab-media', 'tab-updates'];
      const currentTabIdx = tabs.indexOf(focusedElement as SettingsFocus);
      
      switch (event.key) {
        case 'ArrowLeft':
          if (currentTabIdx > 0) {
            setFocusedElement(tabs[currentTabIdx - 1]);
          } else if (focusedElement === 'layout-toggle') {
            setFocusedElement('tab-layout');
          }
          break;
          
        case 'ArrowRight':
          if (currentTabIdx >= 0 && currentTabIdx < tabs.length - 1) {
            setFocusedElement(tabs[currentTabIdx + 1]);
          }
          break;
          
        case 'ArrowUp':
          if (focusedElement === 'layout-toggle') {
            setFocusedElement('tab-layout');
          } else if (currentTabIdx >= 0) {
            setFocusedElement('back');
          }
          break;
          
        case 'ArrowDown':
          if (focusedElement === 'back') {
            setFocusedElement('tab-layout');
          } else if (focusedElement === 'tab-layout' && activeTab === 'layout') {
            setFocusedElement('layout-toggle');
          } else if (focusedElement === 'tab-media' && activeTab === 'media') {
            // Enter MediaManager mode
            setMediaManagerActive(true);
          }
          break;
          
        case 'Enter':
        case ' ':
          if (focusedElement === 'back') {
            onBack();
          } else if (focusedElement === 'tab-layout') {
            setActiveTab('layout');
          } else if (focusedElement === 'tab-media') {
            setActiveTab('media');
          } else if (focusedElement === 'tab-updates') {
            setActiveTab('updates');
          } else if (focusedElement === 'layout-toggle') {
            onLayoutChange(layoutMode === 'grid' ? 'row' : 'grid');
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [focusedElement, activeTab, layoutMode, onBack, onLayoutChange, mediaManagerActive]);

  // Scroll focused element into view
  useEffect(() => {
    if (focusedElement === 'back' || focusedElement.startsWith('tab-')) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const el = document.querySelector(`[data-settings-focus="${focusedElement}"]`);
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [focusedElement]);

  const isFocused = (id: string) => focusedElement === id && !mediaManagerActive;
  const focusRing = (id: string) => isFocused(id) ? 'ring-4 ring-brand-ice ring-offset-2 ring-offset-slate-800 scale-105' : '';

  // Callback when MediaManager wants to exit back to Settings tabs
  const handleMediaManagerBack = () => {
    setMediaManagerActive(false);
    setFocusedElement('tab-media');
  };

  return (
    <div ref={containerRef} className="tv-scroll-container tv-safe text-white">
      <div className="max-w-4xl mx-auto pb-16">
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
          <TabsList className="grid w-full grid-cols-3 bg-slate-800/50 border-slate-600">
            <TabsTrigger 
              data-settings-focus="tab-layout"
              value="layout" 
              className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${focusRing('tab-layout')}`}
            >
              <Layout className="w-4 h-4 mr-2" />
              Layout
            </TabsTrigger>
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
          </TabsList>

          <TabsContent value="layout" className="mt-6">
            <Card className="bg-gradient-to-br from-blue-600 to-blue-800 border-blue-500 p-6">
              <h2 className="text-2xl font-bold text-white mb-6">Home Screen Layout</h2>
              
               <div className="flex items-center justify-center">
                 <div 
                   data-settings-focus="layout-toggle"
                   className={`flex bg-slate-800 rounded-lg p-2 cursor-pointer transition-all duration-200 hover:bg-slate-700 ${focusRing('layout-toggle')}`}
                   onClick={() => onLayoutChange(layoutMode === 'grid' ? 'row' : 'grid')}
                >
                  {/* Grid Layout Option */}
                  <div className={`flex flex-col items-center justify-center p-4 rounded-md transition-all duration-200 ${
                    layoutMode === 'grid' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}>
                    <div className="grid grid-cols-2 gap-1 mb-2">
                      <div className="w-3 h-3 bg-current rounded-sm opacity-80"></div>
                      <div className="w-3 h-3 bg-current rounded-sm opacity-80"></div>
                      <div className="w-3 h-3 bg-current rounded-sm opacity-80"></div>
                      <div className="w-3 h-3 bg-current rounded-sm opacity-80"></div>
                    </div>
                    <span className="text-xs font-medium">Grid</span>
                  </div>

                  {/* Divider */}
                  <div className="w-px bg-slate-600 mx-2 my-2"></div>

                  {/* Row Layout Option */}
                  <div className={`flex flex-col items-center justify-center p-4 rounded-md transition-all duration-200 ${
                    layoutMode === 'row' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}>
                    <div className="flex gap-1 mb-2">
                      <div className="w-3 h-3 bg-current rounded-sm opacity-80"></div>
                      <div className="w-3 h-3 bg-current rounded-sm opacity-80"></div>
                      <div className="w-3 h-3 bg-current rounded-sm opacity-80"></div>
                      <div className="w-3 h-3 bg-current rounded-sm opacity-80"></div>
                    </div>
                    <span className="text-xs font-medium">Row</span>
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>

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

          <TabsContent value="updates" className="mt-6">
            <Card className="bg-gradient-to-br from-orange-600 to-orange-800 border-orange-500 p-6">
              <AppUpdater />
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Settings;