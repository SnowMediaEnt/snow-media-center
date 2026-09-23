// Seasonal Plex collections (Halloween …), matched once for everyone.
//
// The list (public.seasonal_rows / seasonal_titles) is matched against the
// Plex server by reading each library once — a few requests, not one search
// per title — and the answer is kept in public.seasonal_cache. Every box then
// loads the whole collection in one call. The answer is rebuilt when the list
// changes or after six hours, in the background while the old one is served.
//
// Actions
//   get {season}                         anyone (verify_jwt=false): the rows
//   list | add | remove | rebuild | search   admins only (has_role 'admin'),
//                                        used by the Hub's Seasonal page
//
// The Plex origin and token never leave the server: items carry only
// ratingKeys and server-relative image paths, which a box resolves against its
// own connection; the Hub's posters come through the signed poster-proxy.
// Secrets: PLEX_SERVER_URL, PLEX_TOKEN, POSTER_PROXY_SECRET (as media-bar-feed).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
import { isAdultLabel } from '../_shared/adultContent.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PLEX_URL = (Deno.env.get('PLEX_SERVER_URL') ?? '').replace(/\/+$/, '');
const PLEX_TOKEN = Deno.env.get('PLEX_TOKEN') ?? '';
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const POSTER_SECRET = Deno.env.get('POSTER_PROXY_SECRET') ?? '';

const FRESH_MS = 6 * 3600_000;
/** A build that has not finished in this long is taken to have died. */
const BUILD_LEASE_MS = 3 * 60_000;
const SEASONS = new Set(['halloween']);

const db = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function isAdmin(req: Request): Promise<boolean> {
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer || bearer === SERVICE_KEY) return false;
  try {
    const admin = db();
    const { data: u } = await admin.auth.getUser(bearer);
    if (!u?.user) return false;
    const { data } = await admin.rpc('has_role', { _user_id: u.user.id, _role: 'admin' });
    return Boolean(data);
  } catch {
    return false;
  }
}

// ── Plex ────────────────────────────────────────────────────────────────
async function plex(path: string, timeoutMs = 45_000) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${PLEX_URL}${path}${sep}X-Plex-Token=${encodeURIComponent(PLEX_TOKEN)}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Plex ${res.status} on ${path.split('?')[0]}`);
  return await res.json();
}

let posterKey: Promise<CryptoKey> | null = null;
async function posterUrl(path?: string): Promise<string | undefined> {
  if (!path || !POSTER_SECRET) return undefined;
  posterKey ??= crypto.subtle.importKey('raw', new TextEncoder().encode(POSTER_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', await posterKey, new TextEncoder().encode(path));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${SUPABASE_URL}/functions/v1/poster-proxy?p=${encodeURIComponent(path)}&s=${hex}`;
}

