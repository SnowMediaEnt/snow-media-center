
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Package, Store, Video, MessageCircle, Settings as SettingsIcon, User, LogIn, Download, Smartphone } from 'lucide-react';
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
import { useVersion } from '@/hooks/useVersion';
import { useNavigate } from 'react-router-dom';

const Index = () => {
  const [activeView, setActiveView] = useState<'home' | 'apps' | 'media' | 'news' | 'support' | 'chat' | 'settings' | 'user' | 'store' | 'community' | 'credits'>('home');
  const [currentDateTime, setCurrentDateTime] = useState(new Date());
  const [focusedButton, setFocusedButton] = useState(0); // -2: auth/user, -1: settings, 0-3: main apps
  const [layoutMode, setLayoutMode] = useState<'grid' | 'row'>(() => {
    const saved = localStorage.getItem('snow-media-layout');
    return (saved as 'grid' | 'row') || 'grid';
  });
  const { user } = useAuth();
  const { version } = useVersion();
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
      event.preventDefault(); // Always prevent default to avoid native app closing
      
      if (activeView !== 'home') {
        // When in a section, only handle back navigation
        if (event.key === 'Escape' || event.key === 'Backspace') {
          setActiveView('home');
        }
        return;
      }
      
      if (layoutMode === 'grid') {
        // Enhanced 3x2 grid navigation (4 main apps + 2 top buttons)
        // Layout: [SignIn/Dashboard] [Settings]
        //         [App0]             [App1]
        //         [App2]             [App3]
        switch (event.key) {
          case 'ArrowRight':
            setFocusedButton((prev) => {
              if (prev === -2) return -1; // Sign in to Settings
              if (prev === -1) return -2; // Settings to Sign in (wrap)
              if (prev === 0) return 1; // App0 to App1
              if (prev === 1) return 0; // App1 to App0 (wrap)
              if (prev === 2) return 3; // App2 to App3
              if (prev === 3) return 2; // App3 to App2 (wrap)
              return prev;
            });
            break;
          case 'ArrowLeft':
            setFocusedButton((prev) => {
              if (prev === -2) return -1; // Sign in to Settings (wrap)
              if (prev === -1) return -2; // Settings to Sign in
              if (prev === 0) return 1; // App0 to App1 (wrap)
              if (prev === 1) return 0; // App1 to App0
              if (prev === 2) return 3; // App2 to App3 (wrap)
              if (prev === 3) return 2; // App3 to App2
              return prev;
            });
            break;
          case 'ArrowDown':
            setFocusedButton((prev) => {
              if (prev === -2) return 0; // Sign in to App0
              if (prev === -1) return 1; // Settings to App1
              if (prev === 0) return 2; // App0 to App2
              if (prev === 1) return 3; // App1 to App3
              if (prev === 2) return -2; // App2 to Sign in (wrap)
              if (prev === 3) return -1; // App3 to Settings (wrap)
              return prev;
            });
            break;
          case 'ArrowUp':
            setFocusedButton((prev) => {
              if (prev === -2) return 2; // Sign in to App2 (wrap)
              if (prev === -1) return 3; // Settings to App3 (wrap)
              if (prev === 0) return -2; // App0 to Sign in
              if (prev === 1) return -1; // App1 to Settings
              if (prev === 2) return 0; // App2 to App0
              if (prev === 3) return 1; // App3 to App1
              return prev;
            });
            break;
          case 'Enter':
          case ' ':
            if (focusedButton >= 0) {
              handleButtonClick(focusedButton);
            } else if (focusedButton === -2) {
              // Navigate to auth or user dashboard
              if (user) {
                setActiveView('user');
              } else {
                navigate('/auth');
              }
            } else if (focusedButton === -1) {
              // Navigate to settings
              setActiveView('settings');
            }
            break;
        }
      } else {
        // Row layout navigation with enhanced navigation
        switch (event.key) {
          case 'ArrowRight':
            setFocusedButton((prev) => {
              if (prev === -2) return -1; // Sign in to Settings
              if (prev === -1) return 0; // Settings to first app
              return (prev + 1) % 4; // Cycle through apps
            });
            break;
          case 'ArrowLeft':
            setFocusedButton((prev) => {
              if (prev === 0) return -1; // First app to Settings
              if (prev === -1) return -2; // Settings to Sign in
              if (prev === -2) return 3; // Sign in to last app (wrap)
              return (prev - 1 + 4) % 4; // Cycle through apps
            });
            break;
          case 'ArrowUp':
            setFocusedButton((prev) => {
              if (prev >= 0) return -2; // From apps to Sign in
              return prev; // Stay in top row
            });
            break;
          case 'ArrowDown':
            setFocusedButton((prev) => {
              if (prev < 0) return 0; // From top buttons to first app
              return prev; // Stay in apps row
            });
            break;
          case 'Enter':
          case ' ':
            if (focusedButton >= 0) {
              handleButtonClick(focusedButton);
            } else if (focusedButton === -2) {
              if (user) {
                setActiveView('user');
              } else {
                navigate('/auth');
              }
            } else if (focusedButton === -1) {
              setActiveView('settings');
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
      icon: Smartphone,
      title: 'Main Apps',
      description: 'Download APKs & Streaming Tools',
      variant: 'blue' as const
    },
    {
      icon: Store,
      title: 'Snow Media Store',
      description: 'Visit Official Store',
      variant: 'purple' as const
    },
    {
      icon: Video,
      title: 'Support Videos',
      description: 'Help & Tutorial Videos',
      variant: 'gold' as const
    },
    {
      icon: MessageCircle,
      title: 'Chat & Community',
      description: 'Connect with Admin & Users',
      variant: 'navy' as const
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
    <div className={`min-h-screen text-white overflow-hidden relative ${layoutMode === 'row' ? 'flex flex-col' : ''}`} style={{ height: '100vh', maxHeight: '100vh' }}>
      {/* Subtle snowy background pattern - only visible when no global background is active */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-blue-100/30 to-blue-200/20" />
      <div className="absolute inset-0 opacity-30">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.4),transparent_30%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(135,206,235,0.3),transparent_40%)]" />
      </div>

      {/* User/Auth Controls */}
      <div className="absolute top-4 right-4 z-20 flex gap-2">
        {user ? (
          <Button
            onClick={() => setActiveView('user')}
            variant="white"
            size="sm"
            className={`transition-all duration-200 ${
              focusedButton === -2 
                ? 'ring-4 ring-white/60 shadow-2xl scale-105' 
                : ''
            }`}
          >
            <User className="w-4 h-4 mr-2 text-gray-800" />
            <span className="text-gray-800">Dashboard</span>
          </Button>
        ) : (
          <Button
            onClick={() => navigate('/auth')}
            variant="gold"
            size="sm"
            className={`transition-all duration-200 ${
              focusedButton === -2 
                ? 'ring-4 ring-white/60 shadow-2xl scale-105' 
                : ''
            }`}
          >
            <LogIn className="w-4 h-4 mr-2" />
            Sign In
          </Button>
        )}
        <Button
          onClick={() => setActiveView('settings')}
          variant="gold"
          size="sm"
          className={`transition-all duration-200 ${
            focusedButton === -1 
              ? 'ring-4 ring-white/60 shadow-2xl scale-105' 
              : ''
          }`}
        >
          <SettingsIcon className="w-4 h-4 mr-2" />
          Settings
        </Button>
      </div>

      {/* Header */}
      <div className="relative z-10 pt-16 pb-4">
        <div className="text-center">
          <h1 className="text-6xl mb-2 text-shadow-strong">
            <span className="font-snow-media text-brand-navy">SNOW MEDIA</span>
            <span className="text-2xl"> </span>
            <span className="font-center text-brand-charcoal">CENTER</span>
          </h1>
          {layoutMode === 'grid' && (
            <p className="text-xl text-brand-ice/90 font-nunito font-medium text-shadow-soft">Your Premium Streaming Experience</p>
          )}
        </div>
      </div>

      {/* Date/Time Display */}
      <div className="absolute top-4 left-4 z-20 text-white">
        <div className="bg-black/80 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20 shadow-lg">
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
          <div className="text-xs font-nunito text-shadow-soft mt-1" style={{ color: '#FFD700' }}>
            v{version}
          </div>
        </div>
      </div>

      {/* News Ticker */}
      <NewsTicker />

      {/* Main Content */}
      <div className={`relative z-10 px-8 mt-8 ${layoutMode === 'grid' ? 'flex flex-col justify-center items-center flex-1 overflow-y-auto' : 'flex flex-col justify-end pb-16 flex-1'}`}>
        <div className={layoutMode === 'grid' ? 'grid grid-cols-2 justify-items-center w-full max-w-none px-16 gap-y-20' : 'flex gap-6 justify-center max-w-5xl mx-auto'}>
          {buttons.map((button, index) => {
            const Icon = button.icon;
            const isFocused = focusedButton === index;
            
            return (
              <Card
                key={index}
                className={`
                  relative overflow-hidden cursor-pointer border-0 rounded-3xl
                  ${layoutMode === 'grid' ? 'h-56 aspect-[4/3]' : 'h-32 w-48'}
                  ${isFocused 
                    ? 'ring-4 ring-white/60 shadow-2xl scale-105' 
                    : 'shadow-xl'
                  }
                  transition-all duration-200
                  ${button.variant === 'blue' ? '[background:var(--gradient-blue)]' : ''}
                  ${button.variant === 'purple' ? '[background:var(--gradient-purple)]' : ''}
                  ${button.variant === 'gold' ? '[background:var(--gradient-gold)]' : ''}
                  ${button.variant === 'navy' ? '[background:var(--gradient-navy)]' : ''}
                `}
                onClick={() => handleButtonClick(index)}
              >
                {/* Enhanced glass overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/20 rounded-3xl" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent rounded-3xl" />
                
                <div className="relative z-10 p-6 h-full flex flex-col items-center justify-center text-center">
                   <Icon 
                     size={layoutMode === 'grid' ? 64 : 48} 
                     className={`${layoutMode === 'grid' ? 'mb-4' : 'mb-2'} text-white drop-shadow-xl filter flex-shrink-0`} 
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
                
                {/* Focus indicator */}
                {isFocused && (
                  <div className="absolute inset-0 bg-gradient-to-r from-brand-ice/20 to-brand-gold/20 rounded-3xl" />
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
