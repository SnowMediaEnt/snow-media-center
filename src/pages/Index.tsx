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
import { useDynamicBackground } from '@/hooks/useDynamicBackground';

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
  const { backgroundUrl, hasBackground } = useDynamicBackground('home');

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
      // Skip navigation handling when user is typing in an input or textarea
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      
      // Allow Backspace when typing
      if (event.key === 'Backspace' && isTyping) {
        return; // Let the default behavior happen
      }
      
      // Handle both standard back buttons and Android hardware back button (but not Backspace when typing)
      if (event.key === 'Escape' || event.keyCode === 4 || event.which === 4) { // Android back button
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
      
      // Prevent default for navigation keys on home screen (only when not typing)
      if (!isTyping && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
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
        <div className="h-screen w-screen overflow-hidden text-white relative flex flex-col">
          {/* Dynamic background image or fallback gradient */}
          {hasBackground ? (
            <div 
              className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-500"
              style={{ backgroundImage: `url(${backgroundUrl})` }}
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-blue-100/30 to-blue-200/20" />
              <div className="absolute inset-0 opacity-30">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.4),transparent_30%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(135,206,235,0.3),transparent_40%)]" />
              </div>
            </>
          )}
          {/* Dark overlay for text readability when using custom background */}
          {hasBackground && <div className="absolute inset-0 bg-black/30" />}

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

          {/* Spacer for info bar */}
          <div className="flex-shrink-0" style={{ height: '8vh' }}></div>

          {/* Header - tight container around title */}
          <div className="relative z-10 flex-shrink-0 flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-shadow-strong leading-none" style={{ fontSize: 'clamp(3rem, 8vw, 10rem)' }}>
                <span className="font-snow-media text-brand-navy">SNOW MEDIA</span>
                <span> </span>
                <span className="font-center" style={{ color: '#C9B370' }}>CENTER</span>
              </h1>
              <p className="text-brand-ice/90 font-nunito font-medium text-shadow-soft" style={{ fontSize: 'clamp(1rem, 2vw, 2rem)', marginTop: '-4px' }}>
                Your Premium Streaming Experience
              </p>
            </div>
          </div>

          {/* Date/Time Display - Left side horizontal bar */}
          <div className="absolute z-20 top-4 left-4">
            <div className="bg-black/70 backdrop-blur-sm rounded-full border border-white/20 shadow-lg px-5 py-2 flex items-center gap-3">
              <div className="font-bold font-quicksand text-shadow-soft text-white" style={{ fontSize: 'clamp(0.75rem, 1vw, 1rem)' }}>
                {currentDateTime.toLocaleDateString('en-US', { 
                  weekday: 'short', 
                  month: 'short', 
                  day: 'numeric' 
                })}
              </div>
              <div className="w-px h-4 bg-white/40"></div>
              <div className="opacity-90 font-nunito text-shadow-soft text-white" style={{ fontSize: 'clamp(0.75rem, 1vw, 1rem)' }}>
                {currentDateTime.toLocaleTimeString('en-US', { 
                  hour: '2-digit', 
                  minute: '2-digit',
                  second: '2-digit'
                })}
              </div>
              <div className="w-px h-4 bg-white/40"></div>
              <div className="font-nunito text-shadow-soft" style={{ color: '#FFD700', fontSize: 'clamp(0.75rem, 1vw, 1rem)' }}>
                v{version}
              </div>
            </div>
          </div>

          {/* News Ticker */}
          <NewsTicker />

          {/* Main Content - Cards positioned at bottom */}
          <div className="relative z-10 flex-1 flex flex-col justify-end" style={{ paddingBottom: '5vh', paddingLeft: '3vw', paddingRight: '3vw' }}>
            <div 
              className={`justify-center w-full mx-auto ${layoutMode === 'grid' ? 'grid grid-cols-2' : 'flex flex-wrap'}`} 
              style={{ 
                gap: layoutMode === 'grid' ? 'clamp(1.5rem, 3vw, 4rem)' : 'clamp(1rem, 1.5vw, 2rem)',
                maxWidth: layoutMode === 'grid' ? 'clamp(500px, 55vw, 1200px)' : '95vw'
              }}
            >
              {buttons.map((button, index) => {
                const ButtonIcon = button.icon;
                const isFocused = focusedButton === index;
                
                // Card dimensions based on layout mode using viewport units for proportional scaling
                const cardStyle = layoutMode === 'grid' 
                  ? { width: 'clamp(200px, 22vw, 500px)', height: 'clamp(150px, 25vh, 350px)' }
                  : { width: 'clamp(160px, 18vw, 320px)', height: 'clamp(130px, 20vh, 250px)' };
                
                return (
                  <Card
                    key={index}
                    tabIndex={0}
                    style={cardStyle}
                    className={`
                      relative overflow-hidden cursor-pointer border-0 rounded-3xl tv-focusable flex-shrink-0
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
                    
                    <div className="relative z-10 h-full flex flex-col items-center justify-center text-center p-4">
                      <div className="flex-shrink-0 mb-2" style={{ 
                        width: layoutMode === 'grid' ? 'clamp(48px, 6vw, 100px)' : 'clamp(40px, 5vw, 80px)',
                        aspectRatio: '1 / 1'
                      }}>
                        <ButtonIcon 
                          className="text-white drop-shadow-xl w-full h-full"
                        />
                      </div>
                      <h3 className="font-bold mb-1 text-white leading-tight text-shadow-strong font-quicksand" style={{ fontSize: 'clamp(0.875rem, 1.5vw, 1.75rem)' }}>
                        {button.title}
                      </h3>
                      {layoutMode === 'grid' && (
                        <p className="text-white/95 leading-tight text-shadow-soft font-nunito" style={{ fontSize: 'clamp(0.75rem, 1vw, 1.25rem)' }}>
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