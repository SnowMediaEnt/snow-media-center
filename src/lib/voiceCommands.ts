// What a spoken command means. The everyday ones — "open Plex", "put on
// ESPN", "watch The Office", "search for Batman", "open YouTube", "go home" —
// are understood here, on the box, with no round trip; anything else is
// handed to the assistant (snow-media-ai), which answers with the same
// actions (see VoiceCommandHost).
//
// Also the matchers the actions use: the channel a name means, and the
// installed app a name means.
import type { Screen } from '@/lib/appActions';

export type VoiceAction =
  | { kind: 'screen'; screen: Screen }
  | { kind: 'profiles' }
  | { kind: 'channel'; name: string }
  | { kind: 'plex'; query: string; open: boolean }
  /** "watch X": the Plex title by that name (or Plex Search with it typed).
   *  A channel is only what CHANNEL_HINT names; others need "put on X". */
  | { kind: 'watch'; query: string }
  | { kind: 'app'; name: string }
  | { kind: 'install'; name: string }
  | { kind: 'ai'; text: string };

/** Lower case, no punctuation, single spaces. */
export const normalizeSpeech = (s: string): string =>
  s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9&+ ]+/g, ' ').replace(/\s+/g, ' ').trim();

const POLITE = /^(?:(?:hey|ok|okay)\s+(?:snow|snow media|smc)\s*)?(?:please\s+|can you\s+|could you\s+|would you\s+|i want to\s+|i wanna\s+|i would like to\s+|id like to\s+|lets\s+|let me\s+)*/;
const TRAILING = /\s+(?:please|now|for me|right now)$/;

/** Words that name a screen, longest first so "tv guide" beats "guide". */
const SCREEN_WORDS: Array<[string, Screen | 'profiles']> = [
  ['player settings', 'player_settings'], ['player appearance', 'player_appearance'],
  ['buffering guide', 'buffering_guide'], ['device cleaner', 'device_cleaner'], ['speed test', 'speed_test'],
  ['speedtest', 'speed_test'], ['support videos', 'support_videos'], ['how to use', 'how_to'],
  ['multi screen', 'multi_screen'], ['multiscreen', 'multi_screen'], ['multi view', 'multi_screen'], ['multiview', 'multi_screen'],
  ['phone remote', 'phone_remote'], ['pair my phone', 'phone_remote'], ['pair phone', 'phone_remote'],
  ['game day', 'game_day'], ['gameday', 'game_day'], ['todays games', 'game_day'], ['games today', 'game_day'],
  ['tv guide', 'guide'], ['live tv', 'live_tv'], ['live television', 'live_tv'], ['the guide', 'guide'], ['guide', 'guide'],
  ['main apps', 'main_apps'], ['app store', 'main_apps'], ['apps', 'main_apps'], ['store', 'store'], ['snow store', 'store'],
  ['game lounge', 'game_lounge'], ['games', 'game_lounge'], ['snow gems', 'snow_gems'], ['gems', 'snow_gems'],
  ['ai chat', 'ai_chat'], ['assistant', 'ai_chat'], ['tickets', 'tickets'], ['ticket', 'tickets'], ['posts', 'posts'],
  ['cleaner', 'device_cleaner'], ['support', 'support'], ['help', 'support'], ['backups', 'backups'], ['backup', 'backups'],
  ['dashboard', 'dashboard'], ['my account', 'dashboard'], ['account', 'dashboard'], ['giveaway', 'giveaway'],
  ['settings', 'settings'], ['wallpaper', 'wallpaper'], ['background', 'wallpaper'],
  ['profiles', 'profiles'], ['profile', 'profiles'], ['whos watching', 'profiles'],
  ['plex', 'plex'], ['movies and shows', 'plex'], ['movies & series', 'plex'], ['movies and series', 'plex'],
  ['the player', 'player'], ['player', 'player'], ['home screen', 'home'], ['home', 'home'],
];

