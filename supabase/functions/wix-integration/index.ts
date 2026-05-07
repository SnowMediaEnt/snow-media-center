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

const normalizeEmail = (value?: string | null) => value?.toLowerCase().trim() || '';

function emailFromContact(contact: any): string {
  return normalizeEmail(
    contact?.primaryInfo?.email ||
    contact?.info?.emails?.items?.[0]?.email ||
    contact?.info?.emails?.[0]?.email ||
    contact?.emails?.items?.[0]?.email
  );
}

async function findWixMemberByEmail(email: string, wixApiKey: string, wixSiteId: string, wixAccountId?: string) {
  const normalizedEmail = normalizeEmail(email);
  let totalScanned = 0;
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;

  for (let page = 0; page < MAX_PAGES; page++) {
    const memberResponse = await fetch('https://www.wixapis.com/members/v1/members/query', {
      method: 'POST',
      headers: {
        'Authorization': wixApiKey,
        'wix-site-id': wixSiteId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: {
          filter: { loginEmail: { $eq: normalizedEmail } },
          paging: { limit: PAGE_SIZE, offset: page * PAGE_SIZE },
        },
        fieldsets: ['FULL'],
      })
    });

    if (memberResponse.status === 404) break;
    if (!memberResponse.ok) {
      const errorText = await memberResponse.text();
      console.error('Wix members lookup error:', memberResponse.status, errorText);
      throw new Error(`Wix members lookup failed: ${memberResponse.status}`);
    }

    const memberData = await memberResponse.json();
    const batch = memberData.members || [];
    totalScanned += batch.length;
    const matchingMember = batch.find((m: any) => normalizeEmail(m.loginEmail) === normalizedEmail);
    if (matchingMember) {
      console.log(`Found Wix member on page ${page}: id=${matchingMember.id}, status=${matchingMember.status}`);
      return { source: 'members', member: matchingMember, totalScanned };
    }
    if (page === 0 && batch.length === PAGE_SIZE) {
      console.warn('Wix members query returned a full non-matching page; falling back to contacts lookup');
      break;
    }
    if (batch.length < PAGE_SIZE) break;
  }

  console.log(`Members lookup scanned ${totalScanned} members for ${normalizedEmail}; trying contacts fallback`);

  if (wixAccountId) {
    for (const filter of [
      { 'info.emails.email': { $eq: normalizedEmail } },
      { 'primaryInfo.email': { $eq: normalizedEmail } },
    ]) {
      const contactResponse = await fetch('https://www.wixapis.com/contacts/v4/contacts/query', {
        method: 'POST',
        headers: {
          'Authorization': wixApiKey,
          'wix-account-id': wixAccountId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: { filter, paging: { limit: 5 } } }),
      });

      if (!contactResponse.ok) {
        console.warn('Wix contact lookup non-OK:', contactResponse.status, await contactResponse.text());
        continue;
      }

      const contactData = await contactResponse.json();
      const contacts = contactData.contacts || [];
      const contact = contacts.find((c: any) => emailFromContact(c) === normalizedEmail);
      if (contact) {
        console.log(`Found Wix contact fallback: id=${contact.id}, email=${normalizedEmail}`);
        return {
          source: 'contacts',
          totalScanned,
          member: {
            id: contact.id,
            contactId: contact.id,
            loginEmail: normalizedEmail,
            status: 'APPROVED',
            profile: {
              firstName: contact.info?.name?.first || '',
              lastName: contact.info?.name?.last || '',
              nickname: contact.info?.name?.first || normalizedEmail.split('@')[0],
            },
            contact,
          },
        };
      }
    }
  }

  return { source: 'none', member: null, totalScanned };
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
    
    const { action, email, wixEmail, wixMemberId, items, memberData, subject, message: messageText, senderEmail, senderName, appUserId: appUserIdFromBody } = payload;
    
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
      'bridge-wix-login', // Allow Wix website accounts to create confirmed app login
      'create-cart',    // Allow checkout without auth (guest checkout)
      'get-blog-posts', // Public read of Wix blog posts
      'get-blog-post'   // Public read of a single Wix blog post
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
        
        // Resolve variantId for items that have options (e.g. { Amount: "50" })
        // Wix silently drops line items if option name/value casing doesn't match
        // a variant exactly, so we look up the real variantId server-side.
        const resolvedLineItems = await Promise.all(items.map(async (item: any) => {
          let variantId: string | null = null;
          if (item.options && Object.keys(item.options).length > 0) {
            try {
              const vRes = await fetch(
                `https://www.wixapis.com/stores/v1/products/${item.productId}/variants/query`,
                {
                  method: 'POST',
                  headers: checkoutHeaders,
                  body: JSON.stringify({}),
                }
              );
              const vText = await vRes.text();
              console.log(`[create-cart] variants for ${item.productId}:`, vText.substring(0, 800));
              if (vRes.ok) {
                const vData = JSON.parse(vText);
                const variants = vData.variants || [];
                const wantedLower: Record<string, string> = {};
                for (const [k, v] of Object.entries(item.options)) {
                  wantedLower[String(k).toLowerCase()] = String(v).toLowerCase();
                }
                const match = variants.find((v: any) => {
                  const choices = v.choices || {};
                  return Object.entries(wantedLower).every(
                    ([k, val]) => {
                      const found = Object.entries(choices).find(
                        ([ck]) => String(ck).toLowerCase() === k
                      );
                      return found && String(found[1]).toLowerCase() === val;
                    }
                  );
                });
                if (match) {
                  variantId = match.id || match.variant?.id || null;
                  console.log(`[create-cart] matched variantId: ${variantId}`);
                } else {
                  console.warn(`[create-cart] no variant matched options`, item.options);
                }
              }
            } catch (e) {
              console.error('[create-cart] variant lookup failed:', e);
            }
          }
          return {
            catalogReference: {
              appId: "215238eb-22a5-4c36-9e7b-e7c08025e04e",
              catalogItemId: item.productId,
              ...(variantId
                ? { options: { variantId } }
                : item.options
                  ? { options: { options: item.options } }
                  : {}),
            },
            quantity: item.quantity,
          };
        }));

        // Create checkout directly with line items (skip cart creation)
        // Embed the app user ID as a custom field so we can credit the right
        // user later — even if they pay on Wix with a different email or as a guest.
        const checkoutBody: any = {
          channelType: 'WEB',
          lineItems: resolvedLineItems,
        };
        if (appUserIdFromBody || email) {
          checkoutBody.checkoutInfo = {
            ...(email ? { buyerInfo: { email: normalizeEmail(email) } } : {}),
            ...(appUserIdFromBody ? {
              customFields: [
                { title: 'smc_user_id', value: String(appUserIdFromBody) },
              ],
            } : {}),
          };
        }
        const checkoutResponse = await fetch(`https://www.wixapis.com/ecom/v1/checkouts`, {
          method: 'POST',
          headers: checkoutHeaders,
          body: JSON.stringify(checkoutBody)
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
        
        const { member: matchingMember, totalScanned, source } = await findWixMemberByEmail(
          email,
          wixApiKey,
          wixSiteId,
          wixAccountId || undefined,
        );

        console.log(`Scanned ${totalScanned} Wix members for ${email}, source: ${source}, found: ${!!matchingMember}`);

        return new Response(
          JSON.stringify({ 
            exists: !!matchingMember,
            source,
            member: matchingMember ? {
              id: matchingMember.id,
              email: matchingMember.loginEmail,
              status: matchingMember.status,
              profile: matchingMember.profile || {},
              contact: matchingMember.contact || null,
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
              contact: {
                firstName: memberData.firstName || '',
                lastName: memberData.lastName || '',
                emails: [memberData.email],
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

      case 'bridge-wix-login': {
        console.log('Bridging Wix login for:', email);

        if (!wixSiteId) {
          return new Response(JSON.stringify({ error: 'Site ID required for Wix login bridge' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (!email || !payload.password || String(payload.password).length < 6) {
          return new Response(JSON.stringify({ error: 'Valid email and password are required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const bridgeEmail = normalizeEmail(email);
        const { member, source } = await findWixMemberByEmail(bridgeEmail, wixApiKey, wixSiteId, wixAccountId || undefined);
        if (!member) {
          return new Response(JSON.stringify({ exists: false, error: 'No approved Wix account found for this email' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const adminClient = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        const fullName = [member.profile?.firstName, member.profile?.lastName].filter(Boolean).join(' ') || member.profile?.nickname || '';
        const { data: existingUsers, error: listErr } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (listErr) {
          console.error('Supabase user lookup failed:', listErr);
          return new Response(JSON.stringify({ error: 'Could not check app account' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        let linkedUserId: string | null = null;
        const existingUser = existingUsers?.users?.find((u) => normalizeEmail(u.email) === bridgeEmail);
        if (existingUser) {
          linkedUserId = existingUser.id;
          console.log('App account already exists for Wix email; confirming/linking metadata');
          const { error: updateErr } = await adminClient.auth.admin.updateUserById(existingUser.id, {
            email_confirm: true,
            ...(existingUser.user_metadata?.wix_member_id ? { password: String(payload.password) } : {}),
            user_metadata: { ...(existingUser.user_metadata || {}), full_name: fullName, wix_member_id: member.id, wix_source: source },
          });
          if (updateErr) {
            console.error('Supabase user update failed:', updateErr);
            return new Response(JSON.stringify({ error: 'Could not link existing app account' }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } else {
          console.log('Creating confirmed Supabase user from Wix account');
          const { data: createdUser, error: createErr } = await adminClient.auth.admin.createUser({
            email: bridgeEmail,
            password: String(payload.password),
            email_confirm: true,
            user_metadata: { full_name: fullName, wix_member_id: member.id, wix_source: source },
          });
          if (createErr) {
            console.error('Supabase user creation failed:', createErr);
            return new Response(JSON.stringify({ error: 'Could not create app account from Wix account' }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          linkedUserId = createdUser.user?.id || null;
        }

        if (linkedUserId) {
          const { error: profileErr } = await adminClient
            .from('profiles')
            .upsert({ user_id: linkedUserId, email: bridgeEmail, full_name: fullName, wix_account_id: member.id }, { onConflict: 'user_id' });
          if (profileErr) console.warn('Profile upsert for Wix bridge failed:', profileErr);
        }

        return new Response(JSON.stringify({
          success: true,
          exists: true,
          source,
          member: {
            id: member.id,
            email: member.loginEmail,
            status: member.status,
            profile: member.profile || {},
            name: member.profile?.firstName || member.profile?.nickname || 'Unknown',
          },
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

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

      case 'sync-credit-orders': {
        // Auto-credit user for SMC AI Credits purchases on Wix, by SKU
        console.log('Syncing credit orders for user:', userId, 'email:', email);

        if (!userId) {
          return new Response(JSON.stringify({ error: 'Authentication required' }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (!email) {
          return new Response(JSON.stringify({ error: 'email required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (!wixSiteId) {
          return new Response(JSON.stringify({ error: 'WIX_SITE_ID not configured' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // SKU -> credits map (case-insensitive)
        const SKU_CREDITS: Record<string, number> = {
          'ai50': 50,
          'ai120': 120,
          'ai250': 250,
          'ai600': 600,
        };

        // Allow caller to pass an alternate Wix email (e.g. user paid on Wix
        // with a different account than the one signed in to the app).
        const wixEmail: string = (payload?.wixEmail || email || '').toLowerCase().trim();

        // Fetch orders for this email (we'll also accept orders tagged with
        // this user's app_user_id custom field, even if email doesn't match).
        const ordersRes = await fetch('https://www.wixapis.com/ecom/v1/orders/search', {
          method: 'POST',
          headers: {
            'Authorization': wixApiKey,
            'wix-site-id': wixSiteId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            search: {
              paging: { limit: 100 },
              sort: [{ fieldName: 'createdDate', order: 'DESC' }],
            }
          })
        });

        if (!ordersRes.ok) {
          const t = await ordersRes.text();
          console.error('Wix orders error:', ordersRes.status, t);
          return new Response(JSON.stringify({ error: 'Failed to fetch Wix orders', details: t }), {
            status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const ordersJson = await ordersRes.json();
        const allOrders: any[] = ordersJson.orders || [];

        // Match by either (a) Wix buyer email OR (b) app_user_id custom field.
        // This handles users paying with a different Wix email AND guest checkouts.
        const orders = allOrders.filter((o: any) => {
          const buyerEmail = (o.buyerInfo?.email || '').toLowerCase().trim();
          if (buyerEmail && buyerEmail === wixEmail) return true;
          const fields: any[] = o.customFields || o.checkoutCustomFields || [];
          return fields.some((f: any) =>
            (f.title === 'smc_user_id' || f.name === 'smc_user_id' || f.title === 'app_user_id' || f.name === 'app_user_id') &&
            String(f.value || '').trim() === String(userId)
          );
        });

        console.log(`Wix returned ${allOrders.length} orders, ${orders.length} match user ${userId} / ${wixEmail}`);

        // Service-role client for writes
        const adminClient = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );

        let totalCreditsAdded = 0;
        let newOrders = 0;
        const skipped: string[] = [];

        for (const order of orders) {
          const orderId = order.id;
          const orderNumber = order.number;
          const paymentStatus = (order.paymentStatus || '').toUpperCase();

          // Only credit PAID orders
          if (!['PAID', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED'].includes(paymentStatus)) {
            // Treat anything not PAID as skip
            if (paymentStatus !== 'PAID') {
              skipped.push(`${orderNumber}: ${paymentStatus}`);
              continue;
            }
          }
          if (paymentStatus !== 'PAID') continue;

          // Sum credits from line items by SKU
          let orderCredits = 0;
          for (const item of (order.lineItems || [])) {
            const sku = (item.physicalProperties?.sku || item.sku || '').toLowerCase().trim();
            const perUnit = SKU_CREDITS[sku];
            if (perUnit) {
              orderCredits += perUnit * (item.quantity || 1);
            }
          }

          if (orderCredits === 0) continue;

          // Dedup: skip if already redeemed
          const { data: existing } = await adminClient
            .from('wix_redeemed_orders')
            .select('id')
            .eq('wix_order_id', orderId)
            .maybeSingle();

          if (existing) continue;

          // Credit the user
          const { error: rpcErr } = await adminClient.rpc('update_user_credits', {
            p_user_id: userId,
            p_amount: orderCredits,
            p_transaction_type: 'purchase',
            p_description: `Wix order #${orderNumber} (SMC AI Credits)`,
            p_paypal_transaction_id: `wix_${orderId}`,
          });

          if (rpcErr) {
            console.error(`Failed crediting order ${orderId}:`, rpcErr);
            continue;
          }

          // Record redemption
          const { error: insErr } = await adminClient
            .from('wix_redeemed_orders')
            .insert({
              user_id: userId,
              wix_order_id: orderId,
              wix_order_number: String(orderNumber || ''),
              credits_granted: orderCredits,
            });

          if (insErr) {
            console.error(`Failed recording redemption for ${orderId}:`, insErr);
          }

          totalCreditsAdded += orderCredits;
          newOrders += 1;
        }

        return new Response(JSON.stringify({
          ok: true,
          newOrders,
          totalCreditsAdded,
          totalOrdersScanned: orders.length,
          skipped,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

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

      case 'tag-credit-purchase': {
        // Find/create a Wix contact for this email and apply a label so purchasers
        // are visible in Wix CRM. Used by paypal-checkout after a successful capture.
        const tagEmail = (payload.email || email || '').toString().trim();
        const tagFirst = payload.firstName || '';
        const tagLast = payload.lastName || '';
        const labelKey = payload.labelKey || 'custom.smc-credits-buyer';

        if (!tagEmail) {
          return new Response(JSON.stringify({ error: 'email required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (!wixAccountId) {
          return new Response(JSON.stringify({ error: 'WIX_ACCOUNT_ID not configured' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 1) Find existing contact by email
        let contactId: string | null = null;
        try {
          const queryRes = await fetch('https://www.wixapis.com/contacts/v4/contacts/query', {
            method: 'POST',
            headers: {
              'Authorization': wixApiKey,
              'wix-account-id': wixAccountId,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: {
                filter: { 'info.emails.email': { $eq: tagEmail } },
                paging: { limit: 1 },
              },
            }),
          });
          if (queryRes.ok) {
            const qj = await queryRes.json();
            contactId = qj.contacts?.[0]?.id || null;
          } else {
            console.warn('Contact query non-OK:', queryRes.status, await queryRes.text());
          }
        } catch (e) {
          console.warn('Contact query failed:', e);
        }

        // 2) Create contact if not found
        if (!contactId) {
          const createRes = await fetch('https://www.wixapis.com/contacts/v4/contacts', {
            method: 'POST',
            headers: {
              'Authorization': wixApiKey,
              'wix-account-id': wixAccountId,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              info: {
                name: { first: tagFirst, last: tagLast },
                emails: { items: [{ email: tagEmail }] },
              },
            }),
          });
          if (createRes.ok) {
            const cj = await createRes.json();
            contactId = cj.contact?.id || null;
          } else {
            const t = await createRes.text();
            console.error('Contact create failed:', createRes.status, t);
            return new Response(JSON.stringify({ success: false, error: 'Failed to create contact', details: t }), {
              status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        }

        if (!contactId) {
          return new Response(JSON.stringify({ success: false, error: 'No contactId resolved' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 3) Apply label (Wix auto-creates custom.* labels on first use)
        const labelRes = await fetch(`https://www.wixapis.com/contacts/v4/contacts/${contactId}/labels`, {
          method: 'POST',
          headers: {
            'Authorization': wixApiKey,
            'wix-account-id': wixAccountId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ labelKeys: [labelKey] }),
        });

        if (!labelRes.ok) {
          const t = await labelRes.text();
          console.error('Label apply failed:', labelRes.status, t);
          return new Response(JSON.stringify({ success: false, contactId, error: 'Failed to apply label', details: t }), {
            status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, contactId, labelKey }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

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