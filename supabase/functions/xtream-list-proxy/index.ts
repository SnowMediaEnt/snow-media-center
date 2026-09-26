// Xtream List Proxy — relays the Player's player_api.php JSON reads (category
// and channel lists, EPG, VOD/series info, the account info call) to the
// provider panel from Snow Media's server.
//
// Why: some ISPs block the box's player_api.php requests to the panel while
// the panel's streams still play (same host, so not a DNS block — the list
// requests themselves are filtered). The Player tries the panel directly
// first, exactly as before, and only when that looks blocked retries the SAME
// read through here (src/lib/xtream.ts). Streams are never relayed.
//
// Not an open proxy:
// - only the provider hosts player-login already trusts (ALLOWED_HOSTS below),
//   matched on scheme + host + port with no path, query or userinfo;
// - only GET player_api.php with the read actions SMC uses, each with its own
//   fixed set of parameters (values limited to [A-Za-z0-9_.-]);
// - redirects are followed by hand, and only to another allowed host.
// Nothing here is privileged: the caller must already hold a working line
// (username + password) for the panel to answer with anything useful.
//
// Auth: verify_jwt = false (supabase/config.toml), like player-login, which
// the Player calls the same way (supabase.functions.invoke with the anon key)
// and which works before the box is signed into any Snow Media account.
// Live TV lists must load for a line whether or not that sign-in happened.
//
// Answers:
// - panel answered 2xx with JSON  -> that JSON, unchanged, with its status;
// - panel answered anything else  -> HTTP 200 { ok:false, reason:'panel_status', status }
//   (in the body, so a gateway error such as the function not being deployed
//   can never be mistaken for the panel's own 401/429);
// - refused or failed             -> HTTP 200 { ok:false, reason } like player-login.
//
// Never logged: username, password, or any panel URL (it carries both).

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Copied from supabase/functions/player-login/index.ts (ALLOWED_HOSTS), not
// imported: player-login is kept a single file so it can be pasted into the
// dashboard editor as one unit. src/test/edge/xtreamListProxy.test.ts fails
// if the two lists ever differ — change both together.
export const ALLOWED_HOSTS = ['dstreams.xyz:8080', 'dstreams.xyz:2083', 'strmz.xyz'] as const;

const MAX_BODY_BYTES = 4096;
// A big line-up's get_live_streams is several MB; this is a ceiling, not a target.
const MAX_RESPONSE_BYTES = 48 * 1024 * 1024;
// The whole panel exchange (headers + body). The Player waits a little longer.
const PANEL_TIMEOUT_MS = 40_000;
const MAX_REDIRECTS = 3;
// What the app's own native HTTP sends (see player-login's PANEL_AGENTS):
// panels behind a media-player allowlist accept it.
const PANEL_AGENT = 'Dalvik/2.1.0 (Linux; U; Android 9; AFTMM Build/PS7233)';

// Read actions SMC uses (src/lib/xtream.ts), and the parameters each may carry.
// '' is the account info call (no action). `_` is the Player's cache-buster.
const ACTIONS: Record<string, { optional: string[]; required: string[] }> = {
  '': { optional: [], required: [] },
  get_live_categories: { optional: [], required: [] },
  get_vod_categories: { optional: [], required: [] },
  get_series_categories: { optional: [], required: [] },
  get_live_streams: { optional: ['category_id'], required: [] },
  get_vod_streams: { optional: ['category_id'], required: [] },
  get_series: { optional: ['category_id'], required: [] },
  get_vod_info: { optional: [], required: ['vod_id'] },
  get_series_info: { optional: [], required: ['series_id'] },
  get_short_epg: { optional: ['limit'], required: ['stream_id'] },
};
const PARAM_VALUE = /^[A-Za-z0-9_.-]{1,64}$/;

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** `scheme://host[:port]` of an allowed panel, or null. No path, query, userinfo. */
function allowedBase(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== '/' && u.pathname !== '') return null;
  const host = u.host.toLowerCase();
  if (!(ALLOWED_HOSTS as readonly string[]).includes(host)) return null;
  return `${u.protocol}//${host}`;
}

export type CheckResult = { ok: true; url: string; action: string } | { ok: false; reason: string };

/** Validate a request body and build the panel URL. Pure: no I/O. */
export function checkRequest(body: unknown): CheckResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const base = allowedBase(b.host);
  if (!base) return { ok: false, reason: 'host_not_allowed' };

  const action = b.action == null ? '' : b.action;
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
    return { ok: false, reason: 'action_not_allowed' };
  }
  if (b.action === '') return { ok: false, reason: 'action_not_allowed' };

  const username = typeof b.username === 'string' ? b.username : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!username || username.length > 256 || !password || password.length > 512) {
    return { ok: false, reason: 'bad_credentials' };
  }

  const rule = ACTIONS[action];
  const rawParams = b.params == null ? {} : b.params;
  if (typeof rawParams !== 'object' || Array.isArray(rawParams)) return { ok: false, reason: 'bad_params' };
  const params: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(rawParams as Record<string, unknown>)) {
    if (k !== '_' && !rule.optional.includes(k) && !rule.required.includes(k)) return { ok: false, reason: 'bad_params' };
    if (typeof v !== 'string' && typeof v !== 'number') return { ok: false, reason: 'bad_params' };
    const s = String(v);
    if (!PARAM_VALUE.test(s)) return { ok: false, reason: 'bad_params' };
    params.push([k, s]);
  }
  for (const k of rule.required) if (!params.some(([p]) => p === k)) return { ok: false, reason: 'bad_params' };

  const url = new URL(`${base}/player_api.php`);
  url.searchParams.set('username', username);
  url.searchParams.set('password', password);
  if (action) url.searchParams.set('action', action);
  for (const [k, v] of params) url.searchParams.set(k, v);
  return { ok: true, url: url.toString(), action };
}

