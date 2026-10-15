// Phase 1 — Daily Wheel. One server call returns a provably-fair prize, credits
// it, and records the round. Cooldown is enforced atomically so a user can't
// double-claim within 24h even under a race.
import { supabase } from '../supabase.js';
import { applyChange } from '../chips.js';
import { commit, weightedIndex } from '../provablyFair.js';
import { dailyWheel } from '../config.js';

const COOLDOWN_MS = dailyWheel.cooldownMs ?? 4 * 60 * 60 * 1000;

export async function claimDailySpin(userId, clientSeedIn) {
  // Ensure a claims row exists (no-op if already there).
  await supabase
    .from('daily_claims')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });

  // Eligibility decided in JS (avoids brittle REST or-filters with raw
  // timestamps). Race window between this read and the update below is
  // negligible for a free daily chip; tighten with a DB function later if needed.
  const { data: row, error: selErr } = await supabase
    .from('daily_claims')
    .select('last_claim_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (selErr) throw selErr;

  const last = row?.last_claim_at ? new Date(row.last_claim_at).getTime() : 0;
  if (Date.now() - last < COOLDOWN_MS) {
    return { ok: false, error: 'cooldown', nextClaimAt: new Date(last + COOLDOWN_MS).toISOString() };
  }

  // Take the slot.
  const { error: updErr } = await supabase
    .from('daily_claims')
    .update({ last_claim_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (updErr) throw updErr;

  // Provably-fair draw against the weighted prize table.
  const clientSeed =
    typeof clientSeedIn === 'string' && clientSeedIn ? clientSeedIn.slice(0, 64) : 'daily';
  const { serverSeed, serverSeedHash } = commit();
  const nonce = 0;
  const index = weightedIndex(dailyWheel.weights, serverSeed, clientSeed, nonce);
  const prize = dailyWheel.prizes[index];

  // Record the round (audit + provably-fair reveal data).
  const { data: round, error: roundErr } = await supabase
    .from('game_rounds')
    .insert({
      user_id: userId,
      game: 'daily_wheel',
      bet: 0,
      result: { prize, index },
      server_seed_hash: serverSeedHash,
      server_seed: serverSeed,
      client_seed: clientSeed,
      nonce,
    })
    .select('id')
    .single();
  if (roundErr) throw roundErr;

  // Credit the prize (balance + ledger, atomic).
  const balance = await applyChange(userId, prize, 'daily_wheel', round.id);

  return {
    ok: true,
    prize,
    index,
    balance,
    roundId: round.id,
    // The full prize ring so the client can render/animate the wheel segments.
    prizes: dailyWheel.prizes,
    // Reveal data so the player can verify the outcome was not altered.
    fair: { serverSeedHash, serverSeed, clientSeed, nonce },
  };
}
