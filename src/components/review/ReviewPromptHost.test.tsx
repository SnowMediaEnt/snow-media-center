// The prompt on Home: it asks once the schedule is due and Home is quiet, and
// waits (or never asks) otherwise.
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: null } }),
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
const events = vi.hoisted(() => [] as Array<{ name: string; props?: Record<string, unknown> }>);
vi.mock('@/lib/analytics', () => ({
  trackEvent: (name: string, _cat?: string, props?: Record<string, unknown>) => { events.push({ name, props }); },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
const plex = vi.hoisted(() => ({ playing: false }));
vi.mock('@/lib/plex', () => ({ isPlexPlaybackActive: () => plex.playing }));

import ReviewPromptHost from './ReviewPromptHost';
import { loadReviewState, resetForegroundClockForTests, startForegroundClock } from '@/lib/reviewPrompt';

const H = 60 * 60_000;
const due = () => localStorage.setItem('smc_review_prompt', JSON.stringify({
  fgMs: 11 * H, days: ['2026-10-01', '2026-10-02', '2026-10-03'], asks: 0, lastAskAt: 0, lastAskFgMs: 0, submitted: false,
}));
const TITLE = 'Enjoying Snow Media Center?';
let stopClock: () => void = () => {};

// The dialog is lazy-loaded; load it up front so fake timers don't race the import.
beforeAll(async () => { await import('./ReviewDialog'); });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  events.length = 0;
  plex.playing = false;
  document.documentElement.className = '';
  resetForegroundClockForTests();
  stopClock = startForegroundClock();
  due();
});
afterEach(() => { stopClock(); vi.useRealTimers(); });

const wait = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const props = { kids: false, signedIn: true, flagOn: true };

describe('ReviewPromptHost', () => {
  it('asks once due, after the start-up quiet time, and records the ask', async () => {
    render(<ReviewPromptHost {...props} />);
    await wait(15_000);
    expect(screen.queryByText(TITLE)).toBeNull();
    await wait(10_000);
    await wait(100);
    expect(screen.getByText(TITLE)).toBeTruthy();
    expect(loadReviewState().asks).toBe(1);
    expect(events[0]).toMatchObject({ name: 'review_prompt_shown', props: { source: 'prompt', ask: 1 } });
  });

  it('waits while something plays, then asks', async () => {
    plex.playing = true;
    render(<ReviewPromptHost {...props} />);
    await wait(40_000);
    expect(screen.queryByText(TITLE)).toBeNull();
    plex.playing = false;
    document.documentElement.classList.add('snowplayer-fullscreen');
    await wait(10_000);
    expect(screen.queryByText(TITLE)).toBeNull();
    document.documentElement.classList.remove('snowplayer-fullscreen');
    await wait(6_000);
    expect(screen.getByText(TITLE)).toBeTruthy();
  });

  it('waits behind another dialog and while the remote is in use', async () => {
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    other.setAttribute('aria-modal', 'true');
    document.body.appendChild(other);
    render(<ReviewPromptHost {...props} />);
    await wait(40_000);
    expect(screen.queryByText(TITLE)).toBeNull();
    other.remove();
    // Keys every few seconds: the viewer is busy.
    for (let i = 0; i < 6; i += 1) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      await wait(3000);
    }
    expect(screen.queryByText(TITLE)).toBeNull();
    await wait(12_000);
    expect(screen.getByText(TITLE)).toBeTruthy();
  });

  it('never asks a Kids profile, a signed-out box, with the flag off, or while Home is busy', async () => {
    const r = render(<ReviewPromptHost {...props} kids />);
    await wait(60_000);
    r.rerender(<ReviewPromptHost {...props} signedIn={false} />);
    await wait(60_000);
    r.rerender(<ReviewPromptHost {...props} flagOn={false} />);
    await wait(60_000);
    r.rerender(<ReviewPromptHost {...props} busy />);
    await wait(60_000);
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(loadReviewState().asks).toBe(0);
  });

  it('never asks again after a review was sent', async () => {
    localStorage.setItem('smc_review_prompt', JSON.stringify({ ...loadReviewState(), submitted: true }));
    render(<ReviewPromptHost {...props} />);
    await wait(120_000);
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});
