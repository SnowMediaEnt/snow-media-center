// Every chip movement goes through here, which calls the Postgres function
// apply_chip_change() — it updates play_chips AND writes a chip_ledger row in
// ONE transaction (see migrations/0000_init.sql). The ledger is the audit
// trail and the source of truth for debugging + leaderboards.
//
// The server is the ONLY authority on balance. The app displays it, never
// computes it.
import { supabase } from './supabase.js';
import { economy, admins } from './config.js';

// Read the current balance, creating the row at SIGNUP_GRANT on first sight.
export async function getOrCreateBalance(userId) {
  const { data, error } = await supabase
    .from('play_chips')
    .select('balance')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data.balance;

  // First time we've seen this user — grant the starting balance + ledger row.
  return applyChange(userId, economy.SIGNUP_GRANT, 'signup_grant');
}

// Apply a signed change atomically (+/-). Returns the new balance.
// reason is a short tag e.g. 'daily_wheel', 'blackjack_win', 'slots_bet'.
export async function applyChange(userId, change, reason, gameRoundId = null) {
  const { data, error } = await supabase.rpc('apply_chip_change', {
    p_user: userId,
    p_change: change,
    p_reason: reason,
    p_round: gameRoundId,
  });
  if (error) throw error;
  return data; // new balance (int)
}

export function isAdmin(userId) {
  return admins.includes(userId);
}

// Balance to show on connect. Admins are kept effectively unlimited; every other
// account gets EXACTLY its real balance — NO per-connect top-up (reconnecting at
// 0 used to hand out free chips). Brand-new users still get the one-time signup
// grant via getOrCreateBalance.
export async function resolveConnectBalance(userId) {
  const balance = await getOrCreateBalance(userId);
  if (isAdmin(userId) && balance < economy.ADMIN_FLOOR) {
    return applyChange(userId, economy.ADMIN_FLOOR - balance, 'admin_grant');
  }
  return balance;
}
