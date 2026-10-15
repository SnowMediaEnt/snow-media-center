// Single source of truth for tunable economy + game settings.
// Lives server-side so you can retune live (restart PM2) WITHOUT an app update.
//
// THE TWO-CURRENCY RULE (do not violate):
//   Play Chips  -> free, earned, never purchasable, never cashable, never
//                  convertible to AI credits. Everything here is play chips.
//   AI Credits  -> a completely separate system this server never touches.
// There is deliberately no money->chips path anywhere in this codebase.

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT) || 8090,
  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseJwtSecret: requireEnv('SUPABASE_JWT_SECRET'),
  // CORS origin allowed to open a socket (the SMC app). '*' only for local dev.
  corsOrigin: process.env.CORS_ORIGIN || '*',
  logLevel: process.env.LOG_LEVEL || 'info',
};

export const economy = {
  // Granted/maintained for free. None of these can be bought with money.
  DAILY_ALLOWANCE: 1000,          // chips from the daily claim
  SIGNUP_GRANT: 100,              // ONE-TIME starting balance for a brand-new user
  // NO per-connect low-balance top-up — that let anyone farm free chips by
  // reconnecting at 0. Out of chips? Spin the wheel (free every few hours).
  ADMIN_FLOOR: 1_000_000,         // admins kept >= this on connect (effectively unlimited)

  // Earn events (define amounts here; wire the triggers per-feature later).
  earn: {
    referral: 500,
    watched_support_video: 100,
    login_streak_day: 50,         // per consecutive day, cap below
    login_streak_cap: 7,
  },
};

// Admin user ids — these accounts get an effectively-unlimited chip balance
// (topped to economy.ADMIN_FLOOR on connect). NO other account is ever topped up.
export const admins = [
  '26db016a-60e5-4da7-9fb8-9a349812e4b2', // j.perezro@yahoo.com
  'f9773df5-e112-443d-8b02-10bb5e220e8f', // joshua.perez@snowmediaent.com
];

// Daily Wheel prize table (Phase 1). Parallel arrays: prize[i] has weight[i].
// House never loses real value — these are free chips. Tune freely.
export const dailyWheel = {
  prizes: [50, 100, 250, 500, 2000],
  weights: [40, 30, 18, 10, 2], // 2000 = rare "jackpot"
  cooldownMs: 4 * 60 * 60 * 1000, // one free spin every 4 hours
};

// Slots (Phase 2, rebuilt). 5 reels × 3 rows, 243 ways to win (Game-of-Thrones
// style). Symbol frequency per reel strip IS the odds model. Line, scatter and
// free-spin returns are tuned to ~87% before Snowfall Trio. The three honest,
// persistent collectors add ~15% in long-run EV, for a deliberately generous
// ~102% total target. The TV shows real visual progress but hides the exact
// counter and release point so the burst remains suspenseful.
// WILD only on reels 2-4; SCATTER sparse on all reels, 3+ ->
// free spins (re-triggerable, 2× wins). All tunable live. The app maps symbol
// keys -> brand images (p1-p4 = Snow Media / DreamStreams / Vibez / SMC logos).
const slotReelFreq = { p1: 3, p2: 4, p3: 5, p4: 6, la: 8, lk: 9, lq: 10, lj: 11, scatter: 1 };
const slotStrip = (freq) => {
  const s = [];
  for (const [sym, n] of Object.entries(freq)) for (let i = 0; i < n; i++) s.push(sym);
  return s;
};
export const slots = {
  rows: 3,
  reelCount: 5,
  bets: [10, 25, 50, 100, 250, 500, 1000],
  reels: [
    slotStrip({ ...slotReelFreq, relic_red: 1 }),
    slotStrip({ ...slotReelFreq, wild: 3, relic_red: 1, relic_blue: 1 }),
    slotStrip({ ...slotReelFreq, wild: 3, relic_red: 1, relic_blue: 1, relic_yellow: 1 }),
    slotStrip({ ...slotReelFreq, wild: 3, relic_red: 1, relic_blue: 1, relic_yellow: 1 }),
    slotStrip({ ...slotReelFreq, relic_red: 1 }),
  ],
  // matchCount -> multiplier (× total bet, then × ways) per paying symbol.
  paytable: {
    p1: { 3: 1.837, 4: 5.972, 5: 23.889 },
    p2: { 3: 1.193, 4: 3.401, 5: 15.636 },
    p3: { 3: 0.733, 4: 2.112, 5: 10.106 },
    p4: { 3: 0.459, 4: 1.378, 5: 7.350 },
    // Low-symbol Snow Pairs pay from two leftmost reels. This creates frequent
    // small/break-even moments without making premium hits routine.
    la: { 2: 0.05, 3: 0.1104, 4: 0.3674, 5: 1.837 },
    lk: { 2: 0.04, 3: 0.0919, 4: 0.2941, 5: 1.467 },
    lq: { 2: 0.035, 3: 0.0733, 4: 0.2300, 5: 1.104 },
    lj: { 2: 0.03, 3: 0.0459, 4: 0.1842, 5: 0.919 },
  },
  scatterPays: { 3: 3.674, 4: 18.374, 5: 91.871 }, // × total bet, anywhere
  freeSpinAwards: { 3: 8, 4: 12, 5: 20 },  // scatters -> free spins
  freeSpinMultiplier: 2,
  // The actual visible relic symbols drive the persistent features. Landing
  // anywhere charges the matching relic; no payline is required. One meter can
  // gain at most +1 per colour per spin, while every landed icon animates.
  collectors: {
    red: { symbol: 'relic_red', threshold: 15, multipliers: [2, 4, 8, 14], weights: [40, 30, 20, 10] },
    blue: { symbol: 'relic_blue', threshold: 24, multipliers: [4, 8, 14, 32], weights: [40, 30, 20, 10] },
    yellow: { symbol: 'relic_yellow', threshold: 34, multipliers: [8, 16, 30, 60], weights: [40, 30, 20, 10] },
  },
  // Placeholder glyphs; the front end swaps real brand images in by key.
  symbols: { p1: '💎', p2: '👑', p3: '🐺', p4: '🔥', la: '🅰️', lk: '🇰', lq: '🇶', lj: '🇯', wild: '⭐', scatter: '🎁', relic_red: '❄', relic_blue: '❄', relic_yellow: '♛' },
};

