import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setKidsLevel } from '@/lib/kidsFilter';
import type { OriginalsPlayerProps, SnowOriginalRow } from '@/lib/snowOriginals';

// The server: answers `db.answer`, counts the queries.
const db = vi.hoisted(() => ({
  queries: 0,
  answer: { data: [] as unknown[] | null, error: null as null | { message: string } },
}));
vi.mock('@/integrations/supabase/client', () => {
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ['select', 'eq', 'order']) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(db.answer);
  return {
    supabase: {
      from: () => { db.queries++; return chain; },
      storage: { from: (b: string) => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.test/${b}/${p}` } }) }) },
    },
  };
});
const flags = vi.hoisted(() => ({ demo: false }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => flags.demo, demoDialogMsg: () => 'This is the demo.' }));
// The idle fetch runs at once.
vi.mock('@/utils/idle', () => ({ runWhenIdle: (fn: () => void) => { fn(); return () => undefined; } }));
// The player is item C's: a stand-in that shows what it was given and closes on a button.
const player = vi.hoisted(() => ({ props: null as null | OriginalsPlayerProps }));
vi.mock('./OriginalsPlayer', () => ({
  default: (p: OriginalsPlayerProps) => {
    player.props = p;
    return <button type="button" onClick={() => p.onClose(p.items[p.items.length - 1].id)}>player:{p.startId}</button>;
  },
}));

import OriginalsSection from './OriginalsSection';

const DAY = 24 * 60 * 60_000;
const row = (id: string, over: Partial<SnowOriginalRow> = {}): SnowOriginalRow => ({
  id, title: `Title ${id}`, description: `About ${id}`, video_path: `${id}/v-aaaa1111.mp4`, poster_path: `${id}/p-aaaa1111.jpg`,
  backdrop_path: `${id}/b-aaaa1111.jpg`, duration_sec: 65, width: 1920, height: 1080, orientation: 'landscape',
  kid_friendly: false, published: true, published_at: new Date(Date.now() - 30 * DAY).toISOString(), sort: 0,
  created_at: new Date(Date.now() - 30 * DAY).toISOString(), ...over,
});
/** Six videos: a, b, c, d on the first row, e, f on the second. b is upright and new, e is kid-friendly. */
const SIX = [
  row('a'),
  row('b', { width: 720, height: 1280, orientation: 'portrait', published_at: new Date(Date.now() - DAY).toISOString() }),
  row('c'), row('d'),
  row('e', { kid_friendly: true }),
  row('f'),
];

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const focusedTitle = () => document.querySelector('[data-focus-key] [data-focused="true"]')?.parentElement?.textContent ?? null;

async function mount(props: Partial<{ isActive: boolean }> = {}) {
  const onExitLeft = vi.fn();
  const onExitUp = vi.fn();
  const view = render(<OriginalsSection isActive={props.isActive ?? true} onExitLeft={onExitLeft} onExitUp={onExitUp} />);
  await settle();
  return { onExitLeft, onExitUp, view };
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  db.queries = 0; db.answer = { data: SIX, error: null };
  flags.demo = false; player.props = null;
  delete (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt;
});
afterEach(() => { setKidsLevel(null); });

describe('Snow Originals: the grid', () => {
  it('shows every video with its title, the focused one in the strip, and the New chip on a recent one', async () => {
    await mount();
    for (const id of 'abcdef') expect(screen.getAllByText(`Title ${id}`).length).toBeGreaterThan(0);
    expect(screen.getByTestId('originals-strip').textContent).toContain('Title a');
    expect(screen.getByTestId('originals-strip').textContent).toContain('1:05');
    // Only b is new, and the strip shows the chip once b is focused.
    expect(screen.getAllByText('New')).toHaveLength(1);
    key('ArrowRight');
    expect(screen.getByTestId('originals-strip').textContent).toContain('Title b');
    expect(screen.getAllByText('New')).toHaveLength(2);
    // The upright one is labelled for screen readers.
    expect(screen.getByText('Upright video')).toBeTruthy();
  });

  it('moves in four columns; Left at column 0 and Back go to the menu, Up on the top row to the header', async () => {
    const { onExitLeft, onExitUp } = await mount();
    key('ArrowRight'); key('ArrowRight'); key('ArrowRight'); key('ArrowRight'); // stops at d
    expect(focusedTitle()).toContain('Title d');
    key('ArrowDown'); // into the shorter last row: its last tile
    expect(focusedTitle()).toContain('Title f');
    key('ArrowLeft');
    expect(focusedTitle()).toContain('Title e');
    key('ArrowLeft');
    expect(onExitLeft).toHaveBeenCalledTimes(1);
    key('ArrowUp');
    expect(focusedTitle()).toContain('Title a');
    key('ArrowUp');
    expect(onExitUp).toHaveBeenCalledTimes(1);
    key('Escape');
    expect(onExitLeft).toHaveBeenCalledTimes(2);
    expect((window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt).toBeTruthy();
  });

  it('does nothing while another pane has the remote', async () => {
    const { onExitLeft } = await mount({ isActive: false });
    key('ArrowLeft'); key('Escape');
    expect(onExitLeft).not.toHaveBeenCalled();
  });
});

describe('Snow Originals: playing', () => {
  it('OK opens the player with the visible list; closing it puts the focus on the last video played', async () => {
    const { onExitLeft } = await mount();
    key('ArrowRight');
    key('Enter');
    await settle();
    expect(screen.getByText('player:b')).toBeTruthy();
    expect(player.props!.items.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    // The grid steps aside while the player is open.
    key('ArrowLeft'); key('Escape');
    expect(onExitLeft).not.toHaveBeenCalled();
    // The stand-in closes on f.
    fireEvent.click(screen.getByText('player:b'));
    await settle();
    expect(screen.queryByText('player:b')).toBeNull();
    expect(focusedTitle()).toContain('Title f');
  });
});

describe('Snow Originals: Kids profiles', () => {
  it.each(['little', 'kids'] as const)('%s: only the kid-friendly videos, and the player gets only those', async (level) => {
    setKidsLevel(level);
    await mount();
    expect(screen.queryByText('Title a')).toBeNull();
    expect(screen.getAllByText('Title e').length).toBeGreaterThan(0);
    key('Enter');
    await settle();
    expect(player.props!.items.map((o) => o.id)).toEqual(['e']);
  });

  it('teen: every video', async () => {
    setKidsLevel('teen');
    await mount();
    expect(screen.getAllByText('Title a').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-focus-key]')).toHaveLength(6);
  });

  it('a Kids profile with no kid-friendly videos is told so', async () => {
    setKidsLevel('kids');
    db.answer = { data: [row('a'), row('c')], error: null };
    await mount();
    expect(screen.getByText('No kid-friendly videos yet.')).toBeTruthy();
  });
});

describe('Snow Originals: loading and the saved list', () => {
  it('no videos at all', async () => {
    db.answer = { data: [], error: null };
    await mount();
    expect(screen.getByText('No videos yet. Check back soon.')).toBeTruthy();
  });

  it('a fresh saved list is shown without asking the server', async () => {
    localStorage.setItem('smc-originals-v1', JSON.stringify({ at: Date.now() - 10_000, rows: [row('z')] }));
    await mount();
    expect(db.queries).toBe(0);
    expect(screen.getAllByText('Title z').length).toBeGreaterThan(0);
  });

  it('a stale saved list is shown at once, then replaced by the server answer and saved', async () => {
    localStorage.setItem('smc-originals-v1', JSON.stringify({ at: Date.now() - 5 * 60_000, rows: [row('z')] }));
    await mount();
    expect(db.queries).toBe(1);
    expect(screen.queryByText('Title z')).toBeNull();
    expect(JSON.parse(localStorage.getItem('smc-originals-v1')!).rows).toHaveLength(6);
  });

  it('the server out of reach: the saved list with the offline banner', async () => {
    localStorage.setItem('smc-originals-v1', JSON.stringify({ at: Date.now() - 5 * 60_000, rows: [row('z')] }));
    db.answer = { data: null, error: { message: 'Failed to fetch' } };
    await mount();
    expect(screen.getAllByText('Title z').length).toBeGreaterThan(0);
    expect(screen.getByText("You're offline. This is the last list we had.")).toBeTruthy();
  });

  it('the server out of reach and nothing saved: the load error, and OK asks again', async () => {
    db.answer = { data: null, error: { message: 'Failed to fetch' } };
    await mount();
    expect(screen.getByText("Couldn't load Snow Originals. Try again in a moment.")).toBeTruthy();
    db.answer = { data: SIX, error: null };
    key('Enter');
    await settle();
    expect(db.queries).toBe(2);
    expect(screen.getAllByText('Title a').length).toBeGreaterThan(0);
  });
});

describe('Snow Originals: demo', () => {
  it('shows the made-up videos without asking the server; OK shows the demo note, never the player', async () => {
    flags.demo = true;
    await mount();
    expect(db.queries).toBe(0);
    expect(document.querySelectorAll('[data-focus-key]')).toHaveLength(6);
    // Two new tiles, and the first (focused) one's chip in the strip too.
    expect(screen.getAllByText('New')).toHaveLength(3);
    key('Enter');
    await settle();
    expect(screen.getByText('This is the demo.')).toBeTruthy();
    expect(player.props).toBeNull();
    // Back closes the note only.
    key('Escape');
    expect(screen.queryByText('This is the demo.')).toBeNull();
  });
});
