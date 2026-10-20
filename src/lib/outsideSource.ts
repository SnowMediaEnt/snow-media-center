// "Add another service" (Live TV › Settings): ONE service a viewer buys
// somewhere else, whose Live TV channels then show in Snow Media Center beside
// their DreamStreams / Vibez channels.
//
// THE RULE (owner): only a viewer with an active DreamStreams or Vibez line
// may have one (outsideAllowed below), and the service belongs to the line
// that added it (its `owner`): it shows only while that line is the one in
// use or one of the box's saved accounts, and signing out of that line takes
// it away (lib/outsideActions). When the line in use expires, is disabled or
// banned, the panel refuses its login, or it hasn't been checked for
// STALE_MS, the outside channels disappear and come back once it is fine
// again; the saved service is kept, not deleted.
//
// What an outside service is NOT:
//   • a saved account: it has its own storage key, so it never shows in
//     Switch Account and never becomes the active line (the active line
//     drives Movies, Series, the account screen, billing and renewals);
//   • ours to support or proxy: nothing about it — host, login, playlist
//     address, channel addresses — is ever sent to Snow Media's servers. Its
//     lists go straight to it (never through the list proxy), its favourites
//     stay on the box, it is left out of channel status, reports, watch-
//     history sync, and analytics names it only as 'outside'. isOutsideLine /
//     isOutsideHost / lineEventProps / scrubOutside below are what those
//     places ask.
//
// Two kinds: an Xtream login (server + username + password: categories and a
// guide, like ours) or an M3U link (a playlist, lib/m3u). An Xtream-style M3U
// link (…/get.php?username=U&password=P…) is turned into an Xtream login,
// which gets the categories and the guide (lib/outsideProbe falls back to the
// link when that service's API is blocked).
//
// No runtime imports but lib/servers and lib/hash32 (neither imports
// anything): analytics, the list proxy and channel status import this, and
// xtream.ts imports them.
import { hash32 } from '@/lib/hash32';
import { SERVERS, hostNameOf, isOurHost, withScheme } from '@/lib/servers';
import type { PlayerAccount, SavedAccount, XtreamCreds } from '@/lib/xtream';

/** How many outside services a viewer may add. One for now (owner, 2026-10-20). */
export const MAX_OUTSIDE_SOURCES = 1;

/** A line not checked with its panel for this long doesn't carry an outside service until it is. */
export const STALE_MS = 3 * 24 * 60 * 60 * 1000;

/** Fired after an outside service is saved or removed: Live TV re-reads its lines. */
export const OUTSIDE_SOURCES_EVENT = 'outsideSourcesRefresh';

const STORE_KEY = 'snow-livetv-outside-sources-v1';
const REFUSED_KEY = 'snow-outside-line-refused-v1';

export type OutsideKind = 'xtream' | 'm3u';

export interface OutsideSource {
  /** Stable: the server + username, or the playlist address (hashed). */
  id: string;
  kind: OutsideKind;
  /** What the viewer called it: the name of its group in Live TV. */
  name: string;
  /** Xtream: the server (no trailing slash), username and password. */
  host?: string;
  username?: string;
  password?: string;
  /** M3U: the playlist's address. */
  url?: string;
  /** The line that added it (lineOwnerKey): it lives and dies with that line on this box. */
  owner?: string;
  addedAt: number;
}

// ── small helpers ──────────────────────────────────────────────────────────

/** An address's fingerprint: hash32 as 8 hex digits (service ids, an M3U line's key). */
const fnv = (s: string): string => hash32(s).toString(16).padStart(8, '0');

const originOf = (url: string): string => {
  try { return new URL(url).origin; } catch { return ''; }
};

/** Which of our lines this is, port and scheme aside: the owner of an outside service. */
export const lineOwnerKey = (c: Pick<XtreamCreds, 'host' | 'username'> | null | undefined): string =>
  c ? `${hostNameOf(c.host)}|${String(c.username ?? '').trim().toLowerCase()}` : '';

