// A title's trailer (owner, 2026-10-11: the trailer option for Plex, played
// in SMC). Plex keeps trailers as extras: clips beside the title, extraType 1,
// some files in the server's library, some Plex's online trailers (Plex Pass)
// that the server fetches. The title's metadata names a primary extra only
// when it has extras; nothing else is asked for, and a Kids profile asks for
// nothing at all.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false }, CapacitorHttp: {} }));

import { clearPlexCaches, getPlexMetadata, getPlexTrailer, pickPlexTrailer, plexDirectUrl } from './plex';
import { setKidsLevel } from './kidsFilter';

const BASE = 'http://pms:32400';
const LOCAL_PART = '/library/parts/901/1700000000/Dune-trailer.mp4';
const ONLINE_PART = '/services/iva/assets/593133/video.mp4?fmt=4&bitrate=5000';

const clip = (rk: string, extra: Record<string, unknown>, part?: string) => ({
  ratingKey: rk, key: `/library/metadata/${rk}`, type: 'clip', title: `Clip ${rk}`, duration: 150_000,
  ...extra,
  ...(part ? { Media: [{ videoResolution: '1080', bitrate: 5000, Part: [{ key: part }] }] } : {}),
});

let answers: Record<string, unknown> = {};
let asked: string[] = [];
beforeEach(() => {
  answers = {};
  asked = [];
  clearPlexCaches();
  setKidsLevel(null);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    asked.push(url);
    const path = new URL(url).pathname;
    const body = answers[path];
    if (body === 'fail') return new Response('', { status: 500 });
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); setKidsLevel(null); });

describe('pickPlexTrailer: the extras listing', () => {
  it('takes a trailer clip with a file, as a version the player can open', () => {
    const tr = pickPlexTrailer([clip('901', { extraType: 1, subtype: 'trailer', title: 'Official Trailer' }, LOCAL_PART)]);
    expect(tr).toMatchObject({ ratingKey: '901', title: 'Official Trailer', partKey: LOCAL_PART, online: false, duration: 150_000 });
    expect(tr?.version).toMatchObject({ id: '901:0', ratingKey: '901', mediaIndex: 0, partKey: LOCAL_PART, label: '1080p', bitrateKbps: 5000 });
  });

  it('skips extras that are not trailers, and trailers without a file', () => {
    expect(pickPlexTrailer([
      clip('1', { extraType: 2, subtype: 'deletedScene' }, LOCAL_PART),
      clip('2', { extraType: 5, subtype: 'behindTheScenes' }, LOCAL_PART),
      clip('3', { extraType: 1, subtype: 'trailer' }),
      { ratingKey: '4', type: 'movie', extraType: 1, Media: [{ Part: [{ key: LOCAL_PART }] }] },
    ])).toBeNull();
    expect(pickPlexTrailer(undefined)).toBeNull();
    expect(pickPlexTrailer({})).toBeNull();
  });

  it("never a file at someone else's address (the token would go with it)", () => {
    expect(pickPlexTrailer([clip('7', { extraType: 1 }, 'https://cdn.example.com/trailer.mp4')])).toBeNull();
  });

  it('reads the extra type sent as text, or the subtype alone', () => {
    expect(pickPlexTrailer([clip('5', { extraType: '1' }, LOCAL_PART)])?.ratingKey).toBe('5');
    expect(pickPlexTrailer([clip('6', { subtype: 'trailer' }, LOCAL_PART)])?.ratingKey).toBe('6');
  });

  it("prefers the server's own file over Plex's online trailer", () => {
    const tr = pickPlexTrailer([
      clip('20', { extraType: 1 }, ONLINE_PART),
      clip('21', { extraType: 1 }, LOCAL_PART),
    ], '/library/metadata/20');
    expect(tr).toMatchObject({ ratingKey: '21', online: false });
  });

  it('offers an online trailer when it is the only one, the one Plex leads with first', () => {
    const tr = pickPlexTrailer([
      clip('30', { extraType: 1 }, ONLINE_PART),
      clip('31', { extraType: 1 }, ONLINE_PART.replace('593133', '593134')),
    ], '/library/metadata/31');
    expect(tr).toMatchObject({ ratingKey: '31', online: true });
    // Without a lead, the server's order.
    expect(pickPlexTrailer([clip('30', { extraType: 1 }, ONLINE_PART), clip('31', { extraType: 1 }, LOCAL_PART.replace('901', '902'))])?.ratingKey).toBe('31');
    expect(pickPlexTrailer([clip('32', { extraType: 1 }, LOCAL_PART), clip('33', { extraType: 1 }, LOCAL_PART)])?.ratingKey).toBe('32');
  });
});

describe('getPlexTrailer', () => {
  it('reads primaryExtraKey with the metadata, asked as before (no extras in it)', async () => {
    answers['/library/metadata/100'] = { MediaContainer: { Metadata: [{ ratingKey: '100', type: 'movie', title: 'Dune', primaryExtraKey: '/library/metadata/901' }] } };
    const m = await getPlexMetadata(BASE, 'tok', '100');
    expect(m.primaryExtraKey).toBe('/library/metadata/901');
    expect(asked[0]).toContain('/library/metadata/100?includeExtras=0');
  });

  it("asks for the title's extras once, and remembers the answer", async () => {
    answers['/library/metadata/100/extras'] = { MediaContainer: { Metadata: [clip('901', { extraType: 1 }, LOCAL_PART)] } };
    const tr = await getPlexTrailer(BASE, 'tok', '100', '/library/metadata/901');
    expect(tr?.partKey).toBe(LOCAL_PART);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/^http:\/\/pms:32400\/library\/metadata\/100\/extras\?X-Plex-Container-Start=0&X-Plex-Container-Size=30/);
    expect(await getPlexTrailer(BASE, 'tok', '100', '/library/metadata/901')).toBe(tr);
    expect(asked).toHaveLength(1);
  });

  it('asks nothing for a title without extras', async () => {
    expect(await getPlexTrailer(BASE, 'tok', '100', undefined)).toBeNull();
    expect(asked).toHaveLength(0);
  });

  it('asks nothing on a Kids profile', async () => {
    setKidsLevel('kids');
    answers['/library/metadata/100/extras'] = { MediaContainer: { Metadata: [clip('901', { extraType: 1 }, LOCAL_PART)] } };
    expect(await getPlexTrailer(BASE, 'tok', '100', '/library/metadata/901')).toBeNull();
    expect(asked).toHaveLength(0);
  });

  it('a failed request is no trailer, and is asked again next time', async () => {
    answers['/library/metadata/100/extras'] = 'fail';
    expect(await getPlexTrailer(BASE, 'tok', '100', '/library/metadata/901')).toBeNull();
    answers['/library/metadata/100/extras'] = { MediaContainer: { Metadata: [clip('901', { extraType: 1 }, LOCAL_PART)] } };
    expect((await getPlexTrailer(BASE, 'tok', '100', '/library/metadata/901'))?.ratingKey).toBe('901');
    expect(asked).toHaveLength(2);
  });
});

describe('plexDirectUrl for an online trailer', () => {
  it("joins the token onto the file's own query; a library file's address is unchanged", () => {
    const online = plexDirectUrl(BASE, ONLINE_PART, 'tok');
    expect(online.startsWith(`${BASE}${ONLINE_PART}&X-Plex-Token=tok&`)).toBe(true);
    expect(online.split('?')).toHaveLength(2);
    expect(plexDirectUrl(BASE, LOCAL_PART, 'tok').startsWith(`${BASE}${LOCAL_PART}?X-Plex-Token=tok&`)).toBe(true);
  });
});
