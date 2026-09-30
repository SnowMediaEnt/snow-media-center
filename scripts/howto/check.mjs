// How-to capture: the dry check (no browser). Plan: .claude/plan-howto.md §4.9.
//
//   npm run howto:check
//
// checkAll() is pure: it reads files and returns a list of problems (empty =
// all good). src/data/howtoRects.test.ts runs it too, so a fixture with a real
// address in it, or a hook that disappeared, fails the tests.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');
export const FIXTURES_DIR = join(HERE, 'fixtures');
export const RECTS_FILE = join(ROOT, 'src', 'data', 'howtoRects.json');
export const PUBLIC_DIR = join(ROOT, 'public', 'howto');

export const MAX_BYTES = 70 * 1024;
export const MAX_TOTAL = 10 * 1024 * 1024;

// ── the contract (src/data/howtoContract.ts, read as text: this runs in plain node) ──

const constObject = (src, name) => {
  const start = src.indexOf(`export const ${name} =`);
  if (start < 0) throw new Error(`${name} not found in howtoContract.ts`);
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (; end < src.length; end++) {
    const ch = src[end];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) break;
  }
  const body = src.slice(open, end + 1).replace(/\/\/[^\n]*/g, '');
  return new Function(`return (${body});`)();
};

/** { langs, shots: { shotId: [ids] }, diagrams } from howtoContract.ts. */
export function loadContract() {
  const src = readFileSync(join(ROOT, 'src', 'data', 'howtoContract.ts'), 'utf8');
  const langs = /HOWTO_LANGS = \[([^\]]*)\]/.exec(src)[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  return { langs, shots: constObject(src, 'HOWTO_SHOTS'), diagrams: constObject(src, 'HOWTO_DIAGRAMS') };
}

// ── privacy scan ─────────────────────────────────────────────────────────────

// Hosts a fixture may name. Everything the fixtures draw is made up.
export const URL_ALLOW = [
  /^https?:\/\/([a-z0-9-]+\.)*example\.com(\/|$)/i,
  /^demo:\/\//i,
  /^https?:\/\/(www\.)?plex\.tv\/link(\/|$)/i,
  /^https?:\/\/(www\.)?snowmediaent\.com\/remote(\/|\?|$)/i,
];
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /\b(?:https?|wss?|ftp|demo):\/\/[^\s"'<>)\\]+/gi;
const SECRET = /password|passwd|token|x-plex-token/i;

/** Problems in one fixture's text. */
export function scanText(text, name) {
  const out = [];
  for (const m of text.match(EMAIL) ?? []) {
    if (!/@example\.com$/i.test(m)) out.push(`${name}: e-mail address not @example.com: ${m}`);
  }
  for (const m of text.match(URL_RE) ?? []) {
    if (!URL_ALLOW.some((re) => re.test(m))) out.push(`${name}: URL not on the allowlist: ${m}`);
  }
  const s = SECRET.exec(text);
  if (s) out.push(`${name}: looks like a credential ("${s[0]}")`);
  return out;
}

const walk = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
};

// ── hooks in the source ──────────────────────────────────────────────────────

const SOURCE_DIRS = ['src/pages', 'src/components', 'src/howto'];

/** Every quoted string literal in the app source (tests excluded). */
export function sourceLiterals() {
  const lits = new Set();
  for (const d of SOURCE_DIRS) {
    for (const f of walk(join(ROOT, d))) {
      if (!/\.(tsx?|jsx?)$/.test(f) || /\.test\.|\.spec\./.test(f)) continue;
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(['"`])([A-Za-z]+\.[A-Za-z0-9]+)\1/g)) lits.add(m[2]);
    }
  }
  return lits;
}

// ── rects file ───────────────────────────────────────────────────────────────

/** Problems with howtoRects.json's shape and ranges (not completeness). */
export function checkRectsShape(file, contract) {
  const out = [];
  if (file?.version !== 1 || file?.width !== 1024 || file?.height !== 576 || typeof file?.langs !== 'object') {
    out.push('howtoRects.json: header must be { version: 1, width: 1024, height: 576, langs }');
    return out;
  }
  for (const [lang, shots] of Object.entries(file.langs)) {
    if (!contract.langs.includes(lang)) out.push(`howtoRects.json: unknown language ${lang}`);
    for (const [shot, entry] of Object.entries(shots ?? {})) {
      const allowed = contract.shots[shot];
      if (!allowed) { out.push(`howtoRects.json: ${lang}/${shot} is not a shot in the contract`); continue; }
      if (!Number.isInteger(entry?.bytes) || entry.bytes <= 0) out.push(`howtoRects.json: ${lang}/${shot} bytes`);
      for (const [id, r] of Object.entries(entry?.rects ?? {})) {
        if (!allowed.includes(id)) out.push(`howtoRects.json: ${lang}/${shot} has ${id}, not in the contract`);
        const ok = Array.isArray(r) && r.length === 4 && r.every((n) => typeof n === 'number' && Number.isFinite(n))
          && r[0] >= 0 && r[1] >= 0 && r[2] >= 0.5 && r[3] >= 0.5 && r[0] + r[2] <= 100.01 && r[1] + r[3] <= 100.01;
        if (!ok) out.push(`howtoRects.json: ${lang}/${shot} ${id} out of range: ${JSON.stringify(r)}`);
      }
    }
  }
  return out;
}

// ── all of it ────────────────────────────────────────────────────────────────

/**
 * The dry check. `recipes` defaults to recipes.mjs's list (the test passes it
 * in to keep the import graph simple).
 */
export async function checkAll({ recipes } = {}) {
  const problems = [];
  const contract = loadContract();
  const list = recipes ?? (await import('./recipes.mjs')).RECIPES;

  // 1. Every shot has a recipe, and every recipe is a shot.
  const byId = new Map(list.map((r) => [r.id, r]));
  for (const shot of Object.keys(contract.shots)) if (!byId.has(shot)) problems.push(`recipe missing for shot ${shot}`);
  for (const r of list) {
    if (!contract.shots[r.id]) problems.push(`recipe ${r.id} is not a shot in the contract`);
    if (r.bg && !contract.shots[r.bg]) problems.push(`recipe ${r.id}: bg ${r.bg} is not a shot`);
    if (!r.ready) problems.push(`recipe ${r.id} has no ready selector`);
  }

  // 2. Every highlight id is in the source as a literal.
  const lits = sourceLiterals();
  for (const [shot, ids] of Object.entries(contract.shots)) {
    for (const id of ids) if (!lits.has(id)) problems.push(`hook "${id}" (${shot}) is not in src/pages, src/components or src/howto`);
  }

  // 3 + 4. Every fixture parses and holds made-up data only.
  for (const f of walk(FIXTURES_DIR)) {
    const name = relative(HERE, f);
    const text = readFileSync(f, 'utf8');
    if (f.endsWith('.json')) {
      try { JSON.parse(text); } catch (e) { problems.push(`${name}: bad JSON (${e.message})`); continue; }
    }
    problems.push(...scanText(text, name));
  }

  // 5. The rects file is in range.
  try {
    problems.push(...checkRectsShape(JSON.parse(readFileSync(RECTS_FILE, 'utf8')), contract));
  } catch (e) {
    problems.push(`howtoRects.json: ${e.message}`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const problems = await checkAll();
  if (problems.length) {
    console.error(`howto:check found ${problems.length} problem(s):\n  ` + problems.join('\n  '));
    process.exit(1);
  }
  console.log('howto:check: all good');
}
