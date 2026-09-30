// How-to capture: takes the guide's pictures and measures where each
// highlight is. Plan: .claude/plan-howto.md §4.
//
//   npm run howto:capture [-- --lang en,ar --shot home,live-list --url http://127.0.0.1:5199]
//   npm run howto:capture -- --review        also a picture of every guide slide
//   npm run howto:check                      the dry check (check.mjs)
//
// Options: --lang, --shot (comma lists), --url (use a running dev server),
// --allow-missing (a missing highlight only warns), --no-write (don't touch
// public/ or howtoRects.json), --debug (a picture after every key, in
// out/debug/), --review, --check.
//
// It opens the app in Chromium with demo data (fixtures/, answered by
// network.mjs), drives it with the remote keys (recipes.mjs), and writes
// public/howto/<lang>/<shot>.webp and src/data/howtoRects.json. The review
// pictures (rings drawn in) and a contact sheet go to scripts/howto/out/.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAll, loadContract, MAX_BYTES, MAX_TOTAL, PUBLIC_DIR, RECTS_FILE, ROOT } from './check.mjs';
import { installNetwork } from './network.mjs';
import { RECIPES, START_READY } from './recipes.mjs';
import { CAPTURE_TIME, demoSession, initScript, seedFor } from './seed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const RAW = join(OUT, 'raw');
const REVIEW = join(OUT, 'review');
const W = 960;
const H = 540;
const DEFAULT_PORT = 5199;

// ── arguments ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : null;
};
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the dev server ───────────────────────────────────────────────────────────

const up = async (url) => { try { const r = await fetch(url); return r.ok; } catch { return false; } };

async function startVite(port) {
  const url = `http://127.0.0.1:${port}`;
  if (await up(url)) throw new Error(`port ${port} is already in use; pass --url ${url} to use that server`);
  const child = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' }, detached: true,
  });
  // npx starts vite as its own child: stop the whole group.
  const kill = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } };
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 120; i++) {
    if (await up(url)) return { url, stop: kill };
    if (child.exitCode != null) break;
    await sleep(500);
  }
  kill();
  throw new Error(`vite did not start:\n${out.slice(-2000)}`);
}

// ── fonts ────────────────────────────────────────────────────────────────────

// This Linux box has no Arabic font. Noto Sans Arabic is added under the app's
// own family names, limited to the Arabic letters (unicode-range), so Arabic
// text draws in it and everything else stays Nunito / Montserrat.
const ARABIC_CSS = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;700;900&display=block';

