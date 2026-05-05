// Shared AI safety + logging helpers for chat and image edge functions.
// Uses service role under the hood (admin bypasses RLS).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { Resend } from 'npm:resend@4.0.0';

export const ADMIN_OWNER_EMAIL = 'Joshua.perez@snowmediaent.com';

export function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

export function isOwnerEmail(email?: string | null) {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_OWNER_EMAIL.toLowerCase();
}

export interface SafetyState {
  paused: boolean;
  pause_reason: string | null;
  paused_until: string | null;
  token_threshold_per_hour: number;
  notify_email: string;
}

export async function getSafetyState(admin = getAdminClient()): Promise<SafetyState | null> {
  const { data } = await admin.from('ai_safety_state').select('*').eq('id', 1).maybeSingle();
  return (data as SafetyState) ?? null;
}

/**
 * Returns { blocked: true, reason } if AI is paused.
 * Auto-clears expired pauses (paused_until in the past).
 */
export async function checkPause(admin = getAdminClient()): Promise<{ blocked: boolean; reason?: string }> {
  const state = await getSafetyState(admin);
  if (!state) return { blocked: false };
  if (!state.paused) return { blocked: false };
  if (state.paused_until && new Date(state.paused_until) < new Date()) {
    await admin
      .from('ai_safety_state')
      .update({ paused: false, pause_reason: null, paused_until: null, updated_at: new Date().toISOString() })
      .eq('id', 1);
    return { blocked: false };
  }
  return { blocked: true, reason: state.pause_reason ?? 'AI is temporarily paused by admin.' };
}

export async function logUsage(params: {
  user_id?: string | null;
  user_email?: string | null;
  feature: 'chat' | 'image';
  model?: string;
  prompt: string;
  response_preview?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost_credits?: number;
  status?: 'ok' | 'error' | 'blocked';
  error_message?: string;
}) {
  const admin = getAdminClient();
  await admin.from('ai_usage_log').insert({
    user_id: params.user_id ?? null,
    user_email: params.user_email ?? null,
    feature: params.feature,
    model: params.model ?? null,
    prompt: params.prompt?.slice(0, 4000) ?? '',
    response_preview: (params.response_preview ?? '').slice(0, 2000),
    prompt_tokens: params.prompt_tokens ?? 0,
    completion_tokens: params.completion_tokens ?? 0,
    total_tokens: params.total_tokens ?? 0,
    cost_credits: params.cost_credits ?? 0,
    status: params.status ?? 'ok',
    error_message: params.error_message ?? null,
  });
}

/**
 * After logging a request, check if platform-wide tokens in last hour
 * exceed the threshold. If so, auto-pause and email the admin.
 * Returns true if a pause was triggered by THIS call.
 */
export async function enforceThreshold(): Promise<boolean> {
  const admin = getAdminClient();
  const state = await getSafetyState(admin);
  if (!state || state.paused) return false;
  const { data: tokens } = await admin.rpc('ai_tokens_last_hour');
  const used = Number(tokens ?? 0);
  if (used < Number(state.token_threshold_per_hour)) return false;

  const reason = `Auto-paused: ${used.toLocaleString()} tokens used in the last hour (threshold ${Number(
    state.token_threshold_per_hour
  ).toLocaleString()}).`;

  await admin
    .from('ai_safety_state')
    .update({
      paused: true,
      pause_reason: reason,
      paused_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);

  // Best-effort email
  try {
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (apiKey && state.notify_email) {
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from: 'Snow Media Alerts <onboarding@resend.dev>',
        to: [state.notify_email],
        subject: '⚠️ Snow Media AI auto-paused (token spike)',
        html: `<p>${reason}</p>
<p>The AI chat and image generation are paused for all users until you resume them from the admin panel.</p>
<p>Open the admin panel → AI tab to review the usage log and resume.</p>`,
      });
    }
  } catch (e) {
    console.error('[ai-guard] notify email failed:', e);
  }

  return true;
}
