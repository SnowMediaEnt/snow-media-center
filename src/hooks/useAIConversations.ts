import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { getDeviceId } from '@/lib/analytics';
import { kidsLevel } from '@/lib/kidsFilter';

export interface AIConversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

export interface AIMessage {
  id: string;
  conversation_id: string;
  sender_type: 'user' | 'assistant';
  message: string;
  created_at: string;
}

export const useAIConversations = () => {
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [messages, setMessages] = useState<Record<string, AIMessage[]>>({});
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const touchConversation = async (conversationId: string) => {
    await supabase
      .from('ai_conversations')
      .update({ updated_at: new Date().toISOString(), last_message_at: new Date().toISOString() })
      .eq('id', conversationId);
  };

  // Fetch all user's AI conversations. The saved chats are the account's, so
  // the grown-ups': a Kids profile gets none.
  const fetchConversations = async () => {
    if (kidsLevel()) { setConversations([]); return; }
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('ai_conversations')
        .select('*')
        .order('last_message_at', { ascending: false })
        .limit(5); // Only get the 5 most recent

      if (error) throw error;
      setConversations(data || []);
    } catch (error) {
      console.error('Error fetching AI conversations:', error);
      toast({
        title: "Error",
        description: "Failed to load AI conversations",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch messages for a specific conversation
  const fetchConversationMessages = async (conversationId: string) => {
    if (kidsLevel()) return [];
    try {
      const { data, error } = await supabase
        .from('ai_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      const mappedMessages = (data || []).map(msg => ({
        id: msg.id,
        conversation_id: msg.conversation_id,
        sender_type: msg.sender_type as 'user' | 'assistant',
        message: msg.message,
        created_at: msg.created_at
      }));

      setMessages(prev => ({
        ...prev,
        [conversationId]: mappedMessages
      }));
      return mappedMessages;
    } catch (error) {
      console.error('Error fetching AI messages:', error);
      toast({
        title: "Error",
        description: "Failed to load conversation messages",
        variant: "destructive"
      });
      return [];
    }
  };

  // Create a new AI conversation
  const createConversation = async (title: string, initialMessage: string) => {
    try {
      setLoading(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');
      
      // Create conversation
      const { data: conversation, error: conversationError } = await supabase
        .from('ai_conversations')
        .insert({
          user_id: user.id,
          title: title || 'New Conversation'
        })
        .select()
        .single();

      if (conversationError) throw conversationError;

      // Create initial user message
      const { error: messageError } = await supabase
        .from('ai_messages')
        .insert({
          conversation_id: conversation.id,
          sender_type: 'user',
          message: initialMessage
        });

      if (messageError) throw messageError;

      // Generate AI response
      await generateAIResponse(conversation.id, initialMessage);

      await fetchConversationMessages(conversation.id);
      await fetchConversations();
      return conversation.id;
    } catch (error) {
      console.error('Error creating AI conversation:', error);
      toast({
        title: "Error",
        description: "Failed to create AI conversation",
        variant: "destructive"
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Send a message to an existing conversation
  const sendMessage = async (conversationId: string, message: string) => {
    try {
      setLoading(true);
      // Add user message
      const { error: userMessageError } = await supabase
        .from('ai_messages')
        .insert({
          conversation_id: conversationId,
          sender_type: 'user',
          message
        });

      if (userMessageError) throw userMessageError;
      await touchConversation(conversationId);

      // Generate AI response
      await generateAIResponse(conversationId, message);

      // Refresh messages and conversations
      await fetchConversationMessages(conversationId);
      await fetchConversations();
    } catch (error) {
      console.error('Error sending AI message:', error);
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive"
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Generate AI response using Snow Media AI
  const generateAIResponse = async (conversationId: string, userMessage: string) => {
    try {
      // Get conversation history
      const conversationMessages = messages[conversationId] || [];
      const context = conversationMessages
        .slice(-10) // Last 10 messages for context
        .map(msg => `${msg.sender_type === 'user' ? 'User' : 'Assistant'}: ${msg.message}`)
        .join('\n');

      const currentVersion = await fetch('/version.json').then(r => r.json()).then(d => d.currentVersion).catch(() => undefined);
      const { data, error } = await supabase.functions.invoke('snow-media-ai', {
        body: {
          message: userMessage,
          context: context,
          conversationId,
          currentVersion,
          device_id: getDeviceId(),
        }
      });

      if (error) throw error;

      const responseMessage = data?.response || data?.message;

      // Add AI response to database
      if (responseMessage) {
        await supabase
          .from('ai_messages')
          .insert({
            conversation_id: conversationId,
            sender_type: 'assistant',
            message: responseMessage
          });
        await touchConversation(conversationId);
      }
    } catch (error) {
      console.error('Error generating AI response:', error);
      // Add error message as AI response
      await supabase
        .from('ai_messages')
        .insert({
          conversation_id: conversationId,
          sender_type: 'assistant',
          message: "I'm sorry, I'm having trouble processing your request right now. Please try again later."
        });
      await touchConversation(conversationId);
    }
  };

  // Delete a conversation
  const deleteConversation = async (conversationId: string) => {
    try {
      // Remove messages first (no FK cascade in schema)
      await supabase
        .from('ai_messages')
        .delete()
        .eq('conversation_id', conversationId);

      const { error } = await supabase
        .from('ai_conversations')
        .delete()
        .eq('id', conversationId);

      if (error) throw error;

      // Remove from local state
      setConversations(prev => prev.filter(conv => conv.id !== conversationId));
      setMessages(prev => {
        const newMessages = { ...prev };
        delete newMessages[conversationId];
        return newMessages;
      });

      toast({
        title: "Deleted",
        description: "AI conversation removed"
      });
    } catch (error) {
      console.error('Error deleting conversation:', error);
      toast({
        title: "Error",
        description: "Failed to delete conversation",
        variant: "destructive"
      });
    }
  };

  // Fetch on mount, and again whenever the signed-in USER changes. The hook
  // takes no user argument (three call sites, none of which need to change),
  // so it listens to auth directly. Same reason as useSupportTickets: the
  // website session frequently lands after this screen mounts, and a one-shot
  // fetch with no auth.uid() returns nothing under RLS.
  //
  // Keyed on the user id, not the event: supabase-js emits SIGNED_IN again on
  // every return to the foreground and TOKEN_REFRESHED every hour, and the
  // refetch here must not run on those — it would race an in-flight send and,
  // because it shares `loading`, re-enable the Send button mid-request. So a
  // same-user event is ignored, and the refetch that does run touches only
  // the list, never `loading`.
  useEffect(() => {
    void fetchConversations();
    let lastUid: string | null | undefined;
    const silentRefetch = async () => {
      if (kidsLevel()) return;
      const { data, error } = await supabase
        .from('ai_conversations')
        .select('*')
        .order('last_message_at', { ascending: false })
        .limit(5);
      if (!error) setConversations(data || []);
    };
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const uid = session?.user?.id ?? null;
      if (event === 'SIGNED_OUT') { lastUid = null; setConversations([]); setMessages({}); return; }
      if (lastUid === undefined) { lastUid = uid; return; } // the mount fetch covers the initial session
      if (uid && uid !== lastUid) { lastUid = uid; void silentRefetch(); }
    });
    return () => { data.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    conversations,
    messages,
    loading,
    fetchConversations,
    fetchConversationMessages,
    createConversation,
    sendMessage,
    deleteConversation
  };
};