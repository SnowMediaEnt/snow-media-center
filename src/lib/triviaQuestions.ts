import { supabase } from '@/integrations/supabase/client';

export type TriviaCategory = 'snow' | 'science' | 'screen' | 'world' | 'music' | 'sports' | 'nature';
export type SnowTriviaTopic = 'devices' | 'service' | 'app' | 'history';
export type TriviaDifficulty = 'easy' | 'standard' | 'expert';
export type TriviaQuestionOrigin = 'bundled' | 'published' | 'cached';

export interface TriviaQuestion {
  id: string;
  category: TriviaCategory;
  categoryLabel: string;
  prompt: string;
  answers: [string, string, string, string];
  correct: number;
  fact: string;
  points?: number;
  topic?: SnowTriviaTopic;
  difficulty?: TriviaDifficulty;
  origin?: TriviaQuestionOrigin;
}

interface PublishedTriviaQuestion {
  id: unknown;
  topic: unknown;
  categoryLabel: unknown;
  prompt: unknown;
  answers: unknown;
  correct: unknown;
  fact: unknown;
  points: unknown;
  difficulty?: unknown;
}

interface PublishedTriviaResponse {
  ok?: boolean;
  questions?: PublishedTriviaQuestion[];
  updatedAt?: string | null;
}

interface CachedTriviaPayload {
  savedAt: number;
  questions: TriviaQuestion[];
}

export interface SnowTriviaLoadResult {
  questions: TriviaQuestion[];
  source: 'network' | 'cache' | 'bundled';
  updatedAt: string | null;
}

const CACHE_KEY = 'smc-snow-trivia-questions-v1';
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const VALID_TOPICS = new Set<SnowTriviaTopic>(['devices', 'service', 'app', 'history']);
const VALID_DIFFICULTIES = new Set<TriviaDifficulty>(['easy', 'standard', 'expert']);

const snowQuestion = (
  id: string,
  topic: SnowTriviaTopic,
  prompt: string,
  answers: [string, string, string, string],
  correct: number,
  fact: string,
  difficulty: TriviaDifficulty = 'easy',
): TriviaQuestion => ({
  id: `snow-${id}`,
  category: 'snow',
  categoryLabel: `Snow Media · ${topic[0].toUpperCase()}${topic.slice(1)}`,
  prompt,
  answers,
  correct,
  fact,
  points: 100,
  topic,
  difficulty,
  origin: 'bundled',
});

/**
 * A curated, offline-safe bank based on features that ship in this app.
 * Published questions extend this bank; the raw Snow AI knowledge bucket is
 * deliberately never read by the TV client.
 */