const sameLine = (a: Pick<XtreamCreds, 'host' | 'username'>, b: Pick<XtreamCreds, 'host' | 'username'>): boolean =>
  lineOwnerKey(a) === lineOwnerKey(b);

// ── storage ────────────────────────────────────────────────────────────────

const sanitize = (raw: unknown): OutsideSource[] => {
  if (!Array.isArray(raw)) return [];
  const out: OutsideSource[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const s = v as Partial<OutsideSource>;
    if (typeof s.id !== 'string' || (s.kind !== 'xtream' && s.kind !== 'm3u') || typeof s.name !== 'string') continue;
    if (s.kind === 'xtream' && !(s.host && s.username && s.password)) continue;
    if (s.kind === 'm3u' && !s.url) continue;
    // Never one of ours, whatever is in storage.
    if (isOurHost(s.kind === 'xtream' ? s.host : s.url)) continue;
    out.push({
      id: s.id,
      kind: s.kind,
      name: s.name,
      ...(s.kind === 'xtream' ? { host: s.host, username: s.username, password: s.password } : { url: s.url }),
      ...(typeof s.owner === 'string' && s.owner ? { owner: s.owner } : {}),
      addedAt: typeof s.addedAt === 'number' ? s.addedAt : 0,
    });
  }
  return out;
};

const parseStored = (raw: string | null | undefined): OutsideSource[] => {
  if (!raw) return [];
  try { return sanitize(JSON.parse(raw)); } catch { return []; }
};

// The synchronous view, for the places that must decide on the spot whether
// something is outside (analytics, channel status, the list proxy). Read from
// localStorage, which every save writes; parsed again only when it changed.
let memoRaw: string | null | undefined;
let memoList: OutsideSource[] = [];
const known = (): OutsideSource[] => {
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch { /* no storage: nothing known */ }
  if (raw !== memoRaw) { memoRaw = raw; memoList = parseStored(raw); }
  return memoList;
};

/** The saved outside services (Capacitor Preferences first, localStorage as the fallback). */
export async function loadOutsideSources(): Promise<OutsideSource[]> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: STORE_KEY });
    if (value) {
      // The synchronous view reads localStorage: keep it in step when only
      // Preferences survived (the WebView's storage was cleared).
      try { if (localStorage.getItem(STORE_KEY) !== value) localStorage.setItem(STORE_KEY, value); } catch { /* ignore */ }
      return parseStored(value);
    }
  } catch { /* not native */ }
  return known();
}

async function writeSources(list: OutsideSource[]): Promise<void> {
  const json = JSON.stringify(list);
  try {
    const { Preferences } = await import('@capacitor/preferences');
    if (list.length) await Preferences.set({ key: STORE_KEY, value: json });
    else await Preferences.remove({ key: STORE_KEY });
  } catch { /* not native */ }
  try {
    if (list.length) localStorage.setItem(STORE_KEY, json);
    else localStorage.removeItem(STORE_KEY);
  } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(OUTSIDE_SOURCES_EVENT)); } catch { /* ignore */ }
}

/**
 * Save a service, owned by `owner` (the line in use): in place of
 * `replaceId` (Edit), or as a new one when there is room
 * (MAX_OUTSIDE_SOURCES). False when there was no room, it is ours, or no
 * owner was given.
 */
export async function saveOutsideSource(src: OutsideSource, owner: Pick<XtreamCreds, 'host' | 'username'>, replaceId?: string): Promise<boolean> {
  if (isOurHost(src.kind === 'xtream' ? src.host : src.url)) return false;
  const ownerKey = lineOwnerKey(owner);
  if (!ownerKey || !isOurHost(owner.host)) return false;
  const list = (await loadOutsideSources()).filter((s) => s.id !== replaceId && s.id !== src.id);
  if (list.length >= MAX_OUTSIDE_SOURCES) return false;
  await writeSources([...list, { ...src, owner: ownerKey }]);
  return true;
}

