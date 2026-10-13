import { supabase } from '../supabase.js';
import { applyChange, getOrCreateBalance } from '../chips.js';
import { commit, intInRange } from '../provablyFair.js';

const ARCADE_BETS = [10, 25, 50, 100];
const locks = new Set();
const PLINKO = {
  chill: [4, 2, 1.5, 1.2, 1, 0.7, 1, 1.2, 1.5, 2, 4],
  classic: [11.5, 4.6, 2.3, 1.4, 0.7, 0.5, 0.7, 1.4, 2.3, 4.6, 11.5],
  wild: [25, 10, 4, 1, 0.4, 0.2, 0.4, 1, 4, 10, 25],
};
const WIDE_PLINKO = {
  chill: [2, 1.5, 1.25, 1.1, 1, .85, 1, 1.1, 1.25, 1.5, 2],
  classic: [5, 2.5, 1.5, 1, .65, .45, .65, 1, 1.5, 2.5, 5],
  wild: [10, 4, 2, .8, .3, .15, .3, .8, 2, 4, 10],
};
const PLINKO_ROWS = 10;
const PLINKO_TARGET_RETURN = 1.05;

function reflectedPlinkoPath(decisions, startLane) {
  let halfLane = startLane * 2;
  return decisions.map((right) => {
    const next = halfLane + (right ? 1 : -1);
    const actualRight = next < 0 ? true : next > PLINKO_ROWS * 2 ? false : right;
    halfLane += actualRight ? 1 : -1;
    return actualRight;
  });
}

function widePlinkoMultipliers(risk, startLane) {
  const base = WIDE_PLINKO[risk];
  let positions = Array.from({ length: PLINKO_ROWS * 2 + 1 }, (_, halfLane) => Number(halfLane === startLane * 2));
  for (let row = 0; row < PLINKO_ROWS; row += 1) {
    const next = positions.map(() => 0);
    positions.forEach((chance, halfLane) => {
      if (!chance) return;
      next[halfLane === 0 ? 1 : halfLane - 1] += chance / 2;
      next[halfLane === PLINKO_ROWS * 2 ? halfLane - 1 : halfLane + 1] += chance / 2;
    });
    positions = next;
  }
  const expected = base.reduce((sum, multiplier, slot) => sum + multiplier * positions[slot * 2], 0);
  return base.map((multiplier) => Math.round(multiplier * PLINKO_TARGET_RETURN / expected * 100) / 100);
}
const DICE_RETURN = {
  'five-kind': 6, 'large-straight': 4, 'small-straight': 2,
  'four-kind': 2.5, 'full-house': 3, 'three-kind': 1.5,
  'two-pair': 1.2, pair: 0.8, 'high-roll': 0.4,
};

function diceScore(dice) {
  if (!Array.isArray(dice) || dice.length !== 5 || dice.some((v) => !Number.isInteger(v) || v < 1 || v > 6)) return null;
  const total = dice.reduce((sum, value) => sum + value, 0);
  const counts = new Map();
  dice.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const sizes = groups.map(([, count]) => count);
  const unique = [...counts.keys()].sort((a, b) => a - b);
  const run = (values) => values.every((value) => counts.has(value));
  if (sizes[0] === 5) return { key: 'five-kind', score: 50 };
  if (unique.length === 5 && unique[4] - unique[0] === 4) return { key: 'large-straight', score: 40 };
  if (sizes[0] === 4) return { key: 'four-kind', score: total };
  if (sizes[0] === 3 && sizes[1] === 2) return { key: 'full-house', score: 25 };
  if (run([1, 2, 3, 4]) || run([2, 3, 4, 5]) || run([3, 4, 5, 6])) return { key: 'small-straight', score: 30 };
  if (sizes[0] === 3) return { key: 'three-kind', score: total };
  const pairs = groups.filter(([, count]) => count === 2).map(([value]) => value);
  if (pairs.length >= 2) return { key: 'two-pair', score: (pairs[0] + pairs[1]) * 2 };
  if (pairs.length === 1) return { key: 'pair', score: pairs[0] * 2 };
  return { key: 'high-roll', score: total };
}

async function recordScore(userId, game, mode, score, win) {
  const { error } = await supabase.rpc('record_game_score', {
    p_user: userId, p_game: game, p_mode: mode, p_score: Math.max(0, Math.round(score)), p_win: !!win,
  });
  if (error) throw error;
}

