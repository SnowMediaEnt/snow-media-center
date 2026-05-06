import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface AdminTicket {
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
  user_email?: string;
  user_name?: string;
}

export interface AdminMessage {
  id: string;
  ticket_id: string;
  user_id?: string;
  sender_type: 'user' | 'admin';
  message: string;
  created_at: string;
}

export const useAdminTickets = () => {
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Record<string, AdminMessage[]>>({});
  const { toast } = useToast();

  // Fetch all tickets (admin sees all)
  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      
      // Fetch tickets
      const { data: ticketsData, error: ticketsError } = await supabase
        .from('support_tickets')
        .select('*')
        .order('last_message_at', { ascending: false });

      if (ticketsError) throw ticketsError;
      
      // Fetch user profiles for ticket owners
      const userIds = [...new Set(ticketsData?.map(t => t.user_id) || [])];
      
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, email, full_name')
        .in('user_id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      // Fallback: if any user_id missing a profile, try to grab current admin's identity
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      const enrichedTickets: AdminTicket[] = (ticketsData || []).map(ticket => {
        const profile = profileMap.get(ticket.user_id);
        let email = profile?.email;
        let name = profile?.full_name || undefined;
        if (!email && currentUser && currentUser.id === ticket.user_id) {
          email = currentUser.email || undefined;
          name = (currentUser.user_metadata as any)?.full_name || name;
        }
        return {
          ...ticket,
          user_email: email || `User ${ticket.user_id.slice(0, 8)}`,
          user_name: name,
        };
      });

      setTickets(enrichedTickets);
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
  }, [toast]);

  // Fetch messages for a specific ticket
  const fetchTicketMessages = useCallback(async (ticketId: string) => {
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

      // Mark ticket as read by admin
      await markTicketAsRead(ticketId);
    } catch (error) {
      console.error('Error fetching messages:', error);
      toast({
        title: "Error",
        description: "Failed to load messages",
        variant: "destructive"
      });
    }
  }, [toast]);

  // Send admin reply
  const sendAdminReply = useCallback(async (ticketId: string, message: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Admin not authenticated');

      const { error } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: ticketId,
          user_id: user.id,
          sender_type: 'admin',
          message
        });

      if (error) throw error;

      toast({
        title: "Reply Sent",
        description: "Your response has been sent to the user"
      });

      // Refresh messages for this ticket
      await fetchTicketMessages(ticketId);
      await fetchTickets();
    } catch (error) {
      console.error('Error sending reply:', error);
      toast({
        title: "Error",
        description: "Failed to send reply",
        variant: "destructive"
      });
      throw error;
    }
  }, [fetchTicketMessages, fetchTickets, toast]);

  // Update ticket status
  const updateTicketStatus = useCallback(async (ticketId: string, status: string) => {
    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({ status })
        .eq('id', ticketId);

      if (error) throw error;

      toast({
        title: "Status Updated",
        description: `Ticket status changed to ${status}`
      });

      await fetchTickets();
    } catch (error) {
      console.error('Error updating status:', error);
      toast({
        title: "Error",
        description: "Failed to update ticket status",
        variant: "destructive"
      });
    }
  }, [fetchTickets, toast]);

  // Delete ticket (admin)
  const deleteTicket = useCallback(async (ticketId: string) => {
    try {
      const { error: msgErr } = await supabase
        .from('support_messages')
        .delete()
        .eq('ticket_id', ticketId);
      if (msgErr) throw msgErr;

      const { error } = await supabase
        .from('support_tickets')
        .delete()
        .eq('id', ticketId);
      if (error) throw error;

      setTickets(prev => prev.filter(t => t.id !== ticketId));
      toast({ title: 'Deleted', description: 'Ticket deleted' });
    } catch (error) {
      console.error('Error deleting ticket:', error);
      toast({ title: 'Error', description: 'Failed to delete ticket', variant: 'destructive' });
      throw error;
    }
  }, [toast]);

  // Mark ticket as read by admin
  const markTicketAsRead = useCallback(async (ticketId: string) => {
    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({ admin_has_unread: false })
        .eq('id', ticketId);

      if (error) throw error;

      setTickets(prev => prev.map(ticket => 
        ticket.id === ticketId 
          ? { ...ticket, admin_has_unread: false }
          : ticket
      ));
    } catch (error) {
      console.error('Error marking ticket as read:', error);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // Count of unread tickets
  const unreadCount = tickets.filter(t => t.admin_has_unread).length;

  return {
    tickets,
    messages,
    loading,
    unreadCount,
    fetchTickets,
    fetchTicketMessages,
    sendAdminReply,
    updateTicketStatus,
    markTicketAsRead,
    deleteTicket
  };
};
