// Game Day's search: the channels the name matching can't place, found once a
// day per provider by the game-day-match edge function (an AI reads the
// provider's event-like channel names against today's games).
//
// - scan: the first Game Day open of the day on a line's provider, or when
//   that provider's stored answer is older than three hours or was made from
//   another line-up, sends that provider's event-like channels (id, name and
//   category only: never a login, a password, a URL or a port) in the
//   background. The screen never waits for it.
// - cached: what the last scan found for every game on that provider, read
//   when Game Day opens and again after a scan (kept ten minutes this
//   session). With it come the "learned" categories: those whose channels
//   viewers kept watching for a league's games, kept on this box (per
//   provider) so the name matching treats them as that league's next time.
// - learn: three quiet signals. 'play': a game's list closed with nothing to
//   watch (rememberMiss), then Live TV played, for six seconds, a channel
//   whose name or category shares a word with its teams (noteLivePlay).
//   'pick': the owner added a channel to a game the matching found nothing
//   for. 'wrong': a viewer said a found channel is not this game.
//
// Nothing here runs in demo or on a Kids profile, nothing throws, and every
// call is given up on after six seconds. No import of lib/gameDay at run time:
// Live TV loads this for noteLivePlay and must stay light.
import { supabase } from '@/integrations/supabase/client';
import { getDeviceId, trackEvent } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';
import { kidsLevel } from '@/lib/kidsFilter';
import type { AiMatch, Game, GameChannel, LearnedCats, ScanCandidate } from '@/lib/gameDay';

export type { AiMatch, LearnedCats, ScanCandidate };

const FN = 'game-day-match';
export const AI_FLAG = 'gameday_ai_match';
const TIMEOUT_MS = 6_000;
/** How long this session keeps a provider's stored answer. */
const CACHED_MS = 10 * 60_000;
/** A provider's answer older than this is scanned again. */
const STALE_MS = 3 * 60 * 60_000;
/** A box never sends a provider's scan again sooner than this (the server may still be working on it). */
const RESEND_MS = 30 * 60_000;
const LEARNED_MS = 30 * 24 * 60 * 60_000;
const MAX_MATCHES_PER_GAME = 6;

/** A link found by search (GameChannel.search). */
export type SearchLink = GameChannel;

/** The panel a line is on, by its hostname alone (gameDay.serviceOf). */
export const hostOf = (host: string | null | undefined): string =>
  String(host ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[:/].*$/, '');

/** Category and channel text the way Game Day compares it: accents folded,
 *  lower case, separators and punctuation to single spaces. */
export const normCat = (s: string): string => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[|:_/-]+/g, ' ')
  .toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9&+ ]+/g, ' ').replace(/\s+/g, ' ').trim();

const sharesToken = (spaced: string, tokens: readonly string[]): boolean => tokens.some((t) => !!t && spaced.includes(` ${t} `));

const flagOff = (): boolean => { try { return localStorage.getItem(`snow-feature-flag:${AI_FLAG}`) === '0'; } catch { return false; } };
/** Whether this box may use the search at all: never in demo or on a Kids profile. */
export const aiAllowed = (): boolean => { try { return !isDemo() && !kidsLevel(); } catch { return false; } };

const today = (now = Date.now()): string => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const readJson = <T>(store: 'local' | 'session', key: string): T | null => {
  try {
    const raw = (store === 'local' ? localStorage : sessionStorage).getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
};
const writeJson = (store: 'local' | 'session', key: string, value: unknown): void => {
  try { (store === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(value)); } catch { /* full or blocked */ }
};

/** The function's answer, or 'timeout' after six seconds, or null when it failed. */
async function call(body: Record<string, unknown>): Promise<{ data: unknown } | 'timeout' | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), TIMEOUT_MS); });
    const r = await Promise.race([supabase.functions.invoke(FN, { body }), late]);
    if (r === 'timeout') return r;
    if (!r || r.error) return null;
    return { data: r.data };
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ── cached ──────────────────────────────────────────────────────────────────

/** A provider's stored answer: every game's matches, and what it was made from. */
export interface CachedScan {
  lineupHash: string;
  /** When the server last scanned (ms; 0 = never today). */
  scannedAt: number;
  matches: Record<string, AiMatch[]>;
}

