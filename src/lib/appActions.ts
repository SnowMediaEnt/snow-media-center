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
  | 'dashboard' | 'snow_gems' | 'game_lounge' | 'giveaway' | 'settings' | 'settings_ui' | 'wallpaper' | 'phone_remote' | 'store' | 'device_check';

export type PreferenceKey = 'live_layout' | 'dashboard_size' | 'post_notifications' | 'content_bar';

export interface ReportIntent { search: string; issue?: string; details?: string }

export const INTENT_KEYS = {
  player: 'smc-player-intent',      // { section?: 'live'|'guide'|'multi'|'movies'|'backups'|'gameday'|'recordings', settings?: 'appearance'|'hub', report?: ReportIntent }
  support: 'smc-support-open',      // 'posts' | 'tickets' | 'cleaner' | 'devicecheck' | 'speedtest' | 'videos' | 'ai'
  settings: 'smc-settings-tab',     // a Settings page: 'media' (Backgrounds) | 'ui' / 'ui-home' (Home screen) | 'account' | 'profiles' | 'remote' | 'notifications' | 'language' | 'updates' | 'alerts' | 'ai'
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
  device_check: 'ai.screens.deviceCheck',
};

/** A screen's name in the app's language, at the moment it is spoken or shown. */
export const screenLabel = (screen: Screen): string => (SCREEN_LABEL_KEYS[screen] ? i18n.t(SCREEN_LABEL_KEYS[screen]) : screen);

/** Screens a Kids profile does not open, by voice or through the assistant.
 *  (Settings is open to it: a Kids profile gets a short, safe Settings.) */
export const KIDS_BLOCKED_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
  'game_lounge', 'snow_gems', 'giveaway', 'dashboard', 'backups',
  'player_settings', 'player_appearance', 'main_apps', 'tickets', 'device_cleaner',
  'store', 'device_check',
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
    case 'device_check': toScreen('support', INTENT_KEYS.support, 'devicecheck', navigate); break;
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

/** Support, opened on one of its tools (Live TV Settings › Fix a problem,
 *  a Home tile): the Speed test, tickets, the AI chat or the Buffering Guide. */
export function openSupportTool(tool: 'speedtest' | 'tickets' | 'ai' | 'buffering', navigate: Navigate): void {
  if (tool === 'buffering') toScreen('support', 'smc-open-buffering-guide', '1', navigate);
  else toScreen('support', INTENT_KEYS.support, tool, navigate);
}

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
  /** 'movies' is Plex; 'vod-movies' / 'vod-series' the line's own Movies
   *  and Series (Plex when the Player has no line). */
  section?: 'live' | 'guide' | 'multi' | 'movies' | 'backups' | 'gameday' | 'recordings' | 'vod' | 'originals' | 'vod-movies' | 'vod-series';
  /** Live TV: open on its Favorites, or its Recordings (a Home tile). */
  open?: LiveOpen;
  /** Live TV Settings: the menu ('hub') or one of its pages. */
  settings?: 'hub' | LiveSettingsPage;
  report?: ReportIntent;
  /** Live TV: play the channel with this name. */
  play?: string;
  /** Plex: open this title (open) or search for it. `at`: when it was asked
   *  for, so a request Plex never picked up does not fire on a later visit. */
  plex?: { query: string; open: boolean; at?: number; tab?: PlexTab };
  /** Live TV: play exactly this channel (Game Day, a kickoff reminder). */
  deeplink?: LiveDeeplink;
}

/** A page of Live TV Settings (SettingsHub's rows; 'devices' is My Account ›
 *  Devices on this line). */
export type LiveSettingsPage = 'account' | 'devices' | 'services' | 'channels' | 'appearance' | 'rewind' | 'player' | 'help';

/** A place in Plex's side menu (plexVoice.ts reads it). */
export type PlexTab = 'home' | 'discover' | 'search' | 'request' | 'movies' | 'shows' | 'library';

