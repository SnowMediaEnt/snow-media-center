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
//
// "Tell me when it's here": a request carries the box's private deviceKey and
// is recorded in public.plex_requests (service role only). The 'check' action
// asks Overseerr whether that box's open requests have arrived — a movie when
// it is available, a show once its first episodes are — and returns those
// once (they are marked notified), plus how many are still on their way. The
// app calls it on launch and when Plex opens; the native alert job calls it
// every five minutes while anything is pending, so the TV gets a notification
// even with the app closed.
//
// Anyone can call this, and a request downloads for real, so 'request' is
// limited: a few per IP an hour, and a daily total for everyone
// (OVERSEERR_DAILY_CAP, default 100). Over either, the answer is
// { ok:false, reason:'busy' }, which the app shows as a failed request.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
import { clientIp, hashIp, logIpHeadersOnce, throttle, type ThrottleDb } from '../_shared/requestGuard.ts';

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

const admin = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const REQUESTS_PER_IP_PER_HOUR = 10;
const DAILY_CAP_DEFAULT = 100;
const HOUR_MS = 60 * 60 * 1000;

/** A per-install random key: long, plain characters only. */
const deviceKeyOf = (v: unknown): string | null => {
  const k = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9_-]{24,128}$/.test(k) ? k : null;
};

/** The signed-in Snow Media user behind the call, if any. */
async function userIdOf(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  try {
    const { data } = await admin().auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

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
          overview: String(x.overview || '').slice(0, 320),
          status: x.mediaInfo?.status ?? 0, // 0/1 none, 2 pending, 3 processing, 4 partial, 5 available
        }));
      return json({ results });
    }

    if (body.action === 'request') {
      const mediaType = body.mediaType === 'tv' ? 'tv' : 'movie';
      const tmdbId = Number(body.tmdbId);
      if (!tmdbId) return json({ error: 'tmdbId required' }, 400);
      const db = admin() as unknown as ThrottleDb;
      logIpHeadersOnce('overseerr-request', req.headers);
      const ipHash = await hashIp(clientIp(req.headers));
      const dailyCap = Number(env('OVERSEERR_DAILY_CAP')) || DAILY_CAP_DEFAULT;
      if (!(await throttle(db, ipHash && `ovr:${ipHash}`, REQUESTS_PER_IP_PER_HOUR, HOUR_MS))
          || !(await throttle(db, 'ovr:all', dailyCap, 24 * HOUR_MS))) {
        console.warn('[overseerr-request] request refused: over the hourly per-IP or daily limit');
        return json({ ok: false, reason: 'busy' });
      }
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
      // Remember who asked (also when it was already requested by someone
      // else: this box still wants to hear when it lands).
      const deviceKey = deviceKeyOf(body.deviceKey);
      if (deviceKey && (r.ok || r.status === 409)) {
        try {
          await admin().from('plex_requests').upsert({
            device_key: deviceKey,
            user_id: await userIdOf(req),
            tmdb_id: tmdbId,
            media_type: mediaType,
            title: String(body.title || '').slice(0, 300) || 'Your request',
            poster_url: typeof body.posterUrl === 'string' ? body.posterUrl.slice(0, 500) : null,
            overseerr_request_id: r.ok ? (d?.id ?? null) : null,
            notified_at: null,
            available_at: null,
          }, { onConflict: 'device_key,tmdb_id,media_type' });
        } catch (e) {
          console.warn('[overseerr-request] could not record the request:', String((e as Error)?.message || e));
        }
      }
      if (!r.ok) {
        if (r.status === 409) return json({ ok: false, already: true });
        return json({ error: d?.message || `Request failed (${r.status})` }, 500);
      }
      // Overseerr MediaRequestStatus: 1 pending approval, 2 approved.
      return json({ ok: true, id: d?.id ?? null, approved: d?.status === 2, mediaType });
    }

    if (body.action === 'check') {
      const deviceKey = deviceKeyOf(body.deviceKey);
      if (!deviceKey) return json({ ready: [], pending: 0 });
      const db = admin();
      const { data: rows } = await db
        .from('plex_requests')
        .select('id, tmdb_id, media_type, title, poster_url, requested_at')
        .eq('device_key', deviceKey)
        .is('notified_at', null)
        .order('requested_at', { ascending: true })
        .limit(25);
      const ready: Array<Record<string, unknown>> = [];
      let pending = 0;
      for (const row of rows ?? []) {
        // Given up after 60 days: stop asking about it.
        if (Date.now() - new Date(row.requested_at as string).getTime() > 60 * 86400_000) {
          await db.from('plex_requests').update({ notified_at: new Date().toISOString() }).eq('id', row.id);
          continue;
        }
        const info = await fetch(`${OVERSEERR_URL}/api/v1/${row.media_type === 'tv' ? 'tv' : 'movie'}/${row.tmdb_id}`, { headers: H })
          .then((x) => (x.ok ? x.json() : null)).catch(() => null);
        const status = Number(info?.mediaInfo?.status ?? 0);
        // A movie once it is on Plex; a show once its first episodes are.
        const arrived = row.media_type === 'tv' ? status >= 4 : status === 5;
        if (!arrived) { pending++; continue; }
        const now = new Date().toISOString();
        await db.from('plex_requests').update({ available_at: now, notified_at: now }).eq('id', row.id);
        ready.push({ tmdbId: row.tmdb_id, mediaType: row.media_type, title: row.title, posterUrl: row.poster_url });
      }
      return json({ ready, pending });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
