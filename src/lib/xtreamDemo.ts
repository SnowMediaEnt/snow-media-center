// Demo-mode Live TV data source.
//
// In demo mode (?demo=1) the app never talks to an Xtream/panel host: every
// read is answered from the canned fixtures in `@/data/liveTvDemo`. The
// helpers below deliberately mirror the signatures of their real counterparts
// in `@/lib/xtream` (the creds arg is accepted and ignored) so call sites can
// swap between them with a single ternary — exactly like `@/lib/plexDemo`.
// `isDemo()` is always false on native, so this module is dead code in the APK.
import type {
  XtreamCreds,
  XtreamCategory,
  XtreamLiveStream,
  XtreamEpgEntry,
} from '@/lib/xtream';
import {
  DEMO_LIVE_CATEGORIES,
  DEMO_CHANNELS,
  demoGetShortEpg as fixtureShortEpg,
} from '@/data/liveTvDemo';

/** Categories — mirrors `getLiveCategories(creds)`. */
export async function demoGetLiveCategories(_creds: XtreamCreds): Promise<XtreamCategory[]> {
  return DEMO_LIVE_CATEGORIES;
}

/**
 * Channels for one category (undefined = full lineup, used by the "All
 * channels" row and search) — mirrors `getLiveStreams(creds, categoryId?)`.
 */
export async function demoGetLiveStreams(
  _creds: XtreamCreds,
  categoryId?: string,
): Promise<XtreamLiveStream[]> {
  if (!categoryId) return DEMO_CHANNELS;
  return DEMO_CHANNELS.filter((c) => c.category_id === categoryId);
}

/**
 * Rolling now/next EPG — mirrors `getShortEpg(creds, streamId, limit)`.
 * The fixture generator is anchored to NOW, so every call re-serves a fresh,
 * always-current schedule ("Update Channels" never blanks the grid).
 */
export async function demoGetShortEpg(
  _creds: XtreamCreds,
  streamId: number,
  limit = 4,
): Promise<{ epg_listings: XtreamEpgEntry[] }> {
  return { epg_listings: fixtureShortEpg(streamId, limit) };
}
