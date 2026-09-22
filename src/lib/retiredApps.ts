// Apps that used to be installed from Main Apps and now live inside the
// Player. A download press on one of them gets a notice pointing to where
// the service is now, instead of an APK nobody supports any more.
import type { Screen } from '@/lib/appActions';

export interface RetiredApp {
  /** Where the service lives now, as the viewer sees it in the Player. */
  where: 'Live TV' | 'Plex';
  /** The Player section to open for "Open Player". */
  screen: Extract<Screen, 'live_tv' | 'plex'>;
}

const RETIRED: Array<{ test: RegExp; info: RetiredApp }> = [
  { test: /dream\s*streams?/i, info: { where: 'Live TV', screen: 'live_tv' } },
  { test: /vibe[sz]/i, info: { where: 'Live TV', screen: 'live_tv' } },
  { test: /(^|[^a-z])plex([^a-z]|$)/i, info: { where: 'Plex', screen: 'plex' } },
];

/** The notice for an app tile, or null for an app that is still supported. */
export const retiredAppFor = (name: string | null | undefined): RetiredApp | null => {
  const n = String(name ?? '').trim();
  if (!n) return null;
  for (const r of RETIRED) if (r.test.test(n)) return r.info;
  return null;
};

/** What the notice says. One sentence on the service, one on where to go. */
export const retiredAppMessage = (appName: string, info: RetiredApp): string =>
  `We no longer support the ${appName} app, so there is nothing to download here. ` +
  `Everything is in the Player on the main page: Dreamstreams and VibezTV are in Live TV, and Plex is in Plex. ` +
  `${appName} is under ${info.where}.`;
