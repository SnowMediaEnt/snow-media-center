import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import glossary from './glossary.json';
import { ROOT, coveredFiles, findForbiddenIntl, show } from './guard/scan';

const LANGS = ['en', 'es', 'fr', 'de', 'ar'] as const;
type Lang = (typeof LANGS)[number];
const LOCALES = path.resolve(__dirname, 'locales');

const FORMS: Record<Lang, string[]> = {
  en: ['one', 'other'],
  de: ['one', 'other'],
  es: ['one', 'many', 'other'],
  fr: ['one', 'many', 'other'],
  ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
};
const PLURAL = /_(zero|one|two|few|many|other)$/;
const SHORT = /(Btn|Tab|Chip)$/;

/** Reads a JSON file and returns every "a.b.c" key path that is defined twice in one object. */
function duplicateKeys(text: string): string[] {
  const dups: string[] = [];
  let i = 0;
  const ws = () => { while (/\s/.test(text[i])) i++; };
  const str = (): string => {
    let out = '';
    i++; // opening quote
    while (text[i] !== '"') {
      if (text[i] === '\\') { out += text[i] + text[i + 1]; i += 2; } else out += text[i++];
    }
    i++;
    return out;
  };
  const value = (p: string): void => {
    ws();
    if (text[i] === '{') {
      i++;
      const seen = new Set<string>();
      ws();
      while (text[i] !== '}') {
        ws();
        const key = str();
        const full = p ? `${p}.${key}` : key;
        if (seen.has(key)) dups.push(full);
        seen.add(key);
        ws(); i++; // colon
        value(full);
        ws();
        if (text[i] === ',') i++;
        ws();
      }
      i++;
    } else if (text[i] === '[') {
      i++; ws();
      while (text[i] !== ']') { value(p); ws(); if (text[i] === ',') i++; ws(); }
      i++;
    } else if (text[i] === '"') {
      str();
    } else {
      while (i < text.length && !/[,}\]\s]/.test(text[i])) i++;
    }
  };
  value('');
  return dups;
}

function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = obj;
  }
  return out;
}

const placeholders = (s: string): string[] =>
  [...new Set([...s.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]))].sort();

const len = (s: string) => Array.from(s).length;

// lang -> area -> { raw text, parsed }
const files: Record<string, Record<string, { text: string; json: Record<string, unknown> }>> = {};
for (const lang of LANGS) {
  files[lang] = {};
  const dir = path.join(LOCALES, lang);
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : []) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    files[lang][name.replace(/\.json$/, '')] = { text, json: JSON.parse(text) };
  }
}
const areas = Object.keys(files.en).sort();

/** Keys of one file with plural forms folded: "a.b_one" and "a.b_other" become "a.b" with forms. */
function groups(json: Record<string, unknown>) {
  const groupsMap = new Map<string, Record<string, string>>();
  for (const [key, value] of Object.entries(flatten(json))) {
    const m = key.match(PLURAL);
    const base = m ? key.slice(0, -m[0].length) : key;
    const form = m ? m[1] : '';
    const g = groupsMap.get(base) || {};
    g[form] = value as string;
    groupsMap.set(base, g);
  }
  return groupsMap;
}

describe('locale files: structure', () => {
  it('has the core areas', () => {
    expect(areas).toEqual(expect.arrayContaining(['common', 'home', 'settings']));
  });

  it('game files (locales/<lang>.json) hold only games.*', () => {
    for (const lang of LANGS) {
      const json = JSON.parse(fs.readFileSync(path.join(LOCALES, `${lang}.json`), 'utf8'));
      expect(Object.keys(json), lang).toEqual(['games']);
    }
  });

  for (const lang of LANGS) {
    it(`${lang}: same area files as English`, () => {
      expect(Object.keys(files[lang]).sort()).toEqual(areas);
    });
  }

  for (const lang of LANGS) {
    for (const area of areas) {
      it(`${lang}/${area}.json: top key equals the file name, no duplicate keys`, () => {
        const f = files[lang][area];
        if (!f) return; // reported by the area-file test above
        expect(Object.keys(f.json)).toEqual([area]);
        expect(duplicateKeys(f.text)).toEqual([]);
      });
    }
  }
});