const cleanMatches = (raw: unknown): AiMatch[] => {
  if (!Array.isArray(raw)) return [];
  const out: AiMatch[] = [];
  for (const m of raw) {
    const r = (m ?? {}) as Record<string, unknown>;
    const id = Number(r.stream_id);
    if (!Number.isInteger(id) || id <= 0 || typeof r.name !== 'string') continue;
    if (r.confidence !== 'high' && r.confidence !== 'medium') continue;
    out.push({ stream_id: id, name: r.name.slice(0, 120), confidence: r.confidence, source: r.source === 'crowd' ? 'crowd' : 'ai' });
    if (out.length >= MAX_MATCHES_PER_GAME) break;
  }
  return out;
};

const cleanCached = (data: unknown): { scan: CachedScan; learned: Array<{ league: string; cat: string }> } | null => {
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.ok !== true) return null;
  const matches: Record<string, AiMatch[]> = {};
  const src = r.matches && typeof r.matches === 'object' ? (r.matches as Record<string, unknown>) : {};
  for (const id of Object.keys(src).slice(0, 400)) {
    const list = cleanMatches(src[id]);
    if (list.length) matches[id] = list;
  }
  const at = typeof r.scanned_at === 'string' ? Date.parse(r.scanned_at) : Number(r.scanned_at);
  const learned: Array<{ league: string; cat: string }> = [];
  for (const l of Array.isArray(r.learned) ? r.learned.slice(0, 200) : []) {
    const x = (l ?? {}) as Record<string, unknown>;
    const league = typeof x.league === 'string' ? x.league.trim().toLowerCase() : '';
    const cat = typeof x.cat === 'string' ? normCat(x.cat).slice(0, 60) : '';
    if (/^[a-z0-9]{2,12}$/.test(league) && cat) learned.push({ league, cat });
  }
  return {
    scan: { lineupHash: typeof r.lineup_hash === 'string' ? r.lineup_hash : '', scannedAt: Number.isFinite(at) ? at : 0, matches },
    learned,
  };
};

const cachedKey = (host: string) => `smc-gdai-cached:${host}`;
const learnedKey = (host: string) => `smc-gdai-learned:${host}`;
const cachedInflight = new Map<string, Promise<CachedScan | null>>();

/** A provider's stored answer (null when there is none to be had). Kept ten
 *  minutes this session; `force` reads it again (after a scan). */
export function fetchCachedScan(host: string, force = false): Promise<CachedScan | null> {
  if (!host || !aiAllowed()) return Promise.resolve(null);
  if (!force) {
    const hit = readJson<{ at: number; scan: CachedScan }>('session', cachedKey(host));
    if (hit && hit.scan && Date.now() - hit.at < CACHED_MS && Date.now() >= hit.at) return Promise.resolve(hit.scan);
  }
  const busy = cachedInflight.get(host);
  if (busy) return busy;
  const p = (async () => {
    try {
      const r = await call({ op: 'cached', host });
      if (!r || r === 'timeout') return null;
      const got = cleanCached(r.data);
      if (!got) return null;
      writeJson('session', cachedKey(host), { at: Date.now(), scan: got.scan });
      writeJson('local', learnedKey(host), { at: Date.now(), list: got.learned });
      return got.scan;
    } catch {
      return null;
    } finally {
      cachedInflight.delete(host);
    }
  })();
  cachedInflight.set(host, p);
  return p;
}

/** The categories viewers have shown to carry a league's games on these
 *  providers (category, normalised → its leagues), as last read. */
export function learnedCats(hosts: readonly string[]): LearnedCats {
  const out = new Map<string, string[]>();
  if (!aiAllowed() || flagOff()) return out;
  for (const host of hosts) {
    const hit = readJson<{ at: number; list: Array<{ league: string; cat: string }> }>('local', learnedKey(host));
    if (!hit || !Array.isArray(hit.list) || !(Date.now() - hit.at < LEARNED_MS)) continue;
    for (const { league, cat } of hit.list) {
      if (typeof league !== 'string' || typeof cat !== 'string' || !cat) continue;
      const have = out.get(cat) ?? [];
      if (!have.includes(league)) out.set(cat, [...have, league]);
    }
  }
  return out;
}