/** Same comparison key as the app (src/lib/plexSeasonal.ts normTitle). */
export function normTitle(t: string): string {
  return t
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/^\s*(the|a|an)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Item {
  ratingKey: string; title: string; type: string; year?: number; thumb?: string; art?: string;
  librarySectionID: string; contentRating?: string; rating?: number; duration?: number;
}

// What a list item needs; the rest of a library listing is dropped at the source.
const LIST_TRIM = 'includeGuids=0&excludeElements=Media,Genre,Director,Writer,Role,Producer,Country,Collection,Label,Guid,Similar,Field&excludeFields=summary,tagline';
const PAGE = 2000;

async function libraryIndex(): Promise<{ machineId: string; index: Map<string, Item[]> }> {
  const idn = await plex('/identity', 10_000);
  const machineId = String(idn?.MediaContainer?.machineIdentifier ?? '');
  const secs = await plex('/library/sections', 15_000);
  const dirs = ((secs?.MediaContainer?.Directory ?? []) as Array<Record<string, unknown>>)
    .filter((d) => (d.type === 'movie' || d.type === 'show') && !isAdultLabel(d.title));
  const index = new Map<string, Item[]>();
  for (const d of dirs) {
    const key = String(d.key);
    const type = d.type === 'movie' ? 1 : 2;
    for (let start = 0; ; start += PAGE) {
      const page = await plex(`/library/sections/${key}/all?type=${type}&${LIST_TRIM}&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE}`);
      const list = (page?.MediaContainer?.Metadata ?? []) as Array<Record<string, unknown>>;
      for (const m of list) {
        const it: Item = {
          ratingKey: String(m.ratingKey),
          title: String(m.title ?? ''),
          type: String(m.type ?? (type === 1 ? 'movie' : 'show')),
          year: typeof m.year === 'number' ? m.year : undefined,
          thumb: typeof m.thumb === 'string' ? m.thumb : undefined,
          art: typeof m.art === 'string' ? m.art : undefined,
          librarySectionID: key,
          contentRating: typeof m.contentRating === 'string' ? m.contentRating : undefined,
          rating: typeof m.audienceRating === 'number' ? m.audienceRating : typeof m.rating === 'number' ? m.rating : undefined,
          duration: typeof m.duration === 'number' ? m.duration : undefined,
        };
        for (const name of new Set([it.title, String(m.originalTitle ?? '')].filter(Boolean).map(normTitle))) {
          const bucket = index.get(name);
          if (bucket) bucket.push(it); else index.set(name, [it]);
        }
      }
      if (list.length < PAGE) break;
    }
  }
  return { machineId, index };
}

type TitleRow = { id: string; row_id: string; title: string; year: number | null; is_show: boolean; sort: number };
type RowDef = { row_id: string; title: string; kids: boolean; sort: number };

function match(index: Map<string, Item[]>, t: TitleRow): Item | null {
  const want = t.is_show ? 'show' : 'movie';
  const cands = (index.get(normTitle(t.title)) ?? []).filter((it) => it.type === want);
  if (!cands.length) return null;
  if (!t.year) return cands[0];
  const near = cands
    .filter((it) => !it.year || Math.abs(it.year - t.year!) <= 1)
    .sort((a, b) => Math.abs((a.year ?? t.year!) - t.year!) - Math.abs((b.year ?? t.year!) - t.year!));
  return near[0] ?? null;
}

async function build(season: string) {
  const client = db();
  const [{ data: rows }, { data: titles }] = await Promise.all([
    client.from('seasonal_rows').select('row_id,title,kids,sort').eq('season', season).order('sort'),
    client.from('seasonal_titles').select('id,row_id,title,year,is_show,sort').eq('season', season).order('sort'),
  ]);
  const { machineId, index } = await libraryIndex();
  const found: Record<string, string> = {};
  const out = (rows as RowDef[] ?? []).map((r) => {
    const seen = new Set<string>();
    const items: Item[] = [];
    for (const t of (titles as TitleRow[] ?? []).filter((x) => x.row_id === r.row_id)) {
      const it = match(index, t);
      if (!it) continue;
      found[t.id] = it.ratingKey;
      if (seen.has(it.ratingKey)) continue;
      seen.add(it.ratingKey);
      items.push(it);
    }
    return { id: r.row_id, title: r.title, kids: r.kids, items };
  });
  const payload = { season, machine_id: machineId, rows: out, found, built_at: new Date().toISOString(), dirty: false, building_at: null };
  await client.from('seasonal_cache').upsert(payload, { onConflict: 'season' });
  return payload;
}

/** Take the build lease; false when another build is already running. */
async function claim(season: string): Promise<boolean> {
  const client = db();
  const up = await client.from('seasonal_cache').upsert({ season }, { onConflict: 'season', ignoreDuplicates: true });
  const cutoff = new Date(Date.now() - BUILD_LEASE_MS).toISOString();
  const { data, error } = await client.from('seasonal_cache')
    .update({ building_at: new Date().toISOString() })
    .eq('season', season)
    .or(`building_at.is.null,building_at.lt.${cutoff}`)
    .select('season');
  console.log('[debug] claim upsert err:', JSON.stringify(up.error ?? null), 'update err:', JSON.stringify(error ?? null), 'rows:', (data ?? []).length);
  return (data ?? []).length > 0;
}

async function buildSafely(season: string) {
  try {
    return await build(season);
  } catch (e) {
    console.error('[plex-seasonal] build failed:', String((e as Error)?.message || e));
    await db().from('seasonal_cache').update({ building_at: null }).eq('season', season);
    return null;
  }
}

const background = (p: Promise<unknown>) => {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p); else void p;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    if (!PLEX_URL || !PLEX_TOKEN) return json({ error: 'Plex is not configured on the server.' }, 500);
    const body = await req.json().catch(() => ({}));
    const season = String(body.season || 'halloween');
    if (!SEASONS.has(season)) return json({ error: 'unknown season' }, 400);
    const action = String(body.action || 'get');

    if (action === 'get') {
      const { data: cache } = await db().from('seasonal_cache').select('machine_id,rows,built_at,dirty').eq('season', season).maybeSingle();
      const hasRows = !!cache?.built_at && Array.isArray(cache.rows) && cache.rows.length > 0;
      const stale = !hasRows || cache!.dirty || Date.now() - new Date(cache!.built_at as string).getTime() > FRESH_MS;
      if (hasRows) {
        if (stale && await claim(season)) background(buildSafely(season));
        return json({ machineId: cache!.machine_id, rows: cache!.rows, builtAt: cache!.built_at });
      }
      // Nothing built yet: the first caller builds, the rest are told to wait.
      if (!(await claim(season))) return json({ building: true, rows: [] });
      const built = await buildSafely(season);
      if (!built) return json({ error: 'Could not read the Plex libraries.' }, 502);
      return json({ machineId: built.machine_id, rows: built.rows, builtAt: built.built_at });
    }

    if (!(await isAdmin(req))) return json({ error: 'Admins only.' }, 401);
    const client = db();

    if (action === 'list') {
      const [{ data: rows }, { data: titles }, { data: cache }] = await Promise.all([
        client.from('seasonal_rows').select('row_id,title,kids,sort').eq('season', season).order('sort'),
        client.from('seasonal_titles').select('id,row_id,title,year,is_show,sort,created_at').eq('season', season).order('sort'),
        client.from('seasonal_cache').select('found,built_at,dirty,building_at').eq('season', season).maybeSingle(),
      ]);
      const found = (cache?.found ?? {}) as Record<string, string>;
      return json({
        rows,
        titles: (titles ?? []).map((t) => ({ ...t, onPlex: t.id in found })),
        builtAt: cache?.built_at ?? null,
        dirty: cache?.dirty ?? true,
        building: !!cache?.building_at,
      });
    }

    if (action === 'search') {
      const q = String(body.query || '').trim();
      if (!q) return json({ results: [] });
      const d = await plex(`/hubs/search?query=${encodeURIComponent(q)}&limit=12&includeGuids=0`, 15_000);
      const results: Array<Record<string, unknown>> = [];
      for (const h of (d?.MediaContainer?.Hub ?? []) as Array<Record<string, unknown>>) {
        for (const m of (h.Metadata ?? []) as Array<Record<string, unknown>>) {
          if (m.type !== 'movie' && m.type !== 'show') continue;
          results.push({
            title: m.title, year: m.year ?? null, isShow: m.type === 'show',
            poster: await posterUrl(typeof m.thumb === 'string' ? m.thumb : undefined),
          });
        }
      }
      return json({ results: results.slice(0, 24) });
    }

    if (action === 'add') {
      const rowId = String(body.rowId || '');
      const title = String(body.title || '').trim().slice(0, 200);
      const year = Number(body.year) || null;
      if (!rowId || !title) return json({ error: 'rowId and title are required' }, 400);
      const { data: last } = await client.from('seasonal_titles').select('sort').eq('season', season).eq('row_id', rowId)
        .order('sort', { ascending: false }).limit(1).maybeSingle();
      const { data, error } = await client.from('seasonal_titles')
        .insert({ season, row_id: rowId, title, year, is_show: !!body.isShow, sort: (last?.sort ?? 0) + 10 })
        .select('id').single();
      if (error) return json({ error: error.message }, 400);
      await client.from('seasonal_cache').upsert({ season, dirty: true }, { onConflict: 'season' });
      return json({ ok: true, id: data.id });
    }

    if (action === 'remove') {
      const id = String(body.id || '');
      if (!id) return json({ error: 'id required' }, 400);
      await client.from('seasonal_titles').delete().eq('id', id).eq('season', season);
      await client.from('seasonal_cache').upsert({ season, dirty: true }, { onConflict: 'season' });
      return json({ ok: true });
    }

    if (action === 'rebuild') {
      if (!(await claim(season))) return json({ ok: false, building: true });
      const built = await buildSafely(season);
      if (!built) return json({ error: 'Could not read the Plex libraries.' }, 502);
      return json({ ok: true, builtAt: built.built_at, matched: Object.keys(built.found).length });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
