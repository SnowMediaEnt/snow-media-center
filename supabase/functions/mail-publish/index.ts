// mail-publish — the website tells the TV app about an email it sent.
//
// snowmediaent.com sends its campaigns through Resend from its own Supabase
// project. After a send it POSTs the campaign here, and the app's Support
// screen shows it under Mail. Removing a campaign on the website removes it
// here too.
//
// verify_jwt = false. Server-to-server only, guarded by the x-internal-secret
// header matching INTERNAL_FN_SECRET or SMC_BRIDGE_SECRET — the same pair the
// giveaway bridge accepts from the website. Nothing here is reachable from a
// customer device.
//
// POST {
//   action?:     'publish' | 'remove'          (default publish)
//   campaign_id: string                        (the website's campaign uuid)
//   subject:     string
//   preheader?:  string | null
//   blocks:      CampaignBlock[]               (the website's block model; a
//                                              product block should carry a
//                                              resolved `product` object)
//   hero_image?: string | null                 (defaults to the first image block)
//   sent_at?:    ISO timestamp                 (defaults to now)
//   audience?:   { mode: 'all' } | { mode: 'targeted', emails: string[] }
// }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sanitizeMailHtml } from '../_shared/mailHtml.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const BLOCK_TYPES = new Set(['heading', 'paragraph', 'image', 'button', 'product', 'video', 'form', 'html', 'divider']);
const MAX_BLOCKS = 200;
const MAX_RECIPIENTS = 20000;

/** First six hex characters of SHA-256 — enough to tell two values apart, useless for recovering one. */
async function fingerprint(value: string): Promise<string> {
  if (!value) return 'unset';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 6);
}

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

const html = (v: unknown, max: number): string | undefined => {
  const raw = str(v, max);
  const clean = raw ? sanitizeMailHtml(raw).trim() : '';
  return clean || undefined;
};

const httpsUrl = (v: unknown): string | undefined => {
  const s = str(v, 2000);
  return s && /^https?:\/\//i.test(s) ? s : undefined;
};

/** Keeps only the fields the TV renders, so a stray key can never reach a box. */
function cleanBlocks(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const b of raw.slice(0, MAX_BLOCKS)) {
    if (!b || typeof b !== 'object') continue;
    const r = b as Record<string, unknown>;
    const type = typeof r.type === 'string' ? r.type : '';
    if (!BLOCK_TYPES.has(type)) continue;
    const block: Record<string, unknown> = { id: str(r.id, 40) ?? crypto.randomUUID().slice(0, 8), type };
    if (type === 'heading' || type === 'paragraph') block.text = str(r.text, 20000);
    // The two fields a box renders as html: rebuilt from an allow-list here,
    // so no app version is ever handed markup it could mis-read.
    if (type === 'html') block.text = html(r.text, 20000);
    if (type === 'paragraph') block.html = html(r.html, 40000);
    if (type === 'image') block.url = httpsUrl(r.url);
    if (type === 'button') { block.url = httpsUrl(r.url); block.label = str(r.label, 120); }
    if (type === 'video') { block.videoUrl = httpsUrl(r.videoUrl); block.thumbnailUrl = httpsUrl(r.thumbnailUrl); block.label = str(r.label, 120); }
    if (type === 'form') { block.formSlug = str(r.formSlug, 120); block.label = str(r.label, 120); }
    if (type === 'product') {
      const p = (r.product && typeof r.product === 'object') ? r.product as Record<string, unknown> : null;
      if (p) {
        block.product = {
          name: str(p.name, 200) ?? 'Product',
          price: typeof p.price === 'number' ? p.price : undefined,
          image_url: httpsUrl(p.image_url),
          url: httpsUrl(p.url),
        };
      }
    }
    out.push(block);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // Same two secrets the giveaway bridge accepts, so the website keeps
  // working with whichever of them it holds. Trimmed on both sides: a value
  // pasted into a dashboard with a trailing newline must not break the link.
  // On a mismatch the log names only lengths and six-character hash
  // fingerprints of each value, never the values.
  const guard = (Deno.env.get('INTERNAL_FN_SECRET') ?? '').trim();
  const bridge = (Deno.env.get('SMC_BRIDGE_SECRET') ?? '').trim();
  const provided = (req.headers.get('x-internal-secret') ?? '').trim();
  if (!guard && !bridge) {
    console.error('[mail-publish] 401: neither INTERNAL_FN_SECRET nor SMC_BRIDGE_SECRET is set on this project');
    return json(401, { error: 'unauthorized', reason: 'secret_not_set' });
  }
  const accepted = provided.length > 0 && ((!!guard && provided === guard) || (!!bridge && provided === bridge));
  if (!accepted) {
    const [g, b, p] = await Promise.all([fingerprint(guard), fingerprint(bridge), fingerprint(provided)]);
    console.warn(`[mail-publish] 401: secret mismatch (INTERNAL_FN_SECRET ${guard.length} chars ${g}; SMC_BRIDGE_SECRET ${bridge.length} chars ${b}; caller sent ${provided.length} chars ${p})`);
    return json(401, { error: 'unauthorized', reason: 'secret_mismatch', internal_fingerprint: g, bridge_fingerprint: b, caller_fingerprint: p });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: 'bad_json' }); }

  const campaignId = str(body.campaign_id, 120);
  if (!campaignId) return json(400, { error: 'campaign_id required' });

  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  if (body.action === 'remove') {
    const { error } = await db.from('snow_mail').delete().eq('campaign_id', campaignId);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, removed: campaignId });
  }

  const subject = str(body.subject, 300);
  if (!subject) return json(400, { error: 'subject required' });
  const blocks = cleanBlocks(body.blocks);
  const heroFromBlocks = blocks.find((b) => b.type === 'image' && b.url)?.url as string | undefined;

  const audience = (body.audience && typeof body.audience === 'object') ? body.audience as Record<string, unknown> : {};
  const targeted = audience.mode === 'targeted';
  const emails = targeted && Array.isArray(audience.emails)
    ? Array.from(new Set(audience.emails
        .filter((e): e is string => typeof e === 'string' && e.includes('@'))
        .map((e) => e.trim().toLowerCase())))
        .slice(0, MAX_RECIPIENTS)
    : [];

  const sentAt = (() => {
    const s = str(body.sent_at, 40);
    const t = s ? Date.parse(s) : NaN;
    return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
  })();

  const row = {
    campaign_id: campaignId,
    subject,
    preheader: str(body.preheader, 500) ?? null,
    blocks,
    hero_image: httpsUrl(body.hero_image) ?? heroFromBlocks ?? null,
    audience_mode: targeted ? 'targeted' : 'all',
    recipient_emails: emails,
    sent_at: sentAt,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db.from('snow_mail').upsert(row, { onConflict: 'campaign_id' }).select('id').single();
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, id: data?.id, campaign_id: campaignId, blocks: blocks.length, recipients: emails.length });
});