// Blackjack (Phase 3). Every table uses a real finite shoe: cards are dealt
// without replacement until the published cut card, then the shoe is retired
// between hands. All tables pay a natural 3:2 and stand on soft 17.
export const blackjack = {
  bets: [10, 25, 50, 100, 250, 500, 1000],
  blackjackPayout: 1.5,     // 3:2 (informational; settle math lives in the module)
  dealerStandsSoft17: true, // player-friendly
  roundTimeoutMs: 90_000,   // auto-stand an abandoned hand after this
  defaultVariant: 'classic',
  variants: {
    classic: {
      label: 'Classic 21',
      deckCount: 6,
      penetration: 0.75,
      dealerHitsSoft17: false,
      faceDownDouble: false,
    },
    single_deck: {
      label: 'Single Deck',
      deckCount: 1,
      penetration: 0.65,
      dealerHitsSoft17: false,
      faceDownDouble: false,
    },
    double_reveal: {
      label: 'Double Reveal',
      deckCount: 6,
      penetration: 0.75,
      dealerHitsSoft17: false,
      faceDownDouble: true,
    },
  },
};

// Video Poker (Phase 4). Jacks-or-Better, standard 9/6 paytable. Multipliers
// are × bet. Two-step: deal then draw. Tunable live (restart PM2).
export const videoPoker = {
  bets: [10, 25, 50, 100, 250, 500, 1000],
  payouts: {
    royal_flush: 800,
    straight_flush: 50,
    four_of_a_kind: 25,
    full_house: 9,
    flush: 6,
    straight: 4,
    three_of_a_kind: 3,
    two_pair: 2,
    jacks_or_better: 1,
    nothing: 0,
  },
};

// Roulette (Phase 5). Both wheels supported per-spin. A winning bet returns
// amount × (multiplier + 1) (stake + winnings); losing bets return 0. Stakes
// taken up front; net applied = totalPayout − totalBet. 0/00 lose all
// even-money / column / dozen bets (standard).
export const roulette = {
  defaultWheel: 'european',     // 'european' (0-36) | 'american' (0-36 + '00')
  // Player-friendly European rule: an even-money wager gets half its stake
  // back when zero lands (98.65% return on those wagers instead of 97.30%).
  laPartage: true,
  maxBet: 1000,                 // per single bet (null to disable)
  maxTotalBet: 5000,            // total staked across one spin (null to disable)
  maxBetsPerSpin: 50,           // guard against oversized bet arrays
  multipliers: {
    straight: 35, split: 17, street: 11, corner: 8, six_line: 5,
    column: 2, dozen: 2,
    red: 1, black: 1, even: 1, odd: 1, low: 1, high: 1,
  },
  redNumbers: new Set([
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
  ]),
};

// Casino Hold'em (Phase 6). Single-player poker vs the dealer with 5 community
// cards. Deal (ante) then call (2× ante) or fold. Dealer qualifies with a pair
// of fours or better. Ante bonus pays on the player's best hand (straight+).
export const casinoHoldem = {
  antes: [10, 25, 50, 100, 250, 500, 1000],
  anteBonus: {
    royal_flush: 100,
    straight_flush: 20,
    four_of_a_kind: 10,
    full_house: 3,
    flush: 2,
    straight: 1,
  },
  roundTimeoutMs: 90_000, // auto-fold an abandoned hand after this
  raiseMultipliers: [2, 3, 4], // call = 2x ante (standard); raise to 3x or 4x
};

// Per-game enable flags = instant kill switch (no app update needed).
// Flip to false and restart PM2 to disable a broken game immediately.
export const games = {
  daily_wheel: { enabled: true },
  slots: { enabled: true },        // Phase 2 (5-reel 243-ways)
  blackjack: { enabled: true },    // Phase 3
  video_poker: { enabled: true },  // Phase 4
  roulette: { enabled: true },     // Phase 5; wheel default in roulette.defaultWheel
  casino_holdem: { enabled: true },// Phase 6
};

// Rate limits per socket (reuse the SMC AI-endpoint approach).
export const limits = {
  eventsPerMinute: 120,           // hard cap on game events per socket/minute
  burst: 20,                      // short burst allowance
};
