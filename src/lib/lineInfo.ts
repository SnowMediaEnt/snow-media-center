// The Live TV line(s) a ticket or a channel report is about, for the support
// desk: the username, the service, and how many of the line's connections
// are in use right now. Staff text, so English, e.g.
//   Line: jsmith (DreamStreams) · connections 2/3 · expires 2026-12-01
//   Line: jsmith (DreamStreams) · connections unknown
//
// What goes out is the username, the service name, the counts and the
// expiry, nothing else: never the password, the host address or a stream
// URL (the password is only used to ask the panel, inside xtream.ts).
// Never in analytics (the owner's rule: line_active alone carries the line).
//
// The counts are asked of the panel (player_api.php user_info) at the moment
// of sending, at most ~3 s; an answer under a minute old is reused. A slow or
// failed answer gives "connections unknown": a ticket is never held up.
import { isDemo } from '@/lib/demoMode';
import {
  SERVERS,
  authenticate,
  loadCreds,
  loadPlayerAccount,
  loadSavedAccounts,
  serverDisplayName,
  type XtreamCreds,
  type XtreamUserInfo,
} from '@/lib/xtream';

export const LINE_FETCH_TIMEOUT_MS = 3000;
export const LINE_FRESH_MS = 60_000;
/** Saved lines listed when none is in use. */
const MAX_LINES = 4;

export interface LineStatus {
  username: string;
  /** The service as the viewer knows it ("DreamStreams", "Vibez"), or null. */
  service: string | null;
  /** In use now / allowed; null when the panel did not say in time. */
  active: number | null;
  max: number | null;
  /** Unix seconds; null when unknown or a lifetime line. */
  expDate: number | null;
}

type Counts = Pick<LineStatus, 'active' | 'max' | 'expDate'>;
const cache = new Map<string, { at: number; counts: Counts }>();
const keyOf = (c: Pick<XtreamCreds, 'host' | 'username'>) =>
  `${c.host.trim().toLowerCase().replace(/\/+$/, '')}|${c.username.trim().toLowerCase()}`;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const serviceOf = (c: Pick<XtreamCreds, 'host' | 'serverLabel'>): string | null => {
  const host = c.host.trim().toLowerCase().replace(/\/+$/, '');
  const label = c.serverLabel || SERVERS.find((s) => s.host.toLowerCase() === host)?.label;
  return label ? serverDisplayName(label) : null;
};

const UNKNOWN: Counts = { active: null, max: null, expDate: null };

/** The line's counts: a recent answer, else the panel's, else unknown. Never throws, never waits past the timeout. */
export async function lineCounts(c: XtreamCreds, timeoutMs = LINE_FETCH_TIMEOUT_MS): Promise<Counts> {
  if (isDemo()) return UNKNOWN;
  const k = keyOf(c);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < LINE_FRESH_MS) return hit.counts;
  // The sign-in check keeps the main line's own answer: reuse it when fresh.
  try {
    const acc = await loadPlayerAccount();
    if (acc && keyOf(acc) === k && Date.now() - (acc.lastCheckedAt || 0) < LINE_FRESH_MS && acc.maxConnections != null) {
      const counts = { active: acc.activeCons, max: acc.maxConnections, expDate: acc.expDate };
      cache.set(k, { at: acc.lastCheckedAt, counts });
      return counts;
    }
  } catch { /* ask the panel */ }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const info = await Promise.race([
      authenticate(c) as Promise<{ user_info?: XtreamUserInfo } | null>,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    const ui = info?.user_info;
    if (!ui) return UNKNOWN;
    const counts = { active: num(ui.active_cons), max: num(ui.max_connections), expDate: num(ui.exp_date) };
    cache.set(k, { at: Date.now(), counts });
    return counts;
  } catch {
    return UNKNOWN;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One line's status: username, service and counts. */
export async function lineStatus(c: XtreamCreds, timeoutMs = LINE_FETCH_TIMEOUT_MS): Promise<LineStatus> {
  const counts = await lineCounts(c, timeoutMs);
  return { username: c.username.trim(), service: serviceOf(c), ...counts };
}

/** The line in use, or every saved line (a few) when none is. */
export async function currentLines(): Promise<XtreamCreds[]> {
  if (isDemo()) return [];
  try {
    const cur = await loadCreds();
    if (cur?.host && cur.username) return [cur];
  } catch { /* the saved ones */ }
  try {
    const saved = await loadSavedAccounts();
    const seen = new Set<string>();
    const out: XtreamCreds[] = [];
    for (const s of saved) {
      if (!s?.host || !s.username || seen.has(keyOf(s))) continue;
      seen.add(keyOf(s));
      out.push({ host: s.host, username: s.username, password: s.password, output: s.output, serverLabel: s.serverLabel });
      if (out.length >= MAX_LINES) break;
    }
    return out;
  } catch {
    return [];
  }
}

const ymd = (unixSec: number): string => {
  const d = new Date(unixSec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

/** "Line: jsmith (DreamStreams) · connections 2/3 · expires 2026-12-01". */
export function formatLine(s: LineStatus): string {
  const who = s.service ? `${s.username} (${s.service})` : s.username;
  const cons = s.active != null && s.max != null
    ? `connections ${s.active}/${s.max}`
    : s.active != null ? `connections ${s.active}/?` : 'connections unknown';
  const parts = [`Line: ${who}`, cons];
  if (s.expDate != null && s.expDate > 0) parts.push(`expires ${ymd(s.expDate)}`);
  return parts.join(' · ');
}

/** The "Line: …" lines for a ticket ('' when the box has no line). Never throws. */
export async function buildLineInfoLines(timeoutMs = LINE_FETCH_TIMEOUT_MS): Promise<string> {
  try {
    const lines = await currentLines();
    if (!lines.length) return '';
    const all = await Promise.all(lines.map((l) => lineStatus(l, timeoutMs)));
    return all.map(formatLine).join('\n');
  } catch {
    return '';
  }
}

/** The fields a channel or category report carries to the server for the Hub. */
export async function lineReportFields(c: XtreamCreds | null | undefined): Promise<{ line_user: string; active_cons: number | null; max_cons: number | null } | null> {
  if (!c?.username) return null;
  try {
    const s = await lineStatus(c);
    return { line_user: s.username.slice(0, 100), active_cons: s.active, max_cons: s.max };
  } catch {
    return { line_user: c.username.trim().slice(0, 100), active_cons: null, max_cons: null };
  }
}

/** Tests only. */
export function __resetLineInfoForTests(): void { cache.clear(); }