const screenFor = (words: string): Screen | 'profiles' | null => {
  const w = words.replace(/^(?:the|my)\s+/, '').replace(/\s+(?:screen|page|section|tab|menu)$/, '');
  for (const [k, s] of SCREEN_WORDS) if (w === k || w === `the ${k}`) return s;
  return null;
};

/** Channel names people say that are never titles — said on their own ("CNN",
 *  "the news", "Fox Sports 1"), not inside a longer name ("Fantastic Mr Fox",
 *  "News of the World", "A Discovery of Witches"). */
const CHANNEL_HINT = /^(?:the\s+)?(?:espn\d?|cnn|msnbc|fox|fs1|fs2|nbc|abc|cbs|pbs|hbo|showtime|starz|cinemax|tnt|tbs|usa network|amc|fx|fxx|bravo|hgtv|tlc|nick(?:elodeon)?|cartoon network|disney channel|discovery|history channel|nfl network|nba tv|mlb network|nhl network|golf channel|bet|mtv|vh1|cmt|comedy central|weather channel|local|news)(?:\s+(?:\d+|news|sports|jr|hd|east|west|channel))*$/;

/** A game or a fight rather than a title: "the Lakers game", "the UFC fight",
 *  "the game tonight", "the Super Bowl" — not "Squid Game", "Game of
 *  Thrones" or "The Hunger Games". Which channel has it is the assistant's
 *  to answer. */
const EVENT_HINT = /\bthe\s+(?:[a-z0-9&]+\s+){0,3}(?:game|match|fight|race|finals)\b|\b(?:tonight|ppv|pay per view|super bowl|world series|playoffs?|live sports)\b|^(?:live\s+)?sports$/;

/** Settings said after "turn on": the assistant's (set_preference), never a
 *  channel search. */
const SETTING_WORDS = /^(?:the\s+)?(?:subtitles?|captions?|closed captions?|cc|notifications?|post notifications?|content bar|volume|sound)$/;

/** The Player's own screens: "watch live tv", "watch game day". */
const PLAYER_SCREENS: ReadonlySet<Screen | 'profiles'> = new Set<Screen | 'profiles'>(['player', 'live_tv', 'guide', 'game_day', 'multi_screen', 'plex']);

const TITLE_HINT = /^(?:the\s+)?(?:movie|film|show|series|tv show|episode of)\s+/;

