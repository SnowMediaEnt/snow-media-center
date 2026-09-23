// Phone remote pairing (see migration 20260928060000_phone_remote.sql).
//
//   pair  {device_id, secret?, label?}   the box: a fresh 6-digit code (ten
//                                        minutes) for its pairing — the one
//                                        it has, or a new one. → {secret, code,
//                                        expires_at}
//   reset {device_id, secret}            the box: "Unpair all phones" — the old
//                                        secret stops working; pair again after
//   join  {code}                         the phone: the box's secret, for the
//                                        code shown on the TV. At most 15 tries
//                                        per 10 minutes from one address.
//                                        → {secret, label}
//
// Box and phone then talk directly over the Realtime broadcast channel
// "smc-remote:<secret>"; nothing they say passes through here.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const CODE_TTL_MS = 10 * 60_000;
const MAX_JOINS = 15;
const JOIN_WINDOW_MS = 10 * 60_000;

const hex = (bytes: Uint8Array) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
const randomSecret = () => { const a = new Uint8Array(32); crypto.getRandomValues(a); return hex(a); };
const sixDigits = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(a[0] % 1_000_000).padStart(6, '0'); };

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

  try {
    if (op === 'pair' || op === 'reset') {
      const deviceId = String(body.device_id ?? '');
      if (deviceId.length < 8) return json({ ok: false, reason: 'bad_request' }, 400);
      const deviceHash = await sha256(`smc-remote:${deviceId}`);
      const asked = typeof body.secret === 'string' && /^[0-9a-f]{64}$/.test(body.secret) ? body.secret : null;

      if (op === 'reset') {
        if (asked) await db.from('remote_pairings').delete().eq('secret', asked).eq('device_hash', deviceHash);
        return json({ ok: true });
      }

      // The box's own pairing if it still has one; otherwise a new one.
      let secret: string | null = null;
      if (asked) {
        const { data } = await db.from('remote_pairings').select('secret').eq('secret', asked).eq('device_hash', deviceHash).maybeSingle();
        secret = data?.secret ?? null;
      }
      const label = typeof body.label === 'string' ? body.label.slice(0, 60) : null;
      if (!secret) {
        secret = randomSecret();
        const { error } = await db.from('remote_pairings').insert({ secret, device_hash: deviceHash, label });
        if (error) return json({ ok: false, reason: 'db_error' });
      } else {
        await db.from('remote_pairings').update({ last_seen: new Date().toISOString(), ...(label ? { label } : {}) }).eq('secret', secret);
      }
      // One live code per box; old and expired codes go.
      await db.from('remote_codes').delete().eq('secret', secret);
      await db.from('remote_codes').delete().lt('expires_at', new Date().toISOString());
      const expires = new Date(Date.now() + CODE_TTL_MS).toISOString();
      for (let i = 0; i < 6; i++) {
        const code = sixDigits();
        const { error } = await db.from('remote_codes').insert({ code, secret, expires_at: expires });
        if (!error) return json({ ok: true, secret, code, expires_at: expires });
      }
      return json({ ok: false, reason: 'busy' });
    }

    if (op === 'join') {
      const code = String(body.code ?? '').replace(/\D/g, '');
      if (code.length !== 6) return json({ ok: false, reason: 'bad_code' });
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const ipHash = await sha256(`smc-remote-ip:${ip}`);
      const since = new Date(Date.now() - JOIN_WINDOW_MS).toISOString();
      const { count } = await db.from('remote_join_attempts').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since);
      if ((count ?? 0) >= MAX_JOINS) return json({ ok: false, reason: 'too_many' });
      await db.from('remote_join_attempts').insert({ ip_hash: ipHash });
      const { data } = await db.from('remote_codes').select('secret, expires_at').eq('code', code).maybeSingle();
      if (!data || Date.parse(data.expires_at) < Date.now()) return json({ ok: false, reason: 'wrong_code' });
      const { data: p } = await db.from('remote_pairings').select('label').eq('secret', data.secret).maybeSingle();
      if (Math.random() < 0.05) await db.from('remote_join_attempts').delete().lt('created_at', since);
      return json({ ok: true, secret: data.secret, label: p?.label ?? 'Snow Media Center' });
    }

    return json({ ok: false, reason: 'bad_op' }, 400);
  } catch (e) {
    console.error('[phone-remote] error:', (e as Error).message);
    return json({ ok: false, reason: 'error' }, 500);
  }
});