describe('locale files: content matches English', () => {
  for (const lang of LANGS) {
    for (const area of areas) {
      const f = files[lang][area];
      if (!f) continue;
      it(`${lang}/${area}.json`, () => {
        const en = groups(files.en[area].json);
        const mine = groups(f.json);

        // same keys (plural forms folded)
        expect([...mine.keys()].sort()).toEqual([...en.keys()].sort());

        const problems: string[] = [];
        for (const [base, forms] of mine) {
          const enForms = en.get(base)!;
          const isPlural = Object.keys(forms).some((k) => k !== '');
          const needed = FORMS[lang];

          if (isPlural) {
            const have = Object.keys(forms).sort();
            if (have.join() !== [...needed].sort().join()) problems.push(`${base}: plural forms ${have.join('/')} should be ${needed.join('/')}`);
            if (!Object.keys(enForms).some((k) => k !== '')) problems.push(`${base}: plural here, not in English`);
          } else if (Object.keys(enForms).some((k) => k !== '')) {
            problems.push(`${base}: English is plural, this is not`);
          }

          for (const [form, value] of Object.entries(forms)) {
            const name = form ? `${base}_${form}` : base;
            if (typeof value !== 'string') { problems.push(`${name}: not a string`); continue; }
            if (value.trim() === '') { problems.push(`${name}: empty`); continue; }

            // placeholders: the "other" form must match English "other"; other forms may drop
            // {{count}} (Arabic "two hours") but never add one English does not have.
            const enValue = enForms[form] ?? enForms.other ?? enForms[''];
            const enAll = new Set(Object.values(enForms).flatMap((v) => placeholders(v)));
            const got = placeholders(value);
            if (isPlural && form !== 'other') {
              const extra = got.filter((p) => !enAll.has(p));
              if (extra.length) problems.push(`${name}: unexpected {{${extra.join('}}, {{')}}}`);
            } else if (typeof enValue === 'string' && placeholders(enValue).join() !== got.join()) {
              problems.push(`${name}: placeholders {{${got.join('}}, {{')}}} should be {{${placeholders(enValue).join('}}, {{')}}}`);
            }

            // short labels
            if (SHORT.test(base.split('.').pop()!) && lang !== 'en') {
              const enRef = enForms[form] ?? enForms.other ?? enForms[''];
              if (typeof enRef === 'string' && len(value) > len(enRef) * 1.4 + 4) {
                problems.push(`${name}: ${len(value)} characters is too long for a short label (English ${len(enRef)}, max ${Math.floor(len(enRef) * 1.4 + 4)})`);
              }
            }
          }
        }
        expect(problems).toEqual([]);
      });
    }
  }
});

describe('common.*', () => {
  const REQUIRED = ['ok', 'cancel', 'back', 'close', 'retry', 'save', 'delete', 'yes', 'no', 'loading', 'tryAgain', 'signInAction', 'signOut'];
  it('has the universal labels and the relative-time plurals in every language', () => {
    for (const lang of LANGS) {
      const common = files[lang].common.json.common as Record<string, unknown>;
      for (const key of REQUIRED) expect(common[key], `${lang} common.${key}`).toBeTruthy();
      const rel = flatten(common.relative);
      for (const unit of ['minutes', 'hours', 'days', 'months', 'years']) {
        for (const dir of [`${unit}Ago`, `in${unit[0].toUpperCase()}${unit.slice(1)}`]) {
          for (const form of FORMS[lang]) expect(rel[`${dir}_${form}`], `${lang} ${dir}_${form}`).toBeTruthy();
        }
      }
      expect(rel.justNow).toBeTruthy();
    }
  });
});

describe('glossary.json', () => {
  it('has every term in every language', () => {
    for (const [term, langs] of Object.entries(glossary.terms as Record<string, Record<string, string>>)) {
      for (const lang of LANGS) expect(langs[lang]?.trim(), `${term}.${lang}`).toBeTruthy();
    }
  });
  it('lists the words that stay in English', () => {
    for (const word of ['Snow Media', 'Plex', 'DreamStreams', 'VibezTV', 'HEVC', 'Fire TV']) {
      expect(glossary.doNotTranslate).toContain(word);
    }
  });
});

describe('covered files', () => {
  it('use no Intl feature missing on Chrome 66', () => {
    const findings = coveredFiles().flatMap((f) => findForbiddenIntl(f, fs.readFileSync(path.join(ROOT, f), 'utf8')));
    expect(show(findings)).toEqual([]);
  });
});
