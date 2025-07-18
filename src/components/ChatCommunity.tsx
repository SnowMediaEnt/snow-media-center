
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Send, User, MessageSquare, Brain, Loader2, Mic, MicOff } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface ChatCommunityProps {
  onBack: () => void;
  onNavigate?: (section: string) => void;
}

const ChatCommunity = ({ onBack, onNavigate }: ChatCommunityProps) => {
  const [activeTab, setActiveTab] = useState<'admin' | 'community' | 'ai'>('admin');
  const [message, setMessage] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const [aiMessage, setAiMessage] = useState('');
  const [aiChat, setAiChat] = useState<Array<{role: 'user' | 'ai', content: string, timestamp: Date}>>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  const { user } = useAuth();
  const { profile, checkCredits, deductCredits } = useUserProfile();
  const { toast } = useToast();

  const communityMessages = [
    { user: "TechUser2024", message: "Anyone know how to install Cinema HD?", time: "2 min ago" },
    { user: "StreamFan", message: "Check the Install Apps section, works great!", time: "5 min ago" },
    { user: "AndroidTVPro", message: "Snow Media added new tutorials today 🔥", time: "8 min ago" },
    { user: "MediaLover", message: "The new store update is amazing", time: "12 min ago" }
  ];

  const handleAiFunction = (functionCall: any) => {
    const { name, arguments: args } = functionCall;
    
    switch (name) {
      case 'navigate_to_section':
        if (onNavigate) {
          onNavigate(args.section);
          toast({
            title: "Navigation",
            description: `Navigating to ${args.section}: ${args.reason}`,
          });
        }
        break;
      case 'find_content':
        toast({
          title: "Search",
          description: `Searching for ${args.type}: ${args.query}`,
        });
        break;
      case 'show_credits_info':
        toast({
          title: "Credits",
          description: `Current balance: ${profile?.credits?.toFixed(2) || '0.00'} credits`,
        });
        break;
      default:
        console.log('Unknown function:', name, args);
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

    const aiCost = 0.05; // 5 cents per AI message
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
        <div className="flex items-center mb-8">
          <Button 
            onClick={onBack}
            variant="outline" 
            size="lg"
            className="mr-6 bg-blue-600 border-blue-500 text-white hover:bg-blue-700"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Home
          </Button>
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Chat & Community</h1>
            <p className="text-xl text-blue-200">Connect with admin and community</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex mb-6 flex-wrap gap-4">
          <Button
            onClick={() => setActiveTab('admin')}
            variant={activeTab === 'admin' ? 'default' : 'outline'}
            className={`text-lg px-6 py-3 ${
              activeTab === 'admin' 
                ? 'bg-orange-600 hover:bg-orange-700' 
                : 'bg-transparent border-orange-500 text-orange-400 hover:bg-orange-600'
            }`}
          >
            <User className="w-5 h-5 mr-2" />
            Admin Support
          </Button>
          <Button
            onClick={() => setActiveTab('community')}
            variant={activeTab === 'community' ? 'default' : 'outline'}
            className={`text-lg px-6 py-3 ${
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
            className={`text-lg px-6 py-3 ${
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
            <h3 className="text-2xl font-bold text-white mb-4">Send Private Message to Snow Media</h3>
            <p className="text-orange-200 mb-6">
              Get direct support from the admin. Messages are private and secure.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-white font-semibold mb-2">Subject</label>
                <Input 
                  placeholder="What do you need help with?"
                  className="bg-slate-800 border-slate-600 text-white text-lg py-3"
                />
              </div>
              
              <div>
                <label className="block text-white font-semibold mb-2">Message</label>
                <Textarea 
                  value={adminMessage}
                  onChange={(e) => setAdminMessage(e.target.value)}
                  placeholder="Describe your issue or question in detail..."
                  className="bg-slate-800 border-slate-600 text-white min-h-32 text-lg"
                />
              </div>
              
              <Button className="bg-orange-600 hover:bg-orange-700 text-white text-lg px-8 py-3">
                <Send className="w-5 h-5 mr-2" />
                Send to Snow Media
              </Button>
            </div>
          </Card>
        )}

        {/* Community Chat */}
        {activeTab === 'community' && (
          <div className="space-y-6">
            <Card className="bg-gradient-to-br from-green-900/30 to-slate-900 border-green-700 p-6">
              <h3 className="text-2xl font-bold text-white mb-4">Community Chat</h3>
              
              <div className="bg-slate-800 rounded-lg p-4 mb-4 max-h-80 overflow-y-auto">
                {communityMessages.map((msg, index) => (
                  <div key={index} className="mb-4 last:mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-green-400 font-semibold">{msg.user}</span>
                      <span className="text-slate-400 text-sm">{msg.time}</span>
                    </div>
                    <p className="text-white">{msg.message}</p>
                  </div>
                ))}
              </div>
              
              <div className="flex gap-4">
                <Input 
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type your message..."
                  className="bg-slate-800 border-slate-600 text-white text-lg py-3 flex-1"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      // Handle send message
                      setMessage('');
                    }
                  }}
                />
                <Button className="bg-green-600 hover:bg-green-700 text-white px-6 py-3">
                  <Send className="w-5 h-5" />
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
                <span className="text-sm text-purple-300">Cost: 0.05 credits per message</span>
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
              <div className="flex gap-4">
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
                <Button 
                  onClick={sendAiMessage}
                  disabled={aiLoading || !aiMessage.trim() || !user}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3"
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
