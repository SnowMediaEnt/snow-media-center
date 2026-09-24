// Shared AI safety + logging helpers for chat and image edge functions.
// Uses service role under the hood (admin bypasses RLS).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { Resend } from 'npm:resend@4.0.0';
import { hashClientIpKey } from './clientIp.ts';

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
 * Best-effort store of a generated image + admin-review row.
 * Never throws — logs on failure so the caller can still return the image to the device.
 * Accepts either base64 (data URI or bare) OR a remote URL (will be fetched to bytes).
 * If the fetch fails, still inserts a row with storage_path '' so the prompt is reviewable.
 */
export async function storeGeneratedImage(params: {
  user_id?: string | null;
  user_email?: string | null;
  model?: string;
  prompt: string;
  base64?: string | null;
  imageUrl?: string | null;
}): Promise<void> {
  try {
    const admin = getAdminClient();
    let bytes: Uint8Array | null = null;

    if (params.base64) {
      const b64 = params.base64.replace(/^data:image\/[^;]+;base64,/, '');
      try {
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        bytes = buf;
      } catch (e) {
        console.error('[ai-guard] storeGeneratedImage: base64 decode failed:', e);
      }
    } else if (params.imageUrl) {
      try {
        const r = await fetch(params.imageUrl);
        if (r.ok) {
          const ab = await r.arrayBuffer();
          bytes = new Uint8Array(ab);
        } else {
          console.error('[ai-guard] storeGeneratedImage: fetch imageUrl status', r.status);
        }
      } catch (e) {
        console.error('[ai-guard] storeGeneratedImage: fetch imageUrl threw:', e);
      }
    }

    let storagePath = '';
    if (bytes && bytes.length > 0) {
      const yyyymm = new Date().toISOString().slice(0, 7);
      storagePath = `${yyyymm}/${crypto.randomUUID()}.png`;
      const { error: upErr } = await admin.storage
        .from('ai-generated-images')
        .upload(storagePath, bytes, { contentType: 'image/png', upsert: false });
      if (upErr) {
        console.error('[ai-guard] storeGeneratedImage upload failed:', upErr);
        storagePath = '';
      }
    }

    const { error: insErr } = await admin.from('ai_generated_images').insert({
      user_id: params.user_id ?? null,
      user_email: params.user_email ?? null,
      model: params.model ?? null,
      prompt: (params.prompt ?? '').slice(0, 4000),
      storage_path: storagePath,
      status: 'ok',
    });
    if (insErr) console.error('[ai-guard] storeGeneratedImage insert failed:', insErr);
  } catch (e) {
    console.error('[ai-guard] storeGeneratedImage threw:', e);
  }
}



/** How long an automatic (token spike) pause lasts. */
export const AUTO_PAUSE_MS = 30 * 60_000;

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

  // An auto-pause lifts on its own (checkPause and reserve_free_ai both
  // honour paused_until). Without an end, anyone able to push the hourly
  // total over the line could keep AI off for every customer until an admin
  // noticed. If the spike goes on, the next request pauses it again.
  await admin
    .from('ai_safety_state')
    .update({
      paused: true,
      pause_reason: reason,
      paused_at: new Date().toISOString(),
      paused_until: new Date(Date.now() + AUTO_PAUSE_MS).toISOString(),
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
<p>The AI chat and image generation are paused for all users for ${AUTO_PAUSE_MS / 60_000} minutes, or until you resume them from the admin panel. If the spike is still going on then, they pause again.</p>
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
 * Hash the client IP: cf-connecting-ip when it holds a caller's address,
 * else the first x-forwarded-for hop / x-real-ip as before (see
 * _shared/clientIp.ts for why the caller-chosen first hop is no longer
 * trusted first). Returns a hex SHA-256 string, or null if no IP could be
 * determined.
 */
export async function hashClientIp(req: Request): Promise<string | null> {
  return await hashClientIpKey(req.headers);
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

// ---------------------------------------------------------------------------
// Signed-in callers: an hourly allowance per account.
//
// The free tier costs a signed-in caller nothing on the server (the app takes
// its 0.01 gems itself, and a script simply doesn't), so without this one
// free account could send requests without end and push the platform-wide
// hourly token total over the auto-pause line for everyone. Counted in
// ai_user_hourly through service-role-only functions (migration
// 20260930062000). Fails open: a counter that can't be reached never blocks
// a customer.
// ---------------------------------------------------------------------------

export const USER_CALLS_PER_HOUR = 60;
export const USER_TOKENS_PER_HOUR = 600_000;

/** Counts one call; false when the account has used up this hour. */
export async function takeUserHourly(userId: string): Promise<boolean> {
  try {
    const { data, error } = await getAdminClient().rpc('ai_user_hourly_take', {
      p_user_id: userId,
      p_max_calls: USER_CALLS_PER_HOUR,
      p_max_tokens: USER_TOKENS_PER_HOUR,
    });
    if (error) {
      console.error('[ai-guard] ai_user_hourly_take error:', error.message);
      return true;
    }
    return (data as { allowed?: boolean } | null)?.allowed !== false;
  } catch (e) {
    console.error('[ai-guard] takeUserHourly threw:', e instanceof Error ? e.message : String(e));
    return true;
  }
}

/** Adds what a call actually used to the account's hour. */
export async function addUserHourlyTokens(userId: string, tokens: number): Promise<void> {
  if (!(tokens > 0)) return;
  try {
    const { error } = await getAdminClient().rpc('ai_user_hourly_add', {
      p_user_id: userId,
      p_tokens: Math.round(tokens),
    });
    if (error) console.error('[ai-guard] ai_user_hourly_add error:', error.message);
  } catch (e) {
    console.error('[ai-guard] addUserHourlyTokens threw:', e instanceof Error ? e.message : String(e));
  }
}

// gpt-4o-mini pricing (USD per 1K tokens). Retained for any legacy callers.
export const GPT_4O_MINI_INPUT_PER_1K = 0.00015;
export const GPT_4O_MINI_OUTPUT_PER_1K = 0.0006;

export function gpt4oMiniCostUsd(
  promptTokens: number,
  completionTokens: number,
): number {
  return (
    (promptTokens / 1000) * GPT_4O_MINI_INPUT_PER_1K +
    (completionTokens / 1000) * GPT_4O_MINI_OUTPUT_PER_1K
  );
}

export function gpt4oMiniReserveEstimateUsd(inputChars: number): number {
  const estPromptTokens = Math.min(4000, Math.ceil((inputChars || 0) / 4) + 1500);
  const estCompletionTokens = 500;
  return gpt4oMiniCostUsd(estPromptTokens, estCompletionTokens);
}

// gpt-5.4-nano pricing (USD per 1K tokens): $0.20/1M in, $1.25/1M out.
// Used by snow-media-ai via the OpenAI Responses API. output_tokens already
// includes reasoning tokens.
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
 * Conservative reserve for the gpt-5.4-nano chat call: ~800 completion tokens
 * to cover reasoning + visible output under concurrency.
 */
export function gpt54NanoReserveEstimateUsd(inputChars: number): number {
  const estPromptTokens = Math.min(4000, Math.ceil((inputChars || 0) / 4) + 1500);
  const estCompletionTokens = 800;
  return gpt54NanoCostUsd(estPromptTokens, estCompletionTokens);
}


// True worst-case DALL·E-3 HD price (USD per image, 1024x1024 only for anon).
export const DALLE3_HD_1024_COST_USD = 0.12;

// Gemini image (Lovable AI Gateway) — flat anon accounting cost.
export const ANON_IMAGE_COST_USD = 0.04;

