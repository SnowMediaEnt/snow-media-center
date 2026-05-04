import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PAYPAL_MODE = (Deno.env.get('PAYPAL_MODE') || 'live').trim().toLowerCase();
const PAYPAL_BASE = ['sandbox', 'test'].includes(PAYPAL_MODE)
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

async function getAccessToken(): Promise<string> {
  const id = Deno.env.get('PAYPAL_CLIENT_ID')?.trim();
  const secret = Deno.env.get('PAYPAL_CLIENT_SECRET')?.trim();
  if (!id || !secret) throw new Error('PayPal credentials not configured');
  console.log(`PayPal mode: ${PAYPAL_MODE}; host: ${new URL(PAYPAL_BASE).host}`);
  const auth = btoa(`${id}:${secret}`);
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal token error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = await req.json();
    const { action, package_id, order_id, return_url, cancel_url } = body;

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    if (action === 'create-order') {
      if (!package_id) {
        return new Response(JSON.stringify({ error: 'package_id required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data: pkg, error: pkgErr } = await admin
        .from('credit_packages')
        .select('id, name, credits, price, is_active')
        .eq('id', package_id)
        .maybeSingle();

      if (pkgErr || !pkg || !pkg.is_active) {
        return new Response(JSON.stringify({ error: 'Package not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const accessToken = await getAccessToken();
      const orderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: pkg.id,
            description: `${pkg.name} — ${pkg.credits} credits`,
            custom_id: `${user.id}|${pkg.id}|${pkg.credits}`,
            amount: {
              currency_code: 'USD',
              value: Number(pkg.price).toFixed(2),
            },
          }],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: 'Snow Media Center',
                user_action: 'PAY_NOW',
                shipping_preference: 'NO_SHIPPING',
                return_url: return_url || 'https://www.snowmediaent.com/',
                cancel_url: cancel_url || 'https://www.snowmediaent.com/',
              },
            },
          },
        }),
      });

      const orderData = await orderRes.json();
      if (!orderRes.ok) {
        console.error('PayPal create error:', orderData);
        return new Response(JSON.stringify({ error: 'PayPal order creation failed', details: orderData }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const approvalUrl = orderData.links?.find((l: any) => l.rel === 'approve' || l.rel === 'payer-action')?.href;
      return new Response(JSON.stringify({
        order_id: orderData.id,
        approval_url: approvalUrl,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'capture-order') {
      if (!order_id) {
        return new Response(JSON.stringify({ error: 'order_id required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const accessToken = await getAccessToken();
      const capRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${order_id}/capture`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const capData = await capRes.json();
      console.log('PayPal capture status:', capRes.status, JSON.stringify(capData));

      if (!capRes.ok || capData.status !== 'COMPLETED') {
        return new Response(JSON.stringify({
          error: 'Payment not completed',
          status: capData.status,
          details: capData,
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const pu = capData.purchase_units?.[0];
      const customId: string = pu?.payments?.captures?.[0]?.custom_id || pu?.custom_id || '';
      const captureId: string = pu?.payments?.captures?.[0]?.id || capData.id;
      const [uid, pkgId, creditsStr] = customId.split('|');

      if (uid !== user.id) {
        return new Response(JSON.stringify({ error: 'Order user mismatch' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Dedup: if this PayPal capture/order was already credited, skip
      const { data: existing } = await admin
        .from('credit_transactions')
        .select('id')
        .eq('paypal_transaction_id', captureId)
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify({ ok: true, already_credited: true, credits: Number(creditsStr) }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const credits = Number(creditsStr) || 0;
      const { data: pkg } = await admin
        .from('credit_packages')
        .select('name')
        .eq('id', pkgId)
        .maybeSingle();

      const { error: rpcErr } = await admin.rpc('update_user_credits', {
        p_user_id: user.id,
        p_amount: credits,
        p_transaction_type: 'purchase',
        p_description: `PayPal — ${pkg?.name || 'Credits'}`,
        p_paypal_transaction_id: captureId,
      });

      if (rpcErr) {
        console.error('Credit RPC error:', rpcErr);
        return new Response(JSON.stringify({ error: 'Failed to credit account', details: rpcErr.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Best-effort: tag the buyer in Wix CRM so the email matches a Wix account/contact.
      // Failure here must not block the credit grant.
      try {
        const buyerEmail = user.email || '';
        const meta: any = user.user_metadata || {};
        const fullName: string = meta.full_name || meta.name || '';
        const [firstName, ...rest] = fullName.split(' ');
        const lastName = rest.join(' ');
        if (buyerEmail) {
          const tagRes = await admin.functions.invoke('wix-integration', {
            body: {
              action: 'tag-credit-purchase',
              email: buyerEmail,
              firstName: firstName || '',
              lastName: lastName || '',
              labelKey: 'custom.smc-credits-buyer',
            },
            headers: { Authorization: authHeader },
          });
          console.log('Wix tag result:', JSON.stringify(tagRes));
        }
      } catch (wixErr) {
        console.error('Wix tag (non-fatal):', wixErr);
      }

      return new Response(JSON.stringify({ ok: true, credits, capture_id: captureId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('paypal-checkout error:', err);
    return new Response(JSON.stringify({ error: err?.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
