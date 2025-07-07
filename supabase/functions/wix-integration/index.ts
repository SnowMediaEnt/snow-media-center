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
    const wixApiKey = Deno.env.get('WIX_API_KEY');
    
    if (!wixApiKey) {
      console.error('Missing WIX_API_KEY');
      return new Response(
        JSON.stringify({ error: 'Wix API key not configured' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const { action, email, wixAccountId } = await req.json();

    switch (action) {
      case 'get-products':
        // Fetch products from Wix Store
        const productsResponse = await fetch('https://www.wixapis.com/stores/v1/products/query', {
          method: 'POST',
          headers: {
            'Authorization': wixApiKey,
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

        if (!productsResponse.ok) {
          throw new Error(`Wix Store API error: ${productsResponse.statusText}`);
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
        // Create a cart in Wix
        const { items } = await req.json();
        
        const cartResponse = await fetch('https://www.wixapis.com/stores/v1/carts', {
          method: 'POST',
          headers: {
            'Authorization': wixApiKey,
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
            'Authorization': wixApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: {
              loginEmail: { $eq: email }
            }
          })
        });

        if (!memberResponse.ok) {
          throw new Error(`Wix API error: ${memberResponse.statusText}`);
        }

        const memberData = await memberResponse.json();
        const member = memberData.members?.[0];

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
        if (!wixAccountId) {
          return new Response(
            JSON.stringify({ error: 'Wix account ID required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const detailResponse = await fetch(`https://www.wixapis.com/members/v1/members/${wixAccountId}`, {
          headers: {
            'Authorization': wixApiKey,
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