/** Take a service off the list (lib/outsideActions also clears what the box kept for it). */
export async function removeOutsideSource(id: string): Promise<void> {
  const list = await loadOutsideSources();
  await writeSources(list.filter((s) => s.id !== id));
}

// ── what the viewer typed → a service ──────────────────────────────────────

export interface OutsideInput {
  kind: OutsideKind;
  /** Xtream: the server address ("provider.tv:8080" or a full address). */
  server?: string;
  username?: string;
  password?: string;
  /** M3U: the playlist address. */
  url?: string;
  /** Left empty: the host name. */
  name?: string;
}

/** Why the form can't be used yet: the screen says it in plain words. */
export type OutsideInputError = 'needServer' | 'needLogin' | 'needUrl' | 'badUrl' | 'ours' | 'nameTaken';

/**
 * A query string's values, read by hand: URLSearchParams turns "+" into a
 * space, and a "+" in a provider's password is a "+". Only %XX is decoded.
 */
const queryValues = (search: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const part of search.replace(/^\?/, '').split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = eq >= 0 ? part.slice(0, eq) : part;
    const v = eq >= 0 ? part.slice(eq + 1) : '';
    let key = k; let val = v;
    try { key = decodeURIComponent(k); } catch { /* as it is */ }
    try { val = decodeURIComponent(v); } catch { /* as it is */ }
    if (!out.has(key.toLowerCase())) out.set(key.toLowerCase(), val);
  }
  return out;
};

/** An Xtream panel's own pages: its M3U link (get.php) and its API (player_api.php). */
const PANEL_PAGE = /\/(get|player_api)\.php$/i;

/** The panel's base address: the origin and path, without get.php / player_api.php or a trailing slash. */
const panelBase = (u: URL): string => `${u.origin}${u.pathname.replace(PANEL_PAGE, '').replace(/\/+$/, '')}`;

/**
 * An Xtream panel's M3U link (…/get.php?username=U&password=P&type=m3u…,
 * or its player_api.php) as the login it carries; null for any other link.
 */
export function xtreamFromM3uLink(link: string): { host: string; username: string; password: string } | null {
  let u: URL;
  try { u = new URL(withScheme(link.trim())); } catch { return null; }
  if (!PANEL_PAGE.test(u.pathname)) return null;
  const q = queryValues(u.search);
  const username = (q.get('username') ?? '').trim();
  const password = (q.get('password') ?? '').trim();
  if (!username || !password) return null;
  return { host: panelBase(u), username, password };
}

/** A typed Xtream server as the base the API is asked at: a scheme, no trailing slash or /player_api.php. */
const serverBase = (typed: string): string => {
  let u: URL;
  try { u = new URL(withScheme(typed.trim())); } catch { return ''; }
  if (!u.hostname) return '';
  return panelBase(u);
};

const isOurName = (name: string): boolean => {
  const n = name.trim().toLowerCase();
  return SERVERS.some((s) => s.label.toLowerCase() === n) || n === 'dreamstreams' || n === 'vibez';
};

/**
 * Check what the viewer typed and make the service from it (not saved). A
 * pasted Xtream M3U link — in either kind's field — becomes an Xtream login,
 * unless `asM3u` (the Test's fallback when that service's API is blocked).
 */
