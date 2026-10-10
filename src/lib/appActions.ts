// Things the AI assistant can do inside the app on the viewer's behalf.
//
// The assistant answers with a function call (see the snow-media-ai edge
// function's tools) and the chat hands it here. Each action either jumps to
// a screen, flips a preference, or leaves an "intent" in sessionStorage that
// the destination screen consumes when it mounts — the same way the Player
// already consumes 'smc-live-deeplink'. Nothing here needs the screen to be
// open already, and every intent is read once and cleared. A screen that is
// open already is told by an event (PLAYER_INTENT_EVENT, SCREEN_INTENT_EVENT):
// navigating to the view on show does nothing, and the intent would otherwise
// wait for the next visit.
import { saveLiveLayout, type LiveLayout } from '@/lib/liveLayout';
import { saveDashboardSize, type DashboardSize } from '@/lib/dashboardSize';
import { saveMailNotify } from '@/lib/snowMail';
import { setMediaBarEnabled } from '@/hooks/useMediaBarEnabled';
import { trackEvent } from '@/lib/analytics';
import i18n from '@/i18n';

export type Navigate = (section: string) => void;

/** Screens the assistant can open. Keep in step with the edge function's enum. */
export type Screen =
  | 'home' | 'player' | 'live_tv' | 'guide' | 'game_day' | 'multi_screen' | 'plex' | 'backups' | 'player_appearance' | 'player_settings'
  | 'main_apps' | 'support' | 'posts' | 'tickets' | 'device_cleaner' | 'buffering_guide' | 'how_to' | 'support_videos' | 'speed_test' | 'ai_chat'
  | 'dashboard' | 'snow_gems' | 'game_lounge' | 'giveaway' | 'settings' | 'settings_ui' | 'wallpaper' | 'phone_remote' | 'store';

export type PreferenceKey = 'live_layout' | 'dashboard_size' | 'post_notifications' | 'content_bar';

export interface ReportIntent { search: string; issue?: string; details?: string }

export const INTENT_KEYS = {
  player: 'smc-player-intent',      // { section?: 'live'|'guide'|'multi'|'movies'|'backups', settings?: 'appearance'|'hub', report?: ReportIntent }
  support: 'smc-support-open',      // 'posts' | 'tickets' | 'cleaner' | 'speedtest' | 'videos' | 'ai'
  settings: 'smc-settings-tab',     // 'media' | 'ui' | 'profiles' | 'updates' | 'alerts' | 'ai'
  installApp: 'smc-install-app',    // app name
  wallpaper: 'smc-wallpaper-prompt', // prompt text
  wallpaperDraft: 'smc-wallpaper-draft', // prompt text, filled in but not generated
} as const;

const put = (key: string, value: unknown) => {
  try { sessionStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch { /* ignore */ }
};

/** Look without clearing. Use this in a useState initializer: a render that
 *  suspends on a lazy child is thrown away and re-run, and a read-and-clear
 *  there would leave the second run with nothing. Clear in an effect. */
export const peekIntent = <T = string>(key: string, json = false): T | null => {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return null;
    return (json ? JSON.parse(raw) : raw) as T;
  } catch { return null; }
};

export const clearIntent = (key: string): void => {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
};

/** Read-once helper for effects (never for a state initializer). */
export const takeIntent = <T = string>(key: string, json = false): T | null => {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return null;
    sessionStorage.removeItem(key);
    return (json ? JSON.parse(raw) : raw) as T;
  } catch { return null; }
};

/** Where each screen's name lives in the translations (used as "Opening {{where}}…"). */
const SCREEN_LABEL_KEYS: Record<Screen, string> = {
  home: 'ai.screens.home', player: 'ai.screens.player', live_tv: 'ai.screens.liveTv', guide: 'ai.screens.guide', game_day: 'ai.screens.gameDay',
  multi_screen: 'ai.screens.multiScreen', plex: 'ai.screens.plex', backups: 'ai.screens.backups', player_appearance: 'ai.screens.playerAppearance',
  player_settings: 'ai.screens.playerSettings', main_apps: 'ai.screens.mainApps', support: 'ai.screens.support', posts: 'ai.screens.posts',
  tickets: 'ai.screens.tickets', device_cleaner: 'ai.screens.deviceCleaner', buffering_guide: 'ai.screens.bufferingGuide', how_to: 'ai.screens.howTo',
  support_videos: 'ai.screens.supportVideos', speed_test: 'ai.screens.speedTest', ai_chat: 'ai.screens.aiChat', dashboard: 'ai.screens.dashboard',
  snow_gems: 'ai.screens.snowGems', game_lounge: 'ai.screens.gameLounge', giveaway: 'ai.screens.giveaway', settings: 'ai.screens.settings',
  settings_ui: 'ai.screens.settingsUi', wallpaper: 'ai.screens.wallpaper', phone_remote: 'ai.screens.phoneRemote', store: 'ai.screens.store',
};

/** A screen's name in the app's language, at the moment it is spoken or shown. */
export const screenLabel = (screen: Screen): string => (SCREEN_LABEL_KEYS[screen] ? i18n.t(SCREEN_LABEL_KEYS[screen]) : screen);

