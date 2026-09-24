// Phone remote pairing (see migrations 20260928060000_phone_remote.sql and
// 20260930080000_phone_remote_approval.sql).
//
// The box:
//   pair    {device_id, secret?, label?}  an 8-letter code (ten minutes, one
//                                         use) for its pairing — the one it
//                                         has, or a new one (limited per
//                                         address). → {secret, code,
//                                         expires_at, expires_in}
//   release {device_id, secret}           the QR is gone: its code stops working
//   answer  {device_id, secret, rid, allow}  the TV's Allow / Don't allow for
//                                         a phone's join request
//   reset   {device_id, secret}           "Unpair all phones" — the old
//                                         secret stops working; pair again after
// The phone:
//   join    {code}                        a right code opens a join request and
//                                         uses the code up; the TV is told
//                                         (Realtime, event 'server') and asks.
//                                         15 tries per 10 minutes from one
//                                         address, 60 a minute from everyone.
//                                         → {pending, token, label}
//   claim   {token}                       the request's answer: {pending} until
//                                         the TV answers, then {secret, label}
//                                         once (or reason 'denied' / 'expired')
//   check   {secret}                      does this pairing still exist?
//                                         → {exists}
//
// Box and phone then talk directly over the Realtime broadcast channel
// "smc-remote:<secret>"; nothing they say passes through here.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { clientIpKey, newCode, normalizeCode, phoneKind } from './pairing.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const CODE_TTL_MS = 10 * 60_000;
const REQUEST_TTL_MS = 2 * 60_000;
/** A waiting phone's claim re-sends the TV its request this often. */
const RENOTIFY_MS = 6_000;
// join: per address, and from everyone together (a script with many
// addresses meets the second; it can hold up pairing, not guess a code).
const JOIN_IP_MAX = 15;
const JOIN_IP_WINDOW_S = 10 * 60;
const JOIN_ALL_MAX = 60;
const JOIN_ALL_WINDOW_S = 60;
// New pairings per address (a box makes one; a script filling the tables
// makes thousands).
const PAIR_IP_MAX = 20;
const PAIR_IP_WINDOW_S = 60 * 60;