async function arabicFontCss(page) {
  const css = await page.evaluate(async (u) => (await fetch(u)).text(), ARABIC_CSS).catch(() => '');
  const blocks = css.split('@font-face').slice(1).map((b) => '@font-face' + b.slice(0, b.indexOf('}') + 1));
  const arabic = blocks.filter((b) => /U\+06/i.test(b) || !/unicode-range/.test(b));
  return ['Nunito', 'Montserrat']
    .flatMap((fam) => arabic.map((b) => b.replace(/font-family:\s*'[^']+'/, `font-family: '${fam}'`)))
    .join('\n');
}

// Stills: nothing moves, no caret, no toasts. Paused (not finished) so the
// news ticker stays where it is.
const FREEZE_CSS = `
  *, *::before, *::after { animation-play-state: paused !important; transition-duration: 0s !important;
    transition-delay: 0s !important; caret-color: transparent !important; }
  [data-sonner-toaster], [data-radix-toast-viewport], ol[tabindex="-1"][class*="toast"], .toaster { display: none !important; }
`;

// ── measuring ────────────────────────────────────────────────────────────────

/** Every visible [data-howto] box, merged by id, in % of the 960×540 frame. */
async function measure(page) {
  return page.evaluate(({ W, H }) => {
    const boxes = {};
    for (const el of document.querySelectorAll('[data-howto]')) {
      const id = el.getAttribute('data-howto');
      if (!id) continue;
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const l = Math.max(0, r.left); const t = Math.max(0, r.top);
      const rr = Math.min(W, r.right); const b = Math.min(H, r.bottom);
      if (rr <= l || b <= t) continue;
      const cur = boxes[id];
      boxes[id] = cur
        ? { l: Math.min(cur.l, l), t: Math.min(cur.t, t), r: Math.max(cur.r, rr), b: Math.max(cur.b, b) }
        : { l, t, r: rr, b };
    }
    const round = (n) => Math.round(n * 100) / 100;
    const out = {};
    for (const [id, x] of Object.entries(boxes)) {
      out[id] = [round((x.l / W) * 100), round((x.t / H) * 100), round(((x.r - x.l) / W) * 100), round(((x.b - x.t) / H) * 100)];
    }
    return out;
  }, { W, H });
}

// ── encoding (in Chromium: no image library needed) ──────────────────────────

/** 1920×1080 PNG → 1024×576 WebP, quality stepped down until it fits. */
async function toWebp(encoder, png) {
  return encoder.evaluate(async ({ b64, max }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 576;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, 1024, 576);
    let last = null;
    for (let q = 0.62; q >= 0.399; q -= 0.02) {
      const url = c.toDataURL('image/webp', q);
      if (!url.startsWith('data:image/webp')) throw new Error('this Chromium cannot encode WebP');
      const b64out = url.slice(url.indexOf(',') + 1);
      last = { b64: b64out, q: Math.round(q * 100) / 100, bytes: Math.floor((b64out.length * 3) / 4) - (b64out.endsWith('==') ? 2 : b64out.endsWith('=') ? 1 : 0) };
      if (last.bytes <= max) return last;
    }
    return { ...last, over: true };
  }, { b64: png.toString('base64'), max: MAX_BYTES });
}

/** The review picture: the frame with each highlight's box drawn and named. */
async function reviewPng(encoder, webpB64, rects, missing) {
  return encoder.evaluate(async ({ b64, rects, missing }) => {
    const img = new Image();
    img.src = `data:image/webp;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 576;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.font = 'bold 13px sans-serif';
    const colors = ['#ffd400', '#00e5ff', '#ff4fd8', '#7CFC00', '#ff8c00'];
    Object.entries(rects).forEach(([id, [l, t, w, h]], i) => {
      const x = (l / 100) * 1024; const y = (t / 100) * 576; const ww = (w / 100) * 1024; const hh = (h / 100) * 576;
      g.strokeStyle = colors[i % colors.length]; g.lineWidth = 2; g.strokeRect(x, y, ww, hh);
      const tw = g.measureText(id).width + 8;
      const ly = y > 18 ? y - 17 : y + 1;
      g.fillStyle = colors[i % colors.length]; g.fillRect(x, ly, tw, 16);
      g.fillStyle = '#000'; g.fillText(id, x + 4, ly + 12);
    });
    if (missing.length) {
      g.fillStyle = 'rgba(200,0,0,.85)'; g.fillRect(0, 556, 1024, 20);
      g.fillStyle = '#fff'; g.fillText('MISSING: ' + missing.join(', '), 6, 571);
    }
    return c.toDataURL('image/png').split(',')[1];
  }, { b64: webpB64, rects, missing });
}

// ── driving the app ──────────────────────────────────────────────────────────

async function runSteps(page, steps, debugDir, lang) {
  if (typeof steps === 'function') steps = steps(lang);
  let n = 0;
  const snap = async () => {
    if (!debugDir) return;
    mkdirSync(debugDir, { recursive: true });
    await page.screenshot({ path: join(debugDir, `${String(n++).padStart(2, '0')}.png`), scale: 'css' });
  };
  await snap();
  for (const s of steps ?? []) {
    if (typeof s === 'string') {
      const m = /^(.+?)\*(\d+)$/.exec(s);
      const [key, n] = m ? [m[1], Number(m[2])] : [s, 1];
      for (let i = 0; i < n; i++) { await page.keyboard.press(key); await sleep(220); }
    } else if (s.hold) {
      await page.keyboard.down(s.hold); await sleep(s.ms ?? 800); await page.keyboard.up(s.hold); await sleep(300);
    } else if (s.type != null) {
      await page.keyboard.type(s.type, { delay: 90 }); await sleep(400);
    } else if (s.wait) {
      await sleep(s.wait);
    } else if (s.waitFor) {
      await page.waitForSelector(s.waitFor, { state: 'visible', timeout: s.timeout ?? 15000 });
      await sleep(250);
    } else if (s.press) {
      for (let i = 0; i < (s.max ?? 20); i++) {
        if (await page.evaluate(s.until, s.arg ?? null)) break;
        await page.keyboard.press(s.press); await sleep(220);
      }
      if (!(await page.evaluate(s.until, s.arg ?? null))) throw new Error(`pressed ${s.press} ${s.max ?? 20} times and never got there`);
    }
    await snap();
  }
}

function startUrl(base, recipe, lang) {
  if (recipe.start === 'stage') {
    const q = new URLSearchParams({ shot: recipe.stage ?? recipe.id, demo: '1', howto: '1' });
    if (recipe.bg) q.set('bg', `/__howto_bg/${lang}/${recipe.bg}.png`);
    return `${base}/howto-stage?${q}`;
  }
  return `${base}/?demo=1&howto=1`;
}

/** One shot in one language → { rects, missing, png }. */
async function shoot(context, base, recipe, lang, fontCss, notes) {
  const page = await context.newPage();
  page.on('pageerror', (e) => notes.push(`${lang}/${recipe.id}: page error: ${String(e.message).slice(0, 160)}`));
  try {
    // The seed for this recipe (per-page: each shot starts from a fresh box).
    await page.addInitScript(initScript(seedFor(lang, recipe.seed)));
    await page.goto(startUrl(base, recipe, lang), { waitUntil: 'domcontentloaded' });
    const startReady = recipe.startReady ?? START_READY[recipe.start ?? 'home'];
    if (startReady) await page.waitForSelector(startReady, { state: 'visible', timeout: 30000 });
    await sleep(recipe.startWait ?? 1500);
    await runSteps(page, recipe.keys, flag('debug') ? join(OUT, 'debug', lang, recipe.id) : null, lang);
    try {
      await page.waitForSelector(recipe.ready, { state: 'visible', timeout: 20000 });
    } catch (e) {
      // --allow-missing: take the picture anyway (a hook not in the app yet).
      if (!flag('allow-missing')) throw new Error(`never ready: ${recipe.ready} did not show`);
      notes.push(`${lang}/${recipe.id}: ${recipe.ready} never showed; taken anyway`);
    }
    if (fontCss) await page.addStyleTag({ content: fontCss });
    await page.evaluate(() => document.fonts.ready);
    await sleep(400 + (recipe.settle ?? 0));
    await page.addStyleTag({ content: FREEZE_CSS });
    await sleep(100);
    const rects = await measure(page);
    const png = await page.screenshot({ type: 'png' });
    return { rects, png };
  } finally {
    await page.close();
  }
}

// ── the rects file ───────────────────────────────────────────────────────────

const sortKeys = (o, order) => Object.fromEntries(Object.keys(o).sort((a, b) => {
  if (order) return (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999) || a.localeCompare(b);
  return a.localeCompare(b);
}).map((k) => [k, o[k]]));

/** JSON with each rect on one line. */
export function formatRects(file) {
  return JSON.stringify(file, null, 2).replace(/\[\s+([-\d.]+),\s+([-\d.]+),\s+([-\d.]+),\s+([-\d.]+)\s+\]/g, '[$1, $2, $3, $4]') + '\n';
}

function saveRects(results, langOrder) {
  const file = existsSync(RECTS_FILE) ? JSON.parse(readFileSync(RECTS_FILE, 'utf8')) : { version: 1, width: 1024, height: 576, langs: {} };
  for (const [lang, shots] of Object.entries(results)) {
    file.langs[lang] = { ...(file.langs[lang] ?? {}), ...shots };
    for (const s of Object.keys(file.langs[lang])) {
      file.langs[lang][s] = { bytes: file.langs[lang][s].bytes, rects: sortKeys(file.langs[lang][s].rects) };
    }
    file.langs[lang] = sortKeys(file.langs[lang]);
  }
  file.langs = sortKeys(file.langs, langOrder);
  writeFileSync(RECTS_FILE, formatRects({ version: 1, width: 1024, height: 576, langs: file.langs }));
}

// ── the contact sheet ────────────────────────────────────────────────────────

function writeSheet(contract) {
  const langs = contract.langs;
  const rows = Object.keys(contract.shots).map((shot) => {
    const cells = langs.map((l) => {
      const p = join(REVIEW, l, `${shot}.png`);
      return existsSync(p)
        ? `<td><a href="review/${l}/${shot}.png"><img src="review/${l}/${shot}.png" loading="lazy"></a></td>`
        : '<td class="none">not captured</td>';
    }).join('');
    return `<tr><th>${shot}</th>${cells}</tr>`;
  }).join('\n');
  const html = `<!doctype html><meta charset="utf-8"><title>How-to shots</title>
<style>body{background:#111;color:#eee;font:13px sans-serif;margin:12px}table{border-collapse:collapse}
td,th{border:1px solid #333;padding:4px;vertical-align:top}th{text-align:left;white-space:nowrap}
img{width:320px;display:block}.none{color:#f66;width:320px;text-align:center}</style>
<h1>How-to shots</h1><table><tr><th></th>${langs.map((l) => `<th>${l}</th>`).join('')}</tr>
${rows}</table>`;
  writeFileSync(join(OUT, 'index.html'), html);
}

// ── --review: every guide slide in every language ────────────────────────────

async function reviewGuide(browser, base, langs, notes) {
  const dir = join(OUT, 'guide');
  const { REVIEW_GUIDE } = await import('./recipes.mjs');
  for (const lang of langs) {
    mkdirSync(join(dir, lang), { recursive: true });
    const context = await newContext(browser, base, lang, notes);
    const page = await context.newPage();
    await page.addInitScript(initScript(seedFor(lang)));
    await page.goto(`${base}/?demo=1&howto=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(START_READY.home, { state: 'visible', timeout: 30000 });
    await sleep(1500);
    await runSteps(page, REVIEW_GUIDE.open);
    const fontCss = lang === 'ar' ? await arabicFontCss(page) : '';
    if (fontCss) await page.addStyleTag({ content: fontCss });
    let n = 0;
    for (let chapter = 0; chapter < REVIEW_GUIDE.maxChapters; chapter++) {
      await runSteps(page, REVIEW_GUIDE.openChapter(chapter));
      let prev = '';
      for (let slide = 0; slide < 20; slide++) {
        await sleep(700);
        const sig = await page.evaluate(() => document.body.innerText.slice(0, 400));
        if (sig === prev) break;
        prev = sig;
        await page.screenshot({ path: join(dir, lang, `${String(chapter).padStart(2, '0')}-${String(slide).padStart(2, '0')}.png`), scale: 'css' });
        n++;
        await runSteps(page, REVIEW_GUIDE.next);
      }
      await runSteps(page, REVIEW_GUIDE.backToChapters);
    }
    log(`review ${lang}: ${n} slide pictures in out/guide/${lang}/`);
    await context.close();
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function newContext(browser, base, lang, notes) {
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    timezoneId: 'America/New_York',
    locale: lang === 'en' ? 'en-US' : lang,
    permissions: ['microphone'],
    serviceWorkers: 'block',
  });
  await context.clock.install({ time: CAPTURE_TIME });
  await installNetwork(context, {
    appOrigin: new URL(base).origin,
    session: demoSession(),
    bgDir: RAW,
    cacheDir: join(OUT, 'cache'),
    note: (m) => { if (!notes.includes(m)) notes.push(m); },
  });
  return context;
}

async function main() {
  if (flag('check')) {
    const problems = await checkAll();
    if (problems.length) { console.error(`${problems.length} problem(s):\n  ${problems.join('\n  ')}`); process.exit(1); }
    log('howto:check: all good');
    return;
  }

  const contract = loadContract();
  const langs = list(opt('lang')) ?? contract.langs;
  for (const l of langs) if (!contract.langs.includes(l)) throw new Error(`unknown language ${l}`);
  let shots = list(opt('shot')) ?? RECIPES.map((r) => r.id);
  for (const s of shots) if (!RECIPES.some((r) => r.id === s)) throw new Error(`no recipe for ${s}`);
  // A stage shot drawn over another picture needs that picture first.
  const withBg = new Set(shots);
  for (const s of shots) { const bg = RECIPES.find((r) => r.id === s).bg; if (bg) withBg.add(bg); }
  const order = RECIPES.map((r) => r.id).filter((id) => withBg.has(id));
  const wanted = new Set(shots);
  const allowMissing = flag('allow-missing');
  const write = !flag('no-write');

  const server = opt('url') ? { url: opt('url').replace(/\/+$/, ''), stop: () => {} } : await startVite(DEFAULT_PORT);
  const { chromium } = await import('playwright');
  const exe = process.env.HOWTO_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--font-render-hinting=none'],
  });
  const notes = [];
  const failures = [];
  const results = {};
  try {
    const encCtx = await browser.newContext();
    const encoder = await encCtx.newPage();
    for (const lang of langs) {
      const context = await newContext(browser, server.url, lang, notes);
      let fontCss = '';
      if (lang === 'ar') {
        const p = await context.newPage();
        await p.goto(`${server.url}/?demo=1`, { waitUntil: 'domcontentloaded' });
        fontCss = await arabicFontCss(p);
        await p.close();
        if (!fontCss) notes.push('ar: could not load Noto Sans Arabic; Arabic may show as boxes');
      }
      for (const id of order) {
        const recipe = RECIPES.find((r) => r.id === id);
        const t0 = Date.now();
        try {
          const { rects, png } = await shoot(context, server.url, recipe, lang, fontCss, notes);
          mkdirSync(join(RAW, lang), { recursive: true });
          writeFileSync(join(RAW, lang, `${id}.png`), png);
          if (!wanted.has(id)) { log(`${lang}/${id}: background only`); continue; }
          const allowed = contract.shots[id];
          const kept = Object.fromEntries(Object.entries(rects).filter(([k]) => allowed.includes(k)));
          const missing = allowed.filter((k) => !kept[k]);
          const small = Object.entries(kept).filter(([, r]) => r[2] < 0.5 || r[3] < 0.5).map(([k]) => k);
          for (const k of small) delete kept[k];
          const webp = await toWebp(encoder, png);
          mkdirSync(join(REVIEW, lang), { recursive: true });
          writeFileSync(join(REVIEW, lang, `${id}.png`), Buffer.from(await reviewPng(encoder, webp.b64, kept, [...missing, ...small]), 'base64'));
          const problems = [];
          if (webp.over) problems.push(`picture is ${Math.round(webp.bytes / 1024)} KB even at q ${webp.q}`);
          if ((missing.length || small.length) && !allowMissing) problems.push(`missing highlight(s): ${[...missing, ...small].join(', ')}`);
          if (problems.length) {
            failures.push(`${lang}/${id}: ${problems.join('; ')}`);
            log(`${lang}/${id}: FAILED (${problems.join('; ')})`);
            continue;
          }
          if (missing.length || small.length) log(`${lang}/${id}: warning, missing ${[...missing, ...small].join(', ')}`);
          if (write) {
            mkdirSync(join(PUBLIC_DIR, lang), { recursive: true });
            writeFileSync(join(PUBLIC_DIR, lang, `${id}.webp`), Buffer.from(webp.b64, 'base64'));
            (results[lang] ??= {})[id] = { bytes: webp.bytes, rects: kept };
          }
          log(`${lang}/${id}: ${Math.round(webp.bytes / 1024)} KB q${webp.q}, ${Object.keys(kept).length}/${allowed.length} highlights (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        } catch (e) {
          failures.push(`${lang}/${id}: ${String(e.message).split('\n')[0]}`);
          log(`${lang}/${id}: FAILED (${String(e.message).split('\n')[0]})`);
        }
      }
      await context.close();
      if (write && results[lang]) saveRects({ [lang]: results[lang] }, contract.langs);
    }
    writeSheet(contract);
    if (flag('review')) await reviewGuide(browser, server.url, langs, notes);
    await encCtx.close();
  } finally {
    await browser.close();
    server.stop();
  }

  if (write) {
    let total = 0;
    for (const l of contract.langs) for (const s of Object.keys(contract.shots)) {
      const p = join(PUBLIC_DIR, l, `${s}.webp`);
      if (existsSync(p)) total += statSync(p).size;
    }
    log(`pictures in public/howto: ${(total / 1024 / 1024).toFixed(2)} MB`);
    if (total > MAX_TOTAL) failures.push(`public/howto is ${(total / 1024 / 1024).toFixed(2)} MB, over 10 MB`);
  }
  log(`contact sheet: ${join(OUT, 'index.html')}`);
  if (notes.length) log(`\nnotes:\n  ${notes.join('\n  ')}`);
  if (failures.length) {
    console.error(`\n${failures.length} shot(s) failed:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  }
}

await main();
