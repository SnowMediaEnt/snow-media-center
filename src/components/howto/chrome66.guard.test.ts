import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

// The oldest WebView is Chrome 66. The picture view must not use what it lacks:
// aspect-ratio, inset, :is(), flex gap above gap-4, clamp() (the view sizes
// with plain %/px), and Intl features added later.
const HERE = __dirname;
const FILES = [
  ...fs
    .readdirSync(HERE)
    .filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.(test|spec)\./.test(f))
    .map((f) => path.join(HERE, f)),
  path.resolve(HERE, '../TutorialArt.tsx'),
];

// Comments may talk about these things; only code counts.
const code = (file: string) =>
  fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const BANNED: [string, RegExp][] = [
  ['aspect-ratio', /aspect-ratio|aspectRatio|\baspect-(?:\[|square|video|auto)/],
  ['inset', /\binset(?:-[a-z0-9[]|\s*:)|['"`]inset['"`]/],
  [':is(', /:is\(/],
  ['flex gap above gap-4', /\bgap(?:-[xy])?-(?:[5-9]|\d{2,}|\[)/],
  ['clamp() (no px fallback)', /\bclamp\(/],
  ['Intl feature Chrome 66 lacks', /Intl\.(?:RelativeTimeFormat|ListFormat|Locale|DisplayNames)|dateStyle|timeStyle/],
];

describe('Chrome 66 guard for the how-to picture view', () => {
  it('scans the view and the schematic', () => {
    const names = FILES.map((f) => path.basename(f));
    for (const n of ['HowtoShot.tsx', 'calloutLayout.ts', 'shotSource.ts', 'RemoteDiagram.tsx', 'RemoteHintChip.tsx', 'TutorialArt.tsx']) {
      expect(names).toContain(n);
    }
  });

  it.each(BANNED)('has no %s', (_name, re) => {
    const hits = FILES.filter((f) => re.test(code(f))).map((f) => path.basename(f));
    expect(hits).toEqual([]);
  });

  it('frames the picture with padding-top, not aspect-ratio', () => {
    expect(code(path.join(HERE, 'HowtoShot.tsx'))).toContain("paddingTop: '56.25%'");
  });
});
