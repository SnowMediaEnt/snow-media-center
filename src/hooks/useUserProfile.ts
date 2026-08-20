import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface UserProfile {
  id: string;
  user_id: string;
  email?: string;
  username?: string;
  full_name?: string;
  credits: number;
  total_spent: number;
  created_at: string;
  updated_at: string;
}

export interface CreditTransaction {
  id: string;
  amount: number;
  transaction_type: 'purchase' | 'deduction' | 'refund';
  description: string;
  paypal_transaction_id?: string;
  created_at: string;
}

export const useUserProfile = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchProfile();
      fetchTransactions();
    } else {
      setProfile(null);
      setTransactions([]);
      setLoading(false);
    }
  }, [user]);

  const fetchProfile = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactions = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('credit_transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setTransactions(data as CreditTransaction[] || []);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!user || !profile) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('user_id', user.id);

      if (error) throw error;
      await fetchProfile();
      return { success: true };
    } catch (error) {
      console.error('Error updating profile:', error);
      return { success: false, error };
    }
  };

  const checkCredits = (amount: number): boolean => {
    return profile ? profile.credits >= amount : false;
  };

  const deductCredits = async (amount: number, description: string): Promise<boolean> => {
    if (!user) return false;

    try {
      const { data, error } = await supabase.rpc('update_user_credits', {
        p_user_id: user.id,
        p_amount: amount,
        p_transaction_type: 'deduction',
        p_description: description
      });

      if (error) throw error;
      
      if (data) {
        await fetchProfile();
        await fetchTransactions();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error deducting credits:', error);
      return false;
    }
  };

  return {
    profile,
    transactions,
    loading,
    fetchProfile,
    fetchTransactions,
    updateProfile,
    checkCredits,
    deductCredits
  };
};