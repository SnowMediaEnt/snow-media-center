// OpenSubtitles proxy — credentials & API key live in edge secrets only.
// Actions: search, download. verify_jwt=false (player may be signed out).
// Gracefully returns {ok:false, reason:'not_configured'} if OPENSUBTITLES_API_KEY
// is missing or literal 'PENDING' (user hasn't generated their consumer key yet).
//
// Every download spends one of the account's daily downloads, for every
// viewer, so downloads are limited per IP an hour; over it the answer is
// { ok:false, reason:'quota' }, which the player already shows.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
import { clientIp, hashIp, logIpHeadersOnce, throttle, type ThrottleDb } from '../_shared/requestGuard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const BASE = 'https://api.opensubtitles.com/api/v1';
const UA = 'SnowMediaCenter v1.0';

const DOWNLOADS_PER_IP_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

/** Counts a download against the caller's IP; true while under the limit. */
async function downloadAllowed(req: Request): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return true;
  logIpHeadersOnce('opensubtitles', req.headers);
  const ipHash = await hashIp(clientIp(req.headers));
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as ThrottleDb;
  return await throttle(db, ipHash && `os:${ipHash}`, DOWNLOADS_PER_IP_PER_HOUR, HOUR_MS);
}

// Module-level login token cache (~23h).
let cachedToken: string | null = null;
let cachedTokenExpiry = 0;

function isConfigured(): { ok: boolean; key: string; user: string; pass: string } {
  const key = (Deno.env.get('OPENSUBTITLES_API_KEY') || '').trim();
  const user = (Deno.env.get('OPENSUBTITLES_USERNAME') || '').trim();
  const pass = (Deno.env.get('OPENSUBTITLES_PASSWORD') || '').trim();
  if (!key || key === 'PENDING' || !user || !pass) return { ok: false, key, user, pass };
  return { ok: true, key, user, pass };
}

async function login(key: string, user: string, pass: string, force = false): Promise<string | null> {
  if (!force && cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;
  try {
    const r = await fetch(`${BASE}/login`, {
      method: 'POST',
      headers: { 'Api-Key': key, 'User-Agent': UA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    });
    if (!r.ok) { console.error('OS login failed', r.status); return null; }
    const d = await r.json();
    const tok = typeof d?.token === 'string' ? d.token : null;
    if (!tok) return null;
    cachedToken = tok;
    cachedTokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return tok;
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const cfg = isConfigured();
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action || '');

    if (!cfg.ok) return json({ ok: false, reason: 'not_configured' });

    const authHeaders = (token?: string | null) => {
      const h: Record<string, string> = {
        'Api-Key': cfg.key,
        'User-Agent': UA,
        'Content-Type': 'application/json',
      };
      if (token) h['Authorization'] = `Bearer ${token}`;
      return h;
    };

    if (action === 'search') {
      const query = String(body.query || '').trim();
      if (!query) return json({ ok: true, results: [] });
      const languages = String(body.languages || 'en,es');
      const params = new URLSearchParams();
      params.set('query', query);
      params.set('languages', languages);
      params.set('order_by', 'download_count');
      if (body.year) params.set('year', String(body.year));
      if (body.season != null) params.set('season_number', String(body.season));
      if (body.episode != null) params.set('episode_number', String(body.episode));
      try {
        const r = await fetch(`${BASE}/subtitles?${params.toString()}`, { headers: authHeaders() });
        if (!r.ok) return json({ ok: false, reason: 'error' });
        const d = await r.json();
        const data = Array.isArray(d?.data) ? d.data : [];
        const results = data
          .map((x: Record<string, any>) => {
            const attrs = x?.attributes || {};
            const file = Array.isArray(attrs.files) && attrs.files.length > 0 ? attrs.files[0] : null;
            if (!file || file.file_id == null) return null;
            return {
              id: Number(file.file_id),
              lang: String(attrs.language || ''),
              release: String(attrs.release || file.file_name || ''),
              downloads: Number(attrs.download_count || 0),
            };
          })
          .filter((x: unknown) => x !== null)
          .slice(0, 15);
        return json({ ok: true, results });
      } catch { return json({ ok: false, reason: 'error' }); }
    }

    if (action === 'download') {
      const fileId = Number(body.file_id);
      if (!fileId) return json({ ok: false, reason: 'error' });
      if (!(await downloadAllowed(req))) return json({ ok: false, reason: 'quota' });
      const doDownload = async (token: string) => {
        return await fetch(`${BASE}/download`, {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({ file_id: fileId }),
        });
      };
      try {
        let token = await login(cfg.key, cfg.user, cfg.pass);
        if (!token) return json({ ok: false, reason: 'error' });
        let r = await doDownload(token);
        if (r.status === 401) {
          token = await login(cfg.key, cfg.user, cfg.pass, true);
          if (!token) return json({ ok: false, reason: 'error' });
          r = await doDownload(token);
        }
        if (r.status === 406) return json({ ok: false, reason: 'quota' });
        if (!r.ok) { console.error('OS download failed', r.status); return json({ ok: false, reason: 'error' }); }
        const d = await r.json();
        const link = typeof d?.link === 'string' ? d.link : null;
        if (!link) return json({ ok: false, reason: 'error' });
        return json({ ok: true, url: link, remaining: d?.remaining ?? null });
      } catch { return json({ ok: false, reason: 'error' }); }
    }

    return json({ ok: false, reason: 'error' });
  } catch { return json({ ok: false, reason: 'error' }); }
});
