// Wix → Snow Media Center SSO bridge
// 
// FLOW:
// 1. User is logged into snowmedia.com (Wix). They click an "Open in Snow Media app" button.
// 2. Wix Velo backend code calls this endpoint with: { email, secret }
// 3. We verify the shared secret + check that the email exists as a Wix member.
// 4. We use the Supabase Admin API to generate a magic link for that email.
//    If the user doesn't exist in Supabase yet, we create them (auto-provision).
// 5. We return { magicLink: "https://..." } which Wix redirects the user to.
// 6. The link signs them into Snow Media Center automatically — no password needed.
//
// SECURITY:
// - Shared secret (WIX_SSO_SHARED_SECRET) prevents arbitrary magic-link requests.
// - We double-check the email is a real Wix member before issuing — so even with the
//   shared secret, an attacker can only auth as someone who's already a Wix member.
// - Magic links from Supabase are single-use and short-lived (default 1 hour).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const sharedSecret = Deno.env.get('WIX_SSO_SHARED_SECRET');
    const wixApiKey = Deno.env.get('WIX_API_KEY');
    const wixSiteId = Deno.env.get('WIX_SITE_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!sharedSecret || !wixApiKey || !wixSiteId || !supabaseUrl || !serviceKey) {
      console.error('[wix-sso-bridge] Missing required environment variables');
      return jsonResponse({ error: 'SSO bridge not fully configured on server' }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const { email, secret, redirectTo } = body as {
      email?: string;
      secret?: string;
      redirectTo?: string;
    };

    // 1) Validate shared secret (constant-time-ish; Deno doesn't have timingSafeEqual built in)
    if (!secret || secret !== sharedSecret) {
      console.warn('[wix-sso-bridge] Invalid or missing shared secret');
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return jsonResponse({ error: 'Valid email is required' }, 400);
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log('[wix-sso-bridge] SSO request for:', normalizedEmail);

    // 2) Verify email is a real Wix member (so we can't be tricked into issuing
    //    magic links for arbitrary external emails)
    const memberResponse = await fetch('https://www.wixapis.com/members/v1/members/query', {
      method: 'POST',
      headers: {
        'Authorization': wixApiKey,
        'wix-site-id': wixSiteId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: { loginEmail: { $eq: normalizedEmail } },
        fieldsets: ['FULL'],
      }),
    });

    if (!memberResponse.ok) {
      const errText = await memberResponse.text();
      console.error('[wix-sso-bridge] Wix member lookup failed:', memberResponse.status, errText);
      return jsonResponse({ error: 'Could not verify Wix member' }, 502);
    }

    const memberData = await memberResponse.json();
    // Wix often ignores the filter and returns everything — match manually
    const matched = memberData.members?.find(
      (m: any) => m.loginEmail?.toLowerCase().trim() === normalizedEmail
    );

    if (!matched) {
      console.warn('[wix-sso-bridge] Email is not a Wix member:', normalizedEmail);
      return jsonResponse({ error: 'No matching Wix member found' }, 404);
    }

    console.log('[wix-sso-bridge] Verified Wix member:', matched.id);

    // 3) Use Supabase admin client to generate a magic link.
    //    If the user doesn't exist in Supabase yet, generateLink with type 'magiclink'
    //    will create them automatically (when shouldCreateUser is implied).
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // First, ensure the Supabase user exists (create if not). This avoids the
    // "user not found" branch of generateLink and lets us preserve the Wix profile name.
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase().trim() === normalizedEmail
    );

    if (!existingUser) {
      console.log('[wix-sso-bridge] Auto-provisioning new Supabase user');
      const fullName =
        [matched.profile?.firstName, matched.profile?.lastName].filter(Boolean).join(' ') ||
        matched.profile?.nickname ||
        '';
      const { error: createErr } = await adminClient.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: true, // they're already verified via Wix
        user_metadata: { full_name: fullName, wix_member_id: matched.id },
      });
      if (createErr) {
        console.error('[wix-sso-bridge] Failed to create Supabase user:', createErr);
        return jsonResponse({ error: 'Could not provision account' }, 500);
      }
    }

    // 4) Generate the magic link
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: normalizedEmail,
      options: redirectTo ? { redirectTo } : undefined,
    });

    if (linkErr || !linkData?.properties?.action_link) {
      console.error('[wix-sso-bridge] Magic link generation failed:', linkErr);
      return jsonResponse({ error: 'Could not generate sign-in link' }, 500);
    }

    console.log('[wix-sso-bridge] Magic link issued for:', normalizedEmail);

    return jsonResponse({
      success: true,
      magicLink: linkData.properties.action_link,
      email: normalizedEmail,
    });
  } catch (error) {
    console.error('[wix-sso-bridge] Unexpected error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});
