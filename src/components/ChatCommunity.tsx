
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Send, User, MessageSquare, Brain, Loader2, Mic, MicOff, ExternalLink, MessageCircle, Plus } from 'lucide-react';
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
  const [message, setMessage] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const [adminSubject, setAdminSubject] = useState('');
  const [aiMessage, setAiMessage] = useState('');
  const [aiChat, setAiChat] = useState<Array<{role: 'user' | 'ai', content: string, timestamp: Date}>>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [focusedElement, setFocusedElement] = useState<'back' | 'tab-0' | 'tab-1' | 'tab-2' | 'send' | 'voice' | string>('back');
  
  const { user } = useAuth();
  const { profile, checkCredits, deductCredits } = useUserProfile();
  const { toast } = useToast();
  const { sendMessage } = useWixIntegration();

  // Community messages will be loaded from the database once users start posting

  const handleAiFunction = (functionCall: any) => {
    const { name, arguments: args } = functionCall;
    
    switch (name) {
      case 'navigate_to_section':
        if (onNavigate) {
          // Map AI section names to app section names
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
          onNavigate('videos'); // Navigate to support videos
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
          onNavigate('apps'); // Navigate to install apps section
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
  };

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
          description: "Your message has been sent to Snow Media admin. You'll receive a response via email or phone alerts.",
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
        description: "Failed to send message. Please try again or contact support@snowmediaent.com.",
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

    const aiCost = 0.01; // 1 cent per AI message
    if (!checkCredits(aiCost)) {
      toast({
        title: "Insufficient credits",
        description: `You need ${aiCost.toFixed(2)} credits to use AI. Your balance: ${profile?.credits?.toFixed(2) || '0.00'}`,
        variant: "destructive",
      });
      return;
    }

    const userMessage = aiMessage;
    setAiMessage('');
    setAiLoading(true);

    // Add user message to chat
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

      // Deduct credits
      await deductCredits(aiCost, `Snow Media AI Chat - "${userMessage.substring(0, 50)}..."`);

      // Add AI response to chat
      setAiChat(prev => [...prev, {
        role: 'ai',
        content: data.message,
        timestamp: new Date()
      }]);

      // Handle function calls
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

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center w-full justify-between">
            <Button 
              onClick={onBack}
              variant="gold" 
              size="lg"
              className={focusedElement === 'back' ? 'ring-2 ring-brand-ice' : ''}
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back to Home
            </Button>
            <div className="invisible">
              <Button variant="gold" size="lg">Placeholder</Button>
            </div>
          </div>
          <div className="text-center mt-4">
            <h1 className="text-4xl font-bold text-white mb-2">Chat & Community</h1>
            <p className="text-xl text-blue-200">Connect with admin and community</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex mb-6 flex-wrap gap-4">
          <Button
            onClick={() => setActiveTab('admin')}
            variant={activeTab === 'admin' ? 'default' : 'outline'}
            className={`text-lg px-6 py-3 ${focusedElement === 'tab-0' ? 'ring-2 ring-white' : ''} ${
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
            className={`text-lg px-6 py-3 ${focusedElement === 'tab-1' ? 'ring-2 ring-white' : ''} ${
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
            className={`text-lg px-6 py-3 ${focusedElement === 'tab-2' ? 'ring-2 ring-white' : ''} ${
              activeTab === 'ai' 
                ? 'bg-purple-600 hover:bg-purple-700' 
                : 'bg-transparent border-purple-500 text-purple-400 hover:bg-purple-600'
            }`}
          >
            <Brain className="w-5 h-5 mr-2" />
            Snow Media AI
          </Button>
        </div>

        {/* Admin Chat */}
        {activeTab === 'admin' && (
          <Card className="bg-gradient-to-br from-orange-900/30 to-slate-900 border-orange-700 p-6">
            <h3 className="text-2xl font-bold text-white mb-4">Support Ticket System</h3>
            <p className="text-orange-200 mb-6">
              Create and manage support tickets. Messages are sent to support@snowmediaent.com with phone and email notifications!
            </p>
            
            <div className="flex gap-4 mb-4">
              <Button 
                onClick={() => onNavigate('support-tickets')}
                className="bg-orange-600 hover:bg-orange-700"
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                View Support Tickets
              </Button>
              <Button 
                onClick={() => onNavigate('create-ticket')}
                className="bg-blue-600 hover:bg-blue-700"
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
                  className="bg-slate-800 border-slate-600 text-white text-lg py-3"
                  disabled={adminLoading}
                />
              </div>
              
              <div>
                <label className="block text-white font-semibold mb-2">Message</label>
                <Textarea 
                  value={adminMessage}
                  onChange={(e) => setAdminMessage(e.target.value)}
                  placeholder="Describe your issue or question in detail..."
                  className="bg-slate-800 border-slate-600 text-white min-h-32 text-lg"
                  disabled={adminLoading}
                />
              </div>
              
              <Button 
                onClick={sendAdminMessage}
                disabled={adminLoading || !adminMessage.trim() || !adminSubject.trim() || !user}
                className={`bg-brand-gold hover:bg-brand-gold/80 text-white text-lg px-8 py-3 ${focusedElement === 'send' && activeTab === 'admin' ? 'ring-2 ring-white' : ''}`}
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

        {/* Community Forum */}
        {activeTab === 'community' && (
          <div className="space-y-6">
            <Card className="bg-gradient-to-br from-green-900/30 to-slate-900 border-green-700 p-6">
              <h3 className="text-2xl font-bold text-white mb-4">Community Forum</h3>
              <p className="text-green-200 mb-6">
                Connect with other Snow Media users, share tips, and get help from the community.
              </p>
              
              <div className="bg-slate-800 rounded-lg p-6 mb-6">
                <div className="text-center py-8">
                  <MessageSquare className="w-16 h-16 mx-auto text-green-400/50 mb-4" />
                  <h4 className="text-xl font-semibold text-white mb-2">Coming Soon!</h4>
                  <p className="text-slate-400 mb-4">
                    The community forum is being set up. In the meantime, visit our official website to connect with other users.
                  </p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <Button 
                  onClick={() => window.open('https://snowmediaent.com/forum', '_blank')}
                  className="bg-green-600 hover:bg-green-700 text-white text-lg px-8 py-3 flex-1"
                >
                  <ExternalLink className="w-5 h-5 mr-2" />
                  Visit Community Forum
                </Button>
                <Button 
                  onClick={() => window.open('https://snowmediaent.com/groups', '_blank')}
                  variant="outline"
                  className="border-green-500 text-green-400 hover:bg-green-600 hover:text-white text-lg px-8 py-3"
                >
                  <MessageSquare className="w-5 h-5 mr-2" />
                  Join Groups
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Snow Media AI Chat */}
        {activeTab === 'ai' && (
          <div className="space-y-6">
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
                Ask me about snow media, streaming apps, or get help with your SMC app. I can also navigate you to different sections!
                <br />
                <span className="text-sm text-purple-300">Cost: 0.02 credits per message</span>
              </p>
              
              {/* AI Chat Messages */}
              <div className="bg-slate-800 rounded-lg p-4 mb-4 max-h-80 overflow-y-auto">
                {aiChat.length === 0 ? (
                  <div className="text-center text-slate-400 py-8">
                    <Brain className="w-12 h-12 mx-auto mb-4 text-purple-400" />
                    <p>Start a conversation with Snow Media AI!</p>
                    <p className="text-sm mt-2">Try asking: "Help me install an app" or "Show me the video store"</p>
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
                  className="bg-slate-800 border-slate-600 text-white text-lg py-3 flex-1"
                  disabled={aiLoading || !user}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !aiLoading) {
                      sendAiMessage();
                    }
                  }}
                />
                <VoiceInput 
                  onTranscription={(text) => setAiMessage(text)}
                  className={focusedElement === 'voice' ? 'ring-2 ring-white' : ''}
                />
                <Button 
                  onClick={sendAiMessage}
                  disabled={aiLoading || !aiMessage.trim() || !user}
                  className={`bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 ${focusedElement === 'send' && activeTab === 'ai' ? 'ring-2 ring-white' : ''}`}
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
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatCommunity;
