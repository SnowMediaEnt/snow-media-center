/**
 * "did we add the trailer option to VOD and Plex … with the fix to play in
 * SMC instead of going out" (owner, 2026-10-11). A film's or a show's page
 * offers Trailer when the server has a trailer for it (one of its extras),
 * on its own line under the buttons as in Movies: ▼ from any button, ▲ back
 * to that button, OK plays it. A title without extras asks for nothing; a
 * Kids profile never sees Trailer and asks for nothing either.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./PlexImage', () => ({ default: () => null }));
vi.mock('@/lib/plex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plex')>();
  return {
    ...actual,
    getPlexMetadata: vi.fn(async (_b: string, _t: string, rk: string) => ({
      ratingKey: rk,
      title: rk === '201' ? 'The Show' : 'The Film',
      type: rk === '201' ? 'show' : rk === '401' ? 'episode' : 'movie',
      genres: [], cast: [], directors: [],
      partKey: '/library/parts/1/file.mkv',
      // 301 has no extras: Plex names no primary extra for it.
      primaryExtraKey: rk === '301' ? undefined : '/library/metadata/901',
    })),
    findPlexCopies: vi.fn(async () => []),
  };
});

import PlexDetail from './PlexDetail';
import { setPlexKeyOwner } from './plexKeyOwner';
import { clearPlexCaches, type PlexItem, type PlexTrailer } from '@/lib/plex';
import { setKidsLevel } from '@/lib/kidsFilter';

const BASE = 'http://srv:32400';
const TRAILER_PART = '/library/parts/901/1700000000/trailer.mp4';
const press = (key: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
const focusedText = () => Array.from(document.querySelectorAll('[data-focused="true"]')).map((el) => el.textContent?.trim());

let extrasAsked: string[] = [];
beforeEach(() => {
  setPlexKeyOwner('detail');
  setKidsLevel(null);
  clearPlexCaches();
  localStorage.clear();
  extrasAsked = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/extras')) {
      extrasAsked.push(path);
      return new Response(JSON.stringify({ MediaContainer: { Metadata: [
        { ratingKey: '900', type: 'clip', extraType: 5, subtype: 'behindTheScenes', Media: [{ Part: [{ key: '/library/parts/900/1/bts.mp4' }] }] },
        { ratingKey: '901', key: '/library/metadata/901', type: 'clip', extraType: 1, subtype: 'trailer', title: 'Official Trailer', Media: [{ videoResolution: '1080', Part: [{ key: TRAILER_PART }] }] },
      ] } }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); setKidsLevel(null); });

/** The page has its metadata and its cast row (the cast mounts after the
 *  trailer is asked for), and a moment more for an answer to land. */
const settled = async () => {
  await screen.findByText('No cast info.', undefined, { timeout: 5000 });
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
};

function renderDetail(item: PlexItem, withTrailer = true) {
  const onPlay = vi.fn();
  const onPlayTrailer = vi.fn();
  render(<PlexDetail isActive base={BASE} token="tok" item={item} onPlay={onPlay} onPlayEpisode={vi.fn()} onBack={vi.fn()}
    onPlayTrailer={withTrailer ? onPlayTrailer : undefined} />);
  return { onPlay, onPlayTrailer };
}

describe('Trailer on the Plex title page', () => {
  it("a film with a trailer: ▼ from a button to Trailer, OK plays it, ▲ back to that button", async () => {
    const { onPlay, onPlayTrailer } = renderDetail({ ratingKey: '101', title: 'The Film', type: 'movie' });
    await waitFor(() => expect(screen.getByText('Trailer')).toBeTruthy(), { timeout: 5000 });
    expect(extrasAsked).toEqual(['/library/metadata/101/extras']);
    expect(document.querySelector('[data-plex-trailer]')?.getAttribute('data-plex-trailer')).toBe('library');
    expect(screen.getByLabelText('Watch trailer')).toBeTruthy();
    // Play, My List; ▶ to My List, ▼ to Trailer, ▲ back to My List.
    expect(focusedText()).toEqual(['Play']);
    press('ArrowRight');
    press('ArrowDown');
    expect(focusedText()).toEqual(['Trailer']);
    press('ArrowUp');
    expect(focusedText()).toEqual(['My List']);
    press('ArrowLeft');
    press('ArrowDown');
    press('Enter');
    expect(onPlayTrailer).toHaveBeenCalledTimes(1);
    const [trailer, title] = onPlayTrailer.mock.calls[0] as [PlexTrailer, string];
    expect(title).toBe('The Film');
    expect(trailer).toMatchObject({ ratingKey: '901', partKey: TRAILER_PART, online: false });
    // Playing the trailer is not playing the film.
    expect(onPlay).not.toHaveBeenCalled();
    // A held OK does not play it twice.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true })); });
    expect(onPlayTrailer).toHaveBeenCalledTimes(1);
  });

  it("a show's page offers its trailer too", async () => {
    renderDetail({ ratingKey: '201', title: 'The Show', type: 'show' });
    await waitFor(() => expect(screen.getByText('Trailer')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByText('Browse Episodes')).toBeTruthy();
  });

  it('a title without extras shows no Trailer and asks for nothing', async () => {
    renderDetail({ ratingKey: '301', title: 'The Film', type: 'movie' });
    await settled();
    expect(screen.queryByText('Trailer')).toBeNull();
    expect(extrasAsked).toEqual([]);
    // ▼ goes nowhere new: no Trailer line to land on.
    press('ArrowDown');
    expect(focusedText()).toEqual(['Play']);
  });

  it('a Kids profile never sees Trailer, and nothing is asked', async () => {
    setKidsLevel('kids');
    renderDetail({ ratingKey: '101', title: 'The Film', type: 'movie' });
    await settled();
    expect(screen.queryByText('Trailer')).toBeNull();
    expect(extrasAsked).toEqual([]);
  });

  it('no Trailer when the page is given no way to play one', async () => {
    renderDetail({ ratingKey: '101', title: 'The Film', type: 'movie' }, false);
    await settled();
    expect(screen.queryByText('Trailer')).toBeNull();
    expect(extrasAsked).toEqual([]);
  });

  it('an episode asks for no trailer', async () => {
    renderDetail({ ratingKey: '401', title: 'Pilot', type: 'episode' });
    await settled();
    expect(screen.queryByText('Trailer')).toBeNull();
    expect(extrasAsked).toEqual([]);
  });
});
