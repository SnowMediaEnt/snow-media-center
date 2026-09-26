// Picking which version of a title to play (a 4K and a 1080p file of the
// same film, as two Media of one item or as copies in two libraries), and the
// quick speed check that decides whether 4K is worth starting.
//
// The rule, as the owner asked for it: start the version whose poster was
// clicked; if that is 4K, measure first, and when the connection to the
// server is clearly too slow for the 4K file say so and start the 1080p one
// instead. The viewer can always pick 4K anyway, and change it in the
// player's Quality menu.
import { formatMbps } from '@/lib/bufferDiagnostics';
import { plexDirectUrl, resolutionLabel, type PlexVersion } from '@/lib/plex';

export type { PlexVersion } from '@/lib/plex';

const RES_RANK: Record<string, number> = { '4K': 2160, '2160p': 2160, '1440p': 1440, '1080p': 1080, '720p': 720, '576p': 576, '480p': 480, SD: 400 };

/** Rough vertical resolution of a version, for ordering. */
export function versionRank(v: PlexVersion): number {
  return RES_RANK[v.label] ?? v.height ?? (parseInt(v.label, 10) || 0);
}

export const is4k = (v: PlexVersion | null | undefined): boolean => !!v && (v.label === '4K' || (v.height ?? 0) >= 1800);

/** Versions without duplicates (same item and Media, or the same file), best
 *  first: higher resolution, then higher bitrate. */
export function sortVersions(list: PlexVersion[]): PlexVersion[] {
  const seen = new Set<string>();
  const out: PlexVersion[] = [];
  for (const v of list) {
    const k = v.partKey ? `p:${v.partKey}` : `i:${v.id}`;
    if (seen.has(k) || seen.has(`i:${v.id}`)) continue;
    seen.add(k); seen.add(`i:${v.id}`);
    out.push(v);
  }
  return out.sort((a, b) => (versionRank(b) - versionRank(a)) || ((b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0)));
}

/** What a version is called on a button: "4K", or "1080p · 8 Mb/s" when two
 *  versions share a resolution. */
export function versionName(v: PlexVersion, all: PlexVersion[]): string {
  const base = v.label || 'Original';
  const twin = all.some((o) => o.id !== v.id && (o.label || 'Original') === base);
  return twin && v.bitrateKbps ? `${base} · ${formatMbps(v.bitrateKbps)}` : base;
}

/**
 * The version to start with: the one the clicked poster showed. A poster's
 * resolution badge is its item's first Media (see mediaRes in plex.ts), so a
 * version of the clicked item with that resolution wins, then the item's
 * first Media, then the best there is.
 */
export function defaultVersion(versions: PlexVersion[], clicked: { ratingKey: string; videoResolution?: string }): PlexVersion | null {
  if (!versions.length) return null;
  const want = resolutionLabel(clicked.videoResolution);
  const own = versions.filter((v) => v.ratingKey === clicked.ratingKey);
  return (want ? own.find((v) => v.label === want) : undefined)
    ?? own.find((v) => v.mediaIndex === 0)
    ?? (want ? versions.find((v) => v.label === want) : undefined)
    ?? versions[0];
}

export interface SpeedVerdict {
  /** The file's own average bitrate, kbps. */
  fileKbps: number;
  /** About what the version needs, kbps (its bitrate plus headroom). */
  needKbps: number;
  haveKbps: number;
  tooSlow: boolean;
}

/** Headroom over the file's average bitrate: scenes run well above average. */
export const SPEED_HEADROOM = 1.25;

/** Is `haveKbps` enough for `v`? Null when either number is unknown. */
export function speedVerdict(v: PlexVersion | null | undefined, haveKbps: number | null | undefined): SpeedVerdict | null {
  if (!v?.bitrateKbps || !haveKbps || haveKbps <= 0) return null;
  const needKbps = Math.round(v.bitrateKbps * SPEED_HEADROOM);
  return { fileKbps: v.bitrateKbps, needKbps, haveKbps, tooSlow: haveKbps < needKbps };
}

/**
 * "This 4K file averages ~48 Mb/s, more in busy scenes; this TV measured ~12
 * Mb/s from the Plex server". The file's own rate and what was measured: it
 * used to say "4K needs ~60 Mb/s, you have ~12", which read like a
 * requirement of the TV rather than of this one file (the headroom on top of
 * its average is what "more in busy scenes" stands for).
 */
