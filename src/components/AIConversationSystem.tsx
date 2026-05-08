import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  ArrowLeft, 
  Plus, 
  MessageCircle, 
  Send,
  Bot,
  User,
  Trash2
} from 'lucide-react';
import { useAIConversations } from '@/hooks/useAIConversations';
import { formatDistanceToNow } from 'date-fns';

interface AIConversationSystemProps {
  onBack: () => void;
}

const AIConversationSystem = ({ onBack }: AIConversationSystemProps) => {
  const [view, setView] = useState<'list' | 'conversation' | 'create'>('list');
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [replyMessage, setReplyMessage] = useState('');

  const {
    conversations,
    messages,
    loading,
    fetchConversationMessages,
    createConversation,
    sendMessage,
    deleteConversation
  } = useAIConversations();

  const selectedConversation = conversations.find(c => c.id === selectedConversationId);
  const conversationMessages = selectedConversationId ? messages[selectedConversationId] || [] : [];

  // Hierarchical back button handling
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      
      // Allow Backspace when typing
      if (event.key === 'Backspace' && isTyping) {
        return;
      }
      
      // Handle back button - hierarchical exit from nested containers
      if (event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 4 || event.code === 'GoBack') {
        event.preventDefault();
        event.stopPropagation();
        
        // If viewing a conversation, go back to list first
        if (view === 'conversation') {
          setView('list');
          setSelectedConversationId(null);
          return;
        }
        
        // If in create form, go back to list
        if (view === 'create') {
          setView('list');
          return;
        }
        
        // Otherwise exit to previous page
        onBack();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, onBack]);

  // Auto-focus first conversation card when list view opens
  useEffect(() => {
    if (view !== 'list' || conversations.length === 0) return;
    const t = setTimeout(() => {
      const first = document.querySelector<HTMLElement>('[data-convo-idx="0"]');
      first?.focus();
    }, 100);
    return () => clearTimeout(t);
  }, [view, conversations.length]);

  const handleCreateConversation = async () => {
    if (!newMessage.trim()) return;
    
    try {
      // Generate title from first message (first 50 chars)
      const title = newMessage.slice(0, 50) + (newMessage.length > 50 ? '...' : '');
      const conversationId = await createConversation(title, newMessage);
      setNewMessage('');
      setSelectedConversationId(conversationId);
      setView('conversation');
      await fetchConversationMessages(conversationId);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSendReply = async () => {
    if (!selectedConversationId || !replyMessage.trim()) return;
    
    try {
      await sendMessage(selectedConversationId, replyMessage);
      setReplyMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleViewConversation = async (conversationId: string) => {
    setSelectedConversationId(conversationId);
    setView('conversation');
    await fetchConversationMessages(conversationId);
  };

  const handleDeleteConversation = async (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this conversation?')) {
      await deleteConversation(conversationId);
    }
  };

  if (view === 'create') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <Button onClick={() => setView('list')} variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Conversations
            </Button>
            <h1 className="text-3xl font-bold">New AI Conversation</h1>
          </div>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Bot className="h-5 w-5" />
                Start a New Conversation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-300 mb-2 block">
                  Your Message
                </label>
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Ask me anything..."
                  className="bg-slate-700 border-slate-600 text-white"
                  onKeyPress={(e) => e.key === 'Enter' && handleCreateConversation()}
                />
              </div>

              <div className="flex gap-2">
                <Button 
                  onClick={handleCreateConversation}
                  disabled={!newMessage.trim() || loading}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {loading ? "Starting..." : "Start Conversation"}
                </Button>
                <Button 
                  onClick={() => setView('list')}
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (view === 'conversation' && selectedConversation) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <Button onClick={() => setView('list')} variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Conversations
            </Button>
            <h1 className="text-3xl font-bold line-clamp-1">{selectedConversation.title}</h1>
          </div>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Bot className="h-5 w-5" />
                AI Assistant
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="h-96 pr-4 overflow-y-auto outline-none focus:ring-2 focus:ring-blue-400 rounded-md"
                tabIndex={0}
                data-ai-messages-scroll
                onKeyDown={(e) => {
                  const navKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
                  if (!navKeys.includes(e.key)) return;
                  const container = e.currentTarget;
                  const msgs = Array.from(container.querySelectorAll<HTMLElement>('[data-ai-msg]'));
                  if (msgs.length === 0) return;
                  e.preventDefault();
                  const focusedIdx = msgs.findIndex((m) => m === document.activeElement);
                  if (e.key === 'ArrowDown') {
                    const next = focusedIdx < 0 ? 0 : Math.min(focusedIdx + 1, msgs.length - 1);
                    msgs[next].focus();
                    msgs[next].scrollIntoView({ block: 'center', behavior: 'smooth' });
                  } else if (e.key === 'ArrowUp') {
                    if (focusedIdx <= 0) {
                      // exit upward releases focus back to scroll container
                      container.focus();
                      container.scrollBy({ top: -100, behavior: 'smooth' });
                      return;
                    }
                    const next = focusedIdx - 1;
                    msgs[next].focus();
                    msgs[next].scrollIntoView({ block: 'center', behavior: 'smooth' });
                  } else if (e.key === 'PageDown') {
                    container.scrollBy({ top: container.clientHeight * 0.8, behavior: 'smooth' });
                  } else if (e.key === 'PageUp') {
                    container.scrollBy({ top: -container.clientHeight * 0.8, behavior: 'smooth' });
                  } else if (e.key === 'Home') {
                    container.scrollTo({ top: 0, behavior: 'smooth' });
                  } else if (e.key === 'End') {
                    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
                  }
                }}
              >
                <div className="space-y-4">
                  {conversationMessages.map((message) => (
                    <div
                      key={message.id}
                      data-ai-msg
                      tabIndex={0}
                      className={`p-4 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 focus:scale-[1.01] transition-transform ${
                      message.sender_type === 'user' 
                        ? 'bg-blue-600/20 ml-8' 
                        : 'bg-slate-700/50 mr-8'
                    }`}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex items-center gap-1">
                          {message.sender_type === 'user' ? (
                            <User className="h-4 w-4" />
                          ) : (
                            <Bot className="h-4 w-4" />
                          )}
                          <Badge variant={message.sender_type === 'user' ? 'default' : 'secondary'}>
                            {message.sender_type === 'user' ? 'You' : 'AI Assistant'}
                          </Badge>
                        </div>
                        <span className="text-xs text-slate-400">
                          {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-slate-200 whitespace-pre-wrap">{message.message}</p>
                    </div>
                  ))}
                </div>
              </div>
              
              <Separator className="my-4 bg-slate-600" />
              
              <div className="flex gap-2">
                <Input
                  value={replyMessage}
                  onChange={(e) => setReplyMessage(e.target.value)}
                  placeholder="Type your message..."
                  className="bg-slate-700 border-slate-600 text-white"
                  onKeyPress={(e) => e.key === 'Enter' && handleSendReply()}
                />
                <Button 
                  onClick={handleSendReply}
                  disabled={!replyMessage.trim() || loading}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button onClick={onBack} variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <h1 className="text-3xl font-bold">AI Conversations</h1>
          </div>
          <Button 
            onClick={() => setView('create')}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Conversation
          </Button>
        </div>

        <div className="mb-4">
          <Badge variant="outline" className="text-slate-300">
            Showing up to 5 most recent conversations
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {conversations.map((conversation, idx) => (
            <Card
              key={conversation.id}
              tabIndex={0}
              data-convo-idx={idx}
              role="button"
              className="bg-slate-800/50 border-slate-700 cursor-pointer hover:bg-slate-700/50 transition-all outline-none focus:scale-105 focus:shadow-[0_0_20px_rgba(96,165,250,0.6)] focus:border-blue-400"
              onClick={() => handleViewConversation(conversation.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleViewConversation(conversation.id);
                  return;
                }
                const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
                if (!navKeys.includes(e.key)) return;
                e.preventDefault();
                const cards = Array.from(
                  document.querySelectorAll<HTMLElement>('[data-convo-idx]')
                );
                const cols = window.innerWidth >= 1024 ? 3 : window.innerWidth >= 768 ? 2 : 1;
                let next = idx;
                if (e.key === 'ArrowRight') next = idx + 1;
                else if (e.key === 'ArrowLeft') next = idx - 1;
                else if (e.key === 'ArrowDown') next = idx + cols;
                else if (e.key === 'ArrowUp') next = idx - cols;
                if (next >= 0 && next < cards.length) {
                  cards[next].focus();
                  cards[next].scrollIntoView({ block: 'center', behavior: 'smooth' });
                }
              }}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle className="text-white text-lg line-clamp-2 flex-1">
                    {conversation.title}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => handleDeleteConversation(conversation.id, e)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-900/20 ml-2"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-slate-400">
                  <p>Created: {formatDistanceToNow(new Date(conversation.created_at), { addSuffix: true })}</p>
                  <p>Last message: {formatDistanceToNow(new Date(conversation.last_message_at), { addSuffix: true })}</p>
                </div>
              </CardContent>
            </Card>
          ))}

          {conversations.length === 0 && !loading && (
            <div className="col-span-full text-center py-12">
              <Bot className="h-12 w-12 mx-auto text-slate-500 mb-4" />
              <h3 className="text-xl font-semibold text-slate-300 mb-2">No AI Conversations</h3>
              <p className="text-slate-500 mb-4">Start chatting with our AI assistant to get help, ask questions, or just have a conversation.</p>
              <Button 
                onClick={() => setView('create')}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                Start Your First Conversation
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIConversationSystem;