// Moving about in a Plex film: where a conversion's session starts (its
// offset), when a jump in a conversion needs a new session there, telling a
// server that ignored the offset apart, and a burst of presses going out as
// one jump.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONVERT_SEEK_SLACK_SEC, SEEK_BURST_MS, convertSeekPlan, createSeekBurst, offsetTimeline, transcodeOffsetOf,
} from './plexSeek';
import { plexTranscodeUrl } from './plex';

describe('a conversion started part-way', () => {
  it('asks the server to start there, in whole seconds, and reads it back', () => {
    const url = plexTranscodeUrl('https://srv.plex.direct:32400', '42', 'tok', { maxVideoBitrateKbps: 8000, offset: 1834.7 });
    expect(url).toContain('&offset=1834&');
    expect(transcodeOffsetOf(url)).toBe(1834);
  });

  it('from the top: no offset at all', () => {
    const url = plexTranscodeUrl('https://srv.plex.direct:32400', '42', 'tok', { offset: 0 });
    expect(url).not.toContain('offset=');
    expect(transcodeOffsetOf(url)).toBe(0);
    expect(transcodeOffsetOf(plexTranscodeUrl('https://srv.plex.direct:32400', '42', 'tok'))).toBe(0);
  });

  it('a file played as it is has no offset, whatever its address says', () => {
    expect(transcodeOffsetOf('https://srv.plex.direct:32400/library/parts/7/file.mkv?X-Plex-Token=t&offset=99')).toBe(0);
    expect(transcodeOffsetOf(null)).toBe(0);
  });
});

describe('a jump in a conversion (convertSeekPlan)', () => {
  // A session started at 10:00, the player 5 min into it, 20 s loaded ahead.
  const at = { offset: 600, position: 300, bufferedAhead: 20 };

  it('back within what the session has converted: a plain jump', () => {
    expect(convertSeekPlan({ ...at, target: 600 + 290 })).toBe('seek');
    expect(convertSeekPlan({ ...at, target: 600 })).toBe('seek');
  });

  it('forward within what the player has loaded, and a little past it: a plain jump', () => {
    expect(convertSeekPlan({ ...at, target: 600 + 300 + 20 + CONVERT_SEEK_SLACK_SEC })).toBe('seek');
  });

  it('past what the session has converted: a new session there', () => {
    expect(convertSeekPlan({ ...at, target: 600 + 300 + 20 + CONVERT_SEEK_SLACK_SEC + 1 })).toBe('restart');
    expect(convertSeekPlan({ ...at, target: 600 + 300 + 30 * 60 })).toBe('restart');
  });

  it('before where the session started: a new session there', () => {
    expect(convertSeekPlan({ ...at, target: 599 })).toBe('restart');
    expect(convertSeekPlan({ ...at, target: 0 })).toBe('restart');
  });

  it('a player that can say nothing (0, nothing loaded): only the very start of the session is a plain jump', () => {
    expect(convertSeekPlan({ target: 605, offset: 600, position: 0, bufferedAhead: 0 })).toBe('seek');
    expect(convertSeekPlan({ target: 900, offset: 600, position: 0, bufferedAhead: 0 })).toBe('restart');
  });
});

describe("the server's clock for a session started part-way (offsetTimeline)", () => {
  it("the stream is what is left of the title: the session's own clock", () => {
    // A 2 h film started at 30:00: the stream runs 1 h 30.
    expect(offsetTimeline(5400, 1800, 7200)).toBe('stream');
  });

  it('the stream is the whole title: the server ignored the offset', () => {
    expect(offsetTimeline(7199, 1800, 7200)).toBe('title');
  });

  it("can't be told: no length yet, a title of unknown length, a start too close to 0:00", () => {
    expect(offsetTimeline(0, 1800, 7200)).toBe('unknown');
    expect(offsetTimeline(5400, 1800, 0)).toBe('unknown');
    expect(offsetTimeline(7190, 10, 7200)).toBe('unknown');
  });
});

describe('a burst of presses goes out as one jump (createSeekBurst)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('quick presses add up: one jump, to where the last one went, once they stop', () => {
    const run = vi.fn();
    const b = createSeekBurst(run);
    b.push(610);
    vi.advanceTimersByTime(300);
    b.push(620);
    vi.advanceTimersByTime(300);
    b.push(630);
    expect(b.pending()).toBe(630);
    vi.advanceTimersByTime(SEEK_BURST_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(630);
    expect(b.pending()).toBeNull();
  });

  it('presses apart are jumps of their own', () => {
    const run = vi.fn();
    const b = createSeekBurst(run);
    b.push(610);
    vi.advanceTimersByTime(SEEK_BURST_MS);
    b.push(700);
    vi.advanceTimersByTime(SEEK_BURST_MS);
    expect(run.mock.calls.map((c) => c[0])).toEqual([610, 700]);
  });

  it('never before 0:00; a cleared burst sends nothing; a failing jump does not stop the next', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('player gone'));
    const b = createSeekBurst(run);
    b.push(-20);
    vi.advanceTimersByTime(SEEK_BURST_MS);
    expect(run).toHaveBeenLastCalledWith(0);
    await Promise.resolve();
    b.push(50);
    b.clear();
    vi.advanceTimersByTime(SEEK_BURST_MS);
    expect(run).toHaveBeenCalledTimes(1);
    b.push(60);
    vi.advanceTimersByTime(SEEK_BURST_MS);
    expect(run).toHaveBeenLastCalledWith(60);
  });
});
