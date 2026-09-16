/**
 * Two levels of AI, in chat and in image generation.
 *
 * The included level is what the app always had. Premium runs the top model
 * and costs Snow Gems, charged by the server on every premium call, so the
 * numbers here are for display and for the pre-flight balance check only.
 * The one free premium sample per feature (the side-by-side comparison) is
 * also settled server-side; the app just remembers whether it has been used
 * so the button can say so.
 */
import { supabase } from '@/integrations/supabase/client';

export type AiFeature = 'chat' | 'image';
export type AiTier = 'free' | 'premium';

export interface AiTierInfo {
  feature: AiFeature;
  tier: AiTier;
  model: string;
  gems: number;
  label: string;
  blurb: string | null;
  enabled: boolean;
}

export interface AiTierPair { free: AiTierInfo; premium: AiTierInfo | null }

/** What the server adds to a chat or image response once tiers exist. */
export interface AiTierReceipt {
  tier?: AiTier;
  model?: string;
  charged_gems?: number;
  trial_used?: boolean;
}

const PREF_KEY = (feature: AiFeature) => `smc-ai-tier:${feature}`;
const CACHE_KEY = 'smc-ai-tiers';

const FALLBACK: Record<AiFeature, AiTierPair> = {
  chat: {
    free: { feature: 'chat', tier: 'free', model: 'gpt-5.4-nano', gems: 0.01, label: 'Snow AI', blurb: null, enabled: true },
    premium: null,
  },
  image: {
    free: { feature: 'image', tier: 'free', model: '', gems: 1, label: 'Standard', blurb: null, enabled: true },
    premium: null,
  },
};

const readCache = (): Record<AiFeature, AiTierPair> | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<AiFeature, AiTierPair>) : null;
  } catch { return null; }
};

/** The price list, cached for an instant first paint and refreshed from the table. */
export async function loadAiTiers(): Promise<Record<AiFeature, AiTierPair>> {
  try {
    const { data, error } = await supabase.from('ai_tiers').select('feature, tier, model, gems, label, blurb, enabled');
    if (error) throw error;
    const out: Record<AiFeature, AiTierPair> = {
      chat: { ...FALLBACK.chat },
      image: { ...FALLBACK.image },
    };
    for (const row of (data ?? []) as AiTierInfo[]) {
      const info = { ...row, gems: Number(row.gems) || 0 };
      if (info.feature !== 'chat' && info.feature !== 'image') continue;
      if (info.tier === 'free') out[info.feature].free = info;
      else if (info.tier === 'premium') out[info.feature].premium = info.enabled ? info : null;
    }
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(out)); } catch { /* ignore */ }
    return out;
  } catch {
    return readCache() ?? FALLBACK;
  }
}

/** The level the viewer last chose for this feature. Free until they choose. */
export function getPreferredTier(feature: AiFeature): AiTier {
  try { return localStorage.getItem(PREF_KEY(feature)) === 'premium' ? 'premium' : 'free'; } catch { return 'free'; }
}

export function setPreferredTier(feature: AiFeature, tier: AiTier): void {
  try { localStorage.setItem(PREF_KEY(feature), tier); } catch { /* ignore */ }
}

/** Whether the signed-in account has already used its free premium sample. */
export async function premiumTrialUsed(feature: AiFeature): Promise<boolean> {
  try {
    const { data } = await supabase.from('ai_premium_trials').select('feature').eq('feature', feature).maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/** A short line for a toast after a premium call. */
export function describeReceipt(r: AiTierReceipt | null | undefined): string | null {
  if (!r || r.tier !== 'premium') return null;
  if (r.trial_used) return 'That was your free Premium sample.';
  if (r.charged_gems && r.charged_gems > 0) return `${r.charged_gems} Snow Gems used for Premium.`;
  return 'Premium, no charge.';
}
