// Wix Custom App webhook receiver — JWT-signed Order Approved events.
//
// Configure in dev.wix.com → your Custom App → Webhooks → eCommerce → Order Approved.
// Callback URL: https://<project>.functions.supabase.co/wix-order-webhook
// Copy the public key from that page into the WIX_PUBLIC_KEY secret (full PEM, BEGIN/END included).
//
// We verify the RS256 JWT signature, then extract order data, map SKU → credits,
// resolve the SMC user (smc_user_id custom field, fallback to buyer email),
// grant credits via update_user_credits RPC, and dedupe by event id.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// SKU -> credits map (case-insensitive).
const SKU_CREDITS: Record<string, number> = {
  ai50: 50,
  ai120: 120,
  ai250: 250,
  ai600: 600,
};

const ACCEPTED_EVENT_TYPES = new Set([
  'wix.ecom.v1.order_approved',
  'wix.ecom.v1.order_paid',
  'wix.ecom.order_paid',
  'OrderApproved',
  'OrderPaid',
]);

// ---------- JWT verification helpers ----------

function b64urlToUint8(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(b64url.length + ((4 - (b64url.length % 4)) % 4), '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyJwtRS256(jwt: string, publicKeyPem: string): Promise<any> {
  const parts = jwt.trim().split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(new TextDecoder().decode(b64urlToUint8(headerB64)));
  if (header.alg !== 'RS256') throw new Error(`Unsupported alg: ${header.alg}`);

  const der = pemToDer(publicKeyPem);
  const key = await crypto.subtle.importKey(
    'spki',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = b64urlToUint8(sigB64);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
  if (!ok) throw new Error('Invalid JWT signature');

  return JSON.parse(new TextDecoder().decode(b64urlToUint8(payloadB64)));
}

// ---------- Handler ----------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const publicKey = Deno.env.get('WIX_PUBLIC_KEY');
    if (!publicKey) {
      console.error('WIX_PUBLIC_KEY not configured');
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rawJwt = (await req.text()).trim();
    if (!rawJwt) {
      return new Response(JSON.stringify({ error: 'Empty body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let claims: any;
    try {
      claims = await verifyJwtRS256(rawJwt, publicKey);
    } catch (e: any) {
      console.warn('JWT verification failed:', e.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('JWT verified. claims keys:', Object.keys(claims).join(','));

    // Wix wraps the actual event payload in a JSON string at claims.data
    let envelope: any = claims.data;
    if (typeof envelope === 'string') {
      try { envelope = JSON.parse(envelope); } catch { /* keep string */ }
    }

    const eventId =
      envelope?.id || envelope?.eventId || claims.jti || claims.id ||
      `${claims.iat || ''}-${envelope?.entityId || ''}`;
    const eventType =
      envelope?.eventType || envelope?.slug || claims.eventType || '';

    console.log(`Event id=${eventId} type=${eventType}`);

    const etLower = String(eventType).toLowerCase();
    if (!ACCEPTED_EVENT_TYPES.has(eventType) && !etLower.includes('order_approved') && !etLower.includes('order_paid')) {
      console.log('Ignoring event type:', eventType);
      return new Response(JSON.stringify({ ok: true, ignored: eventType }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Order body lives under actionEvent.body or updatedEvent.currentEntity, depending on event shape.
    const order =
      envelope?.actionEvent?.body?.order ||
      envelope?.actionEvent?.body ||
      envelope?.updatedEvent?.currentEntity ||
      envelope?.createdEvent?.entity ||
      envelope?.data?.order ||
      envelope?.order ||
      envelope;

    const orderId = order?.id || order?._id || envelope?.entityId;
    const orderNumber = order?.number || order?.orderNumber;

    if (!orderId) {
      console.error('No order id in payload');
      return new Response(JSON.stringify({ ok: true, skipped: 'no_order_id' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Idempotency: insert event first, rely on UNIQUE(event_id).
    const { error: dedupErr } = await admin
      .from('processed_wix_events')
      .insert({ event_id: String(eventId), event_type: eventType || 'unknown', order_id: String(orderId) });

    if (dedupErr) {
      // Duplicate key = already processed.
      if (String(dedupErr.code) === '23505' || /duplicate key/i.test(dedupErr.message)) {
        console.log(`Event ${eventId} already processed`);
        return new Response(JSON.stringify({ ok: true, alreadyProcessed: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.error('processed_wix_events insert failed:', dedupErr);
      return new Response(JSON.stringify({ error: 'DB error' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Compute credits from SKUs
    const lineItems: any[] = order.lineItems || order.line_items || [];
    let credits = 0;
    for (const item of lineItems) {
      const sku = String(item.physicalProperties?.sku || item.sku || '').toLowerCase().trim();
      const perUnit = SKU_CREDITS[sku];
      if (perUnit) credits += perUnit * (item.quantity || 1);
    }

    if (credits === 0) {
      console.log(`Order ${orderId} has no credit SKUs`);
      return new Response(JSON.stringify({ ok: true, skipped: 'no_credit_sku' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve SMC user
    const customFields: any[] =
      order.customFields || order.checkoutCustomFields || order.custom_fields || [];
    const cfMatch = customFields.find((f: any) => {
      const t = f.title || f.name || f.translatedTitle;
      return t === 'smc_user_id' || t === 'app_user_id'; // accept legacy
    });
    let userId: string | null = cfMatch?.value ? String(cfMatch.value).trim() : null;

    const buyerEmail: string =
      order.buyerInfo?.email || order.buyer_info?.email || order.buyerEmail || '';

    if (!userId && buyerEmail) {
      const { data: profile } = await admin
        .from('profiles')
        .select('user_id')
        .ilike('email', buyerEmail)
        .limit(2);
      if (profile && profile.length === 1) {
        userId = profile[0].user_id;
        console.log(`Resolved user via buyer email: ${userId}`);
      } else {
        console.log(`Email match inconclusive (${profile?.length ?? 0} matches) for ${buyerEmail}`);
      }
    }

    if (!userId) {
      console.warn(`Order ${orderId} unmatched, queueing in pending_credits`);
      await admin.from('pending_credits').insert({
        wix_order_id: String(orderId),
        wix_order_number: String(orderNumber || ''),
        buyer_email: buyerEmail || null,
        credits,
        raw_payload: order,
      });
      return new Response(JSON.stringify({ ok: true, queued: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Grant credits
    const { error: rpcErr } = await admin.rpc('update_user_credits', {
      p_user_id: userId,
      p_amount: credits,
      p_transaction_type: 'purchase',
      p_description: `Wix order #${orderNumber || orderId} (SMC AI Credits)`,
      p_paypal_transaction_id: `wix_${orderId}`,
    });
    if (rpcErr) {
      console.error('update_user_credits failed:', rpcErr);
      return new Response(JSON.stringify({ error: 'Credit failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await admin.from('wix_redeemed_orders').insert({
      user_id: userId,
      wix_order_id: String(orderId),
      wix_order_number: String(orderNumber || ''),
      credits_granted: credits,
    });

    console.log(`Credited ${credits} to user ${userId} for order ${orderId}`);
    return new Response(JSON.stringify({ ok: true, credits, userId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('Webhook error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
