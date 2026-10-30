// Support › Device check, the rating (ported from Tronix lib/deviceCheckRating;
// owner, 2026-10-29: "it can rate device, green yellow orange and red. If it
// works it works but definitely be ready to look for something better"). By
// the scan's figures and the thresholds below only: never by a maker's or a
// model's name.
//
//   green   great
//   yellow  fine
//   orange  works; an upgrade is worth considering (the reasons are shown)
//   red     likely the cause of buffering or crashes (the reasons are shown)
//
// Three areas: the device (memory, processor, video decoders, Android and web
// engine age, storage), the connection (wired or Wi-Fi, the Wi-Fi band, signal
// and link, the speed test) and a note for the TV / screen (resolution, HDR;
// TVs only). The overall rating is the worse of the device and the connection:
// a screen never causes buffering. Anything the scan could not read is not
// rated (null), never guessed.
import type { CodecSupport, DeviceScan } from '@/lib/deviceScan';

export type Level = 'green' | 'yellow' | 'orange' | 'red';
export type Area = 'device' | 'connection' | 'screen';
export type PickCategory = 'device' | 'router' | 'tv' | 'other';

const ORDER: Record<Level, number> = { green: 0, yellow: 1, orange: 2, red: 3 };

/** The worse of some levels (null ones ignored); null when none. */
export const worst = (levels: Array<Level | null | undefined>): Level | null =>
  levels.reduce<Level | null>((w, l) => (l && (!w || ORDER[l] > ORDER[w]) ? l : w), null);

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/**
 * Where each figure turns. A value AT a threshold is the better level.
 * Memory: Android reports a little under the label (a "3 GB" box says about
 * 2.7-2.9, a "2 GB" one about 1.8-1.9, a "1.5 GB" one about 1.3-1.4).
 */
export const THRESHOLDS = {
  /** Total memory: green from 3 GB boxes, yellow 2 GB, orange 1.5 GB, red 1 GB. */
  ramTotal: { green: 2.5 * GB, yellow: 1.7 * GB, orange: 1.2 * GB },
  /** Free memory right now (Android's own "low" flag is orange: it passes). */
  ramFree: { green: 500 * MB, yellow: 250 * MB },
  /** Free storage. */
  storageFree: { green: 2 * GB, yellow: 1 * GB, orange: 300 * MB },
  /** Processor cores: fewer than this is orange. */
  cores: 4,
  /** Android API level: 28 (Android 9) green, 25-27 (7.1-8.1) yellow, older orange. */
  apiLevel: { green: 28, yellow: 25 },
  /** The web engine's major version (Chromium): SMC's oldest is 66. */
  webview: { green: 100, yellow: 80, orange: 66 },
  /** Wi-Fi signal (dBm). */
  rssi: { green: -60, yellow: -67, orange: -75 },
  /** Wi-Fi link to the router (Mbps; real throughput is about half). */
  linkMbps: { green: 200, yellow: 72, orange: 30 },
  /** Internet download speed (Mbps): 4K needs 25, HD 10-15. */
  downMbps: { green: 50, yellow: 25, orange: 10 },
  /** Response time (ms). */
  pingMs: { yellow: 100, orange: 200 },
  /** Screen width in pixels: 4K green, Full HD yellow, less orange. */
  screenWidth: { green: 3840, yellow: 1920 },
} as const;

/** Higher is better: green at/above `green`, … red below `orange` (or below `yellow` with no orange step). */
function higher(v: number | null, t: { green: number; yellow: number; orange?: number }): Level | null {
  if (v === null) return null;
  if (v >= t.green) return 'green';
  if (v >= t.yellow) return 'yellow';
  if (t.orange === undefined) return 'orange';
  return v >= t.orange ? 'orange' : 'red';
}

/** One line of the scan: what it is (a key the screen words), its level, its figures. */
export interface Finding {
  area: Area;
  /** deviceScan.find.<key> (the line), deviceScan.why.<key> (orange / red: the reason). */
  key: string;
  /** null: shown, not rated. */
  level: Level | null;
  params?: Record<string, string | number>;
}

export interface Rating {
  overall: Level | null;
  areas: Record<Area, Level | null>;
  findings: Finding[];
  /** Picks' categories worth a look first (an area orange or red). */
  highlight: PickCategory[];
}

