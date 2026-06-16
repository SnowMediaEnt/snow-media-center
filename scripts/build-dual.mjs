#!/usr/bin/env node
/**
 * Dual-bundle build for Snow Media Center.
 *
 * 1. Builds the app twice with Vite:
 *      - modern  -> dist-modern  (base "/modern/", es2020)
 *      - legacy  -> dist-legacy  (base "/legacy/", chrome66/es2017)
 * 2. Merges both into a single `dist/` tree:
 *      dist/modern/...
 *      dist/legacy/...
 *      dist/index.html      (ES5-safe runtime loader)
 *      dist/<public files>  (favicon, version.json, icons, ...)
 * 3. The loader decides at runtime which bundle to use, based on
 *    whether the WebView can parse modern JS, with a query override
 *    (?smcBundle=modern|legacy) and a SyntaxError -> legacy fallback.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function run(cmd, args, env) {
  console.log(`\n> ${cmd} ${args.join(" ")}  (SMC_BUNDLE=${env.SMC_BUNDLE})`);
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with status ${res.status}`);
  }
}

function rmrf(p) {
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

// ---- 1. Clean prior outputs ------------------------------------------------
rmrf(join(root, "dist"));
rmrf(join(root, "dist-modern"));
rmrf(join(root, "dist-legacy"));

// ---- 2. Build modern + legacy ---------------------------------------------
run("npx", ["vite", "build"], { SMC_BUNDLE: "modern" });
run("npx", ["vite", "build"], { SMC_BUNDLE: "legacy" });

// ---- 3. Assemble dist/ -----------------------------------------------------
mkdirSync(join(root, "dist"), { recursive: true });

// Copy public assets (favicon, version.json, icons, etc.) from the modern
// build's root into dist/ root. Vite copies `public/` into each outDir.
const modernDir = join(root, "dist-modern");
const legacyDir = join(root, "dist-legacy");

// Shallow-copy modern build's root-level files (everything except its own
// index.html, which we'll replace with the loader, and the `assets/` folder
// which we'll relocate under /modern/).
cpSync(modernDir, join(root, "dist"), {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(modernDir.length + 1);
    if (rel === "" ) return true;
    // Skip the bundle output — placed under dist/modern below.
    if (rel === "index.html") return false;
    if (rel === "assets" || rel.startsWith("assets/")) return false;
    return true;
  },
});

// Move modern bundle into dist/modern
mkdirSync(join(root, "dist", "modern"), { recursive: true });
cpSync(join(modernDir, "assets"), join(root, "dist", "modern", "assets"), { recursive: true });
cpSync(join(modernDir, "index.html"), join(root, "dist", "modern", "index.html"));

// Move legacy bundle into dist/legacy
mkdirSync(join(root, "dist", "legacy"), { recursive: true });
cpSync(join(legacyDir, "assets"), join(root, "dist", "legacy", "assets"), { recursive: true });
cpSync(join(legacyDir, "index.html"), join(root, "dist", "legacy", "index.html"));

// ---- 4. Extract entry asset URLs from each build's index.html --------------
function extractAssets(htmlPath, baseHref) {
  const html = readFileSync(htmlPath, "utf8");
  const scripts = [];
  const styles = [];
  const modulePreloads = [];
  const scriptRe = /<script[^>]*type="module"[^>]*src="([^"]+)"/g;
  const cssRe = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g;
  const preloadRe = /<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g;
  let m;
  while ((m = scriptRe.exec(html))) scripts.push(m[1]);
  while ((m = cssRe.exec(html))) styles.push(m[1]);
  while ((m = preloadRe.exec(html))) modulePreloads.push(m[1]);
  // URLs already include baseHref (/modern/ or /legacy/) — leave as-is.
  return { scripts, styles, modulePreloads, baseHref };
}

const modernEntry = extractAssets(join(modernDir, "index.html"), "/modern/");
const legacyEntry = extractAssets(join(legacyDir, "index.html"), "/legacy/");

// ---- 5. Generate ES5-safe runtime loader as dist/index.html ----------------
const loader = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<link rel="icon" type="image/svg+xml" href="/favicon.ico" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#000000">
<title>Snow Media Center</title>
<style>
html,body{width:100%;height:100%;margin:0;padding:0;background:#000;overflow-x:hidden;-webkit-text-size-adjust:100%}
#smc-fallback{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:#000;color:#fff;font-family:sans-serif;padding:32px;text-align:center;z-index:99999}
#smc-fallback h1{font-size:28px;margin:48px 0 16px}
#smc-fallback p{font-size:16px;max-width:640px;margin:0 auto 12px;line-height:1.4}
</style>
<script>
// Polyfill for very old Android WebViews
if (typeof structuredClone === 'undefined') {
  window.structuredClone = function(o){ return JSON.parse(JSON.stringify(o)); };
}
</script>
</head>
<body>
<div id="root"></div>
<noscript><div style="padding:24px;font-family:sans-serif;color:#fff;background:#000;text-align:center;">Snow Media Center requires JavaScript to be enabled.</div></noscript>
<div id="smc-fallback">
  <h1>App update required</h1>
  <p>Your device's system WebView is too old to run Snow Media Center.</p>
  <p style="opacity:.85">Please update "Android System WebView" and "Google Chrome" from the Play Store, then restart the app.</p>
  <p id="smc-fallback-detail" style="font-size:12px;opacity:.6;margin-top:24px;word-break:break-word;"></p>
</div>
<script>
/* ES5-safe dual-bundle loader. Picks modern or legacy at runtime. */
(function () {
  var MODERN = ${JSON.stringify(modernEntry)};
  var LEGACY = ${JSON.stringify(legacyEntry)};

  var fallbackShown = false;
  function showFallback(detail) {
    if (fallbackShown) return;
    var root = document.getElementById('root');
    if (root && root.childNodes && root.childNodes.length > 0) return;
    var el = document.getElementById('smc-fallback');
    if (!el) return;
    el.style.display = 'block';
    if (detail) {
      var d = document.getElementById('smc-fallback-detail');
      if (d) d.textContent = String(detail).slice(0, 300);
    }
    fallbackShown = true;
  }

  function canParseModern() {
    try {
      // Optional chaining + nullish coalescing — fails to parse on WebView <= ~66.
      new Function('var o={a:{b:1}};return o?.a?.b ?? 0;');
      return true;
    } catch (e) { return false; }
  }

  function getOverride() {
    try {
      var s = window.location.search || '';
      var m = s.match(/[?&]smcBundle=(modern|legacy)\\b/);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  var override = getOverride();
  var modernOk = canParseModern();
  var initial = override || (modernOk ? 'modern' : 'legacy');
  var reason = override
    ? 'override:' + override
    : (modernOk ? 'modern-syntax-ok' : 'modern-syntax-unsupported');

  window.__SMC_BUNDLE__ = initial;
  window.__SMC_BUNDLE_REASON__ = reason;

  function loadCss(hrefs) {
    for (var i = 0; i < hrefs.length; i++) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = hrefs[i];
      document.head.appendChild(l);
    }
  }

  function loadModule(src, onerror) {
    var s = document.createElement('script');
    s.type = 'module';
    s.src = src;
    s.onerror = onerror;
    document.body.appendChild(s);
  }

  function loadClassic(src, onerror) {
    var s = document.createElement('script');
    s.src = src;
    s.defer = true;
    s.onerror = onerror;
    document.body.appendChild(s);
  }

  var legacyAttempted = false;
  function loadLegacy(reasonDetail) {
    if (legacyAttempted) { showFallback(reasonDetail || ''); return; }
    legacyAttempted = true;
    window.__SMC_BUNDLE__ = 'legacy';
    window.__SMC_BUNDLE_REASON__ = (window.__SMC_BUNDLE_REASON__ || '') + '|fallback:' + (reasonDetail || 'modern-failed');
    loadCss(LEGACY.styles);
    var entry = LEGACY.scripts[0];
    // Legacy build still ships as ES modules from Vite; if the WebView lacks
    // module support, swap to a classic <script> so it at least parses.
    var supportsModule = ('noModule' in document.createElement('script'));
    var fail = function () { showFallback('legacy bundle failed to load'); };
    if (supportsModule) loadModule(entry, fail);
    else loadClassic(entry, fail);
  }

  function loadModern() {
    loadCss(MODERN.styles);
    // Hint the browser to fetch chunks early when supported.
    try {
      for (var i = 0; i < MODERN.modulePreloads.length; i++) {
        var p = document.createElement('link');
        p.rel = 'modulepreload';
        p.href = MODERN.modulePreloads[i];
        document.head.appendChild(p);
      }
    } catch (e) {}
    var entry = MODERN.scripts[0];
    loadModule(entry, function () { loadLegacy('modern script load error'); });
  }

  // Global SyntaxError -> swap to legacy.
  window.addEventListener('error', function (e) {
    var msg = (e && e.message) ? e.message : '';
    if (/Unexpected token|SyntaxError/i.test(msg)) {
      if (window.__SMC_BUNDLE__ === 'modern') loadLegacy(msg);
      else showFallback(msg);
    }
  });

  // Watchdog: if React never mounts, show the fallback panel.
  setTimeout(function () { showFallback(''); }, 12000);

  if (initial === 'legacy') loadLegacy(reason);
  else loadModern();
})();
</script>
</body>
</html>
`;

writeFileSync(join(root, "dist", "index.html"), loader, "utf8");

// ---- 6. Cleanup intermediate outputs --------------------------------------
rmrf(modernDir);
rmrf(legacyDir);

console.log("\n✔ Dual bundle ready in dist/  (modern + legacy + loader)");
