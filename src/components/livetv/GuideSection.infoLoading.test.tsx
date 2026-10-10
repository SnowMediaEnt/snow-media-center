/**
 * The Guide's info panel (the preview strip above the grid) while the
 * highlighted channel's listings are still on their way: the row showed its
 * "EPG…" loader while the panel above it already said "No programme
 * information". Now the panel shows a quiet "Loading…" until the answer is
 * in, and "No programme information" only after an empty answer.
 */
import { act, configure, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamLiveStream } from '@/lib/xtream';

configure({ asyncUtilTimeout: 4000 });

const line = { host: 'http://h', username: 'u', password: 'p' };
const api = vi.hoisted(() => ({
  streams: [] as XtreamLiveStream[],
  answers: new Map<number, (v: { epg_listings: unknown[] }) => void>(),
}));
const now = () => Math.floor(Date.now() / 1000);

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }],
  getLiveStreams: async () => api.streams,
  // Each channel's answer waits until the test gives it.
  getShortEpg: (_c: unknown, streamId: number) => new Promise((res) => { api.answers.set(streamId, res); }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => false }));
vi.mock('@/hooks/useNativePlayer', () => ({ useNativePlayer: () => ({ buffering: false, error: null, retry: () => {} }) }));
vi.mock('./BufferingDiagnostics', () => ({ default: () => null }));
vi.mock('./VideoPlayer', () => ({ default: () => <div data-testid="video" /> }));
// jsdom has no layout: every row is "on screen".
vi.mock('@tanstack/react-virtual', async () => {
  const { useMemo } = await import('react');
  return {
    useVirtualizer: ({ count, estimateSize, getItemKey }: { count: number; estimateSize: (i: number) => number; getItemKey?: (i: number) => number | string }) => {
      const items = useMemo(
        () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey ? getItemKey(index) : index, start: index * estimateSize(index), size: estimateSize(index) })),
        [count, estimateSize, getItemKey],
      );
      return { getVirtualItems: () => items, getTotalSize: () => count * estimateSize(0), measure: () => {} };
    },
  };
});

import Guide from './GuideSection';

const panel = () => document.querySelector('[data-guide-preview]')?.textContent ?? '';
const answer = async (id: number, listings: unknown[]) => {
  await waitFor(() => expect(api.answers.has(id)).toBe(true));
  await act(async () => { api.answers.get(id)!({ epg_listings: listings }); });
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  api.streams = [
    { stream_id: 301, name: 'News Channel', category_id: '1' },
    { stream_id: 302, name: 'World Desk', category_id: '1' },
  ];
  api.answers = new Map();
});
afterEach(() => { sessionStorage.clear(); });

describe('Guide info panel while the listings load', () => {
  it('shows "Loading…", not "No programme information", until the channel\'s answer is in', async () => {
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} />);
    await waitFor(() => expect(panel()).toContain('News Channel'));
    // The request is out and has not come back.
    await waitFor(() => expect(api.answers.has(301)).toBe(true));
    expect(screen.getAllByText('EPG…').length).toBeGreaterThan(0);
    expect(panel()).toContain('Loading…');
    expect(panel()).not.toContain('No programme information');
  });

  it('an empty answer: then "No programme information"', async () => {
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} />);
    await waitFor(() => expect(panel()).toContain('News Channel'));
    await answer(301, []);
    await waitFor(() => expect(panel()).toContain('No programme information'));
    expect(panel()).not.toContain('Loading…');
  });

  it('an answer with a programme on now: its title', async () => {
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} />);
    await waitFor(() => expect(panel()).toContain('News Channel'));
    await answer(301, [{ title: btoa('Morning Bulletin'), start: '', end: '', start_timestamp: String(now() - 600), stop_timestamp: String(now() + 3000) }]);
    await waitFor(() => expect(panel()).toContain('Now: Morning Bulletin'));
    expect(panel()).not.toContain('Loading…');
    expect(panel()).not.toContain('No programme information');
  });
});
