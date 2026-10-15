import { supabase } from '../supabase.js';
import { createHash } from 'node:crypto';
import { commit, sha256Hex } from '../provablyFair.js';
import { getOrCreateBalance } from '../chips.js';
import { simulatePlinko, physicsMultipliers, PLINKO_PHYSICS_VERSION } from './plinkoPhysics.js';

const BETS = [10, 25, 50, 100];
const RISKS = ['chill', 'classic', 'wild'];

export async function startPlinkoPhysicsRound(userId, payload) {
  const bet = Number(payload?.bet);
  const risk = String(payload?.risk ?? 'classic');
  const board = String(payload?.board ?? 'tower');
  const dropLane = board === 'tower' ? 5 : Number(payload?.dropLane);
  const layout = payload?.layout === undefined ? 0 : Number(payload.layout);
  const clientCommit = String(payload?.clientCommit ?? '');
  if (!BETS.includes(bet) || !RISKS.includes(risk) || !['tower', 'wide'].includes(board)
    || !Number.isInteger(dropLane) || dropLane < 0 || dropLane > 10
    || !Number.isInteger(layout) || layout < 0 || layout > 10
    || !/^[0-9a-f]{64}$/.test(clientCommit)) {
    return { ok: false, error: 'invalid_plinko_start' };
  }
  // The SQL function returns any unfinished drop before charging another bet.
  // It atomically stores the seed and reserves coins, preventing free rerolls.
  const seed = commit();
  const { data, error } = await supabase.rpc('start_plinko_physics_round', {
    p_user: userId, p_bet: bet, p_risk: risk, p_board: board, p_lane: dropLane,
    p_seed: seed.serverSeed, p_seed_hash: seed.serverSeedHash, p_client_commit: clientCommit,
    p_layout: layout,
  });
  if (error) {
    if (/plinko_pending_on_another_device/.test(error.message)) return { ok: false, error: 'plinko_pending_on_another_device' };
    throw error;
  }
  return { ok: true, ...data, physicsVersion: PLINKO_PHYSICS_VERSION };
}

export async function finishPlinkoPhysicsRound(userId, payload) {
  const roundId = Number(payload?.roundId);
  const reportedSlot = Number(payload?.slot);
  if (!Number.isSafeInteger(roundId) || roundId < 1 || !Number.isInteger(reportedSlot) || reportedSlot < 0 || reportedSlot > 10) {
    return { ok: false, error: 'invalid_plinko_finish' };
  }
  const clientSeed = String(payload?.clientSeed ?? '');
  if (!/^[0-9a-f]{64}$/.test(clientSeed)) return { ok: false, error: 'invalid_client_seed' };
  const { data: round, error } = await supabase.from('game_rounds')
    .select('id,bet,result,server_seed').eq('id', roundId).eq('user_id', userId).eq('game', 'plinko').maybeSingle();
  if (error) throw error;
  if (!round) return { ok: false, error: 'plinko_round_not_found' };
  if (round.result?.status === 'settled') {
    return { ok: true, roundId, bet: round.bet, ...round.result,
      balance: await getOrCreateBalance(userId), alreadySettled: true };
  }
  const { dropLane, board, risk, physicsVersion, clientCommit } = round.result ?? {};
  const layout = round.result?.layout ?? 0;
  if (physicsVersion !== PLINKO_PHYSICS_VERSION || !RISKS.includes(risk)
    || !['tower', 'wide'].includes(board) || !Number.isInteger(dropLane)
    || !Number.isInteger(layout) || layout < 0 || layout > 10) {
    return { ok: false, error: 'invalid_plinko_round' };
  }
  if (sha256Hex(clientSeed) !== clientCommit) return { ok: false, error: 'client_seed_mismatch' };
  const physicsSeed = createHash('sha256').update(`${round.server_seed}:${clientSeed}`).digest().readUInt32BE(0);
  // Deliberately run this only AFTER the client puck lands. The bucket is an
  // outcome of physics, not an input chosen by the coin server in advance.
  const landing = simulatePlinko(physicsSeed, dropLane);
  if (landing.slot !== reportedSlot) return { ok: false, error: 'plinko_landing_mismatch' };
  const multiplier = physicsMultipliers(board, risk, dropLane, layout)[landing.slot];
  const payout = Math.round(round.bet * multiplier);
  const { data: settled, error: settleError } = await supabase.rpc('finish_plinko_physics_round', {
    p_user: userId, p_round: roundId, p_slot: landing.slot,
    p_x: Math.round(landing.x * 10000) / 10000,
    p_steps: landing.steps, p_collisions: landing.collisions,
    p_multiplier: multiplier, p_payout: payout, p_client_seed: clientSeed,
  });
  if (settleError) throw settleError;
  if (!settled.alreadySettled) {
    const { error: scoreError } = await supabase.rpc('record_game_score', {
      p_user: userId, p_game: 'plinko', p_mode: board === 'wide' ? `${risk}-wide` : risk,
      p_score: Math.round(100 * multiplier), p_win: payout > round.bet,
    });
    // A leaderboard failure must not turn a paid coin round into a retryable
    // failure. The ledger and round row are already committed atomically.
    if (scoreError) console.warn('plinko leaderboard record failed', scoreError.message);
  }
  return { ok: true, roundId, bet: round.bet, board, risk, dropLane, layout,
    slot: settled.slot, multiplier, payout: settled.payout,
    net: settled.payout - round.bet, balance: settled.balance,
    collisions: landing.collisions, alreadySettled: settled.alreadySettled };
}
