// Forgot a profile PIN.
//
// A profile's PIN is a household lock the app checks on the box (see
// viewer_profiles). When someone forgets it, the app offers "Forgot PIN?"
// after a few wrong tries and calls this:
//
//   request {profile_id}          signed-in owner: emails a 6-digit code to the
//                                 account address and opens (or adds to) a
//                                 support ticket, so an admin can clear it by
//                                 hand when the email never arrives
//   verify  {profile_id, code}    signed-in owner: the right code clears the
//                                 PIN and closes that ticket
//   admin_list  {user_id}         admins (has_role 'admin'): a customer's
//                                 profiles, for the Hub's ticket page
//   admin_clear {user_id, profile_id, ticket_id?}
//                                 admins: clear the PIN; notes it on the ticket
//                                 and emails the account address that support
//                                 removed it
//
// THE PARENT PIN (the account's lock on Profiles, viewer_parent_pin) goes
// through the same actions with profile_id '__parent__'. Its verify takes the
// new PIN's hash too (new_pin_hash) and puts it in place of the old one when
// the code is right, so a reset never leaves the account without one. With no
// row yet, the same request and verify make the first one: on an account with
// Kids profiles and no grown-up profile PIN, the emailed code is the app's
// proof that a grown-up is making it (no ticket then: there is nothing for
// support to clear). Requests share the profiles' limits (3 codes an hour, 5
// tries a code). admin_list says whether the account has one; admin_clear
// removes it (the app then asks a grown-up for proof to make another).
//
// "Forgot PIN?" is on the TV, so anyone holding the remote can start a
// request, including the person the PIN keeps out. The emailed code proves
// the account holder; a ticket does not. So the ticket tells the admin to
// clear the PIN only once the account holder has confirmed from the
// account's email, and a clear always tells that address it happened.
//
// Codes are kept hashed in profile_pin_resets (no client can read it), last
// 30 minutes, allow 5 tries, and at most 3 are sent an hour. Nothing here logs
// a code, a PIN hash or an address.
//
// Secrets: RESEND_API_KEY, EMAIL_FROM (a verified sender; without it Resend's
// sandbox only delivers to the Resend account owner), EMAIL_REPLY_TO.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const FROM = Deno.env.get('EMAIL_FROM') || 'Snow Media <onboarding@resend.dev>';
const REPLY_TO = Deno.env.get('EMAIL_REPLY_TO') || 'support@snowmediaent.com';
const CODE_TTL_MS = 30 * 60 * 1000;
const MAX_TRIES = 5;
const MAX_SENDS_PER_HOUR = 3;
const TICKET_SUBJECT = 'Profile PIN reset';

const PROFILE_ID = /^[a-z0-9]{1,16}$/;
/** The Parent PIN's stand-in for a profile id (never a real one: those are letters and digits). */
const PARENT = '__parent__';
const PIN_HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sha256 = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

const sixDigits = (): string => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(6, '0');
};