export const SNOW_MEDIA_TRIVIA_FALLBACK: TriviaQuestion[] = [
  snowQuestion(
    'remote-select',
    'devices',
    'Which Fire TV remote button opens the item highlighted on screen?',
    ['Menu', 'Back', 'OK / center', 'Volume up'],
    2,
    'The D-pad moves the highlight, and the OK or center button activates it.',
  ),
  snowQuestion(
    'reduced-fx',
    'devices',
    'What does Reduced FX do in the Snow Media game lounge?',
    ['Raises the volume', 'Uses lighter visual effects', 'Changes the language', 'Signs out'],
    1,
    'Reduced FX keeps gameplay clear while using simpler animation on lower-powered TV devices.',
  ),
  snowQuestion(
    'four-k-speed',
    'devices',
    'For consistent 4K streaming, what connection speed does the in-app test recommend?',
    ['At least 5 Mbps', 'At least 10 Mbps', 'At least 25 Mbps', 'At least 100 Mbps'],
    2,
    'Snow Media Center recommends at least 25 Mbps for consistent 4K streaming.',
  ),
  snowQuestion(
    'hd-speed',
    'devices',
    'Below which speed does Snow Media Center warn that HD may buffer?',
    ['5 Mbps', '15 Mbps', '40 Mbps', '75 Mbps'],
    1,
    'The app warns that speeds below 15 Mbps can cause buffering for HD streams.',
  ),
  snowQuestion(
    'player-sections',
    'service',
    'Which set names the main kinds of content available in the Snow Media Player?',
    ['Radio, podcasts, books', 'Live TV, movies, series', 'Photos, mail, maps', 'Shopping, banking, weather'],
    1,
    'The Player brings Live TV, movies, and series together in one TV-friendly experience.',
  ),
  snowQuestion(
    'streaming-login',
    'service',
    'Your Dreamstreams or Vibez username and password are primarily used for what?',
    ['The streaming Player', 'A social profile', 'Game difficulty', 'TV picture settings'],
    0,
    'Dreamstreams and Vibez credentials are streaming logins used by the Player.',
  ),
  snowQuestion(
    'account-difference',
    'service',
    'Is a Snow Media website account the same thing as a streaming login?',
    ['Yes, always', 'Only on weekends', 'No, they serve different purposes', 'Only on Fire TV'],
    2,
    'The website account and streaming login are separate, so changing one does not replace the other.',
  ),
  snowQuestion(
    'billing-account',
    'service',
    'What is the billing account area designed to manage?',
    ['Plans, renewals, and trials', 'Remote batteries', 'TV brightness', 'Trivia answers'],
    0,
    'The billing area is for plans, renewals, trials, gift codes, and related account tasks.',
  ),
  snowQuestion(
    'website-account',
    'service',
    'What can a free Snow Media website account help you keep track of?',
    ['TV volume only', 'Purchases, support replies, and profile details', 'Remote pairing only', 'HDMI inputs'],
    1,
    'The optional website account connects purchases, support tickets and replies, messages, and profile details.',
  ),
  snowQuestion(
    'support-speed-test',
    'app',
    'What built-in Snow Media tool can help diagnose a buffering connection?',
    ['A stopwatch', 'The Internet Speed Test', 'A calculator', 'The game leaderboard'],
    1,
    'The built-in Internet Speed Test measures the connection on the same device used for streaming.',
  ),
  snowQuestion(
    'snow-ai',
    'app',
    'Where would you go in Snow Media Center to ask the Snow Media AI for help?',
    ['Support', 'Game payout settings', 'TV input menu', 'Device wallpaper'],
    0,
    'Snow Media AI lives with the other help tools in the Support experience.',
  ),
  snowQuestion(
    'install-apps',
    'app',
    'What is the Main Apps area for?',
    ['Installing and opening supported apps', 'Changing the TV panel', 'Editing trivia scores', 'Buying a remote'],
    0,
    'Main Apps helps viewers download, install, update, and open supported companion apps.',
  ),
  snowQuestion(
    'hold-channel',
    'app',
    'What shortcut opens favorite and report options for a Live TV channel?',
    ['Hold the channel', 'Press volume down twice', 'Open billing', 'Restart the television'],
    0,
    'Pressing and holding a channel opens quick favorite and report actions with the channel already filled in.',
  ),
  snowQuestion(
    'version-102',
    'history',
    'Which tool was added in Snow Media Center version 1.0.2?',
    ['Internet Speed Test', 'A photo printer', 'A weather station', 'A web browser'],
    0,
    'Version 1.0.2 added the built-in Speed Test and interactive Buffering Guide.',
  ),
  snowQuestion(
    'version-151',
    'history',
    'Which playful currencies arrived with the upgraded Game Room in version 1.5.1?',
    ['Stars and hearts', 'Snow Gems and Snow Coins', 'Tickets and tokens', 'Gold and silver bars'],
    1,
    'Version 1.5.1 introduced Snow Gems, bonus Snow Coins, and a TV-fitted Game Room.',
  ),
  snowQuestion(
    'version-157',
    'history',
    'Which classic TV feature arrived in Snow Media Center version 1.5.7?',
    ['A cable-grid Guide', 'A DVD tray', 'A radio antenna', 'Picture printing'],
    0,
    'Version 1.5.7 added the full EPG Guide under Live TV.',
  ),
  snowQuestion(
    'version-158',
    'history',
    'What new viewing area was introduced in version 1.5.8?',
    ['Movies & Shows powered by Plex', 'Printed TV listings', 'FM radio', 'Photo slides only'],
    0,
    'Version 1.5.8 introduced Movies & Shows powered by Plex, plus in-app requests.',
  ),
  snowQuestion(
    'version-160',
    'history',
    'What did Multi-Screen add in version 1.6?',
    ['Two or four channels at once', 'A second billing account', 'Four trivia answers', 'A new remote battery'],
    0,
    'Multi-Screen added layouts for watching two or four channels at the same time.',
  ),
  // Reviewed against the shipped Account Chooser, Buffering Guide, Speed Test,
  // Player and release notes. Keep these offline so Expert is real even before
  // the private knowledge-base documents are curated into published rows.
  snowQuestion('speed-recovery', 'devices',
    'The in-app speed test shows 11 Mbps on your TV box. What does the Buffering Guide suggest trying?',
    ['Change trivia mode', 'Use 5 GHz Wi-Fi, move closer, or connect Ethernet', 'Raise the TV volume', 'Turn on subtitles'], 1,
    'The Buffering Guide flags under 15 Mbps on the streaming device and suggests 5 GHz Wi-Fi, moving closer, or Ethernet.', 'standard'),
  snowQuestion('speed-targets', 'devices',
    'Which pair matches Snow Media’s in-app download-speed guidance?',
    ['HD 5 / 4K 10 Mbps', 'HD 15 / 4K 25 Mbps', 'HD 25 / 4K 15 Mbps', 'HD 50 / 4K 100 Mbps'], 1,
    'The Buffering Guide uses 15 Mbps for HD; the Speed Test recommends at least 25 Mbps for consistent 4K.', 'standard'),
  snowQuestion('speed-device', 'devices',
    'Why run the Speed Test on the TV box that is buffering?',
    ['It measures that device’s connection', 'It increases your plan speed', 'It changes the HDMI input', 'It clears the TV cache'], 0,
    'A phone’s speed can differ from the connection the streaming box actually uses.', 'standard'),
  snowQuestion('slow-box-visuals', 'devices',
    'If game animation is heavy on an older TV box, which lounge setting keeps play but lightens effects?',
    ['Higher resolution', 'Reduced FX', 'Extra channels', 'Auto sign-out'], 1,
    'Reduced FX uses simpler game effects without changing the game rules.', 'standard'),
  snowQuestion('email-route', 'service',
    'In the streaming sign-in screen, a username formatted as an email connects to which service?',
    ['Dreamstreams', 'VibezTV', 'Plex requests', 'Snow Mail'], 1,
    'The Player sign-in form routes email usernames to VibezTV.', 'standard'),
  snowQuestion('name-route', 'service',
    'In the same streaming sign-in screen, a non-email username connects to which service?',
    ['Dreamstreams', 'VibezTV', 'A website account', 'The game leaderboard'], 0,
    'The Player sign-in form routes other usernames to Dreamstreams.', 'standard'),
  snowQuestion('account-jobs', 'service',
    'Which account signs you into the Player rather than tracking website purchases and support?',
    ['Snow Media website account', 'Dreamstreams or Vibez login', 'Game name', 'Support ticket number'], 1,
    'The streaming login is for the Player; the separate website account covers purchases, support and profile details.', 'standard'),
  snowQuestion('billing-tools', 'service',
    'Where would you redeem a gift code or renew a Dreamstreams plan?',
    ['Billing account area', 'TV Trivia settings', 'Live TV Guide', 'Remote control menu'], 0,
    'The billing account area handles plans, renewals, trials and gift codes.', 'standard'),
  snowQuestion('one-channel-report', 'app',
    'Only one Live TV channel has a problem. What is the Buffering Guide’s first branch?',
    ['Report that channel', 'Replace the TV', 'Clear every app’s data', 'Change the game difficulty'], 0,
    'The guide separates one bad channel or title from widespread buffering and points a single-item issue to reporting.', 'standard'),
  snowQuestion('refresh-order', 'app',
    'Which order does the Buffering Guide use to refresh a misbehaving streaming app?',
    ['Clear data, uninstall, reboot', 'Force Stop, then Clear Cache', 'Turn off the TV, then change input', 'Delete your account, then sign in'], 1,
    'The guide’s refresh step says Force Stop, then Clear Cache, then return to the guide.', 'standard'),
  snowQuestion('channel-shortcut', 'app',
    'What can you open by pressing and holding a focused Live TV channel?',
    ['Favorites and a prefilled report', 'The billing checkout', 'A movie request', 'The Wi-Fi password'], 0,
    'The channel shortcut opens favorite and report actions with category and channel filled in.', 'standard'),
  snowQuestion('native-multiscreen', 'app',
    'Why does the Multi-Screen web preview show an install-app message?',
    ['It needs the native Fire TV / Android players', 'It requires a DVD drive', 'It only works on a phone', 'It is part of the trivia game'], 0,
    'Multi-Screen uses native video players for two or four simultaneous channels.', 'standard'),
  snowQuestion('release-guide', 'history',
    'Which release paired the cable-grid EPG Guide with Saved Accounts and Appearance settings?',
    ['1.0.2', '1.5.1', '1.5.7', '1.6.1'], 2,
    'Version 1.5.7 added the full Guide, Saved Accounts and Appearance options.', 'standard'),
  snowQuestion('release-plex-request', 'history',
    'Which release brought Plex Movies & Shows and an in-app Request tab together?',
    ['1.0.4', '1.5.6', '1.5.8', '1.6.1'], 2,
    'Version 1.5.8 introduced Movies & Shows powered by Plex and the Request tab.', 'standard'),
  snowQuestion('release-channel-hold', 'history',
    'Which release added the press-and-hold channel shortcut for favorites and reporting?',
    ['1.0.2', '1.5.6', '1.5.9', '1.6.1'], 1,
    'Version 1.5.6 added the channel hold shortcut with the report details prefilled.', 'standard'),
  snowQuestion('release-support-hub', 'history',
    'Which release brought tickets, AI chat, videos and the Buffering Guide together under Support?',
    ['1.0.4', '1.1.0', '1.5.8', '1.6.1'], 1,
    'The 1.1.0 release notes describe the unified Support area.', 'standard'),
  snowQuestion('twenty-meg', 'devices',
    'Your box measures 20 Mbps. Which reading best matches the app’s HD and 4K advice?',
    ['Below the 15 Mbps HD target', 'Above the HD target, below the 4K recommendation', 'Above both the HD and 4K targets', 'Exactly at the 4K recommendation'], 1,
    '20 Mbps clears the 15 Mbps HD guidance but falls short of the 25 Mbps recommendation for consistent 4K.', 'expert'),
  snowQuestion('phone-vs-box', 'devices',
    'Your phone tests fast but the streaming box tests at 9 Mbps. Which result should guide troubleshooting?',
    ['The phone result', 'The box result', 'The average of both tests', 'The router’s advertised speed'], 1,
    'The Buffering Guide asks for the speed on the device doing the streaming, because its Wi-Fi path may differ.', 'expert'),
  snowQuestion('vpn-under-target', 'devices',
    'With a VPN connected, the box still tests below 15 Mbps. What does the Buffering Guide suggest next?',
    ['Pick a closer VPN city and retest', 'Try a more distant VPN city first', 'Switch straight to 4K quality', 'Treat the phone’s speed as the box’s result'], 0,
    'The VPN step advises a closer VPN city and another speed test when the result stays under 15 Mbps.', 'expert'),
  snowQuestion('content-bar-performance', 'devices',
    'An older box feels sluggish with the home Content Bar running. Which app setting can reduce that load?',
    ['Disable the Content Bar in Settings', 'Change the Player audio track', 'Hide one Plex library', 'Refresh the Live TV channel list'], 0,
    'The app’s release guidance points older or slower devices to the Content Bar toggle in Settings.', 'expert'),
  snowQuestion('two-accounts-case', 'service',
    'A viewer can open their Snow Media website purchases but not Live TV. Which credential should they check?',
    ['Their Dreamstreams or Vibez streaming login', 'Their website purchase-history login only', 'Their Plex library PIN', 'Their game leaderboard name'], 0,
    'Website purchases and the Player use separate account paths; the Player needs the streaming login.', 'expert'),
  snowQuestion('email-and-billing', 'service',
    'A viewer enters an email-style streaming username and wants to renew a Dreamstreams plan. Which pairing is right?',
    ['Email routes to Vibez; plan renewal is in Billing', 'Email routes to Dreamstreams; renew in Player', 'Email routes to Vibez; renew in Live TV Guide', 'Email routes to a website account; renew in Player'], 0,
    'Email-style Player usernames route to VibezTV, while Dreamstreams plan tasks live in the billing account area.', 'expert'),
  snowQuestion('account-chooser-effect', 'service',
    'What else happens when you sign in with Dreamstreams or Vibez through My Account?',
    ['The Player is signed in too', 'The website account password is replaced', 'The Dreamstreams plan renews automatically', 'Plex links without its own sign-in'], 0,
    'The account chooser says the Dreamstreams/Vibez sign-in also signs the viewer into the Player.', 'expert'),
  snowQuestion('vpn-service-exception', 'service',
    'Which streaming service does the Buffering Guide explicitly say its VPN step does not work with?',
    ['Dreamstreams', 'VibezTV', 'Plex', 'All three'], 1,
    'The guide’s VPN note specifically excludes VibezTV.', 'expert'),
  snowQuestion('one-vs-all', 'app',
    'One channel fails, but the others play. Which action is more targeted than changing the whole network setup?',
    ['Report the affected channel', 'Run a VPN test for every service', 'Clear every app’s cache', 'Refresh the entire channel list first'], 0,
    'The Buffering Guide first distinguishes an isolated channel or title issue from a broader connection problem.', 'expert'),
  snowQuestion('guide-sequence', 'app',
    'After checking whether the issue affects one item or many, what is the guide’s next troubleshooting sequence?',
    ['Refresh app, test speed, then consider VPN', 'VPN, test speed, then refresh app', 'Test speed, renew plan, then refresh app', 'Refresh app, switch accounts, then request a title'], 0,
    'The Buffering Guide goes from one-or-all to app refresh, device speed and finally VPN testing.', 'expert'),
  snowQuestion('plex-vs-live', 'app',
    'A requested movie is missing from Plex, but Live TV works. Which Player area was added for that task?',
    ['The Request tab', 'Update Channels', 'Channel Report', 'The EPG Guide'], 0,
    'The Movies & Shows release added an in-app Request tab for movies and shows.', 'expert'),
  snowQuestion('four-players', 'app',
    'Why can the installed TV app run four-channel Multi-Screen when the web preview cannot?',
    ['It uses four native video players', 'It uses four browser picture-in-picture windows', 'It preloads four Plex libraries', 'It shares one web video element across tiles'], 0,
    'Multi-Screen’s native implementation runs up to four video-player tiles; the web preview cannot provide that path.', 'expert'),
  snowQuestion('release-157-bundle', 'history',
    'Which 1.5.7 feature set is correctly matched?',
    ['EPG Guide, Saved Accounts, Appearance', 'Multi-Screen, player volume slider, Plex quality selector', 'Plex Request tab, Movies & Shows, Content Bar links', 'Plex detail pages, episode browsing, subtitle downloads'], 0,
    'The 1.5.7 notes group the cable-grid Guide, Saved Accounts and Appearance settings.', 'expert'),
  snowQuestion('release-158-player', 'history',
    'What changed together in the Player in version 1.5.8?',
    ['Live TV / Movies & Shows choice plus in-app requests', 'EPG Guide plus Saved Accounts', 'Multi-Screen plus a player volume slider', 'Plex detail pages plus episode browsing'], 0,
    'The 1.5.8 notes describe the two Player choices, Plex Movies & Shows and a Request tab.', 'expert'),
  snowQuestion('release-159-plex', 'history',
    'Which Plex improvements belong to version 1.5.9 rather than the first Movies & Shows release?',
    ['Detail pages, episode browsing and audio/subtitle controls', 'The first Movies & Shows choice and Request tab', 'Four-channel Multi-Screen and a quality selector', 'The cable-grid Guide and Saved Accounts'], 0,
    'Version 1.5.9 expanded Plex detail, episode and playback controls after Movies & Shows arrived in 1.5.8.', 'expert'),
  snowQuestion('release-161-playback', 'history',
    'Which pair appears in the 1.6.1 playback notes?',
    ['Plex audio fix and 10-second movie pre-buffer', 'First Plex Movies & Shows choice and Request tab', 'Multi-Screen and player volume slider', 'EPG Guide and Saved Accounts'], 0,
    'Version 1.6.1 lists a Plex missing-audio fix and 10 seconds of movie pre-buffering.', 'expert'),
];

