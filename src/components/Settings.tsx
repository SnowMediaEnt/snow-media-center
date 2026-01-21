
import { useState, useEffect } from 'react';
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

type FocusType = 'back' | 'tab-layout' | 'tab-media' | 'tab-updates' | 'layout-toggle';

const Settings = ({ onBack, layoutMode, onLayoutChange }: SettingsProps) => {
  const [activeTab, setActiveTab] = useState('layout');
  const [focusedElement, setFocusedElement] = useState<FocusType>('back');

  // Android TV/Firestick navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip navigation handling when user is typing in an input or textarea
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      
      // Handle Android back button and other back buttons (but not Backspace when typing)
      if (event.key === 'Escape' || event.keyCode === 4 || event.which === 4 || event.code === 'GoBack') {
        event.preventDefault();
        event.stopPropagation();
        onBack();
        return;
      }
      
      // Allow Backspace when typing
      if (event.key === 'Backspace' && isTyping) {
        return;
      }
      
      // Skip arrow/enter navigation when typing
      if (isTyping) {
        return;
      }
      
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }

      const tabs: FocusType[] = ['tab-layout', 'tab-media', 'tab-updates'];
      const currentTabIdx = tabs.indexOf(focusedElement as FocusType);
      
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedElement, activeTab, layoutMode, onBack, onLayoutChange]);

  // Scroll focused element into view
  useEffect(() => {
    const el = document.querySelector(`[data-focus-id="${focusedElement}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedElement]);

  const isFocused = (id: string) => focusedElement === id;
  const focusRing = (id: string) => isFocused(id) ? 'ring-4 ring-brand-ice ring-offset-2 ring-offset-slate-800 scale-105' : '';

  return (
    <div className="tv-scroll-container tv-safe text-white">
      <div className="max-w-4xl mx-auto pb-16">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-start w-full">
            <Button 
              data-focus-id="back"
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
              data-focus-id="tab-layout"
              value="layout" 
              className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${focusRing('tab-layout')}`}
            >
              <Layout className="w-4 h-4 mr-2" />
              Layout
            </TabsTrigger>
            <TabsTrigger 
              data-focus-id="tab-media"
              value="media" 
              className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${focusRing('tab-media')}`}
            >
              <Image className="w-4 h-4 mr-2" />
              Media Manager
            </TabsTrigger>
            <TabsTrigger 
              data-focus-id="tab-updates"
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
                   data-focus-id="layout-toggle"
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
              <MediaManager onBack={() => setActiveTab('layout')} />
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