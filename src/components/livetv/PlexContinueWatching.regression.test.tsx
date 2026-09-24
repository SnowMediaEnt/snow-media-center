// Continue Watching went empty on every box: the player's progress was never
// saved. PlexSection wires EpisodeAutoplay's onInfo into PlexProgressReporter
// (what is playing), and the reporter saves nothing until it knows — but
// EpisodeAutoplay never called onInfo. This mounts the two as PlexSection
// does, with the real progress store, and checks the row fills.
import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlexPlayInfo } from '@/lib/plex';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
  },
}));

// What a Plex server answers for an episode part-way through a season.
const episode: PlexPlayInfo = {
  ratingKey: '48213', kind: 'episode', title: 'The Long Night', librarySectionID: '2',
  index: 3, seasonIndex: 2, seasonKey: '48210', showKey: '48200', showTitle: 'Frontier', showThumb: '/library/metadata/48200/thumb/1',
  duration: 2940, markers: [],
};
const film: PlexPlayInfo = { ratingKey: '9001', kind: 'movie', title: 'Harbor Lights', librarySectionID: '1', duration: 6720, markers: [] };
const byKey: Record<string, PlexPlayInfo> = { [episode.ratingKey]: episode, [film.ratingKey]: film };

vi.mock('@/lib/plex', () => ({
  getPlexPlayInfo: vi.fn(async (_b: string, _t: string, key: string) => byKey[key] ?? null),
  getNextPlexEpisode: vi.fn(async () => null),
  reportPlexTimeline: vi.fn(async () => undefined),
}));

let position = 0;
const getPosition = async () => ({ position, duration: 0, playing: true });
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  const p = await import('@/lib/plexProgress');
  p.__resetPlexProgressForTests('device');
});
afterEach(() => { vi.useRealTimers(); });

async function player() {
  const { default: EpisodeAutoplay } = await import('./EpisodeAutoplay');
  const { default: PlexProgressReporter } = await import('./PlexProgressReporter');
  // As PlexSection renders them (playInfo state, the same ratingKey to both).
  const Harness = ({ ratingKey }: { ratingKey: string | null }) => {
    const [info, setInfo] = useState<PlexPlayInfo | null>(null);
    return (
      <>
        <PlexProgressReporter active ratingKey={ratingKey} info={info} getPosition={async () => ({ ...(await getPosition()), duration: (ratingKey && byKey[ratingKey]?.duration) || 0 })} />
        <EpisodeAutoplay
          active base="http://pms" token="t" ratingKey={ratingKey}
          getPosition={getPosition} seekTo={async () => {}}
          onPrompt={() => {}} onPlayNext={() => {}} onInfo={setInfo}
          registerEnded={() => {}}
        />
      </>
    );
  };
  return Harness;
}

describe('Continue Watching after playback', () => {
  it('a film and an episode stopped part-way show on Home and in their libraries', async () => {
    const Harness = await player();
    const { continueWatching, resumeSeconds } = await import('@/lib/plexProgress');
    const r = render(<Harness ratingKey={film.ratingKey} />);
    position = 1500;
    await flush(15_000);
    r.rerender(<Harness ratingKey={episode.ratingKey} />);
    await flush();
    position = 800;
    await flush(15_000);
    r.rerender(<Harness ratingKey={null} />);
    await flush();

    expect(resumeSeconds(film.ratingKey)).toBe(1500);
    expect(resumeSeconds(episode.ratingKey)).toBe(800);
    const home = continueWatching();
    expect(home.map((i) => i.ratingKey)).toEqual([episode.ratingKey, film.ratingKey]);
    expect(home[0].thumb).toBe('/library/metadata/48200/thumb');
    expect(continueWatching(30, '1').map((i) => i.ratingKey)).toEqual([film.ratingKey]);
    expect(continueWatching(30, '2').map((i) => i.ratingKey)).toEqual([episode.ratingKey]);
  });

  it('what is playing is cleared when the title changes, so the old title is not saved under the new', async () => {
    const { default: EpisodeAutoplay } = await import('./EpisodeAutoplay');
    const seen: Array<string | null> = [];
    const ui = (key: string | null) => (
      <EpisodeAutoplay active base="http://pms" token="t" ratingKey={key} getPosition={getPosition} seekTo={async () => {}}
        onPrompt={() => {}} onPlayNext={() => {}} onInfo={(i) => seen.push(i ? i.ratingKey : null)} registerEnded={() => {}} />
    );
    const r = render(ui(film.ratingKey));
    await flush();
    r.rerender(ui(episode.ratingKey));
    await flush();
    expect(seen).toEqual([null, film.ratingKey, null, episode.ratingKey]);
  });
});
