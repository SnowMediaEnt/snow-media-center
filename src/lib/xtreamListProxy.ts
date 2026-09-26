// Live TV list reads through Snow Media, for boxes whose ISP blocks the
// provider panel's player_api.php while its streams still play.
//
// xtream.ts asks the panel directly first, exactly as always. Only when that
// fails in a way that looks like a block (see looksBlocked) does it repeat the
// same read through the xtream-list-proxy edge function. A line (panel host)
// whose lists came back that way is remembered for the session, and across a
// restart for 30 minutes after it was last used, so later lists go straight
// to Snow Media instead of waiting out a timeout each time. Streams never go
// through here: they keep their direct URLs.
//
// Never log what passes through here: the URL and body carry the line's
// username and password.

/** A status the panel (or something in front of it) answered with. The
 *  message stays `HTTP <status>`: callers and the UI already read that. */
export class XtreamHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = 'XtreamHttpError';
    this.status = status;
  }
}

/** The proxy itself could not help (refused, unreachable, not deployed). */
class XtreamProxyError extends Error {
  constructor(reason: string) {
    super(`list proxy: ${reason}`);
    this.name = 'XtreamProxyError';
  }
}

/**
 * Does a failed DIRECT request look like the ISP blocking the panel?
 * Yes: no answer at all (network error, timeout, reset, DNS failure, TLS
 * cut), HTTP 403 / 451, or a 200 that is not JSON (an ISP block page).
 * No: any other status the panel gave — a 401 or 429 is its real answer.
 */
export function looksBlocked(e: unknown): boolean {
  if (e instanceof XtreamHttpError) return e.status === 403 || e.status === 451;
  return true;
}

// --- Which lines are blocked -------------------------------------------------

const STORE_KEY = 'smc.xtream.listsViaSnowMedia';
const KEEP_MS = 30 * 60 * 1000;
const TOUCH_MS = 5 * 60 * 1000;
const sessionBlocked = new Set<string>();

const hostOf = (urlOrHost: string): string => {
  try { return new URL(urlOrHost).host.toLowerCase(); } catch { return ''; }
};
const readStore = (): Record<string, number> => {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o as Record<string, number> : {};
  } catch { return {}; }
};
const writeStore = (o: Record<string, number>): void => {
  try {
    const now = Date.now();
    for (const k of Object.keys(o)) if (!(typeof o[k] === 'number' && now - o[k] < KEEP_MS)) delete o[k];
    if (Object.keys(o).length) localStorage.setItem(STORE_KEY, JSON.stringify(o));
    else localStorage.removeItem(STORE_KEY);
  } catch { /* storage unavailable: the session memory still holds */ }
};

/** Is this line's direct list path known to be blocked? `urlOrHost`: the
 *  line's host (`http://panel:8080`) or any URL on it. Diagnostics read it. */
export function listsViaSnowMedia(urlOrHost: string): boolean {
  const host = hostOf(urlOrHost);
  return !!host && isBlocked(host);
}

function isBlocked(host: string): boolean {
  if (sessionBlocked.has(host)) return true;
  const at = readStore()[host];
  if (typeof at === 'number' && Date.now() - at < KEEP_MS) { sessionBlocked.add(host); return true; }
  return false;
}

function rememberBlocked(host: string): void {
  sessionBlocked.add(host);
  const o = readStore();
  if (typeof o[host] === 'number' && Date.now() - o[host] < TOUCH_MS) return;
  o[host] = Date.now();
  writeStore(o);
}

function forgetBlocked(host: string): void {
  sessionBlocked.delete(host);
  const o = readStore();
  if (host in o) { delete o[host]; writeStore(o); }
}

// --- The proxied read ----------------------------------------------------------

/** How much longer than the direct request the proxied one may take. */
const PROXY_EXTRA_MS = 25_000;

type Refusal = { ok: false; reason: string; status?: unknown };
const isRefusal = (d: unknown): d is Refusal =>
  !!d && typeof d === 'object' && !Array.isArray(d)
  && (d as Refusal).ok === false && typeof (d as Refusal).reason === 'string';

/** The same player_api.php read, asked through xtream-list-proxy. Throws
 *  XtreamHttpError for the panel's own non-2xx answer, XtreamProxyError when
 *  the proxy could not get one. */
async function viaProxy<T>(url: string, timeoutMs: number): Promise<T> {
  const u = new URL(url);
  const base = `${u.protocol}//${u.host}${u.pathname.replace(/\/player_api\.php$/, '')}`;
  const params: Record<string, string> = {};
  let action: string | undefined;
  u.searchParams.forEach((v, k) => {
    if (k === 'username' || k === 'password') return;
    if (k === 'action') action = v; else params[k] = v;
  });
  const body = {
    host: base,
    username: u.searchParams.get('username') ?? '',
    password: u.searchParams.get('password') ?? '',
    action,
    params,
  };
  const { supabase } = await import('@/integrations/supabase/client');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new XtreamProxyError('timeout')), timeoutMs + PROXY_EXTRA_MS);
  });
  let res: { data: unknown; error: unknown };
  try {
    res = await Promise.race([supabase.functions.invoke('xtream-list-proxy', { body }), timeout]) as typeof res;
  } catch (e) {
    throw e instanceof XtreamProxyError ? e : new XtreamProxyError('unreachable');
  } finally {
    clearTimeout(timer);
  }
  // Any non-2xx here is the gateway (e.g. not deployed yet), never the panel:
  // the function reports the panel's own status inside a 200.
  if (res.error) throw new XtreamProxyError('gateway');
  const data = res.data;
  if (isRefusal(data)) {
    if (data.reason === 'panel_status' && typeof data.status === 'number') throw new XtreamHttpError(data.status);
    throw new XtreamProxyError(data.reason);
  }
  if (data == null || typeof data !== 'object') throw new XtreamProxyError('not_json');
  return data as T;
}

/**
 * Run a player_api.php read: direct first, Snow Media when direct looks
 * blocked, Snow Media first on a line already known to be blocked. `direct`
 * is the unchanged direct request. Native (the box) only: a web browser's
 * direct request always fails on CORS and is not an ISP block.
 */
export async function withListFallback<T>(
  url: string,
  timeoutMs: number,
  isNative: boolean,
  direct: () => Promise<T>,
): Promise<T> {
  if (!isNative) return direct();
  const host = hostOf(url);
  if (!host) return direct();

  if (isBlocked(host)) {
    try {
      const data = await viaProxy<T>(url, timeoutMs);
      rememberBlocked(host);
      return data;
    } catch (e) {
      // The panel's own answer, relayed: that is the answer.
      if (e instanceof XtreamHttpError) throw e;
    }
    // Snow Media could not help this time: the direct path may be open again.
    const data = await direct();
    forgetBlocked(host);
    return data;
  }

  try {
    return await direct();
  } catch (directErr) {
    if (!looksBlocked(directErr)) throw directErr;
    let data: T;
    try {
      data = await viaProxy<T>(url, timeoutMs);
    } catch (proxyErr) {
      // The panel answered through Snow Media (e.g. 401): pass that on.
      // Otherwise the proxy could not help, and the direct failure stands.
      throw proxyErr instanceof XtreamHttpError ? proxyErr : directErr;
    }
    rememberBlocked(host);
    return data;
  }
}
