// Game Day's channel scan: once a day per provider, the model reads the
// provider's event-capable channel names and links them to today's games, so
// "#11 Boston vs Michigan" in a B1G+ category shows up under the right game
// even when the box's own matcher (src/lib/gameDay.ts) misses it. Migration
// 20261002060000_game_day_ai_match.sql. verify_jwt = false (boxes have no
// session), so everything is checked here.
//
//   scan   {host, candidates: {id, name, cat}[≤2000], lineup_hash, device_id}
//          → {ok: true, scanned}            scanned false: the host's scan
//                                           from the last 3 h still holds
//          | {ok: false, reason: off | paused | limit | bad_request | error}
//   cached {host}
//          → {ok, day, lineup_hash, scanned_at, matches: {gameId: AiMatch[]},
//             learned: {league, cat}[]}
//   learn  {host, game_id, stream_id, name, cat, source: play|wrong|pick, device_id}
//          → {ok}
//
// `host` is the line's hostname only (gameDay.ts serviceOf): never a login,
// password, port or URL. A candidate is a channel id, its name and its
// category, nothing else.
//
// What keeps the bill small:
//   * the flag feature_flags.gameday_ai_match (off: every op answers 'off')
//     and the owner's global AI pause (ai_safety_state);
//   * the games come from game-day itself, never from the box, so nobody can
//     use our model for anything else;
//   * a scan of the same line-up within 3 h is answered from the cache;
//   * one scan per host at a time, 8 per host a day, 300 in all a day (SQL),
//     and 20 scan requests an hour per IP;
//   * every scan is logged in ai_usage_log (feature 'gameday'), so it counts
//     toward the global token auto-pause, and in game_day_ai_usage.
//
// Logs never hold channel names next to a device or an address.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { checkPause, enforceThreshold } from '../_shared/ai-guard.ts';
import { clientIp, hashIp, throttle, type ThrottleDb } from '../_shared/requestGuard.ts';
import {
  type AiMatch, type Link, type ScanCandidate, type ScanGame,
  MODEL, batches, candidatesHash, cleanCandidates, costUsd, etDay, isPpv, learnedFrom, outputText, parseLinks,
  requestBody, scanGames, toMatches,
} from './prompt.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const FLAG = 'gameday_ai_match';
const HOST = /^[a-z0-9][a-z0-9.-]{0,99}$/;
const GAME_ID = /^[a-z0-9]{2,12}:\d{4,12}$/;
const LINEUP_HASH = /^[A-Za-z0-9_:.-]{1,128}$/;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A scan of the same line-up this recent is answered from the cache. */
const FRESH_MS = 3 * HOUR_MS;
const SCANS_PER_HOST_DAY = 8;
const SCANS_PER_DAY = 300;
const SCANS_PER_IP_HOUR = 20;
const LEARN_PER_IP_HOUR = 60;
const LEARN_PER_DEVICE_HOUR = 30;
/** Model calls of one scan in flight at once, and how long each may take. */
const PARALLEL_CALLS = 3;
const CALL_TIMEOUT_MS = 30_000;
const GAMES_TIMEOUT_MS = 20_000;

const FLAG_TTL_MS = 60_000;
const GAMES_TTL_MS = 3 * 60_000;
const CACHED_TTL_MS = 30_000;
/** Signals and scans are kept this long (learned categories look this far back). */
const KEEP_MS = 30 * DAY_MS;
/** Wrong-game reports and crowd plays count for the current day's games. */
const RECENT_MS = 36 * HOUR_MS;
const KNOWN_BOX_AFTER_MS = 30 * 60 * 1000;
const MAX_LEARNED = 100;

type Admin = ReturnType<typeof createClient>;

let flagCache: { at: number; on: boolean } | null = null;
let gamesCache: { at: number; games: unknown[] } | null = null;
const cachedAnswers = new Map<string, { at: number; body: unknown }>();

