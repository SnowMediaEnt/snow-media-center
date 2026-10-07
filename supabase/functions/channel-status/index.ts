// Down channels (see migration 20260926060000_channel_status.sql).
//
//   list   {hosts}                             anyone: on those Live TV hosts,
//                                              the channels down now (`down`)
//                                              and reported buffering
//                                              (`buffering`), as
//                                              "host|stream_id" keys, and the
//                                              categories down now
//                                              (`categories`, "host|category_id").
//                                              Kept for 20 s per instance.
//   signal {host, stream_id, name, kind, device_id, line_user?, active_cons?, max_cons?}
//                                              anyone: kind down (a viewer's
//                                              report: shows for everyone) |
//                                              buffering (a viewer's report:
//                                              a warning for everyone) |
//                                              clear (a viewer says it works) |
//                                              fail | ok (see the migrations).
//                                              Limits below; counts only from
//                                              a box we know (knownBox).
//   signal_category {host, category_id, name, kind, device_id, line_user?, active_cons?, max_cons?}
//                                              anyone: kind down (a viewer
//                                              reported the whole category) |
//                                              clear (a viewer says it works) |
//                                              ok (one of its channels played
//                                              fine). Same trust rule, own limits.
//   admin_list                                 admins: down now, and what was
//                                              signalled in the last 3 hours;
//                                              buffering counts; categories
//   admin_set {host, stream_id | category_id, name, status, hours}
//                                              admins: status down | ok for a
//                                              while, or null to clear (a
//                                              channel, or with category_id a
//                                              whole category)
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
// A viewer's own word: a report (down, buffering) or an all-clear.
const MANUAL_KINDS = ['down', 'clear', 'buffering'];
// Categories: one report marks every channel in one, so fewer of them. An
// hour's category signals per device / per IP: of any kind, and 'down'.
const MAX_CATEGORY_PER_HOUR = 12;
const MAX_CATEGORY_DOWN_PER_HOUR = 3;
const MAX_CATEGORY_PER_IP_HOUR = 60;
const MAX_CATEGORY_DOWN_PER_IP_HOUR = 6;
// Provider category ids are short tokens ("12", "1043", sometimes letters).
const CATEGORY_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Who sent a viewer's report (down, buffering, a category down): the Live
 *  TV line's username and its connections in use / allowed, for the Hub.
 *  Never a password or address: only these three, checked and capped.
 *  Automatic signals and clears carry none. */
const reportLine = (body: Record<string, unknown>, report: boolean) => {
  if (!report) return {};
  const user = typeof body.line_user === 'string' ? body.line_user.trim().slice(0, 100) : '';
  if (!user) return {};
  const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1000 ? (v as number) : null);
  return { line_user: user, active_cons: count(body.active_cons), max_cons: count(body.max_cons) };
};
// A box whose analytics go back this far counts as known.
const KNOWN_BOX_AFTER_MS = 30 * 60 * 1000;
// Never more than this many down channels in one list (the SQL caps it too).
const MAX_DOWN_LIST = 500;
const MAX_BUFFERING_LIST = 500;
const MAX_CATEGORY_LIST = 100;
const LIST_TTL_MS = 20_000;

type Lists = { down: string[]; buffering: string[]; categories: string[] };
const listCache = new Map<string, { at: number } & Lists>();
const dropCachedHost = (host: string) => { for (const k of listCache.keys()) if (k.split(',').includes(host)) listCache.delete(k); };

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
  return { all: kinds.length, manual: kinds.filter((k) => MANUAL_KINDS.includes(k)).length };
}

/** This hour's category signals for one device or IP: all of them, and 'down'. */
async function categoryHourCounts(admin: Admin, column: 'device_hash' | 'ip_hash', value: string, cap: number) {
  const { data } = await admin.from('category_signals')
    .select('kind').eq(column, value).gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .limit(cap + 1);
  const kinds = ((data ?? []) as Array<{ kind: string }>).map((r) => r.kind);
  return { all: kinds.length, down: kinds.filter((k) => k === 'down').length };
}

/** A list the new SQL functions give (migration 20261007060000). Until that
 *  is applied they are missing: the boxes then get down channels only. */
