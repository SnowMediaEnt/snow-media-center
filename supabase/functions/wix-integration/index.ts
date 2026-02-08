import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Authentication helper
async function authenticateUser(req: Request): Promise<{ userId: string | null; error: Response | null }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { 
      userId: null, 
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    };
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    console.error('Auth error:', userError);
    return { 
      userId: null, 
      error: new Response(JSON.stringify({ error: 'Invalid token' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    };
  }

  return { userId: user.id, error: null };
}

interface WixMember {
  id: string;
  loginEmail: string;
  profile: {
    nickname?: string;
    firstName?: string;
    lastName?: string;
  };
  contactId?: string;
}

interface TestEndpoint {
  name: string;
  status: number | string;
  success: boolean;
  response: string;
}

interface TestResults {
  endpoints: TestEndpoint[];
  connected: boolean;
  workingEndpoint: string | null;
  totalMembers: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse request body early to check action
    let payload: any = {};
    try {
      payload = await req.json();
    } catch (e) {
      console.warn('No/invalid JSON body, defaulting to empty payload');
      payload = {};
    }
    
    const { action, email, wixMemberId, items, memberData, subject, message: messageText, senderEmail, senderName } = payload;
    
    // Define public actions that don't require authentication
    // These include read-only actions needed for dashboard/store functionality
    const publicActions = [
      'get-products', 
      'test-connection',
      'verify-member',
      'get-profile',
      'get-member',
      'get-orders',
      'get-loyalty',
      'get-referral-info',
      'create-member',  // Allow signup flow to work
      'create-cart'     // Allow checkout without auth (guest checkout)
    ];
    const isPublicAction = publicActions.includes(action);
    
    // Only authenticate for non-public actions
    let userId: string | null = null;
    if (!isPublicAction) {
      const { userId: authUserId, error: authError } = await authenticateUser(req);
      if (authError) {
        return authError;
      }
      userId = authUserId;
    }

    console.log('=== WIX INTEGRATION FUNCTION START ===');
    console.log('Wix integration function called, action:', action, 'public:', isPublicAction, 'user:', userId);
    
    const wixApiKey = Deno.env.get('WIX_API_KEY');
    const wixAccountId = Deno.env.get('WIX_ACCOUNT_ID');
    const wixSiteId = Deno.env.get('WIX_SITE_ID');
    
    console.log('=== ENVIRONMENT VARIABLES ===');
    console.log('API Key present:', !!wixApiKey);
    console.log('Account ID present:', !!wixAccountId);
    console.log('Site ID present:', !!wixSiteId);
    console.log('API Key format:', wixApiKey ? `${wixApiKey.substring(0, 10)}...` : 'missing');
    console.log('Account ID:', wixAccountId);
    console.log('Site ID:', wixSiteId);
    console.log('=== END ENVIRONMENT VARIABLES ===');
    
    if (!wixApiKey || !wixAccountId) {
      console.error('Missing WIX_API_KEY or WIX_ACCOUNT_ID');
      return new Response(
        JSON.stringify({ 
          error: 'Wix API credentials not configured',
          details: {
            hasApiKey: !!wixApiKey,
            hasAccountId: !!wixAccountId,
            hasSiteId: !!wixSiteId
          }
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('=== REQUEST DETAILS ===');
    console.log('Action requested:', action);
    console.log('Items for cart:', items ? JSON.stringify(items, null, 2) : 'No items');
    console.log('=== END REQUEST DETAILS ===');

    switch (action) {
      case 'get-products':
        if (!wixSiteId) {
          return new Response(
            JSON.stringify({ 
              error: 'Site ID required for products API',
              details: 'WIX_SITE_ID is required for site-level operations like fetching products.'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // Get products using V1 API
        const productsResponse = await fetch('https://www.wixapis.com/stores/v1/products/query', {
          method: 'POST',
          headers: {
            'Authorization': wixApiKey,
            'wix-site-id': wixSiteId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: {
              paging: {
                limit: 50
              }
            }
          })
        });

        console.log('Products API response status:', productsResponse.status);
        if (!productsResponse.ok) {
          const errorText = await productsResponse.text();
          console.error('Products API error:', errorText);
          return new Response(
            JSON.stringify({ 
              error: `Wix Store API error: ${productsResponse.status} ${productsResponse.statusText}`,
              details: errorText,
              apiKey: wixApiKey ? `${wixApiKey.substring(0, 10)}...` : 'missing',
              accountId: wixAccountId
            }),
            { 
              status: 500, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }

        const productsData = await productsResponse.json();
        
        return new Response(
          JSON.stringify({ 
            products: productsData.products || [],
            total: productsData.totalResults || 0
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );

      case 'create-cart':
        if (!wixSiteId) {
          return new Response(
            JSON.stringify({ 
              error: 'Site ID required for checkout',
              details: 'WIX_SITE_ID is required for eCommerce operations.'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        console.log('=== CREATE CHECKOUT DEBUG ===');
        console.log('Items:', JSON.stringify(items, null, 2));
        console.log('Site ID being used:', wixSiteId);
        
        if (!items || !Array.isArray(items) || items.length === 0) {
          console.error('Invalid or missing items');
          return new Response(
            JSON.stringify({ error: 'Items array is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        const checkoutHeaders: Record<string, string> = {
          'Authorization': wixApiKey,
          'wix-site-id': wixSiteId,
          'Content-Type': 'application/json',
        };
        
        // Create checkout directly with line items (skip cart creation)
        const checkoutResponse = await fetch(`https://www.wixapis.com/ecom/v1/checkouts`, {
          method: 'POST',
          headers: checkoutHeaders,
          body: JSON.stringify({
            channelType: 'WEB',
            lineItems: items.map((item: any) => ({
              catalogReference: {
                appId: "215238eb-22a5-4c36-9e7b-e7c08025e04e",
                catalogItemId: item.productId
              },
              quantity: item.quantity
            }))
          })
        });

        console.log('Checkout API response status:', checkoutResponse.status);
        const checkoutText = await checkoutResponse.text();
        console.log('Checkout API full response:', checkoutText);
        
        if (!checkoutResponse.ok) {
          console.error('Checkout API error - Status:', checkoutResponse.status);
          console.error('Checkout API error - Response:', checkoutText);
          
          return new Response(
            JSON.stringify({ 
              error: `Wix Checkout API error: ${checkoutResponse.status} ${checkoutResponse.statusText}`,
              details: checkoutText,
              requestInfo: {
                hasSiteId: !!wixSiteId,
                itemCount: items.length
              }
            }),
            { 
              status: checkoutResponse.status, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }

        const checkoutData = JSON.parse(checkoutText);
        const checkoutId = checkoutData.checkout?.id;
        
        // Get the checkout URL for redirect using GET request
        let checkoutUrl = null;
        if (checkoutId) {
          console.log('Checkout created with ID:', checkoutId);
          
          // Use GET request to the correct endpoint format
          const redirectResponse = await fetch(`https://www.wixapis.com/ecom/v1/checkouts/${checkoutId}/checkout-url`, {
            method: 'GET',
            headers: {
              'Authorization': wixApiKey,
              'wix-site-id': wixSiteId,
            }
          });
          
          console.log('Redirect URL response status:', redirectResponse.status);
          const redirectText = await redirectResponse.text();
          console.log('Redirect URL response body:', redirectText);
          
          if (redirectResponse.ok) {
            const redirectData = JSON.parse(redirectText);
            checkoutUrl = redirectData.checkoutUrl;
            console.log('Checkout URL:', checkoutUrl);
          } else {
            console.error('Failed to get checkout URL:', redirectText);
          }
        }
        
        return new Response(
          JSON.stringify({ 
            checkout: checkoutData.checkout,
            checkoutUrl: checkoutUrl,
            cart: { id: checkoutId } // For backward compatibility
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );

      case 'verify-member':
        console.log('Verifying member with email:', email);
        
        if (!wixSiteId) {
          return new Response(
            JSON.stringify({ 
              error: 'Site ID required for member verification',
              details: 'WIX_SITE_ID is required for member operations.'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        const memberResponse = await fetch(`https://www.wixapis.com/members/v1/members/query`, {
          method: 'POST',
          headers: {
            'Authorization': wixApiKey,
            'wix-site-id': wixSiteId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: {
              loginEmail: { $eq: email }
            },
            fieldsets: ['FULL'] // Required to get loginEmail in response
          })
        });

        console.log('Member verification response status:', memberResponse.status);

        if (memberResponse.status === 404) {
          return new Response(
            JSON.stringify({ 
              exists: false,
              member: null
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        } else if (!memberResponse.ok) {
          const errorText = await memberResponse.text();
          console.error('Wix API error:', errorText);
          throw new Error(`Wix API error: ${memberResponse.status} ${memberResponse.statusText}`);
        }

        const memberData = await memberResponse.json();
        
        // DEBUG: Log response info
        console.log('Wix query filter used:', JSON.stringify({ loginEmail: { $eq: email } }));
        console.log('Total members returned from Wix:', memberData.members?.length || 0);
        
        // CRITICAL FIX: The Wix API seems to ignore the filter and return all members
        // We MUST manually find the matching member by email
        const normalizedEmail = email?.toLowerCase().trim();
        const matchingMember = memberData.members?.find((m: any) => 
          m.loginEmail?.toLowerCase().trim() === normalizedEmail
        );
        
        if (matchingMember) {
          console.log(`Found matching member: id=${matchingMember.id}, email=${matchingMember.loginEmail}, name=${matchingMember.profile?.firstName || matchingMember.profile?.nickname}`);
        } else {
          console.log(`No member found matching email: ${email}`);
          // Log first few members for debugging
          memberData.members?.slice(0, 5).forEach((m: any, idx: number) => {
            console.log(`Sample member ${idx}: loginEmail=${m.loginEmail}`);
          });
        }

        return new Response(
          JSON.stringify({ 
            exists: !!matchingMember,
            member: matchingMember ? {
              id: matchingMember.id,
              email: matchingMember.loginEmail,
              name: matchingMember.profile?.firstName || matchingMember.profile?.nickname || 'Unknown'
            } : null
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );

      case 'test-connection':
        console.log('Testing Wix API connection...');
        
        const testResults: TestResults = {
          endpoints: [],
          connected: false,
          workingEndpoint: null,
          totalMembers: 0
        };
        
        // Test with site ID if available
        if (wixSiteId) {
          try {
            const testResponse = await fetch(`https://www.wixapis.com/members/v1/members/query`, {
              method: 'POST',
              headers: {
                'Authorization': wixApiKey,
                'wix-site-id': wixSiteId,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                query: { paging: { limit: 1 } }
              })
            });
            
            const testText = await testResponse.text();
            
            testResults.endpoints.push({
              name: 'wix-site-id header',
              status: testResponse.status,
              success: testResponse.ok,
              response: testText
            });
            
            if (testResponse.ok) {
              const data = JSON.parse(testText);
              testResults.connected = true;
              testResults.workingEndpoint = 'wix-site-id';
              testResults.totalMembers = data.totalCount || 0;
            }
          } catch (error) {
            console.error('Test error:', error);
            testResults.endpoints.push({
              name: 'wix-site-id header',
              status: 'error',
              success: false,
              response: error instanceof Error ? error.message : String(error)
            });
          }
        }
        
        return new Response(
          JSON.stringify({
            connected: testResults.connected,
            totalMembers: testResults.totalMembers,
            workingEndpoint: testResults.workingEndpoint,
            endpoints: testResults.endpoints,
            message: testResults.connected ? 'Successfully connected to Wix API!' : 'Unable to connect to Wix API'
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );

      case 'create-member':
        console.log('Creating new Wix member:', memberData);
        
        if (!wixSiteId) {
          return new Response(
            JSON.stringify({ 
              error: 'Site ID required for member creation',
              details: 'WIX_SITE_ID is required for member operations.'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        if (!memberData || !memberData.email) {
          return new Response(
            JSON.stringify({ error: 'Email is required for member creation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // Create a new member in Wix
        const createMemberResponse = await fetch('https://www.wixapis.com/members/v1/members', {
          method: 'POST',
          headers: {
            'Authorization': wixApiKey,
            'wix-site-id': wixSiteId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            member: {
              loginEmail: memberData.email,
              profile: {
                firstName: memberData.firstName || '',
                lastName: memberData.lastName || '',
                nickname: memberData.nickname || memberData.email.split('@')[0]
              },
              status: 'APPROVED'
            }
          })
        });
        
        console.log('Create member response status:', createMemberResponse.status);
        const createMemberText = await createMemberResponse.text();
        console.log('Create member response:', createMemberText);
        
        if (!createMemberResponse.ok) {
          return new Response(
            JSON.stringify({ 
              error: `Failed to create Wix member: ${createMemberResponse.status}`,
              details: createMemberText
            }),
            { status: createMemberResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        const createdMemberData = JSON.parse(createMemberText);
        return new Response(
          JSON.stringify({ 
            success: true,
            member: {
              id: createdMemberData.member?.id,
              email: createdMemberData.member?.loginEmail,
              name: createdMemberData.member?.profile?.firstName || memberData.email.split('@')[0]
            }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      case 'get-orders':
        console.log('Getting orders for member:', wixMemberId || email);
        
        if (!wixSiteId) {
          return new Response(
            JSON.stringify({ 
              error: 'Site ID required for orders API',
              details: 'WIX_SITE_ID is required for eCommerce operations.'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // Query orders from Wix eCommerce
        const ordersResponse = await fetch('https://www.wixapis.com/ecom/v1/orders/query', {
          method: 'POST',
          headers: {
            'Authorization': wixApiKey,
            'wix-site-id': wixSiteId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: {
              filter: email ? { 'buyerInfo.email': { $eq: email } } : {},
              paging: { limit: 50 },
              sort: [{ fieldName: 'createdDate', order: 'DESC' }]
            }
          })
        });
        
        console.log('Orders API response status:', ordersResponse.status);
        
        if (!ordersResponse.ok) {
          const errorText = await ordersResponse.text();
          console.error('Orders API error:', errorText);
          return new Response(
            JSON.stringify({ 
              orders: [],
              error: `Orders API error: ${ordersResponse.status}`,
              details: errorText
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        const ordersData = await ordersResponse.json();
        const orders = (ordersData.orders || []).map((order: any) => ({
          id: order.id,
          number: order.number,
          total: order.priceSummary?.total?.formattedAmount || '$0.00',
          status: order.fulfillmentStatus || order.paymentStatus || 'unknown',
          created_at: order.createdDate,
          items: (order.lineItems || []).map((item: any) => ({
            name: item.productName?.original || item.name,
            quantity: item.quantity,
            price: item.price?.formattedAmount
          }))
        }));
        
        return new Response(
          JSON.stringify({ orders, total: ordersData.totalResults || 0 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      case 'get-profile':
        console.log('Getting profile for member:', wixMemberId);
        
        if (!wixSiteId) {
          return new Response(
            JSON.stringify({ 
              error: 'Site ID required for profile API'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        if (!wixMemberId) {
          return new Response(
            JSON.stringify({ error: 'wixMemberId is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // Get member details by ID
        const profileResponse = await fetch(`https://www.wixapis.com/members/v1/members/${wixMemberId}`, {
          method: 'GET',
          headers: {
            'Authorization': wixApiKey,
            'wix-site-id': wixSiteId,
          }
        });
        
        console.log('Profile API response status:', profileResponse.status);
        
        if (!profileResponse.ok) {
          const errorText = await profileResponse.text();
          console.error('Profile API error:', errorText);
          return new Response(
            JSON.stringify({ 
              profile: null,
              error: `Profile API error: ${profileResponse.status}`
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        const profileData = await profileResponse.json();
        const profile = {
          id: profileData.member?.id,
          email: profileData.member?.loginEmail,
          firstName: profileData.member?.profile?.firstName || '',
          lastName: profileData.member?.profile?.lastName || '',
          nickname: profileData.member?.profile?.nickname || '',
          addresses: profileData.member?.contact?.addresses || [],
          phoneNumber: profileData.member?.contact?.phones?.[0] || '',
          picture: profileData.member?.profile?.photo?.url || '',
          purchaseHistory: []
        };
        
        return new Response(
          JSON.stringify({ profile }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      case 'get-member':
        console.log('Getting member by ID:', wixMemberId);
        
        if (!wixSiteId) {
          return new Response(
            JSON.stringify({ error: 'Site ID required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        if (!wixMemberId) {
          return new Response(
            JSON.stringify({ error: 'wixMemberId is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        const getMemberResponse = await fetch(`https://www.wixapis.com/members/v1/members/${wixMemberId}`, {
          method: 'GET',
          headers: {
            'Authorization': wixApiKey,
            'wix-site-id': wixSiteId,
          }
        });
        
        if (!getMemberResponse.ok) {
          const errorText = await getMemberResponse.text();
          console.error('Get member error:', errorText);
          return new Response(
            JSON.stringify({ member: null, error: `API error: ${getMemberResponse.status}` }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        const getMemberData = await getMemberResponse.json();
        return new Response(
          JSON.stringify({ 
            member: {
              id: getMemberData.member?.id,
              email: getMemberData.member?.loginEmail,
              name: getMemberData.member?.profile?.firstName || getMemberData.member?.profile?.nickname || 'Unknown',
              fullProfile: getMemberData.member
            }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      case 'get-referral-info':
        console.log('Getting referral info for member:', wixMemberId);
        
        if (!wixSiteId) {
          return new Response(
            JSON.stringify({ error: 'Site ID required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // Return placeholder referral data - Wix referrals API may not be available
        return new Response(
          JSON.stringify({ 
            referral: {
              code: '',
              link: '',
              memberId: wixMemberId || '',
              referralUrl: '',
              totalReferrals: 0,
              totalEarnings: '$0.00',
              pendingEarnings: '$0.00'
            }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      case 'add-to-email-list':
        console.log('Adding to email list:', payload.memberData);
        
        if (!wixSiteId) {
          return new Response(
            JSON.stringify({ error: 'Site ID required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        const emailListData = payload.memberData;
        if (!emailListData?.email) {
          return new Response(
            JSON.stringify({ error: 'Email is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // Use Contacts API to add to email list
        const contactResponse = await fetch('https://www.wixapis.com/contacts/v4/contacts', {
          method: 'POST',
          headers: {
            'Authorization': wixApiKey,
            'wix-account-id': wixAccountId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            info: {
              name: {
                first: emailListData.firstName || '',
                last: emailListData.lastName || ''
              },
              emails: {
                items: [{ email: emailListData.email }]
              }
            }
          })
        });
        
        console.log('Contact creation response status:', contactResponse.status);
        
        if (!contactResponse.ok) {
          const errorText = await contactResponse.text();
          console.error('Contact API error:', errorText);
          return new Response(
            JSON.stringify({ success: false, error: `Contact API error: ${contactResponse.status}` }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        const contactData = await contactResponse.json();
        return new Response(
          JSON.stringify({ success: true, contact: contactData.contact }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      case 'send-message':
        console.log('Sending message from:', senderEmail);
        
        // For now, just log the message - would need Wix Inbox API setup
        console.log('Message subject:', subject);
        console.log('Message body:', messageText);
        console.log('Sender name:', senderName);
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Message received (Wix Inbox API integration pending)'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      case 'get-loyalty':
        console.log('Getting loyalty/referral info for:', email || wixMemberId);
        
        if (!wixSiteId) {
          return new Response(
            JSON.stringify({ 
              error: 'Site ID required for loyalty API'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // Try to get loyalty program info
        const loyaltyResponse = await fetch('https://www.wixapis.com/loyalty/v1/accounts/query', {
          method: 'POST',
          headers: {
            'Authorization': wixApiKey,
            'wix-site-id': wixSiteId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: {
              filter: email ? { contactId: { $exists: true } } : {},
              paging: { limit: 1 }
            }
          })
        });
        
        console.log('Loyalty API response status:', loyaltyResponse.status);
        
        // Also try referrals API
        const referralResponse = await fetch('https://www.wixapis.com/loyalty-referrals/v1/referrals/query', {
          method: 'POST',
          headers: {
            'Authorization': wixApiKey,
            'wix-site-id': wixSiteId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: { paging: { limit: 50 } }
          })
        });
        
        console.log('Referrals API response status:', referralResponse.status);
        
        let loyaltyData = { points: 0, tier: 'None' };
        let referralData = { totalReferrals: 0, earnings: '$0.00' };
        
        if (loyaltyResponse.ok) {
          const loyalty = await loyaltyResponse.json();
          if (loyalty.accounts?.[0]) {
            loyaltyData = {
              points: loyalty.accounts[0].points?.balance || 0,
              tier: loyalty.accounts[0].tier?.name || 'Standard'
            };
          }
        }
        
        if (referralResponse.ok) {
          const referrals = await referralResponse.json();
          referralData = {
            totalReferrals: referrals.totalResults || 0,
            earnings: referrals.referrals?.[0]?.earnings?.formattedAmount || '$0.00'
          };
        }
        
        return new Response(
          JSON.stringify({ 
            loyalty: loyaltyData,
            referrals: referralData,
            success: true
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
    }

  } catch (error) {
    console.error('Error in wix-integration function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : String(error)
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});