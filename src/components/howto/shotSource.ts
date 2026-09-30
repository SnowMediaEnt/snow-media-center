// Which picture and which measured rects a slide shows: the customer's
// language first, then English, else nothing (the view then draws the schematic).
// Only a URL is returned; the view loads that one image and no other.
import rectsFile from '@/data/howtoRects.json';
import { HOWTO_IMAGE_DIR, HOWTO_LANGS, type HowtoLang, type HowtoRectsFile, type ShotRect } from '@/data/howtoContract';

const RECTS = rectsFile as unknown as HowtoRectsFile;

export interface ResolvedShot {
  url: string;
  /** Highlight id -> [left, top, width, height] in percent of the frame. */
  rects: Record<string, ShotRect>;
  /** The language the picture is actually in (English when the wanted one is missing). */
  lang: HowtoLang;
}

/** 'es-MX' -> 'es'; anything the guide has no pictures for -> 'en'. */
export function normalizeLang(lang: string | undefined | null): HowtoLang {
  const base = (lang || '').toLowerCase().split(/[-_]/)[0];
  return (HOWTO_LANGS as readonly string[]).indexOf(base) >= 0 ? (base as HowtoLang) : 'en';
}

const entryFor = (shot: string, lang: HowtoLang) => RECTS.langs[lang] && RECTS.langs[lang]![shot];

export function resolveShot(shot: string, lang: HowtoLang): ResolvedShot | null {
  const wanted = entryFor(shot, lang);
  const use: HowtoLang | null = wanted ? lang : entryFor(shot, 'en') ? 'en' : null;
  if (!use) return null;
  const entry = entryFor(shot, use)!;
  return {
    url: import.meta.env.BASE_URL + HOWTO_IMAGE_DIR + '/' + use + '/' + shot + '.webp',
    rects: entry.rects,
    lang: use,
  };
}
