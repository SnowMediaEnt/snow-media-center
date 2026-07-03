// OpenSubtitles proxy — credentials & API key live in edge secrets only.
// Actions: search, download. verify_jwt=false (player may be signed out).
// Gracefully returns {ok:false, reason:'not_configured'} if OPENSUBTITLES_API_KEY
// is missing or literal 'PENDING' (user hasn't generated their consumer key yet).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const BASE = 'https://api.opensubtitles.com/api/v1';
const UA = 'SnowMediaCenter v1.0';

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
    if (!r.ok) return null;
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
      const doDownload = async (token: string) => {
        return await fetch(`${BASE}/download`, {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({ file_id: fileId }),
        });
      };
      try {
        let token = await login(cfg.key, cfg.user, cfg.pass);
        if (!token) { console.error('login failed'); return json({ ok: false, reason: 'error' }); }
        let r = await doDownload(token);
        if (r.status === 401) {
          token = await login(cfg.key, cfg.user, cfg.pass, true);
          if (!token) return json({ ok: false, reason: 'error' });
          r = await doDownload(token);
        }
        if (r.status === 406) return json({ ok: false, reason: 'quota' });
        const txt = await r.text();
        if (!r.ok) { console.error('download http', r.status, txt.slice(0,300)); return json({ ok: false, reason: 'error' }); }
        let d: any; try { d = JSON.parse(txt); } catch { console.error('download parse', txt.slice(0,300)); return json({ ok: false, reason: 'error' }); }
        const link = typeof d?.link === 'string' ? d.link : null;
        if (!link) { console.error('no link', JSON.stringify(d).slice(0,300)); return json({ ok: false, reason: 'error' }); }
        return json({ ok: true, url: link, remaining: d?.remaining ?? null });
      } catch (e) { console.error('download exception', String(e)); return json({ ok: false, reason: 'error' }); }
    }

    return json({ ok: false, reason: 'error' });
  } catch { return json({ ok: false, reason: 'error' }); }
});