export function speedWarning(v: PlexVersion, verdict: SpeedVerdict): string {
  const what = v.label ? `This ${v.label} file` : 'This file';
  return `${what} averages ~${mbps(verdict.fileKbps)} Mb/s, more in busy scenes; this TV measured ~${mbps(verdict.haveKbps)} Mb/s from the Plex server`;
}
const mbps = (kbps: number): string => (kbps >= 10000 ? String(Math.round(kbps / 1000)) : (Math.round(kbps / 100) / 10).toFixed(1).replace(/\.0$/, ''));

/**
 * The version to fall back to when `chosen` is too much for the connection:
 * the best one that is not 4K and fits `haveKbps`, else the lightest one.
 * Returns `chosen` when nothing lighter exists.
 */
export function fallbackVersion(versions: PlexVersion[], chosen: PlexVersion, haveKbps: number | null): PlexVersion {
  const lighter = sortVersions(versions).filter((v) => v.id !== chosen.id && !is4k(v)
    && (!chosen.bitrateKbps || !v.bitrateKbps || v.bitrateKbps < chosen.bitrateKbps));
  if (!lighter.length) return chosen;
  if (haveKbps) {
    const fits = lighter.find((v) => !v.bitrateKbps || v.bitrateKbps * SPEED_HEADROOM <= haveKbps);
    if (fits) return fits;
  }
  return lighter.reduce((a, b) => ((a.bitrateKbps ?? Infinity) <= (b.bitrateKbps ?? Infinity) ? a : b));
}

/**
 * The version to START: `chosen`, unless it is 4K, the viewer did not pick it
 * themselves, and the speed check says it is clearly too slow.
 */
export function startVersion(versions: PlexVersion[], chosen: PlexVersion | null, picked: boolean, haveKbps: number | null): PlexVersion | null {
  if (!chosen) return null;
  if (picked || !is4k(chosen)) return chosen;
  const verdict = speedVerdict(chosen, haveKbps);
  if (!verdict?.tooSlow) return chosen;
  return fallbackVersion(versions, chosen, haveKbps);
}

/**
 * The file to convert from when the viewer picks a lower quality: the
 * lightest version that still carries `capKbps` (a 1080p file for a 1080p ·
 * 8 Mbps stream, not the 4K one — far less work for the server), else the
 * best there is. `current` when there is nothing to choose between.
 */
export function transcodeSource(versions: PlexVersion[], current: PlexVersion | null, capKbps: number | undefined): PlexVersion | null {
  if (versions.length < 2 || !capKbps) return current ?? versions[0] ?? null;
  const known = versions.filter((v) => v.bitrateKbps);
  if (!known.length) return current ?? versions[0];
  const carrying = known.filter((v) => (v.bitrateKbps as number) >= capKbps);
  if (carrying.length) return carrying.reduce((a, b) => ((a.bitrateKbps as number) <= (b.bitrateKbps as number) ? a : b));
  return known.reduce((a, b) => ((a.bitrateKbps as number) >= (b.bitrateKbps as number) ? a : b));
}

// ── speed check ────────────────────────────────────────────────────────────

/** A measurement stays good this long, so going back and forth between
 *  titles never measures again. */
export const SPEED_CACHE_MS = 5 * 60_000;
const PROBE_MAX_MS = 3_000;
const PROBE_MAX_BYTES = 16 * 1024 * 1024;
/** The first bytes carry the connection set-up; the rate is taken after. */
const PROBE_SKIP_BYTES = 256 * 1024;

const cache = new Map<string, { kbps: number; at: number }>();
const inflight = new Map<string, Promise<number | null>>();

/**
 * The rate from a probe: after the first 256 KB when enough came after them;
 * on a slow link (little arrived in the time allowed) everything over the
 * whole time, which is if anything low, and a slow link is what the check
 * must not miss. Null when nothing at all arrived.
 */
export function probeRate(bytes: number, countedBytes: number, countedMs: number, totalMs: number): number | null {
  if (countedMs >= 200 && countedBytes >= 512 * 1024) return Math.round((countedBytes * 8) / countedMs);
  if (bytes > 0 && totalMs >= 1000) return Math.round((bytes * 8) / totalMs);
  return null;
}

