import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface WixMember {
  id: string;
  email: string;
  name: string;
  fullProfile?: any;
}

export const useWixIntegration = () => {
  const [loading, setLoading] = useState(false);

  const verifyWixMember = async (email: string): Promise<{ exists: boolean; member: WixMember | null }> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('wix-integration', {
        body: {
          action: 'verify-member',
          email
        }
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error verifying Wix member:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const getWixMember = async (wixMemberId: string): Promise<{ member: WixMember }> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('wix-integration', {
        body: {
          action: 'get-member',
          wixMemberId
        }
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error getting Wix member:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    verifyWixMember,
    getWixMember
  };
};