const isShortText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;

const normalizePublishedQuestion = (
  value: PublishedTriviaQuestion,
  origin: 'published' | 'cached',
): TriviaQuestion | null => {
  if (!isShortText(value.id, 120)) return null;
  if (!isShortText(value.prompt, 300) || !isShortText(value.fact, 500)) return null;
  if (!isShortText(value.categoryLabel, 80)) return null;
  if (!VALID_TOPICS.has(value.topic as SnowTriviaTopic)) return null;
  if (value.difficulty !== undefined && !VALID_DIFFICULTIES.has(value.difficulty as TriviaDifficulty)) return null;
  if (!Array.isArray(value.answers) || value.answers.length !== 4 || !value.answers.every((answer) => isShortText(answer, 120))) return null;
  if (!Number.isInteger(value.correct) || Number(value.correct) < 0 || Number(value.correct) > 3) return null;
  const points = Number(value.points);
  if (!Number.isInteger(points) || points < 25 || points > 500) return null;

  return {
    id: String(value.id),
    category: 'snow',
    categoryLabel: value.categoryLabel.trim(),
    prompt: value.prompt.trim(),
    answers: value.answers.map((answer) => String(answer).trim()) as [string, string, string, string],
    correct: Number(value.correct),
    fact: value.fact.trim(),
    points,
    topic: value.topic as SnowTriviaTopic,
    difficulty: (value.difficulty as TriviaDifficulty | undefined) ?? 'easy',
    origin,
  };
};