export function parseOutsideInput(
  input: OutsideInput,
  now = Date.now(),
  opts: { asM3u?: boolean } = {},
): { ok: true; source: OutsideSource } | { ok: false; error: OutsideInputError } {
  const typedName = (input.name ?? '').trim();
  if (typedName && isOurName(typedName)) return { ok: false, error: 'nameTaken' };

  let kind = input.kind;
  let host = '';
  let username = (input.username ?? '').trim();
  let password = (input.password ?? '').trim();
  let url = '';

  if (kind === 'm3u') {
    const link = (input.url ?? '').trim();
    if (!link) return { ok: false, error: 'needUrl' };
    const x = opts.asM3u ? null : xtreamFromM3uLink(link);
    if (x) {
      kind = 'xtream';
      ({ host, username, password } = x);
    } else {
      try {
        const u = new URL(withScheme(link));
        if (!/^https?:$/.test(u.protocol) || !u.hostname) return { ok: false, error: 'badUrl' };
        url = u.toString();
      } catch {
        return { ok: false, error: 'badUrl' };
      }
    }
  } else {
    const typed = (input.server ?? '').trim();
    if (!typed) return { ok: false, error: 'needServer' };
    const x = xtreamFromM3uLink(typed);
    if (x) {
      ({ host } = x);
      username = username || x.username;
      password = password || x.password;
    } else {
      host = serverBase(typed);
      if (!host) return { ok: false, error: 'badUrl' };
    }
    if (!username || !password) return { ok: false, error: 'needLogin' };
  }

  const where = kind === 'xtream' ? host : url;
  if (isOurHost(where)) return { ok: false, error: 'ours' };
  const name = (typedName || hostNameOf(where)).slice(0, 40);
  const id = kind === 'xtream'
    ? `x:${hostNameOf(host)}|${username.toLowerCase()}`
    : `m:${fnv(url)}`;
  return {
    ok: true,
    source: kind === 'xtream'
      ? { id, kind, name, host, username, password, addedAt: now }
      : { id, kind, name, url, addedAt: now },
  };
}

// ── as a Live TV line ──────────────────────────────────────────────────────

/**
 * The service as a line Live TV can show. An M3U link has no login: its
 * "host" is the playlist's origin and its "username" a fingerprint of the
 * address, only so the line has a key of its own (favourites, hidden
 * categories, folded groups) — neither is ever used to reach anything.
 */
export function outsideCreds(src: OutsideSource): XtreamCreds {
  if (src.kind === 'm3u') {
    const url = src.url ?? '';
    return { host: originOf(url), username: `m3u-${fnv(url)}`, password: '', output: 'm3u8', serverLabel: src.name, outside: true, m3u: url };
  }
  return { host: src.host ?? '', username: src.username ?? '', password: src.password ?? '', output: 'm3u8', serverLabel: src.name, outside: true };
}

// ── the gate ───────────────────────────────────────────────────────────────

const INACTIVE = new Set(['expired', 'disabled', 'banned']);

/**
 * Is the line still running? The rule the app already uses: the panel's own
 * status says expired / disabled / banned (authenticateRouted refuses those),
 * or its end date has passed (ExpirationNoticeDialog's "expired"; exact time
 * here rather than whole days, so the outside channels go when ours stop).
 * No end date (expDate null) is a line without one.
 */
export function lineIsActive(acc: Pick<PlayerAccount, 'status' | 'expDate'>, now = Date.now()): boolean {
  if (INACTIVE.has(String(acc.status ?? '').trim().toLowerCase())) return false;
  const exp = acc.expDate;
  if (exp == null || !Number.isFinite(exp) || exp <= 0) return true;
  return Math.floor(exp) * 1000 > now;
}

// The panel said the line's login is wrong (a background check: LiveTV's
// reconcile, usePlayerAccountSync). The account record is not rewritten then
// (it keeps the last good answer), so the refusal is kept here, by line, and
// stands until a later check saves the record again (lastCheckedAt newer).
const readRefused = (): Record<string, number> => {
  try {
    const o = JSON.parse(localStorage.getItem(REFUSED_KEY) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o as Record<string, number> : {};
  } catch { return {}; }
};

/** A background check found the line's login refused by its panel. */
export function markLineRefused(line: Pick<XtreamCreds, 'host' | 'username'>, at = Date.now()): void {
  const k = lineOwnerKey(line);
  if (!k) return;
  try { localStorage.setItem(REFUSED_KEY, JSON.stringify({ ...readRefused(), [k]: at })); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(OUTSIDE_SOURCES_EVENT)); } catch { /* ignore */ }
}

