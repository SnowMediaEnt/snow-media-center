// How-to capture: every network call the app makes is answered here, from
// scripts/howto/fixtures. Nothing reaches a real server: an address that no
// rule knows gets a 404 and is logged. Plan: .claude/plan-howto.md §4.3.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { drawArt } from './art.mjs';
import { FIXTURES_DIR } from './check.mjs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'access-control-expose-headers': 'Content-Range, Content-Type',
};

const readFixture = (rel) => {
  for (const ext of ['.json', '.xml', '.txt']) {
    const p = join(FIXTURES_DIR, rel + ext);
    if (existsSync(p)) {
      const text = readFileSync(p, 'utf8');
      return { text, type: ext === '.json' ? 'application/json' : ext === '.xml' ? 'application/xml' : 'text/plain', json: ext === '.json' ? JSON.parse(text) : undefined };
    }
  }
  return null;
};

const json = (route, body, status = 200, headers = {}) => route.fulfill({
  status, headers: { ...CORS, ...headers }, contentType: 'application/json', body: JSON.stringify(body),
});

// External addresses the app reads, and the fixture that answers each. The
// app reaches some of them through public CORS proxies (corsproxy.io,
// allorigins), so the target is matched inside the whole address.
const EXTERNAL = [
  { test: /snowmediaapps\.com(%2F|\/)smc(%2F|\/)update\.json/i, file: 'external/update' },
  { test: /snowmediaapps\.com(%2F|\/)smc(%2F|\/)newsfeed\.xml/i, file: 'external/newsfeed' },
  { test: /api\.vimeo\.com|vimeo\.com\/api/i, file: 'external/vimeo' },
  { test: /api\.themoviedb\.org/i, file: 'external/tmdb' },
];

// The speed test: answered at a steady ~48 Mb/s down and ~20 Mb/s up, so it
// finishes with believable numbers.
const SPEED_DOWN_BPS = 48e6;
const SPEED_UP_BPS = 20e6;
let speedBody = null;
async function speed(route, req, url) {
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (url.pathname === '/__up') {
    const n = req.postDataBuffer()?.length ?? 0;
    await new Promise((r) => setTimeout(r, 15 + (n * 8 * 1000) / SPEED_UP_BPS));
    return route.fulfill({ status: 200, headers: CORS, body: '' });
  }
  const want = Math.min(Number(url.searchParams.get('bytes')) || 0, 12_000_000);
  if (!want) { await new Promise((r) => setTimeout(r, 18)); return route.fulfill({ status: 200, headers: CORS, body: '' }); }
  speedBody ??= Buffer.alloc(12_000_000, 7);
  await new Promise((r) => setTimeout(r, 18 + (want * 8 * 1000) / SPEED_DOWN_BPS));
  return route.fulfill({ status: 200, headers: CORS, contentType: 'application/octet-stream', body: speedBody.subarray(0, want) });
}

// ── Supabase (REST, functions, auth) ─────────────────────────────────────────

/** A tiny PostgREST: eq / neq / in / is filters, order and limit. A filter on
 *  a column a fixture row doesn't have is ignored, so one fixture answers the
 *  app's different queries. */
function postgrest(rows, params) {
  let out = rows.slice();
  for (const [col, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(col)) continue;
    const m = /^(not\.)?(eq|neq|in|is|gt|gte|lt|lte|like|ilike)\.(.*)$/s.exec(raw);
    if (!m) continue;
    const [, not, op, val] = m;
    out = out.filter((r) => {
      if (!(col in r)) return true;
      const v = r[col];
      let hit;
      switch (op) {
        case 'eq': hit = String(v) === val; break;
        case 'neq': hit = String(v) !== val; break;
        case 'in': hit = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(v)); break;
        case 'is': hit = val === 'null' ? v == null : String(v) === val; break;
        case 'gt': hit = v > val; break;
        case 'gte': hit = v >= val; break;
        case 'lt': hit = v < val; break;
        case 'lte': hit = v <= val; break;
        default: hit = true;
      }
      return not ? !hit : hit;
    });
  }
  const order = params.get('order');
  if (order) {
    for (const part of order.split(',').reverse()) {
      const [col, dir] = part.split('.');
      out.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
    }
  }
  const offset = Number(params.get('offset') || 0);
  const limit = params.get('limit');
  return out.slice(offset, limit ? offset + Number(limit) : undefined);
}

