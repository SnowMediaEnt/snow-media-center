import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { ROOT, coveredFiles, findForbiddenIntl, findHardcodedText, needsTranslation, show } from './guard/scan';

describe('hardcoded text detector', () => {
  const scan = (src: string) => findHardcodedText('x.tsx', src).map((f) => f.text);

  it('flags JSX text, text props and toast text', () => {
    expect(scan('const A = () => <div>Play now</div>;')).toEqual(['Play now']);
    expect(scan('const A = () => <input placeholder="Search channels" />;')).toEqual(['Search channels']);
    expect(scan('const A = () => <button aria-label={ok ? "Close menu" : "Open menu"} />;')).toEqual(['Close menu', 'Open menu']);
    expect(scan('const A = () => <X title="Hello there" label={`Save ${n}`} />;').length).toBe(2);
    expect(scan('toast({ title: "Saved", description: "Your changes are safe" });')).toEqual(['Saved', 'Your changes are safe']);
    expect(scan('const A = () => <p>{"Loading channels"}</p>;')).toEqual(['Loading channels']);
  });

  it('lets translated text, brands, numbers and symbols through', () => {
    expect(scan('const A = () => <div>{t("a.b")}</div>;')).toEqual([]);
    expect(scan('const A = () => <div>Plex</div>;')).toEqual([]);
    expect(scan('const A = () => <div>Snow Media Center 4K HDR</div>;')).toEqual([]);
    expect(scan('const A = () => <div>12 : 30 - / &nbsp; •</div>;')).toEqual([]);
    expect(scan('const A = () => <X label={t("a")} title={name} className="flex p-2" />;')).toEqual([]);
    expect(scan('toast({ title: t("a"), description: msg });')).toEqual([]);
  });

  it('honours i18n-ignore on the same or previous line', () => {
    expect(scan('const A = () => <div>{/* i18n-ignore */}\nHello</div>;')).toEqual([]);
    expect(scan('const A = () => <div title="Hi there" /* i18n-ignore */ />;')).toEqual([]);
  });

  it('needsTranslation skips glossary words', () => {
    expect(needsTranslation('DreamStreams')).toBe(false);
    expect(needsTranslation('Plex Overseerr')).toBe(false);
    expect(needsTranslation('Plex library')).toBe(true);
  });
});

describe('Chrome 66 Intl detector', () => {
  it('flags the APIs the old WebView lacks, not comments', () => {
    const src = '// Intl.ListFormat\nnew Intl.RelativeTimeFormat("en"); d.toLocaleString("en", { dateStyle: "short" }); new Intl.DateTimeFormat("en");';
    expect(findForbiddenIntl('x.ts', src).map((f) => f.text)).toEqual(['Intl.RelativeTimeFormat', 'dateStyle']);
  });
});

describe('covered files (src/i18n/guard/covered/*.txt)', () => {
  const files = coveredFiles();

  it('lists at least the core files', () => {
    expect(files).toContain('src/i18n/format.ts');
  });

  it('have no hard-coded user-facing text', () => {
    const findings = files.flatMap((f) => findHardcodedText(f, fs.readFileSync(path.join(ROOT, f), 'utf8')));
    expect(show(findings)).toEqual([]);
  });

  it('use no Intl feature missing on Chrome 66', () => {
    const findings = files.flatMap((f) => findForbiddenIntl(f, fs.readFileSync(path.join(ROOT, f), 'utf8')));
    expect(show(findings)).toEqual([]);
  });
});
