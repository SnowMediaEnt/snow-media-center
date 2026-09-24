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
//                                              Limits below; counts only from
//                                              a box we know (knownBox).
//   admin_list                                 admins: down now, and what was
//                                              signalled in the last 3 hours
//   admin_set {host, stream_id, name, status, hours}
//                                              admins: status down | ok for a
//                                              while, or null to clear
//
// Boxes are counted by a hash of their device id, callers by a hash of their
// IP address (an IPv6 /64 counts once); nothing else about them is kept, and
// signals older than two days are deleted.
//
// One report from a real box is still enough to put ⚠️ on a channel for
// everyone (migration 20260927060000). What stops a script doing that to a
// whole line-up (migration 20260930061000):
//   * limits per device id AND per IP, so a new made-up device id with every
//     request no longer gets around them;
//   * only signals from a box we know count: one that signed a line in on
//     that host (player_signins, written only once the panel accepted the
//     line) or that has been sending analytics for half an hour. Other
//     signals are stored as untrusted: the Hub shows them, boxes never see
//     them;
//   * the list a box downloads holds at most 500 channels.
// The trade-off: a box that is brand new AND never signed a line in on that
// host (a second box on a line someone else signed in) is not counted for
// its first half hour. And the analytics check only raises the bar, since
// analytics rows can be written by anyone with the public key; the per-IP
// limit is what caps a determined script.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { hashClientIpKey } from '../_shared/clientIp.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const HOST = /^[a-z0-9.-]{1,100}(?::\d{1,5})?$/;
// An hour's signals: of any kind / 'down' and 'clear' (a viewer's own
// report or all-clear). A box sends each automatic kind at most once per
// channel every ten minutes. Per IP they are generous, for homes with
// several boxes and phones behind one address.
const MAX_SIGNALS_PER_HOUR = 40;
const MAX_MANUAL_PER_HOUR = 10;
const MAX_SIGNALS_PER_IP_HOUR = 200;
const MAX_MANUAL_PER_IP_HOUR = 20;
// A box whose analytics go back this far counts as known.
const KNOWN_BOX_AFTER_MS = 30 * 60 * 1000;
// Never more than this many down channels in one list (the SQL caps it too).
const MAX_DOWN_LIST = 500;
const LIST_TTL_MS = 20_000;

const listCache = new Map<string, { at: number; down: string[] }>();

const sha256 = async (s: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

type Admin = ReturnType<typeof createClient>;

/** This hour's signals for one device or IP: all of them, and down/clear. */
async function hourCounts(admin: Admin, column: 'device_hash' | 'ip_hash', value: string, cap: number) {
  const { data } = await admin.from('channel_signals')
    .select('kind').eq(column, value).gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .limit(cap + 1);
  const kinds = ((data ?? []) as Array<{ kind: string }>).map((r) => r.kind);
  return { all: kinds.length, manual: kinds.filter((k) => k === 'down' || k === 'clear').length };
}

/** A box we have seen before: signed a line in on this host, or has been
 *  sending analytics for a while (see the top of this file). */
async function knownBox(admin: Admin, deviceId: string, host: string): Promise<boolean> {
  try {
    const [line, seen] = await Promise.all([
      admin.from('player_signins').select('id').eq('device_id', deviceId).eq('panel_host', host).limit(1),
      admin.from('analytics_sessions').select('id').eq('device_id', deviceId)
        .lt('created_at', new Date(Date.now() - KNOWN_BOX_AFTER_MS).toISOString()).limit(1),
    ]);
    return !!((line.data ?? []).length || (seen.data ?? []).length);
  } catch {
    return false;
  }
}

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
      const down = ((data ?? []) as Array<{ host: string; stream_id: number }>).slice(0, MAX_DOWN_LIST).map((r) => `${r.host}|${r.stream_id}`);
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
      const manual = kind === 'down' || kind === 'clear';
      const deviceHash = await sha256(`smc-channel:${deviceId}`);
      const ipHash = await hashClientIpKey(req.headers, 'smc-channel-ip:');
      const [byDevice, byIp] = await Promise.all([
        hourCounts(admin, 'device_hash', deviceHash, MAX_SIGNALS_PER_HOUR),
        ipHash ? hourCounts(admin, 'ip_hash', ipHash, MAX_SIGNALS_PER_IP_HOUR) : Promise.resolve({ all: 0, manual: 0 }),
      ]);
      if (
        byDevice.all >= MAX_SIGNALS_PER_HOUR || byIp.all >= MAX_SIGNALS_PER_IP_HOUR
        || (manual && (byDevice.manual >= MAX_MANUAL_PER_HOUR || byIp.manual >= MAX_MANUAL_PER_IP_HOUR))
      ) {
        return json({ ok: false, reason: 'rate_limited' });
      }
      const trusted = await knownBox(admin, deviceId, host);
      const name = typeof body.name === 'string' ? body.name.slice(0, 200) : null;
      const { error } = await admin.from('channel_signals').insert({
        host, stream_id: streamId, channel_name: name, kind, device_hash: deviceHash, ip_hash: ipHash, trusted,
      });
      if (error) { console.error('[channel-status] signal:', error.message); return json({ ok: false, reason: 'db_error' }); }
      // Drop the host's cached list so the change shows at the next ask.
      if (trusted) for (const k of listCache.keys()) if (k.split(',').includes(host)) listCache.delete(k);
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

      // admin_list: counted per channel in SQL, so a flood of junk rows
      // cannot push real reports off the page. `ignored` is signals from
      // boxes we don't know, which boxes never see.
      const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const { data: rows, error } = await admin.rpc('channel_signal_summary', { p_since: since });
      if (error) { console.error('[channel-status] admin_list:', error.message); return json({ ok: false, reason: 'db_error' }); }
      type Summary = { host: string; stream_id: number; channel_name: string | null; reports: number; failures: number; working: number; cleared: number; ignored: number; last_at: string };
      const summary = (rows ?? []) as Summary[];
      const hosts = [...new Set(summary.map((c) => c.host))];
      const { data: overrides } = await admin.from('channel_overrides').select('*');
      for (const o of overrides ?? []) if (!hosts.includes(o.host)) hosts.push(o.host);
      const { data: downNow } = hosts.length ? await admin.rpc('channel_down_list', { p_hosts: hosts }) : { data: [] };
      const downKeys = new Set(((downNow ?? []) as Array<{ host: string; stream_id: number }>).map((r) => `${r.host}|${r.stream_id}`));
      const seen = new Set<string>();
      const channels = summary.map((c) => {
        const k = `${c.host}|${c.stream_id}`;
        seen.add(k);
        return {
          key: k, host: c.host, stream_id: c.stream_id, name: c.channel_name,
          reports: Number(c.reports) || 0, failures: Number(c.failures) || 0, working: Number(c.working) || 0,
          cleared: Number(c.cleared) || 0, ignored: Number(c.ignored) || 0, last: c.last_at, down: downKeys.has(k),
        };
      });
      for (const o of overrides ?? []) {
        const k = `${o.host}|${o.stream_id}`;
        if (!seen.has(k)) channels.push({ key: k, host: o.host, stream_id: o.stream_id, name: o.channel_name, reports: 0, failures: 0, working: 0, cleared: 0, ignored: 0, last: o.updated_at, down: downKeys.has(k) });
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
