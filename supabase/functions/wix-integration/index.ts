
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
    console.log('Wix integration function called');
    
    const wixApiKey = Deno.env.get('WIX_API_KEY');
    const wixAccountId = Deno.env.get('WIX_ACCOUNT_ID');
    
    console.log('API Key present:', !!wixApiKey);
    console.log('Account ID present:', !!wixAccountId);
    console.log('API Key format:', wixApiKey ? `${wixApiKey.substring(0, 10)}...` : 'missing');
    console.log('Account ID:', wixAccountId);
    
    // Test if the function is even being reached
    console.log('Environment check passed');
    
    if (!wixApiKey || !wixAccountId) {
      console.error('Missing WIX_API_KEY or WIX_ACCOUNT_ID');
      return new Response(
        JSON.stringify({ 
          error: 'Wix API credentials not configured',
          details: {
            hasApiKey: !!wixApiKey,
            hasAccountId: !!wixAccountId
          }
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const { action, email, wixMemberId, items } = await req.json();
    console.log('Action requested:', action);

    switch (action) {
      case 'get-products':
        // First check catalog version
        const versionResponse = await fetch('https://www.wixapis.com/stores/v3/provision/version', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${wixApiKey}`,
            'wix-site-id': wixAccountId,
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
              'wix-site-id': wixAccountId,
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
              'wix-site-id': wixAccountId,
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
        // Create a cart in Wix        
        const cartResponse = await fetch('https://www.wixapis.com/stores/v1/carts', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${wixApiKey}`,
            'wix-site-id': wixAccountId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            lineItems: items.map(item => ({
              catalogReference: {
                appId: "1380b703-ce81-ff05-f115-39571d94dfcd",
                catalogItemId: item.productId
              },
              quantity: item.quantity
            }))
          })
        });

        if (!cartResponse.ok) {
          throw new Error(`Wix Cart API error: ${cartResponse.statusText}`);
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
        const memberResponse = await fetch(`https://www.wixapis.com/members/v1/members/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${wixApiKey}`,
            'wix-site-id': wixAccountId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: {
              loginEmail: { $eq: email }
            }
          })
        });

        console.log('Member verification response status:', memberResponse.status);

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
            'wix-site-id': wixAccountId,
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
