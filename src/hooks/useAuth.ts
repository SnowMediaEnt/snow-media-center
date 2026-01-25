import { useState, useEffect, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Sync user to Wix after signup (create member + add to email list)
  const syncUserToWix = useCallback(async (email: string, fullName?: string) => {
    const nameParts = fullName?.split(' ') || [];
    const memberData = {
      email,
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || '',
      nickname: email.split('@')[0]
    };

    // Create Wix member
    try {
      const { data, error } = await supabase.functions.invoke('wix-integration', {
        body: {
          action: 'create-member',
          memberData
        }
      });
      
      if (error) {
        console.warn('[Auth] Wix member sync failed (user may already exist):', error);
      } else {
        console.log('[Auth] User synced to Wix:', data);
      }
    } catch (error) {
      console.warn('[Auth] Wix member sync error:', error);
    }

    // Add to email subscription list (fire-and-forget)
    try {
      const { data, error } = await supabase.functions.invoke('wix-integration', {
        body: {
          action: 'add-to-email-list',
          memberData
        }
      });
      
      if (error) {
        console.warn('[Auth] Wix email list sync failed:', error);
      } else {
        console.log('[Auth] User added to Wix email list:', data);
      }
    } catch (error) {
      console.warn('[Auth] Wix email list sync error:', error);
    }
  }, []);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, fullName?: string) => {
    try {
      const redirectUrl = `${window.location.origin}/`;
      const { error, data } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: fullName || ''
          }
        }
      });
      
      // If signup successful, sync to Wix (fire-and-forget, don't block auth)
      if (!error && data.user) {
        // Use setTimeout to avoid blocking the auth flow
        setTimeout(() => {
          syncUserToWix(email, fullName).catch(err => {
            console.warn('[Auth] Wix sync failed (non-blocking):', err);
          });
        }, 0);
      }
      
      return { error };
    } catch (error) {
      console.error('[Auth] SignUp error:', error);
      return { error: { message: 'Failed to create account. Please try again.' } } as any;
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error };
    } catch (error) {
      return { error: { message: 'Failed to login. Please try again.' } } as any;
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  return { user, session, loading, signUp, signIn, signOut };
};