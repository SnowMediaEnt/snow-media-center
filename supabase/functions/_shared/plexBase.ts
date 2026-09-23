// Which address reaches the Snow Media Plex server from the edge.
//
// PLEX_SERVER_URL is tried first. When it stops answering (a new home IP, a
// changed port, Remote Access flipped), the server's current addresses are
// read from plex.tv with the same PLEX_TOKEN — direct ones first, Plex's
// relay last — and the first that answers is used. The answer is kept for
// ten minutes per warm instance, so a dead secret costs one short probe, not
// a timeout on every call. The token and addresses never leave the server.
const CONFIGURED = (Deno.env.get('PLEX_SERVER_URL') ?? '').replace(/\/+$/, '');
const TOKEN = Deno.env.get('PLEX_TOKEN') ?? '';
const KEEP_MS = 10 * 60_000;

let chosen: { base: string; at: number } | null = null;
let resolving: Promise<string> | null = null;

async function answers(base: string, timeoutMs: number): Promise<boolean> {
  try {
    const r = await fetch(`${base}/identity`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

async function fromPlexTv(): Promise<string[]> {
  try {
    const r = await fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {
      headers: { Accept: 'application/json', 'X-Plex-Token': TOKEN, 'X-Plex-Client-Identifier': 'snow-media-edge', 'X-Plex-Product': 'Snow Media Center' },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return [];
    const list = await r.json() as Array<Record<string, unknown>>;
    const servers = list.filter((d) => String(d.provides ?? '').includes('server'));
    // The configured server if plex.tv still lists an address on its host,
    // else the account's own server.
    const host = (() => { try { return new URL(CONFIGURED).hostname; } catch { return ''; } })();
    const conns = (d: Record<string, unknown>) => (d.connections ?? []) as Array<Record<string, unknown>>;
    const pick = servers.find((d) => host && conns(d).some((c) => String(c.uri ?? '').includes(host) || c.address === host))
      ?? servers.find((d) => d.owned) ?? servers[0];
    if (!pick) return [];
    return conns(pick)
      .filter((c) => !c.local)
      .sort((a, b) => Number(!!a.relay) - Number(!!b.relay))
      .map((c) => String(c.uri ?? '').replace(/\/+$/, ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function resolve(): Promise<string> {
  if (CONFIGURED && await answers(CONFIGURED, 4000)) return CONFIGURED;
  for (const uri of await fromPlexTv()) {
    if (await answers(uri, 5000)) {
      console.warn('[plexBase] PLEX_SERVER_URL is not answering; using the address plex.tv lists for the server instead.');
      return uri;
    }
  }
  return CONFIGURED; // nothing better: let the caller's request fail as before
}

/** The base URL to use for Plex requests right now. */
export async function plexBase(): Promise<string> {
  if (chosen && Date.now() - chosen.at < KEEP_MS) return chosen.base;
  resolving ??= resolve().then((base) => { chosen = { base, at: Date.now() }; return base; }).finally(() => { resolving = null; });
  return await resolving;
}

/** Forget the address after it failed, so the next call looks again. */
export function plexBaseFailed(base: string): void {
  if (chosen?.base === base) chosen = null;
}
