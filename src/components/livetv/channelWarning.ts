// "Watch anyway" on a reported channel is remembered for a while on this box,
// so the same viewer is not asked again every time they come back to it
// (Live TV and Game Day share it). Kept in memory only: a restart asks again.
import { normalizeHost } from '@/lib/favoritesSync';

const keyOf = (host: string, streamId: number) => `${normalizeHost(host)}|${streamId}`;

const QUIET_MS = 30 * 60_000;
const chosen = new Map<string, number>();

export function noteWatchAnyway(host: string, streamId: number): void {
  chosen.set(keyOf(host, streamId), Date.now());
  // Never more than a handful: drop the oldest.
  if (chosen.size > 50) chosen.delete(chosen.keys().next().value as string);
}

export function warnedRecently(host: string, streamId: number): boolean {
  const at = chosen.get(keyOf(host, streamId));
  return at != null && Date.now() - at < QUIET_MS;
}

/** Tests only. */
export function __resetWarnedForTests(): void { chosen.clear(); }
