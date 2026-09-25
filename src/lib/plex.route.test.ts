// Which address SMC settles on for a Plex server. The first address to answer
// /identity is not always the best one for video: a custom address (a reverse
// proxy or a CDN-fronted domain) can answer that tiny request first and still
// be slow for a whole film, where the server's own *.plex.direct address goes
// straight to it. These pin the ranking, the waits behind it, which addresses
// are tried at all, which of them get the token, IPv6 URLs and the labels.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Not native: plexReq goes through fetch, which each test scripts per URL.
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false }, CapacitorHttp: {} }));

import {
  getPlexServers, pickPlexConnectionDetailed, pickBetterPlexConnection, plexRouteLabel,
  plexRouteImprovable, plexRouteOf, PLEX_PROBE_TIMEOUT_MS,
  type PlexConnection, type PlexServer,
} from './plex';

// How a URL answers: after `ms` as server `id`, never (until the probe gives
// up), or refused at once. Anything unscripted is refused.
type Plan = { ms: number; id?: string } | 'hang';
let plans: Record<string, Plan> = {};
let calls: string[] = [];
// The headers each URL was last asked with.
let sent: Record<string, Record<string, string>> = {};

beforeEach(() => {
  vi.useFakeTimers();
  plans = {};
  calls = [];
  sent = {};
  vi.stubGlobal('fetch', (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => {
    calls.push(url);
    sent[url] = init?.headers ?? {};
    const plan = plans[url];
    return new Promise((resolve, reject) => {
      if (!plan) { reject(new TypeError('Failed to fetch')); return; }
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      if (plan === 'hang') return;
      setTimeout(() => resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ MediaContainer: { machineIdentifier: plan.id ?? 'p2' } }),
      }), plan.ms);
    });
  });
});
afterEach(async () => {
  // Let every hung probe time out so none is shared into the next test.
  await vi.advanceTimersByTimeAsync(30_000);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const identity = (base: string) => `${base}/identity`;
const answer = (base: string, ms: number, id?: string) => { plans[identity(base)] = { ms, id }; };
const hang = (base: string) => { plans[identity(base)] = 'hang'; };

/** Follows a promise without awaiting it, so a test can look mid-race. */
function track<T>(p: Promise<T>) {
  const s: { done: boolean; value?: T } = { done: false };
  void p.then((v) => { s.done = true; s.value = v; });
  return s;
}

/** Starts a probe and waits until its requests are on the wire. plexReq loads
 *  @capacitor/core before each fetch, and that import settles in real time,
 *  not on the fake clock: a test that moved the clock straight away had its
 *  scripted answers start late, and failed now and then. */
async function start<T>(p: Promise<T>) {
  const s = track(p);
  await vi.dynamicImportSettled();
  return s;
}

const conn = (uri: string, address: string, extra: Partial<PlexConnection> = {}): PlexConnection => ({
  uri, address, port: Number(/:(\d+)$/.exec(uri)?.[1] || 32400), local: false, relay: false,
  protocol: uri.slice(0, 5) === 'https' ? 'https' : 'http', ...extra,
});
const server = (connections: PlexConnection[]): PlexServer =>
  ({ name: 'Snow Media P2', clientIdentifier: 'p2', accessToken: 'srv-tok', owned: false, connections });

const PD = 'https://203-0-113-5.abc123.plex.direct:32400';
const PD_HTTP = 'http://203.0.113.5:32400';
const PD6 = 'https://2001-db8-0-0-0-0-0-5.abc123.plex.direct:32400';
const PD6_HTTP = 'http://[2001:db8::5]:32400';
const CUSTOM = 'https://plex.example.com:443';
const RELAY = 'https://198-51-100-7.abc123.plex.direct:8443';
const LAN = 'https://192-168-1-20.abc123.plex.direct:32400';
const LAN_HTTP = 'http://192.168.1.20:32400';
const ULA = 'https://fd12-3456-789a-1-0-0-0-5.abc123.plex.direct:32400';
const ULA_HTTP = 'http://[fd12:3456:789a:1::5]:32400';

const P2 = server([
  conn(LAN, '192.168.1.20', { local: true }),
  conn(PD, '203.0.113.5'),
  conn(PD6, '2001:db8::5', { ipv6: true }),
  conn(CUSTOM, 'plex.example.com'),
  conn(RELAY, '198.51.100.7', { relay: true }),
]);

describe('getPlexServers', () => {
  it('asks plex.tv for IPv6 paths too and keeps the flag on each one', async () => {
    vi.useRealTimers();
    const body = [{
      name: 'Snow Media P2', clientIdentifier: 'p2', accessToken: 'srv-tok', provides: 'server',
      connections: [
        { uri: PD, address: '203.0.113.5', port: 32400, protocol: 'https', local: false, relay: false, IPv6: false },
        { uri: PD6, address: '2001:db8::5', port: 32400, protocol: 'https', local: false, relay: false, IPv6: true },
      ],
    }];
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    });
    const [s] = await getPlexServers('ipv6-account', { fresh: true });
    expect(seen[0]).toMatch(/^https:\/\/plex\.tv\/api\/v2\/resources\?/);
    expect(seen[0]).toContain('includeIPv6=1');
    expect(seen[0]).toContain('includeRelay=1');
    expect(s.connections.map((c) => !!c.ipv6)).toEqual([false, true]);
    vi.useFakeTimers();
  });
});