const gb = (b: number): string => (b >= 10 * GB ? String(Math.round(b / GB)) : (Math.round((b / GB) * 10) / 10).toFixed(1));
/** "1.9 GB" / "740 MB" (numbers only; the screen and the summary say them as they are). */
export const sizeText = (b: number): string => (b >= GB ? `${gb(b)} GB` : `${Math.max(0, Math.round(b / MB))} MB`);

const codecKey = (name: string, c: CodecSupport): string | null => {
  if (c.decoder === false) return `${name}None`;
  if (c.hardware === true) return `${name}Hw`;
  if (c.hardware === false) return `${name}Sw`;
  if (c.decoder === true) return `${name}Yes`;
  return null;
};

function deviceFindings(s: DeviceScan): Finding[] {
  const out: Finding[] = [];
  const f = (key: string, level: Level | null, params?: Finding['params']) => out.push({ area: 'device', key, level, ...(params ? { params } : {}) });

  if (s.ramTotal !== null) {
    let level = higher(s.ramTotal, THRESHOLDS.ramTotal);
    // Android itself says this is a low-memory device: at least orange.
    if (s.lowRamDevice && level && ORDER[level] < ORDER.orange) level = 'orange';
    // The web's figure is rounded and capped: a floor, so never worse than yellow from it alone.
    if (s.source === 'web' && level && ORDER[level] > ORDER.yellow) level = 'yellow';
    f('ram', level, { total: sizeText(s.ramTotal) });
  }
  if (s.ramFree !== null || s.ramLow) {
    // Right now only (a restart frees it): orange at worst, never red on its
    // own, so a good device caught busy is not called the cause.
    const level: Level | null = s.ramLow ? 'orange' : s.ramFree === null ? null
      : s.ramFree >= THRESHOLDS.ramFree.green ? 'green' : s.ramFree >= THRESHOLDS.ramFree.yellow ? 'yellow' : 'orange';
    f('ramFree', level, { free: s.ramFree === null ? '?' : sizeText(s.ramFree) });
  }
  if (s.cores !== null) {
    f(s.is64bit === false ? 'cpu32' : 'cpu', s.cores >= THRESHOLDS.cores ? (s.is64bit === false ? 'yellow' : 'green') : 'orange', { cores: s.cores });
  }

  // Video decoders: H.264 is every HD channel; H.265 many channels and all 4K.
  const avc = codecKey('avc', s.codecs.avc);
  if (avc) {
    f(avc, s.codecs.avc.decoder === false || s.codecs.avc.hardware === false ? 'red'
      : s.codecs.avc.hardware === true ? 'green' : null);
  }
  const hevc = codecKey('hevc', s.codecs.hevc);
  if (hevc) {
    f(hevc, s.codecs.hevc.decoder === false || s.codecs.hevc.hardware === false ? 'orange'
      : s.codecs.hevc.hardware === true ? 'green' : null);
  }
  const screen4k = !!s.screen && s.screen.width >= THRESHOLDS.screenWidth.green;
  const uhdKnown = [s.codecs.hevc.uhd, s.codecs.vp9.uhd, s.codecs.av1.uhd];
  const uhd = uhdKnown.some((v) => v === true) ? true : uhdKnown.every((v) => v === false) ? false : null;
  if (uhd !== null) {
    // 4K the device can't decode matters only on a 4K screen.
    f(uhd ? 'uhdYes' : 'uhdNo', uhd ? 'green' : screen4k && s.formFactor === 'tv' ? 'orange' : null);
  }
  const extras = (['vp9', 'av1'] as const).filter((c) => s.codecs[c].hardware === true || (s.codecs[c].hardware === null && s.codecs[c].decoder === true));
  if (extras.length || s.codecs.vp9.decoder !== null || s.codecs.av1.decoder !== null) {
    f(extras.length ? 'extras' : 'extrasNone', null, { list: extras.map((c) => c.toUpperCase()).join(', ') });
  }
  if (s.screen?.hdr.length && s.codecs.hevc.tenBit === false && s.codecs.vp9.tenBit !== true && s.codecs.av1.tenBit !== true) {
    f('hdrDecodeNo', 'yellow');
  }

  if (s.apiLevel !== null) {
    f('android', s.apiLevel >= THRESHOLDS.apiLevel.green ? 'green' : s.apiLevel >= THRESHOLDS.apiLevel.yellow ? 'yellow' : 'orange',
      { version: s.osVersion ?? '?', api: s.apiLevel });
  } else if (s.osVersion) {
    f('androidVersion', null, { version: s.osVersion });
  }
  if (s.webview !== null) f('webview', higher(s.webview, THRESHOLDS.webview), { major: s.webview });
  if (s.storageFree !== null) {
    f('storage', higher(s.storageFree, THRESHOLDS.storageFree), {
      free: sizeText(s.storageFree), total: s.storageTotal === null ? '?' : sizeText(s.storageTotal),
    });
  }
  return out;
}

