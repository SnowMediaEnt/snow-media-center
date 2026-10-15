// SMC Game Room — server entrypoint.
// Fastify (HTTP) with Socket.IO attached. Every socket must present a valid
// Supabase JWT on connect; the server is the only authority on game outcomes
// and balances.
import Fastify from 'fastify';
import { Server as IOServer } from 'socket.io';
import pino from 'pino';

import { env, games, limits } from './config.js';
import { verifySupabaseJwt } from './auth.js';
import { resolveConnectBalance, getOrCreateBalance } from './chips.js';
import { walletAction } from './walletAction.js';
import { claimDailySpin } from './games/dailyWheel.js';
import { getSlotState, spinSlots } from './games/slots.js';
import { dealBlackjack, hit, stand, double, split, resolveOpenHand } from './games/blackjack.js';
import {
  dealVideoPoker,
  draw as drawVideoPoker,
  resolveOpen as resolveVideoPoker,
} from './games/videoPoker.js';
import { spinRoulette } from './games/roulette.js';
import {
  dealCasinoHoldem,
  call as callCasinoHoldem,
  fold as foldCasinoHoldem,
  resolveOpen as resolveCasinoHoldem,
} from './games/casinoHoldem.js';
import { getLounge, setGameName, settleArcade } from './games/arcade.js';
import { startVerifiedArcade, verifiedArcadeState, verifiedArcadeAction } from './games/verifiedArcade.js';
import { startPlinkoPhysicsRound, finishPlinkoPhysicsRound } from './games/plinkoPhysicsRounds.js';

const log = pino({ level: env.logLevel });

const fastify = Fastify({ logger: false });

// Plain health check for the reverse proxy / uptime monitoring.
fastify.get('/health', async () => ({
  ok: true,
  service: 'smc-game-server',
  games: Object.fromEntries(
    Object.entries(games).map(([k, v]) => [k, v.enabled])
  ),
}));

await fastify.ready();

const io = new IOServer(fastify.server, {
  // Custom path so Apache can route /gamesocket on the existing domain/cert
  // (wss://smcdreamstreams.store/gamesocket) to this process on 127.0.0.1.
  path: '/gamesocket',
  cors: { origin: env.corsOrigin, methods: ['GET', 'POST'] },
  // Socket.IO handles reconnects/rooms/fallbacks — the disconnect resilience
  // the brief calls out as the main failure mode.
  pingTimeout: 20000,
  pingInterval: 25000,
});

// --- Auth gate: verify JWT during the handshake, attach userId to socket. ---
io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
    const { userId, email } = await verifySupabaseJwt(token);
    socket.data.userId = userId;
    socket.data.email = email;
    next();
  } catch (err) {
    log.warn({ err: err.message }, 'socket auth rejected');
    next(new Error('unauthorized'));
  }
});

