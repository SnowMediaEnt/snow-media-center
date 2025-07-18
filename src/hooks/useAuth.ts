import { useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useWixIntegration } from './useWixIntegration';

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const { verifyWixMember, createMember, addToEmailList } = useWixIntegration();

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, fullName?: string) => {
    try {
      // First, verify if this email exists in Wix
      const wixVerification = await verifyWixMember(email);
      
      let wixMemberId = wixVerification.member?.id;
      
      // If Wix member doesn't exist, create one
      if (!wixVerification.exists) {
        console.log('Creating new Wix member account...');
        const nameParts = fullName?.split(' ') || [];
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        
        try {
          // Create member in Wix
          const newMember = await createMember({
            email,
            firstName,
            lastName,
            nickname: firstName
          });
          
          wixMemberId = newMember.member.id;
          
          // Add to email list
          await addToEmailList({
            email,
            firstName,
            lastName
          });
          
          console.log('Successfully created Wix member:', wixMemberId);
        } catch (wixError) {
          console.error('Error creating Wix member:', wixError);
          return { error: { message: 'Failed to create Wix account. Please contact support@snowmediaent.com.' } };
        }
      }

      // Proceed with Supabase signup
      const redirectUrl = `${window.location.origin}/`;
      
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: fullName || wixVerification.member?.name || '',
            wix_member_id: wixMemberId
          }
        }
      });

      // Send custom welcome email
      if (!error) {
        await supabase.functions.invoke('send-custom-email', {
          body: {
            to: email,
            type: 'welcome',
            data: {
              name: fullName || wixVerification.member?.name || ''
            }
          }
        });
      }

      return { error };
    } catch (error) {
      console.error('Signup error:', error);
      return { error: { message: 'Failed to create account. Please try again.' } };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      // Verify Wix member exists before allowing login
      const wixVerification = await verifyWixMember(email);
      
      if (!wixVerification.exists) {
        return { error: { message: 'Email not found in Wix member database. Please contact support@snowmediaent.com.' } };
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      // Update profile with Wix account ID if login successful
      if (!error) {
        await supabase.from('profiles').update({
          wix_account_id: wixVerification.member?.id
        }).eq('user_id', (await supabase.auth.getUser()).data.user?.id);
      }

      return { error };
    } catch (error) {
      console.error('Login error:', error);
      return { error: { message: 'Failed to login. Please try again.' } };
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  return {
    user,
    session,
    loading,
    signUp,
    signIn,
    signOut
  };
};