// Down channels (see migration 20260926060000_channel_status.sql).
//
//   list   {hosts}                             anyone: the channels down now on
//                                              those Live TV hosts, as
//                                              "host|stream_id" keys. Kept for
//                                              20 s per instance.
//   signal {host, stream_id, name, kind, device_id}
//                                              anyone: kind down (a viewer's
//                                              report: shows for everyone) |
//                                              clear (a viewer says it works) |
//                                              fail | ok (see the migrations).
//                                              At most 40 an hour per box.
//   admin_list                                 admins: down now, and what was
//                                              signalled in the last 3 hours
//   admin_set {host, stream_id, name, status, hours}
//                                              admins: status down | ok for a
//                                              while, or null to clear
//
// Boxes are counted by a hash of their device id; nothing else about them is
// kept, and signals older than two days are deleted.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const HOST = /^[a-z0-9.-]{1,100}(?::\d{1,5})?$/;
const MAX_SIGNALS_PER_HOUR = 40;
const LIST_TTL_MS = 20_000;

const listCache = new Map<string, { at: number; down: string[] }>();

const sha256 = async (s: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ ok: false, reason: 'config' }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const op = String(body.op ?? '');

  try {
    if (op === 'list') {
      const hosts = (Array.isArray(body.hosts) ? body.hosts : [])
        .map((h) => String(h).trim().toLowerCase()).filter((h) => HOST.test(h)).slice(0, 10).sort();
      if (!hosts.length) return json({ ok: true, down: [] });
      const cacheKey = hosts.join(',');
      const hit = listCache.get(cacheKey);
      if (hit && Date.now() - hit.at < LIST_TTL_MS) return json({ ok: true, down: hit.down });
      const { data, error } = await admin.rpc('channel_down_list', { p_hosts: hosts });
      if (error) { console.error('[channel-status] list:', error.message); return json({ ok: false, reason: 'db_error' }); }
      const down = ((data ?? []) as Array<{ host: string; stream_id: number }>).map((r) => `${r.host}|${r.stream_id}`);
      listCache.set(cacheKey, { at: Date.now(), down });
      return json({ ok: true, down });
    }

    if (op === 'signal') {
      const host = String(body.host ?? '').trim().toLowerCase();
      const streamId = Number(body.stream_id);
      const kind = String(body.kind ?? '');
      const deviceId = String(body.device_id ?? '').slice(0, 200);
      if (!HOST.test(host) || !Number.isInteger(streamId) || streamId <= 0 || !['down', 'fail', 'ok', 'clear'].includes(kind) || deviceId.length < 8) {
        return json({ ok: false, reason: 'bad_request' }, 400);
      }
      const deviceHash = await sha256(`smc-channel:${deviceId}`);
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await admin.from('channel_signals')
        .select('id', { count: 'exact', head: true }).eq('device_hash', deviceHash).gte('created_at', hourAgo);
      if ((count ?? 0) >= MAX_SIGNALS_PER_HOUR) return json({ ok: false, reason: 'rate_limited' });
      const name = typeof body.name === 'string' ? body.name.slice(0, 200) : null;
      const { error } = await admin.from('channel_signals').insert({ host, stream_id: streamId, channel_name: name, kind, device_hash: deviceHash });
      if (error) { console.error('[channel-status] signal:', error.message); return json({ ok: false, reason: 'db_error' }); }
      // Drop the host's cached list so the change shows at the next ask.
      for (const k of listCache.keys()) if (k.split(',').includes(host)) listCache.delete(k);
      // Now and then, forget signals nobody needs any more.
      if (Math.random() < 0.02) {
        await admin.from('channel_signals').delete().lt('created_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
      }
      return json({ ok: true });
    }

    if (op === 'admin_list' || op === 'admin_set') {
      const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
      const { data: who } = bearer ? await admin.auth.getUser(bearer) : { data: { user: null } };
      const uid = who?.user?.id;
      if (!uid) return json({ ok: false, reason: 'signed_out' }, 401);
      const { data: isAdmin } = await admin.rpc('has_role', { _user_id: uid, _role: 'admin' });
      if (!isAdmin) return json({ ok: false, reason: 'forbidden' }, 403);

      if (op === 'admin_set') {
        const host = String(body.host ?? '').trim().toLowerCase();
        const streamId = Number(body.stream_id);
        if (!HOST.test(host) || !Number.isInteger(streamId)) return json({ ok: false, reason: 'bad_request' }, 400);
        const status = body.status === 'down' || body.status === 'ok' ? body.status : null;
        if (!status) {
          await admin.from('channel_overrides').delete().eq('host', host).eq('stream_id', streamId);
        } else {
          const hours = Math.min(72, Math.max(1, Number(body.hours) || 6));
          const { error } = await admin.from('channel_overrides').upsert({
            host, stream_id: streamId, channel_name: typeof body.name === 'string' ? body.name.slice(0, 200) : null,
            status, note: typeof body.note === 'string' ? body.note.slice(0, 300) : null,
            expires_at: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(), set_by: uid, updated_at: new Date().toISOString(),
          }, { onConflict: 'host,stream_id' });
          if (error) return json({ ok: false, reason: 'db_error' });
        }
        listCache.clear();
        return json({ ok: true });
      }

      // admin_list
      const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const { data: rows, error } = await admin.from('channel_signals')
        .select('host,stream_id,channel_name,kind,device_hash,created_at').gte('created_at', since)
        .order('created_at', { ascending: false }).limit(2000);
      if (error) return json({ ok: false, reason: 'db_error' });
      const byChannel = new Map<string, { host: string; stream_id: number; name: string | null; down: Set<string>; fail: Set<string>; ok: Set<string>; clear: Set<string>; last: string }>();
      for (const r of rows ?? []) {
        const k = `${r.host}|${r.stream_id}`;
        let c = byChannel.get(k);
        if (!c) { c = { host: r.host, stream_id: r.stream_id, name: r.channel_name, down: new Set(), fail: new Set(), ok: new Set(), clear: new Set(), last: r.created_at }; byChannel.set(k, c); }
        c.name ??= r.channel_name;
        (c[r.kind as 'down' | 'fail' | 'ok' | 'clear']).add(r.device_hash);
      }
      const hosts = [...new Set([...byChannel.values()].map((c) => c.host))];
      const { data: overrides } = await admin.from('channel_overrides').select('*');
      for (const o of overrides ?? []) if (!hosts.includes(o.host)) hosts.push(o.host);
      const { data: downNow } = hosts.length ? await admin.rpc('channel_down_list', { p_hosts: hosts }) : { data: [] };
      const downKeys = new Set(((downNow ?? []) as Array<{ host: string; stream_id: number }>).map((r) => `${r.host}|${r.stream_id}`));
      const channels = [...byChannel.entries()].map(([k, c]) => ({
        key: k, host: c.host, stream_id: c.stream_id, name: c.name, reports: c.down.size, failures: c.fail.size, working: c.ok.size, cleared: c.clear.size,
        last: c.last, down: downKeys.has(k),
      }));
      for (const o of overrides ?? []) {
        const k = `${o.host}|${o.stream_id}`;
        if (!byChannel.has(k)) channels.push({ key: k, host: o.host, stream_id: o.stream_id, name: o.channel_name, reports: 0, failures: 0, working: 0, cleared: 0, last: o.updated_at, down: downKeys.has(k) });
      }
      return json({
        ok: true,
        channels: channels.sort((a, b) => Number(b.down) - Number(a.down) || (b.reports * 2 + b.failures) - (a.reports * 2 + a.failures)),
        overrides: overrides ?? [],
      });
    }

    return json({ ok: false, reason: 'bad_op' }, 400);
  } catch (e) {
    console.error('[channel-status] error:', (e as Error).message);
    return json({ ok: false, reason: 'error' }, 500);
  }
});
