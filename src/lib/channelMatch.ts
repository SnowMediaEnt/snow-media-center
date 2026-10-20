/**
 * The same channel on another service. When a channel won't start on one
 * line, Live TV looks for it on the viewer's other line (useChannelFailover);
 * this module decides what counts as "the same channel". Nothing here talks
 * to a panel.
 *
 * Providers decorate names differently ("US| ESPN FHD", "USA: ESPN ᴴᴰ",
 * "[US] ESPN (Backup)"), so names are compared after the decoration is taken
 * off. Anything that makes it another channel stays: East / West, numbers
 * ("ESPN 2"), "+1", "International". Playing the wrong channel is worse than
 * showing the error, so every rule here leans towards "no match": names must
 * be equal once cleaned, and a doubtful case returns null instead of a guess.
 * - The guide id (epg_channel_id) is never enough: panels put sub-brands on
 *   the parent's id (HBO Family on HBO's, NBC Sports Chicago on NBC's).
 * - Event channels ("PPV 1", "NFL Game 3", "ESPN+ 05", anything in a PPV /
 *   Events category) never match: each provider puts a different event
 *   behind the same number.
 */

/** A picture quality a name carries: what a copy is preferred by. */
export type ChannelQuality = 'uhd' | 'fhd' | 'hd' | 'sd';

export interface ChannelLike {
  name: string;
}

/** A name, cleaned for comparing, and what was taken off it that still matters. */
export interface ChannelKey {
  /** The cleaned name ("espn 2"); '' when nothing is left (a name of tags only). */
  key: string;
  /** The country or language the provider put before it, normalised ("us"), or null. */
  region: string | null;
  quality: ChannelQuality | null;
}

// Country and language codes providers put before a name, and what each one
// means (USA and US are the same feed). Only these count in the forms where a
// real name could look the same ("ABC - East", "CNN: Live"); in brackets or
// pipes ("[VIP]", "|US|") any short tag is decoration.
const REGIONS: Record<string, string> = {
  us: 'us', usa: 'us', uk: 'uk', gb: 'uk', gbr: 'uk', ca: 'ca', can: 'ca', au: 'au', aus: 'au', nz: 'nz', ie: 'ie', irl: 'ie',
  mx: 'mx', mex: 'mx', es: 'es', esp: 'es', sp: 'es', fr: 'fr', fra: 'fr', de: 'de', ger: 'de', deu: 'de', it: 'it', ita: 'it',
  pt: 'pt', por: 'pt', br: 'br', bra: 'br', nl: 'nl', be: 'be', ch: 'ch', at: 'at', se: 'se', swe: 'se', no: 'no', nor: 'no',
  dk: 'dk', fi: 'fi', fin: 'fi', pl: 'pl', pol: 'pl', ro: 'ro', gr: 'gr', tr: 'tr', tur: 'tr', ru: 'ru', rus: 'ru', ua: 'ua',
  il: 'il', za: 'za', ng: 'ng', in: 'in', ind: 'in', pk: 'pk', ph: 'ph', jp: 'jp', kr: 'kr', cn: 'cn', hk: 'hk',
  ar: 'ar', arg: 'ar', co: 'co', col: 'co', cl: 'cl', pe: 'pe', ve: 've', ec: 'ec', pr: 'pr', jm: 'jm',
  lat: 'latam', en: 'en', eng: 'en',
};
// At the end of a name a code is often a US state or a Canadian province, not
// a country ("CNN (IN)", "KABC (CA)", "ABC (LA)"): those stay part of the name.
const STATES = new Set(('al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd '
  + 'oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc pr ab bc mb nb nl ns nt nu on pe qc sk yt').split(' '));
/** A language tag says nothing about the feed's country: "EN| CNN" may be the US one. */
const ANY_REGION = new Set(['en']);

const SEP = '[:|\\-\u2013\u2014\u2022\u00b7\u25ba\u27a4\u25b6\u00bb/]';
// "|US| ", "[US] ", "(US) " — any short tag at the start.
const BRACKET_PREFIX = /^\s*(?:\|\s*([a-z]{2,3})\s*\||\[\s*([a-z]{2,3})\s*\]|\(\s*([a-z]{2,3})\s*\))\s*/;
// "US: ", "US | ", "USA - ", "UK• " — a known code and a separator.
const CODE_PREFIX = new RegExp(`^\\s*([a-z]{2,3})\\s*${SEP}+\\s*`);
// "ESPN (US)", "ESPN [UK]" — a known code in brackets at the end (not a state's).
const CODE_SUFFIX = /\s*(?:\[\s*([a-z]{2,3})\s*\]|\(\s*([a-z]{2,3})\s*\))\s*$/;

