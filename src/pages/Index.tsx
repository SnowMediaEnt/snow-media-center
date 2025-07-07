
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Package, Store, Video, MessageCircle, Settings as SettingsIcon, User, LogIn } from 'lucide-react';
import NewsTicker from '@/components/NewsTicker';
import InstallApps from '@/components/InstallApps';
import MediaStore from '@/components/MediaStore';
import SupportVideos from '@/components/SupportVideos';
import ChatCommunity from '@/components/ChatCommunity';
import Settings from '@/components/Settings';
import UserDashboard from '@/components/UserDashboard';
import { useDynamicBackground } from '@/hooks/useDynamicBackground';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';

const Index = () => {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [focusedButton, setFocusedButton] = useState(0);
  const [layoutMode, setLayoutMode] = useState<'grid' | 'row'>(() => {
    const saved = localStorage.getItem('snow-media-layout');
    return (saved as 'grid' | 'row') || 'grid';
  });
  const { backgroundUrl, hasBackground } = useDynamicBackground('home');
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleLayoutChange = (newMode: 'grid' | 'row') => {
    setLayoutMode(newMode);
    localStorage.setItem('snow-media-layout', newMode);
  };

  // Handle keyboard navigation for TV remote
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeSection) return; // Don't handle navigation when in a section
      
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          if (layoutMode === 'grid') {
            setFocusedButton((prev) => prev === 1 ? 3 : prev === 0 ? 1 : prev);
          } else {
            setFocusedButton((prev) => (prev + 1) % 4);
          }
          break;
        case 'ArrowLeft':
          event.preventDefault();
          if (layoutMode === 'grid') {
            setFocusedButton((prev) => prev === 0 ? 1 : prev === 3 ? 1 : prev === 1 ? 0 : 2);
          } else {
            setFocusedButton((prev) => (prev - 1 + 4) % 4);
          }
          break;
        case 'ArrowDown':
          event.preventDefault();
          if (layoutMode === 'grid') {
            setFocusedButton((prev) => prev < 2 ? prev + 2 : prev);
          }
          break;
        case 'ArrowUp':
          event.preventDefault();
          if (layoutMode === 'grid') {
            setFocusedButton((prev) => prev >= 2 ? prev - 2 : prev);
          }
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
  }, [activeSection, focusedButton, layoutMode]);

  const handleButtonClick = (index: number) => {
    const sections = ['install-apps', 'media-store', 'support-videos', 'chat-community'];
    setActiveSection(sections[index]);
  };

  const buttons = [
    {
      icon: Package,
      title: 'Main Apps',
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
        {activeSection === 'settings' && (
          <Settings 
            onBack={() => setActiveSection(null)} 
            layoutMode={layoutMode}
            onLayoutChange={handleLayoutChange}
          />
        )}
        {activeSection === 'dashboard' && <UserDashboard onBack={() => setActiveSection(null)} />}
      </div>
    );
  }

  return (
    <div 
      className={`min-h-screen text-white overflow-hidden relative ${layoutMode === 'row' ? 'flex flex-col' : ''}`}
      style={hasBackground ? {
        backgroundImage: `url(${backgroundUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      } : {}}
    >
      {/* Background Overlay - darker when custom background is used */}
      <div className={`absolute inset-0 ${hasBackground ? 'bg-black/30' : 'bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900'}`} />
      
      {/* Background Pattern - only show when no custom background */}
      {!hasBackground && (
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(56,189,248,0.1),transparent_50%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(56,189,248,0.05)_25%,rgba(56,189,248,0.05)_50%,transparent_50%,transparent_75%,rgba(56,189,248,0.05)_75%)] bg-[length:60px_60px]" />
        </div>
      )}

      {/* User/Auth Controls */}
      <div className="absolute top-4 right-4 z-20 flex gap-2">
        {user ? (
          <Button
            onClick={() => setActiveSection('dashboard')}
            variant="outline"
            size="sm"
            className="bg-green-600/20 border-green-500/50 text-white hover:bg-green-600/30"
          >
            <User className="w-4 h-4 mr-2" />
            Dashboard
          </Button>
        ) : (
          <Button
            onClick={() => navigate('/auth')}
            variant="outline"
            size="sm"
            className="bg-blue-600/20 border-blue-500/50 text-white hover:bg-blue-600/30"
          >
            <LogIn className="w-4 h-4 mr-2" />
            Sign In
          </Button>
        )}
        <Button
          onClick={() => setActiveSection('settings')}
          variant="outline"
          size="sm"
          className="bg-white/10 border-white/20 text-white hover:bg-white/20"
        >
          <SettingsIcon className="w-4 h-4 mr-2" />
          Settings
        </Button>
      </div>

      {/* Header */}
      <div className="relative z-10 pt-8 pb-4">
        <div className="text-center">
          <h1 className="text-6xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-2">
            SNOW MEDIA CENTER
          </h1>
          {layoutMode === 'grid' && (
            <p className="text-xl text-blue-200">TV Optimized Entertainment Hub</p>
          )}
        </div>
      </div>

      {/* News Ticker */}
      <NewsTicker />

      {/* Main Content */}
      <div className={`relative z-10 px-16 ${layoutMode === 'grid' ? 'flex flex-col justify-center pb-16 flex-1 pt-16' : 'flex flex-col justify-end pb-16 flex-1'}`}>
        <div className={layoutMode === 'grid' ? 'grid grid-cols-2 gap-12 max-w-7xl mx-auto' : 'flex gap-6 justify-center max-w-5xl mx-auto'}>
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
                  bg-gradient-to-br ${button.color} border-0 
                  ${layoutMode === 'grid' ? 'h-48' : 'h-32 w-48'}
                `}
                onClick={() => handleButtonClick(index)}
              >
                <div className="absolute inset-0 bg-black/20" />
                <div className="relative z-10 p-4 h-full flex flex-col items-center justify-center text-center">
                  <Icon 
                    size={layoutMode === 'grid' ? 64 : 48} 
                    className={`${layoutMode === 'grid' ? 'mb-4' : 'mb-2'} transition-all duration-300 ${
                      isFocused ? 'text-white scale-110' : 'text-white/90'
                    }`} 
                  />
                  <h3 className={`${layoutMode === 'grid' ? 'text-2xl' : 'text-lg'} font-bold mb-1 text-white`}>
                    {button.title}
                  </h3>
                  {layoutMode === 'grid' && (
                    <p className="text-lg text-white/80">
                      {button.description}
                    </p>
                  )}
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
    </div>
  );
};

export default Index;
