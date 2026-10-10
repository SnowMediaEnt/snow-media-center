// Long channel names: a step smaller on up to two lines past a place's
// one-line length, never a scroll (owner, 2026-10-09).
import { describe, expect, it } from 'vitest';
import { TWO_LINES, isLongName, nameClasses } from './channelName';

describe('channelName', () => {
  const event = 'EVENT 03: Rivertown Hawks vs Lakeside Owls 7:30 PM ET';

  it('a name past the length is long; a short one, an empty one or none is not', () => {
    expect(isLongName(event, 18)).toBe(true);
    expect(isLongName('News One', 18)).toBe(false);
    expect(isLongName('x'.repeat(18), 18)).toBe(false);
    expect(isLongName('x'.repeat(19), 18)).toBe(true);
    expect(isLongName('', 18)).toBe(false);
    expect(isLongName(undefined, 18)).toBe(false);
    expect(isLongName(null, 18)).toBe(false);
  });

  it('a long name takes the smaller size, a short one its usual size; both up to two lines, "…" only past them', () => {
    expect(nameClasses(event, 18, 'text-sm', 'text-xs')).toBe(`text-xs ${TWO_LINES}`);
    expect(nameClasses('News One', 18, 'text-sm', 'text-xs')).toBe(`text-sm ${TWO_LINES}`);
    expect(TWO_LINES).toContain('line-clamp-2');
    expect(TWO_LINES).toContain('break-words');
    expect(TWO_LINES).not.toContain('truncate');
  });
});
