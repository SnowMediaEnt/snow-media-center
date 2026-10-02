// Per-playback policy for a Plex stream: whether the file is read over
// several connections at once, and how many. Kept free of React so the
// rules can be tested on their own (PlexSection applies them).
import { isPrivatePlexBase, type PlexRoute } from '@/lib/plex';

/** How many connections the native player reads a remote file over
 *  (RangeFetchDataSource: the same on every box). What a speed check made
 *  before a play uses too, so its figure is what playback will get. */
export const PLAYBACK_CONNECTIONS = 4;

/** A Plex file played as it is ({base}/library/parts/...). */
export const isPlexFileUrl = (u: string | null | undefined): boolean => !!u && u.indexOf('/library/parts/') >= 0;

/**
 * Whether the native player reads this stream over several connections at
 * once (SnowPlayerLoadOpts.rangeFetch): only a file played as it is, from a
 * server that is not on a private network (one connection is all a home
 * network takes; the same rule as the route, isPrivatePlexBase), never over
 * the Plex Relay (which is the cap), and only while the `plex_range_fetch`
 * feature flag is on (`flagOn`; a missing row is on — it is the kill
 * switch). A conversion arrives only as fast as it is made.
 */
export function rangeFetchAllowed(url: string | null | undefined, route: PlexRoute | null | undefined, flagOn: boolean): boolean {
  if (!flagOn || !isPlexFileUrl(url) || route === 'relay') return false;
  return !isPrivatePlexBase(url as string);
}

/** How many connections playback of a file from `base` will read it over. */
export function playbackConnections(base: string, route: PlexRoute | null | undefined, flagOn: boolean): number {
  return rangeFetchAllowed(`${base.replace(/\/+$/, '')}/library/parts/x`, route, flagOn) ? PLAYBACK_CONNECTIONS : 1;
}
