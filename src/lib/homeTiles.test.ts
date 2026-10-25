import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  arrangeTiles, defaultTiles, HOME_TILES_EVENT, loadSavedTiles, moveTile, openTile, pickableTiles, saveTiles, setTile,
  tileAllowed, type TileContext,
} from './homeTiles';
import { INTENT_KEYS } from './appActions';
import { swapProfileStorage } from './profiles';

const GROWN: TileContext = { kidsLevel: null, playerEnabled: true, recorder: true };
const KIDS: TileContext = { kidsLevel: 'kids', playerEnabled: true, recorder: true };

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('home tiles: defaults and who may have what', () => {
  it('starts with the four Home always had', () => {
    expect(defaultTiles(null)).toEqual(['livetv', 'plex', 'support', 'store']);
    expect(defaultTiles('kids')).toEqual(['livetv', 'plex', 'kids-games', 'support']);
    expect(arrangeTiles(null, GROWN)).toEqual(['livetv', 'plex', 'support', 'store']);
  });

  it('offers grown-ups every place, Kids only theirs', () => {
    const grown = pickableTiles(GROWN).map((d) => d.id);
    expect(grown).toEqual(['livetv', 'plex', 'support', 'store', 'guide', 'gameday', 'multi', 'favorites', 'recordings', 'movies', 'series', 'search', 'settings', 'speedtest', 'buffering', 'ai-chat']);
    const kids = pickableTiles(KIDS).map((d) => d.id);
    expect(kids).toContain('kids-games');
    for (const grownUp of ['store', 'recordings', 'gameday']) expect(kids).not.toContain(grownUp);
    // A Teens profile has Game Day; nobody has Recordings without a recorder.
    expect(tileAllowed('gameday', { ...KIDS, kidsLevel: 'teen' })).toBe(true);
    expect(tileAllowed('recordings', { ...GROWN, recorder: false })).toBe(false);
  });

  it('draws a stored tile this viewer may not have as that slot\'s default, with no tile twice', () => {
    // A grown-up's row seen on a Kids profile (Store and Recordings are not theirs).
    expect(arrangeTiles(['store', 'recordings', 'guide', 'support'], KIDS)).toEqual(['livetv', 'plex', 'guide', 'support']);
    // Kids Lounge on a grown-up's row: the slot's default comes back.
    expect(arrangeTiles(['kids-games', 'guide', 'plex', 'store'], GROWN)).toEqual(['livetv', 'guide', 'plex', 'store']);
    // Junk in storage: the defaults.
    localStorage.setItem('smc-home-tiles-v1:main', '{"tiles":["nope","plex"]}');
    expect(loadSavedTiles('main')).toBeNull();
  });

  it('leaves the Player\'s tiles out while the Player is switched off', () => {
    expect(arrangeTiles(['guide', 'support', 'livetv', 'settings'], { ...GROWN, playerEnabled: false })).toEqual(['support', 'settings']);
  });
});

describe('home tiles: move and change', () => {
  const row = ['livetv', 'plex', 'support', 'store'] as const;

  it('moves a tile along the row, the others closing up, held at the ends', () => {
    expect(moveTile(row, 0, 2)).toEqual(['plex', 'support', 'livetv', 'store']);
    expect(moveTile(row, 3, 0)).toEqual(['store', 'livetv', 'plex', 'support']);
    expect(moveTile(row, 3, 9)).toEqual([...row]);
  });

  it('changes a shortcut, swapping with a place already on Home', () => {
    expect(setTile(row, 3, 'guide')).toEqual(['livetv', 'plex', 'support', 'guide']);
    expect(setTile(row, 0, 'support')).toEqual(['support', 'plex', 'livetv', 'store']);
  });
});

describe('home tiles: kept per profile, across restarts', () => {
  it('keeps each profile\'s own row and tells Home on every save', () => {
    const heard = vi.fn();
    window.addEventListener(HOME_TILES_EVENT, heard);
    saveTiles(['guide', 'livetv', 'plex', 'store'], 'main');
    saveTiles(['favorites', 'plex', 'support', 'livetv'], 'abc123');
    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener(HOME_TILES_EVENT, heard);
    expect(loadSavedTiles('main')).toEqual(['guide', 'livetv', 'plex', 'store']);
    expect(loadSavedTiles('abc123')).toEqual(['favorites', 'plex', 'support', 'livetv']);
    expect(loadSavedTiles('other1')).toBeNull();
    // Reset: back to the defaults for that profile only.
    saveTiles(null, 'abc123');
    expect(loadSavedTiles('abc123')).toBeNull();
    expect(loadSavedTiles('main')).toEqual(['guide', 'livetv', 'plex', 'store']);
  });

  it('survives a restart (a fresh module reads the box\'s copy) and a profile switch', async () => {
    saveTiles(['multi', 'plex', 'support', 'store'], 'main');
    vi.resetModules();
    const fresh = await import('./homeTiles');
    expect(fresh.loadSavedTiles('main')).toEqual(['multi', 'plex', 'support', 'store']);
    // The profile switch moves the per-person settings around; these are keyed by profile and stay put.
    swapProfileStorage('main', 'abc123');
    expect(fresh.loadSavedTiles('main')).toEqual(['multi', 'plex', 'support', 'store']);
  });
});

describe('home tiles: what a tile opens', () => {
  const intent = () => JSON.parse(sessionStorage.getItem(INTENT_KEYS.player) || 'null');

  it('opens the Player\'s places straight in, coming Home on Back', () => {
    const nav = vi.fn();
    openTile('guide', nav);
    expect(nav).toHaveBeenLastCalledWith('livetv');
    expect(intent()).toEqual({ section: 'guide', home: true });
    openTile('favorites', nav);
    expect(intent()).toEqual({ section: 'live', open: 'favorites', home: true });
    openTile('series', nav);
    expect(intent()).toEqual({ section: 'vod-series', home: true });
    openTile('livetv', nav);
    expect(intent()).toEqual({ section: 'live', home: true });
  });

  it('opens Support on its tools, and the plain screens', () => {
    const nav = vi.fn();
    openTile('speedtest', nav);
    expect(nav).toHaveBeenLastCalledWith('support');
    expect(sessionStorage.getItem(INTENT_KEYS.support)).toBe('speedtest');
    openTile('ai-chat', nav);
    expect(sessionStorage.getItem(INTENT_KEYS.support)).toBe('ai');
    openTile('buffering', nav);
    expect(sessionStorage.getItem('smc-open-buffering-guide')).toBe('1');
    openTile('settings', nav);
    expect(nav).toHaveBeenLastCalledWith('settings');
    openTile('store', nav);
    expect(nav).toHaveBeenLastCalledWith('store');
    const voice = vi.fn();
    window.addEventListener('smc-voice:open', voice);
    openTile('search', nav);
    window.removeEventListener('smc-voice:open', voice);
    expect(voice).toHaveBeenCalledTimes(1);
  });
});