// --- Per-socket rate limiter (simple token bucket). ---
function makeLimiter() {
  let tokens = limits.burst;
  let last = Date.now();
  const ratePerMs = limits.eventsPerMinute / 60000;
  return function allow() {
    const now = Date.now();
    tokens = Math.min(limits.burst, tokens + (now - last) * ratePerMs);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

io.on('connection', async (socket) => {
  const { userId } = socket.data;
  const allow = makeLimiter();
  // Each user gets a private room so we can target them on reconnect.
  socket.join(`user:${userId}`);
  log.info({ userId, sid: socket.id }, 'socket connected');

  // Guard every game event behind the rate limiter.
  socket.use((event, nextEvent) => {
    if (!allow()) {
      socket.emit('rate_limited', { event: event[0] });
      return; // drop the event
    }
    nextEvent();
  });

  // Pick the ack callback whether the client sent a payload or not — clients
  // may emit `whoami(cb)` or `whoami({}, cb)`; both must work.
  const ackOf = (args) => args.find((a) => typeof a === 'function');

  // Phase 0 acceptance test: returns the verified userId + current balance,
  // applying the low-balance top-up so nobody is stuck at zero.
  socket.on('whoami', async (...args) => {
    const ack = ackOf(args);
    try {
      const balance = await walletAction(userId, () => resolveConnectBalance(userId));
      const reply = { userId, email: socket.data.email, balance };
      if (ack) ack(reply);
      else socket.emit('whoami', reply);
      log.info({ userId, balance }, 'whoami');
    } catch (err) {
      log.error({ userId, err: err.message }, 'whoami failed');
      const reply = { error: 'whoami_failed' };
      if (ack) ack(reply);
      else socket.emit('whoami', reply);
    }
  });

  // Lightweight balance fetch (no top-up side effect).
  socket.on('get_balance', async (...args) => {
    const ack = ackOf(args);
    try {
      const balance = await walletAction(userId, () => getOrCreateBalance(userId));
      if (ack) ack({ balance });
      else socket.emit('balance', { balance });
    } catch (err) {
      log.error({ userId, err: err.message }, 'get_balance failed');
      if (ack) ack({ error: 'balance_failed' });
    }
  });

  // Phase 1 — Daily Wheel. Client sends an optional clientSeed; the server
  // decides the prize (provably fair), credits it, and returns the result so
  // the wheel can animate to it. Kill-switchable via config.games.daily_wheel.
  socket.on('claim_daily_spin', async (...args) => {
    const ack = ackOf(args);
    const payload = args.find((a) => a && typeof a === 'object');
    if (!games.daily_wheel.enabled) {
      if (ack) ack({ error: 'game_disabled' });
      return;
    }
    try {
      const result = await walletAction(userId, () => claimDailySpin(userId, payload?.clientSeed));
      if (ack) ack(result);
      if (result.ok) {
        log.info({ userId, prize: result.prize, balance: result.balance }, 'daily_spin');
      }
    } catch (err) {
      log.error({ userId, err: err.message }, 'claim_daily_spin failed');
      if (ack) ack({ error: 'claim_failed' });
    }
  });

  // Phase 2 — Slots. Client sends { bet, clientSeed? }; server picks the reels
  // (provably fair), settles, and returns them so the reels can animate to it.
  socket.on('slots_state', async (...args) => {
    const ack = ackOf(args);
    const payload = args.find((a) => a && typeof a === 'object') || {};
    if (!games.slots.enabled) {
      if (ack) ack({ error: 'game_disabled' });
      return;
    }
    try {
      const result = await getSlotState(userId, payload.bet);
      if (ack) ack(result);
    } catch (err) {
      log.error({ userId, err: err.message }, 'slots_state failed');
      if (ack) ack({ error: 'state_failed' });
    }
  });

  socket.on('slots_spin', async (...args) => {
    const ack = ackOf(args);
    const payload = args.find((a) => a && typeof a === 'object') || {};
    if (!games.slots.enabled) {
      if (ack) ack({ error: 'game_disabled' });
      return;
    }
    try {
      const result = await walletAction(userId, () => spinSlots(userId, payload.bet, payload.clientSeed));
      if (ack) ack(result);
      if (result.ok) {
        log.info(
          {
            userId,
            bet: result.bet,
            payout: result.totalPayout,
            collectorPayout: result.collectorPayout,
            balance: result.balance,
          },
          'slots_spin'
        );
      }
    } catch (err) {
      log.error({ userId, err: err.message }, 'slots_spin failed');
      if (ack) ack({ error: 'spin_failed' });
    }
  });

  // Phase 3 — Blackjack (stateful, multi-turn). Client sends intents; the server
  // holds the deck/hands and is the only authority. Kill-switch: games.blackjack.
  const bjHandler = (fn, takesPayload) => async (...args) => {
    const ack = ackOf(args);
    const payload = args.find((a) => a && typeof a === 'object') || {};
    if (!games.blackjack.enabled) {
      if (ack) ack({ error: 'game_disabled' });
      return;
    }
    try {
      const result = await walletAction(userId, () => takesPayload
        ? fn(userId, payload.bet, payload.clientSeed, payload.variant, payload.sideBets)
        : fn(userId));
      if (ack) ack(result);
      if (result?.ok) {
        log.info({ userId, status: result.status, bet: result.bet, balance: result.balance }, 'blackjack');
      }
    } catch (err) {
      log.error({ userId, err: err.message }, 'blackjack event failed');
      if (ack) ack({ error: 'blackjack_failed' });
    }
  };
  socket.on('bj_deal', bjHandler(dealBlackjack, true)); // { bet, clientSeed?, variant? }
  socket.on('bj_hit', bjHandler(hit, false));
  socket.on('bj_stand', bjHandler(stand, false));
  socket.on('bj_double', bjHandler(double, false));
  socket.on('bj_split', bjHandler(split, false));

  // Phase 4 — Video Poker (Jacks or Better). Two steps: deal then draw.
  socket.on('vp_deal', async (...args) => {
    const ack = ackOf(args);
    const payload = args.find((a) => a && typeof a === 'object') || {};
    if (!games.video_poker.enabled) {
      if (ack) ack({ error: 'game_disabled' });
      return;
    }
    try {
      const result = await walletAction(userId, () => dealVideoPoker(userId, payload.bet, payload.clientSeed));
      if (ack) ack(result);
      if (result.ok) log.info({ userId, bet: result.bet, balance: result.balance }, 'vp_deal');
    } catch (err) {
      log.error({ userId, err: err.message }, 'vp_deal failed');
      if (ack) ack({ error: 'deal_failed' });
    }
  });
  socket.on('vp_draw', async (...args) => {
    const ack = ackOf(args);
    const payload = args.find((a) => a && typeof a === 'object') || {};
    if (!games.video_poker.enabled) {
      if (ack) ack({ error: 'game_disabled' });
      return;
    }
    try {
      const result = await walletAction(userId, () => drawVideoPoker(userId, payload.holds));
      if (ack) ack(result);
      if (result.ok) {
        log.info(
          { userId, bet: result.bet, rank: result.rank, payout: result.payout, balance: result.balance },
          'vp_draw'
        );
      }
    } catch (err) {
      log.error({ userId, err: err.message }, 'vp_draw failed');
      if (ack) ack({ error: 'draw_failed' });
    }
  });

  // Phase 5 — Roulette (single call). Client submits bets; server picks the
  // pocket (provably fair), settles every bet. Kill-switch: games.roulette.
  socket.on('roulette_spin', async (...args) => {
    const ack = ackOf(args);
    const payload = args.find((a) => a && typeof a === 'object') || {};
    if (!games.roulette.enabled) {
      if (ack) ack({ error: 'game_disabled' });
      return;
    }
    try {
      const result = await walletAction(userId, () => spinRoulette(userId, payload));
      if (ack) ack(result);
      if (result.ok) {
        log.info(
          { userId, wheel: result.wheel, number: result.result.number, totalBet: result.totalBet, balance: result.balance },
          'roulette_spin'
        );
      }
    } catch (err) {
      log.error({ userId, err: err.message }, 'roulette_spin failed');
      if (ack) ack({ error: 'spin_failed' });
    }
  });

  // Phase 6 — Casino Hold'em (stateful: deal -> call/fold). Server holds the
  // deck/board/hands. Kill-switch: games.casino_holdem.
  const chHandler = (fn, takesPayload) => async (...args) => {
    const ack = ackOf(args);
    const payload = args.find((a) => a && typeof a === 'object') || {};
    if (!games.casino_holdem.enabled) {
      if (ack) ack({ error: 'game_disabled' });
      return;
    }
    try {
      const result = await walletAction(userId, () => takesPayload
        ? fn(userId, payload.ante, payload.clientSeed)
        : fn(userId));
      if (ack) ack(result);
      if (result?.ok) {
        log.info({ userId, status: result.status, ante: result.ante, payout: result.payout, balance: result.balance }, 'casino_holdem');
      }
    } catch (err) {
      log.error({ userId, err: err.message }, 'casino_holdem event failed');
      if (ack) ack({ error: 'casino_holdem_failed' });
    }
  };
  socket.on('ch_deal', chHandler(dealCasinoHoldem, true)); // { ante, clientSeed? }
  // ch_call carries an optional { multiplier } (2 = standard call, 3/4 = raise).
  socket.on('ch_call', async (...args) => {
    const ack = ackOf(args);
    const payload = args.find((a) => a && typeof a === 'object') || {};
    if (!games.casino_holdem.enabled) {
      if (ack) ack({ error: 'game_disabled' });
      return;
    }
    try {
      const result = await walletAction(userId, () => callCasinoHoldem(userId, payload.multiplier));
      if (ack) ack(result);
      if (result?.ok) {
        log.info({ userId, status: result.status, ante: result.ante, payout: result.payout, balance: result.balance }, 'casino_holdem');
      }
    } catch (err) {
      log.error({ userId, err: err.message }, 'casino_holdem event failed');
      if (ack) ack({ error: 'casino_holdem_failed' });
    }
  });
  socket.on('ch_fold', chHandler(foldCasinoHoldem, false));

  // Lounge arcade: optional Snow Coin rounds plus a public game-name-only
  // leaderboard. Emails and streaming usernames are never returned here.
  socket.on('plinko_start', async (...args) => {
    const ack = ackOf(args);
    const payload = args.find((a) => a && typeof a === 'object') || {};
    try {
      const result = await walletAction(userId, () => startPlinkoPhysicsRound(userId, payload));
      if (ack) ack(result);
      if (result?.ok) log.info({ userId, roundId: result.roundId, bet: result.bet, resumed: result.resumed }, 'plinko_start');
    } catch (err) {
      log.error({ userId, err: err.message }, 'plinko_start failed');
      if (ack) ack({ ok: false, error: 'plinko_start_failed' });
    }
  });

  socket.on('plinko_finish', async (...args) => {
    const ack = ackOf(args);
    const payload = args.find((a) => a && typeof a === 'object') || {};
    try {
      const result = await walletAction(userId, () => finishPlinkoPhysicsRound(userId, payload));
      if (ack) ack(result);
      if (result?.ok) log.info({ userId, roundId: result.roundId, slot: result.slot, payout: result.payout }, 'plinko_finish');
    } catch (err) {
      log.error({ userId, err: err.message }, 'plinko_finish failed');
      if (ack) ack({ ok: false, error: 'plinko_finish_failed' });
    }
  });

  for (const [event, handler] of Object.entries({
    arcade_start: startVerifiedArcade,
    arcade_state: verifiedArcadeState,
    arcade_action: verifiedArcadeAction,
  })) {
    socket.on(event, async (...args) => {
      const ack = ackOf(args);
      const payload = args.find((a) => a && typeof a === 'object') || {};
      try {
        const result = await walletAction(userId, () => handler(userId, payload));
        if (ack) ack(result);
      } catch (err) {
        log.error({ userId, event, err: err.message }, 'verified arcade event failed');
        if (ack) ack({ ok: false, error: /round_expired/.test(err.message) ? 'round_expired' : 'arcade_unavailable' });
      }
    });
  }

  socket.on('arcade_play', async (...args) => {
    const ack = ackOf(args);
    const payload = args.find((a) => a && typeof a === 'object') || {};
    try {
      const result = await walletAction(userId, () => settleArcade(userId, payload));
      if (ack) ack(result);
      if (result?.ok) log.info({ userId, game: result.game, bet: result.bet, payout: result.payout }, 'arcade_play');
    } catch (err) {
      log.error({ userId, err: err.message }, 'arcade_play failed');
      if (ack) ack({ ok: false, error: 'arcade_failed' });
    }
  });

  socket.on('lounge_state', async (...args) => {
    const ack = ackOf(args);
    try { if (ack) ack(await getLounge(userId)); }
    catch (err) {
      log.error({ userId, err: err.message }, 'lounge_state failed');
      if (ack) ack({ ok: false, error: 'lounge_failed' });
    }
  });

  socket.on('lounge_set_name', async (...args) => {
    const ack = ackOf(args);
    const payload = args.find((a) => a && typeof a === 'object') || {};
    try { if (ack) ack(await setGameName(userId, payload.gameName)); }
    catch (err) {
      log.error({ userId, err: err.message }, 'lounge_set_name failed');
      if (ack) ack({ ok: false, error: 'save_failed' });
    }
  });

  socket.on('disconnect', (reason) => {
    log.info({ userId, sid: socket.id, reason }, 'socket disconnected');
    // Auto-resolve any open stateful hand so a staked bet can't hang.
    walletAction(userId, () => resolveOpenHand(userId)).catch((err) =>
      log.error({ userId, err: err.message }, 'bj auto-resolve failed')
    );
    walletAction(userId, () => resolveVideoPoker(userId)).catch(() => {});
    walletAction(userId, () => resolveCasinoHoldem(userId)).catch(() => {});
  });
});

const address = await fastify.listen({ port: env.port, host: '127.0.0.1' });
log.info({ address, port: env.port }, 'smc-game-server listening');
