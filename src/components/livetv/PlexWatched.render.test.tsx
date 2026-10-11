// The watched checks as the viewer sees them (owner, 2026-10-10: "all movies
// and episodes watched gets a check mark and then entire seasons as well"):
// a gold check on a watched film's poster with the resolution chip moved
// under it, on a show's poster once every episode is watched, on a season
// whose every episode is, and on each watched episode in the list.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlexEpisode, PlexItem, PlexSeason } from '@/lib/plex';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
  },
}));
vi.mock('./PlexImage', () => ({ default: () => null }));

const SEASONS: PlexSeason[] = [
  { ratingKey: 'sea1', title: 'Season 1', index: 1, leafCount: 2 },
  { ratingKey: 'sea2', title: 'Season 2', index: 2, leafCount: 2 },
];
const EPISODES: Record<string, PlexEpisode[]> = {
  sea1: [{ ratingKey: 'e11', title: 'Pilot', index: 1 }, { ratingKey: 'e12', title: 'The Letter', index: 2 }],
  sea2: [{ ratingKey: 'e21', title: 'Return', index: 1 }, { ratingKey: 'e22', title: 'Harbor', index: 2 }],
};
vi.mock('@/lib/plex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plex')>();
  return {
    ...actual,
    getPlexMetadata: vi.fn(async (_b: string, _t: string, rk: string) => ({
      ratingKey: rk, title: rk === 'show1' ? 'Harbor Lights' : 'The Film', type: rk === 'show1' ? 'show' : 'movie',
      genres: [], cast: [], directors: [], leafCount: rk === 'show1' ? 4 : undefined,
    })),
    getPlexSeasons: vi.fn(async () => SEASONS),
    getPlexEpisodes: vi.fn(async (_b: string, _t: string, seasonKey: string) => EPISODES[seasonKey] ?? []),
    findPlexCopies: vi.fn(async () => []),
  };
});

import PlexPosterTile from './PlexPosterTile';
import PlexDetail from './PlexDetail';
import { setPlexKeyOwner } from './plexKeyOwner';
import * as progress from '@/lib/plexProgress';

const tick = () => new Promise((r) => setTimeout(r, 0));
/** Played into its credits and closed. */
const finish = async (ratingKey: string, extra: Partial<progress.PlexProgress> = {}) => {
  progress.saveProgress({ ratingKey, kind: 'movie', title: ratingKey, at: 1790, dur: 1800, ...extra }, true);
  await tick();
};
const press = (key: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });

beforeEach(() => {
  localStorage.clear();
  progress.__resetPlexProgressForTests('device');
});

describe('a Plex poster', () => {
  const film: PlexItem = { ratingKey: 'f1', title: 'The Film', type: 'movie', videoResolution: '4k' };

  it('a watched film: the gold check in the corner, the 4K chip under it', async () => {
    await finish('f1');
    const watched = progress.plexItemWatched(film);
    expect(watched).toBe(true);
    const { container } = render(<PlexPosterTile item={film} base="http://pms" token="t" focused={false} watched={watched} />);
    expect(screen.getByRole('img', { name: 'Watched' })).toBeTruthy();
    expect(container.querySelector('.plex-watched svg')).toBeTruthy();
    expect(screen.getByText('4K').className).toContain('plex-badge--under');
  });

  it('not watched: no check, the chip in its corner', () => {
    render(<PlexPosterTile item={film} base="http://pms" token="t" focused={false} watched={progress.plexItemWatched(film)} />);
    expect(screen.queryByRole('img', { name: 'Watched' })).toBeNull();
    expect(screen.getByText('4K').className).not.toContain('plex-badge--under');
  });

  it('a show: checked once every episode is watched', async () => {
    const show: PlexItem = { ratingKey: 'show1', title: 'Harbor Lights', type: 'show', leafCount: 2 };
    await finish('e11', { kind: 'episode', showKey: 'show1', season: 1, index: 1 });
    expect(progress.plexItemWatched(show)).toBe(false);
    await finish('e12', { kind: 'episode', showKey: 'show1', season: 1, index: 2 });
    render(<PlexPosterTile item={show} base="http://pms" token="t" focused={false} watched={progress.plexItemWatched(show)} />);
    expect(screen.getByRole('img', { name: 'Every episode watched' })).toBeTruthy();
  });
});

describe('a show\'s page', () => {
  beforeEach(() => { setPlexKeyOwner('detail'); });

  it('checks the season watched to the end and each watched episode', async () => {
    // All of season 1, one episode of season 2.
    await finish('e11', { kind: 'episode', showKey: 'show1', season: 1, index: 1 });
    await finish('e12', { kind: 'episode', showKey: 'show1', season: 1, index: 2 });
    await finish('e21', { kind: 'episode', showKey: 'show1', season: 2, index: 1 });
    const show: PlexItem = { ratingKey: 'show1', title: 'Harbor Lights', type: 'show', leafCount: 4 };
    const { container } = render(<PlexDetail isActive base="http://pms" token="t" item={show} onPlay={vi.fn()} onPlayEpisode={vi.fn()} onBack={vi.fn()} />);
    // Not every episode of the show: no check on its poster.
    await waitFor(() => expect(screen.getByText('Browse Episodes')).toBeTruthy(), { timeout: 5000 });
    expect(container.querySelector('[data-watched]')).toBeNull();

    press('Enter');
    await waitFor(() => expect(screen.getByText('Season 2')).toBeTruthy(), { timeout: 5000 });
    const tile = (name: string) => screen.getByText(name).closest('.plex-tile') as HTMLElement;
    expect(within(tile('Season 1')).getByRole('img', { name: 'Every episode watched' })).toBeTruthy();
    expect(within(tile('Season 2')).queryByRole('img')).toBeNull();

    // Season 2's episodes: the first watched, the second not.
    press('ArrowRight');
    press('Enter');
    await waitFor(() => expect(screen.getByText('1. Return')).toBeTruthy(), { timeout: 5000 });
    const row = (name: string) => screen.getByText(name).closest('[data-focused]') as HTMLElement;
    expect(within(row('1. Return')).getByRole('img', { name: 'Watched' })).toBeTruthy();
    expect(within(row('2. Harbor')).queryByRole('img')).toBeNull();

    // The last one watched: the season and the show are checked.
    await act(async () => { await finish('e22', { kind: 'episode', showKey: 'show1', season: 2, index: 2 }); await tick(); });
    await waitFor(() => expect(within(row('2. Harbor')).getByRole('img', { name: 'Watched' })).toBeTruthy());
    press('Escape');
    await waitFor(() => expect(within(tile('Season 2')).getByRole('img', { name: 'Every episode watched' })).toBeTruthy());
    press('Escape');
    await waitFor(() => expect(screen.getByRole('img', { name: 'Every episode watched' })).toBeTruthy());
  }, 20_000);
});
