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
import WixConnectionTest from '@/components/WixConnectionTest';
import SupportTicketSystem from '@/components/SupportTicketSystem';
import AIConversationSystem from '@/components/AIConversationSystem';
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
  const [screenHeight, setScreenHeight] = useState(window.innerHeight);
  const { user } = useAuth();
  const { version } = useVersion();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { currentView, navigateTo, goBack, backPressCount, canGoBack } = useNavigation('home');

  // Update date/time every second and detect screen resolution
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);

    // Detect screen resolution for TV optimization
    const handleResize = () => {
      setScreenHeight(window.innerHeight);
    };

    handleResize(); // Check on mount
    window.addEventListener('resize', handleResize);
    
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, [layoutMode]);

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
      
      {/* New Support Ticket System */}
      {currentView === 'support-tickets' && <SupportTicketSystem onBack={() => goBack()} initialView="list" />}
      {currentView === 'create-ticket' && <SupportTicketSystem onBack={() => goBack()} initialView="create" />}
      
      {/* New AI Conversation System */}
      {currentView === 'ai-conversations' && <AIConversationSystem onBack={() => goBack()} />}
      {currentView === 'create-ai-conversation' && <AIConversationSystem onBack={() => goBack()} />}

      {/* Home screen content */}
      {currentView === 'home' && (
        <div className={`min-h-dvh max-h-dvh overflow-y-auto overscroll-contain px-6 py-6 tv-safe text-white relative ${layoutMode === 'row' ? 'flex flex-col' : ''}`}>
          {/* Subtle snowy background pattern - only visible when no global background is active */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-blue-100/30 to-blue-200/20" />
          <div className="absolute inset-0 opacity-30">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.4),transparent_30%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(135,206,235,0.3),transparent_40%)]" />
          </div>

          {/* User/Auth Controls */}
          <div className={`absolute z-20 flex ${
            screenHeight >= 2160 ? 'top-8 right-8 gap-4' :
            screenHeight >= 1440 ? 'top-6 right-6 gap-3' :
            'top-4 right-4 gap-2'
          }`}>
            {user ? (
              <Button
                onClick={() => navigateTo('user')}
                variant="white"
                size={screenHeight >= 1440 ? "default" : "sm"}
                tabIndex={0}
                className={`tv-focusable transition-all duration-200 ${
                  screenHeight >= 2160 ? 'text-xl px-6 py-3' :
                  screenHeight >= 1440 ? 'text-lg px-5 py-2.5' :
                  ''
                } ${
                  focusedButton === -2 
                    ? 'ring-4 ring-white/60 shadow-2xl scale-105' 
                    : ''
                }`}
              >
                <User className={`mr-2 text-gray-800 ${
                  screenHeight >= 2160 ? 'w-6 h-6' :
                  screenHeight >= 1440 ? 'w-5 h-5' :
                  'w-4 h-4'
                }`} />
                <span className="text-gray-800">Dashboard</span>
              </Button>
            ) : (
              <Button
                onClick={() => navigate('/auth')}
                variant="gold"
                size={screenHeight >= 1440 ? "default" : "sm"}
                tabIndex={0}
                className={`tv-focusable transition-all duration-200 ${
                  screenHeight >= 2160 ? 'text-xl px-6 py-3' :
                  screenHeight >= 1440 ? 'text-lg px-5 py-2.5' :
                  ''
                } ${
                  focusedButton === -2 
                    ? 'ring-4 ring-white/60 shadow-2xl scale-105' 
                    : ''
                }`}
              >
                <LogIn className={`mr-2 ${
                  screenHeight >= 2160 ? 'w-6 h-6' :
                  screenHeight >= 1440 ? 'w-5 h-5' :
                  'w-4 h-4'
                }`} />
                Sign In
              </Button>
            )}
            <Button
              onClick={() => navigateTo('settings')}
              variant="gold"
              size={screenHeight >= 1440 ? "default" : "sm"}
              tabIndex={0}
              className={`tv-focusable transition-all duration-200 ${
                screenHeight >= 2160 ? 'text-xl px-6 py-3' :
                screenHeight >= 1440 ? 'text-lg px-5 py-2.5' :
                ''
              } ${
                focusedButton === -1 
                  ? 'ring-4 ring-white/60 shadow-2xl scale-105' 
                  : ''
              }`}
            >
              <SettingsIcon className={`mr-2 ${
                screenHeight >= 2160 ? 'w-6 h-6' :
                screenHeight >= 1440 ? 'w-5 h-5' :
                'w-4 h-4'
              }`} />
              Settings
            </Button>
          </div>

          {/* Header */}
          <div className="relative z-10 pt-16 pb-4">
            <div className="text-center">
              <h1 className={`mb-2 text-shadow-strong ${
                screenHeight >= 2160 ? 'text-10xl' : // 4K
                screenHeight >= 1440 ? 'text-9xl' :  // 1440p
                screenHeight >= 1080 ? 'text-8xl' :  // 1080p
                'text-6xl'                           // smaller screens
              }`}>
                <span className="font-snow-media text-brand-navy">SNOW MEDIA</span>
                <span className={`${
                  screenHeight >= 2160 ? 'text-4xl' :
                  screenHeight >= 1440 ? 'text-3xl' :
                  screenHeight >= 1080 ? 'text-3xl' :
                  'text-2xl'
                }`}> </span>
                <span className="font-center text-brand-charcoal">CENTER</span>
              </h1>
              {layoutMode === 'grid' && (
                <p className={`text-brand-ice/90 font-nunito font-medium text-shadow-soft ${
                  screenHeight >= 2160 ? 'text-3xl' :
                  screenHeight >= 1440 ? 'text-2xl' :
                  screenHeight >= 1080 ? 'text-xl' :
                  'text-lg'
                }`}>Your Premium Streaming Experience</p>
              )}
            </div>
          </div>

          {/* Date/Time Display */}
          <div className={`absolute z-20 text-white ${
            screenHeight >= 1440 ? 'top-6 left-6' : 'top-4 left-4'
          }`}>
            <div className={`bg-black/80 backdrop-blur-sm rounded-xl border border-white/20 shadow-lg ${
              screenHeight >= 2160 ? 'px-8 py-6' :
              screenHeight >= 1440 ? 'px-6 py-4' :
              'px-4 py-3'
            }`}>
              <div className={`font-bold font-quicksand text-shadow-soft ${
                screenHeight >= 2160 ? 'text-3xl' :
                screenHeight >= 1440 ? 'text-2xl' :
                screenHeight >= 1080 ? 'text-xl' :
                'text-lg'
              }`}>
                {currentDateTime.toLocaleDateString('en-US', { 
                  weekday: 'short', 
                  month: 'short', 
                  day: 'numeric' 
                })}
              </div>
              <div className={`opacity-90 font-nunito text-shadow-soft ${
                screenHeight >= 2160 ? 'text-xl' :
                screenHeight >= 1440 ? 'text-lg' :
                screenHeight >= 1080 ? 'text-base' :
                'text-sm'
              }`}>
                {currentDateTime.toLocaleTimeString('en-US', { 
                  hour: '2-digit', 
                  minute: '2-digit',
                  second: '2-digit'
                })}
              </div>
              <div className={`font-nunito text-shadow-soft mt-1 ${
                screenHeight >= 2160 ? 'text-lg' :
                screenHeight >= 1440 ? 'text-base' :
                screenHeight >= 1080 ? 'text-sm' :
                'text-xs'
              }`} style={{ color: '#FFD700' }}>
                v{version}
              </div>
            </div>
          </div>

          {/* News Ticker */}
          <NewsTicker />

          {/* Main Content */}
          <div className={`relative z-10 tv-safe-grid mt-4 ${layoutMode === 'grid' ? 'flex flex-col justify-center items-center flex-1 overflow-y-auto' : 'flex flex-col justify-end pb-8 flex-1'}`}>
            <div className={`grid-responsive ${
              layoutMode === 'grid' 
                ? `grid grid-cols-2 justify-items-center w-full mx-auto ${
                    screenHeight >= 2160 ? 'gap-16 max-w-8xl' :
                    screenHeight >= 1440 ? 'gap-12 max-w-7xl' :
                    screenHeight >= 1080 ? 'gap-10 max-w-6xl' :
                    'gap-8 max-w-5xl'
                  }` 
                : `flex justify-center mx-auto ${
                    screenHeight >= 2160 ? 'gap-12 max-w-8xl' :
                    screenHeight >= 1440 ? 'gap-10 max-w-7xl' :
                    'gap-8 max-w-6xl'
                  }`
            }`}>
              {buttons.map((button, index) => {
                const ButtonIcon = button.icon;
                const isFocused = focusedButton === index;
                
                return (
                  <Card
                    key={index}
                    tabIndex={0}
                    className={`
                      relative overflow-hidden cursor-pointer border-0 rounded-3xl tv-focusable
                      ${layoutMode === 'grid' 
                        ? screenHeight >= 2160 
                          ? 'h-80 w-full max-w-lg' 
                          : screenHeight >= 1440 
                            ? 'h-72 w-full max-w-lg'
                            : screenHeight >= 1080 
                              ? 'h-60 w-full max-w-md'
                              : 'h-52 w-full max-w-sm'
                        : screenHeight >= 2160
                          ? 'h-64 w-96'
                          : screenHeight >= 1440
                            ? 'h-56 w-80'
                            : screenHeight >= 1080
                              ? 'h-48 w-72'
                              : 'h-40 w-64'
                      }
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
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (index === 0) navigateTo('apps');
                        else if (index === 1) navigateTo('store');
                        else if (index === 2) navigateTo('support');
                        else if (index === 3) navigateTo('chat');
                      }
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/20 rounded-3xl" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent rounded-3xl" />
                    
                    <div className={`relative z-10 h-full flex flex-col items-center justify-center text-center ${
                      screenHeight >= 2160 ? 'p-8' :
                      screenHeight >= 1440 ? 'p-6' :
                      'p-4'
                    }`}>
                      <ButtonIcon 
                        size={layoutMode === 'grid' 
                          ? screenHeight >= 2160 ? 96 :
                            screenHeight >= 1440 ? 80 :
                            screenHeight >= 1080 ? 64 : 48
                          : screenHeight >= 2160 ? 72 :
                            screenHeight >= 1440 ? 64 :
                            screenHeight >= 1080 ? 48 : 36
                        } 
                        className={`text-white drop-shadow-xl flex-shrink-0 ${
                          layoutMode === 'grid' 
                            ? screenHeight >= 1440 ? 'mb-4' : 'mb-3'
                            : screenHeight >= 1440 ? 'mb-3' : 'mb-2'
                        }`} 
                      />
                      <h3 className={`font-bold mb-1 text-white leading-tight text-shadow-strong font-quicksand ${
                        layoutMode === 'grid' 
                          ? screenHeight >= 2160 ? 'text-3xl' :
                            screenHeight >= 1440 ? 'text-2xl' :
                            screenHeight >= 1080 ? 'text-xl' : 'text-lg'
                          : screenHeight >= 2160 ? 'text-2xl' :
                            screenHeight >= 1440 ? 'text-xl' :
                            screenHeight >= 1080 ? 'text-lg' : 'text-base'
                      }`}>
                        {button.title}
                      </h3>
                      {layoutMode === 'grid' && screenHeight >= 1080 && (
                        <p className={`text-white/95 leading-tight text-shadow-soft font-nunito ${
                          screenHeight >= 2160 ? 'text-xl' :
                          screenHeight >= 1440 ? 'text-lg' :
                          screenHeight >= 1080 ? 'text-base' : 'text-sm'
                        }`}>
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