async function supabase(route, req, url, ctx) {
  const path = url.pathname;
  const method = req.method();
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

  let m = /^\/functions\/v1\/([^/?]+)/.exec(path);
  if (m) {
    const fx = readFixture(`functions/${m[1]}`);
    if (!fx) ctx.note(`function ${m[1]} has no fixture: answered {}`);
    return route.fulfill({ status: 200, headers: CORS, contentType: fx?.type ?? 'application/json', body: fx?.text ?? '{}' });
  }

  m = /^\/rest\/v1\/rpc\/([^/?]+)/.exec(path);
  if (m) {
    const fx = readFixture(`rest/rpc/${m[1]}`);
    return json(route, fx?.json ?? null);
  }

  m = /^\/rest\/v1\/([^/?]+)/.exec(path);
  if (m) {
    const table = m[1];
    if (method !== 'GET' && method !== 'HEAD') {
      // Writes succeed and change nothing.
      let body = [];
      try { const b = req.postDataJSON(); body = Array.isArray(b) ? b : b ? [b] : []; } catch { /* no body */ }
      const single = /vnd\.pgrst\.object/.test(req.headers().accept ?? '');
      return json(route, single ? body[0] ?? null : body, 201);
    }
    const fx = readFixture(`rest/${table}`);
    const rows = postgrest(Array.isArray(fx?.json) ? fx.json : [], url.searchParams);
    const range = { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' };
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...CORS, ...range } });
    if (/vnd\.pgrst\.object/.test(req.headers().accept ?? '')) {
      if (!rows.length) return json(route, { code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' }, 406);
      return json(route, rows[0], 200, range);
    }
    return json(route, rows, 200, range);
  }

  if (path.startsWith('/auth/v1/')) {
    if (/\/(user)$/.test(path)) return json(route, ctx.session.user);
    if (/\/token$/.test(path)) return json(route, ctx.session);
    if (/\/logout$/.test(path)) return route.fulfill({ status: 204, headers: CORS });
    return json(route, {});
  }

  if (path.startsWith('/storage/v1/')) {
    const slug = (path.split('/').pop() || 'image').replace(/\.[a-z0-9]+$/i, '');
    return route.fulfill({ status: 200, headers: CORS, contentType: 'image/svg+xml', body: drawArt('tile', slug) });
  }

  ctx.note(`supabase ${method} ${path}: no rule, 404`);
  return route.fulfill({ status: 404, headers: CORS, body: '' });
}

// ── Google Fonts (passed through, kept on disk) ──────────────────────────────

async function font(route, req, cacheDir) {
  const key = createHash('sha1').update(req.url()).digest('hex');
  const file = join(cacheDir, key);
  if (existsSync(file) && existsSync(file + '.type')) {
    return route.fulfill({ status: 200, headers: CORS, contentType: readFileSync(file + '.type', 'utf8'), body: readFileSync(file) });
  }
  try {
    const res = await route.fetch();
    const body = await res.body();
    const type = res.headers()['content-type'] ?? 'application/octet-stream';
    if (res.ok()) {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(file, body);
      writeFileSync(file + '.type', type);
    }
    return route.fulfill({ status: res.status(), headers: CORS, contentType: type, body });
  } catch {
    return route.fulfill({ status: 404, headers: CORS, body: '' });
  }
}

/**
 * Install the fixture network on a browser context.
 * ctx: { appOrigin, session, bgDir, cacheDir, note(msg) }
 */
export async function installNetwork(context, ctx) {
  // Realtime and any other socket: accepted and never answered.
  await context.routeWebSocket(/.*/, () => { /* no server */ });

  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === ctx.appOrigin) {
      const bg = /^\/__howto_bg\/([a-z]{2})\/([a-z0-9-]+)\.png$/.exec(url.pathname);
      if (bg) {
        const p = join(ctx.bgDir, bg[1], `${bg[2]}.png`);
        if (existsSync(p)) return route.fulfill({ status: 200, contentType: 'image/png', body: readFileSync(p) });
        ctx.note(`stage background ${bg[1]}/${bg[2]} not captured yet`);
        return route.fulfill({ status: 404, body: '' });
      }
      return route.fallback();
    }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.fallback();
    if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return font(route, req, join(ctx.cacheDir, 'fonts'));
    if (/\.supabase\.co$/.test(url.hostname)) return supabase(route, req, url, ctx);
    if (url.hostname === 'speed.cloudflare.com') return speed(route, req, url);
    if (/(^|\.)example\.com$/.test(url.hostname)) {
      const art = /^\/(poster|backdrop|logo|tile|avatar)\/([a-z0-9-]+)\.svg$/.exec(url.pathname);
      if (art) return route.fulfill({ status: 200, headers: CORS, contentType: 'image/svg+xml', body: drawArt(art[1], art[2]) });
      return route.fulfill({ status: 404, headers: CORS, body: '' });
    }
    const ext = EXTERNAL.find((e) => e.test.test(req.url()));
    if (ext) {
      const fx = readFixture(ext.file);
      return route.fulfill({ status: fx ? 200 : 404, headers: CORS, contentType: fx?.type ?? 'text/plain', body: fx?.text ?? '' });
    }
    ctx.note(`blocked ${req.method()} ${url.origin}${url.pathname}`);
    return route.fulfill({ status: 404, headers: CORS, body: '' });
  });
}