const sha256 = async (s: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** The provider's hostname, lower-case, any port cut off; '' when it isn't one. */
const hostOf = (v: unknown): string => {
  const h = String(v ?? '').trim().toLowerCase().replace(/:\d{1,5}$/, '');
  return HOST.test(h) ? h : '';
};
const deviceOf = (v: unknown): string => (typeof v === 'string' && v.trim().length >= 8 ? v.trim().slice(0, 200) : '');
const textOf = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** The kill switch, read with the service role. A missing row is on (as the
 *  box's useFeatureFlag); a read that fails is off: no AI spend on a guess. */
async function flagOn(admin: Admin): Promise<boolean> {
  if (flagCache && Date.now() - flagCache.at < FLAG_TTL_MS) return flagCache.on;
  let on = false;
  try {
    const { data, error } = await admin.from('feature_flags').select('enabled').eq('key', FLAG).maybeSingle();
    on = !error && (data == null || (data as { enabled?: boolean }).enabled !== false);
  } catch {
    on = false;
  }
  flagCache = { at: Date.now(), on };
  return on;
}

/** Today's games, from game-day (the same list every box gets), kept 3 min. */
async function todaysGames(): Promise<unknown[]> {
  if (gamesCache && Date.now() - gamesCache.at < GAMES_TTL_MS) return gamesCache.games;
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GAMES_TIMEOUT_MS);
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/game-day`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(anon ? { apikey: anon, Authorization: `Bearer ${anon}` } : {}) },
      body: JSON.stringify({ op: 'list' }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`game-day HTTP ${res.status}`);
    const data = await res.json() as { ok?: boolean; games?: unknown };
    // A failed build with no list to fall back on is not "no games today".
    if (!Array.isArray(data?.games) || (data.ok === false && !data.games.length)) throw new Error('game-day: no list');
    gamesCache = { at: Date.now(), games: data.games };
    return data.games;
  } finally {
    clearTimeout(timer);
  }
}

/** A box we have seen before (channel-status's test): signed a line in on
 *  this host, or has been sending analytics for half an hour. */
async function knownBox(admin: Admin, deviceId: string, host: string): Promise<boolean> {
  try {
    const [line, seen] = await Promise.all([
      admin.from('player_signins').select('id').eq('device_id', deviceId).eq('panel_host', host).limit(1),
      admin.from('analytics_sessions').select('id').eq('device_id', deviceId)
        .lt('created_at', new Date(Date.now() - KNOWN_BOX_AFTER_MS).toISOString()).limit(1),
    ]);
    return !!((line.data ?? []).length || (seen.data ?? []).length);
  } catch {
    return false;
  }
}

/** Now and then, forget scans and signals nobody needs any more. */
async function sweep(admin: Admin, chance: number) {
  if (Math.random() >= chance) return;
  try {
    const before = new Date(Date.now() - KEEP_MS);
    await admin.from('game_day_match_signals').delete().lt('created_at', before.toISOString());
    await admin.from('game_day_ai_matches').delete().lt('day', etDay(before.getTime()));
  } catch { /* next time */ }
}

/** One model call: the links it found, and the tokens it used. Throws on any
 *  failure (status only in the log, never the input). */
async function askModel(key: string, games: ScanGame[], cands: ScanCandidate[]): Promise<{ links: Link[]; tokensIn: number; tokensOut: number }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody(games, cands)),
      signal: ctl.signal,
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`OpenAI HTTP ${res.status}`);
    }
    const data = await res.json() as { usage?: { input_tokens?: number; output_tokens?: number } };
    return {
      links: parseLinks(outputText(data), games, cands),
      tokensIn: Number(data.usage?.input_tokens) || 0,
      tokensOut: Number(data.usage?.output_tokens) || 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Runs jobs a few at a time, each settled on its own. */
async function inTurn<T>(jobs: Array<() => Promise<T>>, width: number): Promise<PromiseSettledResult<T>[]> {
  const out: PromiseSettledResult<T>[] = new Array(jobs.length);
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const i = next++;
      try { out[i] = { status: 'fulfilled', value: await jobs[i]() }; } catch (reason) { out[i] = { status: 'rejected', reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, lane));
  return out;
}

interface SignalRow {
  game_id: string; league: string | null; stream_id: number; channel_name: string | null;
  category_name: string | null; source: string; device_hash: string; created_at: string;
}

/** The host's answer for boxes: the latest scan's matches, less the streams
 *  two boxes said were the wrong game, plus the streams two boxes watched or
 *  picked for a game (source 'crowd'); and the categories learned for each
 *  league over 30 days. */
async function cachedAnswer(admin: Admin, host: string) {
  const now = Date.now();
  const today = etDay(now);
  const yesterday = etDay(now - DAY_MS);
  const [scansRes, signalsRes] = await Promise.all([
    admin.from('game_day_ai_matches').select('day, lineup_hash, scanned_at, matches, learned')
      .eq('host', host).gte('day', etDay(now - KEEP_MS)).order('day', { ascending: false }).limit(40),
    admin.from('game_day_match_signals')
      .select('game_id, league, stream_id, channel_name, category_name, source, device_hash, created_at')
      .eq('host', host).eq('trusted', true).gte('created_at', new Date(now - KEEP_MS).toISOString())
      .order('created_at', { ascending: false }).limit(5000),
  ]);
  if (scansRes.error) throw new Error(`scans: ${scansRes.error.message}`);
  type ScanRow = { day: string; lineup_hash: string | null; scanned_at: string | null; matches: unknown; learned: unknown };
  const scans = (scansRes.data ?? []) as ScanRow[];
  const signals = (signalsRes.data ?? []) as SignalRow[];
  // Today's scan, or yesterday's while today has none (late games still on).
  const latest = scans.find((r) => r.scanned_at && (r.day === today || r.day === yesterday)) ?? null;

  const matches: Record<string, AiMatch[]> = {};
  if (latest && latest.matches && typeof latest.matches === 'object') {
    for (const [gameId, list] of Object.entries(latest.matches as Record<string, unknown>)) {
      if (Array.isArray(list)) matches[gameId] = list as AiMatch[];
    }
  }

  // Distinct boxes per (game, stream) and per (league, category).
  const recent = new Date(now - RECENT_MS).toISOString();
  const wrong = new Map<string, Set<string>>();
  const crowd = new Map<string, { boxes: Set<string>; row: SignalRow }>();
  const cats = new Map<string, { league: string; cat: string; boxes: Set<string> }>();
  for (const s of signals) {
    const key = `${s.game_id}|${s.stream_id}`;
    if (s.source === 'wrong') {
      if (s.created_at >= recent) (wrong.get(key) ?? wrong.set(key, new Set()).get(key)!).add(s.device_hash);
      continue;
    }
    if (s.created_at >= recent) {
      const c = crowd.get(key) ?? crowd.set(key, { boxes: new Set(), row: s }).get(key)!;
      c.boxes.add(s.device_hash);
    }
    if (s.league && s.category_name) {
      const k = `${s.league}|${s.category_name.toLowerCase()}`;
      const c = cats.get(k) ?? cats.set(k, { league: s.league, cat: s.category_name, boxes: new Set() }).get(k)!;
      c.boxes.add(s.device_hash);
    }
  }
  const isWrong = (gameId: string, streamId: number) => (wrong.get(`${gameId}|${streamId}`)?.size ?? 0) >= 2;
  for (const gameId of Object.keys(matches)) {
    matches[gameId] = matches[gameId].filter((m) => !isWrong(gameId, m.stream_id));
    if (!matches[gameId].length) delete matches[gameId];
  }
  for (const c of crowd.values()) {
    if (c.boxes.size < 2 || !c.row.channel_name) continue;
    const { game_id: gameId, stream_id: streamId } = c.row;
    if (isWrong(gameId, streamId) || matches[gameId]?.some((m) => m.stream_id === streamId)) continue;
    (matches[gameId] ??= []).push({ stream_id: streamId, name: c.row.channel_name, confidence: 'high', source: 'crowd' });
  }

  const learned = new Map<string, { league: string; cat: string }>();
  for (const r of scans) {
    for (const l of Array.isArray(r.learned) ? r.learned as Array<{ league?: unknown; cat?: unknown }> : []) {
      if (typeof l?.league === 'string' && typeof l?.cat === 'string') learned.set(`${l.league}|${l.cat.toLowerCase()}`, { league: l.league, cat: l.cat });
    }
  }
  for (const [k, c] of cats) if (c.boxes.size >= 2) learned.set(k, { league: c.league, cat: c.cat });

  return {
    ok: true,
    day: latest?.day ?? today,
    lineup_hash: latest?.lineup_hash ?? null,
    scanned_at: latest?.scanned_at ?? null,
    matches,
    learned: [...learned.values()].slice(0, MAX_LEARNED),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ ok: false, reason: 'error' }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const throttleDb = admin as unknown as ThrottleDb;

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) ?? {}; } catch { /* empty */ }
  const op = String(body.op ?? '');

  try {
    if (op === 'cached') {
      const host = hostOf(body.host);
      if (!host) return json({ ok: false, reason: 'bad_request' }, 400);
      if (!(await flagOn(admin))) return json({ ok: false, reason: 'off' });
      const hit = cachedAnswers.get(host);
      if (hit && Date.now() - hit.at < CACHED_TTL_MS) return json(hit.body);
      const answer = await cachedAnswer(admin, host);
      cachedAnswers.set(host, { at: Date.now(), body: answer });
      return json(answer);
    }

    if (op === 'scan') {
      const host = hostOf(body.host);
      const deviceId = deviceOf(body.device_id);
      const lineupHash = typeof body.lineup_hash === 'string' ? body.lineup_hash : '';
      const cands = cleanCandidates(body.candidates);
      if (!host || !deviceId || !LINEUP_HASH.test(lineupHash) || !cands) return json({ ok: false, reason: 'bad_request' }, 400);
      if (!(await flagOn(admin))) return json({ ok: false, reason: 'off' });
      const pause = await checkPause();
      if (pause.blocked) return json({ ok: false, reason: 'paused' });
      const ipHash = await hashIp(clientIp(req.headers));
      if (!(await throttle(throttleDb, ipHash ? `gdm:i:${ipHash}` : null, SCANS_PER_IP_HOUR, HOUR_MS))) {
        return json({ ok: false, reason: 'limit' });
      }

      // The same line-up scanned in the last 3 h: nothing to do. The same
      // channels under another box's hash count as the same line-up.
      const day = etDay();
      const cHash = candidatesHash(cands);
      const { data: row } = await admin.from('game_day_ai_matches')
        .select('lineup_hash, candidates_hash, scanned_at').eq('host', host).eq('day', day).maybeSingle();
      const last = row as { lineup_hash: string | null; candidates_hash: string | null; scanned_at: string | null } | null;
      const fresh = !!last?.scanned_at && Date.now() - Date.parse(last.scanned_at) < FRESH_MS;
      if (fresh && (last!.lineup_hash === lineupHash || last!.candidates_hash === cHash)) {
        if (last!.lineup_hash !== lineupHash) {
          await admin.from('game_day_ai_matches').update({ lineup_hash: lineupHash, updated_at: new Date().toISOString() })
            .eq('host', host).eq('day', day);
          cachedAnswers.delete(host);
        }
        return json({ ok: true, scanned: false });
      }

      const games = scanGames(await todaysGames());
      const usable = cands.filter((c) => !isPpv(c));
      const stored = (fields: Record<string, unknown>) => admin.from('game_day_ai_matches').upsert({
        host, day, lineup_hash: lineupHash, candidates_hash: cHash, scanned_at: new Date().toISOString(),
        scan_started_at: null, candidates: usable.length, games: games.length, updated_at: new Date().toISOString(), ...fields,
      }, { onConflict: 'host,day' });
      // Nothing to link: stored as scanned, no model call, no limit used.
      if (!games.length || !usable.length) {
        const { error } = await stored({ matches: {}, learned: [] });
        if (error) throw new Error(`store: ${error.message}`);
        cachedAnswers.delete(host);
        return json({ ok: true, scanned: true, games: games.length, links: 0 });
      }

      // One scan per host at a time and 8 a day, then 300 a day in all.
      const { data: take, error: takeError } = await admin.rpc('game_day_ai_host_take', { p_host: host, p_day: day, p_cap: SCANS_PER_HOST_DAY });
      if (takeError) throw new Error(`host take: ${takeError.message}`);
      if (take === 'busy') return json({ ok: true, scanned: false, busy: true });
      if (take !== 'ok') return json({ ok: false, reason: 'limit' });
      const release = () => admin.from('game_day_ai_matches').update({ scan_started_at: null }).eq('host', host).eq('day', day);
      const { data: allowed, error: capError } = await admin.rpc('game_day_ai_take', { p_cap: SCANS_PER_DAY });
      if (capError || allowed !== true) {
        await release();
        if (capError) throw new Error(`day cap: ${capError.message}`);
        return json({ ok: false, reason: 'limit' });
      }
      const openaiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openaiKey) {
        await release();
        throw new Error('OpenAI API key not configured');
      }

      const started = Date.now();
      const parts = batches(usable);
      const results = await inTurn(parts.map((part) => () => askModel(openaiKey, games, part)), PARALLEL_CALLS);
      let tokensIn = 0;
      let tokensOut = 0;
      const links: Link[] = [];
      let failed = 0;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          tokensIn += r.value.tokensIn;
          tokensOut += r.value.tokensOut;
          links.push(...r.value.links);
        } else {
          failed++;
          console.error('[game-day-match] model call failed:', (r.reason as Error)?.message ?? String(r.reason));
        }
      }
      const cost = costUsd(tokensIn, tokensOut);
      const matches = toMatches(links, usable);
      const linked = Object.values(matches).reduce((n, l) => n + l.length, 0);

      // The spend is counted whatever happened.
      await admin.rpc('game_day_ai_add', { p_tokens_in: tokensIn, p_tokens_out: tokensOut, p_cost: cost });
      await admin.from('ai_usage_log').insert({
        user_id: null,
        user_email: null,
        feature: 'gameday',
        model: MODEL,
        prompt: `Game Day scan for ${host}: ${games.length} games x ${usable.length} channels in ${parts.length} call(s)`,
        response_preview: failed ? `${failed} of ${parts.length} call(s) failed` : `${linked} link(s) for ${Object.keys(matches).length} game(s)`,
        prompt_tokens: tokensIn,
        completion_tokens: tokensOut,
        total_tokens: tokensIn + tokensOut,
        cost_credits: cost,
        status: failed ? 'error' : 'ok',
        error_message: failed ? 'model call failed' : null,
      });
      try { await enforceThreshold(); } catch { /* best effort */ }

      // A scan with a failed call is not stored: half a line-up would hold
      // for 3 h. The next box's scan tries again.
      if (failed) {
        await release();
        return json({ ok: false, reason: 'error' });
      }
      const { error } = await stored({
        matches, learned: learnedFrom(links, games, usable), model: MODEL,
        tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: cost,
      });
      if (error) throw new Error(`store: ${error.message}`);
      cachedAnswers.delete(host);
      await sweep(admin, 0.05);
      console.log(`[game-day-match] scan ${host}: ${games.length} games, ${usable.length} channels, ${linked} links, ${Date.now() - started} ms`);
      return json({ ok: true, scanned: true, games: games.length, links: linked });
    }

    if (op === 'learn') {
      const host = hostOf(body.host);
      const gameId = typeof body.game_id === 'string' ? body.game_id : '';
      const streamId = Number(body.stream_id);
      const source = String(body.source ?? '');
      const deviceId = deviceOf(body.device_id);
      if (!host || !GAME_ID.test(gameId) || !Number.isSafeInteger(streamId) || streamId <= 0
        || !['play', 'wrong', 'pick'].includes(source) || !deviceId) {
        return json({ ok: false, reason: 'bad_request' }, 400);
      }
      if (!(await flagOn(admin))) return json({ ok: false, reason: 'off' });
      const ipHash = await hashIp(clientIp(req.headers));
      const deviceHash = await sha256(`smc-gameday:${deviceId}`);
      const [byIp, byDevice] = await Promise.all([
        throttle(throttleDb, ipHash ? `gdm:l:${ipHash}` : null, LEARN_PER_IP_HOUR, HOUR_MS),
        throttle(throttleDb, `gdm:ld:${deviceHash}`, LEARN_PER_DEVICE_HOUR, HOUR_MS),
      ]);
      if (!byIp || !byDevice) return json({ ok: false, reason: 'limit' });
      const trusted = await knownBox(admin, deviceId, host);
      const { error } = await admin.from('game_day_match_signals').insert({
        host, game_id: gameId, league: gameId.split(':')[0], stream_id: streamId,
        channel_name: textOf(body.name, 80), category_name: textOf(body.cat, 40), source,
        device_hash: deviceHash, ip_hash: ipHash, trusted,
      });
      if (error) throw new Error(`learn: ${error.message}`);
      if (trusted) cachedAnswers.delete(host);
      await sweep(admin, 0.02);
      return json({ ok: true });
    }

    return json({ ok: false, reason: 'bad_request' }, 400);
  } catch (e) {
    console.error('[game-day-match] error:', (e as Error).message);
    return json({ ok: false, reason: 'error' });
  }
});
