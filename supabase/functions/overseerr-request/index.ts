// Overseerr proxy — the API key lives ONLY in edge secrets, never in the app.
// Actions: search (query -> slim results with availability) and request
// (movie or tv). verify_jwt=false: the player is often signed-out; the
// destination is locked server-side to the configured Overseerr URL.
//
// Movies and shows are both approved automatically (requests go in with the
// admin API key); a show is requested with every season.
//
// Secrets: OVERSEERR_URL (or OVERSEE_URL) and OVERSEERR_API_KEY (or
// OVERSEE_KEY).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const env = (...names: string[]) => {
  for (const n of names) { const v = (Deno.env.get(n) || '').trim(); if (v) return v; }
  return '';
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const OVERSEERR_URL = env('OVERSEERR_URL', 'OVERSEE_URL').replace(/\/+$/, '');
    const KEY = env('OVERSEERR_API_KEY', 'OVERSEE_KEY', 'OVERSEERR_KEY');
    if (!OVERSEERR_URL || !KEY) return json({ error: 'Overseerr is not configured.' }, 500);
    const H = { 'X-Api-Key': KEY, 'Content-Type': 'application/json' };
    const body = await req.json().catch(() => ({}));

    if (body.action === 'search') {
      const q = String(body.query || '').trim();
      if (!q) return json({ results: [] });
      const r = await fetch(`${OVERSEERR_URL}/api/v1/search?query=${encodeURIComponent(q)}&page=${Number(body.page) || 1}`, { headers: H });
      if (!r.ok) return json({ error: `Overseerr search failed (${r.status})` }, 500);
      const d = await r.json();
      const results = (d.results || [])
        .filter((x: Record<string, unknown>) => x.mediaType === 'movie' || x.mediaType === 'tv')
        .map((x: Record<string, any>) => ({
          id: x.id,
          mediaType: x.mediaType,
          title: x.title || x.name || '',
          year: String(x.releaseDate || x.firstAirDate || '').slice(0, 4) || null,
          posterUrl: x.posterPath ? `https://image.tmdb.org/t/p/w342${x.posterPath}` : null,
          status: x.mediaInfo?.status ?? 0, // 0/1 none, 2 pending, 3 processing, 4 partial, 5 available
        }));
      return json({ results });
    }

    if (body.action === 'request') {
      const mediaType = body.mediaType === 'tv' ? 'tv' : 'movie';
      const tmdbId = Number(body.tmdbId);
      if (!tmdbId) return json({ error: 'tmdbId required' }, 400);
      const payload: Record<string, unknown> = { mediaType, mediaId: tmdbId };
      if (mediaType === 'tv') {
        // Every season.
        const tv = await fetch(`${OVERSEERR_URL}/api/v1/tv/${tmdbId}`, { headers: H }).then((r) => r.json()).catch(() => null);
        const seasons = ((tv?.seasons || []) as Array<{ seasonNumber: number }>)
          .map((s) => s.seasonNumber).filter((n) => n > 0);
        payload.seasons = seasons.length ? seasons : [1];
      }
      const r = await fetch(`${OVERSEERR_URL}/api/v1/request`, { method: 'POST', headers: H, body: JSON.stringify(payload) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 409) return json({ ok: false, already: true });
        return json({ error: d?.message || `Request failed (${r.status})` }, 500);
      }
      // Overseerr MediaRequestStatus: 1 pending approval, 2 approved.
      return json({ ok: true, id: d?.id ?? null, approved: d?.status === 2, mediaType });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
