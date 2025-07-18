import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface WixMember {
  id: string;
  email: string;
  name: string;
  fullProfile?: any;
}

interface WixProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  nickname: string;
  addresses: any[];
  phoneNumber: string;
  picture: string;
  purchaseHistory: any[];
}

interface WixReferralInfo {
  code: string;
  link: string;
  memberId: string;
}

interface CreateMemberData {
  email: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
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

  const testConnection = async (): Promise<{ connected: boolean; totalMembers?: number; error?: string; message?: string }> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('wix-integration', {
        body: {
          action: 'test-connection'
        }
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error testing Wix connection:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const createMember = async (memberData: CreateMemberData): Promise<{ member: WixMember }> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('wix-integration', {
        body: {
          action: 'create-member',
          memberData
        }
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating Wix member:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const getProfile = async (wixMemberId: string): Promise<{ profile: WixProfile }> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('wix-integration', {
        body: {
          action: 'get-profile',
          wixMemberId
        }
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error getting Wix profile:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const getReferralInfo = async (wixMemberId: string): Promise<{ referral: WixReferralInfo }> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('wix-integration', {
        body: {
          action: 'get-referral-info',
          wixMemberId
        }
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error getting referral info:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const addToEmailList = async (memberData: CreateMemberData): Promise<{ success: boolean; contact?: any }> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('wix-integration', {
        body: {
          action: 'add-to-email-list',
          memberData
        }
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error adding to email list:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    verifyWixMember,
    getWixMember,
    testConnection,
    createMember,
    getProfile,
    getReferralInfo,
    addToEmailList
  };
};