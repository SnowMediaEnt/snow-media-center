// End-of-title playback stats: one analytics event per Plex title played on
// the native player, with what Playback stats would have shown at the end —
// arrival speed (average, slowest, fastest), stalls, restarts, the last error
// and its HTTP status, how the file was read (over several connections, and
// how many at most), and which kind of path the stream took (route, port, IP
// family). So the Hub can compare boxes, routes
// and builds without asking a customer for a photo of the stats panel.
//
// - A title ends when the player closes (the Plex playback flag goes off) or
//   when the next title starts (a new playback session, e.g. Up Next).
// - The stats are read at that moment, before the player is stopped: the
//   flag goes off in an effect cleanup, which React runs before the effect
//   that stops the player, and the bridge answers calls in order.
// - Numbers, code names and the route's kind only: no URL, no host, no token.
//   A title the player never started (no picture, no data) sends nothing.
import { SnowPlayer, type PlayerStats } from '@/capacitor/SnowPlayer';
import { trackEvent } from '@/lib/analytics';
import { isNativePlatform } from '@/utils/platform';
import {
  getPlexCurrentRoute, onPlexPlaybackActiveChange, onPlexPlaybackSession, plexEndpoint, currentPlexPlaybackSession,
  type PlexRoute,
} from '@/lib/plex';

/** The event's name in analytics_events (properties only; no new columns). */
export const PLEX_TITLE_STATS_EVENT = 'plex_title_stats';

const num = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const round = (n: unknown): number | null => { const v = num(n); return v == null ? null : Math.round(v); };

/** The event's properties for one title's final stats, or null when nothing
 *  played (so there is nothing worth reporting). Pure, for tests. */
export function plexTitleStatsProps(
  st: PlayerStats | null | undefined,
  route: { base: string; route?: PlexRoute } | null,
  session: string | null,
): Record<string, unknown> | null {
  if (!st) return null;
  const played = num(st.firstFrameMs) != null || num(st.avgKbps) != null || (num(st.positionSec) ?? 0) > 0;
  if (!played) return null;
  const ep = route ? plexEndpoint(route.base) : null;
  const ext = st as PlayerStats & { arrivalKbps?: number | null; lowRamBox?: boolean };
  return {
    session: session ?? null,
    engine: st.engine ?? null,
    state: st.state ?? null,
    positionSec: round(st.positionSec),
    durationSec: round(st.durationSec),
    firstFrameMs: round(st.firstFrameMs),
    avgKbps: round(st.avgKbps),
    minKbps: round(st.minKbps),
    maxKbps: round(st.maxKbps),
    arrivalKbps: round(ext.arrivalKbps),
    stalls: round(st.stalls) ?? 0,
    stallSec: num(st.stallSec) != null ? Math.round((st.stallSec as number) * 10) / 10 : 0,
    restarts: round(st.restarts) ?? 0,
    lastRestartReason: st.lastRestartReason ? String(st.lastRestartReason).slice(0, 80) : null,
    lastError: st.lastError ? String(st.lastError).slice(0, 64) : null,
    httpStatus: num(st.httpStatus) != null && (st.httpStatus as number) > 0 ? st.httpStatus : null,
    // How the file was read: over several connections (a remote server's
    // file) and how many at most, refusals included. Not the live count
    // (fetchConnections), which at the end says only what was in flight.
    rangeFetch: typeof st.rangeFetch === 'boolean' ? st.rangeFetch : null,
    connectionCap: round(st.connectionCap),
    droppedFrames: round(st.droppedFrames),
    lowRamBox: typeof ext.lowRamBox === 'boolean' ? ext.lowRamBox : null,
    route: route?.route ?? 'unknown',
    addressKind: ep?.kind ?? null,
    port: ep?.port ?? null,
    ipFamily: ep?.family ?? null,
    secure: ep ? ep.secure : null,
  };
}

/** Reads the player's stats now and sends the event. The read is issued
 *  synchronously (before anything that follows can stop the player). */
function report(session: string | null): void {
  if (!isNativePlatform()) return;
  const route = getPlexCurrentRoute();
  let read: Promise<PlayerStats>;
  try { read = SnowPlayer.getStats(); } catch { return; }
  void read.then((st) => {
    const props = plexTitleStatsProps(st, route, session);
    if (props) trackEvent(PLEX_TITLE_STATS_EVENT, 'player', props);
  }).catch(() => { /* an older app without getStats: nothing to send */ });
}

let watching = false;
// The session already reported, so a title is never sent twice (the player
// closing right after the next title's session started, say).
let reportedSession: string | null = null;

/** Starts watching for title ends. Idempotent; stays on for the app's life
 *  (usePlexAuth calls it at the first Plex open). */
export function watchPlexTitleStats(): void {
  if (watching) return;
  watching = true;
  onPlexPlaybackSession((previous) => {
    if (!previous || previous === reportedSession) return;
    reportedSession = previous;
    report(previous);
  });
  onPlexPlaybackActiveChange((active) => {
    if (active) return;
    const session = currentPlexPlaybackSession();
    if (session && session === reportedSession) return;
    reportedSession = session;
    report(session);
  });
}
