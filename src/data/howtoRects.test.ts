// The How-to pictures and where their highlights are (plan-howto.md §4.11).
// howtoRects.json and public/howto/ are written by `npm run howto:capture`;
// a test failing here means a picture is missing or stale: run it again.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOWTO_IMAGE_DIR, HOWTO_LANGS, HOWTO_SHOTS, type HowtoRectsFile } from './howtoContract';
import rectsJson from './howtoRects.json';
import { checkAll } from '../../scripts/howto/check.mjs';
import { RECIPES } from '../../scripts/howto/recipes.mjs';

const file = rectsJson as unknown as HowtoRectsFile;
const PUBLIC = join(__dirname, '..', '..', 'public', HOWTO_IMAGE_DIR);
const shots = Object.entries(HOWTO_SHOTS) as Array<[string, readonly string[]]>;

describe('howtoRects.json', () => {
  it('has the right shape', () => {
    expect(file.version).toBe(1);
    expect(file.width).toBe(1024);
    expect(file.height).toBe(576);
    expect(typeof file.langs).toBe('object');
    for (const lang of Object.keys(file.langs)) expect(HOWTO_LANGS).toContain(lang);
  });

  it('has every shot and every highlight in every language', () => {
    const missing: string[] = [];
    for (const lang of HOWTO_LANGS) {
      for (const [shot, ids] of shots) {
        const entry = file.langs[lang]?.[shot];
        if (!entry) { missing.push(`${lang}/${shot}`); continue; }
        for (const id of ids) if (!entry.rects[id]) missing.push(`${lang}/${shot}: ${id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps every rect inside the frame', () => {
    const bad: string[] = [];
    for (const [lang, byShot] of Object.entries(file.langs)) {
      for (const [shot, entry] of Object.entries(byShot ?? {})) {
        for (const [id, [l, t, w, h]] of Object.entries(entry.rects)) {
          if (!(l >= 0 && t >= 0 && w >= 0.5 && h >= 0.5 && l + w <= 100.01 && t + h <= 100.01)) bad.push(`${lang}/${shot}: ${id}`);
          if (!(HOWTO_SHOTS as Record<string, readonly string[]>)[shot]?.includes(id)) bad.push(`${lang}/${shot}: ${id} is not in the contract`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('points at pictures that exist, with the recorded size', () => {
    const bad: string[] = [];
    for (const [lang, byShot] of Object.entries(file.langs)) {
      for (const [shot, entry] of Object.entries(byShot ?? {})) {
        const p = join(PUBLIC, lang, `${shot}.webp`);
        if (!existsSync(p)) { bad.push(`${lang}/${shot}: no file`); continue; }
        if (statSync(p).size !== entry.bytes) bad.push(`${lang}/${shot}: ${statSync(p).size} bytes, recorded ${entry.bytes}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps each picture at 70 KB or less, and all of them at 10 MB or less', () => {
    let total = 0;
    const big: string[] = [];
    for (const lang of HOWTO_LANGS) {
      for (const [shot] of shots) {
        const p = join(PUBLIC, lang, `${shot}.webp`);
        if (!existsSync(p)) continue;
        const n = statSync(p).size;
        total += n;
        if (n > 70 * 1024) big.push(`${lang}/${shot}: ${n}`);
      }
    }
    expect(big).toEqual([]);
    expect(total).toBeLessThanOrEqual(10 * 1024 * 1024);
  });
});

describe('howto:check', () => {
  it('finds no problems (recipes, hooks in the source, fixtures, privacy)', async () => {
    expect(await checkAll({ recipes: RECIPES })).toEqual([]);
  });
});