const mergeWithFallback = (published: TriviaQuestion[]): TriviaQuestion[] => {
  const merged = new Map<string, TriviaQuestion>();
  SNOW_MEDIA_TRIVIA_FALLBACK.forEach((question) => merged.set(question.id, question));
  published.forEach((question) => merged.set(question.id, question));
  return Array.from(merged.values());
};

const readCache = (): TriviaQuestion[] => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CachedTriviaPayload;
    if (!Number.isFinite(parsed.savedAt) || Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) return [];
    if (!Array.isArray(parsed.questions)) return [];
    return parsed.questions
      .map((question) => normalizePublishedQuestion(question as unknown as PublishedTriviaQuestion, 'cached'))
      .filter((question): question is TriviaQuestion => question !== null);
  } catch {
    return [];
  }
};

const writeCache = (questions: TriviaQuestion[]) => {
  try {
    const payload: CachedTriviaPayload = { savedAt: Date.now(), questions };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable in a private WebView; the bundled bank still works.
  }
};

/**
 * Loads only explicitly published trivia rows through a narrow Edge Function.
 * Network data is merged with the bundled bank and cached for offline boxes.
 */
export const loadSnowTriviaQuestions = async (): Promise<SnowTriviaLoadResult> => {
  const cached = readCache();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      questions: mergeWithFallback(cached),
      source: cached.length > 0 ? 'cache' : 'bundled',
      updatedAt: null,
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke<PublishedTriviaResponse>('trivia-questions', {
      body: { limit: 200 },
    });
    if (error || !data?.ok || !Array.isArray(data.questions)) throw error ?? new Error('Invalid trivia response');

    const published = data.questions
      .map((question) => normalizePublishedQuestion(question, 'published'))
      .filter((question): question is TriviaQuestion => question !== null);

    if (published.length > 0) writeCache(published);
    return {
      questions: mergeWithFallback(published.length > 0 ? published : cached),
      source: published.length > 0 ? 'network' : cached.length > 0 ? 'cache' : 'bundled',
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    };
  } catch {
    return {
      questions: mergeWithFallback(cached),
      source: cached.length > 0 ? 'cache' : 'bundled',
      updatedAt: null,
    };
  }
};
