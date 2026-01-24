import { useState, useCallback } from 'react';
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

interface WixLoyalty {
  points: number;
  tier: string;
}

interface WixReferralStats {
  totalReferrals: number;
  earnings: string;
}

export const useWixIntegration = () => {
  const [loading, setLoading] = useState(false);
  const [wixProfile, setWixProfile] = useState<any>(null);
  const [wixOrders, setWixOrders] = useState<WixOrder[]>([]);
  const [wixReferrals, setWixReferrals] = useState<WixReferralInfo | null>(null);
  const [wixLoyalty, setWixLoyalty] = useState<WixLoyalty | null>(null);

  const verifyWixMember = useCallback(async (email: string): Promise<{ exists: boolean; member: WixMember | null }> => {
    try {
      // Add timeout to prevent hanging on slow networks (especially Android)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
      
      const { data, error } = await supabase.functions.invoke('wix-integration', {
        body: {
          action: 'verify-member',
          email
        }
      });
      
      clearTimeout(timeoutId);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error verifying Wix member:', error);
      // Return a more informative error state
      return { exists: false, member: null };
    }
  }, []);

  const getWixMember = useCallback(async (wixMemberId: string): Promise<{ member: WixMember }> => {
    setLoading(true);
    try {
      // Add timeout for Android
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 15000)
      );
      
      const fetchPromise = supabase.functions.invoke('wix-integration', {
        body: {
          action: 'get-member',
          wixMemberId
        }
      });

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error getting Wix member:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const getProfile = useCallback(async (wixMemberId: string): Promise<{ profile: WixProfile }> => {
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
    }
  }, []);

  const getReferralInfo = useCallback(async (wixMemberId: string): Promise<{ referral: WixReferralInfo }> => {
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
    }
  }, []);

  const getOrders = useCallback(async (userEmail: string): Promise<WixOrder[]> => {
    try {
      const { data, error } = await supabase.functions.invoke('wix-integration', {
        body: {
          action: 'get-orders',
          email: userEmail
        }
      });

      if (error) throw error;
      return data.orders || [];
    } catch (error) {
      console.error('Error getting Wix orders:', error);
      return [];
    }
  }, []);

  const getLoyaltyAndReferrals = useCallback(async (userEmail: string): Promise<{ loyalty: WixLoyalty | null; referrals: WixReferralStats | null }> => {
    try {
      const { data, error } = await supabase.functions.invoke('wix-integration', {
        body: {
          action: 'get-loyalty',
          email: userEmail
        }
      });

      if (error) throw error;
      return {
        loyalty: data.loyalty || null,
        referrals: data.referrals || null
      };
    } catch (error) {
      console.error('Error getting loyalty/referrals:', error);
      return { loyalty: null, referrals: null };
    }
  }, []);

  const fetchWixData = useCallback(async (userEmail: string) => {
    if (!userEmail || loading) return;
    
    // Throttle Wix calls - only fetch once per minute
    const lastFetch = localStorage.getItem('lastWixFetch');
    const now = Date.now();
    if (lastFetch && (now - parseInt(lastFetch)) < 60000) {
      return; // Skip if fetched within last minute
    }
    
    setLoading(true);
    try {
      console.log('Fetching Wix data for:', userEmail);
      localStorage.setItem('lastWixFetch', now.toString());
      
      // Try to get existing member
      const memberResult = await verifyWixMember(userEmail);
      
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

        // Fetch real orders from Wix
        try {
          const orders = await getOrders(userEmail);
          setWixOrders(orders);
        } catch (error) {
          console.error('Error fetching orders:', error);
        }

        // Fetch loyalty and referral info
        try {
          const { loyalty, referrals } = await getLoyaltyAndReferrals(userEmail);
          setWixLoyalty(loyalty);
          if (referrals) {
            setWixReferrals({
              code: '',
              link: '',
              memberId: memberResult.member.id,
              referralUrl: '',
              totalReferrals: referrals.totalReferrals,
              totalEarnings: referrals.earnings,
              pendingEarnings: '0.00'
            });
          }
        } catch (error) {
          console.error('Error fetching loyalty/referrals:', error);
        }
      }
    } catch (error) {
      console.error('Error fetching Wix data:', error);
    } finally {
      setLoading(false);
    }
  }, [loading, verifyWixMember, getProfile, getOrders, getLoyaltyAndReferrals]);

  const testConnection = useCallback(async (): Promise<{ connected: boolean; totalMembers?: number; error?: string; message?: string }> => {
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
  }, []);

  const createMember = useCallback(async (memberData: CreateMemberData): Promise<{ member: WixMember }> => {
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
  }, []);

  const addToEmailList = useCallback(async (memberData: CreateMemberData): Promise<{ success: boolean; contact?: any }> => {
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
  }, []);

  const sendMessage = useCallback(async (subject: string, message: string, senderEmail: string, senderName?: string): Promise<{ success: boolean; message?: string }> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('wix-integration', {
        body: {
          action: 'send-message',
          subject,
          message,
          senderEmail,
          senderName
        }
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    wixProfile,
    wixOrders,
    wixReferrals,
    wixLoyalty,
    verifyWixMember,
    getWixMember,
    testConnection,
    createMember,
    getProfile,
    getReferralInfo,
    getOrders,
    getLoyaltyAndReferrals,
    addToEmailList,
    sendMessage,
    fetchWixData
  };
};