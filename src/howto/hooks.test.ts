// The How-to guide's DOM hooks (plan-howto.md, section 3): every highlight id
// of the contract is on an element in the app, written as a literal so the
// capture script's check can find it; and the capture flag is off everywhere
// but a developer build's demo with ?howto=1.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOWTO_SHOTS } from '@/data/howtoContract';

const h = vi.hoisted(() => ({ native: false }));
vi.mock('@/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/platform')>()),
  isNativePlatform: () => h.native,
}));

import { isHowtoCapture } from '@/lib/demoMode';

const SRC = resolve(__dirname, '..');
const DIRS = ['pages', 'components', 'howto'];

const sources = (): string => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(readFileSync(p, 'utf8'));
    }
  };
  for (const d of DIRS) walk(join(SRC, d));
  return out.join('\n');
};

describe('How-to DOM hooks', () => {
  const all = sources();
  const ids = [...new Set(Object.values(HOWTO_SHOTS).flat())];

  it.each(ids)('%s is in the app as a quoted literal', (id) => {
    expect(all.includes(`'${id}'`) || all.includes(`"${id}"`)).toBe(true);
  });
});

describe('isHowtoCapture', () => {
  beforeEach(() => {
    h.native = false;
    sessionStorage.setItem('smc-demo', '1');
    sessionStorage.setItem('smc-howto', '1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    sessionStorage.clear();
  });

  it('is on in a developer build, in the demo, with the howto latch', () => {
    expect(isHowtoCapture()).toBe(true);
  });

  it('is off without the howto latch', () => {
    sessionStorage.removeItem('smc-howto');
    expect(isHowtoCapture()).toBe(false);
  });

  it('is off outside the demo', () => {
    sessionStorage.removeItem('smc-demo');
    expect(isHowtoCapture()).toBe(false);
  });

  it('is off on a box (native)', () => {
    h.native = true;
    expect(isHowtoCapture()).toBe(false);
  });

  it('is off in a production build (DEV false)', () => {
    vi.stubEnv('DEV', false);
    expect(isHowtoCapture()).toBe(false);
  });
});
