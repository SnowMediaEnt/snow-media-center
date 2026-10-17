// Email-first sign-in probe.
// POST { email } -> 200 { exists: 'app' | 'none' }
// NEVER returns names, ids, or profiles — the enum only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hashClientIp } from '../_shared/ai-guard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const THROTTLE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const THROTTLE_MAX = 20;

type Exists = 'app' | 'none';

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
    // One statement (public.email_check_throttle_hit), so calls arriving
    // together each get their own count instead of all reading the same one.
    const { data, error } = await admin.rpc('email_check_throttle_hit', {
      p_key: ipHash,
      p_window_ms: THROTTLE_WINDOW_MS,
    });
    if (error) throw error;
    if (typeof data !== 'number') throw new Error(`email_check_throttle_hit returned ${JSON.stringify(data)}`);
    return data <= THROTTLE_MAX;
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

    return ok({ exists: 'none' });
  } catch (e) {
    console.error('[check-account-email] unexpected error:', e);
    return ok({ exists: 'none' });
  }
});
