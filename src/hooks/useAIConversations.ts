import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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

  // Fetch all user's AI conversations
  const fetchConversations = async () => {
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
    try {
      const { data, error } = await supabase
        .from('ai_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      setMessages(prev => ({
        ...prev,
        [conversationId]: (data || []).map(msg => ({
          id: msg.id,
          conversation_id: msg.conversation_id,
          sender_type: msg.sender_type as 'user' | 'assistant',
          message: msg.message,
          created_at: msg.created_at
        }))
      }));
    } catch (error) {
      console.error('Error fetching AI messages:', error);
      toast({
        title: "Error",
        description: "Failed to load conversation messages",
        variant: "destructive"
      });
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
      // Add user message
      const { error: userMessageError } = await supabase
        .from('ai_messages')
        .insert({
          conversation_id: conversationId,
          sender_type: 'user',
          message
        });

      if (userMessageError) throw userMessageError;

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

      const { data, error } = await supabase.functions.invoke('snow-media-ai', {
        body: {
          message: userMessage,
          context: context,
          conversationId
        }
      });

      if (error) throw error;

      // Add AI response to database
      if (data?.response) {
        await supabase
          .from('ai_messages')
          .insert({
            conversation_id: conversationId,
            sender_type: 'assistant',
            message: data.response
          });
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
    }
  };

  // Delete a conversation
  const deleteConversation = async (conversationId: string) => {
    try {
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
        title: "Success",
        description: "Conversation deleted successfully"
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

  useEffect(() => {
    fetchConversations();
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