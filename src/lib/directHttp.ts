// Straight-to-the-provider requests for an outside service (lib/outsideSource):
// its playlist (lib/m3u) and the Test's sign-in (lib/outsideProbe). Never
// through Snow Media's servers.
//
// Redirects are followed here, by hand, up to MAX_HOPS: on the box
// CapacitorHttp runs on Android's HttpURLConnection, which does not follow a
// redirect from http to https (or back), and providers move their playlists
// to https behind exactly such a redirect. A relative Location counts from
// the address that sent it. On the web, fetch follows them itself.
//
// Never log what goes through here: the addresses carry the provider's login.
import { XtreamHttpError } from '@/lib/xtreamListProxy';

export const MAX_HOPS = 5;

export interface DirectResponse {
  status: number;
  data: unknown;
  /** The address that answered, after any redirects. */
  url: string;
  /** Header names in lowercase. */
  headers: Record<string, string>;
}

const lower = (h: Record<string, unknown> | null | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h ?? {})) if (v != null) out[k.toLowerCase()] = String(v);
  return out;
};

const isRedirect = (s: number) => s === 301 || s === 302 || s === 303 || s === 307 || s === 308;

async function isNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform?.() === true;
  } catch { return false; }
}

/**
 * One request, its redirects followed. A non-2xx answer (after redirects) is
 * thrown as XtreamHttpError, as the Xtream client does; so is a redirect loop
 * longer than MAX_HOPS (as a 310, "too many redirects").
 */
export async function directGet(
  url: string,
  opts: { method?: 'GET' | 'HEAD'; responseType?: 'text' | 'json'; timeoutMs?: number; accept?: string } = {},
): Promise<DirectResponse> {
  const method = opts.method ?? 'GET';
  const timeoutMs = opts.timeoutMs ?? 20000;
  const accept = opts.accept ?? (opts.responseType === 'json' ? 'application/json' : '*/*');
  if (await isNative()) {
    const { CapacitorHttp } = await import('@capacitor/core');
    let at = url;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const res = await CapacitorHttp.request({
        url: at,
        method,
        headers: { Accept: accept },
        responseType: opts.responseType === 'json' ? 'json' : 'text',
        connectTimeout: Math.min(timeoutMs, 15000),
        readTimeout: timeoutMs,
        disableRedirects: true,
      });
      const headers = lower(res.headers as Record<string, unknown>);
      if (isRedirect(res.status) && headers.location) {
        at = new URL(headers.location, at).toString();
        continue;
      }
      if (res.status < 200 || res.status >= 300) throw new XtreamHttpError(res.status);
      return { status: res.status, data: res.data, url: at, headers };
    }
    throw new XtreamHttpError(310);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, headers: { Accept: accept }, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw new XtreamHttpError(r.status);
    const headers: Record<string, string> = {};
    r.headers?.forEach?.((v, k) => { headers[k.toLowerCase()] = v; });
    const data = method === 'HEAD' ? '' : opts.responseType === 'json' ? await r.json() : await r.text();
    return { status: r.status, data, url: r.url || url, headers };
  } finally {
    clearTimeout(t);
  }
}

/**
 * How big the answer at `url` says it is (Content-Length of a HEAD), or null
 * when the server doesn't say (or refuses HEAD). Never throws.
 */
export async function contentLength(url: string, timeoutMs = 8000): Promise<number | null> {
  try {
    const res = await directGet(url, { method: 'HEAD', timeoutMs });
    const n = Number(res.headers['content-length']);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
