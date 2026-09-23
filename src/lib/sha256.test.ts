import { expect, it } from 'vitest';
import { createHash } from 'crypto';
import { sha256Hex } from './sha256';
it('matches node', () => {
  for (const s of ['', 'abc', 'smc-pin:x:main:1234', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'é漢字🎉'.repeat(20)]) {
    expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});
