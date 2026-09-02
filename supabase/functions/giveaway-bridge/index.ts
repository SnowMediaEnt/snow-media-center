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
//   history        (public)  every non-draft giveaway (newest first) + its announced winners
//   my-entries     (internal) {email} -> entries + total for newest giveaway
//   claim-facebook (internal) {email, fb_name, review_url, screenshot_url}
//   site-order     (internal) {order_number, email, items:[{kind,name,quantity,
//                             slug?,variantLabel?,price?,months?}], total?, source?, smc_user_id?}
//                             → giveaway entries + CRM sync (customer / payment /
//                             service / device rows in this project) + a support
//                             ticket the admin uses to hand the customer their login
//   renewal-paid   (internal) {order_number, total, username, server, email}
//   support-session-paid (internal) {ref, order_number, total, email}
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

    if (action === 'history') {
      // Past + current giveaways for the "Previous giveaways" shelf in the app.
      const limit = Math.min(50, Math.max(1, Number(body?.limit) || 24));
      const { data: list } = await admin
        .from('giveaways')
        .select(PUBLIC_GIVEAWAY_FIELDS)
        .neq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(limit);
      const giveaways = list || [];
      const ids = giveaways.map((g) => g.id);
      let winners: Array<{ giveaway_id: string; position: number | null; public_display_name: string | null; drawn_at: string | null }> = [];
      if (ids.length) {
        const { data: w } = await admin
          .from('giveaway_public_winners')
          .select('giveaway_id,position,public_display_name,drawn_at')
          .in('giveaway_id', ids)
          .order('position');
        winners = w || [];
      }
      return json({
        giveaways: giveaways.map((g) => ({
          ...g,
          winners: winners.filter((w) => w.giveaway_id === g.id).map(({ giveaway_id: _gid, ...rest }) => rest),
        })),
      });
    }

    // ---------- INTERNAL (secret-gated) ----------
    // Accept x-internal-secret matching EITHER INTERNAL_FN_SECRET or the
    // optional SMC_BRIDGE_SECRET (missing env = no match, never crash).
    const secret = Deno.env.get('INTERNAL_FN_SECRET');
    const bridgeSecret = Deno.env.get('SMC_BRIDGE_SECRET');
    const provided = req.headers.get('x-internal-secret') || '';
    const secretOk =
      provided.length > 0 &&
      ((!!secret && provided === secret) || (!!bridgeSecret && provided === bridgeSecret));
    if (!secretOk) return json({ error: 'unauthorized' }, 401);

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

    // ---- Order → CRM sync ------------------------------------------------
    // Mirrors what an admin does by hand in the Hub after a website order:
    // find/create the customer, log the payment, add a service row per plan
    // (pending provisioning) and a device row per device, then open a support
    // ticket under the customer's app account so the admin can post the panel
    // login there and the customer sees it in the SMC app. Idempotent per
    // order number; never throws.
    type OrderItem = {
      kind?: string; name?: string; quantity?: number; slug?: string;
      variantLabel?: string; price?: number; months?: number;
    };
    const serviceTypeOf = (it: OrderItem): 'dreamstreams' | 'vibeztv' | 'plex' | null => {
      const hay = `${it.slug || ''} ${it.name || ''} ${it.variantLabel || ''}`.toLowerCase();
      if (/dream ?streams/.test(hay)) return 'dreamstreams';
      if (/vibez/.test(hay)) return 'vibeztv';
      if (/\bplex\b/.test(hay)) return 'plex';
      return null;
    };
    const monthsOf = (it: OrderItem): number => {
      if (Number.isFinite(Number(it.months)) && Number(it.months) > 0) return Number(it.months);
      const m = /(\d+)\s*(month|months|yr|year)/i.exec(`${it.variantLabel || ''} ${it.name || ''}`);
      if (m) return /yr|year/i.test(m[2]) ? Number(m[1]) * 12 : Number(m[1]);
      return 1;
    };
    const connectionsOf = (it: OrderItem): number | null => {
      const m = /(\d+)\s*conn/i.exec(`${it.variantLabel || ''} ${it.name || ''}`);
      return m ? Number(m[1]) : null;
    };
    const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
    const isoDate = (d: Date) => d.toISOString().slice(0, 10);

    const syncOrderToCrm = async (input: {
      orderNumber: string; email: string; userId: string | null; customerId: string | null;
      smcUserId: string | null; total: number; source: string | null; items: OrderItem[];
    }): Promise<{ customerId: string | null; userId: string | null; ticketId: string | null; services: number; devices: number; payment: boolean }> => {
      const out = { customerId: input.customerId, userId: input.userId, ticketId: null as string | null, services: 0, devices: 0, payment: false };
      try {
        const tag = `Website order #${input.orderNumber}`;
        // 1. Resolve the app user: email match first, then the id the TV sent.
        if (!out.userId && input.smcUserId) {
          const { data: p } = await admin.from('profiles').select('user_id').eq('user_id', input.smcUserId).maybeSingle();
          if (p?.user_id) out.userId = p.user_id;
        }
        // 2. Find or create the customer row (email-keyed; link user_id when known).
        if (!out.customerId && out.userId) {
          const { data: c } = await admin.from('customers').select('id').eq('user_id', out.userId).maybeSingle();
          if (c?.id) out.customerId = c.id;
        }
        if (!out.customerId && input.email) {
          const { data: created, error } = await admin
            .from('customers')
            .insert({ email: input.email, user_id: out.userId, name: null })
            .select('id')
            .single();
          if (!error && created?.id) out.customerId = created.id;
        } else if (out.customerId && out.userId) {
          await admin.from('customers').update({ user_id: out.userId }).eq('id', out.customerId).is('user_id', null);
        }
        if (!out.customerId) return out;

        // 3. Payment (once per order).
        const { data: existingPay } = await admin
          .from('customer_payments').select('id').eq('customer_id', out.customerId).ilike('notes', `%${tag}%`).limit(1);
        if (!existingPay || existingPay.length === 0) {
          const { error } = await admin.from('customer_payments').insert({
            customer_id: out.customerId,
            amount: input.total,
            method: input.source && input.source.startsWith('smc-tv') ? 'site_store_tv' : 'site_store',
            paid_at: new Date().toISOString(),
            service_id: null,
            notes: `${tag} — ${input.items.map((i) => `${i.quantity || 1}x ${i.name || 'item'}${i.variantLabel ? ` (${i.variantLabel})` : ''}`).join(', ')}`.slice(0, 900),
          });
          if (!error) out.payment = true;
        }

        // 4. Services + devices (once per order).
        const { data: existingSvc } = await admin
          .from('customer_services').select('id').eq('customer_id', out.customerId).ilike('notes', `%${tag}%`).limit(1);
        const alreadySynced = !!(existingSvc && existingSvc.length > 0);
        const serviceNames: string[] = [];
        if (!alreadySynced) {
          const now = new Date();
          for (const it of input.items) {
            const kind = String(it.kind || '').toLowerCase();
            if (kind === 'included') continue;
            const svc = serviceTypeOf(it);
            const isBundle = kind === 'service' && !!svc && !!it.slug && !['dreamstreams', 'vibeztv', 'plex'].includes(String(it.slug));
            if (kind === 'service' && svc) {
              const months = monthsOf(it);
              const label = `${it.name || svc}${it.variantLabel ? ` — ${it.variantLabel}` : ''}`.slice(0, 200);
              const { error } = await admin.from('customer_services').insert({
                customer_id: out.customerId,
                service_type: svc,
                service_name: label,
                connections: connectionsOf(it),
                start_date: isoDate(now),
                expiration_date: isoDate(addMonths(now, months)),
                renewal_status: 'pending_provision',
                notes: `${tag} — awaiting panel login (send via ticket)`,
              });
              if (!error) { out.services++; serviceNames.push(label); }
            }
            if (kind === 'device' || isBundle) {
              const { error } = await admin.from('customer_devices').insert({
                customer_id: out.customerId,
                device_type: String(it.name || 'Device').slice(0, 120),
                label: `${tag}${isBundle ? ' (bundle)' : ''}`,
              });
              if (!error) out.devices++;
            }
          }
        }

        // 5. Provisioning ticket under the customer's app account — the admin
        //    replies with the login and the customer reads it in the app.
        if (out.userId && !alreadySynced) {
          const subject = `Order #${input.orderNumber} — your service login`;
          const { data: existingTicket } = await admin
            .from('support_tickets').select('id').eq('user_id', out.userId).eq('subject', subject).limit(1);
          if (!existingTicket || existingTicket.length === 0) {
            const { data: t, error } = await admin
              .from('support_tickets')
              .insert({ user_id: out.userId, subject, status: 'open', priority: 'high', user_has_unread: true, admin_has_unread: true })
              .select('id')
              .single();
            if (!error && t?.id) {
              out.ticketId = t.id;
              const lines = [
                `Thanks for your order #${input.orderNumber}!`,
                serviceNames.length
                  ? `We're setting up ${serviceNames.join(' and ')} now. Your login details will be posted right here in this ticket as soon as it's ready — usually within a few hours.`
                  : `We're processing it now and will post any updates right here in this ticket.`,
                out.devices ? `Your device order is on our list too — shipping updates land here as well.` : '',
                `Reply here any time if you need a hand.`,
              ].filter(Boolean);
              await admin.from('support_messages').insert({
                ticket_id: t.id, user_id: null, sender_type: 'admin', message: lines.join('\n\n'),
              });
            }
          }
        }
      } catch (err) {
        console.error('[giveaway-bridge] crm sync threw:', err instanceof Error ? err.message : String(err));
      }
      return out;
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
      const resolved = await resolveByEmail(body.email);
      // CRM sync runs whether or not a giveaway is live — a purchase must land
      // on the customer's record (and in their app) every time.
      const crm = await syncOrderToCrm({
        orderNumber,
        email: resolved.email,
        userId: resolved.userId,
        customerId: resolved.customerId,
        smcUserId: body.smc_user_id ? String(body.smc_user_id) : null,
        total: Number(body.total) || 0,
        source: body.source ? String(body.source).slice(0, 60) : null,
        items,
      });
      const g = await getActiveGiveaway(admin);
      if (!g) return json({ ok: true, skipped: 'no_active_giveaway', crm });
      const email = resolved.email;
      const userId = crm.userId ?? resolved.userId;
      const customerId = crm.customerId ?? resolved.customerId;

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
      return json({ ok: true, awarded, matched: !!(userId || customerId), status, crm });
    }

    if (action === 'renewal-paid') {
      // Fire-and-forget from the marketing site — NEVER 500 outward; failures
      // still post to Discord and return 200 with ok:false + reason.
      if (body.test === true) {
        try {
          const hook = Deno.env.get('DISCORD_WEBHOOK_URL');
          if (hook) {
            await fetch(hook, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: '🧪 SMC bridge test OK — renewal channel is connected.' }),
            });
          }
        } catch (err) {
          console.error('[giveaway-bridge] renewal test discord threw:', err instanceof Error ? err.message : String(err));
        }
        return json({ ok: true, test: true });
      }

      const orderNumber = String(body.order_number || '').trim();
      const total = Number(body.total) || 0;
      const username = String(body.username || '').trim().toLowerCase();
      const server = body.server ? String(body.server).trim() : null;
      const email = body.email ? String(body.email).trim().toLowerCase() : null;
      // deno-lint-ignore no-explicit-any
      const items: any[] = Array.isArray(body.items) ? body.items : [];
      const itemsDesc = items
        .map((it) => `${String(it?.name || 'item')} x${Math.max(1, Number(it?.quantity || 1) || 1)}`)
        .join(', ') || '(no items)';

      // Panel host hints for server-label filtering.
      const HOST_BY_LABEL: Record<string, string> = { vibez: 'strmz.xyz', dreamstreams: 'dstreams.xyz:8080' };
      const hostHint = server ? HOST_BY_LABEL[server.toLowerCase()] : undefined;
      // Escape ilike pattern metacharacters so usernames match literally.
      const escLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

      let matched = false;
      let reason = '';
      let customer: { id: string; name: string | null; email: string | null } | null = null;
      let serviceId: string | null = null;

      try {
        if (username) {
          // (a) player_signins by panel_username (+ panel_host when server given)
          let sq = admin
            .from('player_signins')
            .select('matched_customer_id')
            .ilike('panel_username', escLike(username))
            .order('last_seen_at', { ascending: false })
            .limit(5);
          if (hostHint) sq = sq.ilike('panel_host', `%${escLike(hostHint)}%`);
          const { data: signins } = await sq;
          const cid = (signins || []).map((s) => s.matched_customer_id).find(Boolean);
          if (cid) {
            const { data: c } = await admin.from('customers').select('id,name,email').eq('id', cid).maybeSingle();
            if (c) customer = c;
          }

          // (b) customer_services by lower(panel_username) — also yields service_id
          let svcQ = admin
            .from('customer_services')
            .select('id,customer_id')
            .ilike('panel_username', escLike(username))
            .order('expiration_date', { ascending: false })
            .limit(5);
          if (hostHint) svcQ = svcQ.ilike('panel_host', `%${escLike(hostHint)}%`);
          const { data: svcs } = await svcQ;
          const svc = (svcs || [])[0];
          if (svc) {
            serviceId = svc.id;
            if (!customer && svc.customer_id) {
              const { data: c } = await admin.from('customers').select('id,name,email').eq('id', svc.customer_id).maybeSingle();
              if (c) customer = c;
            }
          }
        }

        // (c) customers by lower(email) when email present
        if (!customer && email) {
          const { data: custs } = await admin.from('customers').select('id,name,email').ilike('email', escLike(email)).limit(2);
          if (custs && custs.length === 1) customer = custs[0];
        }

        matched = !!customer;
        if (customer) {
          const { error: payErr } = await admin.from('customer_payments').insert({
            customer_id: customer.id,
            service_id: serviceId,
            amount: total,
            method: 'paypal_site',
            paid_at: new Date().toISOString(),
            notes: `Site renewal — order ${orderNumber} — ${username}`,
          });
          if (payErr) {
            reason = 'payment_insert_failed';
            console.error('[giveaway-bridge] renewal-paid insert:', payErr.message);
          }
        } else {
          reason = 'no_crm_match';
        }
      } catch (err) {
        reason = 'resolution_error';
        console.error('[giveaway-bridge] renewal-paid threw:', err instanceof Error ? err.message : String(err));
      }

      // ALWAYS post to Discord, matched or not.
      try {
        const hook = Deno.env.get('DISCORD_WEBHOOK_URL');
        if (hook) {
          const who = customer ? (customer.name || customer.email || customer.id) : '⚠️ no CRM match';
          await fetch(hook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content:
                `💰 RENEWAL PAID — ${username} (${server ?? 'unknown server'}) — order ${orderNumber} — $${total}\n` +
                `Customer: ${who}\n` +
                `Items: ${itemsDesc}\n` +
                `→ Extend the line on the panel; tomorrow's digest will confirm the new date.`,
            }),
          });
        }
      } catch (err) {
        console.error('[giveaway-bridge] renewal discord threw:', err instanceof Error ? err.message : String(err));
      }

      // Fire-and-forget admin push (same pattern as admin-notify).
      try {
        const internal = Deno.env.get('INTERNAL_FN_SECRET');
        const supaUrl = Deno.env.get('SUPABASE_URL');
        if (internal && supaUrl) {
          await fetch(`${supaUrl}/functions/v1/send-push`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-internal-secret': internal,
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') ?? ''}`,
            },
            body: JSON.stringify({
              title: 'Renewal paid',
              body: `${username} — $${total} — order ${orderNumber}`,
              tag: `renewal-${orderNumber}`,
            }),
          });
        }
      } catch (err) {
        console.error('[giveaway-bridge] renewal push threw:', err instanceof Error ? err.message : String(err));
      }

      if (reason) return json({ ok: false, matched, reason });
      return json({ ok: true, matched: true });
    }

    if (action === 'support-session-paid') {
      // snowmediaent.com checkout webhook for the $25 Remote Access session.
      // { ref, order_number, total, email } — ref is the remote_support_requests id.
      const ref = String(body.ref || '').trim();
      const orderNumber = String(body.order_number || '').trim();
      const total = Number(body.total) || 0;
      const email = body.email ? String(body.email).trim().toLowerCase() : '';
      if (!ref) return json({ ok: false, error: 'missing_ref' }, 400);

      // Only flip pending_payment -> paid: unknown refs and duplicate webhook
      // deliveries are ignored quietly (no notify spam on retries).
      const { data: row, error: upErr } = await admin
        .from('remote_support_requests')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          order_number: orderNumber || null,
        })
        .eq('id', ref)
        .eq('status', 'pending_payment')
        .select('id, issue, contact')
        .maybeSingle();
      if (upErr) {
        console.error('[giveaway-bridge] support-session-paid update:', upErr.message);
        return json({ ok: false, error: 'update_failed' });
      }
      if (!row) return json({ ok: true, skipped: 'unknown_ref' });

      // Discord ping (tickets hook first, main hook fallback — same as notify-ticket).
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
              content:
                `🛠️ REMOTE SUPPORT PAID — ${email || 'unknown email'} — $${total} — order ${orderNumber || 'n/a'}\n` +
                `Issue: ${(row.issue || '').slice(0, 300)}\n` +
                `Contact: ${row.contact || 'n/a'}\n` +
                `Ref: ${ref}\n` +
                `→ Open the Hub → Support → Remote Requests, then start the session from the Support app.`,
            }),
          });
          discord_status = res.status;
        }
      } catch (err) {
        discord_status = 'threw';
        console.error('[giveaway-bridge] support discord threw:', err instanceof Error ? err.message : String(err));
      }

      // Fire-and-forget admin push (same pattern as admin-notify).
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
              title: '🛠️ Remote Support paid',
              body: `${email || 'A customer'} — $${total} — order ${orderNumber || 'n/a'}`,
              tag: `remote-support-${ref}`,
            }),
          });
          push_status = res.status;
        }
      } catch (err) {
        push_status = 'threw';
        console.error('[giveaway-bridge] support push threw:', err instanceof Error ? err.message : String(err));
      }

      console.log(`[giveaway-bridge] support-session-paid ref=${ref} discord=${discord_status} push=${push_status}`);
      return json({ ok: true, discord_status, push_status });
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