export function parseVoiceCommand(raw: string): VoiceAction {
  const said = normalizeSpeech(raw).replace(POLITE, '').replace(TRAILING, '').trim();
  if (!said) return { kind: 'ai', text: raw };

  // "go home", "home", "back to home"
  if (/^(?:go\s+)?(?:back\s+)?(?:to\s+)?(?:the\s+)?home(?:\s+screen)?$/.test(said)) return { kind: 'screen', screen: 'home' };
  if (/^(?:switch|change)\s+(?:the\s+)?(?:profile|user|profiles)$|^whos watching$/.test(said)) return { kind: 'profiles' };

  let m: RegExpExecArray | null;

  // install / download an app
  if ((m = /^(?:install|download|get)\s+(?:the\s+)?(.+?)(?:\s+app)?$/.exec(said))) return { kind: 'install', name: m[1] };

  // search
  if ((m = /^(?:search|look|find)\s+(?:for\s+|up\s+)?(.+?)(?:\s+(?:on|in)\s+plex)?$/.exec(said))) {
    return { kind: 'plex', query: m[1].replace(TITLE_HINT, ''), open: false };
  }

  // open / go to / show / take me to <screen or app>
  if ((m = /^(?:open(?:\s+up)?|launch|start|run|go\s+to|go\s+into|take\s+me\s+to|bring\s+up|show(?:\s+me)?|pull\s+up)\s+(.+)$/.exec(said))) {
    const target = m[1];
    const screen = screenFor(target);
    if (screen === 'profiles') return { kind: 'profiles' };
    if (screen) return { kind: 'screen', screen };
    if ((m = /^(?:channel\s+)?(.+?)\s+channel$|^channel\s+(.+)$/.exec(target))) return { kind: 'channel', name: (m[1] ?? m[2]).trim() };
    return { kind: 'app', name: target.replace(/^(?:the\s+)?(.+?)(?:\s+app)?$/, '$1') };
  }

  // put on / turn on / tune to / switch to  → a channel, unless it names a
  // screen ("switch to Plex"), a profile or a setting ("turn on subtitles")
  if ((m = /^(?:put\s+on|turn\s+on|tune\s+(?:in\s+)?to|switch\s+to|change\s+to|flip\s+to|change\s+(?:the\s+)?channel\s+to)\s+(?:channel\s+)?(.+?)(?:\s+channel)?$/.exec(said))) {
    const name = m[1];
    const screen = screenFor(name);
    if (screen === 'profiles' || /\bprofiles?\b/.test(name)) return { kind: 'profiles' };
    if (screen) return { kind: 'screen', screen };
    if (SETTING_WORDS.test(name) || EVENT_HINT.test(name)) return { kind: 'ai', text: raw };
    return { kind: 'channel', name };
  }

  // watch / play
  if ((m = /^(?:watch|play|stream|resume)\s+(.+)$/.exec(said))) {
    const what = m[1];
    if (TITLE_HINT.test(what)) return { kind: 'plex', query: what.replace(TITLE_HINT, ''), open: true };
    if ((m = /^(?:channel\s+)?(.+?)\s+channel$|^channel\s+(.+)$/.exec(what))) return { kind: 'channel', name: (m[1] ?? m[2]).trim() };
    if (CHANNEL_HINT.test(what)) return { kind: 'channel', name: what };
    const screen = screenFor(what);
    if (screen && PLAYER_SCREENS.has(screen)) return { kind: 'screen', screen: screen as Screen };
    // "watch the Lakers game", "the UFC fight": which category carries it is
    // the assistant's to answer.
    if (EVENT_HINT.test(what)) return { kind: 'ai', text: raw };
    return { kind: 'watch', query: what };
  }

  // A screen name on its own ("live tv", "settings").
  const alone = screenFor(said);
  if (alone === 'profiles') return { kind: 'profiles' };
  if (alone) return { kind: 'screen', screen: alone };

  return { kind: 'ai', text: raw };
}

// ── matching names ─────────────────────────────────────────────────────────

/** A provider's channel name without its decoration: "US| ESPN 2 FHD" → "espn 2". */
export const cleanChannelName = (name: string): string =>
  normalizeSpeech(
    name
      .replace(/^[A-Z]{2,3}\s*[|:-]\s*/i, '')          // "US| ", "UK: "
      .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')            // "[VIP]", "(East)"
      .replace(/\b(?:fhd|uhd|hd|sd|4k|hevc|h265|backup|vip|east|west|raw)\b/gi, ' '),
  );

const spokenNumbers: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
const digits = (s: string) => s.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (w) => spokenNumbers[w]).replace(/\s+/g, ' ').trim();
const squash = (s: string) => s.replace(/\s+/g, '');

/** How well a spoken name fits a candidate (0 = not at all). */
export function nameScore(spoken: string, candidate: string): number {
  const a = digits(normalizeSpeech(spoken));
  const b = digits(candidate);
  if (!a || !b) return 0;
  if (a === b || squash(a) === squash(b)) return 100;
  if (b.startsWith(`${a} `)) return 80 - Math.min(20, b.length - a.length);
  if (squash(b).startsWith(squash(a))) return 70 - Math.min(20, b.length - a.length);
  if (` ${b} `.includes(` ${a} `)) return 55 - Math.min(20, b.length - a.length);
  if (a.length >= 4 && squash(b).includes(squash(a))) return 40;
  return 0;
}

