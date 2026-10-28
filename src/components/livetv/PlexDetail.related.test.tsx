/**
 * "More like this" on the Plex title page, as Plex does it: under the cast,
 * the title's collection (Child's Play 2, 3…) and the other related hubs as
 * their own rows, so the sequel is one ▼ away. OK opens it on the same page
 * and Back comes back to the first title.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ noCast: false, related: vi.fn() }));
vi.mock('./PlexImage', () => ({ default: () => null }));
vi.mock('@/lib/plex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plex')>();
  const titles: Record<string, string> = { '101': "Child's Play", '102': "Child's Play 2", '103': "Child's Play 3", '201': 'Other Doll Film' };
  return {
    ...actual,
    getPlexMetadata: vi.fn(async (_b: string, _t: string, rk: string) => ({
      ratingKey: rk, title: titles[rk] ?? rk, type: 'movie', librarySectionID: '1',
      genres: [], directors: [], cast: h.noCast ? [] : [{ id: '7', tag: 'Brad Actor' }],
    })),
    getPlexRelatedHubs: h.related,
    findPlexCopies: vi.fn(async () => []),
  };
});

import PlexDetail from './PlexDetail';
import { setPlexKeyOwner } from './plexKeyOwner';
import { __resetPlexHoldForTests } from './plexRecommendHold';
import { __resetPlexRecommendForTests } from '@/lib/plexRecommend';
import { mapRelatedHubs, type PlexItem } from '@/lib/plex';

const press = (key: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
const release = (key: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })); });
const focusedText = () => Array.from(document.querySelectorAll('[data-focused="true"]')).map((el) => (el.textContent?.trim() || el.parentElement?.textContent?.trim()));
const title = () => document.querySelector('h1')?.textContent;

const ROWS = [
  { title: "Child's Play Collection", collection: true, items: [
    { ratingKey: '102', title: "Child's Play 2", type: 'movie' },
    { ratingKey: '103', title: "Child's Play 3", type: 'movie' },
  ] },
  { title: 'More with Brad Actor', collection: false, items: [{ ratingKey: '201', title: 'Other Doll Film', type: 'movie' }] },
];

describe('mapRelatedHubs', () => {
  it('keeps each hub as a row with its title, collection first, movies and shows only, the title itself and repeats dropped', () => {
    const rows = mapRelatedHubs([
      { title: 'Similar Movies', hubIdentifier: 'movie.similar', Metadata: [
        { ratingKey: '101', title: "Child's Play", type: 'movie' },
        { ratingKey: '301', title: 'Puppet Film', type: 'movie' },
        { ratingKey: '102', title: "Child's Play 2", type: 'movie' },
      ] },
      { title: 'Empty', hubIdentifier: 'movie.by.actor', Metadata: [{ ratingKey: '9', title: 'A Clip', type: 'clip' }] },
      { title: "Child's Play Collection", hubIdentifier: 'collection.related.55', context: 'hub.movie.collection', Metadata: [
        { ratingKey: '102', title: "Child's Play 2", type: 'movie' },
        { ratingKey: '103', title: "Child's Play 3", type: 'movie' },
      ] },
      { title: 'More with Brad', hubIdentifier: 'movie.by.actor.or.director', Metadata: [
        { ratingKey: '301', title: 'Puppet Film', type: 'movie' },
        { ratingKey: '401', title: 'A Show', type: 'show' },
      ] },
      { title: 'Fourth', hubIdentifier: 'movie.other', Metadata: [{ ratingKey: '501', title: 'X', type: 'movie' }] },
    ], '101');
    expect(rows.map((r) => r.title)).toEqual(["Child's Play Collection", 'Similar Movies', 'More with Brad']);
    expect(rows[0].collection).toBe(true);
    expect(rows[0].items.map((i) => i.ratingKey)).toEqual(['102', '103']);
    expect(rows[1].items.map((i) => i.ratingKey)).toEqual(['301']);
    expect(rows[2].items.map((i) => i.ratingKey)).toEqual(['401']);
  });

  it('caps the titles in a row', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ratingKey: String(1000 + i), title: `T${i}`, type: 'movie' }));
    expect(mapRelatedHubs([{ title: 'Similar', Metadata: many }], '1', 3, 12)[0].items).toHaveLength(12);
  });
});

function renderDetail(item: PlexItem) {
  const onBack = vi.fn();
  render(<PlexDetail isActive base="http://srv:32400" token="tok" item={item} onPlay={vi.fn()} onPlayEpisode={vi.fn()} onBack={onBack} />);
  return onBack;
}

describe('related rows on the title page', () => {
  beforeEach(() => {
    h.noCast = false;
    h.related.mockReset();
    h.related.mockImplementation(async (_b: string, _t: string, rk: string) => (rk === '101' ? ROWS : []));
    setPlexKeyOwner('detail');
    __resetPlexHoldForTests();
    __resetPlexRecommendForTests();
  });

  it('draws the rows under the cast, the collection first, with Plex\'s titles', async () => {
    renderDetail({ ratingKey: '101', title: "Child's Play", type: 'movie' });
    await screen.findByText("Child's Play Collection", undefined, { timeout: 5000 });
    const rows = Array.from(document.querySelectorAll('[data-plex-related-row]'));
    expect(rows.map((r) => r.getAttribute('data-plex-related-row'))).toEqual(['collection', 'related']);
    expect(screen.getByText('More with Brad Actor')).toBeTruthy();
    expect(screen.getByText("Child's Play 3")).toBeTruthy();
    expect(h.related).toHaveBeenCalledWith('http://srv:32400', 'tok', '101');
  });

  it('▼ from the cast into the rows, ◀ ▶ along, ▼ ▲ between, ▲ back to the cast', async () => {
    renderDetail({ ratingKey: '101', title: "Child's Play", type: 'movie' });
    await screen.findByText("Child's Play Collection", undefined, { timeout: 5000 });
    press('ArrowDown');
    expect(focusedText()).toEqual(['Brad Actor']);
    press('ArrowDown');
    expect(focusedText()).toEqual(["Child's Play 2"]);
    press('ArrowRight');
    expect(focusedText()).toEqual(["Child's Play 3"]);
    press('ArrowDown');
    expect(focusedText()).toEqual(['Other Doll Film']);
    press('ArrowDown');
    expect(focusedText()).toEqual(['Other Doll Film']);
    press('ArrowUp');
    press('ArrowUp');
    expect(focusedText()).toEqual(['Brad Actor']);
  });

  it('no cast: ▼ from the buttons goes straight to the rows, ▲ comes back', async () => {
    h.noCast = true;
    renderDetail({ ratingKey: '101', title: "Child's Play", type: 'movie' });
    await screen.findByText("Child's Play Collection", undefined, { timeout: 5000 });
    press('ArrowDown');
    expect(focusedText()).toEqual(["Child's Play 2"]);
    press('ArrowUp');
    expect(focusedText()).toEqual(['Play']);
  });

  it('OK opens the sequel on the same page, and Back returns to the first title', async () => {
    const onBack = renderDetail({ ratingKey: '101', title: "Child's Play", type: 'movie' });
    await screen.findByText("Child's Play Collection", undefined, { timeout: 5000 });
    press('ArrowDown');
    press('ArrowDown');
    press('Enter');
    release('Enter');
    await waitFor(() => expect(title()).toBe("Child's Play 2"), { timeout: 5000 });
    press('Escape');
    await waitFor(() => expect(title()).toBe("Child's Play"), { timeout: 5000 });
    // Its rows come back without asking the server again.
    await screen.findByText("Child's Play Collection", undefined, { timeout: 5000 });
    expect(h.related.mock.calls.filter((c) => c[2] === '101')).toHaveLength(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('a failure is simply no rows', async () => {
    h.related.mockImplementation(async () => { throw new Error('boom'); });
    renderDetail({ ratingKey: '101', title: "Child's Play", type: 'movie' });
    await waitFor(() => expect(h.related).toHaveBeenCalled(), { timeout: 5000 });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(document.querySelector('[data-plex-related-row]')).toBeNull();
    press('ArrowDown');
    press('ArrowDown');
    expect(focusedText()).toEqual(['Brad Actor']);
  });
});