async function optionalList<T>(admin: Admin, fn: string, args: Record<string, unknown>): Promise<T[]> {
  try {
    const { data, error } = await admin.rpc(fn, args);
    if (error) { console.error(`[channel-status] ${fn}:`, error.message); return []; }
    return (data ?? []) as T[];
  } catch {
    return [];
  }
}

/** Insert a signal with who sent it; if the line columns are not there yet
 *  (the function deployed before its migration), the signal still counts. */
async function insertSignal(admin: Admin, table: string, row: Record<string, unknown>, line: Record<string, unknown>) {
  const first = await admin.from(table).insert({ ...row, ...line });
  if (!first.error || !Object.keys(line).length) return first;
  return admin.from(table).insert(row);
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
      if (!hosts.length) return json({ ok: true, down: [], buffering: [], categories: [] });
      const cacheKey = hosts.join(',');
      const hit = listCache.get(cacheKey);
      if (hit && Date.now() - hit.at < LIST_TTL_MS) return json({ ok: true, down: hit.down, buffering: hit.buffering, categories: hit.categories });
      const [downRes, bufferingRows, categoryRows] = await Promise.all([
        admin.rpc('channel_down_list', { p_hosts: hosts }),
        optionalList<{ host: string; stream_id: number }>(admin, 'channel_buffering_list', { p_hosts: hosts }),
        optionalList<{ host: string; category_id: string }>(admin, 'category_down_list', { p_hosts: hosts }),
      ]);
      if (downRes.error) { console.error('[channel-status] list:', downRes.error.message); return json({ ok: false, reason: 'db_error' }); }
      const down = ((downRes.data ?? []) as Array<{ host: string; stream_id: number }>).slice(0, MAX_DOWN_LIST).map((r) => `${r.host}|${r.stream_id}`);
      const buffering = bufferingRows.slice(0, MAX_BUFFERING_LIST).map((r) => `${r.host}|${r.stream_id}`);
      const categories = categoryRows.slice(0, MAX_CATEGORY_LIST).map((r) => `${r.host}|${r.category_id}`);
      listCache.set(cacheKey, { at: Date.now(), down, buffering, categories });
      return json({ ok: true, down, buffering, categories });
    }

    if (op === 'signal') {
      const host = String(body.host ?? '').trim().toLowerCase();
      const streamId = Number(body.stream_id);
      const kind = String(body.kind ?? '');
      const deviceId = String(body.device_id ?? '').slice(0, 200);
      if (!HOST.test(host) || !Number.isInteger(streamId) || streamId <= 0 || !['down', 'fail', 'ok', 'clear', 'buffering'].includes(kind) || deviceId.length < 8) {
        return json({ ok: false, reason: 'bad_request' }, 400);
      }
      const manual = MANUAL_KINDS.includes(kind);
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
      const { error } = await insertSignal(admin, 'channel_signals', {
        host, stream_id: streamId, channel_name: name, kind, device_hash: deviceHash, ip_hash: ipHash, trusted,
      }, reportLine(body, kind === 'down' || kind === 'buffering'));
      if (error) { console.error('[channel-status] signal:', error.message); return json({ ok: false, reason: 'db_error' }); }
      // Drop the host's cached list so the change shows at the next ask.
      if (trusted) dropCachedHost(host);
      // Now and then, forget signals nobody needs any more.
      if (Math.random() < 0.02) {
        await admin.from('channel_signals').delete().lt('created_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
      }
      return json({ ok: true });
    }

    if (op === 'signal_category') {
      const host = String(body.host ?? '').trim().toLowerCase();
      const categoryId = String(body.category_id ?? '').trim();
      const kind = String(body.kind ?? '');
      const deviceId = String(body.device_id ?? '').slice(0, 200);
      if (!HOST.test(host) || !CATEGORY_ID.test(categoryId) || !['down', 'clear', 'ok'].includes(kind) || deviceId.length < 8) {
        return json({ ok: false, reason: 'bad_request' }, 400);
      }
      const deviceHash = await sha256(`smc-channel:${deviceId}`);
      const ipHash = await hashClientIpKey(req.headers, 'smc-channel-ip:');
      const [byDevice, byIp] = await Promise.all([
        categoryHourCounts(admin, 'device_hash', deviceHash, MAX_CATEGORY_PER_HOUR),
        ipHash ? categoryHourCounts(admin, 'ip_hash', ipHash, MAX_CATEGORY_PER_IP_HOUR) : Promise.resolve({ all: 0, down: 0 }),
      ]);
      if (
        byDevice.all >= MAX_CATEGORY_PER_HOUR || byIp.all >= MAX_CATEGORY_PER_IP_HOUR
        || (kind === 'down' && (byDevice.down >= MAX_CATEGORY_DOWN_PER_HOUR || byIp.down >= MAX_CATEGORY_DOWN_PER_IP_HOUR))
      ) {
        return json({ ok: false, reason: 'rate_limited' });
      }
      const trusted = await knownBox(admin, deviceId, host);
      const name = typeof body.name === 'string' ? body.name.slice(0, 200) : null;
      const { error } = await insertSignal(admin, 'category_signals', {
        host, category_id: categoryId, category_name: name, kind, device_hash: deviceHash, ip_hash: ipHash, trusted,
      }, reportLine(body, kind === 'down'));
      if (error) { console.error('[channel-status] signal_category:', error.message); return json({ ok: false, reason: 'db_error' }); }
      if (trusted) dropCachedHost(host);
      if (Math.random() < 0.02) {
        await admin.from('category_signals').delete().lt('created_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
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

      if (op === 'admin_set' && body.category_id != null && body.stream_id == null) {
        // A whole category: the same as a channel, in category_overrides.
        const host = String(body.host ?? '').trim().toLowerCase();
        const categoryId = String(body.category_id).trim();
        if (!HOST.test(host) || !CATEGORY_ID.test(categoryId)) return json({ ok: false, reason: 'bad_request' }, 400);
        const status = body.status === 'down' || body.status === 'ok' ? body.status : null;
        if (!status) {
          await admin.from('category_overrides').delete().eq('host', host).eq('category_id', categoryId);
        } else {
          const hours = Math.min(72, Math.max(1, Number(body.hours) || 6));
          const { error } = await admin.from('category_overrides').upsert({
            host, category_id: categoryId, category_name: typeof body.name === 'string' ? body.name.slice(0, 200) : null,
            status, note: typeof body.note === 'string' ? body.note.slice(0, 300) : null,
            expires_at: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(), set_by: uid, updated_at: new Date().toISOString(),
          }, { onConflict: 'host,category_id' });
          if (error) return json({ ok: false, reason: 'db_error' });
        }
        listCache.clear();
        return json({ ok: true });
      }

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
      // Buffering and categories (migration 20261007060000): empty until it is applied.
      type BufferingRow = { host: string; stream_id: number; channel_name: string | null; buffering: number; last_at: string };
      type CategoryRow = { host: string; category_id: string; category_name: string | null; reports: number; working: number; cleared: number; ignored: number; last_at: string };
      type LineRow = { scope: string; host: string; stream_id: number | null; category_id: string | null; kind: string; line_user: string; active_cons: number | null; max_cons: number | null; created_at: string };
      const [bufferingSummary, categorySummary, categoryOverridesRes, reportLines] = await Promise.all([
        optionalList<BufferingRow>(admin, 'channel_buffering_summary', { p_since: since }),
        optionalList<CategoryRow>(admin, 'category_signal_summary', { p_since: since }),
        admin.from('category_overrides').select('*'),
        optionalList<LineRow>(admin, 'report_lines', { p_since: since }),
      ]);
      // Who reported each channel / category (newest first, a few each).
      const linesBy = new Map<string, Array<{ kind: string; user: string; active_cons: number | null; max_cons: number | null; at: string }>>();
      for (const r of reportLines) {
        const k = r.scope === 'category' ? `cat:${r.host}|${r.category_id}` : `${r.host}|${r.stream_id}`;
        const list = linesBy.get(k) ?? [];
        if (list.length < 5) list.push({ kind: r.kind, user: r.line_user, active_cons: r.active_cons, max_cons: r.max_cons, at: r.created_at });
        linesBy.set(k, list);
      }
      const categoryOverrides = (categoryOverridesRes?.data ?? []) as Array<{ host: string; category_id: string; category_name: string | null; updated_at: string }>;
      for (const b of bufferingSummary) if (!hosts.includes(b.host)) hosts.push(b.host);
      for (const c of [...categorySummary, ...categoryOverrides]) if (!hosts.includes(c.host)) hosts.push(c.host);
      const [{ data: downNow }, bufferingNow, categoriesNow] = hosts.length
        ? await Promise.all([
            admin.rpc('channel_down_list', { p_hosts: hosts }),
            optionalList<{ host: string; stream_id: number }>(admin, 'channel_buffering_list', { p_hosts: hosts }),
            optionalList<{ host: string; category_id: string }>(admin, 'category_down_list', { p_hosts: hosts }),
          ])
        : [{ data: [] }, [], []];
      const downKeys = new Set(((downNow ?? []) as Array<{ host: string; stream_id: number }>).map((r) => `${r.host}|${r.stream_id}`));
      const bufferingKeys = new Set(bufferingNow.map((r) => `${r.host}|${r.stream_id}`));
      const bufferingCount = new Map(bufferingSummary.map((b) => [`${b.host}|${b.stream_id}`, Number(b.buffering) || 0]));
      const seen = new Set<string>();
      const channels = summary.map((c) => {
        const k = `${c.host}|${c.stream_id}`;
        seen.add(k);
        return {
          key: k, host: c.host, stream_id: c.stream_id, name: c.channel_name,
          reports: Number(c.reports) || 0, failures: Number(c.failures) || 0, working: Number(c.working) || 0,
          cleared: Number(c.cleared) || 0, ignored: Number(c.ignored) || 0, last: c.last_at, down: downKeys.has(k),
          buffering: bufferingCount.get(k) ?? 0, buffering_now: bufferingKeys.has(k) && !downKeys.has(k),
          reporters: linesBy.get(k) ?? [],
        };
      });
      for (const o of overrides ?? []) {
        const k = `${o.host}|${o.stream_id}`;
        if (!seen.has(k)) {
          seen.add(k);
          channels.push({ key: k, host: o.host, stream_id: o.stream_id, name: o.channel_name, reports: 0, failures: 0, working: 0, cleared: 0, ignored: 0, last: o.updated_at, down: downKeys.has(k), buffering: bufferingCount.get(k) ?? 0, buffering_now: false, reporters: linesBy.get(k) ?? [] });
        }
      }
      for (const b of bufferingSummary) {
        const k = `${b.host}|${b.stream_id}`;
        if (!seen.has(k)) channels.push({ key: k, host: b.host, stream_id: b.stream_id, name: b.channel_name, reports: 0, failures: 0, working: 0, cleared: 0, ignored: 0, last: b.last_at, down: downKeys.has(k), buffering: Number(b.buffering) || 0, buffering_now: bufferingKeys.has(k) && !downKeys.has(k), reporters: linesBy.get(k) ?? [] });
      }
      // Categories: reported, cleared, played fine, ignored; down now.
      const categoryDownKeys = new Set(categoriesNow.map((r) => `${r.host}|${r.category_id}`));
      const seenCats = new Set<string>();
      const categories = categorySummary.map((c) => {
        const k = `${c.host}|${c.category_id}`;
        seenCats.add(k);
        return {
          key: k, host: c.host, category_id: c.category_id, name: c.category_name,
          reports: Number(c.reports) || 0, working: Number(c.working) || 0, cleared: Number(c.cleared) || 0,
          ignored: Number(c.ignored) || 0, last: c.last_at, down: categoryDownKeys.has(k),
          reporters: linesBy.get(`cat:${k}`) ?? [],
        };
      });
      for (const o of categoryOverrides) {
        const k = `${o.host}|${o.category_id}`;
        if (!seenCats.has(k)) categories.push({ key: k, host: o.host, category_id: o.category_id, name: o.category_name, reports: 0, working: 0, cleared: 0, ignored: 0, last: o.updated_at, down: categoryDownKeys.has(k), reporters: linesBy.get(`cat:${k}`) ?? [] });
      }
      return json({
        ok: true,
        channels: channels.sort((a, b) => Number(b.down) - Number(a.down) || Number(b.buffering_now) - Number(a.buffering_now)
          || (b.reports * 2 + b.failures + b.buffering) - (a.reports * 2 + a.failures + a.buffering)),
        overrides: overrides ?? [],
        categories: categories.sort((a, b) => Number(b.down) - Number(a.down) || b.reports - a.reports),
        category_overrides: categoryOverrides,
      });
    }

    return json({ ok: false, reason: 'bad_op' }, 400);
  } catch (e) {
    console.error('[channel-status] error:', (e as Error).message);
    return json({ ok: false, reason: 'error' }, 500);
  }
});
