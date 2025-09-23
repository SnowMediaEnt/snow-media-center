
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== WIX INTEGRATION FUNCTION START ===');
    console.log('Wix integration function called');
    
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
    
    // Test if the function is even being reached
    console.log('Environment check passed');
    
    if (!wixApiKey || !wixAccountId || !wixSiteId) {
      console.error('Missing WIX_API_KEY, WIX_ACCOUNT_ID, or WIX_SITE_ID');
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

    const { action, email, wixMemberId, items, memberData } = await req.json();
    console.log('Action requested:', action);

    switch (action) {
      case 'get-products':
        // First check catalog version
        const versionResponse = await fetch('https://www.wixapis.com/stores/v3/provision/version', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${wixApiKey}`,
            'wix-site-id': wixSiteId,
            'Content-Type': 'application/json',
          }
        });

        console.log('Version API response status:', versionResponse.status);
        let catalogVersion = 'V1_CATALOG'; // Default to V1
        if (versionResponse.ok) {
          const versionData = await versionResponse.json();
          catalogVersion = versionData.catalogVersion || 'V1_CATALOG';
          console.log('Catalog version:', catalogVersion);
        } else {
          const versionError = await versionResponse.text();
          console.log('Version API error:', versionError);
          console.log('Defaulting to V1_CATALOG');
        }

        // Use appropriate API based on catalog version
        let productsResponse;
        if (catalogVersion === 'V3_CATALOG') {
          productsResponse = await fetch('https://www.wixapis.com/stores/v3/products/query', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${wixApiKey}`,
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
        } else {
          productsResponse = await fetch('https://www.wixapis.com/stores/v1/products/query', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${wixApiKey}`,
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
        }

        console.log('Products API response status:', productsResponse.status);
        if (!productsResponse.ok) {
          const errorText = await productsResponse.text();
          console.error('Products API error:', errorText);
          console.error('Response headers:', Object.fromEntries(productsResponse.headers.entries()));
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
            total: productsData.totalResults || 0,
            catalogVersion
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );

      case 'create-cart':
        // Create a cart in Wix using eCommerce API
        const cartResponse = await fetch(`https://www.wixapis.com/ecom/v1/carts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${wixApiKey}`,
            'wix-site-id': wixSiteId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            lineItems: items.map(item => ({
              catalogReference: {
                appId: "1380b703-ce81-ff05-f115-39571d94dfcd", // Wix Stores app ID
                productId: item.productId,
                catalogItemId: item.productId
              },
              quantity: item.quantity
            }))
          })
        });

        console.log('Cart API response status:', cartResponse.status);
        if (!cartResponse.ok) {
          const errorText = await cartResponse.text();
          console.error('Cart API error:', errorText);
          console.error('Cart Response headers:', Object.fromEntries(cartResponse.headers.entries()));
          throw new Error(`Wix Cart API error: ${cartResponse.status} ${cartResponse.statusText} - ${errorText}`);
        }

        const cartData = await cartResponse.json();
        
        return new Response(
          JSON.stringify({ 
            cart: cartData.cart,
            checkoutUrl: cartData.cart?.checkoutUrl
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );

      case 'verify-member':
        // Verify if a member exists in Wix by email
        console.log('Verifying member with email:', email);
        console.log('Using API Key:', wixApiKey ? `${wixApiKey.substring(0, 20)}...` : 'missing');
        console.log('Using Account ID:', wixAccountId);
        
        const requestHeaders = {
          'Authorization': `Bearer ${wixApiKey}`,
          'wix-site-id': wixSiteId,
          'Content-Type': 'application/json',
        };
        
        console.log('Request headers:', JSON.stringify(requestHeaders, null, 2));
        
        const requestBody = {
          filter: {
            loginEmail: { $eq: email }
          }
        };
        
        console.log('Request body:', JSON.stringify(requestBody, null, 2));
        
        const memberResponse = await fetch(`https://www.wixapis.com/members/v1/members/query`, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(requestBody)
        });

        console.log('Member verification response status:', memberResponse.status);
        console.log('Member verification response headers:', JSON.stringify(Object.fromEntries(memberResponse.headers.entries()), null, 2));

        // Handle different response statuses
        if (memberResponse.status === 404) {
          // Member not found - this is expected behavior
          console.log('Member not found (404) - returning exists: false');
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
          // Other errors (401, 403, 500, etc.) should be treated as actual errors
          const errorText = await memberResponse.text();
          console.error('Wix API error:', errorText);
          throw new Error(`Wix API error: ${memberResponse.status} ${memberResponse.statusText}`);
        }

        const memberData = await memberResponse.json();
        const member = memberData.members?.[0];

        console.log('Member found:', !!member);
        console.log('Member data:', member ? { id: member.id, email: member.loginEmail } : 'none');

        return new Response(
          JSON.stringify({ 
            exists: !!member,
            member: member ? {
              id: member.id,
              email: member.loginEmail,
              name: member.profile?.firstName || member.profile?.nickname || 'Unknown'
            } : null
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );

      case 'get-member':
        // Get member details by ID
        if (!wixMemberId) {
          return new Response(
            JSON.stringify({ error: 'Wix member ID required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const detailResponse = await fetch(`https://www.wixapis.com/members/v1/members/${wixMemberId}`, {
          headers: {
            'Authorization': `Bearer ${wixApiKey}`,
            'wix-site-id': wixSiteId,
            'Content-Type': 'application/json',
          }
        });

        if (!detailResponse.ok) {
          throw new Error(`Wix API error: ${detailResponse.statusText}`);
        }

        const memberDetails = await detailResponse.json();

        return new Response(
          JSON.stringify({ 
            member: {
              id: memberDetails.member.id,
              email: memberDetails.member.loginEmail,
              name: memberDetails.member.profile?.firstName || memberDetails.member.profile?.nickname || 'Unknown',
              fullProfile: memberDetails.member.profile
            }
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );

      case 'test-connection':
        // Test multiple Wix API endpoints and authentication methods
        console.log('Testing Wix API connection with multiple approaches...');
        console.log('API Key format:', wixApiKey ? `${wixApiKey.substring(0, 20)}...` : 'missing');
        console.log('Account/Site ID:', wixAccountId);
        
        const testResults = {
          endpoints: [],
          connected: false,
          workingEndpoint: null,
          totalMembers: 0
        };
        
        // Test 1: Try with wix-site-id header
        console.log('Test 1: Standard wix-site-id approach');
        try {
          const test1Response = await fetch(`https://www.wixapis.com/members/v1/members/query`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${wixApiKey}`,
              'wix-site-id': wixSiteId,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: { paging: { limit: 1 } }
            })
          });
          
          const test1Text = await test1Response.text();
          console.log('Test 1 status:', test1Response.status, 'body:', test1Text);
          
          testResults.endpoints.push({
            name: 'wix-site-id header',
            status: test1Response.status,
            success: test1Response.ok,
            response: test1Text
          });
          
          if (test1Response.ok) {
            const data = JSON.parse(test1Text);
            testResults.connected = true;
            testResults.workingEndpoint = 'wix-site-id';
            testResults.totalMembers = data.totalCount || 0;
          }
        } catch (error) {
          console.error('Test 1 error:', error);
          testResults.endpoints.push({
            name: 'wix-site-id header',
            status: 'error',
            success: false,
            response: error.message
          });
        }
        
        // Test 2: Try with wix-account-id header instead
        if (!testResults.connected) {
          console.log('Test 2: Using wix-account-id header');
          try {
            const test2Response = await fetch(`https://www.wixapis.com/members/v1/members/query`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${wixApiKey}`,
                'wix-account-id': wixAccountId,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                query: { paging: { limit: 1 } }
              })
            });
            
            const test2Text = await test2Response.text();
            console.log('Test 2 status:', test2Response.status, 'body:', test2Text);
            
            testResults.endpoints.push({
              name: 'wix-account-id header',
              status: test2Response.status,
              success: test2Response.ok,
              response: test2Text
            });
            
            if (test2Response.ok) {
              const data = JSON.parse(test2Text);
              testResults.connected = true;
              testResults.workingEndpoint = 'wix-account-id';
              testResults.totalMembers = data.totalCount || 0;
            }
          } catch (error) {
            console.error('Test 2 error:', error);
            testResults.endpoints.push({
              name: 'wix-account-id header',
              status: 'error',
              success: false,
              response: error.message
            });
          }
        }
        
        // Test 3: Try both headers
        if (!testResults.connected) {
          console.log('Test 3: Using both wix-site-id and wix-account-id headers');
          try {
            const test3Response = await fetch(`https://www.wixapis.com/members/v1/members/query`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${wixApiKey}`,
                'wix-site-id': wixSiteId,
                'wix-account-id': wixAccountId,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                query: { paging: { limit: 1 } }
              })
            });
            
            const test3Text = await test3Response.text();
            console.log('Test 3 status:', test3Response.status, 'body:', test3Text);
            
            testResults.endpoints.push({
              name: 'both headers',
              status: test3Response.status,
              success: test3Response.ok,
              response: test3Text
            });
            
            if (test3Response.ok) {
              const data = JSON.parse(test3Text);
              testResults.connected = true;
              testResults.workingEndpoint = 'both headers';
              testResults.totalMembers = data.totalCount || 0;
            }
          } catch (error) {
            console.error('Test 3 error:', error);
            testResults.endpoints.push({
              name: 'both headers',
              status: 'error',
              success: false,
              response: error.message
            });
          }
        }
        
        return new Response(
          JSON.stringify({ 
            connected: testResults.connected,
            totalMembers: testResults.totalMembers,
            workingEndpoint: testResults.workingEndpoint,
            testResults: testResults.endpoints,
            message: testResults.connected ? 'Found working endpoint!' : 'All endpoints failed'
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );

      case 'create-member':
        // Create a new member in Wix
        if (!memberData || !memberData.email) {
          return new Response(
            JSON.stringify({ error: 'Member data with email is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const createMemberResponse = await fetch(`https://www.wixapis.com/members/v1/members`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${wixApiKey}`,
            'wix-site-id': wixSiteId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            loginEmail: memberData.email,
            profile: {
              firstName: memberData.firstName || '',
              lastName: memberData.lastName || '',
              nickname: memberData.nickname || memberData.firstName || ''
            },
            privacyStatus: 'PUBLIC'
          })
        });

        if (!createMemberResponse.ok) {
          const errorText = await createMemberResponse.text();
          console.error('Create member error:', errorText);
          throw new Error(`Wix create member error: ${createMemberResponse.status} ${createMemberResponse.statusText}`);
        }

        const newMember = await createMemberResponse.json();
        
        return new Response(
          JSON.stringify({ 
            member: {
              id: newMember.member.id,
              email: newMember.member.loginEmail,
              name: newMember.member.profile?.firstName || 'Unknown'
            }
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );

      case 'get-profile':
        // Get full profile including purchase history
        if (!wixMemberId) {
          return new Response(
            JSON.stringify({ error: 'Wix member ID required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get member profile
        const profileResponse = await fetch(`https://www.wixapis.com/members/v1/members/${wixMemberId}`, {
          headers: {
            'Authorization': `Bearer ${wixApiKey}`,
            'wix-site-id': wixSiteId,
            'Content-Type': 'application/json',
          }
        });

        if (!profileResponse.ok) {
          throw new Error(`Wix API error: ${profileResponse.statusText}`);
        }

        const profileData = await profileResponse.json();

        // Get purchase history
        let purchaseHistory = [];
        try {
          const ordersResponse = await fetch(`https://www.wixapis.com/stores/v2/orders/query`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${wixApiKey}`,
              'wix-site-id': wixSiteId,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: {
                filter: {
                  "buyerInfo.memberId": { $eq: wixMemberId }
                },
                paging: { limit: 50 }
              }
            })
          });

          if (ordersResponse.ok) {
            const ordersData = await ordersResponse.json();
            purchaseHistory = ordersData.orders || [];
          }
        } catch (error) {
          console.error('Error fetching purchase history:', error);
        }

        return new Response(
          JSON.stringify({ 
            profile: {
              id: profileData.member.id,
              email: profileData.member.loginEmail,
              firstName: profileData.member.profile?.firstName || '',
              lastName: profileData.member.profile?.lastName || '',
              nickname: profileData.member.profile?.nickname || '',
              addresses: profileData.member.profile?.addresses || [],
              phoneNumber: profileData.member.profile?.phoneNumber || '',
              picture: profileData.member.profile?.picture || '',
              purchaseHistory: purchaseHistory
            }
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );

      case 'get-referral-info':
        // Get referral program information
        if (!wixMemberId) {
          return new Response(
            JSON.stringify({ error: 'Wix member ID required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Generate referral link (basic implementation)
        const referralCode = `REF_${wixMemberId.substring(0, 8)}`;
        const referralLink = `https://snowmediaent.com?ref=${referralCode}`;

        return new Response(
          JSON.stringify({ 
            referral: {
              code: referralCode,
              link: referralLink,
              memberId: wixMemberId
            }
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );

      case 'add-to-email-list':
        // Add member to email marketing list
        if (!memberData || !memberData.email) {
          return new Response(
            JSON.stringify({ error: 'Member data with email is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          const contactResponse = await fetch(`https://www.wixapis.com/contacts/v4/contacts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${wixApiKey}`,
              'wix-site-id': wixSiteId,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              info: {
                name: {
                  first: memberData.firstName || '',
                  last: memberData.lastName || ''
                },
                emails: [{
                  email: memberData.email,
                  primary: true
                }]
              }
            })
          });

          const contactData = contactResponse.ok ? await contactResponse.json() : null;
          
          return new Response(
            JSON.stringify({ 
              success: contactResponse.ok,
              contact: contactData?.contact || null
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        } catch (error) {
          console.error('Error adding to email list:', error);
          return new Response(
            JSON.stringify({ 
              success: false,
              error: error.message
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }

      case 'send-message':
        // Send message to admin via Wix
        const { subject, message: messageText, senderEmail, senderName } = await req.json();
        
        if (!subject || !messageText || !senderEmail) {
          return new Response(
            JSON.stringify({ error: 'Subject, message, and sender email are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Create a contact entry or conversation in Wix
        const messageResponse = await fetch(`https://www.wixapis.com/contacts/v4/contacts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${wixApiKey}`,
            'wix-site-id': wixSiteId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            info: {
              name: {
                first: senderName || 'Snow Media User',
                last: ''
              },
              emails: [senderEmail]
            },
            // Add custom fields for the message
            customFields: {
              subject: subject,
              message: messageText,
              timestamp: new Date().toISOString()
            }
          })
        });

        console.log('Message sent to Wix, status:', messageResponse.status);
        
        if (!messageResponse.ok) {
          const errorText = await messageResponse.text();
          console.error('Send message error:', errorText);
          // Don't throw error, just log it - message might still be received
        }

        return new Response(
          JSON.stringify({ 
            success: true,
            message: 'Message sent successfully to Snow Media admin',
            timestamp: new Date().toISOString()
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('Error in wix-integration function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
