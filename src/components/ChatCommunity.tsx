import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Send, User, MessageSquare, Brain, Loader2, MessageCircle, Plus, Clock, CheckCircle, AlertCircle, X, Check } from 'lucide-react';
import VoiceInput from '@/components/VoiceInput';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useToast } from '@/hooks/use-toast';
import { useWixIntegration } from '@/hooks/useWixIntegration';
import { useSupportTickets, SupportTicket } from '@/hooks/useSupportTickets';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

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
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [showNewTicketForm, setShowNewTicketForm] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newMessage, setNewMessage] = useState('');
  
  const { user } = useAuth();
  const { profile, checkCredits, deductCredits } = useUserProfile();
  const { toast } = useToast();
  const { sendMessage } = useWixIntegration();
  const { tickets, messages, loading, fetchTicketMessages, createTicket, sendMessage: sendTicketMessage, closeTicket } = useSupportTickets(user);
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Helper to check if ticket is active (has activity in last 24 hours)
  const isTicketActive = (ticket: SupportTicket) => {
    if (ticket.status === 'closed' || ticket.status === 'resolved') return false;
    const lastActivity = new Date(ticket.last_message_at);
    const now = new Date();
    const hoursDiff = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60);
    return hoursDiff < 24;
  };

  const handleViewTicket = async (ticket: SupportTicket) => {
    setSelectedTicket(ticket);
    await fetchTicketMessages(ticket.id);
  };

  const handleSendReply = async () => {
    if (!selectedTicket || !replyMessage.trim() || replySending) return;
    const messageToSend = replyMessage.trim();
    setReplyMessage(''); // Clear immediately to prevent double-send
    setReplySending(true);
    try {
      await sendTicketMessage(selectedTicket.id, messageToSend);
    } catch (error) {
      console.error('Error sending reply:', error);
      setReplyMessage(messageToSend); // Restore message if failed
    } finally {
      setReplySending(false);
    }
  };

  const handleCreateTicket = async () => {
    if (!user) {
      toast({
        title: "Login required",
        description: "Please sign in to create a support ticket.",
        variant: "destructive",
      });
      return;
    }
    if (!newSubject.trim() || !newMessage.trim()) {
      toast({
        title: "Missing information",
        description: "Please fill in both subject and message.",
        variant: "destructive",
      });
      return;
    }
    try {
      const ticketId = await createTicket(newSubject, newMessage);
      setNewSubject('');
      setNewMessage('');
      setShowNewTicketForm(false);
      // Auto-open the new ticket
      const newTicket = tickets.find(t => t.id === ticketId);
      if (newTicket) {
        handleViewTicket(newTicket);
      }
    } catch (error) {
      console.error('Error creating ticket:', error);
    }
  };

  const handleCloseTicket = async () => {
    if (!selectedTicket) return;
    try {
      await closeTicket(selectedTicket.id);
      setSelectedTicket(null);
    } catch (error) {
      console.error('Error closing ticket:', error);
    }
  };

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
  // Admin tab (4+): depends on view state (list, new ticket form, or viewing ticket)
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
      // New ticket form view
      if (showNewTicketForm) {
        return [
          ...header,
          { id: 'new-subject', type: 'input' },
          { id: 'new-message', type: 'textarea' },
          { id: 'submit-ticket', type: 'button' },
          { id: 'cancel-ticket', type: 'button' },
        ];
      }
      // Viewing a ticket
      if (selectedTicket) {
        const elements = [
          ...header,
          { id: 'back-to-tickets', type: 'button' },
        ];
        if (selectedTicket.status !== 'closed') {
          elements.push({ id: 'close-ticket', type: 'button' });
        }
        elements.push({ id: 'message-scroll', type: 'scroll' }); // Virtual element for scrolling messages
        if (selectedTicket.status !== 'closed') {
          elements.push({ id: 'reply-input', type: 'textarea' });
          elements.push({ id: 'reply-send', type: 'button' });
        }
        return elements;
      }
      // Ticket list view
      const ticketElements = tickets.map((ticket, index) => ({
        id: `ticket-${index}`,
        type: 'button',
        ticketId: ticket.id,
      }));
      return [
        ...header,
        { id: 'create-ticket', type: 'button' },
        ...ticketElements,
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
  }, [activeTab, showNewTicketForm, selectedTicket, tickets]);

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

      // When in a textarea, allow arrow keys to navigate away (not inside the field)
      // We blur the element first to allow D-pad navigation
      if (isTyping && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        (target as HTMLElement).blur();
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

      // Handle message scrolling when focused on the scroll element
      const scrollMessages = (direction: 'up' | 'down') => {
        if (messagesContainerRef.current) {
          const scrollAmount = 100;
          messagesContainerRef.current.scrollBy({
            top: direction === 'down' ? scrollAmount : -scrollAmount,
            behavior: 'smooth',
          });
        }
      };

      switch (event.key) {
        case 'ArrowDown':
          // If focused on message-scroll, scroll down instead of changing focus
          if (currentFocusId === 'message-scroll') {
            scrollMessages('down');
            return;
          }
          setFocusIndex(prev => {
            // From back button (index 0), go to the current active tab
            if (prev === 0) {
              const tabIndex = activeTab === 'admin' ? 1 : activeTab === 'community' ? 2 : 3;
              return tabIndex;
            }
            // From tabs (indices 1, 2, 3), go to first content item (index 4)
            if (prev >= 1 && prev <= 3) {
              return Math.min(4, maxIndex);
            }
            // Move down through content items
            if (prev < maxIndex) {
              return prev + 1;
            }
            return prev; // Stay in place if at bottom
          });
          break;

        case 'ArrowUp':
          // If focused on message-scroll, scroll up instead of changing focus
          if (currentFocusId === 'message-scroll') {
            scrollMessages('up');
            return;
          }
          setFocusIndex(prev => {
            // From first content item (index 4), go to active tab
            if (prev === 4) {
              const tabIndex = activeTab === 'admin' ? 1 : activeTab === 'community' ? 2 : 3;
              return tabIndex;
            }
            // From other content items, go up one
            if (prev > 4) {
              return prev - 1;
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
          } else if (currentFocusId === 'visit-forum') {
            setFocusIndex(elements.findIndex(e => e.id === 'join-groups'));
          } else if (currentFocusId === 'ai-input') {
            setFocusIndex(elements.findIndex(e => e.id === 'ai-send'));
          } else if (currentFocusId === 'submit-ticket') {
            setFocusIndex(elements.findIndex(e => e.id === 'cancel-ticket'));
          } else if (currentFocusId === 'back-to-tickets') {
            const closeIdx = elements.findIndex(e => e.id === 'close-ticket');
            if (closeIdx !== -1) setFocusIndex(closeIdx);
          } else if (currentFocusId === 'reply-input') {
            setFocusIndex(elements.findIndex(e => e.id === 'reply-send'));
          }
          break;

        case 'ArrowLeft':
          if (currentFocusId === 'tab-community') {
            setFocusIndex(elements.findIndex(e => e.id === 'tab-admin'));
          } else if (currentFocusId === 'tab-ai') {
            setFocusIndex(elements.findIndex(e => e.id === 'tab-community'));
          } else if (currentFocusId === 'join-groups') {
            setFocusIndex(elements.findIndex(e => e.id === 'visit-forum'));
          } else if (currentFocusId === 'ai-send') {
            setFocusIndex(elements.findIndex(e => e.id === 'ai-input'));
          } else if (currentFocusId === 'cancel-ticket') {
            setFocusIndex(elements.findIndex(e => e.id === 'submit-ticket'));
          } else if (currentFocusId === 'close-ticket') {
            setFocusIndex(elements.findIndex(e => e.id === 'back-to-tickets'));
          } else if (currentFocusId === 'reply-send') {
            setFocusIndex(elements.findIndex(e => e.id === 'reply-input'));
          }
          break;

        case 'Enter':
        case ' ':
          // Execute action based on current focus
          if (currentFocusId === 'back') {
            onBack();
          } else if (currentFocusId === 'tab-admin') {
            setActiveTab('admin');
            setFocusIndex(1);
          } else if (currentFocusId === 'tab-community') {
            setActiveTab('community');
            setFocusIndex(2);
          } else if (currentFocusId === 'tab-ai') {
            setActiveTab('ai');
            setFocusIndex(3);
          } else if (currentFocusId === 'create-ticket') {
            setShowNewTicketForm(true);
            setFocusIndex(4); // Focus on subject input
          } else if (currentFocusId.startsWith('ticket-')) {
            const ticketIndex = parseInt(currentFocusId.replace('ticket-', ''));
            const ticket = tickets[ticketIndex];
            if (ticket) handleViewTicket(ticket);
          } else if (currentFocusId === 'back-to-tickets') {
            setSelectedTicket(null);
            setShowNewTicketForm(false);
            setFocusIndex(4); // Back to create-ticket button
          } else if (currentFocusId === 'close-ticket') {
            handleCloseTicket();
          } else if (currentFocusId === 'new-subject' || currentFocusId === 'new-message' || currentFocusId === 'reply-input' || currentFocusId === 'ai-input') {
            // Focus the actual input/textarea element for typing
            setTimeout(() => {
              const el = containerRef.current?.querySelector(`[data-focus-id="${currentFocusId}"]`) as HTMLInputElement | HTMLTextAreaElement;
              if (el) {
                el.focus();
                // Move cursor to end
                const len = el.value?.length || 0;
                el.setSelectionRange(len, len);
              }
            }, 0);
          } else if (currentFocusId === 'submit-ticket') {
            handleCreateTicket();
          } else if (currentFocusId === 'cancel-ticket') {
            setShowNewTicketForm(false);
            setFocusIndex(4);
          } else if (currentFocusId === 'reply-send') {
            handleSendReply();
          } else if (currentFocusId === 'visit-forum') {
            onNavigate?.('wix-forum');
          } else if (currentFocusId === 'join-groups') {
            window.open('https://snowmediaent.com/groups', '_blank');
          } else if (currentFocusId === 'ai-send') {
            sendAiMessage();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [focusIndex, currentFocusId, getFocusableElements, onBack, onNavigate, activeTab, sendAiMessage, tickets, selectedTicket, showNewTicketForm, handleViewTicket, handleCloseTicket, handleCreateTicket, handleSendReply]);

  // Auto-focus input/textarea when navigating to them with D-pad
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-focus-id="${currentFocusId}"]`) as HTMLElement;
    if (!el) return;
    
    // Use scrollIntoView for reliable cross-browser scrolling
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    
    // Auto-focus input/textarea elements when navigated to
    if (['new-subject', 'new-message', 'reply-input', 'ai-input'].includes(currentFocusId)) {
      setTimeout(() => {
        const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
        inputEl.focus();
        const len = inputEl.value?.length || 0;
        inputEl.setSelectionRange(len, len);
      }, 100);
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
            User Support
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

        {/* User Support Tab Content */}
        {activeTab === 'admin' && (
          <Card className="bg-gradient-to-br from-orange-900/30 to-slate-900 border-orange-700 p-6 min-h-[60vh]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-2xl font-bold text-white">Support Tickets</h3>
              {!selectedTicket && !showNewTicketForm && (
                <Button 
                  onClick={() => {
                    if (!user) {
                      toast({
                        title: "Sign in required",
                        description: "Please sign in to create a support ticket.",
                        variant: "destructive",
                      });
                      return;
                    }
                    setShowNewTicketForm(true);
                  }}
                  data-focus-id="create-ticket"
                  className={`bg-blue-600 hover:bg-blue-700 transition-all duration-200 ${focusRing('create-ticket')}`}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create New Ticket
                </Button>
              )}
              {showNewTicketForm && (
                <Button 
                  onClick={() => { setSelectedTicket(null); setShowNewTicketForm(false); }}
                  variant="outline"
                  data-focus-id="back-to-tickets"
                  className={`border-orange-500 text-orange-400 hover:bg-orange-600 transition-all duration-200 ${focusRing('back-to-tickets')}`}
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Tickets
                </Button>
              )}
            </div>

            {/* New Ticket Form */}
            {showNewTicketForm && (
              <div className="space-y-4">
                <div>
                  <label className="block text-white font-semibold mb-2">Subject</label>
                  <Input 
                    value={newSubject}
                    onChange={(e) => setNewSubject(e.target.value)}
                    placeholder="What do you need help with?"
                    data-focus-id="new-subject"
                    className={`bg-slate-800 border-slate-600 text-white transition-all duration-200 ${isFocused('new-subject') ? 'ring-4 ring-brand-ice' : ''}`}
                  />
                </div>
                <div>
                  <label className="block text-white font-semibold mb-2">Message</label>
                  <Textarea 
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Describe your issue in detail..."
                    data-focus-id="new-message"
                    className={`bg-slate-800 border-slate-600 text-white min-h-32 transition-all duration-200 ${isFocused('new-message') ? 'ring-4 ring-brand-ice' : ''}`}
                  />
                </div>
                <div className="flex gap-4">
                  <Button 
                    type="button"
                    onClick={handleCreateTicket}
                    disabled={loading}
                    data-focus-id="submit-ticket"
                    className={`bg-brand-gold hover:bg-brand-gold/80 transition-all duration-200 ${focusRing('submit-ticket')}`}
                  >
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                    Submit Ticket
                  </Button>
                  <Button 
                    type="button"
                    onClick={() => setShowNewTicketForm(false)}
                    variant="outline"
                    data-focus-id="cancel-ticket"
                    className={`border-slate-600 text-slate-300 transition-all duration-200 ${focusRing('cancel-ticket')}`}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* View Single Ticket */}
            {selectedTicket && (
              <div className="flex flex-col h-[calc(100vh-280px)]">
                {/* Header Row - Back, Subject, Status, Close all inline */}
                <div className="flex items-center gap-3 mb-4">
                  <Button 
                    onClick={() => { setSelectedTicket(null); setShowNewTicketForm(false); }}
                    variant="outline"
                    size="sm"
                    data-focus-id="back-to-tickets"
                    className={`border-orange-500 text-orange-400 hover:bg-orange-600 transition-all duration-200 shrink-0 ${focusRing('back-to-tickets')}`}
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Back
                  </Button>
                  {selectedTicket.status !== 'closed' && (
                    <Button 
                      onClick={handleCloseTicket}
                      variant="outline"
                      size="sm"
                      data-focus-id="close-ticket"
                      className={`border-green-500 text-green-400 hover:bg-green-600 transition-all duration-200 shrink-0 ${focusRing('close-ticket')}`}
                    >
                      <Check className="w-3 h-3 mr-1" />
                      Close Ticket
                    </Button>
                  )}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <h4 className="text-xl font-semibold text-slate-900 truncate">{selectedTicket.subject}</h4>
                    <Badge className={`shrink-0 ${
                      selectedTicket.status === 'closed' ? 'bg-slate-600' :
                      isTicketActive(selectedTicket) ? 'bg-green-600' : 'bg-orange-600'
                    }`}>
                      {selectedTicket.status === 'closed' ? 'Closed' : isTicketActive(selectedTicket) ? 'Active' : 'Open'}
                    </Badge>
                  </div>
                  <span className="text-white text-sm shrink-0">
                    {format(new Date(selectedTicket.created_at), 'MMM d, yyyy h:mm a')}
                  </span>
                </div>

                {/* Messages - Scrollable with D-pad - Takes remaining space */}
                <div 
                  ref={messagesContainerRef}
                  data-focus-id="message-scroll"
                  className={`bg-slate-800 rounded-lg p-4 flex-1 overflow-y-auto space-y-3 transition-all duration-200 ${isFocused('message-scroll') ? 'ring-4 ring-brand-ice' : ''}`}
                >
                  {isFocused('message-scroll') && (
                    <div className="text-center text-xs text-brand-ice mb-2 animate-pulse">
                      ↑↓ Use D-pad to scroll messages
                    </div>
                  )}
                  {(messages[selectedTicket.id] || []).map((msg) => (
                    <div 
                      key={msg.id}
                      className={`p-3 rounded-lg ${
                        msg.sender_type === 'user' 
                          ? 'bg-blue-900/50 ml-8' 
                          : 'bg-orange-900/50 mr-8'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-semibold ${
                          msg.sender_type === 'user' ? 'text-blue-300' : 'text-orange-300'
                        }`}>
                          {msg.sender_type === 'user' ? 'You' : 'Support'}
                        </span>
                        <span className="text-xs text-white">
                          {format(new Date(msg.created_at), 'MMM d, h:mm a')}
                        </span>
                      </div>
                      <p className="text-white text-sm">{msg.message}</p>
                    </div>
                  ))}
                </div>

                {/* Reply box - Fixed at bottom */}
                {selectedTicket.status !== 'closed' && (
                  <div className="flex gap-2 mt-4 shrink-0">
                    <Textarea 
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      placeholder="Type your reply..."
                      data-focus-id="reply-input"
                      disabled={replySending}
                      className={`bg-slate-800 border-slate-600 text-white flex-1 transition-all duration-200 ${isFocused('reply-input') ? 'ring-4 ring-brand-ice' : ''}`}
                    />
                    <Button 
                      type="button"
                      onClick={handleSendReply}
                      disabled={!replyMessage.trim() || replySending}
                      data-focus-id="reply-send"
                      className={`bg-brand-gold hover:bg-brand-gold/80 transition-all duration-200 ${focusRing('reply-send')}`}
                    >
                      {replySending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Tickets List */}
            {!selectedTicket && !showNewTicketForm && (
              <div className="space-y-3">
                {loading ? (
                  <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 mx-auto animate-spin text-orange-400" />
                    <p className="text-slate-400 mt-2">Loading tickets...</p>
                  </div>
                ) : tickets.length === 0 ? (
                  <div className="text-center py-8">
                    <MessageCircle className="w-16 h-16 mx-auto text-orange-400/50 mb-4" />
                    <h4 className="text-xl font-semibold text-white mb-2">No Support Tickets</h4>
                    <p className="text-slate-400">
                      Use the "Create New Ticket" button above to get help from our support team.
                    </p>
                  </div>
                ) : (
                  tickets.map((ticket, index) => (
                    <div
                      key={ticket.id}
                      onClick={() => handleViewTicket(ticket)}
                      data-focus-id={`ticket-${index}`}
                      className={`bg-slate-800 hover:bg-slate-700 rounded-lg p-4 cursor-pointer transition-all duration-200 border border-slate-700 hover:border-orange-500 ${isFocused(`ticket-${index}`) ? 'ring-4 ring-brand-ice scale-[1.02]' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-white">{ticket.subject}</h4>
                            {ticket.user_has_unread && (
                              <Badge className="bg-red-600 text-xs">New Reply</Badge>
                            )}
                          </div>
                          <p className="text-slate-400 text-sm mt-1">
                            Last activity: {format(new Date(ticket.last_message_at), 'MMM d, yyyy h:mm a')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {isTicketActive(ticket) && ticket.status !== 'closed' && (
                            <Clock className="w-4 h-4 text-green-400 animate-pulse" />
                          )}
                          <Badge className={
                            ticket.status === 'closed' ? 'bg-slate-600' :
                            ticket.status === 'resolved' ? 'bg-green-600' :
                            'bg-orange-600'
                          }>
                            {ticket.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
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
