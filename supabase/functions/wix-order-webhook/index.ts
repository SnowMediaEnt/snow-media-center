// Public webhook endpoint Wix calls when an order is paid.
// Configure in Wix Automations: trigger = "Order Paid", action = "Send via webhook"
// URL: https://<project>.functions.supabase.co/wix-order-webhook?secret=<WIX_WEBHOOK_SECRET>
//
// This grants credits instantly (no need for the user to click "I've completed
// payment"), and works for guest checkouts and mismatched Wix emails because
// we look up the app user via the `app_user_id` custom field on the order.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// SKU -> credits map (case-insensitive). Mirror of wix-integration.
const SKU_CREDITS: Record<string, number> = {
  ai50: 50,
  ai120: 120,
  ai250: 250,
  ai600: 600,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const expected = Deno.env.get('WIX_WEBHOOK_SECRET');
    const provided = url.searchParams.get('secret') || req.headers.get('x-webhook-secret');

    if (!expected) {
      console.error('WIX_WEBHOOK_SECRET not configured');
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (provided !== expected) {
      console.warn('Invalid webhook secret');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const raw = await req.text();
    let payload: any = {};
    try { payload = JSON.parse(raw); } catch { payload = { raw }; }
    console.log('Webhook payload:', JSON.stringify(payload).substring(0, 1500));

    // Wix Automations "Send via Webhook" payloads vary. Try common shapes.
    const order =
      payload.data?.order ||
      payload.order ||
      payload.data ||
      payload;

    const orderId = order.id || order.orderId || order._id;
    const orderNumber = order.number || order.orderNumber;
    const paymentStatus = String(order.paymentStatus || order.payment_status || '').toUpperCase();
    const lineItems = order.lineItems || order.line_items || [];
    const customFields = order.customFields || order.checkoutCustomFields || order.custom_fields || [];

    if (!orderId) {
      console.error('No order id in webhook payload');
      return new Response(JSON.stringify({ error: 'No order id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (paymentStatus && paymentStatus !== 'PAID') {
      console.log(`Order ${orderId} not PAID (${paymentStatus}), skipping`);
      return new Response(JSON.stringify({ ok: true, skipped: paymentStatus }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find the app user id stamped on the checkout.
    const fieldArr: any[] = Array.isArray(customFields) ? customFields : [];
    const appUserField = fieldArr.find((f: any) =>
      (f.title === 'app_user_id' || f.name === 'app_user_id' || f.translatedTitle === 'app_user_id')
    );
    const appUserId = String(appUserField?.value || '').trim();

    if (!appUserId) {
      console.warn(`Order ${orderId} has no app_user_id custom field; cannot auto-credit. User can still verify manually.`);
      return new Response(JSON.stringify({ ok: true, skipped: 'no_app_user_id' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sum credits by SKU
    let credits = 0;
    for (const item of lineItems) {
      const sku = String(item.physicalProperties?.sku || item.sku || '').toLowerCase().trim();
      const perUnit = SKU_CREDITS[sku];
      if (perUnit) credits += perUnit * (item.quantity || 1);
    }
    if (credits === 0) {
      console.log(`Order ${orderId} has no credit SKUs, skipping`);
      return new Response(JSON.stringify({ ok: true, skipped: 'no_credit_sku' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Dedup
    const { data: existing } = await admin
      .from('wix_redeemed_orders')
      .select('id')
      .eq('wix_order_id', orderId)
      .maybeSingle();
    if (existing) {
      console.log(`Order ${orderId} already redeemed`);
      return new Response(JSON.stringify({ ok: true, alreadyRedeemed: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: rpcErr } = await admin.rpc('update_user_credits', {
      p_user_id: appUserId,
      p_amount: credits,
      p_transaction_type: 'purchase',
      p_description: `Wix order #${orderNumber || orderId} (SMC AI Credits)`,
      p_paypal_transaction_id: `wix_${orderId}`,
    });
    if (rpcErr) {
      console.error('Credit RPC failed:', rpcErr);
      return new Response(JSON.stringify({ error: 'Credit failed', details: rpcErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await admin.from('wix_redeemed_orders').insert({
      user_id: appUserId,
      wix_order_id: orderId,
      wix_order_number: String(orderNumber || ''),
      credits_granted: credits,
    });

    console.log(`Credited ${credits} to user ${appUserId} for order ${orderId}`);
    return new Response(JSON.stringify({ ok: true, credits, userId: appUserId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('Webhook error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
