/**
 * "If they click a 1080p option on the cover art … in the movie info area we
 * can have an option to play the 4K if available, maybe it can do a little
 * speed check … and same with the 4K option it'll give the 1080p option."
 * The title page lists a film's versions next to Play, starts the one whose
 * poster was clicked, and steps a 4K default down to 1080p when the measured
 * speed is clearly too low — still letting the viewer pick 4K.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./PlexImage', () => ({ default: () => null }));
vi.mock('@/lib/plex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plex')>();
  return {
    ...actual,
    getPlexMetadata: vi.fn(async (_b: string, _t: string, rk: string) => ({
      ratingKey: rk, title: 'The Film', type: 'movie', genres: [], cast: [], directors: [],
      guid: 'plex://movie/abc',
      partKey: '/library/parts/1/file.mkv',
      versions: actual.mediaVersions({
        Media: [
          { videoResolution: '1080', bitrate: 10000, Part: [{ key: '/library/parts/1/file.mkv' }] },
          { videoResolution: '4k', bitrate: 48000, Part: [{ key: '/library/parts/2/file.mkv' }] },
        ],
      }, rk),
    })),
    findPlexCopies: vi.fn(async () => []),
  };
});

import PlexDetail from './PlexDetail';
import { setPlexKeyOwner } from './plexKeyOwner';
import { _resetPlexSpeedCache, _setPlexSpeed } from '@/lib/plexVersions';
import type { PlexItem } from '@/lib/plex';

const BASE = 'http://srv:32400';
const press = (key: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });

function renderDetail(item: PlexItem) {
  const onPlay = vi.fn();
  render(<PlexDetail isActive base={BASE} token="tok" item={item} onPlay={onPlay} onPlayEpisode={vi.fn()} onBack={vi.fn()} />);
  return onPlay;
}

describe('versions on the title page', () => {
  beforeEach(() => { setPlexKeyOwner('detail'); _resetPlexSpeedCache(); });
  afterEach(() => { _resetPlexSpeedCache(); });

  it('starts the version the poster showed, and offers the other one', async () => {
    _setPlexSpeed(BASE, 100000);
    const onPlay = renderDetail({ ratingKey: '101', title: 'The Film', type: 'movie', videoResolution: '1080' });
    await waitFor(() => expect(screen.getByText('Play 1080p')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByText('4K')).toBeTruthy();
    // ▼ to the versions (best first, on the one in effect), ◀ to 4K, OK picks it and goes back up to Play.
    press('ArrowDown');
    press('ArrowLeft');
    press('Enter');
    await waitFor(() => expect(screen.getByText('Play 4K')).toBeTruthy(), { timeout: 5000 });
    press('Enter');
    await waitFor(() => expect(onPlay).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const src = onPlay.mock.calls[0][4];
    expect(src.version.id).toBe('101:1');
    expect(src.version.partKey).toBe('/library/parts/2/file.mkv');
    expect(src.versions).toHaveLength(2);
  });

  it('a 4K poster on a slow line starts 1080p and says why; 4K is still there', async () => {
    _setPlexSpeed(BASE, 12000);
    const onPlay = renderDetail({ ratingKey: '101', title: 'The Film', type: 'movie', videoResolution: '4k' });
    await waitFor(() => expect(screen.getByText('Play 1080p')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getAllByText(/This 4K file averages ~48 Mb\/s, more in busy scenes; this TV measured ~12 Mb\/s from the Plex server/).length).toBeGreaterThan(0);
    press('Enter');
    await waitFor(() => expect(onPlay).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(onPlay.mock.calls[0][4].version.id).toBe('101:0');
    // Picking 4K plays it anyway. The chips open on the one in effect (1080p);
    // 4K is to its left (best first).
    press('ArrowDown');
    press('ArrowLeft');
    press('Enter');
    await waitFor(() => expect(screen.getByText('Play 4K')).toBeTruthy(), { timeout: 5000 });
    press('Enter');
    await waitFor(() => expect(onPlay).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(onPlay.mock.calls[1][4].version.id).toBe('101:1');
  });

  it('a line too slow for the 1080p file as well: it starts converted to what the line carries, and says so', async () => {
    // The owner's title page: "this TV measured ~1.7 Mb/s from the Plex server — starting in 1080p".
    // Measured on this title's own 4K file.
    _setPlexSpeed(BASE, 1700, Date.now(), 1, '/library/parts/2/file.mkv');
    const onPlay = renderDetail({ ratingKey: '101', title: 'The Film', type: 'movie', videoResolution: '4k' });
    await waitFor(() => expect(screen.getAllByText(/starting in 720p · 3 Mbps\. Pick 4K to play it anyway\./).length).toBeGreaterThan(0), { timeout: 5000 });
    press('Enter');
    await waitFor(() => expect(onPlay).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const src = onPlay.mock.calls[0][4];
    expect(src.version.id).toBe('101:0');
    expect(src.startPreset).toBe('720-3');
    expect(src.measuredKbps).toBe(1700);
    // Picking a version is playing it anyway: no conversion.
    press('ArrowDown');
    press('ArrowLeft');
    press('Enter');
    await waitFor(() => expect(screen.getByText('Play 4K')).toBeTruthy(), { timeout: 5000 });
    press('Enter');
    await waitFor(() => expect(onPlay).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(onPlay.mock.calls[1][4].startPreset).toBeUndefined();
    expect(onPlay.mock.calls[1][4].picked).toBe(true);
  });

  it("another title's old reading (the cache is per server) never converts this one", async () => {
    _setPlexSpeed(BASE, 1700, Date.now(), 1, '/library/parts/999/other.mkv');
    const onPlay = renderDetail({ ratingKey: '101', title: 'The Film', type: 'movie', videoResolution: '1080' });
    await waitFor(() => expect(screen.getByText('Play 1080p')).toBeTruthy(), { timeout: 5000 });
    press('Enter');
    await waitFor(() => expect(onPlay).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(onPlay.mock.calls[0][4].startPreset).toBeUndefined();
    expect(screen.queryByText(/starting in 720p/)).toBeNull();
  });
});
