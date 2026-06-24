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

// ---------------------------------------------------------------------------
// Free-AI (anonymous) helpers — hardened.
// These are ADDITIVE; existing authed flows in the edge functions are
// unchanged. The caller decides which branch to run via resolveCaller().
// ---------------------------------------------------------------------------

export type Caller =
  | { authed: true; userId: string; userEmail: string | null; token: string }
  | { authed: false; deviceId: string | null }
  | { authed: false; authError: true };

/**
 * Decode the `role` claim from a JWT payload without verifying the signature.
 * Returns null if the token is malformed. We only use the claim to ROUTE the
 * request (authed-validate vs anon-free); a real user token is always
 * re-validated via `supabase.auth.getUser(token)` below.
 */
function decodeJwtRole(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    const json = JSON.parse(atob(payload));
    return typeof json?.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

/**
 * Detect whether the request is signed in (valid user Bearer JWT) or anonymous.
 *
 * Routing rules:
 *   - No Authorization header                        → anonymous candidate.
 *   - Bearer JWT with role === 'anon' (project key)  → anonymous candidate.
 *   - Bearer JWT with role === 'authenticated':
 *       - validates via getUser() → authed caller.
 *       - validation fails/throws → 401 (fail closed; don't downgrade real users).
 *   - Bearer with unknown/missing role               → anonymous candidate
 *     (cannot impersonate a user; treat like a public/unknown key).
 *
 * Note: supabase-js ALWAYS sends a Bearer header — for logged-out users that
 * token is the project anon key (role === 'anon'). We must NOT 401 that.
 */
export async function resolveCaller(
  req: Request,
): Promise<{ caller: Caller; body: Record<string, unknown> }> {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }

  const rawDeviceId = (body?.device_id ?? body?.deviceId ?? null) as string | null;
  const deviceId =
    typeof rawDeviceId === 'string' && rawDeviceId.trim().length > 0
      ? rawDeviceId.trim().slice(0, 128)
      : null;

  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      return { caller: { authed: false, deviceId }, body };
    }
    const role = decodeJwtRole(token);

    // Anon project key or unknown-role token → free branch, NOT 401.
    if (role !== 'authenticated') {
      return { caller: { authed: false, deviceId }, body };
    }

    // Real user token: validate. Fail closed on transient/expired so we
    // never silently downgrade a signed-in user (losing credits/saves).
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data?.user) {
        return {
          caller: {
            authed: true,
            userId: data.user.id,
            userEmail: data.user.email ?? null,
            token,
          },
          body,
        };
      }
      console.log('[ai-guard] resolveCaller getUser rejected:', error?.message);
      return { caller: { authed: false, authError: true }, body };
    } catch (e) {
      console.log('[ai-guard] resolveCaller getUser threw:', e);
      return { caller: { authed: false, authError: true }, body };
    }
  }

  // No Authorization header at all → legitimately anonymous.
  return { caller: { authed: false, deviceId }, body };
}

export function isAuthError(caller: Caller): boolean {
  return !caller.authed && (caller as { authError?: boolean }).authError === true;
}

/**
 * Hash the client IP (first hop in x-forwarded-for, falling back to
 * cf-connecting-ip / x-real-ip). Returns a hex SHA-256 string, or null
 * if no IP could be determined.
 */
export async function hashClientIp(req: Request): Promise<string | null> {
  const xff = req.headers.get('x-forwarded-for');
  const cf = req.headers.get('cf-connecting-ip');
  const real = req.headers.get('x-real-ip');
  let ip: string | null = null;
  if (xff) ip = xff.split(',')[0]?.trim() || null;
  if (!ip && cf) ip = cf.trim();
  if (!ip && real) ip = real.trim();
  if (!ip) return null;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

export interface ReserveResult {
  allowed: boolean;
  reason: string;
}

/**
 * Atomically check ALL caps and reserve the spend BEFORE making the paid
 * upstream call. The reservation is later reconciled with settleFree().
 */
export async function reserveFree(params: {
  deviceId: string | null;
  ipHash: string | null;
  feature: 'chat' | 'image';
  estCostUsd: number;
  estImages: number;
}): Promise<ReserveResult> {
  if (!params.deviceId) return { allowed: false, reason: 'disabled' };
  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc('reserve_free_ai', {
      p_device_id: params.deviceId,
      p_ip_hash: params.ipHash,
      p_feature: params.feature,
      p_est_cost: params.estCostUsd ?? 0,
      p_est_images: params.estImages ?? 0,
    });
    if (error) {
      console.error('[ai-guard] reserve_free_ai error:', error);
      return { allowed: false, reason: 'disabled' };
    }
    const row = (data ?? {}) as Partial<ReserveResult>;
    return {
      allowed: !!row.allowed,
      reason: typeof row.reason === 'string' ? row.reason : 'disabled',
    };
  } catch (e) {
    console.error('[ai-guard] reserveFree threw:', e);
    return { allowed: false, reason: 'disabled' };
  }
}

