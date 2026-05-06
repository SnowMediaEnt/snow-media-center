// Wix → Snow Media Center SSO bridge
//
// SUPPORTED ACTIONS:
//
// 1) action: "mint-link" (default if omitted)
//    Body: { email, secret, redirectTo? }
//    Returns: { success, magicLink, email }
//    Wix calls this when a logged-in member clicks "Sign in to App".
//    We verify the shared secret + that the email is a real Wix member,
//    auto-provision the Supabase user if needed, then return a single-use
//    Supabase magic link.
//
// 2) action: "email-link"
//    Body: { email, secret, magicLink }
//    Returns: { success }
//    Wix calls this if the user picks "Email it to me instead" in the modal.
//    We send the magic link via Resend to the user's email.
//
// SECURITY:
// - Shared secret (WIX_SSO_SHARED_SECRET) gates ALL actions
// - We re-verify Wix membership on every mint-link call
// - Magic links are Supabase-native: single-use, ~1h expiry, auto-revoked on use
// - email-link only sends to the verified Wix member email — not arbitrary addresses

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

async function verifyWixMember(
  email: string,
  wixApiKey: string,
  wixSiteId: string,
  wixAccountId?: string
): Promise<{ id: string; profile?: any } | null> {
  const normalizedEmail = email.toLowerCase().trim();
  const memberResponse = await fetch('https://www.wixapis.com/members/v1/members/query', {
    method: 'POST',
    headers: {
      'Authorization': wixApiKey,
      'wix-site-id': wixSiteId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: { filter: { loginEmail: { $eq: normalizedEmail } }, paging: { limit: 100 } },
      fieldsets: ['FULL'],
    }),
  });

  if (!memberResponse.ok) {
    const errText = await memberResponse.text();
    console.error('[wix-sso-bridge] Wix member lookup failed:', memberResponse.status, errText);
    return null;
  }

  const memberData = await memberResponse.json();
  const member = memberData.members?.find(
    (m: any) => m.loginEmail?.toLowerCase().trim() === normalizedEmail
  );
  if (member) return member;

  if (!wixAccountId) return null;

  const contactResponse = await fetch('https://www.wixapis.com/contacts/v4/contacts/query', {
    method: 'POST',
    headers: {
      'Authorization': wixApiKey,
      'wix-account-id': wixAccountId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: { filter: { 'info.emails.email': { $eq: normalizedEmail } }, paging: { limit: 5 } } }),
  });

  if (!contactResponse.ok) return null;
  const contactData = await contactResponse.json();
  const contact = (contactData.contacts || []).find((c: any) =>
    (c?.primaryInfo?.email || c?.info?.emails?.items?.[0]?.email || '').toLowerCase().trim() === normalizedEmail
  );

  return contact ? {
    id: contact.id,
    profile: {
      firstName: contact.info?.name?.first || '',
      lastName: contact.info?.name?.last || '',
      nickname: contact.info?.name?.first || normalizedEmail.split('@')[0],
    },
  } : null;
}

async function sendMagicLinkEmail(
  recipientEmail: string,
  magicLink: string,
  resendApiKey: string
): Promise<boolean> {
  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;padding:40px;">
          <tr>
            <td>
              <h1 style="color:#0f172a;font-size:24px;margin:0 0 16px;">Sign in to Snow Media</h1>
              <p style="color:#475569;font-size:16px;line-height:1.6;margin:0 0 24px;">
                Tap the button below on the device where you want to sign in (your TV, streaming box, phone, or computer).
                If the Snow Media app is installed, it'll open automatically.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td align="center" style="background-color:#2563eb;border-radius:8px;">
                    <a href="${magicLink}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;">
                      Sign In to Snow Media
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color:#64748b;font-size:13px;line-height:1.6;margin:32px 0 8px;">
                Or copy and paste this link into your device's browser:
              </p>
              <p style="color:#2563eb;font-size:12px;word-break:break-all;margin:0 0 24px;">
                ${magicLink}
              </p>
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
              <p style="color:#94a3b8;font-size:12px;line-height:1.5;margin:0;">
                This link is single-use and expires in 1 hour. If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Snow Media <onboarding@resend.dev>',
      to: [recipientEmail],
      subject: 'Your Snow Media sign-in link',
      html,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[wix-sso-bridge] Resend send failed:', response.status, errText);
    return false;
  }

  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const sharedSecret = Deno.env.get('WIX_SSO_SHARED_SECRET');
    const wixApiKey = Deno.env.get('WIX_API_KEY');
    const wixSiteId = Deno.env.get('WIX_SITE_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    if (!sharedSecret || !wixApiKey || !wixSiteId || !supabaseUrl || !serviceKey) {
      console.error('[wix-sso-bridge] Missing required environment variables');
      return jsonResponse({ error: 'SSO bridge not fully configured on server' }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const { action = 'mint-link', email, secret, redirectTo, magicLink } = body as {
      action?: string;
      email?: string;
      secret?: string;
      redirectTo?: string;
      magicLink?: string;
    };

    // Shared-secret gate for ALL actions
    if (!secret || secret !== sharedSecret) {
      console.warn('[wix-sso-bridge] Invalid or missing shared secret');
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return jsonResponse({ error: 'Valid email is required' }, 400);
    }

    const normalizedEmail = email.toLowerCase().trim();

    // ========== ACTION: email-link ==========
    if (action === 'email-link') {
      if (!magicLink || typeof magicLink !== 'string' || !magicLink.startsWith('http')) {
        return jsonResponse({ error: 'Valid magicLink is required' }, 400);
      }
      if (!resendApiKey) {
        console.error('[wix-sso-bridge] RESEND_API_KEY not configured');
        return jsonResponse({ error: 'Email service not configured' }, 500);
      }

      // Re-verify Wix membership before emailing
      const matched = await verifyWixMember(normalizedEmail, wixApiKey, wixSiteId);
      if (!matched) {
        return jsonResponse({ error: 'No matching Wix member found' }, 404);
      }

      console.log('[wix-sso-bridge] Emailing magic link to:', normalizedEmail);
      const sent = await sendMagicLinkEmail(normalizedEmail, magicLink, resendApiKey);
      if (!sent) {
        return jsonResponse({ error: 'Failed to send email' }, 502);
      }

      return jsonResponse({ success: true, message: 'Sign-in link sent to your email' });
    }

    // ========== ACTION: mint-link (default) ==========
    console.log('[wix-sso-bridge] SSO mint-link request for:', normalizedEmail);

    const matched = await verifyWixMember(normalizedEmail, wixApiKey, wixSiteId);
    if (!matched) {
      console.warn('[wix-sso-bridge] Email is not a Wix member:', normalizedEmail);
      return jsonResponse({ error: 'No matching Wix member found' }, 404);
    }

    console.log('[wix-sso-bridge] Verified Wix member:', matched.id);

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Auto-provision Supabase user if needed
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
        email_confirm: true,
        user_metadata: { full_name: fullName, wix_member_id: matched.id },
      });
      if (createErr) {
        console.error('[wix-sso-bridge] Failed to create Supabase user:', createErr);
        return jsonResponse({ error: 'Could not provision account' }, 500);
      }
    }

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
