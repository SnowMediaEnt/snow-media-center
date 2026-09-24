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

export const SCREEN_LABELS: Record<Screen, string> = {
  home: 'Home', player: 'the Player', live_tv: 'Live TV', guide: 'the Guide', game_day: 'Game Day', multi_screen: 'Multi-Screen', plex: 'Plex',
  backups: 'Backups', player_appearance: 'Player Settings → Appearance', player_settings: 'Player Settings',
  main_apps: 'Main Apps', support: 'Support', posts: 'Posts from Snow Media', tickets: 'Submit a Ticket', device_cleaner: 'Device Cleaner',
  buffering_guide: 'the Buffering Guide', how_to: 'How to use SMC', support_videos: 'Support Videos', speed_test: 'Speed Test', ai_chat: 'AI Chat',
  dashboard: 'your Dashboard', snow_gems: 'Snow Gems', game_lounge: 'the Game Lounge', giveaway: 'the Giveaway', settings: 'Settings',
  settings_ui: 'Settings → UI', wallpaper: 'the wallpaper maker', phone_remote: 'Settings → Phone Remote', store: 'the Store',
};

/** Screens a Kids profile does not open, by voice or through the assistant.
 *  (Settings is open to it: a Kids profile gets a short, safe Settings.) */
export const KIDS_BLOCKED_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
  'game_lounge', 'snow_gems', 'giveaway', 'dashboard',
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
  return SCREEN_LABELS[screen] ?? screen;
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
      const layout = (['classic', 'compact', 'grid'] as LiveLayout[]).find((l) => l === v);
      if (!layout) return null;
      saveLiveLayout(layout);
      return `Live TV is set to the ${layout[0].toUpperCase()}${layout.slice(1)} layout.`;
    }
    case 'dashboard_size': {
      const size: DashboardSize = v === 'large' ? 'large' : 'compact';
      saveDashboardSize(size);
      return size === 'large' ? 'The Dashboard is set to Large.' : 'The Dashboard is set to fit one screen.';
    }
    case 'post_notifications': {
      const on = v === 'on' || v === 'true' || v === 'yes';
      saveMailNotify(on);
      return on ? 'Post notifications are on.' : 'Post notifications are off. New posts still arrive under Support → Posts.';
    }
    case 'content_bar': {
      const on = v === 'on' || v === 'true' || v === 'yes';
      setMediaBarEnabled(on);
      return on ? 'The content bar is back on the home screen.' : 'The content bar is hidden.';
    }
    default: return null;
  }
}

/** What the Player is asked to do when it opens (or, already open, at once:
 *  PLAYER_INTENT_EVENT carries the same thing, and the Player clears the
 *  stored copy when it acts on the event). */
export interface PlayerIntent {
  section?: 'live' | 'guide' | 'multi' | 'movies' | 'backups' | 'gameday';
  settings?: 'appearance' | 'hub';
  report?: ReportIntent;
  /** Live TV: play the channel with this name. */
  play?: string;
  /** Plex: open this title (open) or search for it. */
  plex?: { query: string; open: boolean };
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

/** Live TV: find the channel and play it. */
export function playChannel(name: string, navigate: Navigate): void {
  toPlayer({ section: 'live', play: name }, navigate);
  try { trackEvent('voice_play_channel', 'ai'); } catch { void 0; }
}

/** Plex: open a title by name (or search for it when there is no clear match). */
export function openPlexTitle(query: string, open: boolean, navigate: Navigate): void {
  toPlayer({ section: 'movies', plex: { query, open } }, navigate);
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
    return `${name} isn't on this box — finding it in Main Apps.`;
  }
  try {
    const { AppManager } = await import('@/capacitor/AppManager');
    await AppManager.launch({ packageName: app.packageName });
    try { trackEvent('voice_open_app', 'ai', { app: app.appName }); } catch { void 0; }
    return `Opening ${app.appName}…`;
  } catch {
    return `${app.appName} didn't open. Try it from Main Apps.`;
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
