// Phase 5 — Roulette. One server call per spin: validate the bet array, pick a
// winning pocket (provably fair), settle every bet, record the round, and apply
// one atomic net change. Stateless — no multi-turn state. The server decides the
// number; the client only submits bets and animates to the returned result.
//
// Both wheels are supported as a table option:
//   european -> pockets 0..36                (37 pockets, single zero)
//   american -> pockets 0..36 plus '00'      (38 pockets, double zero)
//
// PAYOUT CONVENTION (documented + tested):
//   Each bet type has a `multiplier` (the classic "X:1" odds). On a WIN the
//   player is RETURNED  amount * (multiplier + 1)  — i.e. their stake back plus
//   the winnings (straight 35:1 returns 36x the stake). On a LOSS the bet
//   returns 0. The stake for every bet is taken up front (totalBet), so the net
//   change applied to the balance is:  totalPayout - totalBet.
import { supabase } from '../supabase.js';
import { applyChange, getOrCreateBalance } from '../chips.js';
import { commit, intInRange } from '../provablyFair.js';
import { roulette } from '../config.js';

// ---------------------------------------------------------------------------
// Wheel pocket lists. A pocket is a STRING label so '0' and '00' coexist
// cleanly with 1..36. intInRange picks an index into this array.
// ---------------------------------------------------------------------------
const EUROPEAN_POCKETS = ['0', ...range(1, 36).map(String)];
const AMERICAN_POCKETS = ['0', '00', ...range(1, 36).map(String)];

function range(a, b) {
  const out = [];
  for (let n = a; n <= b; n++) out.push(n);
  return out;
}

function pocketsFor(wheel) {
  return wheel === 'american' ? AMERICAN_POCKETS : EUROPEAN_POCKETS;
}

// ---------------------------------------------------------------------------
// Membership helpers — all keyed on the numeric value (0..36). '0' and '00'
// both map to a number that loses every even-money / dozen / column bet.
// ---------------------------------------------------------------------------
const RED = roulette.redNumbers; // Set<number>

// True only for a real spin number 1..36 (zeros excluded).
function isStraightNumber(n) {
  return Number.isInteger(n) && n >= 1 && n <= 36;
}

function colorOf(label) {
  if (label === '0' || label === '00') return 'green';
  const n = Number(label);
  return RED.has(n) ? 'red' : 'black';
}

// Which 12-number column (1, 2 or 3) a number belongs to. 0/00 -> 0 (none).
function columnOf(n) {
  if (!isStraightNumber(n)) return 0;
  return ((n - 1) % 3) + 1; // col1: 1,4,7..  col2: 2,5,8..  col3: 3,6,9..
}

// Which dozen (1, 2 or 3) a number belongs to. 0/00 -> 0 (none).
function dozenOf(n) {
  if (!isStraightNumber(n)) return 0;
  return Math.ceil(n / 12);
}

// ---------------------------------------------------------------------------
// Bet-type table: multiplier + a validator for the bet's `selection`.
// `selection` shapes (see SERVER CONTRACT):
//   straight : a single number 0..36, or the string '00' (american only)
//   split    : [a, b] two numbers (or one of them '00') — adjacency checked
//   street   : a single number = the first number of a 3-number row (1,4,..,34)
//   corner   : a single number = the top-left of a 4-number square
//   six_line : a single number = the first number of the two rows (1,4,..,31)
//   column   : 1 | 2 | 3
//   dozen    : 1 | 2 | 3
//   red/black/even/odd/low/high : selection ignored
// ---------------------------------------------------------------------------
const MULT = roulette.multipliers;

// Normalise a selection token to either an int 0..36 or the string '00'.
function normPocketToken(tok, wheel) {
  if (tok === '00' || tok === 0 || tok === '0') {
    if (tok === '00') return wheel === 'american' ? '00' : null;
    return 0;
  }
  const n = typeof tok === 'number' ? tok : Number(tok);
  if (!Number.isInteger(n) || n < 0 || n > 36) return null;
  return n;
}

// Numeric grid neighbours for adjacency checks. Treats the board as 12 rows x 3
// columns (1..36); 0/00 only legally pair with the bottom-row numbers but we
// keep split validation to the 1..36 grid for simplicity and reject 0 splits.
function splitAdjacent(a, b) {
  if (!isStraightNumber(a) || !isStraightNumber(b)) return false;
  const ca = columnOf(a);
  const cb = columnOf(b);
  // Horizontal neighbours: same row, adjacent column.
  if (Math.floor((a - 1) / 3) === Math.floor((b - 1) / 3) && Math.abs(ca - cb) === 1) {
    return true;
  }
  // Vertical neighbours: same column, rows differ by one (|a-b| === 3).
  if (ca === cb && Math.abs(a - b) === 3) return true;
  return false;
}

// The four numbers of a corner whose top-left anchor is `n`.
function cornerNumbers(n) {
  // Anchor must be in column 1 or 2 and have a row below it.
  if (!isStraightNumber(n)) return null;
  if (columnOf(n) === 3) return null; // no square to the right
  if (n + 3 > 36) return null; // no row below
  return [n, n + 1, n + 3, n + 4];
}

