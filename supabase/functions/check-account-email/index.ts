// Email-first sign-in probe.
// POST { email } -> 200 { exists: 'app' | 'wix' | 'none' }
// NEVER returns names, member ids, profiles, or any Wix payload — the enum only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hashClientIp } from '../_shared/ai-guard.ts';
import { findWixMemberByEmail } from '../_shared/wixMember.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const THROTTLE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const THROTTLE_MAX = 20;

type Exists = 'app' | 'wix' | 'none';

function ok(body: { exists: Exists; throttled?: boolean }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function throttle(
  admin: ReturnType<typeof createClient>,
  ipHash: string | null,
): Promise<boolean> {
  if (!ipHash) return true;
  try {
    const { data } = await admin
      .from('email_check_throttle')
      .select('window_start, count')
      .eq('ip_hash', ipHash)
      .maybeSingle();

    const now = Date.now();
    if (!data) {
      await admin.from('email_check_throttle').insert({ ip_hash: ipHash, count: 1 });
      return true;
    }
    const started = new Date(data.window_start as string).getTime();
    if (Number.isFinite(started) && now - started > THROTTLE_WINDOW_MS) {
      await admin
        .from('email_check_throttle')
        .update({ window_start: new Date().toISOString(), count: 1, updated_at: new Date().toISOString() })
        .eq('ip_hash', ipHash);
      return true;
    }
    const nextCount = (data.count as number) + 1;
    await admin
      .from('email_check_throttle')
      .update({ count: nextCount, updated_at: new Date().toISOString() })
      .eq('ip_hash', ipHash);
    return nextCount <= THROTTLE_MAX;
  } catch (e) {
    console.warn('[check-account-email] throttle fail-open:', e);
    return true;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let rawEmail = '';
    try {
      const body = await req.json();
      rawEmail = typeof body?.email === 'string' ? body.email : '';
    } catch {
      return ok({ exists: 'none' });
    }

    const email = rawEmail.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) return ok({ exists: 'none' });

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const ipHash = await hashClientIp(req).catch(() => null);
    const allowed = await throttle(admin, ipHash);
    if (!allowed) return ok({ exists: 'none', throttled: true });

    // 1) App account check (RPC avoids listUsers pagination limits)
    try {
      const { data, error } = await admin.rpc('account_email_exists', { p_email: email });
      if (error) {
        console.error('[check-account-email] account_email_exists failed:', error);
      } else if (data === true) {
        return ok({ exists: 'app' });
      }
    } catch (e) {
      console.error('[check-account-email] account_email_exists threw:', e);
    }

    // 2) Wix check (fail-open)
    const wixApiKey = Deno.env.get('WIX_API_KEY');
    const wixSiteId = Deno.env.get('WIX_SITE_ID');
    const wixAccountId = Deno.env.get('WIX_ACCOUNT_ID');
    if (!wixApiKey || !wixSiteId) return ok({ exists: 'none' });

    try {
      const { member } = await findWixMemberByEmail(email, wixApiKey, wixSiteId, wixAccountId || undefined);
      if (member) return ok({ exists: 'wix' });
    } catch (e) {
      console.error('[check-account-email] Wix lookup failed:', e);
    }

    return ok({ exists: 'none' });
  } catch (e) {
    console.error('[check-account-email] unexpected error:', e);
    return ok({ exists: 'none' });
  }
});