// Superscript letters and digits ("ESPNᴴᴰ"): spaced off the name before they
// are turned into plain letters (NFKD), so "ᴴᴰ" becomes the tag "hd".
const SUPERSCRIPT_RUN = /([\u02b0-\u02ff\u1d2c-\u1d6a\u1d9b-\u1dbf\u2070-\u209f]+)/g;
// Punctuation, symbols, arrows, emoji halves: become spaces. "+" is kept (a
// "+1" channel is another channel), and letters of every script are kept
// (an Arabic name is a name).
const PUNCT = /[!-*,-/:-@[-`{-~\u00a0-\u00bf\u00d7\u00f7\u2000-\u206f\u2190-\u2bff\u3000-\u303f\ud800-\udfff]/g;
// An emoji's colour/text selector: dropped with no space, it belongs to the sign before it.
const VARIATION = /\ufe0e|\ufe0f/g;
const COMBINING = /[\u0300-\u036f]/g;

// Picture tags: never part of what the channel is.
const QUALITY_TAG = /^(?:hd|fhd|uhd|sd|4k|8k|hdr|hevc|[hx]\.?26[45]|\d{3,4}[pi]|\d{2,3}fps|hq)$/;
// "Backup", "Backup 2": a second feed of the same channel, not channel 2.
// ("Raw" is not one: "WWE Raw" is not "WWE".)
const FEED_TAG = /^(?:backup|bkp)\d*$/;
const QUALITY_OF: Array<[RegExp, ChannelQuality]> = [
  [/^(?:uhd|4k|8k|2160[pi])$/, 'uhd'],
  [/^(?:fhd|1080[pi])$/, 'fhd'],
  [/^(?:hd|720[pi])$/, 'hd'],
  [/^(?:sd|480[pi]|576[pi])$/, 'sd'],
];

const DIGITS = /^\d+$/;

/** Clean a provider's channel name for comparing (see the module comment). */
export function channelKey(name: string | null | undefined): ChannelKey {
  let s = String(name ?? '');
  s = s.replace(SUPERSCRIPT_RUN, ' $1 ');
  try { s = s.normalize('NFKD'); } catch { /* very old engine: compare as is */ }
  s = s.replace(COMBINING, '').replace(VARIATION, '').toLowerCase();

  // Country / language tags before the name, up to a few deep ("|US| [VIP] ESPN").
  let region: string | null = null;
  for (let i = 0; i < 3; i++) {
    const b = s.match(BRACKET_PREFIX);
    if (b) {
      const code = b[1] || b[2] || b[3];
      if (REGIONS[code] && !region) region = REGIONS[code];
      s = s.slice(b[0].length);
      continue;
    }
    const c = s.match(CODE_PREFIX);
    if (c && REGIONS[c[1]]) {
      if (!region) region = REGIONS[c[1]];
      s = s.slice(c[0].length);
      continue;
    }
    break;
  }
  const tail = s.match(CODE_SUFFIX);
  const tailCode = tail ? tail[1] || tail[2] : '';
  if (tail && REGIONS[tailCode] && !STATES.has(tailCode)) {
    if (!region) region = REGIONS[tailCode];
    s = s.slice(0, tail.index);
  }

  // "H.265" is one tag, not "h" and "265".
  s = s.replace(/\b([hx])\.(26[45])\b/g, '$1$2');
  s = s.replace(/\+/g, ' + ').replace(PUNCT, ' ');
  const words = s.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  let quality: ChannelQuality | null = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (QUALITY_TAG.test(w)) {
      if (!quality) for (const [re, q] of QUALITY_OF) if (re.test(w)) { quality = q; break; }
      continue;
    }
    // "60 FPS": the number goes with the tag.
    if (w === 'fps') { if (kept.length && DIGITS.test(kept[kept.length - 1])) kept.pop(); continue; }
    if (FEED_TAG.test(w)) {
      // "Backup 2" is the second backup, not channel 2.
      if (i + 1 < words.length && DIGITS.test(words[i + 1])) i++;
      continue;
    }
    kept.push(w);
  }
  // "ESPN2" and "ESPN 2", "FS1" and "FS 1": letters and digits apart.
  const key = kept.join(' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return { key, region, quality };
}

/** Two regions that say these are different feeds ("US:" and "UK:"). */
const regionsClash = (a: string | null, b: string | null): boolean =>
  !!a && !!b && a !== b && !ANY_REGION.has(a) && !ANY_REGION.has(b);

// What a copy is preferred by when there are several: the failed one's own
// quality first, then Full HD / HD, then an untagged one, then 4K (heavy on a
// small box when the point is a picture that starts), SD last.
const QUALITY_RANK: Record<string, number> = { fhd: 0, hd: 1, none: 2, uhd: 3, sd: 4 };

// A pure-ASCII name holds every word of its cleaned name as it is written
// (cleaning only removes and adds spaces), so one that lacks a word cannot
// be a match and is passed over without cleaning it. A full line-up is tens
// of thousands of names on a small box.
// eslint-disable-next-line no-control-regex
const NON_ASCII = /[^\x00-\x7f]/;

// ---- event channels -----------------------------------------------------

// Words that, followed by a number, name an event slot rather than a channel:
// "PPV 1", "NFL Game 3", "NBA 07: Lakers vs …", "Event 12", "DAZN 2".
const EVENT_WORDS = new Set([
  'ppv', 'event', 'events', 'evento', 'eventos', 'game', 'games', 'match', 'matches', 'fight', 'fights',
  'nfl', 'nba', 'wnba', 'nhl', 'mlb', 'mls', 'ncaa', 'ncaaf', 'ncaab', 'cfb', 'cbb', 'ufc', 'wwe', 'aew', 'boxing',
  'dazn', 'flo', 'flosports', 'flohockey', 'flowrestling', 'flofootball', 'flobaseball', 'peacock', 'paramount',
  'fubo', 'nascar', 'pga', 'ticket', 'innings', 'pass',
]);
// Followed by "+" and a number: "ESPN+ 05", "Paramount+ 3".
const PLUS_EVENT_WORDS = new Set(['espn', 'paramount', 'peacock', 'dazn', 'disney', 'mlb', 'nba', 'nhl']);
// A category of event slots (PPV, Events, Live Events, Sports Pass, Game Pass…).
const EVENT_CATEGORY = /\b(?:ppv|pay ?per ?view|events?|eventos?|evenements?|pass|sunday ticket|extra innings|center ice)\b/;

const isEventKey = (key: string): boolean => {
  const w = key.split(' ');
  for (let i = 0; i + 1 < w.length; i++) {
    if (EVENT_WORDS.has(w[i]) && DIGITS.test(w[i + 1])) return true;
    if (w[i + 1] === '+' && i + 2 < w.length && DIGITS.test(w[i + 2]) && (EVENT_WORDS.has(w[i]) || PLUS_EVENT_WORDS.has(w[i]))) return true;
  }
  return false;
};

/** A category whose name says it holds event slots (PPV, Events, a sports pass). */
export function isEventCategory(categoryName: string | null | undefined): boolean {
  if (!categoryName) return false;
  let s = String(categoryName);
  try { s = s.normalize('NFKD'); } catch { /* ignore */ }
  s = s.replace(COMBINING, '').toLowerCase().replace(/\+/g, ' + ').replace(PUNCT, ' ').replace(/\s+/g, ' ');
  return EVENT_CATEGORY.test(s);
}

/**
 * An event slot rather than a channel: its name ("PPV 1", "NFL Game 3",
 * "US: ESPN+ 05", "Event 12") or its category ("PPV", "Live Events"). Each
 * provider puts a different event behind the number, so these never match.
 */
export function isEventChannel(name: string | null | undefined, categoryName?: string | null): boolean {
  return isEventKey(channelKey(name).key) || isEventCategory(categoryName);
}

export interface FindOptions<T> {
  /** Channels never offered (a hidden category's, adult ones). */
  skip?: (c: T) => boolean;
  /** The name of a candidate's category: an event category's never match. */
  categoryOf?: (c: T) => string | null | undefined;
}

/**
 * The same channel as `want` in `candidates`, or null: the same cleaned
 * name, never across clashing country tags, never an event slot (see
 * isEventChannel; the caller checks the wanted one's category). Of several:
 * the failed one's own quality, then HD over SD, then the provider's order.
 */
export function findSameChannel<T extends ChannelLike>(want: ChannelLike, candidates: readonly T[], opts: FindOptions<T> = {}): T | null {
  const w = channelKey(want.name);
  if (!w.key || isEventKey(w.key)) return null;
  // The plain words of the wanted name: the quick test for each candidate.
  const probes = w.key.split(' ').filter((x) => /^[a-z0-9]+$/.test(x));
  const lacksAWord = (name: string): boolean => {
    if (!probes.length || NON_ASCII.test(name)) return false;
    const low = name.toLowerCase();
    for (const p of probes) if (low.indexOf(p) < 0) return true;
    return false;
  };

  let best: { c: T; rank: number } | null = null;
  for (const c of candidates) {
    if (!c || typeof c.name !== 'string' || lacksAWord(c.name)) continue;
    const k = channelKey(c.name);
    if (k.key !== w.key || regionsClash(w.region, k.region)) continue;
    if (opts.skip?.(c) || isEventCategory(opts.categoryOf?.(c))) continue;
    const rank = (k.quality === w.quality ? 0 : 10) + QUALITY_RANK[k.quality ?? 'none'];
    if (!best || rank < best.rank) best = { c, rank };
  }
  return best ? best.c : null;
}
