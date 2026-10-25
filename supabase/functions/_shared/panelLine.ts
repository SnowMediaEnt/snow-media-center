// One line, asked once on its panel: the same check player-login and
// capture-player-signin run inline (base URLs best first, the agents a
// panel's gateway lets through, decided from the BODY because a gateway's
// HTML 401 is not a wrong password). Used by the sign-in PIN functions:
// signin-pins (a line typed in the hub) and pin-signin (one recheck of a
// line whose stored expiry has passed).
//
// Only the hosts below are ever asked. Nothing here logs the username, the
// password or the URL that carries them.

/** The panel hosts this file may ask, as the CRM stores them (no scheme). */
export const PANEL_HOSTS = new Set(['dstreams.xyz:8080', 'dstreams.xyz:2083', 'strmz.xyz']);

const REQUEST_TIMEOUT_MS = 12_000;
const TOTAL_BUDGET_MS = 20_000;

// Ports a panel is commonly served over TLS on.
const TLS_PORTS = new Set(['443', '2053', '2083', '2087', '2096', '8443']);
// cPanel-style ports serve the panel's login page, not its player API.
const PANEL_ONLY_PORTS = new Set(['2082', '2083', '2086', '2087']);
const STREAM_FALLBACKS: Array<[string, string]> = [
  ['http', '8080'], ['https', '2096'], ['http', '8000'], ['http', '25461'],
];

const PANEL_AGENTS = [
  'Dalvik/2.1.0 (Linux; U; Android 9; AFTMM Build/PS7233)',
  'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/70.0.3538.110 Mobile Safari/537.36',
  'VLC/3.0.20 LibVLC/3.0.20',
  'okhttp/4.12.0',
];

function panelBases(bare: string): string[] {
  const port = /:(\d+)$/.exec(bare)?.[1];
  const first = port ? (TLS_PORTS.has(port) ? 'https' : 'http') : 'https';
  const second = first === 'https' ? 'http' : 'https';
  return [`${first}://${bare}`, `${second}://${bare}`];
}

function candidateBases(bare: string): string[] {
  const out: string[] = [];
  const push = (b: string) => { if (!out.includes(b)) out.push(b); };
  for (const b of panelBases(bare)) push(b);
  const name = bare.replace(/:\d+$/, '');
  const port = /:(\d+)$/.exec(bare)?.[1] ?? '';
  if (name && (!port || PANEL_ONLY_PORTS.has(port))) {
    for (const [scheme, p] of STREAM_FALLBACKS) push(`${scheme}://${name}:${p}`);
  }
  return out;
}

/** A stored host without its scheme or trailing slash, lower-case. */
export const bareHost = (raw: string | null | undefined): string =>
  String(raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

export type PanelVerdict =
  | { kind: 'ok'; userInfo: Record<string, unknown> }
  | { kind: 'auth_failed' }
  | { kind: 'unreachable' };

/**
 * Asks the panel about one line. An expired or disabled line still answers
 * auth 1 with its status. A host outside PANEL_HOSTS is never asked
 * ('unreachable').
 */
export async function verifyPanelLine(host: string, username: string, password: string, tag: string): Promise<PanelVerdict> {
  const bare = bareHost(host);
  if (!PANEL_HOSTS.has(bare)) return { kind: 'unreachable' };
  const query = `/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (const base of candidateBases(bare)) {
    for (const ua of PANEL_AGENTS) {
      if (Date.now() > deadline) break;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      let text: string;
      try {
        const res = await fetch(base + query, { signal: ctrl.signal, headers: { 'User-Agent': ua, Accept: 'application/json' } });
        text = (await res.text()).trim();
      } catch {
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (!text.startsWith('{')) continue;
      let data: unknown;
      try { data = JSON.parse(text); } catch { continue; }
      const ui = (data as { user_info?: Record<string, unknown> } | null)?.user_info;
      if (!ui || typeof ui !== 'object') continue;
      const auth = ui.auth;
      const authed = auth === 1 || auth === '1' || auth === true;
      return authed ? { kind: 'ok', userInfo: ui } : { kind: 'auth_failed' };
    }
  }
  console.warn(`[${tag}] no JSON from any base or agent: wrong host, or a gateway block?`);
  return { kind: 'unreachable' };
}

/** The panel's exp_date (unix seconds) as a time in ms; null = none given (no end). */
export function panelExpiryMs(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '' || raw === 'null') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * 1000;
}

/** A line the panel calls over: expired, disabled or banned, or past its exp_date. */
export function panelSaysOver(userInfo: Record<string, unknown>, now = Date.now()): boolean {
  const status = typeof userInfo.status === 'string' ? userInfo.status.trim().toLowerCase() : '';
  if (status === 'expired' || status === 'disabled' || status === 'banned') return true;
  const exp = panelExpiryMs(userInfo.exp_date);
  return exp !== null && exp <= now;
}