/** Screens a Kids profile does not open, by voice or through the assistant.
 *  (Settings is open to it: a Kids profile gets a short, safe Settings.) */
export const KIDS_BLOCKED_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
  'game_lounge', 'snow_gems', 'giveaway', 'dashboard', 'backups',
  'player_settings', 'player_appearance', 'main_apps', 'tickets', 'device_cleaner',
  'store',
]);

export function openScreen(screen: Screen, navigate: Navigate): string {
  switch (screen) {
    case 'home': navigate('home'); break;
    case 'player': navigate('livetv'); break;
    case 'live_tv': toPlayer({ section: 'live' }, navigate); break;
    case 'guide': toPlayer({ section: 'guide' }, navigate); break;
    case 'game_day': toPlayer({ section: 'gameday' }, navigate); break;
    case 'multi_screen': toPlayer({ section: 'multi' }, navigate); break;
    case 'plex': toPlayer({ section: 'movies' }, navigate); break;
    case 'backups': toPlayer({ section: 'backups' }, navigate); break;
    case 'player_settings': toPlayer({ section: 'live', settings: 'hub' }, navigate); break;
    case 'player_appearance': toPlayer({ section: 'live', settings: 'appearance' }, navigate); break;
    case 'main_apps': navigate('apps'); break;
    case 'support': navigate('support'); break;
    case 'posts': toScreen('support', INTENT_KEYS.support, 'posts', navigate); break;
    case 'tickets': toScreen('support', INTENT_KEYS.support, 'tickets', navigate); break;
    case 'device_cleaner': toScreen('support', INTENT_KEYS.support, 'cleaner', navigate); break;
    case 'buffering_guide': toScreen('support', 'smc-open-buffering-guide', '1', navigate); break;
    case 'how_to': toScreen('support', 'smc-open-howto', '1', navigate); break;
    case 'support_videos': toScreen('support', INTENT_KEYS.support, 'videos', navigate); break;
    case 'speed_test': toScreen('support', INTENT_KEYS.support, 'speedtest', navigate); break;
    case 'ai_chat': toScreen('support', INTENT_KEYS.support, 'ai', navigate); break;
    case 'dashboard': navigate('user'); break;
    case 'snow_gems': navigate('credits'); break;
    case 'game_lounge': navigate('games'); break;
    case 'giveaway': navigate('giveaway'); break;
    case 'settings': navigate('settings'); break;
    case 'settings_ui': toScreen('settings', INTENT_KEYS.settings, 'ui', navigate); break;
    case 'wallpaper': toScreen('settings', INTENT_KEYS.settings, 'media', navigate); break;
    case 'phone_remote': toScreen('settings', INTENT_KEYS.settings, 'remote', navigate); break;
    case 'store': navigate('store'); break;
  }
  try { trackEvent('ai_open_screen', 'ai', { screen }); } catch { void 0; }
  return screenLabel(screen);
}

/** Support or Settings, already on screen, takes its intent now (the
 *  event's detail is the view). */
export const SCREEN_INTENT_EVENT = 'smc:screen-intent';

const toScreen = (view: string, key: string, value: string, navigate: Navigate) => {
  put(key, value);
  try { window.dispatchEvent(new CustomEvent<string>(SCREEN_INTENT_EVENT, { detail: view })); } catch { /* ignore */ }
  navigate(view);
};

/** Flip a setting. Returns a sentence for the toast, or null if unknown. */
export function setPreference(key: PreferenceKey, value: string): string | null {
  const v = String(value).trim().toLowerCase();
  switch (key) {
    case 'live_layout': {
      const layout = (['classic', 'compact', 'grid', 'guide'] as LiveLayout[]).find((l) => l === v);
      if (!layout) return null;
      saveLiveLayout(layout);
      return i18n.t('ai.prefs.liveLayout', { layout: i18n.t(`live.layouts.${layout}Label`) });
    }
    case 'dashboard_size': {
      const size: DashboardSize = v === 'large' ? 'large' : 'compact';
      saveDashboardSize(size);
      return size === 'large' ? i18n.t('ai.prefs.dashboardLarge') : i18n.t('ai.prefs.dashboardCompact');
    }
    case 'post_notifications': {
      const on = v === 'on' || v === 'true' || v === 'yes';
      saveMailNotify(on);
      return on ? i18n.t('ai.prefs.postsOn') : i18n.t('ai.prefs.postsOff');
    }
    case 'content_bar': {
      const on = v === 'on' || v === 'true' || v === 'yes';
      setMediaBarEnabled(on);
      return on ? i18n.t('ai.prefs.contentBarOn') : i18n.t('ai.prefs.contentBarOff');
    }
    default: return null;
  }
}

/** What the Player is asked to do when it opens (or, already open, at once:
 *  PLAYER_INTENT_EVENT carries the same thing, and the Player clears the
 *  stored copy when it acts on the event). */
