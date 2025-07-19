
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Package, Store, Video, MessageCircle, Settings as SettingsIcon, User, LogIn } from 'lucide-react';
import NewsTicker from '@/components/NewsTicker';
import InstallApps from '@/components/InstallApps';
import MediaStore from '@/components/MediaStore';
import CommunityChat from '@/components/CommunityChat';
import CreditStore from '@/components/CreditStore';
import SupportVideos from '@/components/SupportVideos';
import ChatCommunity from '@/components/ChatCommunity';
import Settings from '@/components/Settings';
import UserDashboard from '@/components/UserDashboard';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';

const Index = () => {
  const [activeView, setActiveView] = useState<'home' | 'apps' | 'media' | 'news' | 'support' | 'chat' | 'settings' | 'user' | 'store' | 'community' | 'credits'>('home');
  const [currentDateTime, setCurrentDateTime] = useState(new Date());
  const [focusedButton, setFocusedButton] = useState(0);
  const [layoutMode, setLayoutMode] = useState<'grid' | 'row'>(() => {
    const saved = localStorage.getItem('snow-media-layout');
    return (saved as 'grid' | 'row') || 'grid';
  });
  const { user } = useAuth();
  const navigate = useNavigate();

  // Update date/time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLayoutChange = (newMode: 'grid' | 'row') => {
    setLayoutMode(newMode);
    localStorage.setItem('snow-media-layout', newMode);
  };

  // Handle keyboard navigation for TV remote
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeView !== 'home') return; // Don't handle navigation when in a section
      
      if (layoutMode === 'grid') {
        // 2x2 grid navigation
        switch (event.key) {
          case 'ArrowRight':
            event.preventDefault();
            setFocusedButton((prev) => {
              if (prev === 0) return 1; // Top row: left to right
              if (prev === 1) return 0; // Top row: right to left (wrap)
              if (prev === 2) return 3; // Bottom row: left to right
              if (prev === 3) return 2; // Bottom row: right to left (wrap)
              return prev;
            });
            break;
          case 'ArrowLeft':
            event.preventDefault();
            setFocusedButton((prev) => {
              if (prev === 0) return 1; // Top row: left to right (wrap)
              if (prev === 1) return 0; // Top row: right to left
              if (prev === 2) return 3; // Bottom row: left to right (wrap)
              if (prev === 3) return 2; // Bottom row: right to left
              return prev;
            });
            break;
          case 'ArrowDown':
            event.preventDefault();
            setFocusedButton((prev) => {
              if (prev === 0) return 2; // Top left to bottom left
              if (prev === 1) return 3; // Top right to bottom right
              if (prev === 2) return 0; // Bottom left to top left (wrap)
              if (prev === 3) return 1; // Bottom right to top right (wrap)
              return prev;
            });
            break;
          case 'ArrowUp':
            event.preventDefault();
            setFocusedButton((prev) => {
              if (prev === 0) return 2; // Top left to bottom left (wrap)
              if (prev === 1) return 3; // Top right to bottom right (wrap)
              if (prev === 2) return 0; // Bottom left to top left
              if (prev === 3) return 1; // Bottom right to top right
              return prev;
            });
            break;
          case 'Enter':
          case ' ':
            event.preventDefault();
            handleButtonClick(focusedButton);
            break;
          case 'Escape':
            if (activeView !== 'home') {
              setActiveView('home');
            }
            break;
        }
      } else {
        // Row layout navigation (original)
        switch (event.key) {
          case 'ArrowRight':
            event.preventDefault();
            setFocusedButton((prev) => (prev + 1) % 4);
            break;
          case 'ArrowLeft':
            event.preventDefault();
            setFocusedButton((prev) => (prev - 1 + 4) % 4);
            break;
          case 'Enter':
          case ' ':
            event.preventDefault();
            handleButtonClick(focusedButton);
            break;
          case 'Escape':
            if (activeView !== 'home') {
              setActiveView('home');
            }
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeView, focusedButton, layoutMode]);

  const handleButtonClick = (index: number) => {
    const views: ('apps' | 'store' | 'support' | 'chat')[] = ['apps', 'store', 'support', 'chat'];
    setActiveView(views[index]);
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

  if (activeView !== 'home') {
    return (
      <div className="min-h-screen">
        {activeView === 'apps' && <InstallApps onBack={() => setActiveView('home')} />}
        {activeView === 'store' && <MediaStore onBack={() => setActiveView('home')} />}
        {activeView === 'support' && <SupportVideos onBack={() => setActiveView('home')} />}
        {activeView === 'chat' && <ChatCommunity onBack={() => setActiveView('home')} />}
        {activeView === 'community' && <CommunityChat onBack={() => setActiveView('home')} />}
        {activeView === 'credits' && <CreditStore onBack={() => setActiveView('home')} />}
        {activeView === 'settings' && (
          <Settings 
            onBack={() => setActiveView('home')} 
            layoutMode={layoutMode}
            onLayoutChange={handleLayoutChange}
          />
        )}
        {activeView === 'user' && (
          <UserDashboard 
            onViewChange={setActiveView}
            onManageMedia={() => setActiveView('media')}
            onViewSettings={() => setActiveView('settings')}
            onCommunityChat={() => setActiveView('community')}
            onCreditStore={() => setActiveView('credits')}
          />
        )}
      </div>
    );
  }

  return (
    <div className={`min-h-screen text-white overflow-hidden relative ${layoutMode === 'row' ? 'flex flex-col' : ''}`}>
      {/* Background Pattern - only visible when no global background is active */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 opacity-10" />
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(56,189,248,0.1),transparent_50%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(56,189,248,0.05)_25%,rgba(56,189,248,0.05)_50%,transparent_50%,transparent_75%,rgba(56,189,248,0.05)_75%)] bg-[length:60px_60px]" />
      </div>

      {/* User/Auth Controls */}
      <div className="absolute top-4 right-4 z-20 flex gap-2">
        {user ? (
          <Button
            onClick={() => setActiveView('user')}
            variant="outline"
            size="sm"
            className="glass-effect border-brand-ice/50 text-white hover:bg-brand-ice/20 font-quicksand font-semibold shadow-lg"
          >
            <User className="w-4 h-4 mr-2" />
            Dashboard
          </Button>
        ) : (
          <Button
            onClick={() => navigate('/auth')}
            variant="outline"
            size="sm"
            className="glass-effect border-brand-gold/50 text-white hover:bg-brand-gold/20 font-quicksand font-semibold shadow-lg"
          >
            <LogIn className="w-4 h-4 mr-2" />
            Sign In
          </Button>
        )}
        <Button
          onClick={() => setActiveView('settings')}
          variant="outline"
          size="sm"
          className="glass-effect border-white/30 text-white hover:bg-white/20 font-quicksand font-semibold shadow-lg"
        >
          <SettingsIcon className="w-4 h-4 mr-2" />
          Settings
        </Button>
      </div>

      {/* Header */}
      <div className="relative z-10 pt-16 pb-4">
        <div className="text-center">
          <h1 className="text-6xl font-logo font-bold bg-gradient-to-r from-brand-ice to-brand-gold bg-clip-text text-transparent mb-2 text-shadow-strong">
            SNOW MEDIA CENTER
          </h1>
          {layoutMode === 'grid' && (
            <p className="text-xl text-brand-ice/90 font-nunito font-medium text-shadow-soft">Your Premium Streaming Experience</p>
          )}
        </div>
      </div>

      {/* Date/Time Display */}
      <div className="absolute top-4 left-4 z-20 text-white">
        <div className="glass-effect rounded-xl px-4 py-3 border border-brand-ice/30 shadow-lg">
          <div className="text-lg font-bold font-quicksand text-shadow-soft">
            {currentDateTime.toLocaleDateString('en-US', { 
              weekday: 'short', 
              month: 'short', 
              day: 'numeric' 
            })}
          </div>
          <div className="text-sm opacity-90 font-nunito text-shadow-soft">
            {currentDateTime.toLocaleTimeString('en-US', { 
              hour: '2-digit', 
              minute: '2-digit',
              second: '2-digit'
            })}
          </div>
        </div>
      </div>

      {/* News Ticker */}
      <NewsTicker />

      {/* Main Content */}
      <div className={`relative z-10 px-8 ${layoutMode === 'grid' ? 'flex flex-col justify-center items-center min-h-[calc(100vh-200px)] pt-20' : 'flex flex-col justify-end pb-16 flex-1'}`}>
        <div className={layoutMode === 'grid' ? 'grid grid-cols-2 justify-items-center w-full max-w-none px-16 gap-y-20' : 'flex gap-6 justify-center max-w-5xl mx-auto'}>
          {buttons.map((button, index) => {
            const Icon = button.icon;
            const isFocused = focusedButton === index;
            
            return (
              <Card
                key={index}
                className={`
                  relative overflow-hidden cursor-pointer transition-all duration-500 transform
                  ${isFocused 
                    ? 'scale-110 ring-4 ring-brand-ice/60 shadow-2xl animate-glow' 
                    : 'hover:scale-105 shadow-xl hover:shadow-2xl'
                  }
                  bg-gradient-to-br ${button.color} border-0 rounded-3xl
                  ${layoutMode === 'grid' ? 'h-52 aspect-[4/3]' : 'h-32 w-48'}
                  card-polished
                `}
                onClick={() => handleButtonClick(index)}
              >
                {/* Enhanced glass overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/20 rounded-3xl" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent rounded-3xl" />
                
                <div className="relative z-10 p-6 h-full flex flex-col items-center justify-center text-center">
                  <Icon 
                    size={layoutMode === 'grid' ? 64 : 48} 
                    className={`${layoutMode === 'grid' ? 'mb-4' : 'mb-2'} transition-all duration-500 text-white drop-shadow-xl filter ${isFocused ? 'animate-pulse' : ''}`} 
                  />
                  <h3 className={`${layoutMode === 'grid' ? 'text-xl' : 'text-lg'} font-bold mb-2 text-white leading-tight text-shadow-strong font-quicksand`}>
                    {button.title}
                  </h3>
                  {layoutMode === 'grid' && (
                    <p className="text-sm text-white/95 leading-tight text-shadow-soft font-nunito">
                      {button.description}
                    </p>
                  )}
                </div>
                
                {/* Enhanced focus indicator with glow */}
                {isFocused && (
                  <div className="absolute inset-0 bg-gradient-to-r from-brand-ice/20 to-brand-gold/20 rounded-3xl animate-pulse" />
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