const refusedSinceLastCheck = (active: Pick<XtreamCreds, 'host' | 'username'>, account: PlayerAccount): boolean => {
  const at = readRefused()[lineOwnerKey(active)];
  return typeof at === 'number' && at >= (Number(account.lastCheckedAt) || 0);
};

/** The account record was last checked with the panel too long ago to vouch for the line. */
export const accountStale = (account: Pick<PlayerAccount, 'lastCheckedAt'> | null | undefined, now = Date.now()): boolean =>
  !account || !(Number(account.lastCheckedAt) > 0) || now - Number(account.lastCheckedAt) > STALE_MS;

/**
 * May this box show (and add) an outside service? Only while the line in use
 * is a DreamStreams or Vibez line, its account record is that line's, the
 * line is active, the panel has not refused its login since, and it was
 * checked with the panel within STALE_MS. `account` is loadPlayerAccount()'s
 * record.
 */
export function outsideAllowed(
  active: XtreamCreds | null | undefined,
  account: PlayerAccount | null | undefined,
  now = Date.now(),
): boolean {
  if (!active || active.outside || !isOurHost(active.host)) return false;
  if (!account || !isOurHost(account.host) || !sameLine(account, active)) return false;
  if (accountStale(account, now) || refusedSinceLastCheck(active, account)) return false;
  return lineIsActive(account, now);
}

/** Is the line that added `src` on this box: the one in use, or a saved account? */
export function ownerOnBox(
  src: Pick<OutsideSource, 'owner'>,
  active: Pick<XtreamCreds, 'host' | 'username'> | null | undefined,
  saved: ReadonlyArray<Pick<SavedAccount, 'host' | 'username'>> = [],
): boolean {
  if (!src.owner) return false;
  return src.owner === lineOwnerKey(active) || saved.some((a) => lineOwnerKey(a) === src.owner);
}

/** The saved services and the account record, for buildLines (lib/liveLines). */
export interface OutsideState {
  sources: OutsideSource[];
  account: PlayerAccount | null;
}

/**
 * Read both. The account record comes from `loadAccount` (xtream.ts's
 * loadPlayerAccount: passed in, as this file must not import the client), and
 * is read only when there is a service to show. Never throws.
 */
export async function loadOutsideState(loadAccount: () => Promise<PlayerAccount | null>): Promise<OutsideState> {
  try {
    const sources = await loadOutsideSources();
    if (!sources.length) return { sources, account: null };
    return { sources, account: await loadAccount() };
  } catch {
    return { sources: [], account: null };
  }
}

/** The lines to add after the saved accounts: none unless outsideAllowed, and each only with its owner line on the box. */
export function outsideLinesFor(
  active: XtreamCreds | null | undefined,
  state: OutsideState | null | undefined,
  saved: ReadonlyArray<Pick<SavedAccount, 'host' | 'username'>> = [],
  now = Date.now(),
): XtreamCreds[] {
  if (!state?.sources.length || !outsideAllowed(active, state.account, now)) return [];
  return state.sources.filter((s) => ownerOnBox(s, active, saved)).slice(0, MAX_OUTSIDE_SOURCES).map(outsideCreds);
}

/**
 * When the answer of outsideLinesFor would next change on its own, with no
 * event: the line's end date, or the moment its last check grows stale.
 * Live TV sets a timer for it. Null when nothing is due.
 */
export function outsideFlipAt(state: OutsideState | null | undefined, now = Date.now()): number | null {
  const acc = state?.account;
  if (!state?.sources.length || !acc) return null;
  const times: number[] = [];
  const exp = Number(acc.expDate);
  if (Number.isFinite(exp) && exp > 0 && exp * 1000 > now) times.push(Math.floor(exp) * 1000);
  const checked = Number(acc.lastCheckedAt);
  if (checked > 0 && checked + STALE_MS > now) times.push(checked + STALE_MS);
  return times.length ? Math.min(...times) : null;
}