function connectionFindings(s: DeviceScan): Finding[] {
  const out: Finding[] = [];
  const f = (key: string, level: Level | null, params?: Finding['params']) => out.push({ area: 'connection', key, level, ...(params ? { params } : {}) });
  const t = s.network.type;
  if (t === 'ethernet') f('netEthernet', 'green');
  else if (t === 'wifi') f('netWifi', null);
  else if (t === 'cellular') f('netCellular', 'yellow');
  else if (t === 'none') f('netNone', 'red');
  else if (t === 'other') f('netOther', null);

  if (t === 'wifi' || (t === 'unknown' && s.wifi)) {
    const w = s.wifi;
    if (w?.band) f('band', w.band === '2.4' ? 'orange' : 'green', { band: w.band });
    if (w?.rssi != null) f('signal', higher(w.rssi, THRESHOLDS.rssi), { dbm: w.rssi });
    if (w?.linkMbps != null) f('link', higher(w.linkMbps, THRESHOLDS.linkMbps), { mbps: w.linkMbps });
  }

  if (s.speed) {
    f('speed', higher(s.speed.downMbps, THRESHOLDS.downMbps), {
      down: Math.round(s.speed.downMbps * 10) / 10, up: Math.round(s.speed.upMbps * 10) / 10,
    });
    if (s.speed.pingMs !== null) {
      const p = s.speed.pingMs;
      f('ping', p < THRESHOLDS.pingMs.yellow ? 'green' : p < THRESHOLDS.pingMs.orange ? 'yellow' : 'orange', { ms: Math.round(p) });
    }
  } else {
    f('speedNone', null);
  }
  return out;
}

function screenFindings(s: DeviceScan): Finding[] {
  const out: Finding[] = [];
  if (!s.screen) return out;
  // A phone or tablet's own screen: shown, not rated (it is not the TV).
  const tv = s.formFactor === 'tv';
  const w = s.screen.width;
  const name = w >= 3840 ? '4K' : w >= 2560 ? 'QHD' : w >= 1920 ? 'Full HD' : w >= 1280 ? 'HD' : 'SD';
  out.push({
    area: 'screen',
    key: tv ? 'screen' : 'screenDevice',
    level: tv ? higher(w, THRESHOLDS.screenWidth) : null,
    params: { w, h: s.screen.height, name },
  });
  if (tv) {
    out.push({
      area: 'screen',
      key: s.screen.hdr.length ? 'hdrYes' : 'hdrNo',
      level: null,
      params: { list: s.screen.hdr.map((x) => HDR_LABEL[x] ?? x).join(', ') },
    });
  }
  return out;
}

const HDR_LABEL: Record<string, string> = { hdr10: 'HDR10', hdr10plus: 'HDR10+', hlg: 'HLG', dolbyVision: 'Dolby Vision', hdr: 'HDR' };

export function rateScan(s: DeviceScan): Rating {
  const findings = [...deviceFindings(s), ...connectionFindings(s), ...screenFindings(s)];
  const areaLevel = (a: Area) => worst(findings.filter((x) => x.area === a).map((x) => x.level));
  const areas: Record<Area, Level | null> = { device: areaLevel('device'), connection: areaLevel('connection'), screen: areaLevel('screen') };
  const overall = worst([areas.device, areas.connection]);
  const bad = (l: Level | null) => l === 'orange' || l === 'red';
  const highlight: PickCategory[] = [];
  if (bad(areas.device)) highlight.push('device');
  if (bad(areas.connection)) highlight.push('router', 'other');
  if (bad(areas.screen)) highlight.push('tv');
  return { overall, areas, findings, highlight };
}

/** Orange and red lines are the ones with a reason to show. */
export const needsReason = (f: Finding): boolean => f.level === 'orange' || f.level === 'red';
