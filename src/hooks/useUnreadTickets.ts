import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

/**
 * Number of the current user's tickets that have an unread admin response.
 * Powers the little alert dot on the Support card (home) and the
 * "Submit a Ticket" row inside Support.
 */
export const useUnreadTickets = () => {
  const { user, loading: authLoading } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    try {
      const { count, error } = await supabase
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('user_has_unread', true);
      if (error) throw error;
      setUnreadCount(count || 0);
    } catch (err) {
      console.warn('[useUnreadTickets] failed:', err);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();

    if (!user) return;

    const channel = supabase
      .channel(`support_tickets_unread_${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_tickets', filter: `user_id=eq.${user.id}` },
        () => { void refresh(); },
      )
      .subscribe();

    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('support:tickets-read', onFocus);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('support:tickets-read', onFocus);
    };
  }, [authLoading, user, refresh]);

  return { unreadCount, refresh };
};