/** "wehavevibez@gmail.com" → "we•••••@gmail.com" */
const maskEmail = (email: string): string => {
  const [user, domain] = email.split('@');
  if (!domain) return '•••';
  return `${user.slice(0, Math.min(2, user.length))}•••••@${domain}`;
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const emailHtml = (profileName: string, code: string) => `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0b1b36">
  <h2 style="margin:0 0 12px">Reset the PIN for “${escapeHtml(profileName)}”</h2>
  <p style="margin:0 0 16px">Someone asked to reset this profile's PIN in Snow Media Center. Enter this code on the TV:</p>
  <div style="font-size:36px;font-weight:bold;letter-spacing:10px;background:#f1f4fa;border-radius:12px;padding:16px;text-align:center">${code}</div>
  <p style="margin:16px 0 0;color:#555">The code works for 30 minutes. It removes the PIN; you can set a new one under Settings → Profiles.</p>
  <p style="margin:12px 0 0;color:#555">Didn't ask for this? You can ignore this email — the PIN stays as it is.</p>
</div>`;

const parentSetupHtml = (code: string) => `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0b1b36">
  <h2 style="margin:0 0 12px">Set up your parent PIN</h2>
  <p style="margin:0 0 16px">Someone is setting up the parent PIN in Snow Media Center (the PIN that locks adding, changing and leaving profiles). Enter this code on the TV:</p>
  <div style="font-size:36px;font-weight:bold;letter-spacing:10px;background:#f1f4fa;border-radius:12px;padding:16px;text-align:center">${code}</div>
  <p style="margin:16px 0 0;color:#555">The code works for 30 minutes. The TV then asks for the new parent PIN.</p>
  <p style="margin:12px 0 0;color:#555">Didn't ask for this? Ignore this email: without the code, no parent PIN is set.</p>
</div>`;

const parentEmailHtml = (code: string) => `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0b1b36">
  <h2 style="margin:0 0 12px">Reset your parent PIN</h2>
  <p style="margin:0 0 16px">Someone asked to reset the parent PIN in Snow Media Center (the PIN that locks adding, changing and leaving profiles). Enter this code on the TV:</p>
  <div style="font-size:36px;font-weight:bold;letter-spacing:10px;background:#f1f4fa;border-radius:12px;padding:16px;text-align:center">${code}</div>
  <p style="margin:16px 0 0;color:#555">The code works for 30 minutes. The TV then asks for a new parent PIN, which replaces the old one.</p>
  <p style="margin:12px 0 0;color:#555">Didn't ask for this? You can ignore this email — the parent PIN stays as it is.</p>
</div>`;

const parentClearedHtml = () => `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0b1b36">
  <h2 style="margin:0 0 12px">Your parent PIN was removed</h2>
  <p style="margin:0 0 16px">Snow Media support removed the parent PIN from your account in Snow Media Center. The next time Profiles opens, it asks for a new one.</p>
  <p style="margin:12px 0 0;color:#555">Didn't ask for this? Set a new parent PIN under Settings → Profiles and reply to this email so we can look into it.</p>
</div>`;

const clearedHtml = (profileName: string) => `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0b1b36">
  <h2 style="margin:0 0 12px">The PIN on “${escapeHtml(profileName)}” was removed</h2>
  <p style="margin:0 0 16px">Snow Media support removed the PIN from this profile in Snow Media Center. The profile opens without a PIN now; you can set a new one under Settings → Profiles.</p>
  <p style="margin:12px 0 0;color:#555">Didn't ask for this? Set a new PIN on the profile and reply to this email so we can look into it.</p>
</div>`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ ok: false, reason: 'config' }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const { data: who } = bearer ? await admin.auth.getUser(bearer) : { data: { user: null } };
  const caller = who?.user ?? null;
  if (!caller) return json({ ok: false, reason: 'signed_out' }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action ?? '');

  // ── admin ───────────────────────────────────────────────────────────────
  if (action === 'admin_list' || action === 'admin_clear') {
    const { data: isAdmin } = await admin.rpc('has_role', { _user_id: caller.id, _role: 'admin' });
    if (!isAdmin) return json({ ok: false, reason: 'forbidden' }, 403);
    const userId = String(body.user_id ?? '');
    if (!UUID.test(userId)) return json({ ok: false, reason: 'bad_user' }, 400);

    if (action === 'admin_list') {
      const { data, error } = await admin.from('viewer_profiles')
        .select('id,name,kids_level,pin_hash,updated_at').eq('user_id', userId).order('position');
      if (error) return json({ ok: false, reason: 'db_error' }, 500);
      const { data: parentRow } = await admin.from('viewer_parent_pin').select('updated_at').eq('user_id', userId).maybeSingle();
      return json({
        ok: true,
        profiles: (data ?? []).map((p) => ({ id: p.id, name: p.name, kids_level: p.kids_level, has_pin: !!p.pin_hash, updated_at: p.updated_at })),
        parent_pin: { has_pin: !!parentRow, updated_at: parentRow?.updated_at ?? null },
      });
    }

    const profileId = String(body.profile_id ?? '');
    const parent = profileId === PARENT;
    if (!parent && !PROFILE_ID.test(profileId)) return json({ ok: false, reason: 'bad_profile' }, 400);
    const { data: prof, error } = parent
      ? await admin.from('viewer_parent_pin').delete().eq('user_id', userId).select('user_id').maybeSingle()
      : await admin.from('viewer_profiles')
        .update({ pin_hash: null, updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('id', profileId).select('name').maybeSingle();
    if (error) return json({ ok: false, reason: 'db_error' }, 500);
    if (!prof) return json({ ok: false, reason: parent ? 'no_pin' : 'no_profile' }, 404);
    const profName = parent ? 'parent PIN' : String((prof as { name?: string }).name ?? '');
    // Any code still out there is moot now.
    await admin.from('profile_pin_resets').update({ used_at: new Date().toISOString() })
      .eq('user_id', userId).eq('profile_id', profileId).is('used_at', null);
    const ticketId = String(body.ticket_id ?? '');
    if (UUID.test(ticketId)) {
      await admin.from('support_messages').insert({
        ticket_id: ticketId, user_id: caller.id, sender_type: 'admin',
        message: parent
          ? `We've removed your parent PIN. Open Snow Media Center and go to Profiles — it will ask you to create a new one.`
          : `We've removed the PIN from the "${profName}" profile. Open Snow Media Center and pick the profile — it won't ask for a PIN. You can set a new one under Settings → Profiles.`,
      });
    }
    // The account holder always hears about it, at the account's address:
    // the ticket is readable on the TV, where the request may not have come
    // from them.
    let notified = false;
    try {
      const { data: owner } = await admin.auth.admin.getUserById(userId);
      const to = owner?.user?.email ?? null;
      const apiKey = Deno.env.get('RESEND_API_KEY');
      if (to && apiKey) {
        const { error: sendErr } = await new Resend(apiKey).emails.send({
          from: FROM, to: [to], replyTo: REPLY_TO,
          subject: parent ? 'The parent PIN on your Snow Media account was removed' : `The PIN on your "${profName}" profile was removed`,
          html: parent ? parentClearedHtml() : clearedHtml(profName),
        });
        if (sendErr) console.error('[profile-pin-reset] clear notice failed:', (sendErr as { message?: string }).message ?? 'unknown');
        else notified = true;
      }
    } catch (e) {
      console.error('[profile-pin-reset] clear notice threw:', (e as Error).message);
    }
    return json({ ok: true, notified });
  }

  // ── owner ───────────────────────────────────────────────────────────────
  const profileId = String(body.profile_id ?? '');
  const parent = profileId === PARENT;
  if (!parent && !PROFILE_ID.test(profileId)) return json({ ok: false, reason: 'bad_profile' }, 400);
  // The Parent PIN stands in for a profile: one row an account in its own table.
  let profile: { name: string; pin_hash: string | null } | null = null;
  if (parent) {
    const { data: row } = await admin.from('viewer_parent_pin').select('pin_hash').eq('user_id', caller.id).maybeSingle();
    profile = { name: 'Parent PIN', pin_hash: row?.pin_hash ?? null };
  } else {
    const { data: row } = await admin.from('viewer_profiles')
      .select('id,name,pin_hash').eq('user_id', caller.id).eq('id', profileId).maybeSingle();
    profile = row ?? null;
  }
  if (!profile) return json({ ok: false, reason: 'no_profile' });

  if (action === 'request') {
    // The Parent PIN with none yet: the code is the proof for making one.
    const setup = parent && !profile.pin_hash;
    if (!profile.pin_hash && !setup) return json({ ok: false, reason: 'no_pin' });
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin.from('profile_pin_resets')
      .select('id', { count: 'exact', head: true }).eq('user_id', caller.id).gte('created_at', hourAgo);
    if ((count ?? 0) >= MAX_SENDS_PER_HOUR) return json({ ok: false, reason: 'too_many' });

    // The ticket: one open one per customer, added to on a repeat request.
    // Not for setting up a first Parent PIN: there is nothing to clear.
    const email = caller.email ?? null;
    const which = parent ? 'the parent PIN' : 'the PIN';
    const note = (parent
      ? `Forgot their parent PIN (the account's lock on adding, changing and leaving profiles).\n`
      : `Forgot the PIN for their "${profile.name}" profile.\n`)
      + (email ? `A reset code was emailed to ${maskEmail(email)}. ` : 'There is no email on this account, so no code could be sent. ')
      + `This was asked for on the TV, where anyone holding the remote can press "Forgot PIN?". `
      + (email
        ? `If the code doesn't arrive, clear ${which} from this ticket in the Hub (Profiles panel) only once the account holder has confirmed from ${maskEmail(email)} (a reply to our email, or a message from that address). `
        : `Clear ${which} from this ticket in the Hub (Profiles panel) only once you are sure you are talking to the account holder. `)
      + `The account's email is told whenever ${which} is cleared.`;
    let ticketId: string | null = null;
    if (!setup) {
      try {
        const { data: open } = await admin.from('support_tickets')
          .select('id').eq('user_id', caller.id).eq('status', 'open').ilike('subject', `${TICKET_SUBJECT}%`)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (open?.id) {
          ticketId = open.id;
        } else {
          const { data: t } = await admin.from('support_tickets')
            .insert({ user_id: caller.id, subject: `${TICKET_SUBJECT} — ${profile.name}`, status: 'open', priority: 'normal' })
            .select('id').single();
          ticketId = t?.id ?? null;
        }
        if (ticketId) {
          await admin.from('support_messages').insert({ ticket_id: ticketId, user_id: caller.id, sender_type: 'user', message: note });
        }
      } catch (e) {
        console.error('[profile-pin-reset] ticket failed:', (e as Error).message);
      }
    }

    const id = crypto.randomUUID();
    const code = sixDigits();
    const { error: insErr } = await admin.from('profile_pin_resets').insert({
      id, user_id: caller.id, profile_id: profileId, code_hash: await sha256(`${id}:${code}`),
      ticket_id: ticketId, expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    });
    if (insErr) return json({ ok: false, reason: 'db_error', ticket: !!ticketId });

    let emailed = false;
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (email && apiKey) {
      try {
        const { error } = await new Resend(apiKey).emails.send({
          from: FROM, to: [email], replyTo: REPLY_TO,
          subject: setup ? 'Your Snow Media parent PIN setup code' : parent ? 'Your Snow Media parent PIN reset code' : `Your Snow Media PIN reset code`,
          html: setup ? parentSetupHtml(code) : parent ? parentEmailHtml(code) : emailHtml(profile.name, code),
        });
        if (error) console.error('[profile-pin-reset] send failed:', (error as { message?: string }).message ?? 'unknown');
        else emailed = true;
      } catch (e) {
        console.error('[profile-pin-reset] send threw:', (e as Error).message);
      }
    }
    return json({ ok: true, emailed, email: email ? maskEmail(email) : null, ticket: !!ticketId });
  }

  if (action === 'verify') {
    const code = String(body.code ?? '').replace(/\D/g, '');
    if (code.length !== 6) return json({ ok: false, reason: 'bad_code' });
    // The Parent PIN's new hash comes with its code: checked before the code
    // costs a try, and put in when the code is right.
    const newHash = parent ? String(body.new_pin_hash ?? '') : '';
    if (parent && !PIN_HASH.test(newHash)) return json({ ok: false, reason: 'bad_pin' });
    const { data: reset } = await admin.from('profile_pin_resets')
      .select('id,attempts,expires_at,ticket_id,code_hash')
      .eq('user_id', caller.id).eq('profile_id', profileId).is('used_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!reset || Date.parse(reset.expires_at) < Date.now()) return json({ ok: false, reason: 'expired' });
    if (reset.attempts >= MAX_TRIES) return json({ ok: false, reason: 'too_many' });
    await admin.from('profile_pin_resets').update({ attempts: reset.attempts + 1 }).eq('id', reset.id);
    if ((await sha256(`${reset.id}:${code}`)) !== reset.code_hash) {
      return json({ ok: false, reason: 'wrong_code', left: Math.max(0, MAX_TRIES - reset.attempts - 1) });
    }
    const now = new Date().toISOString();
    await admin.from('profile_pin_resets').update({ used_at: now }).eq('id', reset.id);
    // The Parent PIN: made or replaced (the table stamps updated_at), and its
    // new time sent back for the box's next compare-and-swap.
    const { data: written, error } = parent
      ? await admin.from('viewer_parent_pin').upsert({ user_id: caller.id, pin_hash: newHash }, { onConflict: 'user_id' }).select('updated_at').maybeSingle()
      : await admin.from('viewer_profiles').update({ pin_hash: null, updated_at: now })
        .eq('user_id', caller.id).eq('id', profileId);
    if (error) return json({ ok: false, reason: 'db_error' });
    if (reset.ticket_id) {
      await admin.from('support_messages').insert({
        ticket_id: reset.ticket_id, user_id: caller.id, sender_type: 'user',
        message: parent
          ? '(Automatic) Reset the parent PIN with the emailed code (a new one is set) — nothing to do.'
          : `(Automatic) Reset the "${profile.name}" PIN with the emailed code — nothing to do.`,
      });
      await admin.from('support_tickets').update({ status: 'closed' }).eq('id', reset.ticket_id);
    }
    return json(parent ? { ok: true, updated_at: (written as { updated_at?: string } | null)?.updated_at ?? null } : { ok: true });
  }

  return json({ ok: false, reason: 'bad_action' }, 400);
});
