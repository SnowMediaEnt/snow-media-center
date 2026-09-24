// A Plex title asked for by voice or by the assistant ("watch Toy Story 5 in
// Plex", plex_title): what to search the server for, and which result it
// means. The request travels appActions.openPlexTitle → the Player
// (LiveTV.applyIntent) → PlexSection, as 'smc-plex-voice' in sessionStorage
// for a Plex that is not open yet and as the 'smc:plex-voice' event for one
// that is.
import type { PlexItem } from '@/lib/plex';
import { normalizeTitle } from '@/lib/plexFuzzy';

export interface PlexVoiceIntent {
  query: string;
  /** Open the title's page (false: show Search with the words typed). */
  open: boolean;
  /** When it was asked for (ms). A stored request is only good for a while. */
  at?: number;
}

export const PLEX_VOICE_KEY = 'smc-plex-voice';
export const PLEX_VOICE_EVENT = 'smc:plex-voice';
/** A stored request older than this was never picked up — Plex did not open,
 *  or opened on the blocked screen — and must not fire on a later visit. */
export const PLEX_VOICE_TTL_MS = 2 * 60 * 1000;

/** The stored request, if there is a fresh one. Looks without clearing: the
 *  caller clears once it has mounted (see appActions.peekIntent for why). */
export function peekPlexVoice(now = Date.now()): { intent: PlexVoiceIntent; raw: string } | null {
  try {
    const raw = sessionStorage.getItem(PLEX_VOICE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PlexVoiceIntent | null;
    if (!v || typeof v.query !== 'string' || !v.query.trim()) return null;
    if (typeof v.at === 'number' && now - v.at > PLEX_VOICE_TTL_MS) return null;
    return { intent: { query: v.query, open: !!v.open, at: v.at }, raw };
  } catch { return null; }
}

/** What to search for: "toy story 5 in plex" → "toy story 5". The words
 *  that only say where to look are not part of any title. */
export function plexVoiceQuery(q: string): string {
  const t = q.trim().replace(/[.!?]+$/, '');
  const bare = t.replace(/\s+(?:on|in|from|at|with)\s+(?:the\s+)?(?:plex|snow\s*media)(?:\s+(?:app|server|library))?$/i, '').trim();
  return bare || t;
}

/** What to send to the server: the words, less a year said after them
 *  ("dune 2021"), which Plex's search does not look for in a title. The year
 *  still decides between a film and its remake (pickPlexVoiceMatch), and a
 *  title that ends in a number ("Blade Runner 2049") is still found by the
 *  rest of its name. */
export function plexVoiceSearchText(q: string): string {
  const t = plexVoiceQuery(q);
  const m = /^(.+?)\s+(?:19|20)\d\d$/.exec(t);
  return m ? m[1] : t;
}

const WORD_NUM: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12',
};
const NUM_WORD = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi;
const digits = (s: string): string => s.replace(NUM_WORD, (w) => WORD_NUM[w.toLowerCase()]);

/** Every search to send: the words, and when a number was said as a word
 *  ("toy story five") the same with the digit too — Plex's search does not
 *  take one for the other, and a sequel's title has the digit. */
export function plexVoiceSearchTexts(q: string): string[] {
  const t = plexVoiceSearchText(q);
  const d = digits(t);
  return d === t ? [t] : [t, d];
}

/** One spelling for a title: no leading "the", numbers as digits ("toy story
 *  five" and "Toy Story 5" are the same film to a viewer). */
const canon = (s: string): string => digits(normalizeTitle(s).replace(/^the /, ''));
const squash = (s: string) => s.replace(/ /g, '');

/**
 * The one title a request clearly means, or null (then Search opens with the
 * words typed). A title that is the words said (with or without its year)
 * wins; failing that, one title that starts with them and is not much longer
 * ("the office" → "The Office (US)"). Two different answers — a remake, a
 * film and a series of the same name — are not a clear match; the same film
 * in two libraries (a 4K copy) is one answer, the server's first.
 */
export function pickPlexVoiceMatch(query: string, items: PlexItem[]): PlexItem | null {
  const a = canon(plexVoiceQuery(query));
  if (!a) return null;
  const one = (list: PlexItem[]): PlexItem | null => {
    const ids = new Set(list.map((it) => `${it.type}|${canon(it.title)}|${it.year ?? ''}`));
    return ids.size === 1 ? list[0] : null;
  };
  const exact = items.filter((it) => {
    const b = canon(it.title);
    if (!b) return false;
    if (b === a || squash(b) === squash(a)) return true;
    return !!it.year && canon(`${it.title} ${it.year}`) === a;
  });
  if (exact.length) return one(exact);
  const near = items.filter((it) => {
    const b = canon(it.title);
    return b.startsWith(`${a} `) && a.length >= b.length * 0.6;
  });
  return near.length ? one(near) : null;
}
