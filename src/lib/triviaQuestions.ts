import { supabase } from '@/integrations/supabase/client';

export type TriviaCategory = 'snow' | 'science' | 'screen' | 'world' | 'music' | 'sports' | 'nature';
export type SnowTriviaTopic = 'devices' | 'service' | 'app' | 'history';
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

const snowQuestion = (
  id: string,
  topic: SnowTriviaTopic,
  prompt: string,
  answers: [string, string, string, string],
  correct: number,
  fact: string,
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
      body: { limit: 100 },
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

