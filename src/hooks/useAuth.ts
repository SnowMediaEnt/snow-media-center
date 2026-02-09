import { useState, useEffect, useCallback } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { waitForStorageReady } from '@/utils/storage';
import { Capacitor } from '@capacitor/core';

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let subscription: { unsubscribe: () => void } | null = null;
    
    const initializeAuth = async () => {
      const isNative = Capacitor.isNativePlatform();
      console.log('[Auth] Init, native:', isNative);
      
      // On native, wait for storage to restore tokens
      if (isNative) {
        console.log('[Auth] Waiting for storage...');
        await waitForStorageReady();
        console.log('[Auth] Storage ready');
      }
      
      // Set up auth listener
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (!isMounted) return;
        console.log('[Auth] State change:', event);
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      });
      
      subscription = data.subscription;

      // Get current session
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        
        if (!isMounted) return;
        
        if (currentSession) {
          console.log('[Auth] Found session for:', currentSession.user?.email);
          setSession(currentSession);
          setUser(currentSession.user);
        } else {
          console.log('[Auth] No session');
          setSession(null);
          setUser(null);
        }
      } catch (err) {
        console.error('[Auth] Session check error:', err);
        if (isMounted) {
          setSession(null);
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();
    
    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string, fullName?: string) => {
    try {
      const redirectUrl = `${window.location.origin}/`;
      const { error, data } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: { full_name: fullName || '' }
        }
      });
      
      // Sync to Wix in background (non-blocking)
      if (!error && data.user) {
        syncUserToWix(email, fullName);
      }
      
      return { error };
    } catch (error) {
      console.error('[Auth] SignUp error:', error);
      return { error: { message: 'Failed to create account.' } as AuthError };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      console.log('[Auth] Signing in:', email);
      
      const { error, data } = await supabase.auth.signInWithPassword({ 
        email: email.trim().toLowerCase(), 
        password 
      });
      
      if (error) {
        console.error('[Auth] SignIn failed:', error.message);
        return { error };
      }
      
      console.log('[Auth] SignIn success:', data.user?.email);
      return { error: null };
    } catch (error) {
      console.error('[Auth] SignIn exception:', error);
      return { error: { message: 'Login failed. Check your connection.' } as AuthError };
    }
  };

  const signOut = async () => {
    console.log('[Auth] Signing out');
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  // Background Wix sync (fire-and-forget)
  const syncUserToWix = useCallback(async (email: string, fullName?: string) => {
    try {
      const nameParts = fullName?.split(' ') || [];
      await supabase.functions.invoke('wix-integration', {
        body: {
          action: 'create-member',
          memberData: {
            email,
            firstName: nameParts[0] || '',
            lastName: nameParts.slice(1).join(' ') || '',
            nickname: email.split('@')[0]
          }
        }
      });
    } catch (e) {
      console.warn('[Auth] Wix sync failed:', e);
    }
  }, []);

  return { user, session, loading, signUp, signIn, signOut };
};