// ── scan ────────────────────────────────────────────────────────────────────

/** 'busy': another box on this provider is scanning it right now (read the answer a little later).
 *  'started': the server took the scan and finishes it after answering (read it a little later). */
export type ScanResult = 'scanned' | 'started' | 'fresh' | 'busy' | 'off' | 'limit' | 'error' | 'timeout';
interface ScanRecord { day: string; at: number; hash: string }
const scanKey = (host: string) => `smc-gdai-scan:${host}`;

/** Whether this box should send the provider's scan now: the stored answer is
 *  missing, older than three hours or from another line-up, and this box has
 *  not sent this line-up today within the last three hours (nor anything in
 *  the last half hour: the server may still be on it). */
export function shouldScan(host: string, cached: CachedScan | null, hash: string, now = Date.now()): boolean {
  if (!host || !hash || !aiAllowed() || flagOff()) return false;
  if (cached && cached.lineupHash === hash && cached.scannedAt > 0 && now - cached.scannedAt < STALE_MS) return false;
  const last = readJson<ScanRecord>('local', scanKey(host));
  if (last && typeof last.at === 'number' && now >= last.at) {
    if (now - last.at < RESEND_MS) return false;
    if (last.day === today(now) && last.hash === hash && now - last.at < STALE_MS) return false;
  }
  return true;
}

/** Sends the provider's scan (in the background: the caller never waits on
 *  it to draw anything). */
export async function sendScan(host: string, candidates: ScanCandidate[], hash: string): Promise<ScanResult> {
  if (!host || !candidates.length || !aiAllowed()) return 'off';
  const started = Date.now();
  const record: ScanRecord = { day: today(started), at: started, hash };
  writeJson('local', scanKey(host), record);
  const r = await call({
    op: 'scan', host, lineup_hash: hash, device_id: getDeviceId(),
    // Only these three fields go, whatever the caller handed over.
    candidates: candidates.slice(0, 2000).map((c) => ({ id: c.id, name: String(c.name ?? '').trim().slice(0, 80), cat: String(c.cat ?? '').trim().slice(0, 40) })),
  });
  let result: ScanResult;
  if (r === 'timeout') result = 'timeout';
  else if (!r) result = 'error';
  else {
    const d = (r.data ?? {}) as { ok?: boolean; scanned?: boolean; started?: boolean; busy?: boolean; reason?: string };
    if (d.ok === true) result = d.busy === true ? 'busy' : d.started === true ? 'started' : d.scanned === false ? 'fresh' : 'scanned';
    else result = d.reason === 'off' || d.reason === 'paused' ? 'off' : d.reason === 'limit' ? 'limit' : 'error';
  }
  try {
    trackEvent('gameday_ai_scan', 'player', {
      result: result === 'timeout' ? 'error' : result === 'busy' ? 'fresh' : result, candidates: candidates.length, ms: Date.now() - started,
    });
  } catch { /* ignore */ }
  return result;
}

// ── learn ───────────────────────────────────────────────────────────────────

export interface LearnSignal {
  host: string; gameId: string; streamId: number; name: string; cat: string; source: 'play' | 'wrong' | 'pick';
}
const SENT_KEY = 'smc-gdai-sent';

/** One quiet signal, once a day per game, channel and kind. Never waits, never throws. */
export function sendLearn(s: LearnSignal): void {
  try {
    if (!aiAllowed() || flagOff() || !s.host || !s.gameId || !(s.streamId > 0)) return;
    const day = today();
    const k = `${day}|${s.source}|${s.gameId}|${s.host}|${s.streamId}`;
    const sent = (readJson<string[]>('local', SENT_KEY) ?? []).filter((x) => typeof x === 'string' && x.startsWith(`${day}|`));
    if (sent.includes(k)) return;
    writeJson('local', SENT_KEY, [...sent, k].slice(-200));
    void call({
      op: 'learn', host: s.host, game_id: s.gameId, stream_id: s.streamId,
      // The category the way Game Day compares it, so "US| SPORTS" and "us sports" count as one.
      name: String(s.name ?? '').trim().slice(0, 80), cat: normCat(s.cat).slice(0, 40), source: s.source, device_id: getDeviceId(),
    });
  } catch { /* ignore */ }
}

