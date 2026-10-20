// Settings › Add another service › Test: try an outside service before it is
// saved (lib/outsideSource). Apart from outsideSource.ts because it needs the
// Xtream client, and the client's own imports reach outsideSource.ts: kept
// here, nothing imports this but the settings page, so there is no cycle.
//
// Straight to the service, never through Snow Media's servers.
import { countLiveStreams, getLiveCategories } from '@/lib/xtream';
import { directGet } from '@/lib/directHttp';
import { lineIsActive, outsideCreds, parseOutsideInput, type OutsideInput, type OutsideSource } from '@/lib/outsideSource';

/** Why a test failed, for the screen to say in plain words. */
export type OutsideTestError = 'wrongLogin' | 'unreachable' | 'notPlaylist' | 'empty' | 'inactive' | 'tooBig';
/** `source`: what worked, to be saved as it is (its server may have moved, or it became an M3U link). */
export type OutsideTestResult = { ok: true; channels: number; source: OutsideSource } | { ok: false; error: OutsideTestError };

type Failure = { error: OutsideTestError; blocked: boolean };

const failure = (e: unknown, m3u: boolean): Failure => {
  const err = e as { name?: string; reason?: string; status?: unknown } | null;
  if (err?.name === 'M3uError') return { error: err.reason === 'too_big' ? 'tooBig' : 'notPlaylist', blocked: false };
  if (typeof err?.status === 'number') {
    if (err.status === 401) return { error: 'wrongLogin', blocked: false };
    // 403 / 451: a login refused, or the API blocked in front of the panel.
    if (err.status === 403 || err.status === 451) return { error: 'wrongLogin', blocked: true };
    if (err.status === 404) return { error: m3u ? 'notPlaylist' : 'unreachable', blocked: true };
  }
  // No answer, or not JSON (a block page): blocked as far as we can tell.
  return { error: 'unreachable', blocked: true };
};

/**
 * Sign in to an Xtream service, following its redirects by hand (an http
 * server that moved to https: lib/directHttp). When it answers from another
 * address, the service is saved with that one, so its lists and streams go
 * there directly.
 */
async function signIn(src: OutsideSource): Promise<{ source: OutsideSource } | Failure> {
  const c = outsideCreds(src);
  const url = new URL(`${c.host}/player_api.php`);
  url.searchParams.set('username', c.username);
  url.searchParams.set('password', c.password);
  let res;
  try {
    res = await directGet(url.toString(), { responseType: 'json', timeoutMs: 15000 });
  } catch (e) {
    return failure(e, false);
  }
  let info: unknown = res.data;
  if (typeof info === 'string') {
    try { info = JSON.parse(info); } catch { return { error: 'unreachable', blocked: true }; }
  }
  const ui = (info as { user_info?: { auth?: unknown; status?: unknown; exp_date?: unknown } } | null)?.user_info;
  const auth = ui?.auth;
  if (!(auth === 1 || auth === '1' || auth === true)) return { error: 'wrongLogin', blocked: false };
  if (!lineIsActive({ status: String(ui?.status ?? ''), expDate: Number(ui?.exp_date) || null })) return { error: 'inactive', blocked: false };
  let moved = src;
  try {
    const final = new URL(res.url);
    const host = `${final.origin}${final.pathname.replace(/\/player_api\.php$/i, '').replace(/\/+$/, '')}`;
    if (host && host !== src.host) moved = { ...src, host };
  } catch { /* keep the typed one */ }
  return { source: moved };
}

/** Load the categories and count the live channels (xtream.ts sees `outside`: never the list proxy). */
async function count(src: OutsideSource): Promise<OutsideTestResult | Failure> {
  const c = outsideCreds(src);
  try {
    await getLiveCategories(c);
    const { total } = await countLiveStreams(c);
    if (!total) return { error: 'empty', blocked: false };
    return { ok: true, channels: total, source: src };
  } catch (e) {
    return failure(e, !!c.m3u);
  }
}

async function tryOne(src: OutsideSource): Promise<OutsideTestResult | Failure> {
  if (src.kind === 'xtream') {
    const signed = await signIn(src);
    if ('error' in signed) return signed;
    return count(signed.source);
  }
  return count(src);
}

/**
 * Sign in (Xtream) or read the playlist (M3U), then load the categories and
 * count the live channels. `input`: what was typed, so an Xtream get.php
 * link whose API is blocked or unreachable is tried again as the M3U link it
 * also is. Never throws.
 */
export async function testOutsideSource(src: OutsideSource, input?: OutsideInput): Promise<OutsideTestResult> {
  const first = await tryOne(src);
  if ('ok' in first) return first;
  if (first.blocked && src.kind === 'xtream' && input?.kind === 'm3u' && input.url) {
    const asLink = parseOutsideInput(input, src.addedAt, { asM3u: true });
    if (asLink.ok) {
      const second = await tryOne(asLink.source);
      if ('ok' in second) return second;
      return { ok: false, error: second.error };
    }
  }
  return { ok: false, error: first.error };
}