export interface PlayerIntent {
  /** Opened from its own Home card: Back from it goes home, not to the
   *  Player's chooser. */
  home?: boolean;
  section?: 'live' | 'guide' | 'multi' | 'movies' | 'backups' | 'gameday';
  settings?: 'appearance' | 'hub';
  report?: ReportIntent;
  /** Live TV: play the channel with this name. */
  play?: string;
  /** Plex: open this title (open) or search for it. `at`: when it was asked
   *  for, so a request Plex never picked up does not fire on a later visit. */
  plex?: { query: string; open: boolean; at?: number };
  /** Live TV: play exactly this channel (Game Day, a kickoff reminder). */
  deeplink?: LiveDeeplink;
}

/** One channel on one line, as the content bar and Game Day hand it over. */
export interface LiveDeeplink { host: string; username: string; streamId: number; name?: string; icon?: string; categoryId?: string; num?: number }

/** Hand Live TV a channel to play; it plays it at once if it is open. */
export function handLiveDeeplink(d: LiveDeeplink): void {
  try { sessionStorage.setItem('smc-live-deeplink', JSON.stringify(d)); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('smc:live-deeplink')); } catch { /* ignore */ }
}

/** Hand Live TV a category to open (Game Day's "Browse MLB in Live TV"). */
export function handLiveCategory(d: { host: string; username: string; categoryId: string }): void {
  try { sessionStorage.setItem('smc-live-deeplink', JSON.stringify({ ...d, openCategory: true })); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('smc:live-deeplink')); } catch { /* ignore */ }
}

/** Play exactly this channel, from anywhere in the app. */
export function playLiveChannel(d: LiveDeeplink, navigate: Navigate): void {
  toPlayer({ section: 'live', deeplink: d }, navigate);
}

/** Open Game Day with one game's channel list (a kickoff reminder whose
 *  game had no channel when it was set). */
export function openGameDayGame(gameId: string, navigate: Navigate): void {
  try { sessionStorage.setItem('smc-gameday-open', gameId); } catch { /* ignore */ }
  toPlayer({ section: 'gameday' }, navigate);
}
export const PLAYER_INTENT_EVENT = 'smc:player-intent';

const toPlayer = (intent: PlayerIntent, navigate: Navigate) => {
  put(INTENT_KEYS.player, intent);
  try { window.dispatchEvent(new CustomEvent<PlayerIntent>(PLAYER_INTENT_EVENT, { detail: intent })); } catch { /* ignore */ }
  navigate('livetv');
};

/** Home's Live TV and Plex cards: straight into that part of the Player. */
export function openPlayerSection(section: 'live' | 'movies', navigate: Navigate): void {
  toPlayer({ section, home: true }, navigate);
}

/** Live TV: find the channel and play it. */
export function playChannel(name: string, navigate: Navigate): void {
  toPlayer({ section: 'live', play: name }, navigate);
  try { trackEvent('voice_play_channel', 'ai'); } catch { void 0; }
}

/** Plex: open a title by name (or search for it when there is no clear match). */
export function openPlexTitle(query: string, open: boolean, navigate: Navigate): void {
  toPlayer({ section: 'movies', plex: { query, open, at: Date.now() } }, navigate);
  try { trackEvent('voice_plex', 'ai', { open }); } catch { void 0; }
}

/** Live TV: find the channel and open Report with the reason picked. */
export function reportChannel(intent: ReportIntent, navigate: Navigate): void {
  toPlayer({ section: 'live', report: intent }, navigate);
  try { trackEvent('ai_report_channel', 'ai'); } catch { void 0; }
}

/** Open an app installed on the box by (spoken) name. Not installed: Main
 *  Apps opens and starts its download. Returns a line saying which. */
export async function openInstalledApp(name: string, navigate: Navigate): Promise<string> {
  const [{ getInstalledAppsNow }, { bestApp }] = await Promise.all([
    import('@/hooks/useDeviceInstalledApps'),
    import('@/lib/voiceCommands'),
  ]);
  const app = bestApp(name, await getInstalledAppsNow());
  if (!app) {
    installApp(name, navigate);
    return i18n.t('ai.apps.notInstalled', { name });
  }
  try {
    const { AppManager } = await import('@/capacitor/AppManager');
    await AppManager.launch({ packageName: app.packageName });
    try { trackEvent('voice_open_app', 'ai', { app: app.appName }); } catch { void 0; }
    return i18n.t('ai.apps.opening', { name: app.appName });
  } catch {
    return i18n.t('ai.apps.didntOpen', { name: app.appName });
  }
}

/** Main Apps: find the app and start its download. */
export function installApp(appName: string, navigate: Navigate): void {
  put(INTENT_KEYS.installApp, appName);
  navigate('apps');
  try { trackEvent('ai_install_app', 'ai', { app: appName }); } catch { void 0; }
}

/** Settings → Media: fill the prompt and generate a wallpaper. `generate`
 *  false only fills it in: Generate (which costs Snow Gems) is pressed on
 *  the TV. */
export function generateWallpaper(prompt: string, navigate: Navigate, generate = true): void {
  put(generate ? INTENT_KEYS.wallpaper : INTENT_KEYS.wallpaperDraft, prompt);
  toScreen('settings', INTENT_KEYS.settings, 'media', navigate);
  try { trackEvent('ai_generate_wallpaper', 'ai', { generate }); } catch { void 0; }
}
