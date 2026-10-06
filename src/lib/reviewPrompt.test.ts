// When "Rate Snow Media Center" asks on its own: 10 hours over 3 days, a
// 7-day + 5-hour snooze after "Not now", 3 asks at most, never after a review
// was sent, never for Kids, demo, a signed-out box or with the flag off, and
// only on a quiet Home.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addForegroundTime, dayKey, foregroundHours, loadReviewState, markReviewAsked, markReviewSubmitted,
  resetForegroundClockForTests, scheduleVerdict, shouldAskForReview, startForegroundClock,
  FOREGROUND_BEAT_MS, REVIEW_MAX_ASKS, type ReviewPromptContext, type ReviewPromptState,
} from './reviewPrompt';

const H = 60 * 60_000;
const D = 24 * H;
const NOW = Date.parse('2026-10-06T18:00:00');

const state = (over: Partial<ReviewPromptState> = {}): ReviewPromptState => ({
  fgMs: 10 * H, days: ['2026-10-01', '2026-10-03', '2026-10-05'], asks: 0, lastAskAt: 0, lastAskFgMs: 0, submitted: false, ...over,
});
const ctx = (over: Partial<ReviewPromptContext> = {}): ReviewPromptContext => ({
  now: NOW, kids: false, demo: false, signedIn: true, flagOn: true, onHome: true,
  sinceStartMs: 60_000, playing: false, dialogOpen: false, idleMs: 30_000, ...over,
});

beforeEach(() => { localStorage.clear(); });

describe('the schedule', () => {
  it('waits for 10 hours of use', () => {
    expect(scheduleVerdict(state({ fgMs: 10 * H - 1 }), NOW)).toBe('tooSoon');
    expect(scheduleVerdict(state({ fgMs: 10 * H }), NOW)).toBe('ask');
  });

  it('waits for 3 different days', () => {
    expect(scheduleVerdict(state({ fgMs: 30 * H, days: ['2026-10-05', '2026-10-06'] }), NOW)).toBe('tooFewDays');
    expect(scheduleVerdict(state({ fgMs: 30 * H, days: ['2026-10-04', '2026-10-05', '2026-10-06'] }), NOW)).toBe('ask');
  });

  it('after "Not now" waits 7 more days AND 5 more hours of use', () => {
    const asked = state({ fgMs: 12 * H, asks: 1, lastAskAt: NOW - 8 * D, lastAskFgMs: 10 * H });
    expect(scheduleVerdict(asked, NOW)).toBe('snoozed'); // 8 days, only 2 more hours
    expect(scheduleVerdict({ ...asked, fgMs: 15 * H }, NOW)).toBe('ask');
    expect(scheduleVerdict({ ...asked, fgMs: 40 * H, lastAskAt: NOW - 6 * D }, NOW)).toBe('snoozed'); // hours, not days
    expect(scheduleVerdict({ ...asked, fgMs: 15 * H, lastAskAt: NOW - 7 * D }, NOW)).toBe('ask');
  });

  it('asks at most 3 times', () => {
    const long = { lastAskAt: NOW - 30 * D, lastAskFgMs: 0, fgMs: 100 * H };
    expect(scheduleVerdict(state({ ...long, asks: 2 }), NOW)).toBe('ask');
    expect(scheduleVerdict(state({ ...long, asks: REVIEW_MAX_ASKS }), NOW)).toBe('maxAsks');
  });

  it('never asks again after a review was sent', () => {
    expect(scheduleVerdict(state({ submitted: true }), NOW)).toBe('submitted');
  });
});

describe('who and where', () => {
  it('asks a grown-up on a quiet Home', () => {
    expect(shouldAskForReview(state(), ctx())).toBe('ask');
  });

  it('never on a Kids profile, in demo, signed out or with the flag off', () => {
    expect(shouldAskForReview(state(), ctx({ kids: true }))).toBe('kids');
    expect(shouldAskForReview(state(), ctx({ demo: true }))).toBe('demo');
    expect(shouldAskForReview(state(), ctx({ signedIn: false }))).toBe('signedOut');
    expect(shouldAskForReview(state(), ctx({ flagOn: false }))).toBe('off');
  });

  it('never during playback, over a dialog, off Home, in the first 20 s, or mid-navigation', () => {
    expect(shouldAskForReview(state(), ctx({ playing: true }))).toBe('playing');
    expect(shouldAskForReview(state(), ctx({ dialogOpen: true }))).toBe('dialog');
    expect(shouldAskForReview(state(), ctx({ onHome: false }))).toBe('notHome');
    expect(shouldAskForReview(state(), ctx({ sinceStartMs: 19_000 }))).toBe('starting');
    expect(shouldAskForReview(state(), ctx({ sinceStartMs: 20_000 }))).toBe('ask');
    expect(shouldAskForReview(state(), ctx({ idleMs: 2000 }))).toBe('busy');
  });

  it('the schedule comes before the screen (no ask at all when not due)', () => {
    expect(shouldAskForReview(state({ fgMs: H }), ctx())).toBe('tooSoon');
  });
});

describe('the stored state', () => {
  it('adds foreground time and counts each day once', () => {
    addForegroundTime(30_000, NOW);
    addForegroundTime(30_000, NOW + 60_000);
    addForegroundTime(30_000, NOW + D);
    const s = loadReviewState();
    expect(s.fgMs).toBe(90_000);
    expect(s.days).toEqual([dayKey(NOW), dayKey(NOW + D)]);
  });

  it('ignores a beat that is really a box asleep', () => {
    addForegroundTime(6 * H, NOW);
    expect(loadReviewState().fgMs).toBe(2 * FOREGROUND_BEAT_MS);
  });

  it('records an ask with the use so far, and a sent review', () => {
    for (let i = 0; i < 20; i += 1) addForegroundTime(FOREGROUND_BEAT_MS, NOW + i * FOREGROUND_BEAT_MS);
    const s = markReviewAsked(NOW);
    expect(s).toMatchObject({ asks: 1, lastAskAt: NOW, lastAskFgMs: 20 * FOREGROUND_BEAT_MS });
    markReviewSubmitted();
    expect(loadReviewState().submitted).toBe(true);
    expect(foregroundHours()).toBe(0.2);
  });

  it('survives bad storage', () => {
    localStorage.setItem('smc_review_prompt', '{not json');
    expect(loadReviewState()).toMatchObject({ fgMs: 0, asks: 0, submitted: false });
  });
});

describe('the foreground clock', () => {
  let stop: () => void = () => {};
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); resetForegroundClockForTests(); });
  afterEach(() => { stop(); vi.useRealTimers(); });

  it('counts while visible and stops while hidden', () => {
    stop = startForegroundClock();
    vi.advanceTimersByTime(5 * FOREGROUND_BEAT_MS);
    expect(loadReviewState().fgMs).toBe(5 * FOREGROUND_BEAT_MS);

    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(10 * FOREGROUND_BEAT_MS);
    expect(loadReviewState().fgMs).toBe(5 * FOREGROUND_BEAT_MS);

    vis.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(2 * FOREGROUND_BEAT_MS);
    expect(loadReviewState().fgMs).toBe(7 * FOREGROUND_BEAT_MS);
    vis.mockRestore();
  });
});
