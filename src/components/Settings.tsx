
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Layout, Image, RefreshCw, Zap } from 'lucide-react';
import MediaManager from '@/components/MediaManager';
import AppUpdater from '@/components/AppUpdater';
import WixConnectionTest from '@/components/WixConnectionTest';

interface SettingsProps {
  onBack: () => void;
  layoutMode: 'grid' | 'row';
  onLayoutChange: (mode: 'grid' | 'row') => void;
}

const Settings = ({ onBack, layoutMode, onLayoutChange }: SettingsProps) => {
  const [activeTab, setActiveTab] = useState('layout');
  const [focusedElement, setFocusedElement] = useState(0); // 0: back button, 1-4: tabs, 5: layout toggle

  // Android TV/Firestick navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle Android back button and other back buttons
      if (event.key === 'Escape' || event.key === 'Backspace' || 
          event.keyCode === 4 || event.which === 4 || event.code === 'GoBack') {
        event.preventDefault();
        event.stopPropagation();
        onBack();
        return;
      }
      
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }
      
      switch (event.key) {
        case 'ArrowLeft':
          if (focusedElement === 5) {
            // From layout toggle back to layout tab
            setFocusedElement(1);
          } else if (focusedElement === 2) {
            // From media tab to layout tab
            setFocusedElement(1);
          } else if (focusedElement === 3) {
            // From wix tab to media tab
            setFocusedElement(2);
          } else if (focusedElement === 4) {
            // From updates tab to wix tab
            setFocusedElement(3);
          }
          break;
          
        case 'ArrowRight':
          if (focusedElement === 1) {
            // From layout tab to media tab
            setFocusedElement(2);
          } else if (focusedElement === 2) {
            // From media tab to wix tab
            setFocusedElement(3);
          } else if (focusedElement === 3) {
            // From wix tab to updates tab
            setFocusedElement(4);
          }
          break;
          
        case 'ArrowUp':
          if (focusedElement === 4) {
            // From layout toggle back to layout tab
            setFocusedElement(1);
          } else if (focusedElement >= 1 && focusedElement <= 3) {
            // From any tab to back button
            setFocusedElement(0);
          }
          break;
          
        case 'ArrowDown':
          if (focusedElement === 0) {
            // From back button to layout tab
            setFocusedElement(1);
          } else if (focusedElement === 1 && activeTab === 'layout') {
            // From layout tab down to layout toggle (only when on layout tab)
            setFocusedElement(4);
          }
          break;
          
        case 'Enter':
        case ' ':
          if (focusedElement === 0) {
            onBack();
          } else if (focusedElement === 1) {
            setActiveTab('layout');
          } else if (focusedElement === 2) {
            setActiveTab('media');
          } else if (focusedElement === 3) {
            setActiveTab('updates');
          } else if (focusedElement === 4 && activeTab === 'layout') {
            onLayoutChange(layoutMode === 'grid' ? 'row' : 'grid');
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedElement, activeTab, layoutMode, onBack, onLayoutChange]);

  // Update focused element when tab changes
  useEffect(() => {
    // When switching tabs via keyboard, keep focus on the tab
    if (focusedElement >= 1 && focusedElement <= 3) {
      if (activeTab === 'layout') setFocusedElement(1);
      else if (activeTab === 'media') setFocusedElement(2);
      else if (activeTab === 'updates') setFocusedElement(3);
    }
  }, [activeTab]);

  if (activeTab === 'media') {
    return <MediaManager onBack={() => setActiveTab('layout')} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-8" style={{ height: '100vh', maxHeight: '100vh', overflowY: 'auto' }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-start w-full">
            <Button 
              onClick={onBack}
              variant="gold" 
              size="lg"
              className={`transition-all duration-200 ${
                focusedElement === 0 ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
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
          <TabsList className="grid w-full grid-cols-4 bg-slate-800/50 border-slate-600">
            <TabsTrigger 
              value="layout" 
              className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${
                focusedElement === 1 ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
            >
              <Layout className="w-4 h-4 mr-2" />
              Layout
            </TabsTrigger>
            <TabsTrigger 
              value="media" 
              className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${
                focusedElement === 2 ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
            >
              <Image className="w-4 h-4 mr-2" />
              Media Manager
            </TabsTrigger>
            <TabsTrigger 
              value="wix" 
              className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${
                focusedElement === 3 ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
            >
              <Zap className="w-4 h-4 mr-2" />
              Wix Test
            </TabsTrigger>
            <TabsTrigger 
              value="updates" 
              className={`data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${
                focusedElement === 4 ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
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
                   className={`flex bg-slate-800 rounded-lg p-2 cursor-pointer transition-all duration-200 hover:bg-slate-700 ${
                     focusedElement === 5 ? 'ring-4 ring-white/60 scale-105' : ''
                   }`}
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
              <MediaManager onBack={() => setActiveTab('layout')} />
            </Card>
          </TabsContent>

          <TabsContent value="wix" className="mt-6">
            <Card className="bg-gradient-to-br from-green-600 to-green-800 border-green-500 p-6">
              <WixConnectionTest />
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
