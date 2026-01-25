import { useState, useCallback } from 'react';
import { invokeEdgeFunction } from '@/utils/edgeFunctions';

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
    console.log('[WixIntegration] Verifying Wix member:', email);
    
    try {
      const { data, error } = await invokeEdgeFunction<{ exists: boolean; member: WixMember | null }>('wix-integration', {
        body: { action: 'verify-member', email },
        timeout: 15000,
        retries: 2,
      });

      // CRITICAL: Throw on error so Auth.tsx fallback can catch it
      if (error) {
        console.error('[WixIntegration] Wix verification network error:', error);
        throw error;
      }
      
      console.log('[WixIntegration] Member verification result:', data?.exists);
      return data || { exists: false, member: null };
    } catch (err) {
      console.error('[WixIntegration] Wix verification failed:', err);
      // Re-throw to trigger fallback in Auth.tsx
      throw err;
    }
  }, []);

  const getWixMember = useCallback(async (wixMemberId: string): Promise<{ member: WixMember }> => {
    setLoading(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ member: WixMember }>('wix-integration', {
        body: { action: 'get-member', wixMemberId },
        timeout: 15000,
        retries: 2,
      });

      if (error) throw error;
      if (!data?.member) throw new Error('No member data returned');
      return data;
    } catch (error) {
      console.error('[WixIntegration] Error getting Wix member:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const getProfile = useCallback(async (wixMemberId: string): Promise<{ profile: WixProfile }> => {
    try {
      const { data, error } = await invokeEdgeFunction<{ profile: WixProfile }>('wix-integration', {
        body: { action: 'get-profile', wixMemberId },
        timeout: 15000,
        retries: 2,
      });

      if (error) throw error;
      if (!data?.profile) throw new Error('No profile data returned');
      return data;
    } catch (error) {
      console.error('[WixIntegration] Error getting Wix profile:', error);
      throw error;
    }
  }, []);

  const getReferralInfo = useCallback(async (wixMemberId: string): Promise<{ referral: WixReferralInfo }> => {
    try {
      const { data, error } = await invokeEdgeFunction<{ referral: WixReferralInfo }>('wix-integration', {
        body: { action: 'get-referral-info', wixMemberId },
        timeout: 15000,
        retries: 2,
      });

      if (error) throw error;
      if (!data?.referral) throw new Error('No referral data returned');
      return data;
    } catch (error) {
      console.error('[WixIntegration] Error getting referral info:', error);
      throw error;
    }
  }, []);

  const getOrders = useCallback(async (userEmail: string): Promise<WixOrder[]> => {
    try {
      const { data, error } = await invokeEdgeFunction<{ orders: WixOrder[] }>('wix-integration', {
        body: { action: 'get-orders', email: userEmail },
        timeout: 15000,
        retries: 2,
      });

      if (error) throw error;
      return data?.orders || [];
    } catch (error) {
      console.error('[WixIntegration] Error getting Wix orders:', error);
      return [];
    }
  }, []);

  const getLoyaltyAndReferrals = useCallback(async (userEmail: string): Promise<{ loyalty: WixLoyalty | null; referrals: WixReferralStats | null }> => {
    try {
      const { data, error } = await invokeEdgeFunction<{ loyalty: WixLoyalty; referrals: WixReferralStats }>('wix-integration', {
        body: { action: 'get-loyalty', email: userEmail },
        timeout: 15000,
        retries: 2,
      });

      if (error) throw error;
      return {
        loyalty: data?.loyalty || null,
        referrals: data?.referrals || null
      };
    } catch (error) {
      console.error('[WixIntegration] Error getting loyalty/referrals:', error);
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
      const { data, error } = await invokeEdgeFunction<{ connected: boolean; totalMembers?: number; error?: string; message?: string }>('wix-integration', {
        body: { action: 'test-connection' },
        timeout: 15000,
        retries: 2,
      });

      if (error) throw error;
      return data || { connected: false, error: 'No response' };
    } catch (error) {
      console.error('[WixIntegration] Error testing Wix connection:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const createMember = useCallback(async (memberData: CreateMemberData): Promise<{ member: WixMember }> => {
    setLoading(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ member: WixMember }>('wix-integration', {
        body: { action: 'create-member', memberData },
        timeout: 20000,
        retries: 2,
      });

      if (error) throw error;
      if (!data?.member) throw new Error('No member data returned');
      return data;
    } catch (error) {
      console.error('[WixIntegration] Error creating Wix member:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const addToEmailList = useCallback(async (memberData: CreateMemberData): Promise<{ success: boolean; contact?: any }> => {
    setLoading(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ success: boolean; contact?: any }>('wix-integration', {
        body: { action: 'add-to-email-list', memberData },
        timeout: 15000,
        retries: 2,
      });

      if (error) throw error;
      return data || { success: false };
    } catch (error) {
      console.error('[WixIntegration] Error adding to email list:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const sendMessage = useCallback(async (subject: string, message: string, senderEmail: string, senderName?: string): Promise<{ success: boolean; message?: string }> => {
    setLoading(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ success: boolean; message?: string }>('wix-integration', {
        body: { action: 'send-message', subject, message, senderEmail, senderName },
        timeout: 15000,
        retries: 2,
      });

      if (error) throw error;
      return data || { success: false };
    } catch (error) {
      console.error('[WixIntegration] Error sending message:', error);
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
