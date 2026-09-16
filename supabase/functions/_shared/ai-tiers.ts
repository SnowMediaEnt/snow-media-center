// Premium AI, paid in Snow Gems, charged HERE and never trusted to the app.
//
// The app sends tier: 'premium' (and use_trial: true for the one free
// side-by-side sample). This module reads the price and model from ai_tiers,
// takes the gems through update_user_credits before the model is called,
// and gives them back if the model fails. The owner is never charged.

import { getAdminClient, isOwnerEmail } from './ai-guard.ts';

export type Feature = 'chat' | 'image';
export type Tier = 'free' | 'premium';

export interface TierRow {
  feature: Feature;
  tier: Tier;
  model: string;
  gems: number;
  label: string;
  enabled: boolean;
}

export interface PremiumCharge {
  /** The model to call. */
  model: string;
  /** Gems actually taken (0 for the owner or the free sample). */
  charged: number;
  /** True when this call consumed the account's free sample. */
  trialUsed: boolean;
  /** Puts the gems back. Safe to call once, after a failed model call. */
  refund: () => Promise<void>;
}

export type PremiumResult =
  | { ok: true; charge: PremiumCharge }
  | { ok: false; error: 'premium_requires_signin' | 'premium_disabled' | 'insufficient_gems' | 'charge_failed'; needed?: number; balance?: number };

export function readTier(body: unknown): Tier {
  const t = (body as { tier?: unknown })?.tier;
  return t === 'premium' ? 'premium' : 'free';
}

export function readUseTrial(body: unknown): boolean {
  return (body as { use_trial?: unknown })?.use_trial === true;
}

export async function loadTier(feature: Feature, tier: Tier): Promise<TierRow | null> {
  const admin = getAdminClient();
  const { data } = await admin
    .from('ai_tiers')
    .select('feature, tier, model, gems, label, enabled')
    .eq('feature', feature)
    .eq('tier', tier)
    .maybeSingle();
  if (!data) return null;
  return { ...(data as TierRow), gems: Number((data as { gems: unknown }).gems) || 0 };
}

/**
 * Settles a premium call up front. Order: sign-in required, tier on, free
 * sample if asked for and unused, otherwise the gems come off the balance.
 */
export async function chargePremium(params: {
  feature: Feature;
  userId: string | null;
  userEmail: string | null;
  useTrial: boolean;
  description: string;
}): Promise<PremiumResult> {
  const { feature, userId, userEmail, useTrial, description } = params;
  if (!userId) return { ok: false, error: 'premium_requires_signin' };
  const row = await loadTier(feature, 'premium');
  if (!row || !row.enabled) return { ok: false, error: 'premium_disabled' };
  const admin = getAdminClient();
  const noop = async () => {};

  if (isOwnerEmail(userEmail)) {
    return { ok: true, charge: { model: row.model, charged: 0, trialUsed: false, refund: noop } };
  }

  if (useTrial) {
    // One per account per feature. The insert is the lock: a second caller
    // hits the primary key and pays like everyone else.
    const { error } = await admin.from('ai_premium_trials').insert({ user_id: userId, feature });
    if (!error) {
      return { ok: true, charge: { model: row.model, charged: 0, trialUsed: true, refund: noop } };
    }
  }

  if (row.gems <= 0) {
    return { ok: true, charge: { model: row.model, charged: 0, trialUsed: false, refund: noop } };
  }

  const { data: ok, error } = await admin.rpc('update_user_credits', {
    p_user_id: userId,
    p_amount: row.gems,
    p_transaction_type: 'deduction',
    p_description: description,
  });
  if (error) {
    console.error('[ai-tiers] charge failed:', error.message);
    return { ok: false, error: 'charge_failed' };
  }
  if (ok === false) {
    let balance: number | undefined;
    try {
      const { data: prof } = await admin.from('profiles').select('credits').eq('user_id', userId).maybeSingle();
      balance = Number((prof as { credits?: unknown } | null)?.credits);
    } catch { /* balance is a courtesy */ }
    return { ok: false, error: 'insufficient_gems', needed: row.gems, balance };
  }

  let refunded = false;
  const refund = async () => {
    if (refunded) return;
    refunded = true;
    try {
      await admin.rpc('update_user_credits', {
        p_user_id: userId,
        p_amount: row.gems,
        p_transaction_type: 'refund',
        p_description: `Refund — ${description}`,
      });
    } catch (e) {
      console.error('[ai-tiers] refund failed:', e instanceof Error ? e.message : String(e));
    }
  };
  return { ok: true, charge: { model: row.model, charged: row.gems, trialUsed: false, refund } };
}
