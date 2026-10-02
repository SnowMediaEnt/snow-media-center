// One analytics event at the end of each Plex title, with what Playback stats
// showed then: so the Hub can compare boxes, routes and builds without a
// photo of the stats panel. Read before the player is stopped, sent once per
// title, and never with a URL, host or token in it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerStats } from '@/capacitor/SnowPlayer';

const h = vi.hoisted(() => ({
  events: [] as Array<{ name: string; props: Record<string, unknown> }>,
  stats: null as unknown,
  order: [] as string[],
}));
vi.mock('@/utils/platform', () => ({ isNativePlatform: () => true }));
vi.mock('@/lib/analytics', () => ({
  trackEvent: (name: string, _c: string, props: Record<string, unknown>) => { h.events.push({ name, props }); },
}));
vi.mock('@/capacitor/SnowPlayer', () => ({
  SnowPlayer: {
    getStats: () => { h.order.push('getStats'); return Promise.resolve(h.stats); },
    stop: () => { h.order.push('stop'); return Promise.resolve(); },
  },
}));

import { PLEX_TITLE_STATS_EVENT, plexTitleStatsProps, watchPlexTitleStats } from './plexTitleStats';
import { newPlexPlaybackSession, setPlexCurrentRoute, setPlexPlaybackActive } from './plex';

const STATS = {
  state: 'ready', playing: true, positionSec: 1234.5, durationSec: 5400, bufferedAheadSec: 30,
  nowKbps: 21000, avgKbps: 24567.8, minKbps: 5700, maxKbps: 61000,
  videoDecoder: 'c2.amlogic.hevc.decoder', videoFormat: 'HEVC 3840x1600', renderedFrames: 1000, droppedFrames: 12,
  audioDecoder: 'Passthrough', audioFormat: 'EAC3 6ch', restarts: 1, lastRestartReason: 'server stopped responding',
  lastError: 'ERROR_CODE_IO_BAD_HTTP_STATUS', httpStatus: 503, loadProfile: 'steady', fetchConnections: 0,
  rangeFetch: true, connectionCap: 3,
  javaHeapMb: 40, nativeHeapMb: 80, engine: 'exo', firstFrameMs: 2100, stalls: 3, stallSec: 7.25, cpuPct: 30, pssMb: 300,
  arrivalKbps: 22000, lowRamBox: true,
} as PlayerStats & { arrivalKbps: number; lowRamBox: boolean };
const PD = 'https://203-0-113-5.abc123.plex.direct:32400';
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  h.events = [];
  h.order = [];
  h.stats = STATS;
  setPlexCurrentRoute({ base: PD, route: 'direct' });
});

describe('plexTitleStatsProps', () => {
  it('reports arrival speed, stalls, restarts, the last error, how the file was read and the route\'s kind', () => {
    expect(plexTitleStatsProps(STATS, { base: PD, route: 'direct' }, 'smcp-1')).toEqual({
      session: 'smcp-1', engine: 'exo', state: 'ready', positionSec: 1235, durationSec: 5400, firstFrameMs: 2100,
      avgKbps: 24568, minKbps: 5700, maxKbps: 61000, arrivalKbps: 22000,
      stalls: 3, stallSec: 7.3, restarts: 1, lastRestartReason: 'server stopped responding',
      lastError: 'ERROR_CODE_IO_BAD_HTTP_STATUS', httpStatus: 503, rangeFetch: true, connectionCap: 3, droppedFrames: 12, lowRamBox: true,
      route: 'direct', addressKind: 'plex.direct', port: 32400, ipFamily: 'IPv4', secure: true,
    });
  });

  it('carries no address, host or token', () => {
    const props = plexTitleStatsProps(STATS, { base: 'https://user:pw@plex.example.com:8443/x?X-Plex-Token=abc', route: 'direct' }, null);
    expect(JSON.stringify(props)).not.toMatch(/example|abc|Token|203\.0|pw/);
    expect(props).toMatchObject({ addressKind: 'custom', port: 8443, ipFamily: null });
  });

  it('is nothing when the title never played', () => {
    const idle = { ...STATS, state: 'idle', positionSec: 0, firstFrameMs: null, avgKbps: null } as PlayerStats;
    expect(plexTitleStatsProps(idle, null, null)).toBeNull();
    expect(plexTitleStatsProps(null, null, null)).toBeNull();
  });

  it('copes with an older app that leaves the newer figures out', () => {
    const old = { ...STATS } as Record<string, unknown>;
    delete old.arrivalKbps; delete old.lowRamBox; delete old.httpStatus; delete old.fetchConnections;
    delete old.rangeFetch; delete old.connectionCap;
    expect(plexTitleStatsProps(old as unknown as PlayerStats, null, null)).toMatchObject({
      arrivalKbps: null, lowRamBox: null, httpStatus: null, rangeFetch: null, connectionCap: null, route: 'unknown', port: null,
    });
  });
});

describe('watchPlexTitleStats', () => {
  it('sends one event when the player closes, reading the stats before anything stops it', async () => {
    watchPlexTitleStats();
    watchPlexTitleStats(); // idempotent
    setPlexPlaybackActive(true);
    const session = newPlexPlaybackSession();
    // As in PlexSection: the flag goes off in an effect cleanup, then the
    // player's own effect stops it.
    setPlexPlaybackActive(false);
    h.order.push('stop');
    await flush();
    expect(h.order).toEqual(['getStats', 'stop']);
    expect(h.events).toHaveLength(1);
    expect(h.events[0].name).toBe(PLEX_TITLE_STATS_EVENT);
    expect(h.events[0].props).toMatchObject({ session, route: 'direct', avgKbps: 24568, stalls: 3 });
  });

  it('sends the finished title when the next one starts (Up Next), and each title once', async () => {
    watchPlexTitleStats();
    setPlexPlaybackActive(true);
    const first = newPlexPlaybackSession();
    const second = newPlexPlaybackSession();
    await flush();
    expect(h.events.map((e) => e.props.session)).toEqual([first]);
    setPlexPlaybackActive(false);
    await flush();
    expect(h.events.map((e) => e.props.session)).toEqual([first, second]);
    // The next title's start does not send the one already sent.
    newPlexPlaybackSession();
    await flush();
    expect(h.events).toHaveLength(2);
  });

  it('sends nothing for a title that never played', async () => {
    watchPlexTitleStats();
    h.stats = { ...STATS, state: 'idle', positionSec: 0, firstFrameMs: null, avgKbps: null };
    setPlexPlaybackActive(true);
    newPlexPlaybackSession();
    setPlexPlaybackActive(false);
    await flush();
    expect(h.events).toHaveLength(0);
  });
});