function streetNumbers(n) {
  // First number of a row: 1,4,7,...,34 (column 1).
  if (!isStraightNumber(n) || columnOf(n) !== 1) return null;
  return [n, n + 1, n + 2];
}

function sixLineNumbers(n) {
  // First number of the upper of two adjacent rows: 1,4,...,31.
  if (!isStraightNumber(n) || columnOf(n) !== 1 || n + 5 > 36) return null;
  return [n, n + 1, n + 2, n + 3, n + 4, n + 5];
}

// ---------------------------------------------------------------------------
// Validate one bet. Returns { ok:true, bet:{type, numbers|null, selection, amount,
// multiplier} } or { ok:false, detail }. `numbers` is the concrete winning set
// for inside bets (null for outside bets, which use predicate evaluation).
// ---------------------------------------------------------------------------
function validateBet(bet, wheel) {
  if (!bet || typeof bet !== 'object') return { ok: false, detail: 'bet not an object' };
  const { type, selection, amount } = bet;
  if (typeof type !== 'string' || !(type in MULT)) {
    return { ok: false, detail: `unknown bet type: ${type}` };
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, detail: `amount must be a positive integer (got ${amount})` };
  }
  const multiplier = MULT[type];
  const mk = (numbers) => ({ ok: true, bet: { type, selection, amount, multiplier, numbers } });

  switch (type) {
    case 'straight': {
      const tok = normPocketToken(selection, wheel);
      if (tok === null) return { ok: false, detail: `invalid straight selection: ${selection}` };
      return mk([tok]); // tok is int 0..36 or '00'
    }
    case 'split': {
      if (!Array.isArray(selection) || selection.length !== 2) {
        return { ok: false, detail: 'split selection must be [a,b]' };
      }
      const a = normPocketToken(selection[0], wheel);
      const b = normPocketToken(selection[1], wheel);
      if (a === null || b === null || !splitAdjacent(a, b)) {
        return { ok: false, detail: `split numbers not adjacent: ${selection}` };
      }
      return mk([a, b]);
    }
    case 'street': {
      const tok = normPocketToken(selection, wheel);
      const nums = streetNumbers(tok);
      if (!nums) return { ok: false, detail: `invalid street anchor: ${selection}` };
      return mk(nums);
    }
    case 'corner': {
      const tok = normPocketToken(selection, wheel);
      const nums = cornerNumbers(tok);
      if (!nums) return { ok: false, detail: `invalid corner anchor: ${selection}` };
      return mk(nums);
    }
    case 'six_line': {
      const tok = normPocketToken(selection, wheel);
      const nums = sixLineNumbers(tok);
      if (!nums) return { ok: false, detail: `invalid six_line anchor: ${selection}` };
      return mk(nums);
    }
    case 'column':
    case 'dozen': {
      const n = typeof selection === 'number' ? selection : Number(selection);
      if (![1, 2, 3].includes(n)) {
        return { ok: false, detail: `${type} selection must be 1|2|3 (got ${selection})` };
      }
      return mk(null); // predicate-evaluated; carry the group via selection
    }
    case 'red':
    case 'black':
    case 'even':
    case 'odd':
    case 'low':
    case 'high':
      return mk(null); // even-money predicate bets; selection ignored
    default:
      return { ok: false, detail: `unhandled bet type: ${type}` };
  }
}

// ---------------------------------------------------------------------------
// PAYOUT EVALUATOR — pure, DB-free, exported for unit tests.
// Given a winning pocket label and a *validated* bet, returns true if it wins.
// `winLabel` is '0' | '00' | '1'..'36'. `winNum` is its numeric value (0 for
// both zeros). Zeros lose every column/dozen/even-money bet (standard).
// ---------------------------------------------------------------------------
export function betWins(bet, winLabel) {
  const winNum = winLabel === '00' ? 0 : Number(winLabel);
  const isZero = winLabel === '0' || winLabel === '00';

  switch (bet.type) {
    case 'straight':
    case 'split':
    case 'street':
    case 'corner':
    case 'six_line':
      // Inside bets: win if the winning label is in the bet's number set.
      // The set holds ints 0..36 and possibly the string '00'.
      return bet.numbers.some((tok) =>
        tok === '00' ? winLabel === '00' : tok === winNum && !(tok === 0 && winLabel === '00')
      );
    case 'column':
      return !isZero && columnOf(winNum) === Number(bet.selection);
    case 'dozen':
      return !isZero && dozenOf(winNum) === Number(bet.selection);
    case 'red':
      return !isZero && RED.has(winNum);
    case 'black':
      return !isZero && !RED.has(winNum);
    case 'even':
      return !isZero && winNum % 2 === 0;
    case 'odd':
      return !isZero && winNum % 2 === 1;
    case 'low':
      return !isZero && winNum >= 1 && winNum <= 18;
    case 'high':
      return !isZero && winNum >= 19 && winNum <= 36;
    default:
      return false;
  }
}