/**
 * Reconcile reservation to actual cost (or release entirely on failure).
 * A settle failure is treated as accounting-critical: logged loudly.
 */
export async function settleFree(params: {
  deviceId: string | null;
  ipHash: string | null;
  feature: 'chat' | 'image';
  estCostUsd: number;
  estImages: number;
  actualCostUsd: number;
  actualImages: number;
  succeeded: boolean;
}): Promise<void> {
  if (!params.deviceId) return;
  try {
    const admin = getAdminClient();
    const { error } = await admin.rpc('settle_free_ai', {
      p_device_id: params.deviceId,
      p_ip_hash: params.ipHash,
      p_feature: params.feature,
      p_est_cost: params.estCostUsd ?? 0,
      p_est_images: params.estImages ?? 0,
      p_actual_cost: params.actualCostUsd ?? 0,
      p_actual_images: params.actualImages ?? 0,
      p_succeeded: !!params.succeeded,
    });
    if (error) {
      console.error('[ai-guard][ACCOUNTING] settle_free_ai error:', error, params);
    }
  } catch (e) {
    console.error('[ai-guard][ACCOUNTING] settleFree threw:', e, params);
  }
}

// gpt-5.4-nano pricing (USD per 1K tokens). Used to compute anon chat cost
// from OpenAI's data.usage. completion_tokens for gpt-5.4-nano INCLUDES
// reasoning tokens, which is correct for billing.
// Source rates: INPUT $0.20 / 1M tokens, OUTPUT $1.25 / 1M tokens.
export const GPT_5_4_NANO_INPUT_PER_1K = 0.0002;
export const GPT_5_4_NANO_OUTPUT_PER_1K = 0.00125;

export function gpt54NanoCostUsd(
  promptTokens: number,
  completionTokens: number,
): number {
  return (
    (promptTokens / 1000) * GPT_5_4_NANO_INPUT_PER_1K +
    (completionTokens / 1000) * GPT_5_4_NANO_OUTPUT_PER_1K
  );
}

/**
 * Conservative chat cost estimate for the RESERVE step, before we know the
 * real token count. Reconciled to actual after the call. Bumped for the
 * GPT-5 family because completion_tokens includes hidden reasoning tokens.
 */
export function gpt54NanoReserveEstimateUsd(inputChars: number): number {
  // ~4 chars/token rough heuristic; cap so a giant prompt can't single-handedly
  // exhaust the per-device cap before we have actuals.
  const estPromptTokens = Math.min(4000, Math.ceil((inputChars || 0) / 4) + 1500);
  // ~800 tokens of output (response + minimal reasoning) so concurrent anon
  // calls can't under-reserve and slip past the $50 cap before settle.
  const estCompletionTokens = 800;
  return gpt54NanoCostUsd(estPromptTokens, estCompletionTokens);
}

// Back-compat aliases so older imports keep working.
export const gpt4oMiniCostUsd = gpt54NanoCostUsd;
export const gpt4oMiniReserveEstimateUsd = gpt54NanoReserveEstimateUsd;

// True worst-case DALL·E-3 HD price (USD per image, 1024x1024 only for anon).
export const DALLE3_HD_1024_COST_USD = 0.12;

// Gemini image (Lovable AI Gateway) — flat anon accounting cost.
export const ANON_IMAGE_COST_USD = 0.04;

