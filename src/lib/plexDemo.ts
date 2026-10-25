// Demo-mode Plex data source.
//
// In demo mode the app never talks to a Plex server: one edge function call
// returns a pre-built, scrubbed catalog and every Plex read is answered from
// that cached payload. The helpers below deliberately mirror the signatures of
// their real counterparts in `@/lib/plex` so call sites can swap between them
// with a single ternary.
import { supabase } from '@/integrations/supabase/client';
import type {
  PlexLibrary, PlexItem, PlexLibraryPage, PlexMetadata, PlexSeason, PlexEpisode,
} from '@/lib/plex';

export interface DemoCatalog {
  libraries: PlexLibrary[];
  home: { continueWatching: PlexItem[]; recentlyAdded: PlexItem[] };
  itemsByLibrary: Record<string, PlexItem[]>;
  metadataByRatingKey: Record<string, PlexMetadata>;
  seasonsByShow: Record<string, PlexSeason[]>;
  episodesBySeason: Record<string, PlexEpisode[]>;
  fallback?: boolean;
}

/** Stand-in connection object. `base`/`token` are never dereferenced in demo. */
export const demoConn = { base: 'demo://plex', token: 'demo', name: 'Snow Media P2', owned: false } as const;

const EMPTY: DemoCatalog = {
  libraries: [],
  home: { continueWatching: [], recentlyAdded: [] },
  itemsByLibrary: {},
  metadataByRatingKey: {},
  seasonsByShow: {},
  episodesBySeason: {},
};

let cache: Promise<DemoCatalog> | null = null;

export function fetchDemoCatalog(): Promise<DemoCatalog> {
  if (!cache) {
    cache = (async () => {
      try {
        const { data, error } = await supabase.functions.invoke<DemoCatalog>('demo-plex-catalog', {
          method: 'GET',
        });
        if (error) throw error;
        if (!data || !Array.isArray(data.libraries)) throw new Error('bad demo payload');
        return { ...EMPTY, ...data };
      } catch (e) {
        console.warn('[demo] catalog fetch failed:', (e as Error).message);
        return EMPTY;
      }
    })();
  }
  return cache;
}

// ── lookups (same signatures as the real plex.ts functions) ────────────────

export async function demoGetLibraries(_base: string, _token: string): Promise<PlexLibrary[]> {
  return (await fetchDemoCatalog()).libraries;
}

export async function demoGetHub(_base: string, _token: string, path: string): Promise<PlexItem[]> {
  const cat = await fetchDemoCatalog();
  return /ondeck/i.test(path) ? cat.home.continueWatching : cat.home.recentlyAdded;
}

export async function demoGetLibraryItems(
  _base: string,
  _token: string,
  sectionKey: string,
  start = 0,
  size = 120,
): Promise<PlexLibraryPage> {
  const all = (await fetchDemoCatalog()).itemsByLibrary[sectionKey] ?? [];
  return { items: all.slice(start, start + size), totalSize: all.length };
}

export async function demoSearchPlex(_base: string, _token: string, query: string): Promise<PlexItem[]> {
  const cat = await fetchDemoCatalog();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const out: PlexItem[] = [];
  for (const it of Object.values(cat.itemsByLibrary).flat()) {
    if (seen.has(it.ratingKey)) continue;
    if (!it.title.toLowerCase().includes(q)) continue;
    seen.add(it.ratingKey);
    out.push(it);
  }
  return out.slice(0, 30);
}

export async function demoGetMetadata(_base: string, _token: string, ratingKey: string): Promise<PlexMetadata> {
  const cat = await fetchDemoCatalog();
  const found = cat.metadataByRatingKey[ratingKey];
  if (found) return found;
  return { ratingKey, title: '', type: 'movie', genres: [], cast: [], directors: [] };
}

export async function demoGetSeasons(_base: string, _token: string, showKey: string): Promise<PlexSeason[]> {
  return (await fetchDemoCatalog()).seasonsByShow[showKey] ?? [];
}

export async function demoGetEpisodes(_base: string, _token: string, seasonKey: string): Promise<PlexEpisode[]> {
  return (await fetchDemoCatalog()).episodesBySeason[seasonKey] ?? [];
}

/** Actor filmography isn't part of the demo payload. */
export async function demoGetActorItems(
  _base: string,
  _token: string,
  _sectionKey: string,
  _personId: string,
): Promise<PlexItem[]> {
  return [];
}

// ── a library's rows (PlexLibraryRows), from the same catalog ─────────────
// The real ones are server queries (`sort=…&unwatched=1&…`): here the sort
// and the unwatched / date / rating bounds the rows use are read from the
// query and applied to the library's titles, so a library opens on rows in
// demo mode as on a real server.
function demoQuery(items: PlexItem[], query: string): PlexItem[] {
  const q = new URLSearchParams(query.replace(/%3E%3E=/gi, '>>=').replace(/%3E=/gi, '>='));
  let out = items.slice();
  if (q.get('unwatched') === '1' || q.get('unwatchedLeaves') === '1') out = out.filter((it) => !it.viewOffset && !it.viewCount);
  if (q.has('audienceRating>>')) out = out.filter((it) => (it.rating ?? 0) >= Number(q.get('audienceRating>>')));
  if (q.has('viewCount>>')) out = out.filter((it) => (it.viewCount ?? 0) > 0);
  const [key, dir] = (q.get('sort') ?? '').split(':');
  const val = (it: PlexItem): number | string => (
    key === 'addedAt' ? it.addedAt ?? 0
      : key === 'originallyAvailableAt' || key === 'year' ? it.year ?? 0
        : key === 'audienceRating' ? it.rating ?? 0
          : key === 'lastViewedAt' ? it.lastViewedAt ?? 0
            : (it.title || '').toLowerCase());
  if (key) out.sort((a, b) => { const x = val(a); const y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * (dir === 'desc' ? -1 : 1); });
  return out;
}

export async function demoGetSectionRow(_base: string, _token: string, sectionKey: string, query: string, limit = 15): Promise<PlexItem[]> {
  return demoQuery((await fetchDemoCatalog()).itemsByLibrary[sectionKey] ?? [], query).slice(0, limit);
}

export async function demoGetSectionOnDeck(_base: string, _token: string, sectionKey: string): Promise<PlexItem[]> {
  return (await fetchDemoCatalog()).home.continueWatching.filter((it) => String(it.librarySectionID ?? '') === String(sectionKey));
}

export async function demoGetLibraryQuery(_base: string, _token: string, sectionKey: string, query: string, start = 0, size = 60): Promise<PlexLibraryPage> {
  const all = demoQuery((await fetchDemoCatalog()).itemsByLibrary[sectionKey] ?? [], query);
  return { items: all.slice(start, start + size), totalSize: all.length };
}
