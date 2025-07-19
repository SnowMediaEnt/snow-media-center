import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Layout, Image, Grid2X2, RectangleHorizontal } from 'lucide-react';
import MediaManager from '@/components/MediaManager';

interface SettingsProps {
  onBack: () => void;
  layoutMode: 'grid' | 'row';
  onLayoutChange: (mode: 'grid' | 'row') => void;
}

const Settings = ({ onBack, layoutMode, onLayoutChange }: SettingsProps) => {
  const [activeTab, setActiveTab] = useState('layout');

  if (activeTab === 'media') {
    return <MediaManager onBack={() => setActiveTab('layout')} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center w-full justify-between">
            <Button 
              onClick={onBack}
              variant="gold" 
              size="lg"
              className=""
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back to Home
            </Button>
            <div className="invisible">
              <Button variant="gold" size="lg">Placeholder</Button>
            </div>
          </div>
          <div className="text-center mt-4">
            <h1 className="text-4xl font-bold text-white mb-2">Settings</h1>
            <p className="text-xl text-blue-200">Customize your Snow Media Center experience</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-slate-800/50 border-slate-600">
            <TabsTrigger value="layout" className="data-[state=active]:bg-brand-gold text-center">
              <Layout className="w-4 h-4 mr-2" />
              Layout
            </TabsTrigger>
            <TabsTrigger value="media" className="data-[state=active]:bg-brand-gold text-center">
              <Image className="w-4 h-4 mr-2" />
              Media Manager
            </TabsTrigger>
          </TabsList>

          <TabsContent value="layout" className="mt-6">
            <Card className="bg-gradient-to-br from-blue-600 to-blue-800 border-blue-500 p-6">
              <h2 className="text-2xl font-bold text-white mb-6">Home Screen Layout</h2>
              
              <div className="flex items-center justify-center">
                <div 
                  className="flex bg-slate-800 rounded-lg p-2 cursor-pointer transition-all duration-200 hover:bg-slate-700"
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
        </Tabs>
      </div>
    </div>
  );
};

export default Settings;