describe('pickPlexConnectionDetailed', () => {
  it('gives each remote candidate about six seconds', () => {
    expect(PLEX_PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(6000);
  });

  it('holds a custom address that answers first until plex.direct has answered, and takes plex.direct', async () => {
    const s = server([conn(CUSTOM, 'plex.example.com'), conn(PD, '203.0.113.5')]);
    answer(CUSTOM, 50);
    answer(PD, 3000);
    const r = await start(pickPlexConnectionDetailed(s));
    await vi.advanceTimersByTimeAsync(1500);
    expect(r.done).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(r.value).toEqual({ base: PD, route: 'direct' });
  });

  it('falls back to the custom address only once plex.direct has had its whole budget', async () => {
    const s = server([conn(CUSTOM, 'plex.example.com'), conn(PD, '203.0.113.5')]);
    answer(CUSTOM, 50);
    hang(PD);
    const r = await start(pickPlexConnectionDetailed(s));
    await vi.advanceTimersByTimeAsync(5000);
    expect(r.done).toBe(false);
    await vi.advanceTimersByTimeAsync(2500);
    expect(r.value).toEqual({ base: CUSTOM, route: 'direct' });
  });

  it('takes the custom address at once when plex.direct is refused outright', async () => {
    const s = server([conn(CUSTOM, 'plex.example.com'), conn(PD, '203.0.113.5')]);
    answer(CUSTOM, 50);
    const r = await start(pickPlexConnectionDetailed(s));
    await vi.advanceTimersByTimeAsync(100);
    expect(r.value).toEqual({ base: CUSTOM, route: 'direct' });
  });

  it('waits for https before taking the plain http twin', async () => {
    const s = server([conn(PD, '203.0.113.5')]);
    answer(PD_HTTP, 20);
    answer(PD, 4000);
    const r = await start(pickPlexConnectionDetailed(s));
    await vi.advanceTimersByTimeAsync(3000);
    expect(r.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    expect(r.value).toEqual({ base: PD, route: 'direct' });
  });

  it('never lets the relay win while a direct path can still answer, even a slow one', async () => {
    const s = server([conn(RELAY, '198.51.100.7', { relay: true }), conn(PD, '203.0.113.5')]);
    answer(RELAY, 30);
    // Past the old 3.5 s window, inside the new one.
    answer(PD, 5000);
    const r = await start(pickPlexConnectionDetailed(s));
    await vi.advanceTimersByTimeAsync(4000);
    expect(r.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    expect(r.value).toEqual({ base: PD, route: 'direct' });
  });

  it('uses the relay when no direct path answers', async () => {
    const s = server([conn(RELAY, '198.51.100.7', { relay: true }), conn(PD, '203.0.113.5')]);
    answer(RELAY, 30);
    const r = await start(pickPlexConnectionDetailed(s));
    await vi.advanceTimersByTimeAsync(200);
    expect(r.value).toEqual({ base: RELAY, route: 'relay' });
  });

  it('prefers IPv4 over IPv6 on plex.direct, and IPv6 plex.direct over a custom address', async () => {
    answer(PD6, 20);
    answer(CUSTOM, 10);
    answer(PD, 2000);
    const both = await start(pickPlexConnectionDetailed(P2, PLEX_PROBE_TIMEOUT_MS, { noRelay: true }));
    await vi.advanceTimersByTimeAsync(2100);
    expect(both.value).toEqual({ base: PD, route: 'direct' });

    await vi.advanceTimersByTimeAsync(30_000);
    plans = {};
    answer(PD6, 20);
    answer(CUSTOM, 10);
    const v6 = await start(pickPlexConnectionDetailed(P2, PLEX_PROBE_TIMEOUT_MS, { noRelay: true }));
    await vi.advanceTimersByTimeAsync(100);
    expect(v6.value).toEqual({ base: PD6, route: 'direct' });
  });

  it('builds a bracketed URL for an IPv6 address and skips link-local ones', async () => {
    const s = server([
      conn(PD6, '2001:db8::5', { ipv6: true }),
      conn('https://fe80-0-0-0-0-0-0-1.abc123.plex.direct:32400', 'fe80::1', { ipv6: true }),
    ]);
    answer(PD6_HTTP, 20);
    const r = await start(pickPlexConnectionDetailed(s));
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toContain(identity(PD6_HTTP));
    expect(calls.some((u) => u.indexOf('http://2001:db8') === 0)).toBe(false);
    expect(calls.some((u) => /fe80/i.test(u))).toBe(false);
    expect(r.value).toEqual({ base: PD6_HTTP, route: 'direct' });
  });

  it('ignores a different Plex server answering on an address this one lists', async () => {
    // P2's LAN address is taken by the viewer's own server at home.
    answer(LAN, 20, 'someone-elses-server');
    answer(PD, 300);
    const r = await start(pickPlexConnectionDetailed(P2, PLEX_PROBE_TIMEOUT_MS, { noRelay: true }));
    await vi.advanceTimersByTimeAsync(400);
    expect(r.value).toEqual({ base: PD, route: 'direct' });
  });

  // Somebody typed these in as a custom access URL because they work for them:
  // a Tailscale or other CGNAT-range address, a VPN's 172.16 one.
  it.each([
    ['a Tailscale / CGNAT address', 'http://100.101.102.103:32400', '100.101.102.103'],
    ['a 172.16/12 address', 'https://172.20.0.5:32400', '172.20.0.5'],
  ])('tries a custom access URL written as %s', async (_what, uri, address) => {
    const s = server([conn(uri, address)]);
    answer(uri, 30);
    const r = await start(pickPlexConnectionDetailed(s));
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toContain(identity(uri));
    expect(r.value).toEqual({ base: uri, route: 'direct' });
  });

  it('still skips a plex.direct name, and an http twin, for a docker or CGNAT address', async () => {
    const DOCKER = 'https://172-17-0-2.abc123.plex.direct:32400';
    const CGNAT = 'https://100-64-0-9.abc123.plex.direct:32400';
    const s = server([
      conn(DOCKER, '172.17.0.2', { local: true }),
      conn(CGNAT, '100.64.0.9'),
      conn(PD, '203.0.113.5'),
    ]);
    answer(PD, 30);
    const r = await start(pickPlexConnectionDetailed(s));
    await vi.advanceTimersByTimeAsync(100);
    expect(r.value).toEqual({ base: PD, route: 'direct' });
    expect(calls.some((u) => /172[.-]17|100[.-]64/.test(u))).toBe(false);
  });

  it('does not count a global IPv6 address marked local as the home network', async () => {
    // A hosted server lists its public IPv6 interface address as local.
    const s = server([
      conn(PD6, '2001:db8::5', { local: true, ipv6: true }),
      conn(PD, '203.0.113.5'),
    ]);
    answer(PD6, 20);
    answer(PD, 1000);
    const r = await start(pickPlexConnectionDetailed(s));
    // The IPv6 path answered first, but ranks below IPv4 on the same route.
    await vi.advanceTimersByTimeAsync(500);
    expect(r.done).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(r.value).toEqual({ base: PD, route: 'direct' });
  });

  it('gives a global IPv6 address marked local the full remote budget', async () => {
    const s = server([conn(PD6, '2001:db8::5', { local: true, ipv6: true })]);
    // Past the 2.5 s window a home-network address gets.
    answer(PD6, 4000);
    const r = await start(pickPlexConnectionDetailed(s));
    await vi.advanceTimersByTimeAsync(4100);
    expect(r.value).toEqual({ base: PD6, route: 'direct' });
  });

  it('counts a unique-local IPv6 address (fc00::/7) as the home network', async () => {
    const s = server([
      conn(ULA, 'fd12:3456:789a:1::5', { local: true, ipv6: true }),
      conn(PD, '203.0.113.5'),
    ]);
    answer(ULA, 20);
    answer(PD, 20);
    const r = await start(pickPlexConnectionDetailed(s));
    await vi.advanceTimersByTimeAsync(100);
    expect(r.value).toEqual({ base: ULA, route: 'lan' });
  });

  it('keeps the longer budget for an address listed both as remote and as local', async () => {
    const s = server([conn(PD, '203.0.113.5'), conn(PD, '203.0.113.5', { local: true })]);
    answer(PD, 4000);
    const r = await start(pickPlexConnectionDetailed(s));
    await vi.advanceTimersByTimeAsync(3000);
    expect(r.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    expect(r.value).toEqual({ base: PD, route: 'lan' });
  });
});

describe('the token on a probe', () => {
  const tokenOn = (base: string) => sent[identity(base)]?.['X-Plex-Token'];

  it('goes to https addresses only: never in the clear to an http one', async () => {
    answer(LAN, 300);
    answer(LAN_HTTP, 20);
    answer(PD, 20);
    answer(PD_HTTP, 20);
    answer(RELAY, 20);
    const r = await start(pickPlexConnectionDetailed(P2));
    await vi.advanceTimersByTimeAsync(400);
    for (const https of [LAN, PD, PD6, CUSTOM, RELAY]) {
      expect(calls).toContain(identity(https));
      expect(tokenOn(https)).toBe('srv-tok');
    }
    for (const http of [LAN_HTTP, PD_HTTP, PD6_HTTP]) {
      expect(calls).toContain(identity(http));
      expect(sent[identity(http)]).not.toHaveProperty('X-Plex-Token');
    }
    // Who is asking still goes with every probe.
    expect(sent[identity(LAN_HTTP)]['X-Plex-Client-Identifier']).toBeTruthy();
    expect(r.value).toEqual({ base: LAN, route: 'lan' });
  });

  it('still takes an http address that answered without it', async () => {
    const s = server([conn('http://203.0.113.5:32400', '203.0.113.5')]);
    answer(PD_HTTP, 20);
    const r = await start(pickPlexConnectionDetailed(s));
    await vi.advanceTimersByTimeAsync(100);
    expect(sent[identity(PD_HTTP)]).not.toHaveProperty('X-Plex-Token');
    expect(r.value).toEqual({ base: PD_HTTP, route: 'direct' });
  });
});

describe('pickBetterPlexConnection', () => {
  it('moves a custom address to plex.direct, probing only what ranks higher', async () => {
    answer(PD, 500);
    answer(CUSTOM, 10);
    const r = await start(pickBetterPlexConnection(P2, { base: CUSTOM, route: 'direct' }));
    await vi.advanceTimersByTimeAsync(600);
    expect(r.value).toEqual({ base: PD, route: 'direct' });
    expect(calls).not.toContain(identity(CUSTOM));
    expect(calls).not.toContain(identity(RELAY));
    // A remote server's LAN addresses belong to someone else's network.
    expect(calls).not.toContain(identity(LAN));
  });

  it('answers null at once, with no network, when nothing ranks higher', async () => {
    const onlyCustom = server([conn(CUSTOM, 'plex.example.com')]);
    const r = track(pickBetterPlexConnection(onlyCustom, { base: CUSTOM, route: 'direct' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(r).toEqual({ done: true, value: null });
    expect(calls).toEqual([]);
  });

  it('never walks an https base back to plain http', async () => {
    answer(PD_HTTP, 10);
    const r = await start(pickBetterPlexConnection(P2, { base: CUSTOM, route: 'direct' }));
    await vi.advanceTimersByTimeAsync(8000);
    expect(r.value).toBeNull();
    expect(calls).not.toContain(identity(PD_HTTP));
  });

  it('moves a plain http base to https', async () => {
    answer(PD, 100);
    const r = await start(pickBetterPlexConnection(P2, { base: PD_HTTP, route: 'direct' }));
    await vi.advanceTimersByTimeAsync(200);
    expect(r.value).toEqual({ base: PD, route: 'direct' });
  });

  it('takes any direct path off the relay, http included', async () => {
    answer(PD_HTTP, 10);
    const r = await start(pickBetterPlexConnection(P2, { base: RELAY, route: 'relay' }));
    await vi.advanceTimersByTimeAsync(8000);
    expect(r.value).toEqual({ base: PD_HTTP, route: 'direct' });
    expect(sent[identity(PD_HTTP)]).not.toHaveProperty('X-Plex-Token');
    expect(sent[identity(PD)]['X-Plex-Token']).toBe('srv-tok');
  });
});

describe('plexRouteImprovable / plexRouteOf', () => {
  it('re-tests every kind of base short of https on plex.direct over IPv4', () => {
    expect(plexRouteImprovable('direct', PD)).toBe(false);
    expect(plexRouteImprovable('lan', LAN)).toBe(false);
    expect(plexRouteImprovable('direct', CUSTOM)).toBe(true);
    expect(plexRouteImprovable('direct', PD_HTTP)).toBe(true);
    expect(plexRouteImprovable('direct', PD6)).toBe(true);
    expect(plexRouteImprovable('relay', RELAY)).toBe(true);
  });

  it('knows the route of an http twin, IPv6 included', () => {
    expect(plexRouteOf(P2, PD_HTTP)).toBe('direct');
    expect(plexRouteOf(P2, PD6_HTTP)).toBe('direct');
    expect(plexRouteOf(P2, RELAY)).toBe('relay');
  });

  it('calls a local IPv6 address the home network only when it is unique-local', () => {
    const s = server([
      conn(PD6, '2001:db8::5', { local: true, ipv6: true }),
      conn(ULA, 'fd12:3456:789a:1::5', { local: true, ipv6: true }),
      conn(LAN, '192.168.1.20', { local: true }),
    ]);
    expect(plexRouteOf(s, PD6)).toBe('direct');
    expect(plexRouteOf(s, PD6_HTTP)).toBe('direct');
    expect(plexRouteOf(s, ULA)).toBe('lan');
    expect(plexRouteOf(s, ULA_HTTP)).toBe('lan');
    expect(plexRouteOf(s, LAN)).toBe('lan');
    // A server list from before the IPv6 flag was kept: the address says.
    const old = server([conn(PD6, '2001:db8::5', { local: true })]);
    expect(plexRouteOf(old, PD6)).toBe('direct');
  });

  it('gives an address listed twice the route a fresh probe gives it', async () => {
    // Remote first, then local: the first listing is not the one that counts.
    const s = server([conn(PD, '203.0.113.5'), conn(PD, '203.0.113.5', { local: true })]);
    expect(plexRouteOf(s, PD)).toBe('lan');
    expect(plexRouteOf(s, PD_HTTP)).toBe('lan');
    expect(plexRouteOf(s, `${PD.toUpperCase()}/`)).toBe('lan');
    answer(PD, 20);
    const r = await start(pickPlexConnectionDetailed(s));
    await vi.advanceTimersByTimeAsync(100);
    expect(r.value).toEqual({ base: PD, route: plexRouteOf(s, PD) });

    // Local first, then remote: the same.
    const flipped = server([conn(PD, '203.0.113.5', { local: true }), conn(PD, '203.0.113.5')]);
    expect(plexRouteOf(flipped, PD)).toBe('lan');
  });

  it('gives an http address listed remote, and the twin of a local one, the home-network route', () => {
    const s = server([conn(LAN_HTTP, '192.168.1.20'), conn(LAN, '192.168.1.20', { local: true })]);
    expect(plexRouteOf(s, LAN_HTTP)).toBe('lan');
    expect(plexRouteOf(s, LAN)).toBe('lan');
  });

  it('knows no route for an address the probe never tries', () => {
    const DOCKER = 'https://172-17-0-2.abc123.plex.direct:32400';
    const s = server([conn(DOCKER, '172.17.0.2', { local: true }), conn(PD, '203.0.113.5')]);
    expect(plexRouteOf(s, DOCKER)).toBeNull();
    expect(plexRouteOf(s, 'http://172.17.0.2:32400')).toBeNull();
    expect(plexRouteOf(s, 'https://elsewhere.example.com')).toBeNull();
  });
});

describe('plexRouteLabel', () => {
  it('names the kind of address in use', () => {
    expect(plexRouteLabel('direct', PD)).toBe('Direct to server · plex.direct · https');
    expect(plexRouteLabel('direct', CUSTOM)).toBe('Direct to server · custom address (plex.example.com) · https');
    expect(plexRouteLabel('direct', PD_HTTP)).toBe('Direct to server · IP · http (unencrypted)');
    expect(plexRouteLabel('lan', LAN)).toBe('Home network · plex.direct · https');
    expect(plexRouteLabel('relay', RELAY)).toBe('Plex Relay (speed-capped by Plex)');
    expect(plexRouteLabel(undefined, PD)).toBe('Unknown route · plex.direct · https');
  });

  it('says IPv6 when the address is one', () => {
    expect(plexRouteLabel('direct', PD6)).toBe('Direct to server · plex.direct · https · IPv6');
    expect(plexRouteLabel('direct', PD6_HTTP)).toBe('Direct to server · IP · http (unencrypted) · IPv6');
  });

  it('shows nothing past the host name', () => {
    const label = plexRouteLabel('direct', 'https://user:secret@plex.example.com:8443/web?X-Plex-Token=abc123');
    expect(label).toBe('Direct to server · custom address (plex.example.com) · https');
    expect(label).not.toMatch(/secret|abc123|Token|8443/);
  });
});