async function persistRound(userId, game, bet, result, fair) {
  const { data, error } = await supabase.from('game_rounds').insert({
    user_id: userId, game, bet, result,
    server_seed_hash: fair?.serverSeedHash ?? null,
    server_seed: fair?.serverSeed ?? null,
    client_seed: fair?.clientSeed ?? null,
    nonce: fair?.nonce ?? 0,
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

async function settle(userId, payload) {
  const game = String(payload?.game ?? '');
  // Old APKs cannot award coins for a client-reported Dice hand or Trivia
  // score. They must update to the versioned server-session protocol.
  if (game === 'dice' || game === 'trivia') return { ok: false, error: 'game_update_required' };
  const bet = Number(payload?.bet);
  if (!ARCADE_BETS.includes(bet)) return { ok: false, error: 'invalid_bet' };
  const balanceBefore = await getOrCreateBalance(userId);
  if (bet > balanceBefore) return { ok: false, error: 'insufficient_balance', balance: balanceBefore };

  let result;
  let fair = null;
  if (game === 'plinko') {
    const risk = String(payload?.risk ?? 'classic');
    if (!Object.prototype.hasOwnProperty.call(PLINKO, risk)) return { ok: false, error: 'invalid_mode' };
    const board = payload?.board === undefined ? 'tower' : String(payload.board);
    if (board !== 'tower' && board !== 'wide') return { ok: false, error: 'invalid_board' };
    const dropLane = board === 'wide' ? Number(payload?.dropLane) : 5;
    if (!Number.isInteger(dropLane) || dropLane < 0 || dropLane > 10) return { ok: false, error: 'invalid_drop_lane' };
    const seed = commit();
    const clientSeed = typeof payload?.clientSeed === 'string' ? payload.clientSeed.slice(0, 64) : 'plinko';
    const decisions = Array.from({ length: PLINKO_ROWS }, (_, index) => intInRange(0, 1, seed.serverSeed, clientSeed, `0:peg:${index}`) === 1);
    const path = board === 'wide' ? reflectedPlinkoPath(decisions, dropLane) : decisions;
    const slot = dropLane + path.reduce((sum, right) => sum + (right ? 1 : -1), 0) / 2;
    const multiplier = (board === 'wide' ? widePlinkoMultipliers(risk, dropLane) : PLINKO[risk])[slot];
    result = { path, slot, risk, board, dropLane, multiplier, score: Math.round(bet * multiplier), payout: Math.round(bet * multiplier) };
    fair = { ...seed, clientSeed, nonce: 0 };
  } else {
    return { ok: false, error: 'invalid_game' };
  }

  const net = result.payout - bet;
  const roundId = await persistRound(userId, game, bet, { ...result, net }, fair);
  const balance = await applyChange(userId, net, `${game}_arcade`, roundId);
  const leaderboardMode = game === 'plinko' ? (result.board === 'wide' ? `${result.risk}-wide` : result.risk) : game === 'trivia' ? `${result.mode}-${result.difficulty}` : 'classic';
  await recordScore(userId, game, leaderboardMode, result.score, net > 0);
  return { ok: true, game, bet, ...result, net, balance, roundId, fair };
}

export async function settleArcade(userId, payload) {
  if (locks.has(userId)) return { ok: false, error: 'round_in_progress' };
  locks.add(userId);
  try { return await settle(userId, payload); }
  finally { locks.delete(userId); }
}

export async function getLounge(userId) {
  const [{ data: profile, error: profileError }, { data: leaders, error: leaderError }, { data: coinLeaders, error: coinError }] = await Promise.all([
    supabase.from('game_profiles').select('game_name').eq('user_id', userId).maybeSingle(),
    supabase.from('game_leaderboard').select('game_name,game,mode,best_score,wins,plays,updated_at')
      .order('best_score', { ascending: false }).limit(30),
    supabase.rpc('get_lounge_coin_leaders'),
  ]);
  if (profileError) throw profileError;
  if (leaderError) throw leaderError;
  if (coinError) throw coinError;
  return { ok: true, gameName: profile?.game_name ?? null, leaders: leaders ?? [], coinLeaders: coinLeaders ?? [] };
}

export async function setGameName(userId, rawName) {
  const gameName = String(rawName ?? '').trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9 _-]{3,18}$/.test(gameName)) return { ok: false, error: 'invalid_game_name' };
  const { error } = await supabase.from('game_profiles').upsert({ user_id: userId, game_name: gameName, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: error.code === '23505' ? 'name_taken' : 'save_failed' };
  await supabase.from('game_leaderboard').update({ game_name: gameName }).eq('user_id', userId);
  return { ok: true, gameName };
}

export const _internal = { diceScore, PLINKO, WIDE_PLINKO, reflectedPlinkoPath, widePlinkoMultipliers, DICE_RETURN, ARCADE_BETS };