// ── "Not this game" ─────────────────────────────────────────────────────────

const WRONG_KEY = 'smc-gdai-wrong';
const wrongId = (gameId: string, host: string, streamId: number) => `${gameId}|${host}|${streamId}`;

/** The found channels viewers on this box said are not the game (kept for the day). */
export function wrongLinks(): Set<string> {
  const day = today();
  const list = readJson<Array<[string, string]>>('local', WRONG_KEY) ?? [];
  return new Set(list.filter((x) => Array.isArray(x) && x[0] === day).map((x) => x[1]));
}
export const isWrongLink = (set: Set<string>, gameId: string, host: string, streamId: number): boolean =>
  set.size > 0 && set.has(wrongId(gameId, host, streamId));

/** "Not this game": off this box's list at once, and a 'wrong' signal. */
export function markWrong(game: Pick<Game, 'id' | 'league'>, link: { line: { host: string }; stream: { stream_id: number; name: string } }, cat = ''): void {
  try {
    const host = hostOf(link.line.host);
    const day = today();
    const list = (readJson<Array<[string, string]>>('local', WRONG_KEY) ?? []).filter((x) => Array.isArray(x) && x[0] === day);
    list.push([day, wrongId(game.id, host, link.stream.stream_id)]);
    writeJson('local', WRONG_KEY, list.slice(-200));
    sendLearn({ host, gameId: game.id, streamId: link.stream.stream_id, name: link.stream.name, cat, source: 'wrong' });
    trackEvent('gameday_ai_wrong', 'player', { league: game.league });
  } catch { /* ignore */ }
}

/** A found channel played from a game's list. */
export function trackAiPlay(league: string, confidence: 'high' | 'medium'): void {
  try { trackEvent('gameday_ai_play', 'player', { league, confidence }); } catch { /* ignore */ }
}

// ── the miss, and what Live TV plays next ──────────────────────────────────

const MISS_KEY = 'smc-gameday-miss';
interface Miss { gameId: string; league: string; until: number; tokens: string[] }

/** A game's list closed with nothing to watch: remember it this session
 *  (until four hours after its start) with its teams' words. */
export function rememberMiss(game: Pick<Game, 'id' | 'league' | 'start'>, tokens: string[]): void {
  try {
    if (!aiAllowed() || flagOff()) return;
    const words = [...new Set(tokens.map((t) => normCat(t)).filter((t) => t.length >= 3))].slice(0, 24);
    if (!words.length) return;
    const now = Date.now();
    const start = Date.parse(game.start);
    const until = (Number.isFinite(start) ? Math.max(start, now) : now) + 4 * 60 * 60_000;
    const kept = (readJson<Miss[]>('session', MISS_KEY) ?? []).filter((m) => m && m.until > now && m.gameId !== game.id);
    writeJson('session', MISS_KEY, [...kept, { gameId: game.id, league: game.league, until, tokens: words }].slice(-6));
  } catch { /* ignore */ }
}

/** Live TV played a channel for six seconds: if a game whose list came up
 *  empty is still on and the channel's name or category shares a word with
 *  its teams, tell the server ('play'). */
export function noteLivePlay(line: { host: string }, stream: { stream_id: number; name: string }, catName: string): void {
  try {
    if (!aiAllowed() || flagOff()) return;
    const now = Date.now();
    const misses = (readJson<Miss[]>('session', MISS_KEY) ?? []).filter((m) => m && m.until > now && Array.isArray(m.tokens));
    if (!misses.length) return;
    const text = ` ${normCat(stream.name)} ${normCat(catName)} `;
    const miss = misses.find((m) => sharesToken(text, m.tokens));
    if (!miss) return;
    sendLearn({ host: hostOf(line.host), gameId: miss.gameId, streamId: Number(stream.stream_id), name: stream.name, cat: catName, source: 'play' });
  } catch { /* ignore */ }
}

/** Tests only. */
export function __resetGameDayAiForTests(): void { cachedInflight.clear(); }