const hex = (bytes: Uint8Array) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
const randomHex = (n: number) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a); };
const isSecret = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ ok: false, reason: 'config' }, 500);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const op = String(body.op ?? '');

  /** Counts one try; 'ok', 'too_many' or 'busy'. */
  const gate = async (kind: 'join' | 'pair', ipMax: number, ipWindowS: number, allMax: number, allWindowS: number) => {
    const ipHash = await sha256(`smc-remote-ip:${clientIpKey(req.headers)}`);
    const { data, error } = await db.rpc('remote_gate', {
      p_kind: kind, p_ip_hash: ipHash, p_ip_max: ipMax, p_ip_window_s: ipWindowS, p_all_max: allMax, p_all_window_s: allWindowS,
    });
    if (error) throw new Error(`gate: ${error.message}`);
    return String(data);
  };

  /**
   * Tell the box over its channel (the same public Realtime broadcast the
   * phone uses, sent over HTTP). Only the secret's holders listen there.
   */
  const tellBox = async (secret: string, payload: Record<string, unknown>) => {
    const pub = Deno.env.get('SUPABASE_ANON_KEY') || key;
    try {
      const r = await fetch(`${url}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: { apikey: pub, Authorization: `Bearer ${pub}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ topic: `smc-remote:${secret}`, event: 'server', payload, private: false }] }),
      });
      await r.body?.cancel();
      if (!r.ok) console.warn('[phone-remote] broadcast failed:', r.status);
    } catch (e) {
      console.warn('[phone-remote] broadcast failed:', (e as Error).message);
    }
  };

  // Housekeeping now and then, whatever the outcome of the call.
  const tidy = async () => {
    if (Math.random() >= 0.05) return;
    const now = new Date().toISOString();
    await db.from('remote_join_attempts').delete().lt('created_at', new Date(Date.now() - 2 * 3600_000).toISOString());
    await db.from('remote_codes').delete().lt('expires_at', now);
    await db.from('remote_join_requests').delete().lt('expires_at', now);
    // Pairings no phone was ever allowed into, quiet for two days (the box
    // makes a new one next time it shows a QR).
    await db.from('remote_pairings').delete().is('approved_at', null).lt('last_seen', new Date(Date.now() - 2 * 86_400_000).toISOString());
  };

  try {
    if (op === 'pair' || op === 'reset' || op === 'release' || op === 'answer') {
      const deviceId = String(body.device_id ?? '');
      if (deviceId.length < 8) return json({ ok: false, reason: 'bad_request' }, 400);
      const deviceHash = await sha256(`smc-remote:${deviceId}`);
      const asked = isSecret(body.secret) ? body.secret : null;

      if (op === 'reset') {
        if (asked) await db.from('remote_pairings').delete().eq('secret', asked).eq('device_hash', deviceHash);
        return json({ ok: true });
      }

      // The box's own pairing if it still has one.
      let secret: string | null = null;
      if (asked) {
        const { data } = await db.from('remote_pairings').select('secret').eq('secret', asked).eq('device_hash', deviceHash).maybeSingle();
        secret = data?.secret ?? null;
      }

      if (op === 'release') {
        if (secret) await db.from('remote_codes').delete().eq('secret', secret);
        return json({ ok: true });
      }

      if (op === 'answer') {
        const rid = typeof body.rid === 'string' && /^[0-9a-f]{16}$/.test(body.rid) ? body.rid : null;
        if (!secret || !rid) return json({ ok: false, reason: 'not_found' });
        const allow = body.allow === true;
        const { data } = await db.from('remote_join_requests')
          .update({ allowed: allow })
          .eq('rid', rid).eq('secret', secret).is('allowed', null).gt('expires_at', new Date().toISOString())
          .select('rid');
        if (!data?.length) return json({ ok: false, reason: 'not_found' });
        if (allow) await db.from('remote_pairings').update({ approved_at: new Date().toISOString(), last_seen: new Date().toISOString() }).eq('secret', secret);
        return json({ ok: true });
      }

      // pair
      const label = typeof body.label === 'string' ? body.label.slice(0, 60) : null;
      if (!secret) {
        const g = await gate('pair', PAIR_IP_MAX, PAIR_IP_WINDOW_S, 0, 0);
        if (g !== 'ok') return json({ ok: false, reason: 'too_many' });
        secret = randomHex(32);
        const { error } = await db.from('remote_pairings').insert({ secret, device_hash: deviceHash, label });
        if (error) return json({ ok: false, reason: 'db_error' });
      } else {
        await db.from('remote_pairings').update({ last_seen: new Date().toISOString(), ...(label ? { label } : {}) }).eq('secret', secret);
      }
      // One live code per box; old ones go.
      await db.from('remote_codes').delete().eq('secret', secret);
      const expires = new Date(Date.now() + CODE_TTL_MS).toISOString();
      for (let i = 0; i < 6; i++) {
        const code = newCode();
        const { error } = await db.from('remote_codes').insert({ code, secret, expires_at: expires });
        if (!error) {
          await tidy();
          return json({ ok: true, secret, code, expires_at: expires, expires_in: CODE_TTL_MS / 1000 });
        }
      }
      return json({ ok: false, reason: 'busy' });
    }

    if (op === 'join') {
      await tidy();
      const code = normalizeCode(body.code);
      if (!code) return json({ ok: false, reason: 'bad_code' });
      // The try is counted before the code is looked up, so a burst can't
      // slip past the count.
      const g = await gate('join', JOIN_IP_MAX, JOIN_IP_WINDOW_S, JOIN_ALL_MAX, JOIN_ALL_WINDOW_S);
      if (g !== 'ok') return json({ ok: false, reason: g === 'busy' ? 'busy' : 'too_many' });
      // One use: whoever deletes it first has it.
      const { data: used } = await db.from('remote_codes').delete().eq('code', code).gt('expires_at', new Date().toISOString()).select('secret');
      const secret = used?.[0]?.secret as string | undefined;
      if (!secret) return json({ ok: false, reason: 'wrong_code' });
      const token = randomHex(16);
      const rid = randomHex(8);
      const device = phoneKind(req.headers.get('user-agent'));
      const { error } = await db.from('remote_join_requests').insert({
        token_hash: await sha256(`smc-remote-token:${token}`), rid, secret, device,
        expires_at: new Date(Date.now() + REQUEST_TTL_MS).toISOString(),
      });
      if (error) return json({ ok: false, reason: 'db_error' });
      await tellBox(secret, { t: 'request', rid, device });
      const { data: p } = await db.from('remote_pairings').select('label').eq('secret', secret).maybeSingle();
      return json({ ok: true, pending: true, token, label: p?.label ?? 'Snow Media Center', expires_in: REQUEST_TTL_MS / 1000 });
    }

    if (op === 'claim') {
      const token = typeof body.token === 'string' && /^[0-9a-f]{32}$/.test(body.token) ? body.token : null;
      if (!token) return json({ ok: false, reason: 'expired' });
      const tokenHash = await sha256(`smc-remote-token:${token}`);
      const { data: r } = await db.from('remote_join_requests').select('rid, secret, device, allowed, notified_at, expires_at').eq('token_hash', tokenHash).maybeSingle();
      if (!r) return json({ ok: false, reason: 'expired' });
      if (r.allowed === null) {
        if (Date.parse(r.expires_at) < Date.now()) {
          await db.from('remote_join_requests').delete().eq('token_hash', tokenHash);
          return json({ ok: false, reason: 'expired' });
        }
        // Still waiting: remind the TV now and then, in case it missed it.
        if (Date.now() - Date.parse(r.notified_at) > RENOTIFY_MS) {
          await db.from('remote_join_requests').update({ notified_at: new Date().toISOString() }).eq('token_hash', tokenHash);
          await tellBox(r.secret, { t: 'request', rid: r.rid, device: r.device });
        }
        return json({ ok: true, pending: true });
      }
      // Answered: the phone hears it once.
      await db.from('remote_join_requests').delete().eq('token_hash', tokenHash);
      if (!r.allowed) return json({ ok: false, reason: 'denied' });
      const { data: p } = await db.from('remote_pairings').select('label').eq('secret', r.secret).maybeSingle();
      if (!p) return json({ ok: false, reason: 'expired' });
      return json({ ok: true, secret: r.secret, label: p.label ?? 'Snow Media Center' });
    }

    if (op === 'check') {
      if (!isSecret(body.secret)) return json({ ok: true, exists: false });
      const { data } = await db.from('remote_pairings').select('secret').eq('secret', body.secret).maybeSingle();
      return json({ ok: true, exists: !!data });
    }

    return json({ ok: false, reason: 'bad_op' }, 400);
  } catch (e) {
    console.error('[phone-remote] error:', (e as Error).message);
    return json({ ok: false, reason: 'error' }, 500);
  }
});