/** Below this a name only turns up inside another ("espn" in "watchespn"). */
const MIN_CHANNEL_SCORE = 50;
/** A country some providers put before the name with just a space ("USA
 *  ESPN", "UK SKY ONE"), and picture details cleanChannelName keeps. A name is
 *  also scored without them, and without "the" and "channel", which the
 *  parser takes off what was said ("put on the Weather Channel" → "the
 *  weather", "Disney Channel" → "disney"). */
const COUNTRY_WORD = /^(?:us|usa|uk|ca|can|au|nz|ie)\s+(?=\S)/;
const PICTURE_WORDS = /\b(?:\d{3,4}p|\d{2}\s?fps|alt|multi)\b/g;
const NAME_WORDS = /^the\s+(?=\S)|^channel\s+(?=\S)|(\S)\s+channel$/g;

/**
 * The channel a spoken name means, or null when none clearly does: nothing
 * scores well enough, or only part of a name was said and more than one
 * channel fits it ("usa": USA A&E, USA Network…; "fox": FOX News, FOX Sports
 * 1). Then nothing plays — the first of a list is only a guess — unless just
 * one of them is a favourite. The same channel in several qualities or on
 * several lines counts once, the first (or a favourite) standing for it.
 */
export function bestChannel<T extends { name: string; stream_id: number }>(spoken: string, channels: T[], favourites?: Set<number>): T | null {
  const byName = new Map<string, { ch: T; score: number; fav: boolean }>();
  for (const ch of channels) {
    const name = cleanChannelName(ch.name);
    const bare = name.replace(COUNTRY_WORD, '').replace(PICTURE_WORDS, ' ').replace(/\s+/g, ' ').trim().replace(NAME_WORDS, '$1');
    const score = Math.max(nameScore(spoken, name), bare === name ? 0 : nameScore(spoken, bare));
    if (score < MIN_CHANNEL_SCORE) continue;
    const fav = !!favourites?.has(ch.stream_id);
    const had = byName.get(bare);
    if (!had || score > had.score || (score === had.score && fav && !had.fav)) byName.set(bare, { ch, score, fav });
  }
  const fits = [...byName.values()];
  const exact = fits.find((c) => c.score === 100 && c.fav) ?? fits.find((c) => c.score === 100);
  if (exact) return exact.ch;
  const favs = fits.filter((c) => c.fav);
  const pool = favs.length ? favs : fits;
  return pool.length === 1 ? pool[0].ch : null;
}

/** The channel a name asked for by voice means, from every line's full list,
 *  or null (see bestChannel). Providers name channels "US| ESPN FHD": the
 *  name's first word picks the candidates, the whole name ranks them ("the"
 *  is part of none: "the weather channel"). */
export function channelForName<T extends { name: string; stream_id: number }>(spoken: string, lists: Iterable<T[]>, favourites?: Set<number>): T | null {
  const want = spoken.trim().replace(/^the\s+/i, '') || spoken.trim();
  const first = squash((want.split(/\s+/)[0] || want).toLowerCase());
  if (!first) return null;
  const candidates: T[] = [];
  for (const list of lists) {
    for (const ch of list) if (squash(String(ch.name ?? '').toLowerCase()).includes(first)) candidates.push(ch);
  }
  return bestChannel(want, candidates, favourites);
}

/** The installed app a spoken name means. */
export function bestApp<T extends { appName: string; packageName: string }>(spoken: string, apps: T[]): T | null {
  let best: { app: T; score: number } | null = null;
  for (const app of apps) {
    const score = nameScore(spoken, normalizeSpeech(app.appName));
    if (score > 0 && (!best || score > best.score)) best = { app, score };
  }
  return best && best.score >= 40 ? best.app : null;
}

/** A Plex title close enough to what was said to open straight away. */
export function titleMatches(spoken: string, title: string): boolean {
  const a = normalizeSpeech(spoken).replace(/^the\s+/, '');
  const b = normalizeSpeech(title).replace(/^the\s+/, '');
  return !!a && (a === b || squash(a) === squash(b) || (b.startsWith(`${a} `) && a.length >= b.length * 0.6));
}
