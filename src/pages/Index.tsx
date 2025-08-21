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
import { useNavigation } from '@/hooks/useNavigation';
import { useToast } from '@/hooks/use-toast';

const Index = () => {
  const [currentDateTime, setCurrentDateTime] = useState(new Date());
  const [focusedButton, setFocusedButton] = useState(0); // -2: auth/user, -1: settings, 0-3: main apps
  const [layoutMode, setLayoutMode] = useState<'grid' | 'row'>(() => {
    const saved = localStorage.getItem('snow-media-layout');
    return (saved as 'grid' | 'row') || 'row'; // Default to row layout
  });
  const { user } = useAuth();
  const { version } = useVersion();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { currentView, navigateTo, goBack, backPressCount, canGoBack } = useNavigation('home');

  // Update date/time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Show exit toast on home screen
  useEffect(() => {
    if (currentView === 'home' && backPressCount === 1) {
      toast({
        title: "Press back again to exit",
        description: "Press the back button again to close the app",
        duration: 1000,
      });
    }
  }, [backPressCount, currentView, toast]);

  const handleLayoutChange = (newMode: 'grid' | 'row') => {
    setLayoutMode(newMode);
    localStorage.setItem('snow-media-layout', newMode);
  };

  // Handle keyboard navigation for TV remote
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle both standard back buttons and Android hardware back button
      if (event.key === 'Escape' || event.key === 'Backspace' || 
          event.keyCode === 4 || event.which === 4) { // Android back button
        event.preventDefault();
        event.stopPropagation();
        
        if (currentView !== 'home') {
          goBack();
          return;
        }
      }
      
      if (currentView !== 'home') {
        return; // Let individual components handle their own navigation
      }
      
      // Prevent default for navigation keys on home screen
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }

      // Home screen navigation
      const maxButtons = 3; // apps, store, support, chat
      
      switch (event.key) {
        case 'ArrowLeft':
          if (layoutMode === 'grid') {
            if (focusedButton === 1 || focusedButton === 3) {
              setFocusedButton(focusedButton - 1);
            } else if (focusedButton === -1) { // settings
              setFocusedButton(-2); // user/auth
            }
          } else { // row mode
            if (focusedButton > 0) {
              setFocusedButton(focusedButton - 1);
            } else if (focusedButton === 0) {
              setFocusedButton(-1); // settings
            } else if (focusedButton === -1) {
              setFocusedButton(-2); // user/auth
            }
          }
          break;
          
        case 'ArrowRight':
          if (layoutMode === 'grid') {
            if (focusedButton === 0 || focusedButton === 2) {
              setFocusedButton(focusedButton + 1);
            } else if (focusedButton === -2) { // user/auth
              setFocusedButton(-1); // settings
            }
          } else { // row mode
            if (focusedButton < maxButtons) {
              setFocusedButton(focusedButton + 1);
            } else if (focusedButton === maxButtons) {
              setFocusedButton(-1); // settings
            } else if (focusedButton === -1) {
              setFocusedButton(-2); // user/auth
            } else if (focusedButton === -2) {
              setFocusedButton(0); // back to first app
            }
          }
          break;
          
        case 'ArrowUp':
          if (layoutMode === 'grid') {
            if (focusedButton === 2 || focusedButton === 3) {
              setFocusedButton(focusedButton - 2);
            } else if (focusedButton >= 0) {
              setFocusedButton(-2); // Go to user/auth
            }
          } else { // row mode - go to top controls
            if (focusedButton >= 0) {
              setFocusedButton(-2); // user/auth
            }
          }
          break;
          
        case 'ArrowDown':
          if (layoutMode === 'grid') {
            if (focusedButton === 0 || focusedButton === 1) {
              setFocusedButton(focusedButton + 2);
            } else if (focusedButton < 0) {
              setFocusedButton(0); // Go to first app
            }
          } else { // row mode - go to apps
            if (focusedButton < 0) {
              setFocusedButton(0); // Go to first app
            }
          }
          break;
          
        case 'Enter':
        case ' ':
          if (focusedButton === -2) {
            // Navigate to auth or user dashboard
            if (user) {
              navigateTo('user');
            } else {
              navigate('/auth');
            }
          } else if (focusedButton === -1) {
            // Navigate to settings
            navigateTo('settings');
          } else if (focusedButton === 0) {
            navigateTo('apps');
          } else if (focusedButton === 1) {
            navigateTo('store');
          } else if (focusedButton === 2) {
            navigateTo('support');
          } else if (focusedButton === 3) {
            navigateTo('chat');
          }
          break;
          
        case 'Escape':
        case 'Backspace':
          // Handle double-press to exit on home screen (already handled above)
          goBack();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedButton, layoutMode, currentView, user, navigate, navigateTo, goBack]);

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

  // Debug: Log current view
  console.log('Current view:', currentView);
  
  return (
    <div className="min-h-screen">
      {/* Navigation-based components */}
      {currentView === 'apps' && <InstallApps onBack={() => goBack()} />}
      {currentView === 'store' && <MediaStore onBack={() => goBack()} />}
      {currentView === 'support' && <SupportVideos onBack={() => goBack()} />}
      {currentView === 'chat' && <ChatCommunity onBack={() => goBack()} onNavigate={(section) => navigateTo(section)} />}
      {currentView === 'community' && <CommunityChat onBack={() => goBack()} />}
      {currentView === 'credits' && <CreditStore onBack={() => goBack()} />}
      {currentView === 'settings' && <Settings onBack={() => goBack()} layoutMode={layoutMode} onLayoutChange={handleLayoutChange} />}
      {currentView === 'user' && <UserDashboard onViewChange={(view) => navigateTo(view)} onManageMedia={() => navigateTo('media')} onViewSettings={() => navigateTo('settings')} onCommunityChat={() => navigateTo('community')} onCreditStore={() => navigateTo('credits')} />}

      {/* Home screen content */}
      {currentView === 'home' && (
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
                onClick={() => navigateTo('user')}
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
              onClick={() => navigateTo('settings')}
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
            <div className={layoutMode === 'grid' ? 'grid grid-cols-2 gap-8 justify-items-center w-full max-w-4xl mx-auto px-8' : 'flex gap-6 justify-center max-w-5xl mx-auto'}>
              {buttons.map((button, index) => {
                const ButtonIcon = button.icon;
                const isFocused = focusedButton === index;
                
                return (
                  <Card
                    key={index}
                    className={`
                      relative overflow-hidden cursor-pointer border-0 rounded-3xl
                      ${layoutMode === 'grid' ? 'h-44 w-full max-w-xs' : 'h-32 w-48'}
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
                    onClick={() => {
                      if (index === 0) navigateTo('apps');
                      else if (index === 1) navigateTo('store');
                      else if (index === 2) navigateTo('support');
                      else if (index === 3) navigateTo('chat');
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/20 rounded-3xl" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent rounded-3xl" />
                    
                    <div className="relative z-10 p-6 h-full flex flex-col items-center justify-center text-center">
                      <ButtonIcon 
                        size={layoutMode === 'grid' ? 64 : 48} 
                        className={`${layoutMode === 'grid' ? 'mb-4' : 'mb-2'} text-white drop-shadow-xl flex-shrink-0`} 
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
                    
                    {isFocused && (
                      <div className="absolute inset-0 bg-gradient-to-r from-brand-ice/20 to-brand-gold/20 rounded-3xl" />
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;