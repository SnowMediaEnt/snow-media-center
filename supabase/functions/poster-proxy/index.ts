// Public poster proxy: hides the Plex origin + X-Plex-Token from clients.
// GET ?p=<plex thumb path>&s=<hex HMAC-SHA256 of p with POSTER_PROXY_SECRET>
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const PLEX_URL = (Deno.env.get('PLEX_SERVER_URL') ?? '').replace(/\/+$/, '');
const PLEX_TOKEN = Deno.env.get('PLEX_TOKEN') ?? '';
const SECRET = Deno.env.get('POSTER_PROXY_SECRET') ?? '';

let keyPromise: Promise<CryptoKey> | null = null;
const getKey = () => {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  }
  return keyPromise;
};

const sign = async (value: string): Promise<string> => {
  const key = await getKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const notFound = () =>
  new Response(null, {
    status: 404,
    headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=60' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return notFound();
  if (!PLEX_URL || !PLEX_TOKEN || !SECRET) return notFound();

  try {
    const url = new URL(req.url);
    const p = url.searchParams.get('p') ?? '';
    const s = url.searchParams.get('s') ?? '';
    if (!p || !s || !p.startsWith('/')) return notFound();

    const expected = await sign(p);
    if (!timingSafeEqual(expected, s.toLowerCase())) return notFound();

    const upstream = `${PLEX_URL}/photo/:/transcode?width=300&height=450&minSize=1&upscale=1&url=${encodeURIComponent(p)}&X-Plex-Token=${encodeURIComponent(PLEX_TOKEN)}`;
    const res = await fetch(upstream, { signal: AbortSignal.timeout(10000) });
    if (!res.ok || !res.body) return notFound();

    return new Response(res.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch (e) {
    console.warn('[poster-proxy] failed:', (e as Error).message);
    return notFound();
  }
});
