import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Send, User, MessageSquare, Brain, Loader2, MessageCircle, Plus } from 'lucide-react';
import VoiceInput from '@/components/VoiceInput';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useToast } from '@/hooks/use-toast';
import { useWixIntegration } from '@/hooks/useWixIntegration';
import { supabase } from '@/integrations/supabase/client';

interface ChatCommunityProps {
  onBack: () => void;
  onNavigate?: (section: string) => void;
}

const ChatCommunity = ({ onBack, onNavigate }: ChatCommunityProps) => {
  const [activeTab, setActiveTab] = useState<'admin' | 'community' | 'ai'>('admin');
  const [adminMessage, setAdminMessage] = useState('');
  const [adminSubject, setAdminSubject] = useState('');
  const [aiMessage, setAiMessage] = useState('');
  const [aiChat, setAiChat] = useState<Array<{role: 'user' | 'ai', content: string, timestamp: Date}>>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  
  const { user } = useAuth();
  const { profile, checkCredits, deductCredits } = useUserProfile();
  const { toast } = useToast();
  const { sendMessage } = useWixIntegration();
  const containerRef = useRef<HTMLDivElement>(null);

  // AI function handler
  const handleAiFunction = useCallback((functionCall: any) => {
    const { name, arguments: args } = functionCall;
    
    switch (name) {
      case 'navigate_to_section':
        if (onNavigate) {
          const sectionMap: Record<string, string> = {
            'install-apps': 'apps',
            'support': 'videos',
            'media': 'store',
            'user': 'user'
          };
          const targetSection = sectionMap[args.section] || args.section;
          onNavigate(targetSection);
          toast({
            title: "Navigation",
            description: `Navigating to ${args.section}: ${args.reason}`,
          });
        }
        break;
      
      case 'find_support_video':
        if (onNavigate) {
          onNavigate('videos');
          toast({
            title: "Support Videos",
            description: `Looking for videos about: ${args.query}${args.app_name ? ` (${args.app_name})` : ''}`,
          });
        }
        break;
      
      case 'change_background':
        if (args.action === 'open_settings' && onNavigate) {
          onNavigate('settings');
          toast({
            title: "Background Settings",
            description: "Opening settings to change background",
          });
        } else {
          toast({
            title: "Background Change",
            description: args.action === 'suggest_themes' 
              ? "You can change backgrounds in Settings > Media Management" 
              : "You can upload custom backgrounds in Settings",
          });
        }
        break;
      
      case 'open_store_section':
        if (onNavigate) {
          if (args.section === 'credits') {
            onNavigate('credits');
          } else if (args.section === 'media') {
            onNavigate('store');
          } else {
            onNavigate('apps');
          }
          toast({
            title: "Store",
            description: `Opening ${args.section} store${args.search_term ? ` - searching for: ${args.search_term}` : ''}`,
          });
        }
        break;
      
      case 'help_with_installation':
        if (onNavigate) {
          onNavigate('apps');
          toast({
            title: "App Installation",
            description: `Helping with ${args.app_name} installation${args.device_type ? ` on ${args.device_type}` : ''}`,
          });
        }
        break;
      
      case 'show_credits_info':
        if (args.action === 'purchase' && onNavigate) {
          onNavigate('credits');
        }
        toast({
          title: "Credits",
          description: args.action === 'balance' 
            ? `Current balance: ${profile?.credits?.toFixed(2) || '0.00'} credits`
            : args.action === 'purchase'
            ? "Opening credit store"
            : "Showing credit information",
        });
        break;
      
      default:
        console.log('Unknown function:', name, args);
    }
  }, [onNavigate, profile, toast]);

  const sendAdminMessage = async () => {
    if (!adminMessage.trim() || !adminSubject.trim()) {
      toast({
        title: "Missing information",
        description: "Please fill in both subject and message.",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Login required",
        description: "Please sign in to send messages to admin.",
        variant: "destructive",
      });
      return;
    }

    setAdminLoading(true);

    try {
      const result = await sendMessage(
        adminSubject,
        adminMessage,
        user.email || '',
        profile?.full_name || 'Snow Media User'
      );

      if (result.success) {
        toast({
          title: "Message sent!",
          description: "Your message has been sent to Snow Media admin.",
        });
        setAdminMessage('');
        setAdminSubject('');
      } else {
        throw new Error('Failed to send message');
      }
    } catch (error) {
      console.error('Admin message error:', error);
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    } finally {
      setAdminLoading(false);
    }
  };

  const sendAiMessage = async () => {
    if (!aiMessage.trim()) return;
    
    if (!user) {
      toast({
        title: "Login required",
        description: "Please sign in to use Snow Media AI.",
        variant: "destructive",
      });
      return;
    }

    const aiCost = 0.01;
    if (!checkCredits(aiCost)) {
      toast({
        title: "Insufficient credits",
        description: `You need ${aiCost.toFixed(2)} credits. Your balance: ${profile?.credits?.toFixed(2) || '0.00'}`,
        variant: "destructive",
      });
      return;
    }

    const userMessage = aiMessage;
    setAiMessage('');
    setAiLoading(true);

    setAiChat(prev => [...prev, {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    }]);

    try {
      const { data, error } = await supabase.functions.invoke('snow-media-ai', {
        body: { message: userMessage, userId: user.id }
      });

      if (error) throw error;

      await deductCredits(aiCost, `Snow Media AI Chat - "${userMessage.substring(0, 50)}..."`);

      setAiChat(prev => [...prev, {
        role: 'ai',
        content: data.message,
        timestamp: new Date()
      }]);

      if (data.functionCall) {
        handleAiFunction(data.functionCall);
      }

    } catch (error) {
      console.error('AI Error:', error);
      toast({
        title: "AI Error",
        description: "Failed to get AI response. Please try again.",
        variant: "destructive",
      });
    } finally {
      setAiLoading(false);
    }
  };

  // Define all focusable elements by index
  // 0: back, 1: tab-admin, 2: tab-community, 3: tab-ai
  // Admin tab (4+): view-tickets, create-ticket, subject, message, admin-send
  // Community tab (4+): visit-forum, join-groups
  // AI tab (4+): ai-input, ai-send
  const getFocusableElements = useCallback(() => {
    const header = [
      { id: 'back', type: 'button' },
      { id: 'tab-admin', type: 'tab' },
      { id: 'tab-community', type: 'tab' },
      { id: 'tab-ai', type: 'tab' },
    ];

    if (activeTab === 'admin') {
      return [
        ...header,
        { id: 'view-tickets', type: 'button' },
        { id: 'create-ticket', type: 'button' },
        { id: 'subject', type: 'input' },
        { id: 'message', type: 'textarea' },
        { id: 'admin-send', type: 'button' },
      ];
    } else if (activeTab === 'community') {
      return [
        ...header,
        { id: 'visit-forum', type: 'button' },
        { id: 'join-groups', type: 'button' },
      ];
    } else {
      return [
        ...header,
        { id: 'ai-input', type: 'input' },
        { id: 'ai-send', type: 'button' },
      ];
    }
  }, [activeTab]);

  const focusableElements = getFocusableElements();
  const clampedIndex = Math.min(focusIndex, focusableElements.length - 1);
  const currentElement = focusableElements[clampedIndex];
  const currentFocusId = currentElement?.id || 'back';

  const isFocused = (id: string) => currentFocusId === id;
  const focusRing = (id: string) => isFocused(id) ? 'ring-4 ring-brand-ice scale-105 z-10' : '';

  // D-pad Navigation Handler
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      // Handle back button (always works)
      if (event.key === 'Escape' || event.keyCode === 4 || event.code === 'GoBack') {
        event.preventDefault();
        event.stopPropagation();
        onBack();
        return;
      }

      // Allow backspace when typing
      if (event.key === 'Backspace' && isTyping) {
        return;
      }

      // Allow normal typing except arrows
      if (isTyping && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        return;
      }

      // CRITICAL: Prevent default on navigation keys
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }

      const elements = getFocusableElements();
      const maxIndex = elements.length - 1;

      switch (event.key) {
        case 'ArrowDown':
          setFocusIndex(prev => {
            // From back button (index 0), go to the current active tab
            if (prev === 0) {
              const tabIndex = activeTab === 'admin' ? 1 : activeTab === 'community' ? 2 : 3;
              return tabIndex;
            }
            // From tabs (indices 1, 2, 3), go to first content item (index 4)
            if (prev >= 1 && prev <= 3) {
              return 4;
            }
            // Admin tab: view-tickets(4) -> subject(6), create-ticket(5) -> subject(6), subject(6) -> message(7), message(7) -> admin-send(8)
            // Community tab: visit-forum(4) and join-groups(5) are on same row - no down action
            // AI tab: ai-input(4) -> ai-send handled by right arrow
            if (activeTab === 'admin') {
              if (prev === 4 || prev === 5) return 6; // view-tickets or create-ticket -> subject
              if (prev === 6) return 7; // subject -> message
              if (prev === 7) return 8; // message -> admin-send
            }
            return prev; // Stay in place if no valid move
          });
          break;

        case 'ArrowUp':
          setFocusIndex(prev => {
            // From any content item, navigate up logically
            if (prev >= 4) {
              // Admin tab: admin-send(8) -> message(7), message(7) -> subject(6), subject(6) -> view-tickets(4)
              if (activeTab === 'admin') {
                if (prev === 8) return 7; // admin-send -> message
                if (prev === 7) return 6; // message -> subject
                if (prev === 6) return 4; // subject -> view-tickets
                if (prev === 4 || prev === 5) return 1; // view-tickets/create-ticket -> tab-admin
              } else if (activeTab === 'community') {
                // visit-forum(4) or join-groups(5) -> tab-community
                if (prev === 4 || prev === 5) return 2;
              } else if (activeTab === 'ai') {
                // ai-input(4) or ai-send(5) -> tab-ai
                if (prev === 4 || prev === 5) return 3;
              }
              // Default: go to current tab
              const tabIndex = activeTab === 'admin' ? 1 : activeTab === 'community' ? 2 : 3;
              return tabIndex;
            }
            // From any tab, go to back button
            if (prev >= 1 && prev <= 3) {
              return 0;
            }
            return 0;
          });
          break;

        case 'ArrowRight':
          // Handle horizontal navigation ONLY for items on the same row
          if (currentFocusId === 'tab-admin') {
            setFocusIndex(elements.findIndex(e => e.id === 'tab-community'));
          } else if (currentFocusId === 'tab-community') {
            setFocusIndex(elements.findIndex(e => e.id === 'tab-ai'));
          } else if (currentFocusId === 'view-tickets') {
            setFocusIndex(elements.findIndex(e => e.id === 'create-ticket'));
          } else if (currentFocusId === 'visit-forum') {
            setFocusIndex(elements.findIndex(e => e.id === 'join-groups'));
          } else if (currentFocusId === 'ai-input') {
            setFocusIndex(elements.findIndex(e => e.id === 'ai-send'));
          }
          break;

        case 'ArrowLeft':
          if (currentFocusId === 'tab-community') {
            setFocusIndex(elements.findIndex(e => e.id === 'tab-admin'));
          } else if (currentFocusId === 'tab-ai') {
            setFocusIndex(elements.findIndex(e => e.id === 'tab-community'));
          } else if (currentFocusId === 'create-ticket') {
            setFocusIndex(elements.findIndex(e => e.id === 'view-tickets'));
          } else if (currentFocusId === 'join-groups') {
            setFocusIndex(elements.findIndex(e => e.id === 'visit-forum'));
          } else if (currentFocusId === 'ai-send') {
            setFocusIndex(elements.findIndex(e => e.id === 'ai-input'));
          }
          break;

        case 'Enter':
        case ' ':
          // Execute action based on current focus
          if (currentFocusId === 'back') {
            onBack();
          } else if (currentFocusId === 'tab-admin') {
            setActiveTab('admin');
            setFocusIndex(1); // Stay on this tab
          } else if (currentFocusId === 'tab-community') {
            setActiveTab('community');
            setFocusIndex(2);
          } else if (currentFocusId === 'tab-ai') {
            setActiveTab('ai');
            setFocusIndex(3);
          } else if (currentFocusId === 'view-tickets') {
            onNavigate?.('support-tickets');
          } else if (currentFocusId === 'create-ticket') {
            onNavigate?.('create-ticket');
          } else if (currentFocusId === 'visit-forum') {
            onNavigate?.('wix-forum');
          } else if (currentFocusId === 'join-groups') {
            window.open('https://snowmediaent.com/groups', '_blank');
          } else if (currentFocusId === 'subject' || currentFocusId === 'message' || currentFocusId === 'ai-input') {
            // Focus the actual input element
            const el = containerRef.current?.querySelector(`[data-focus-id="${currentFocusId}"]`) as HTMLElement;
            el?.focus();
          } else if (currentFocusId === 'admin-send') {
            sendAdminMessage();
          } else if (currentFocusId === 'ai-send') {
            sendAiMessage();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [focusIndex, currentFocusId, getFocusableElements, onBack, onNavigate, activeTab, sendAdminMessage, sendAiMessage]);

  // Scroll focused element into view - always keep selector visible
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-focus-id="${currentFocusId}"]`) as HTMLElement;
    if (!el) return;
    
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const margin = 150; // Extra margin for visibility
    
    // Check if element is off-screen in any direction
    if (rect.top < margin) {
      // Element is above viewport - scroll up
      window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - margin), behavior: 'smooth' });
    } else if (rect.bottom > viewportHeight - margin) {
      // Element is below viewport - scroll down to make it visible
      window.scrollTo({ top: window.scrollY + rect.bottom - viewportHeight + margin, behavior: 'smooth' });
    }
  }, [currentFocusId]);

  // Reset focus when tab changes
  useEffect(() => {
    // Keep focus at tab level when switching tabs
    const tabIndex = activeTab === 'admin' ? 1 : activeTab === 'community' ? 2 : 3;
    setFocusIndex(tabIndex);
  }, [activeTab]);

  return (
    <div ref={containerRef} className="tv-scroll-container tv-safe">
      <div className="max-w-6xl mx-auto pb-16">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center w-full justify-start">
            <Button 
              onClick={onBack}
              variant="gold" 
              size="lg"
              data-focus-id="back"
              className={`transition-all duration-200 ${focusRing('back')}`}
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back to Home
            </Button>
          </div>
          <div className="text-center mt-4">
            <h1 className="text-4xl font-bold text-white mb-2">Chat & Community</h1>
            <p className="text-xl text-blue-200">Connect with admin and community</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex mb-6 gap-4">
          <Button
            onClick={() => setActiveTab('admin')}
            variant={activeTab === 'admin' ? 'default' : 'outline'}
            data-focus-id="tab-admin"
            className={`text-lg px-6 py-3 transition-all duration-200 ${focusRing('tab-admin')} ${
              activeTab === 'admin' 
                ? 'bg-brand-gold hover:bg-brand-gold/80' 
                : 'bg-transparent border-brand-gold text-brand-gold hover:bg-brand-gold'
            }`}
          >
            <User className="w-5 h-5 mr-2" />
            Admin Support
          </Button>
          <Button
            onClick={() => setActiveTab('community')}
            variant={activeTab === 'community' ? 'default' : 'outline'}
            data-focus-id="tab-community"
            className={`text-lg px-6 py-3 transition-all duration-200 ${focusRing('tab-community')} ${
              activeTab === 'community' 
                ? 'bg-green-600 hover:bg-green-700' 
                : 'bg-transparent border-green-500 text-green-400 hover:bg-green-600'
            }`}
          >
            <MessageSquare className="w-5 h-5 mr-2" />
            Community
          </Button>
          <Button
            onClick={() => setActiveTab('ai')}
            variant={activeTab === 'ai' ? 'default' : 'outline'}
            data-focus-id="tab-ai"
            className={`text-lg px-6 py-3 transition-all duration-200 ${focusRing('tab-ai')} ${
              activeTab === 'ai' 
                ? 'bg-purple-600 hover:bg-purple-700' 
                : 'bg-transparent border-purple-500 text-purple-400 hover:bg-purple-600'
            }`}
          >
            <Brain className="w-5 h-5 mr-2" />
            Snow Media AI
          </Button>
        </div>

        {/* Admin Tab Content */}
        {activeTab === 'admin' && (
          <Card className="bg-gradient-to-br from-orange-900/30 to-slate-900 border-orange-700 p-6">
            <h3 className="text-2xl font-bold text-white mb-4">Support Ticket System</h3>
            <p className="text-orange-200 mb-6">
              Create and manage support tickets. Messages are sent to support@snowmediaent.com.
            </p>
            
            <div className="flex gap-4 mb-6">
              <Button 
                onClick={() => onNavigate?.('support-tickets')}
                data-focus-id="view-tickets"
                className={`bg-orange-600 hover:bg-orange-700 transition-all duration-200 ${focusRing('view-tickets')}`}
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                View Support Tickets
              </Button>
              <Button 
                onClick={() => onNavigate?.('create-ticket')}
                data-focus-id="create-ticket"
                className={`bg-blue-600 hover:bg-blue-700 transition-all duration-200 ${focusRing('create-ticket')}`}
              >
                <Plus className="w-4 h-4 mr-2" />
                Create New Ticket
              </Button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-white font-semibold mb-2">Subject</label>
                <Input 
                  value={adminSubject}
                  onChange={(e) => setAdminSubject(e.target.value)}
                  placeholder="What do you need help with?"
                  data-focus-id="subject"
                  className={`bg-slate-800 border-slate-600 text-white text-lg py-3 transition-all duration-200 rounded-md ${isFocused('subject') ? 'ring-4 ring-brand-ice' : ''}`}
                  disabled={adminLoading}
                />
              </div>
              
              <div>
                <label className="block text-white font-semibold mb-2">Message</label>
                <Textarea 
                  value={adminMessage}
                  onChange={(e) => setAdminMessage(e.target.value)}
                  placeholder="Describe your issue or question in detail..."
                  data-focus-id="message"
                  className={`bg-slate-800 border-slate-600 text-white min-h-32 text-lg transition-all duration-200 rounded-md ${isFocused('message') ? 'ring-4 ring-brand-ice' : ''}`}
                  disabled={adminLoading}
                />
              </div>
              
              <Button 
                onClick={sendAdminMessage}
                disabled={adminLoading || !adminMessage.trim() || !adminSubject.trim() || !user}
                data-focus-id="admin-send"
                className={`bg-brand-gold hover:bg-brand-gold/80 text-white text-lg px-8 py-3 transition-all duration-200 ${focusRing('admin-send')}`}
              >
                {adminLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5 mr-2" />
                    Send to Snow Media
                  </>
                )}
              </Button>
              
              {!user && (
                <p className="text-orange-300 text-sm mt-2">
                  Please sign in to send messages to admin
                </p>
              )}
            </div>
          </Card>
        )}

        {/* Community Tab Content */}
        {activeTab === 'community' && (
          <Card className="bg-gradient-to-br from-green-900/30 to-slate-900 border-green-700 p-6">
            <h3 className="text-2xl font-bold text-white mb-4">Community Forum</h3>
            <p className="text-green-200 mb-6">
              Connect with other Snow Media users, share tips, and get help from the community.
            </p>
            
            <div className="bg-slate-800 rounded-lg p-6 mb-6">
              <div className="text-center py-8">
                <MessageSquare className="w-16 h-16 mx-auto text-green-400/50 mb-4" />
                <h4 className="text-xl font-semibold text-white mb-2">Community Forum</h4>
                <p className="text-slate-400 mb-4">
                  Access the forum directly within the app to connect with other users.
                </p>
              </div>
            </div>
            
            <div className="flex gap-4">
              <Button 
                onClick={() => onNavigate?.('wix-forum')}
                data-focus-id="visit-forum"
                className={`bg-green-600 hover:bg-green-700 text-white text-lg px-8 py-3 flex-1 transition-all duration-200 ${focusRing('visit-forum')}`}
              >
                <MessageSquare className="w-5 h-5 mr-2" />
                Visit Community Forum
              </Button>
              <Button 
                onClick={() => window.open('https://snowmediaent.com/groups', '_blank')}
                variant="outline"
                data-focus-id="join-groups"
                className={`border-green-500 text-green-400 hover:bg-green-600 hover:text-white text-lg px-8 py-3 transition-all duration-200 ${focusRing('join-groups')}`}
              >
                <MessageSquare className="w-5 h-5 mr-2" />
                Join Groups
              </Button>
            </div>
          </Card>
        )}

        {/* AI Tab Content */}
        {activeTab === 'ai' && (
          <Card className="bg-gradient-to-br from-purple-900/30 to-slate-900 border-purple-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-2xl font-bold text-white">Snow Media AI Assistant</h3>
              {user && profile && (
                <div className="text-purple-200 text-sm">
                  Balance: {profile.credits.toFixed(2)} credits
                </div>
              )}
            </div>
            
            <p className="text-purple-200 mb-6">
              Ask me about snow media, streaming apps, or get help with your SMC app.
              <br />
              <span className="text-sm text-purple-300">Cost: 0.01 credits per message</span>
            </p>
            
            {/* AI Chat Messages */}
            <div className="bg-slate-800 rounded-lg p-4 mb-4 max-h-80 overflow-y-auto">
              {aiChat.length === 0 ? (
                <div className="text-center text-slate-400 py-8">
                  <Brain className="w-12 h-12 mx-auto mb-4 text-purple-400" />
                  <p>Start a conversation with Snow Media AI!</p>
                  <p className="text-sm mt-2">Try asking: "Help me install an app"</p>
                </div>
              ) : (
                aiChat.map((msg, index) => (
                  <div key={index} className="mb-4 last:mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`font-semibold ${
                        msg.role === 'user' ? 'text-blue-400' : 'text-purple-400'
                      }`}>
                        {msg.role === 'user' ? 'You' : 'Snow Media AI'}
                      </span>
                      <span className="text-slate-400 text-sm">
                        {msg.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-white whitespace-pre-wrap">{msg.content}</p>
                  </div>
                ))
              )}
              
              {aiLoading && (
                <div className="flex items-center text-purple-400 mt-4">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  <span>Snow Media AI is thinking...</span>
                </div>
              )}
            </div>
            
            {/* AI Input */}
            <div className="flex gap-2">
              <Input 
                value={aiMessage}
                onChange={(e) => setAiMessage(e.target.value)}
                placeholder="Ask Snow Media AI anything..."
                data-focus-id="ai-input"
                className={`bg-slate-800 border-slate-600 text-white text-lg py-3 flex-1 transition-all duration-200 rounded-md ${isFocused('ai-input') ? 'ring-4 ring-brand-ice' : ''}`}
                disabled={aiLoading || !user}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !aiLoading) {
                    sendAiMessage();
                  }
                }}
              />
              <VoiceInput
                onTranscription={(text) => setAiMessage(text)}
                className=""
              />
              <Button 
                onClick={sendAiMessage}
                disabled={aiLoading || !aiMessage.trim() || !user}
                data-focus-id="ai-send"
                className={`bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 transition-all duration-200 ${focusRing('ai-send')}`}
              >
                {aiLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </Button>
            </div>
            
            {!user && (
              <p className="text-purple-300 text-sm mt-4 text-center">
                Please sign in to use Snow Media AI
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
};

export default ChatCommunity;
