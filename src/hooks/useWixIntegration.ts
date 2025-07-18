import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

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
  referralUrl: string;
  totalReferrals: number;
  totalEarnings: string;
  pendingEarnings: string;
}

interface WixOrder {
  id: string;
  number: string;
  total: string;
  status: string;
  created_at: string;
}

interface CreateMemberData {
  email: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
}

export const useWixIntegration = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [wixProfile, setWixProfile] = useState<any>(null);
  const [wixOrders, setWixOrders] = useState<WixOrder[]>([]);
  const [wixReferrals, setWixReferrals] = useState<WixReferralInfo | null>(null);

  useEffect(() => {
    if (user?.email) {
      fetchWixData();
    }
  }, [user]);

  const fetchWixData = async () => {
    if (!user?.email) return;
    
    setLoading(true);
    try {
      // Try to get existing member
      const memberResult = await verifyWixMember(user.email);
      
      if (memberResult.exists && memberResult.member) {
        // Fetch profile data
        try {
          const profileResult = await getProfile(memberResult.member.id);
          setWixProfile({
            ...profileResult.profile,
            shipping: profileResult.profile.addresses?.[0] || null,
            billing: profileResult.profile.addresses?.[1] || null
          });
        } catch (error) {
          console.error('Error fetching profile:', error);
        }

        // Fetch orders (mock data for now)
        setWixOrders([
          {
            id: '1',
            number: '1001',
            total: '29.99',
            status: 'completed',
            created_at: new Date().toISOString()
          }
        ]);

        // Fetch referral info
        try {
          const referralResult = await getReferralInfo(memberResult.member.id);
          setWixReferrals({
            ...referralResult.referral,
            referralUrl: `https://yourwebsite.com/ref/${referralResult.referral.code}`,
            totalReferrals: 0,
            totalEarnings: '0.00',
            pendingEarnings: '0.00'
          });
        } catch (error) {
          console.error('Error fetching referral info:', error);
        }
      }
    } catch (error) {
      console.error('Error fetching Wix data:', error);
    } finally {
      setLoading(false);
    }
  };

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
    wixProfile,
    wixOrders,
    wixReferrals,
    verifyWixMember,
    getWixMember,
    testConnection,
    createMember,
    getProfile,
    getReferralInfo,
    addToEmailList,
    fetchWixData
  };
};