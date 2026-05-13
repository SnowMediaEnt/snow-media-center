// Server-side RSS proxy — works in browser preview (no CORS) AND on native.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const FEED_URL = 'https://snowmediaapps.com/smc/newsfeed.xml';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const res = await fetch(`${FEED_URL}?ts=${Date.now()}`, {
      headers: { Accept: 'application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    const xml = await res.text();
    return new Response(xml, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=120',
      },
    });
  } catch (e) {
    console.error('[news-feed-proxy]', (e as Error).message);
    return new Response('<?xml version="1.0"?><rss><channel></channel></rss>', {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/xml' },
    });
  }
});