/**
 * The rate from a probe's arrivals (`marks`: when each piece came in, and the
 * bytes in by then), from `startedAt` to `endedAt`. A fast line to a far
 * server spends most of a short read ramping up: TCP doubles what it sends
 * each round trip, so the read as a whole averaged well under what the line
 * carries (on the owner's TV the check said "you have" far less than the 84
 * Mb/s the Plex app averages, peaks ~300, from the same server). Past the
 * ramp — the second half of the bytes, as each round trip brings about as
 * much as all before it — is what the line carries; the better of that and
 * probeRate's (a slow or steady line reads the same either way).
 */
export function probeRateFromMarks(marks: Array<{ t: number; bytes: number }>, startedAt: number, endedAt: number): number | null {
  const total = marks.length ? marks[marks.length - 1].bytes : 0;
  const first = marks.find((m) => m.bytes >= PROBE_SKIP_BYTES);
  const base = probeRate(total, first ? total - first.bytes : 0, first ? endedAt - first.t : 0, endedAt - startedAt);
  if (total < 2 * 1024 * 1024) return base;
  const half = marks.find((m) => m.bytes >= total / 2);
  if (!half) return base;
  const tailBytes = total - half.bytes;
  const tailMs = endedAt - half.t;
  // Too little, or too short to time (pieces handed over in a batch).
  if (tailBytes < 512 * 1024 || tailMs < 150) return base;
  const tail = Math.round((tailBytes * 8) / tailMs);
  return base == null ? tail : Math.max(base, tail);
}

const serverKey = (base: string): string => base.replace(/\/+$/, '');

/** A recent measurement to this server, kbps, or null. */
export function cachedPlexSpeed(base: string, now = Date.now()): number | null {
  const c = cache.get(serverKey(base));
  return c && now - c.at < SPEED_CACHE_MS ? c.kbps : null;
}

/** For tests. */
export function _resetPlexSpeedCache(): void { cache.clear(); inflight.clear(); }
export function _setPlexSpeed(base: string, kbps: number, at = Date.now()): void { cache.set(serverKey(base), { kbps, at }); }

/**
 * How fast this box gets data from the Plex server right now, kbps: a few
 * seconds of the file itself (at most 16 MB), the same path playback takes.
 * Cached for a few minutes per server (`fresh` measures anyway, e.g. mid-film
 * before raising the quality); concurrent calls share one download.
 * Null when it cannot tell (no part, blocked, too little arrived). Never
 * throws, never logs the address (it carries the token).
 */
export function measurePlexSpeed(base: string, token: string, partKey: string | undefined, opts?: { fresh?: boolean }): Promise<number | null> {
  const known = opts?.fresh ? null : cachedPlexSpeed(base);
  if (known != null) return Promise.resolve(known);
  if (!partKey || typeof fetch !== 'function') return Promise.resolve(null);
  const key = serverKey(base);
  const running = inflight.get(key);
  if (running) return running;
  const p = (async (): Promise<number | null> => {
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    // A server that stops sending mid-way would hold read() forever.
    const stop = setTimeout(() => { try { ac?.abort(); } catch { /* ignore */ } }, PROBE_MAX_MS + 500);
    const started = Date.now();
    let bytes = 0;
    const marks: Array<{ t: number; bytes: number }> = [];
    try {
      const res = await fetch(plexDirectUrl(base, partKey, token), {
        headers: { Range: `bytes=0-${PROBE_MAX_BYTES - 1}` },
        cache: 'no-store',
        signal: ac?.signal,
      });
      if (!res.ok || !res.body || typeof res.body.getReader !== 'function') return null;
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const n = value ? value.byteLength : 0;
          bytes += n;
          marks.push({ t: Date.now(), bytes });
          if (bytes >= PROBE_MAX_BYTES || Date.now() - started >= PROBE_MAX_MS) break;
        }
      } catch { /* cut off by the timer: what arrived still counts */ }
      try { await reader.cancel(); } catch { /* ignore */ }
    } catch {
      // Blocked or unreachable: that says nothing about the speed.
      return null;
    } finally {
      clearTimeout(stop);
      try { ac?.abort(); } catch { /* ignore */ }
      inflight.delete(key);
    }
    const kbps = probeRateFromMarks(marks, started, Date.now());
    if (kbps != null) cache.set(key, { kbps, at: Date.now() });
    return kbps;
  })();
  inflight.set(key, p);
  return p;
}
