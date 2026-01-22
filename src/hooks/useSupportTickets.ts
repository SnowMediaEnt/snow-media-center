import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  user_has_unread: boolean;
  admin_has_unread: boolean;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  user_id?: string;
  sender_type: 'user' | 'admin';
  message: string;
  created_at: string;
}

export const useSupportTickets = () => {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Record<string, SupportMessage[]>>({});
  const { toast } = useToast();

  // Fetch all user's tickets
  const fetchTickets = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('last_message_at', { ascending: false });

      if (error) throw error;
      setTickets(data || []);
    } catch (error) {
      console.error('Error fetching tickets:', error);
      toast({
        title: "Error",
        description: "Failed to load support tickets",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch messages for a specific ticket
  const fetchTicketMessages = async (ticketId: string) => {
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      setMessages(prev => ({
        ...prev,
        [ticketId]: (data || []).map(msg => ({
          id: msg.id,
          ticket_id: msg.ticket_id,
          user_id: msg.user_id,
          sender_type: msg.sender_type as 'user' | 'admin',
          message: msg.message,
          created_at: msg.created_at
        }))
      }));

      // Mark ticket as read by user
      await markTicketAsRead(ticketId);
    } catch (error) {
      console.error('Error fetching messages:', error);
      toast({
        title: "Error",
        description: "Failed to load messages",
        variant: "destructive"
      });
    }
  };

  // Create a new support ticket
  const createTicket = async (subject: string, initialMessage: string) => {
    try {
      setLoading(true);
      
      // Create ticket
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: ticket, error: ticketError } = await supabase
        .from('support_tickets')
        .insert({
          user_id: user.id,
          subject,
          status: 'open',
          priority: 'normal'
        })
        .select()
        .single();

      if (ticketError) throw ticketError;

      // Create initial message
      const { error: messageError } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: ticket.id,
          user_id: user.id,
          sender_type: 'user',
          message: initialMessage
        });

      if (messageError) throw messageError;

      // Send email notification
      await sendSupportEmail(ticket.id, subject, initialMessage);

      toast({
        title: "Success",
        description: "Support ticket created successfully"
      });

      await fetchTickets();
      return ticket.id;
    } catch (error) {
      console.error('Error creating ticket:', error);
      toast({
        title: "Error",
        description: "Failed to create support ticket",
        variant: "destructive"
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Send a message to an existing ticket
  const sendMessage = async (ticketId: string, message: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { error } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: ticketId,
          user_id: user.id,
          sender_type: 'user',
          message
        });

      if (error) throw error;

      // Send email notification
      const ticket = tickets.find(t => t.id === ticketId);
      if (ticket) {
        await sendSupportEmail(ticketId, `Re: ${ticket.subject}`, message);
      }

      // Refresh messages for this ticket
      await fetchTicketMessages(ticketId);
      await fetchTickets(); // Refresh to update last_message_at
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive"
      });
      throw error;
    }
  };

  // Mark ticket as read by user
  const markTicketAsRead = async (ticketId: string) => {
    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({ user_has_unread: false })
        .eq('id', ticketId);

      if (error) throw error;

      // Update local state
      setTickets(prev => prev.map(ticket => 
        ticket.id === ticketId 
          ? { ...ticket, user_has_unread: false }
          : ticket
      ));
    } catch (error) {
      console.error('Error marking ticket as read:', error);
    }
  };

  // Close a ticket (user marks as resolved)
  const closeTicket = async (ticketId: string) => {
    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({ status: 'closed' })
        .eq('id', ticketId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Ticket has been closed"
      });

      // Update local state
      setTickets(prev => prev.map(ticket => 
        ticket.id === ticketId 
          ? { ...ticket, status: 'closed' }
          : ticket
      ));
    } catch (error) {
      console.error('Error closing ticket:', error);
      toast({
        title: "Error",
        description: "Failed to close ticket",
        variant: "destructive"
      });
      throw error;
    }
  };

  // Send email notification
  const sendSupportEmail = async (ticketId: string, subject: string, message: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      await supabase.functions.invoke('send-custom-email', {
        body: {
          to: 'support@snowmediaent.com',
          subject: `[Ticket #${ticketId.slice(-8)}] ${subject}`,
          html: `
            <h3>New Support Message</h3>
            <p><strong>From:</strong> ${user?.email}</p>
            <p><strong>Ticket ID:</strong> ${ticketId}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <div style="margin-top: 20px; padding: 15px; background: #f5f5f5; border-radius: 5px;">
              <p><strong>Message:</strong></p>
              <p>${message.replace(/\n/g, '<br>')}</p>
            </div>
            <p style="margin-top: 20px; font-size: 12px; color: #666;">
              Ticket ID: ${ticketId}<br>
              User: ${user?.email}
            </p>
          `,
          fromName: 'Snow Media Support System'
        }
      });
    } catch (error) {
      console.error('Error sending support email:', error);
      // Don't throw error here as the ticket was still created
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  return {
    tickets,
    messages,
    loading,
    fetchTickets,
    fetchTicketMessages,
    createTicket,
    sendMessage,
    markTicketAsRead,
    closeTicket
  };
};