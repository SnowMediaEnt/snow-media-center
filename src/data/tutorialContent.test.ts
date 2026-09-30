import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { TUTORIAL_CHAPTERS } from './tutorialContent';
import { HOWTO_DIAGRAMS, HOWTO_LANGS, HOWTO_SHOTS } from './howtoContract';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const locales: Record<string, unknown> = {};
for (const lang of HOWTO_LANGS) locales[lang] = JSON.parse(read(`src/i18n/locales/${lang}/guides.json`));

/** Text for a key in one language ('guides.howTo.a.b' -> the string), or undefined. */
function text(lang: string, key: string): string | undefined {
  let cur: unknown = locales[lang];
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

const shots = HOWTO_SHOTS as Record<string, readonly string[]>;
const diagrams = HOWTO_DIAGRAMS as Record<string, readonly string[]>;
const allSlides = TUTORIAL_CHAPTERS.flatMap((c) => c.slides.map((s) => ({ chapter: c.id, slide: s })));
const chars = (s: string) => Array.from(s).length;

describe('How-to chapters: structure', () => {
  it('has the 10 chapters and keeps the 7 ids analytics already reports', () => {
    const ids = TUTORIAL_CHAPTERS.map((c) => c.id);
    expect(ids).toHaveLength(10);
    for (const old of ['basics', 'livetv', 'movies', 'apps', 'support', 'account', 'extras']) expect(ids).toContain(old);
    for (const added of ['watching', 'recording', 'gameday']) expect(ids).toContain(added);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique slide ids inside a chapter', () => {
    for (const c of TUTORIAL_CHAPTERS) {
      const ids = c.slides.map((s) => s.id);
      expect(new Set(ids).size, c.id).toBe(ids.length);
      expect(ids.length, c.id).toBeGreaterThan(0);
    }
  });

  it('gives every slide a shot that exists, and highlights that belong to that shot', () => {
    for (const { chapter, slide } of allSlides) {
      const name = `${chapter}.${slide.id}`;
      const list = shots[slide.art.shot] ?? diagrams[slide.art.shot];
      expect(list, `${name}: shot ${slide.art.shot}`).toBeTruthy();
      const hl = slide.art.highlights ?? [];
      expect(hl.length, `${name}: highlights`).toBeLessThanOrEqual(3);
      for (const h of hl) expect(list, `${name}: ${h.id}`).toContain(h.id);
      expect(new Set(hl.map((h) => h.id)).size, `${name}: repeated highlight`).toBe(hl.length);
    }
  });

  it('only names a remote hint the chip can draw', () => {
    for (const { chapter, slide } of allSlides) {
      if (slide.art.remote) expect(['ok', 'holdOk', 'back', 'upDown', 'leftRight'], `${chapter}.${slide.id}`).toContain(slide.art.remote);
    }
  });

  it('points every "Take me there" at a real Index view, a real Support event or a player section', () => {
    const index = read('src/pages/Index.tsx');
    const views = new Set([...index.matchAll(/isView\(currentView, '([\w-]+)'\)/g)].map((m) => m[1]));
    const support = read('src/components/Support.tsx');
    let links = 0;
    for (const { chapter, slide } of allSlides) {
      const dl = slide.deepLink;
      if (!dl) continue;
      links++;
      if (dl.kind === 'view') expect(views.has(dl.view), `${chapter}.${slide.id}: view ${dl.view}`).toBe(true);
      else if (dl.kind === 'event') expect(support.includes(`'${dl.event}'`), `${chapter}.${slide.id}: event ${dl.event}`).toBe(true);
      else expect(['live', 'movies']).toContain(dl.section);
    }
    expect(links).toBeGreaterThan(8);
  });

  it('keeps billing out of the guide', () => {
    const keys = JSON.stringify(TUTORIAL_CHAPTERS.map((c) => c.slides.map((s) => s.deepLink)));
    expect(keys).not.toMatch(/billing|buy-plan|my-account/i);
    for (const lang of HOWTO_LANGS) expect(JSON.stringify((locales[lang] as { guides: { howTo: unknown } }).guides.howTo)).not.toMatch(/Buy a plan/i);
  });

  it('has the Settings → Language slide with a link to Settings', () => {
    const slide = TUTORIAL_CHAPTERS.find((c) => c.id === 'extras')!.slides.find((s) => s.id === 'language')!;
    expect(slide.art.shot).toBe('settings-language');
    expect(slide.art.highlights?.map((h) => h.id)).toEqual(['set.language']);
    expect(slide.deepLink).toMatchObject({ kind: 'view', view: 'settings' });
    expect(text('en', slide.line2Key!)).toMatch(/AI assistant/);
    expect(text('en', slide.line2Key!)).toMatch(/provider/);
  });
});

describe('How-to chapters: text in every language', () => {
  const keysOf = () => {
    const keys: string[] = [];
    for (const c of TUTORIAL_CHAPTERS) {
      keys.push(c.titleKey, c.subtitleKey);
      for (const s of c.slides) {
        keys.push(s.titleKey);
        if (s.line2Key) keys.push(s.line2Key);
        if (s.deepLink) keys.push(s.deepLink.labelKey);
        for (const h of s.art.highlights ?? []) keys.push(h.labelKey);
        if (s.art.remote) keys.push(`guides.howTo.remote.${s.art.remote}`);
      }
    }
    return [...new Set(keys)];
  };

  it.each(HOWTO_LANGS)('%s has every title, line, link, label and remote hint, none empty', (lang) => {
    const missing = keysOf().filter((k) => !(text(lang, k) ?? '').trim());
    expect(missing).toEqual([]);
  });

  it('has all 5 remote hints in every language', () => {
    for (const lang of HOWTO_LANGS) {
      for (const hint of ['ok', 'holdOk', 'back', 'upDown', 'leftRight']) expect((text(lang, `guides.howTo.remote.${hint}`) ?? '').trim(), `${lang} ${hint}`).toBeTruthy();
    }
  });

  it('keeps labels to 26 characters in every language', () => {
    const tooLong: string[] = [];
    for (const lang of HOWTO_LANGS) {
      const labels = ((locales[lang] as { guides: { howTo: { labels: Record<string, string> } } }).guides.howTo.labels);
      for (const [id, v] of Object.entries(labels)) if (chars(v) > 26) tooLong.push(`${lang}.${id} (${chars(v)})`);
    }
    expect(tooLong).toEqual([]);
  });

  it('has no unused label, so a removed slide cannot leave text behind', () => {
    const used = new Set(allSlides.flatMap(({ slide }) => (slide.art.highlights ?? []).map((h) => h.labelKey.replace('guides.howTo.labels.', ''))));
    const en = (locales.en as { guides: { howTo: { labels: Record<string, string> } } }).guides.howTo.labels;
    expect(Object.keys(en).filter((k) => !used.has(k))).toEqual([]);
  });

  it('keeps English titles to 90 characters and second lines to 150', () => {
    for (const { chapter, slide } of allSlides) {
      const name = `${chapter}.${slide.id}`;
      expect(chars(text('en', slide.titleKey)!), `${name} title`).toBeLessThanOrEqual(90);
      if (slide.line2Key) expect(chars(text('en', slide.line2Key)!), `${name} line2`).toBeLessThanOrEqual(150);
    }
  });

  it('has a link button only where a slide has a link, and a second line only where the key is set', () => {
    for (const lang of HOWTO_LANGS) {
      const howTo = (locales[lang] as { guides: { howTo: Record<string, Record<string, Record<string, string>>> } }).guides.howTo;
      for (const { chapter, slide } of allSlides) {
        const entry = howTo[chapter][slide.id];
        expect(!!entry.linkBtn, `${lang} ${chapter}.${slide.id} linkBtn`).toBe(!!slide.deepLink);
        expect(!!entry.line2, `${lang} ${chapter}.${slide.id} line2`).toBe(!!slide.line2Key);
      }
    }
  });

  it('removes the old s0..s6 keys', () => {
    for (const lang of HOWTO_LANGS) {
      const howTo = (locales[lang] as { guides: { howTo: Record<string, Record<string, unknown>> } }).guides.howTo;
      for (const c of TUTORIAL_CHAPTERS) expect(Object.keys(howTo[c.id]).filter((k) => /^s\d$/.test(k)), `${lang} ${c.id}`).toEqual([]);
    }
  });

  it('keeps the general keys and the untouched buffering guide', () => {
    for (const lang of HOWTO_LANGS) {
      for (const key of ['title', 'pickTopic', 'slideOf', 'doneBtn', 'nextBtn']) expect(text(lang, `guides.howTo.${key}`), `${lang} ${key}`).toBeTruthy();
      expect((locales[lang] as { guides: Record<string, unknown> }).guides.buffering, lang).toBeTruthy();
    }
  });
});
