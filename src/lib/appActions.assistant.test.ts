// The assistant's newer actions (open_live_tv, open_plex, open_settings,
// request_plex_title): where each one sends the app, what a Kids profile is
// refused, and a Plex request only going out for a confirmed, certain match.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const overseerr = vi.hoisted(() => ({ search: vi.fn(), request: vi.fn() }));
vi.mock('@/lib/overseerr', () => ({ overseerrSearch: overseerr.search, overseerrRequest: overseerr.request }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

import {
  INTENT_KEYS, openLiveTv, openPlexPlace, openSettingsPlace, pickRequestMatch, runAssistantAction, takeIntent, type PlayerIntent,
} from '@/lib/appActions';
import { findPlexTab, peekPlexVoice, PLEX_VOICE_KEY } from '@/lib/plexVoice';

const player = () => takeIntent<PlayerIntent>(INTENT_KEYS.player, true);
const item = (id: number, title: string, year: string | null, mediaType: 'movie' | 'tv' = 'movie', status = 1) =>
  ({ id, title, year, mediaType, posterUrl: null, status });

beforeEach(() => { sessionStorage.clear(); overseerr.search.mockReset(); overseerr.request.mockReset(); });
afterEach(() => { sessionStorage.clear(); });

describe('open_live_tv', () => {
  it.each([
    ['favorites', { section: 'live', open: 'favorites' }],
    ['guide', { section: 'guide' }],
    ['game_day', { section: 'gameday' }],
    ['recordings', { section: 'recordings' }],
    ['vod', { section: 'vod' }],
    ['multi_screen', { section: 'multi' }],
    ['snow_originals', { section: 'originals' }],
  ])('%s opens that part of Live TV', (place, want) => {
    const nav = vi.fn();
    expect(openLiveTv(place, nav)).toEqual(want);
    expect(nav).toHaveBeenCalledWith('livetv');
    expect(player()).toEqual(want);
  });

  it('refuses a made-up place, and Backups / Recordings on a Kids profile', async () => {
    const nav = vi.fn();
    expect(openLiveTv('admin', nav)).toBeNull();
    expect(openLiveTv('backups', nav, true)).toBeNull();
    expect(openLiveTv('recordings', nav, true)).toBeNull();
    expect(nav).not.toHaveBeenCalled();
    expect(await runAssistantAction('open_live_tv', { section: 'backups' }, nav, { kids: true })).toMatch(/grown-up/);
    // The Guide is fine for a child.
    expect(await runAssistantAction('open_live_tv', { section: 'guide' }, nav, { kids: true })).toBe('Opening the Guide…');
  });
});

describe('open_plex', () => {
  it('hands Plex a place in its menu, with the words to type', () => {
    const nav = vi.fn();
    expect(openPlexPlace('search', 'batman', nav)).toBe('search');
    expect(player()?.plex).toMatchObject({ query: 'batman', open: false, tab: 'search' });
    expect(openPlexPlace('movies', '', nav)).toBe('movies');
    expect(player()).toMatchObject({ section: 'movies', plex: { tab: 'movies' } });
  });

  it('needs a name for a library, and keeps Request from a Kids profile', () => {
    const nav = vi.fn();
    expect(openPlexPlace('library', '  ', nav)).toBeNull();
    expect(openPlexPlace('request', 'Dune', nav, true)).toBeNull();
    expect(openPlexPlace('settings', '', nav)).toBeNull();
    expect(nav).not.toHaveBeenCalled();
  });

  it('Plex reads a place with no title, and picks the entry it means', () => {
    sessionStorage.setItem(PLEX_VOICE_KEY, JSON.stringify({ query: '', open: true, tab: 'discover', at: Date.now() }));
    expect(peekPlexVoice()?.intent).toMatchObject({ tab: 'discover', open: false });
    sessionStorage.setItem(PLEX_VOICE_KEY, JSON.stringify({ query: '', open: false, tab: 'nope', at: Date.now() }));
    expect(peekPlexVoice()).toBeNull();

    const tabs = [
      { type: 'home', title: '' }, { type: 'discover', title: '' }, { type: 'search', title: '' },
      { type: 'movie', title: '4K Films' }, { type: 'movie', title: 'Movies' }, { type: 'show', title: 'Kids Shows' }, { type: 'show', title: 'TV Shows' },
      { type: 'request', title: '' },
    ];
    expect(findPlexTab(tabs, 'movies')).toBe(4); // the one called Movies, before 4K Films
    expect(findPlexTab(tabs, 'shows')).toBe(6);
    expect(findPlexTab(tabs.filter((t) => t.title !== 'Movies'), 'movies')).toBe(3); // else one whose name says films
    expect(findPlexTab(tabs, 'library', 'tv shows')).toBe(6);
    expect(findPlexTab(tabs, 'library', 'kids')).toBe(5);
    expect(findPlexTab(tabs, 'library', 'anime')).toBe(-1);
    expect(findPlexTab(tabs, 'request')).toBe(7);
  });
});

describe('open_settings', () => {
  it.each([
    ['live_tv_settings', 'hub'], ['my_account', 'account'], ['devices', 'devices'], ['services', 'services'],
    ['channels', 'channels'], ['appearance', 'appearance'], ['recording_rewind', 'rewind'], ['player', 'player'], ['fix_a_problem', 'help'],
  ])('%s opens Live TV Settings on its page', (place, page) => {
    const nav = vi.fn();
    expect(openSettingsPlace(place, nav)).toBe(place);
    expect(player()).toEqual({ section: 'live', settings: page });
  });

  it('opens the app\'s Settings on UI › Home screen, Media or UI', () => {
    const nav = vi.fn();
    openSettingsPlace('home_screen', nav);
    expect(nav).toHaveBeenLastCalledWith('settings');
    expect(sessionStorage.getItem(INTENT_KEYS.settings)).toBe('ui-home');
    openSettingsPlace('wallpaper', nav);
    expect(sessionStorage.getItem(INTENT_KEYS.settings)).toBe('media');
  });

  it('keeps Live TV Settings and Home screen from a Kids profile', async () => {
    const nav = vi.fn();
    expect(openSettingsPlace('my_account', nav, true)).toBeNull();
    expect(openSettingsPlace('home_screen', nav, true)).toBeNull();
    expect(nav).not.toHaveBeenCalled();
    expect(await runAssistantAction('open_settings', { page: 'services' }, nav, { kids: true })).toMatch(/grown-up/);
    expect(await runAssistantAction('open_settings', { page: 'settings_ui' }, nav, { kids: true })).toBe('Opening Settings › UI…');
  });
});

describe('request_plex_title', () => {
  it('matches only one result: same kind, same title, and the year when given', () => {
    const found = [item(1, 'Dune', '1984'), item(2, 'Dune', '2021'), item(3, 'Dune', '2000', 'tv'), item(4, 'Dune: Part Two', '2024')];
    expect(pickRequestMatch(found, { title: 'Dune', mediaType: 'movie' })).toBeNull(); // two films
    expect(pickRequestMatch(found, { title: 'dune', mediaType: 'movie', year: '2021' })?.id).toBe(2);
    expect(pickRequestMatch(found, { title: 'Dune', mediaType: 'tv' })?.id).toBe(3);
    expect(pickRequestMatch(found, { title: 'Dune Part Two', mediaType: 'movie' })?.id).toBe(4);
    expect(pickRequestMatch(found, { title: 'Dune 3', mediaType: 'movie' })).toBeNull();
  });

  it('sends a confirmed, certain match', async () => {
    overseerr.search.mockResolvedValue([item(2, 'Dune', '2021'), item(1, 'Dune', '1984')]);
    overseerr.request.mockResolvedValue('requested');
    const nav = vi.fn();
    const line = await runAssistantAction('request_plex_title', { title: 'Dune', media_type: 'movie', year: '2021', confirmed: true }, nav);
    expect(overseerr.request).toHaveBeenCalledWith(expect.objectContaining({ id: 2, mediaType: 'movie' }));
    expect(line).toMatch(/^Requested Dune \(2021\)/);
    expect(nav).not.toHaveBeenCalled();
  });

  it('does not send when unconfirmed, spoken to the remote, or unsure: Plex › Request opens with the title', async () => {
    overseerr.search.mockResolvedValue([item(1, 'Dune', '1984'), item(2, 'Dune', '2021')]);
    for (const [args, opts] of [
      [{ title: 'Dune', media_type: 'movie', year: '2021' }, {}],
      [{ title: 'Dune', media_type: 'movie', year: '2021', confirmed: true }, { voice: true }],
      [{ title: 'Dune', media_type: 'movie', confirmed: true }, {}],
    ] as const) {
      const nav = vi.fn();
      const line = await runAssistantAction('request_plex_title', args, nav, opts);
      expect(line).toMatch(/Plex › Request/);
      expect(player()).toMatchObject({ section: 'movies', plex: { tab: 'request', query: 'Dune' } });
    }
    expect(overseerr.request).not.toHaveBeenCalled();
  });

  it('says when it is on Plex already (and opens it) or already on its way', async () => {
    const nav = vi.fn();
    overseerr.search.mockResolvedValue([item(9, 'Up', '2009', 'movie', 5)]);
    expect(await runAssistantAction('request_plex_title', { title: 'Up', media_type: 'movie', confirmed: true }, nav)).toMatch(/already on Plex/);
    expect(player()?.plex).toMatchObject({ query: 'Up', open: true });
    overseerr.search.mockResolvedValue([item(9, 'Up', '2009', 'movie', 3)]);
    expect(await runAssistantAction('request_plex_title', { title: 'Up', media_type: 'movie', confirmed: true }, nav)).toMatch(/already requested/);
    expect(overseerr.request).not.toHaveBeenCalled();
  });

  it('refuses a Kids profile and a call without a title or type', async () => {
    const nav = vi.fn();
    expect(await runAssistantAction('request_plex_title', { title: 'Up', media_type: 'movie', confirmed: true }, nav, { kids: true })).toMatch(/grown-up/);
    expect(await runAssistantAction('request_plex_title', { title: 'Up', media_type: 'song', confirmed: true }, nav)).toMatch(/exact title/);
    expect(overseerr.search).not.toHaveBeenCalled();
  });

  it('leaves the older tools to their callers', async () => {
    expect(await runAssistantAction('install_app', { app_name: 'Downloader' }, vi.fn())).toBeNull();
  });
});
