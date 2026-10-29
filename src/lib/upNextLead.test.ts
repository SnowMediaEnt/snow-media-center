import { describe, expect, it } from 'vitest';
import { upNextLeadSeconds } from './upNextLead';

describe('upNextLeadSeconds', () => {
  it('a minute before the end of a full-length episode', () => {
    expect(upNextLeadSeconds(3600)).toBe(60);
    expect(upNextLeadSeconds(1320)).toBe(60); // a 22-minute sitcom: 66 → 60
  });
  it('5% of a short episode, at least 20 s', () => {
    expect(upNextLeadSeconds(600)).toBe(30);
    expect(upNextLeadSeconds(300)).toBe(20);
    expect(upNextLeadSeconds(0)).toBe(20);
  });
});
