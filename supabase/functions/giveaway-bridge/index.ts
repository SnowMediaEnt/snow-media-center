// giveaway-bridge — public summary for the marketing website (which runs on a
// DIFFERENT Supabase project) plus internal secret-gated actions for
// cross-project flows and DB-trigger admin notifies.
//
// verify_jwt = false (see config.toml). 'summary' is public; every other
// action requires the x-internal-secret header matching INTERNAL_FN_SECRET.
// Uses the service-role client; giveaway_award_entry is service-role-only.
//
// Actions:
//   summary        (public)  newest non-draft giveaway + announced winners
//   my-entries     (internal) {email} -> entries + total for newest giveaway
//   claim-facebook (internal) {email, fb_name, review_url, screenshot_url}
//   site-order     (internal) {order_number, email, items:[{kind,name,quantity}]}
//   admin-notify   (internal) {entry_id} -> Discord + web push to admins
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getActiveGiveaway } from '../_shared/giveaway.ts';

const PUBLIC_GIVEAWAY_FIELDS =
  'id,slug,name,description,prize_description,prize_image_url,winner_count,' +
  'included_service_description,start_at,end_at,status,rules_md,announcement_md';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    // deno-lint-ignore no-explicit-any
    const body: any = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ---------- PUBLIC ----------
    if (action === 'summary') {
      const { data: g } = await admin
        .from('giveaways')
        .select(PUBLIC_GIVEAWAY_FIELDS)
        .neq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!g) return json({ giveaway: null, winners: [] });
      const { data: winners } = await admin
        .from('giveaway_public_winners')
        .select('position,public_display_name,drawn_at')
        .eq('giveaway_id', g.id)
        .order('position');
      return json({ giveaway: g, winners: winners || [] });
    }

    // ---------- INTERNAL (secret-gated) ----------
    const secret = Deno.env.get('INTERNAL_FN_SECRET');
    const provided = req.headers.get('x-internal-secret') || '';
    if (!secret || provided !== secret) return json({ error: 'unauthorized' }, 401);

    const latestGiveaway = async () => {
      const { data } = await admin
        .from('giveaways')
        .select('id,slug,name,status,start_at,end_at,config')
        .neq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    };

    // Resolve an email to a UNIQUE profiles row and/or UNIQUE customers row.
    const resolveByEmail = async (emailRaw: unknown) => {
      const email = String(emailRaw || '').toLowerCase().trim();
      let userId: string | null = null;
      let customerId: string | null = null;
      if (email) {
        const { data: profs } = await admin.from('profiles').select('user_id').ilike('email', email).limit(2);
        if (profs && profs.length === 1) userId = profs[0].user_id;
        const { data: custs } = await admin.from('customers').select('id,user_id').ilike('email', email).limit(2);
        if (custs && custs.length === 1) {
          customerId = custs[0].id;
          if (!userId) userId = custs[0].user_id;
        }
      }
      return { email, userId, customerId };
    };

    if (action === 'my-entries') {
      const { userId, customerId } = await resolveByEmail(body.email);
      if (!userId && !customerId) return json({ matched: false });
      const g = await latestGiveaway();
      if (!g) return json({ matched: true, giveaway: null, my_entries: [], my_total_valid: 0 });
      let q = admin
        .from('giveaway_entries')
        .select('entry_type,entry_count,status,source_reference,created_at')
        .eq('giveaway_id', g.id)
        .order('created_at', { ascending: true });
      if (userId && customerId) q = q.or(`user_id.eq.${userId},customer_id.eq.${customerId}`);
      else if (userId) q = q.eq('user_id', userId);
      else q = q.eq('customer_id', customerId!);
      const { data: rows } = await q;
      const entries = rows || [];
      const total = entries.reduce(
        // deno-lint-ignore no-explicit-any
        (s: number, r: any) => s + (r.status === 'valid' ? Number(r.entry_count) || 0 : 0),
        0,
      );
      return json({
        matched: true,
        giveaway: { id: g.id, slug: g.slug, name: g.name, status: g.status, start_at: g.start_at, end_at: g.end_at },
        my_entries: entries,
        my_total_valid: total,
      });
    }

    if (action === 'claim-facebook') {
      const fbName = String(body.fb_name || '').trim();
      const reviewUrl = String(body.review_url || '').trim();
      const shotUrl = String(body.screenshot_url || '').trim();
      const { email, userId, customerId } = await resolveByEmail(body.email);
      if (!userId && !customerId) return json({ ok: false, error: 'no_smc_account' });
      if (!fbName) return json({ ok: false, error: 'missing_name' });
      const g = await getActiveGiveaway(admin);
      if (!g) return json({ ok: false, error: 'giveaway_not_active' });
      // Same field/metadata shape as the giveaway_claim_facebook RPC.
      const { data: ins, error } = await admin
        .from('giveaway_entries')
        .insert({
          giveaway_id: g.id,
          user_id: userId,
          customer_id: customerId,
          entry_type: 'facebook_review',
          entry_count: 1,
          status: 'pending',
          metadata: {
            fb_profile: fbName,
            review_url: reviewUrl,
            screenshot_url: shotUrl,
            buyer_email: email || null,
            via: 'bridge',
          },
        })
        .select('id')
        .single();
      if (error) {
        if (String(error.code) === '23505' || /duplicate key/i.test(error.message)) {
          return json({ ok: false, error: 'already_claimed' });
        }
        console.error('[giveaway-bridge] claim insert error:', error.message);
        return json({ ok: false, error: 'insert_failed' });
      }
      // Same audit trail as giveaway_claim_facebook (actor is null: bridge caller).
      await admin.from('giveaway_audit_log').insert({
        giveaway_id: g.id,
        actor: null,
        action: 'facebook_claim_submitted',
        entry_id: ins.id,
        details: { fb_profile: fbName, via: 'bridge' },
      });
      // The AFTER INSERT trigger on giveaway_entries fires admin-notify.
      return json({ ok: true, entry_id: ins.id, status: 'pending' });
    }

    if (action === 'site-order') {
      const orderNumber = String(body.order_number || '').trim();
      // deno-lint-ignore no-explicit-any
      const items: any[] = Array.isArray(body.items) ? body.items : [];
      if (!orderNumber || items.length === 0) return json({ ok: false, error: 'missing_order' }, 400);
      const g = await getActiveGiveaway(admin);
      if (!g) return json({ ok: true, skipped: 'no_active_giveaway' });
      const { email, userId, customerId } = await resolveByEmail(body.email);

      // deno-lint-ignore no-explicit-any
      const rules: any[] = (g.config?.purchase_rules as any[]) || [];
      const deviceRule = rules.find((r) => r.entry_type === 'device_purchase');
      const renewalRule = rules.find((r) => r.entry_type === 'renewal');
      const devicePatterns = (deviceRule?.patterns || [])
        .map((p: unknown) => String(p).toLowerCase())
        .filter(Boolean);

      let serviceItems = 0;
      let deviceQty = 0;
      for (const item of items) {
        const kind = String(item?.kind || '').toLowerCase();
        const name = String(item?.name || '').toLowerCase();
        const qty = Math.max(1, Number(item?.quantity || 1) || 1);
        if (kind === 'service') serviceItems++;
        else if (kind === 'device' || devicePatterns.some((p: string) => name && name.includes(p))) deviceQty += qty;
      }

      const sourceId = 'site_' + orderNumber;
      const status = userId || customerId ? 'valid' : 'pending';
      let awarded = 0;
      const award = async (type: string, count: number) => {
        const { data, error } = await admin.rpc('giveaway_award_entry', {
          p_giveaway_id: g.id,
          p_user_id: userId,
          p_customer_id: customerId,
          p_type: type,
          p_count: count,
          p_source_id: sourceId,
          p_source_ref: `Website order #${orderNumber}`,
          p_status: status,
          p_metadata: { buyer_email: email || null, via: 'site' },
        });
        if (error) console.error('[giveaway-bridge] site-order award error:', error.message);
        else if (data) awarded++; // null = dedupe no-op (idempotent)
      };
      if (serviceItems > 0) await award('renewal', Math.max(1, Number(renewalRule?.entries || 1) || 1));
      if (deviceQty > 0) await award('device_purchase', Math.max(1, Number(deviceRule?.entries || 2) || 2) * deviceQty);
      return json({ ok: true, awarded, matched: !!(userId || customerId), status });
    }

    if (action === 'admin-notify') {
      // Called by the trg_giveaway_pending_notify trigger via pg_net. Never throws.
      const entryId = String(body.entry_id || '');
      if (!entryId) return json({ ok: false, error: 'missing_entry_id' }, 400);
      const { data: e } = await admin
        .from('giveaway_entries')
        .select('id,giveaway_id,entry_type,metadata,user_id,customer_id')
        .eq('id', entryId)
        .maybeSingle();
      if (!e) return json({ ok: true, skipped: 'entry_not_found' });

      // deno-lint-ignore no-explicit-any
      const meta: any = e.metadata || {};
      let email: string | null = meta.buyer_email || null;
      if (!email && e.user_id) {
        const { data: p } = await admin.from('profiles').select('email').eq('user_id', e.user_id).maybeSingle();
        email = p?.email || null;
      }
      if (!email && e.customer_id) {
        const { data: c } = await admin.from('customers').select('email').eq('id', e.customer_id).maybeSingle();
        email = c?.email || null;
      }
      const fb = meta.fb_profile || '(no FB name)';
      const who = email || 'unknown email';

      // Discord (same hooks + fallback as notify-ticket)
      let discord_status: number | string = 'skipped';
      try {
        const hook = Deno.env.get('DISCORD_WEBHOOK_URL_TICKETS') || Deno.env.get('DISCORD_WEBHOOK_URL');
        if (!hook) {
          discord_status = 'no_webhook';
        } else {
          const res = await fetch(hook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: `🎁 New giveaway Facebook entry pending review — ${fb} (${who}) — approve in the Hub`,
            }),
          });
          discord_status = res.status;
        }
      } catch (err) {
        discord_status = 'threw';
        console.error('[giveaway-bridge] discord threw:', err instanceof Error ? err.message : String(err));
      }

      // Web push to admins via the send-push internal pattern
      let push_status: number | string = 'skipped';
      try {
        const internal = Deno.env.get('INTERNAL_FN_SECRET');
        const supaUrl = Deno.env.get('SUPABASE_URL');
        if (!internal || !supaUrl) {
          push_status = 'no_config';
        } else {
          const res = await fetch(`${supaUrl}/functions/v1/send-push`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-internal-secret': internal,
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') ?? ''}`,
            },
            body: JSON.stringify({
              title: '🎁 Giveaway entry to review',
              body: `${fb} (${who}) submitted a Facebook review — approve in the Hub`,
              url: 'https://smchub.lovable.app/giveaway',
              tag: `giveaway-${entryId}`,
            }),
          });
          push_status = res.status;
        }
      } catch (err) {
        push_status = 'threw';
        console.error('[giveaway-bridge] push threw:', err instanceof Error ? err.message : String(err));
      }

      console.log(`[giveaway-bridge] admin-notify entry=${entryId} discord=${discord_status} push=${push_status}`);
      return json({ ok: true, discord_status, push_status });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    // Never 500 outward — the DB trigger must not see failures.
    console.error('[giveaway-bridge] unhandled:', e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: 'internal' });
  }
});