/** Where in Live TV a Home tile opens it (LiveSection reads LIVE_OPEN_KEY). */
export type LiveOpen = 'favorites' | 'recordings';
export const LIVE_OPEN_KEY = 'smc-live-open';
export const LIVE_OPEN_EVENT = 'smc:live-open';

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

/** A Home tile's place in the Player (the Guide, Favorites, Multi-Screen…):
 *  straight in, and Back from it comes Home. */
export function openPlayerFromHome(intent: Omit<PlayerIntent, 'home'>, navigate: Navigate): void {
  toPlayer({ ...intent, home: true }, navigate);
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

// ── The assistant's newer actions (app_actions 2) ─────────────────────────
/** Sent to snow-media-ai as `app_actions`: which of its tools this build can
 *  carry out. An older build sends none, and is only offered the old ones.
 *  3 (1.9.8): open_screen device_check, and open_settings on each of the
 *  app's Settings pages (the menu-and-page Settings). */
export const ASSISTANT_ACTIONS_VERSION = 3;

// open_live_tv, open_plex, open_settings and request_plex_title. The chat and
// the voice host both hand them to runAssistantAction, so the two cannot
// drift apart. Each returns the line to show (a toast, the voice box).

/** Live TV's side menu, as the assistant names it. */
export type LiveTvPlace = 'live' | 'favorites' | 'guide' | 'game_day' | 'recordings' | 'vod' | 'multi_screen' | 'snow_originals' | 'backups';
const LIVE_TV_PLACES: Record<LiveTvPlace, Omit<PlayerIntent, 'home'>> = {
  live: { section: 'live' },
  favorites: { section: 'live', open: 'favorites' },
  guide: { section: 'guide' },
  game_day: { section: 'gameday' },
  recordings: { section: 'recordings' },
  vod: { section: 'vod' },
  multi_screen: { section: 'multi' },
  snow_originals: { section: 'originals' },
  backups: { section: 'backups' },
};
/** Not on a Kids profile (Live TV leaves them out of its menu too). */
const KIDS_BLOCKED_LIVE: ReadonlySet<LiveTvPlace> = new Set<LiveTvPlace>(['backups', 'recordings']);

/** Open a part of Live TV. Null: not a place (or not a Kids profile's). */
export function openLiveTv(place: string, navigate: Navigate, kids = false): Omit<PlayerIntent, 'home'> | null {
  const intent = (LIVE_TV_PLACES as Record<string, Omit<PlayerIntent, 'home'>>)[place];
  if (!intent || (kids && KIDS_BLOCKED_LIVE.has(place as LiveTvPlace))) return null;
  toPlayer({ ...intent }, navigate);
  try { trackEvent('ai_open_live_tv', 'ai', { place }); } catch { void 0; }
  return intent;
}

const PLEX_TABS: ReadonlySet<PlexTab> = new Set<PlexTab>(['home', 'discover', 'search', 'request', 'movies', 'shows', 'library']);
/** Words the assistant may pass: a library's name, or what to search for. */
const cleanWords = (v: unknown, max = 80): string =>
  Array.from(String(v ?? ''), (c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').trim().slice(0, max);

/** Open a place in Plex: a menu entry, a library by name, Search or Request
 *  with words typed. Null: not a place (Request is not a Kids profile's). */
export function openPlexPlace(tab: string, words: string, navigate: Navigate, kids = false): PlexTab | null {
  if (!PLEX_TABS.has(tab as PlexTab)) return null;
  const t = tab as PlexTab;
  if (kids && t === 'request') return null;
  const query = cleanWords(words);
  if (t === 'library' && !query) return null;
  toPlayer({ section: 'movies', plex: { query, open: false, tab: t, at: Date.now() } }, navigate);
  try { trackEvent('ai_open_plex', 'ai', { tab: t }); } catch { void 0; }
  return t;
}

/** Live TV Settings pages and the app's own Settings, as the assistant names them. */
export type SettingsPlace =
  | 'live_tv_settings' | 'my_account' | 'devices' | 'services' | 'channels' | 'appearance' | 'recording_rewind' | 'player' | 'fix_a_problem'
  | 'settings' | 'settings_ui' | 'home_screen' | 'wallpaper'
  // The app's Settings pages (1.9.8: a menu with a page per row).
  | 'app_account' | 'profiles' | 'phone_remote' | 'notifications' | 'language' | 'updates';
const LIVE_SETTINGS: Partial<Record<SettingsPlace, 'hub' | LiveSettingsPage>> = {
  live_tv_settings: 'hub', my_account: 'account', devices: 'devices', services: 'services', channels: 'channels',
  appearance: 'appearance', recording_rewind: 'rewind', player: 'player', fix_a_problem: 'help',
};
const APP_SETTINGS: Partial<Record<SettingsPlace, string | null>> = {
  settings: null, settings_ui: 'ui', home_screen: 'ui-home', wallpaper: 'media',
  app_account: 'account', profiles: 'profiles', phone_remote: 'remote', notifications: 'notifications', language: 'language', updates: 'updates',
};
/** Settings pages a Kids profile's short Settings doesn't have. */
const KIDS_NO_SETTINGS: ReadonlySet<SettingsPlace> = new Set<SettingsPlace>(['home_screen', 'app_account', 'notifications', 'updates']);

/** Open a Settings page. Live TV Settings is a grown-up's (sign-out, the
 *  line's details, billing); a Kids profile gets the app's short Settings
 *  only. Null: not a page, or not this profile's. */
export function openSettingsPlace(place: string, navigate: Navigate, kids = false): SettingsPlace | null {
  const p = place as SettingsPlace;
  const live = LIVE_SETTINGS[p];
  if (live) {
    if (kids) return null;
    toPlayer({ section: 'live', settings: live }, navigate);
  } else if (p in APP_SETTINGS) {
    if (kids && KIDS_NO_SETTINGS.has(p)) return null;
    const tab = APP_SETTINGS[p];
    if (tab) toScreen('settings', INTENT_KEYS.settings, tab, navigate);
    else navigate('settings');
  } else return null;
  try { trackEvent('ai_open_settings', 'ai', { place: p }); } catch { void 0; }
  return p;
}

export interface PlexRequestAsk { title: string; mediaType: 'movie' | 'tv'; year?: string | null }
type RequestItem = { id: number; mediaType: 'movie' | 'tv'; title: string; year: string | null; posterUrl: string | null; status: number };
const normTitle = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');

/** The one result a confirmed request means: same title (and year, when one
 *  was given) and the same kind. More than one, or none: null, and the
 *  viewer picks on the Request screen. */
export function pickRequestMatch(items: RequestItem[], ask: PlexRequestAsk): RequestItem | null {
  const want = normTitle(ask.title);
  if (!want) return null;
  const year = String(ask.year ?? '').trim();
  const same = items.filter((it) => it.mediaType === ask.mediaType && normTitle(it.title) === want && (!year || String(it.year ?? '') === year));
  return same.length === 1 ? same[0] : null;
}

export type PlexRequestOutcome = 'requested' | 'already' | 'on_plex' | 'pick' | 'failed';

/** Request a title the viewer confirmed in the chat. A clear match is sent
 *  to Snow Media's Overseerr (the same call as Plex › Request); anything
 *  less certain opens Plex › Request with the title typed, for the viewer to
 *  pick and confirm on screen. */
export async function requestPlexTitle(
  ask: PlexRequestAsk,
  navigate: Navigate,
  deps?: { search?: (q: string) => Promise<RequestItem[]>; request?: (it: RequestItem) => Promise<'requested' | 'already' | 'failed'> },
): Promise<{ outcome: PlexRequestOutcome; title: string }> {
  const title = cleanWords(ask.title, 120);
  const lib = deps?.search && deps?.request ? null : await import('@/lib/overseerr');
  const search = deps?.search ?? lib!.overseerrSearch;
  const send = deps?.request ?? lib!.overseerrRequest;
  const pick = () => { openPlexPlace('request', title, navigate); return { outcome: 'pick' as const, title }; };
  if (!title) return { outcome: 'failed', title };
  let found: RequestItem[] = [];
  try { found = await search(title); } catch { return pick(); }
  const hit = pickRequestMatch(found, { ...ask, title });
  if (!hit) return pick();
  const named = hit.year ? `${hit.title} (${hit.year})` : hit.title;
  if (hit.status === 5) return { outcome: 'on_plex', title: named };
  if (hit.status >= 2) return { outcome: 'already', title: named };
  const res = await send(hit);
  try { trackEvent('ai_plex_request', 'ai', { result: res, type: hit.mediaType }); } catch { void 0; }
  return { outcome: res, title: named };
}

/** What the assistant's newer actions say back: one line, in the app's language. */
const said = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);

/**
 * Run one of the assistant's newer actions (the older ones stay with their
 * callers). Returns the line to show, or null when `name` is not one of
 * these. `voice`: spoken to the remote, where there is no conversation to
 * confirm a request in, so a request opens Plex › Request instead.
 */
export async function runAssistantAction(
  name: string,
  args: Record<string, unknown> | null | undefined,
  navigate: Navigate,
  opts: { kids?: boolean; voice?: boolean } = {},
): Promise<string | null> {
  const a = args ?? {};
  const str = (k: string) => cleanWords(a[k], 120);
  const kids = !!opts.kids;
  switch (name) {
    case 'open_live_tv': {
      const place = str('section');
      const ok = openLiveTv(place, navigate, kids);
      if (!ok) return kids && place in LIVE_TV_PLACES ? said('ai.actions.grownUp') : said('ai.actions.unknownPlace');
      return said('ai.actions.openingLive', { where: said(`ai.actions.live.${place}`) });
    }
    case 'open_plex': {
      const place = str('place');
      const words = place === 'library' ? str('library_name') : str('query');
      const tab = openPlexPlace(place, words, navigate, kids);
      if (!tab) return kids && place === 'request' ? said('ai.actions.grownUp') : said('ai.actions.unknownPlace');
      if (tab === 'library') return said('ai.actions.openingPlexLibrary', { name: words });
      if ((tab === 'search' || tab === 'request') && words) return said(`ai.actions.plex.${tab}With`, { query: words });
      return said('ai.actions.openingPlex', { where: said(`ai.actions.plex.${tab}`) });
    }
    case 'open_settings': {
      const place = str('page');
      const ok = openSettingsPlace(place, navigate, kids);
      if (!ok) return kids && (place in LIVE_SETTINGS || KIDS_NO_SETTINGS.has(place as SettingsPlace)) ? said('ai.actions.grownUp') : said('ai.actions.unknownPlace');
      return said('ai.actions.openingSettings', { where: said(`ai.actions.settings.${place}`) });
    }
    case 'request_plex_title': {
      if (kids) return said('ai.actions.grownUp');
      const title = str('title');
      const mediaType = a.media_type === 'tv' ? 'tv' : a.media_type === 'movie' ? 'movie' : null;
      if (!title || !mediaType) return said('ai.actions.requestNeedsTitle');
      const year = /^(19|20)\d\d$/.test(str('year')) ? str('year') : null;
      // Spoken to the remote, or not confirmed in the chat: the viewer picks
      // and confirms on Plex › Request.
      if (opts.voice || a.confirmed !== true) {
        openPlexPlace('request', title, navigate);
        return said('ai.actions.request.pick', { title });
      }
      const res = await requestPlexTitle({ title, mediaType, year }, navigate);
      // Already on Plex: its page, to play.
      if (res.outcome === 'on_plex') openPlexTitle(title, true, navigate);
      return said(`ai.actions.request.${res.outcome}`, { title: res.title });
    }
    default:
      return null;
  }
}