// ── is this outside? (the places that must never send it to us) ───────────

/** The host names of the saved outside services (Xtream server, or the playlist's host). */
const outsideHostNames = (): string[] => {
  const out: string[] = [];
  for (const s of known()) {
    const h = hostNameOf(s.kind === 'xtream' ? s.host : s.url);
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
};

/** Is this host (or any address on it) one of the saved outside services'? Never one of ours. */
export function isOutsideHost(urlOrHost: string | null | undefined): boolean {
  const h = hostNameOf(urlOrHost);
  if (!h || isOurHost(h)) return false;
  return outsideHostNames().includes(h);
}

/** Is this line an outside service's? The flag, or (a copy that lost it) its host. */
export function isOutsideLine(c: { host?: string | null; outside?: boolean | null; m3u?: string | null } | null | undefined): boolean {
  if (!c) return false;
  if (c.outside || c.m3u) return true;
  return isOutsideHost(c.host);
}

/**
 * Analytics params about a channel, a category or a line: for an outside
 * service only `server: 'outside'` and the `safe` ones (kinds, counts,
 * reasons), never a channel, category or service name.
 */
export function lineEventProps(
  line: { host?: string | null; outside?: boolean | null; m3u?: string | null } | null | undefined,
  safe: Record<string, unknown>,
  named: Record<string, unknown>,
): Record<string, unknown> {
  return isOutsideLine(line) ? { ...safe, server: 'outside' } : { ...safe, ...named };
}

// The hosts an outside playlist's entries play from (often a CDN, not the
// playlist's own host): lib/m3u notes them as it reads one, so analytics
// never carries them either. For the app's lifetime; never sent anywhere.
const streamHosts = new Set<string>();
export function noteOutsideStreamHosts(hosts: Iterable<string>): void {
  for (const h of hosts) {
    const name = hostNameOf(h);
    if (name && !isOurHost(name)) streamHosts.add(name);
  }
}

/** Matches `secret` as a whole word (not inside a longer one), case aside. */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (secret: string): RegExp => new RegExp('(^|[^a-z0-9])' + escapeRe(secret.toLowerCase()) + '($|[^a-z0-9])');

/**
 * Analytics: an event about an outside channel may say `server: 'outside'`,
 * never which service. Every string in it — nested objects and arrays too —
 * that carries an outside service's host (or a host its playlist plays from)
 * or playlist address, or its name, username or password as a word (those
 * only from 4 characters: shorter ones would hit ordinary words), becomes
 * 'outside'. Case doesn't matter. Returns the same object when there is
 * nothing to change. Call sites tag their own params too (lineEventProps).
 */
export function scrubOutside<T>(props: T): T {
  const list = known();
  if (!props || (!list.length && !streamHosts.size)) return props;
  const words: RegExp[] = [];
  const inside: string[] = [];
  for (const s of list) {
    for (const v of [s.name, s.username, s.password]) {
      const w = (v ?? '').trim();
      if (w.length >= 4) words.push(wordRe(w));
    }
    if (s.url) inside.push(s.url.toLowerCase());
  }
  const hosts = [...new Set([...outsideHostNames(), ...streamHosts])];
  const hit = (v: string): boolean => {
    const low = v.toLowerCase();
    return hosts.some((h) => low.includes(h)) || inside.some((u) => low.includes(u)) || words.some((re) => re.test(low));
  };
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return v && hit(v) ? 'outside' : v;
    if (depth > 6 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => { const y = walk(x, depth + 1); if (y !== x) changed = true; return y; });
      return changed ? out : v;
    }
    let out: Record<string, unknown> | null = null;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const y = walk(x, depth + 1);
      if (y !== x) { out = out ?? { ...(v as Record<string, unknown>) }; out[k] = y; }
    }
    return out ?? v;
  };
  return walk(props, 0) as T;
}

/** Tests only. */
export function __resetOutsideForTests(): void { memoRaw = undefined; memoList = []; streamHosts.clear(); }