const EVEN_MONEY_TYPES = new Set(['red', 'black', 'even', 'odd', 'low', 'high']);

/**
 * Settle one already-validated bet. European Snow Roulette uses La Partage:
 * when single zero lands, even-money bets get half their stake back. This is
 * an established player-friendly rule and never changes based on player state.
 */
export function settleBet(bet, winLabel, wheel, laPartage = roulette.laPartage === true) {
  const won = betWins(bet, winLabel);
  if (won) {
    return { won: true, payout: bet.amount * (bet.multiplier + 1), halfBack: false };
  }
  const halfBack = laPartage
    && wheel === 'european'
    && winLabel === '0'
    && EVEN_MONEY_TYPES.has(bet.type);
  return {
    won: false,
    payout: halfBack ? Math.floor(bet.amount / 2) : 0,
    halfBack,
  };
}

// ---------------------------------------------------------------------------
// spinRoulette — the single public entrypoint.
// ---------------------------------------------------------------------------
export async function spinRoulette(userId, payload = {}) {
  const { bets, wheel: wheelIn, clientSeed: clientSeedIn } = payload;

  // Wheel selection (default per config).
  const wheel = wheelIn === 'american' ? 'american' : wheelIn === 'european' ? 'european' : roulette.defaultWheel;

  // Bets must be a non-empty array.
  if (!Array.isArray(bets) || bets.length === 0) {
    return { ok: false, error: 'invalid_bet', detail: 'bets must be a non-empty array' };
  }
  if (bets.length > roulette.maxBetsPerSpin) {
    return { ok: false, error: 'invalid_bet', detail: `too many bets (max ${roulette.maxBetsPerSpin})` };
  }

  // Validate every bet; reject the whole spin on the first malformed one.
  const validated = [];
  let totalBet = 0;
  for (const raw of bets) {
    const res = validateBet(raw, wheel);
    if (!res.ok) return { ok: false, error: 'invalid_bet', detail: res.detail };
    if (roulette.maxBet && res.bet.amount > roulette.maxBet) {
      return { ok: false, error: 'invalid_bet', detail: `bet exceeds max ${roulette.maxBet}` };
    }
    validated.push(res.bet);
    totalBet += res.bet.amount;
  }
  if (roulette.maxTotalBet && totalBet > roulette.maxTotalBet) {
    return { ok: false, error: 'invalid_bet', detail: `total stake exceeds max ${roulette.maxTotalBet}` };
  }

  // Funds check before spinning.
  const balance = await getOrCreateBalance(userId);
  if (totalBet > balance) {
    return { ok: false, error: 'insufficient_balance', balance };
  }

  // Provably-fair draw: index into the wheel's pocket list. nonce 0.
  const clientSeed =
    typeof clientSeedIn === 'string' && clientSeedIn ? clientSeedIn.slice(0, 64) : 'roulette';
  const { serverSeed, serverSeedHash } = commit();
  const nonce = 0;
  const pockets = pocketsFor(wheel);
  const idx = intInRange(0, pockets.length - 1, serverSeed, clientSeed, nonce);
  const winLabel = pockets[idx];
  const color = colorOf(winLabel);
  const winNumber = winLabel === '00' ? '00' : Number(winLabel);

  // Settle every bet.
  let totalPayout = 0;
  const settled = validated.map((b) => {
    const { won, payout, halfBack } = settleBet(b, winLabel, wheel);
    totalPayout += payout;
    return {
      type: b.type,
      selection: b.selection,
      amount: b.amount,
      won,
      payout,
      halfBack,
    };
  });
  const net = totalPayout - totalBet; // >= -totalBet; balance can't go negative.

  // Record the round (audit + provably-fair reveal).
  const { data: round, error: roundErr } = await supabase
    .from('game_rounds')
    .insert({
      user_id: userId,
      game: 'roulette',
      bet: totalBet,
      result: {
        wheel,
        number: winNumber,
        color,
        bets: settled,
        totalBet,
        totalPayout,
        net,
        laPartage: wheel === 'european' && roulette.laPartage === true,
      },
      server_seed_hash: serverSeedHash,
      server_seed: serverSeed,
      client_seed: clientSeed,
      nonce,
    })
    .select('id')
    .single();
  if (roundErr) throw roundErr;

  // Single atomic net change. totalBet <= balance and payouts >= 0, so the
  // balance can never go negative.
  const newBalance = await applyChange(
    userId,
    net,
    net >= 0 ? 'roulette_win' : 'roulette_bet',
    round.id
  );

  return {
    ok: true,
    wheel,
    result: { number: winNumber, color },
    bets: settled,
    totalBet,
    totalPayout,
    net,
    balance: newBalance,
    roundId: round.id,
    rules: {
      singleZero: wheel === 'european',
      laPartage: wheel === 'european' && roulette.laPartage === true,
      evenMoneyReturn: wheel === 'european' && roulette.laPartage === true ? '98.65%' : undefined,
    },
    fair: { serverSeedHash, serverSeed, clientSeed, nonce },
  };
}
