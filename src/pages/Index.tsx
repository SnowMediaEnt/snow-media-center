
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Package, Store, Video, MessageCircle } from 'lucide-react';
import NewsTicker from '@/components/NewsTicker';
import InstallApps from '@/components/InstallApps';
import MediaStore from '@/components/MediaStore';
import SupportVideos from '@/components/SupportVideos';
import ChatCommunity from '@/components/ChatCommunity';

const Index = () => {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [focusedButton, setFocusedButton] = useState(0);

  // Handle keyboard navigation for TV remote
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeSection) return; // Don't handle navigation when in a section
      
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          setFocusedButton((prev) => prev === 1 ? 3 : prev === 0 ? 1 : prev);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          setFocusedButton((prev) => prev === 0 ? 1 : prev === 3 ? 1 : prev === 1 ? 0 : 2);
          break;
        case 'ArrowDown':
          event.preventDefault();
          setFocusedButton((prev) => prev < 2 ? prev + 2 : prev);
          break;
        case 'ArrowUp':
          event.preventDefault();
          setFocusedButton((prev) => prev >= 2 ? prev - 2 : prev);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          handleButtonClick(focusedButton);
          break;
        case 'Escape':
          if (activeSection) {
            setActiveSection(null);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSection, focusedButton]);

  const handleButtonClick = (index: number) => {
    const sections = ['install-apps', 'media-store', 'support-videos', 'chat-community'];
    setActiveSection(sections[index]);
  };

  const buttons = [
    {
      icon: Package,
      title: 'Install Apps',
      description: 'Download APKs & Streaming Tools',
      color: 'from-blue-600 to-blue-800'
    },
    {
      icon: Store,
      title: 'Snow Media Store',
      description: 'Visit Official Store',
      color: 'from-purple-600 to-purple-800'
    },
    {
      icon: Video,
      title: 'Support Videos',
      description: 'Help & Tutorial Videos',
      color: 'from-green-600 to-green-800'
    },
    {
      icon: MessageCircle,
      title: 'Chat & Community',
      description: 'Connect with Admin & Users',
      color: 'from-orange-600 to-orange-800'
    }
  ];

  if (activeSection) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        {activeSection === 'install-apps' && <InstallApps onBack={() => setActiveSection(null)} />}
        {activeSection === 'media-store' && <MediaStore onBack={() => setActiveSection(null)} />}
        {activeSection === 'support-videos' && <SupportVideos onBack={() => setActiveSection(null)} />}
        {activeSection === 'chat-community' && <ChatCommunity onBack={() => setActiveSection(null)} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(56,189,248,0.1),transparent_50%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(56,189,248,0.05)_25%,rgba(56,189,248,0.05)_50%,transparent_50%,transparent_75%,rgba(56,189,248,0.05)_75%)] bg-[length:60px_60px]" />
      </div>

      {/* Header */}
      <div className="relative z-10 pt-8 pb-4">
        <div className="text-center">
          <h1 className="text-6xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-2">
            SNOW MEDIA CENTER
          </h1>
          <p className="text-xl text-blue-200">TV Optimized Entertainment Hub</p>
        </div>
      </div>

      {/* News Ticker */}
      <NewsTicker />

      {/* Main Grid */}
      <div className="relative z-10 px-16 py-8">
        <div className="grid grid-cols-2 gap-8 max-w-6xl mx-auto">
          {buttons.map((button, index) => {
            const Icon = button.icon;
            const isFocused = focusedButton === index;
            
            return (
              <Card
                key={index}
                className={`
                  relative overflow-hidden cursor-pointer transition-all duration-300 transform
                  ${isFocused 
                    ? 'scale-105 ring-4 ring-blue-400 shadow-2xl shadow-blue-500/25' 
                    : 'hover:scale-102 shadow-lg'
                  }
                  bg-gradient-to-br ${button.color} border-0 h-48
                `}
                onClick={() => handleButtonClick(index)}
              >
                <div className="absolute inset-0 bg-black/20" />
                <div className="relative z-10 p-8 h-full flex flex-col items-center justify-center text-center">
                  <Icon 
                    size={64} 
                    className={`mb-4 transition-all duration-300 ${
                      isFocused ? 'text-white scale-110' : 'text-white/90'
                    }`} 
                  />
                  <h3 className="text-2xl font-bold mb-2 text-white">
                    {button.title}
                  </h3>
                  <p className="text-lg text-white/80">
                    {button.description}
                  </p>
                </div>
                
                {/* Focus indicator */}
                {isFocused && (
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-400/20 to-purple-400/20 animate-pulse" />
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* Footer Instructions */}
      <div className="relative z-10 text-center pb-8">
        <p className="text-blue-200/60 text-lg">
          Use remote D-pad to navigate • Enter to select • Back to return
        </p>
      </div>
    </div>
  );
};

export default Index;