/** The same request on the redirect target, if that target is an allowed panel. */
function redirectTarget(from: string, location: string | null): string | null {
  if (!location) return null;
  let to: URL;
  try { to = new URL(location, from); } catch { return null; }
  if (to.username || to.password) return null;
  const base = allowedBase(`${to.protocol}//${to.host}`);
  if (!base || to.pathname !== '/player_api.php') return null;
  // Keep our own query: a redirect must not change what is asked.
  return `${base}/player_api.php${new URL(from).search}`;
}

/** Read the body up to the cap. null when it is larger. */
async function readCapped(res: Response): Promise<Uint8Array[] | null> {
  const declared = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return null;
  }
  const chunks: Uint8Array[] = [];
  if (!res.body) return chunks;
  const reader = res.body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return null;
    }
    chunks.push(value);
  }
  return chunks;
}

/** First non-whitespace byte starts a JSON object or array. */
function looksLikeJson(chunks: Uint8Array[]): boolean {
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const b = c[i];
      if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0xef || b === 0xbb || b === 0xbf) continue;
      return b === 0x7b /* { */ || b === 0x5b /* [ */;
    }
  }
  return false;
}

async function relay(url: string, action: string): Promise<Response> {
  const label = action || 'account_info';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PANEL_TIMEOUT_MS);
  try {
    let target = url;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      try {
        res = await fetch(target, {
          method: 'GET',
          redirect: 'manual',
          signal: ctrl.signal,
          headers: { 'User-Agent': PANEL_AGENT, Accept: 'application/json' },
        });
      } catch {
        const reason = ctrl.signal.aborted ? 'panel_timeout' : 'panel_unreachable';
        console.warn(`[xtream-list-proxy] ${label}: ${reason}`);
        return jsonResponse({ ok: false, reason });
      }
      if (res.status < 300 || res.status >= 400) break;
      const next = hop < MAX_REDIRECTS ? redirectTarget(target, res.headers.get('Location')) : null;
      try { await res.body?.cancel(); } catch { /* ignore */ }
      if (!next) {
        console.warn(`[xtream-list-proxy] ${label}: redirect not followed (${res.status})`);
        return jsonResponse({ ok: false, reason: 'panel_redirect' });
      }
      target = next;
    }
    if (!res) return jsonResponse({ ok: false, reason: 'panel_unreachable' });

    if (res.status < 200 || res.status >= 300) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return jsonResponse({ ok: false, reason: 'panel_status', status: res.status });
    }
    let chunks: Uint8Array[] | null;
    try {
      chunks = await readCapped(res);
    } catch {
      const reason = ctrl.signal.aborted ? 'panel_timeout' : 'panel_unreachable';
      console.warn(`[xtream-list-proxy] ${label}: ${reason} while reading`);
      return jsonResponse({ ok: false, reason });
    }
    if (!chunks) {
      console.warn(`[xtream-list-proxy] ${label}: larger than ${MAX_RESPONSE_BYTES} bytes`);
      return jsonResponse({ ok: false, reason: 'too_large' });
    }
    // An HTML page is a gateway talking, never the panel answering.
    if (!looksLikeJson(chunks)) return jsonResponse({ ok: false, reason: 'not_json' });
    // Handed back chunk by chunk: no second copy of a multi-MB list.
    const body = new ReadableStream<Uint8Array>({
      start(ctl) { for (const c of chunks!) ctl.enqueue(c); ctl.close(); },
    });
    return new Response(body, {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ ok: false, reason: 'method_not_allowed' });
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return jsonResponse({ ok: false, reason: 'body_too_large' });
    let body: unknown;
    try { body = raw ? JSON.parse(raw) : {}; } catch { return jsonResponse({ ok: false, reason: 'bad_json' }); }
    const checked = checkRequest(body);
    if ('reason' in checked) return jsonResponse({ ok: false, reason: checked.reason });
    return await relay(checked.url, checked.action);
  } catch (e) {
    // The error's name only, never its message or the object: a fetch error
    // can echo the panel URL, which carries the credentials.
    console.error('[xtream-list-proxy] unexpected:', e instanceof Error ? e.name : 'error');
    return jsonResponse({ ok: false, reason: 'error' });
  }
});
