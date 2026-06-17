import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { runWhenIdle } from '@/utils/idle';

export const useAdminRole = () => {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const checkAdminRole = async () => {
      if (!user) {
        if (!cancelled) {
          setIsAdmin(false);
          setLoading(false);
        }
        return;
      }

      try {
        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .maybeSingle();

        if (cancelled) return;
        if (error) {
          console.error('Error checking admin role:', error);
          setIsAdmin(false);
        } else {
          setIsAdmin(!!data);
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Error checking admin role:', error);
        setIsAdmin(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (!authLoading) {
      // Phase 7: admin badge is non-critical for first paint — defer to idle.
      const cancel = runWhenIdle(() => { void checkAdminRole(); }, 2200);
      return () => { cancelled = true; cancel(); };
    }
    return () => { cancelled = true; };
  }, [user, authLoading]);

  return { isAdmin, loading: loading || authLoading };
};
